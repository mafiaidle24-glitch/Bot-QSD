// Sistema de tickets: painel com botões, canal privado por atendimento, log com transcrição.
const {
  ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, MessageFlags,
} = require('discord.js');
const cfgs = require('./config');

const EPHEMERAL = MessageFlags.Ephemeral;
const CATEGORY_NAME = '🎫 Tickets';
const STYLE = { 1: ButtonStyle.Primary, 2: ButtonStyle.Secondary, 3: ButtonStyle.Success, 4: ButtonStyle.Danger };
const warn = (where, e) => console.error('[tickets] erro em ' + where + ':', e?.message || e);

const slug = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);

/** O topo do canal guarda: ticket:<id do dono>:<tipo>:<número> */
function parseTopic(channel) {
  const m = /^ticket:(\d+):([a-z0-9]+):(\d+)$/.exec(channel?.topic || '');
  return m ? { userId: m[1], typeId: m[2], number: Number(m[3]) } : null;
}

const fmt = (text, v) =>
  String(text || '')
    .replace(/\{user\}/gi, v.user ? '<@' + v.user.id + '>' : '')
    .replace(/\{username\}/gi, v.user ? v.user.username : '')
    .replace(/\{server\}/gi, v.guild.name)
    .replace(/\{type\}/gi, v.type ? v.type.label : '');

function makeButton(customId, label, emoji, style) {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(STYLE[style] || ButtonStyle.Primary);
  const text = String(label || '').slice(0, 80);
  if (text) b.setLabel(text);
  if (emoji) {
    try { b.setEmoji(emoji); } catch { if (!text) b.setLabel('Ticket'); }
  }
  if (!text && !emoji) b.setLabel('Ticket');
  return b;
}

function buildPanelPayload(panel) {
  const embed = new EmbedBuilder().setColor(panel.color);
  if (panel.title) embed.setTitle(panel.title);
  if (panel.description) embed.setDescription(panel.description);
  if (!panel.title && !panel.description) embed.setDescription('Clique no botão abaixo para abrir um ticket.');
  const buttons = panel.types.map((t) => makeButton('tk:open:' + t.id, t.label, t.emoji, t.style));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

async function publishPanel(guild) {
  const cfg = cfgs.getConfig(guild.id).tickets;
  const panel = cfg.panel;
  if (!panel.channelId) throw new Error('Escolha o canal onde o painel de tickets será publicado.');
  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Canal do painel inválido ou sem acesso para o bot.');
  const payload = buildPanelPayload(panel);
  let msg = null;
  if (panel.messageId) {
    msg = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (msg && msg.author.id === guild.client.user.id) await msg.edit(payload);
    else msg = null;
  }
  if (!msg) {
    msg = await channel.send(payload);
    cfgs.setTicketPanelMessage(guild.id, msg.id);
  }
  return msg.url;
}

async function ensureCategory(guild, cfg) {
  if (cfg.categoryId) {
    const c = guild.channels.cache.get(cfg.categoryId) || (await guild.channels.fetch(cfg.categoryId).catch(() => null));
    if (c && c.type === ChannelType.GuildCategory) return c;
  }
  let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME);
  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }],
    });
  }
  return category;
}

const isStaff = (member, cfg) =>
  !!member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || cfg.staffRoleIds.some((id) => member.roles.cache.has(id)));

async function sendLog(guild, cfg, payload) {
  if (!cfg.logChannelId) return;
  const ch = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
  if (ch && ch.isTextBased()) await ch.send({ ...payload, allowedMentions: { parse: [] } }).catch((e) => warn('log', e));
}

async function openTicket(i, typeId) {
  const cfg = cfgs.getConfig(i.guild.id).tickets;
  if (!cfg.enabled) return i.reply({ content: 'O sistema de tickets está desativado neste servidor.', flags: EPHEMERAL });
  const type = cfg.panel.types.find((t) => t.id === typeId);
  if (!type) return i.reply({ content: 'Este botão não está mais configurado.', flags: EPHEMERAL });

  const mine = i.guild.channels.cache.filter((c) => parseTopic(c)?.userId === i.user.id);
  if (mine.size >= cfg.maxPerUser) {
    return i.reply({
      content: 'Você já tem ' + (mine.size === 1 ? 'um ticket aberto' : mine.size + ' tickets abertos') + ': ' + mine.map((c) => '<#' + c.id + '>').join(', ') + '. Feche antes de abrir outro.',
      flags: EPHEMERAL,
    });
  }
  await i.deferReply({ flags: EPHEMERAL });

  try {
    const category = await ensureCategory(i.guild, cfg);
    const number = cfgs.nextTicketNumber(i.guild.id);
    const name = cfg.naming === 'number'
      ? 'ticket-' + String(number).padStart(4, '0')
      : (slug(type.label) || 'ticket') + '-' + (slug(i.user.username) || 'membro');
    const staffRoles = cfg.staffRoleIds.filter((id) => i.guild.roles.cache.has(id));
    const see = [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
    ];
    const channel = await i.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'ticket:' + i.user.id + ':' + type.id + ':' + number,
      reason: 'Ticket aberto por ' + i.user.tag,
      permissionOverwrites: [
        { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: i.user.id, allow: see },
        ...staffRoles.map((id) => ({ id, allow: [...see, PermissionFlagsBits.ManageMessages] })),
        { id: i.client.user.id, allow: [...see, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
      ],
    });

    const embed = new EmbedBuilder()
      .setColor(cfg.panel.color)
      .setTitle(((type.emoji ? type.emoji + ' ' : '') + type.label).slice(0, 256))
      .setDescription(fmt(type.welcome, { user: i.user, guild: i.guild, type }).slice(0, 4000))
      .setFooter({ text: 'Ticket #' + number + ' • ' + i.user.username })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(makeButton('tk:close', 'Fechar ticket', '🔒', 4));
    const pings = [String(i.user), ...(cfg.pingStaff ? staffRoles.map((id) => '<@&' + id + '>') : [])].join(' ');
    await channel.send({
      content: pings,
      embeds: [embed],
      components: [row],
      allowedMentions: { users: [i.user.id], roles: cfg.pingStaff ? staffRoles : [] },
    });
    await i.editReply('✅ Seu ticket foi criado: <#' + channel.id + '>');
    await sendLog(i.guild, cfg, {
      embeds: [new EmbedBuilder().setColor(0x23a55a).setTitle('🎫 Ticket aberto')
        .addFields(
          { name: 'Canal', value: '<#' + channel.id + '>', inline: true },
          { name: 'Aberto por', value: '<@' + i.user.id + '>', inline: true },
          { name: 'Tipo', value: type.label.slice(0, 100), inline: true })
        .setFooter({ text: 'Ticket #' + number }).setTimestamp()],
    });
  } catch (e) {
    warn('abrir ticket', e);
    await i.editReply('Não consegui criar o ticket. Peça a um administrador para dar ao bot a permissão **Gerenciar Canais** (e conferir se a categoria não está cheia).').catch(() => {});
  }
}

/** Transcrição em texto das mensagens do canal (até 1000). */
async function buildTranscript(channel) {
  const all = [];
  let before;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const when = (ts) => new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lines = all.map((m) => {
    const parts = [m.content];
    for (const a of m.attachments.values()) parts.push('[anexo: ' + a.url + ']');
    if (m.embeds.length) parts.push('[' + m.embeds.length + ' embed(s)]');
    return '[' + when(m.createdTimestamp) + '] ' + (m.member?.displayName || m.author.username) + ': ' + parts.filter(Boolean).join(' ');
  });
  return { text: lines.join('\n') || '(sem mensagens)', count: all.length };
}

async function closeTicket(i) {
  const info = parseTopic(i.channel);
  if (!info) return i.reply({ content: 'Isto só funciona dentro de um ticket.', flags: EPHEMERAL });
  const cfg = cfgs.getConfig(i.guild.id).tickets;
  const staff = isStaff(i.member, cfg);
  if (!staff && !(info.userId === i.user.id && cfg.userCanClose)) {
    return i.reply({ content: 'Só a equipe pode fechar este ticket.', flags: EPHEMERAL });
  }
  await i.reply('🔒 Fechando o ticket em 5 segundos...');
  const channel = i.channel;
  try {
    let file;
    let count = 0;
    if (cfg.transcript && cfg.logChannelId) {
      const t = await buildTranscript(channel);
      count = t.count;
      file = new AttachmentBuilder(Buffer.from(t.text, 'utf8'), { name: 'transcricao-' + channel.name + '.txt' });
    }
    await sendLog(i.guild, cfg, {
      embeds: [new EmbedBuilder().setColor(0xda373c).setTitle('🔒 Ticket fechado')
        .addFields(
          { name: 'Ticket', value: '#' + channel.name + ' (nº ' + info.number + ')', inline: true },
          { name: 'Aberto por', value: '<@' + info.userId + '>', inline: true },
          { name: 'Fechado por', value: '<@' + i.user.id + '>', inline: true },
          ...(file ? [{ name: 'Mensagens', value: String(count), inline: true }] : []))
        .setTimestamp()],
      files: file ? [file] : [],
    });
  } catch (e) {
    warn('log de fechamento', e);
  }
  setTimeout(() => channel.delete('Ticket fechado por ' + i.user.tag).catch((e) => warn('apagar canal', e)), 5000);
}

async function handleButton(i) {
  if (i.customId.startsWith('tk:open:')) return openTicket(i, i.customId.slice(8));
  if (i.customId === 'tk:close') return closeTicket(i);
}

module.exports = { handleButton, publishPanel, buildPanelPayload };
