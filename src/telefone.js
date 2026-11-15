// Telefone Vermelho: atendimento estilo ModMail.
// O membro manda mensagem no PRIVADO do bot, confirma por botões (✅ 🔄 ❌) e a equipe responde
// num canal privado do servidor. As respostas da equipe voltam para o privado do membro.
const crypto = require('crypto');
const {
  ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, SlashCommandBuilder, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const cfgs = require('./config');
const premium = require('./premium');

const EPHEMERAL = MessageFlags.Ephemeral;
const CATEGORY_NAME = '📞 Telefone Vermelho';
const DRAFT_TTL = 10 * 60 * 1000;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_BLOCKED = 500;
const warn = (where, e) => console.error('[telefone] erro em ' + where + ':', e?.message || e);

const slug = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

/* O tópico do canal guarda quem é o membro. Fica legível para a equipe. */
const TOPIC_RE = /usuário (\d{15,25}) • atendimento nº (\d+)/;
const topicOf = (user, n) => '📞 Atendimento de ' + String(user.username).slice(0, 40) + ' • usuário ' + user.id + ' • atendimento nº ' + n;
function parseTopic(channel) {
  const m = TOPIC_RE.exec(channel?.topic || '');
  return m ? { userId: m[1], number: Number(m[2]) } : null;
}

const fmt = (text, v) =>
  String(text || '')
    .replace(/\{server\}/gi, v.guild.name)
    .replace(/\{username\}/gi, v.user ? v.user.username : '')
    .replace(/\{user\}/gi, v.user ? '<@' + v.user.id + '>' : '');

const isStaff = (member, cfg) =>
  !!member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || cfg.staffRoleIds.some((id) => member.roles.cache.has(id)));

const nonEmpty = (text, fallback) => String(text || '').trim().slice(0, 4000) || fallback;
const simple = (text, color = '#5865f2') => new EmbedBuilder().setColor(color).setDescription(nonEmpty(text, '​'));

/* ------------------------------- estado em memória ------------------------------- */

const drafts = new Map();   // id -> pedido aguardando confirmação
const draftOf = new Map();  // userId -> id do pedido atual
const hits = new Map();     // userId -> horários das últimas mensagens (limite de ritmo)
const notices = new Map();  // userId -> quando avisamos pela última vez ("sem servidor")

function rateOk(userId) {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter((t) => now - t < 60_000);
  if (list.length >= 20) { hits.set(userId, list); return false; }
  list.push(now);
  hits.set(userId, list);
  return true;
}

function dropDraft(id) {
  const d = drafts.get(id);
  if (!d) return null;
  drafts.delete(id);
  if (draftOf.get(d.userId) === id) draftOf.delete(d.userId);
  return d;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, d] of drafts) if (now - d.at > DRAFT_TTL) dropDraft(id);
  for (const [u, t] of notices) if (now - t > 10 * 60_000) notices.delete(u);
  for (const [u, l] of hits) if (!l.some((t) => now - t < 60_000)) hits.delete(u);
}, 60_000).unref?.();

/* ------------------------------- utilidades ------------------------------- */

function collectFiles(msg) {
  const files = [];
  let skipped = 0;
  for (const a of msg.attachments.values()) {
    if (a.size > MAX_FILE) { skipped++; continue; }
    files.push({ attachment: a.url, name: a.name || 'arquivo' });
  }
  if (files.length > 10) skipped += files.length - 10;
  return { files: files.slice(0, 10), skipped };
}

/** Conversa aberta deste membro em algum servidor onde o bot está. */
function findOpen(client, userId) {
  for (const g of client.guilds.cache.values()) {
    const ch = g.channels.cache.find((c) => c.type === ChannelType.GuildText && parseTopic(c)?.userId === userId);
    if (ch) return { guild: g, channel: ch, info: parseTopic(ch) };
  }
  return null;
}

/** Servidores onde o membro pode abrir atendimento agora. */
async function candidates(client, user) {
  const list = [];
  let blocked = false;
  for (const g of client.guilds.cache.values()) {
    const cfg = cfgs.getConfig(g.id).telefone;
    if (!cfg.enabled || !premium.perks(g.id).telefone) continue;
    const member = await g.members.fetch(user.id).catch(() => null);
    if (!member) continue;
    if (cfg.blocked.includes(user.id)) { blocked = true; continue; }
    list.push(g);
  }
  return { list, blocked };
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

async function sendLog(guild, cfg, payload) {
  if (!cfg.logChannelId) return;
  const ch = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
  if (ch && ch.isTextBased()) await ch.send({ ...payload, allowedMentions: { parse: [] } }).catch((e) => warn('log', e));
}

const closeRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('tf:close').setStyle(ButtonStyle.Danger).setLabel('Encerrar atendimento').setEmoji('🔒'));

/* ------------------------------- mensagens no privado ------------------------------- */

function promptPayload(client, d) {
  const cancel = new ButtonBuilder().setCustomId('tf:no:' + d.id).setStyle(ButtonStyle.Danger).setLabel('Cancelar').setEmoji('❌');
  if (!d.guildId) {
    const options = d.guildIds
      .map((id) => client.guilds.cache.get(id))
      .filter(Boolean)
      .slice(0, 25)
      .map((g) => ({ label: g.name.slice(0, 100), value: g.id }));
    const select = new StringSelectMenuBuilder().setCustomId('tf:pick:' + d.id).setPlaceholder('Escolha o servidor').addOptions(options);
    return {
      embeds: [simple('Você está em mais de um servidor com atendimento.\n**Para qual deles é a sua mensagem?**', '#e74c3c').setTitle('📞 Telefone Vermelho')],
      components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(cancel)],
    };
  }
  const guild = client.guilds.cache.get(d.guildId);
  const cfg = cfgs.getConfig(d.guildId).telefone;
  const user = { id: d.userId, username: d.username };
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle('📞 Enviar para a equipe?')
    .setDescription(nonEmpty(fmt(cfg.confirmText, { guild: guild || { name: 'servidor' }, user }), 'Quer enviar esta mensagem à equipe?'))
    .addFields({ name: 'Sua mensagem', value: (d.content ? d.content.slice(0, 900) : '*(somente anexo)*') });
  const extra = [];
  if (d.files.length) extra.push('📎 ' + d.files.length + ' anexo(s)');
  if (d.skipped) extra.push('⚠️ ' + d.skipped + ' anexo(s) grande(s) demais (máx. 8 MB) não serão enviados');
  if (extra.length) embed.addFields({ name: 'Anexos', value: extra.join('\n') });
  const ok = new ButtonBuilder().setCustomId('tf:ok:' + d.id).setStyle(ButtonStyle.Success).setLabel('Enviar').setEmoji('✅');
  const redo = new ButtonBuilder().setCustomId('tf:re:' + d.id).setStyle(ButtonStyle.Secondary)
    .setLabel(d.guildIds.length > 1 ? 'Trocar servidor' : 'Refazer').setEmoji('🔄');
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(ok, redo, cancel)] };
}

async function handleDM(msg) {
  const client = msg.client;
  const user = msg.author;
  if (!rateOk(user.id)) return;

  // 1) Já existe conversa aberta: a mensagem vai direto para o canal da equipe.
  const open = findOpen(client, user.id);
  if (open) {
    const cfg = cfgs.getConfig(open.guild.id).telefone;
    try {
      await forwardToStaff(open.channel, user, msg.content, collectFiles(msg).files, cfg);
      await msg.react('✅').catch(() => {});
    } catch (e) {
      warn('encaminhar ao canal', e);
      await msg.react('❌').catch(() => {});
    }
    return;
  }

  if (!msg.content.trim() && !msg.attachments.size) return;

  // 2) Nova conversa: descobre os servidores possíveis.
  const { list, blocked } = await candidates(client, user);
  if (!list.length) {
    const key = user.id + (blocked ? ':b' : ':n');
    if (Date.now() - (notices.get(key) || 0) < 10 * 60_000) return;
    notices.set(key, Date.now());
    await user.send({
      embeds: [simple(blocked
        ? '🚫 Você não pode abrir atendimento neste servidor no momento.'
        : 'Não encontrei nenhum servidor com o **Telefone Vermelho** ligado onde você esteja. Peça à equipe do servidor para ativá-lo.', '#e74c3c')],
    }).catch(() => {});
    return;
  }

  // 3) Pedido aguardando confirmação (o anterior, se houver, é descartado).
  const prevId = draftOf.get(user.id);
  if (prevId) {
    const prev = dropDraft(prevId);
    prev?.prompt?.edit({ embeds: [simple('↩️ Substituído pela sua mensagem mais nova.', '#6d6f78')], components: [] }).catch(() => {});
  }
  const { files, skipped } = collectFiles(msg);
  const d = {
    id: crypto.randomBytes(4).toString('hex'),
    userId: user.id,
    username: user.username,
    content: msg.content.slice(0, 4000),
    files,
    skipped,
    guildIds: list.map((g) => g.id),
    guildId: list.length === 1 ? list[0].id : '',
    at: Date.now(),
    prompt: null,
  };
  drafts.set(d.id, d);
  draftOf.set(user.id, d.id);
  d.prompt = await user.send(promptPayload(client, d)).catch((e) => { warn('enviar confirmação', e); return null; });
  if (!d.prompt) dropDraft(d.id);
}

/* ------------------------------- canal da equipe ------------------------------- */

async function forwardToStaff(channel, user, content, files, cfg) {
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(content ? content.slice(0, 4000) : '*(somente anexo)*')
    .setTimestamp();
  await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
}

async function createConversation(guild, user, d, cfg) {
  const member = await guild.members.fetch(user.id).catch(() => null);
  const category = await ensureCategory(guild, cfg);
  const number = cfgs.nextTelefoneNumber(guild.id);
  const staffRoles = cfg.staffRoleIds.filter((id) => guild.roles.cache.has(id));
  const see = [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
  ];
  const channel = await guild.channels.create({
    name: 'telefone-' + (slug(user.username) || 'membro'),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: topicOf(user, number),
    reason: 'Telefone Vermelho: atendimento de ' + user.tag,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...staffRoles.map((id) => ({ id, allow: [...see, PermissionFlagsBits.ManageMessages] })),
      { id: guild.client.user.id, allow: [...see, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ],
  });
  const created = Math.floor(user.createdTimestamp / 1000);
  const joined = member?.joinedTimestamp ? '<t:' + Math.floor(member.joinedTimestamp / 1000) + ':R>' : '—';
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle('📞 Novo atendimento')
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(d.content || '*(somente anexo)*')
    .addFields(
      { name: 'Membro', value: '<@' + user.id + '> (`' + user.id + '`)', inline: true },
      { name: 'Conta criada', value: '<t:' + created + ':R>', inline: true },
      { name: 'Entrou no servidor', value: joined, inline: true })
    .setFooter({ text: 'Atendimento nº ' + number + ' • Escreva aqui para responder ao membro • Comece com // para nota interna' })
    .setTimestamp();
  const pings = cfg.pingStaff ? staffRoles.map((id) => '<@&' + id + '>').join(' ') : '';
  await channel.send({
    content: pings || undefined,
    embeds: [embed],
    files: d.files,
    components: [closeRow()],
    allowedMentions: { roles: cfg.pingStaff ? staffRoles : [], users: [] },
  });
  await sendLog(guild, cfg, {
    embeds: [new EmbedBuilder().setColor(0x23a55a).setTitle('📞 Atendimento aberto')
      .addFields(
        { name: 'Canal', value: '<#' + channel.id + '>', inline: true },
        { name: 'Membro', value: '<@' + user.id + '>', inline: true })
      .setFooter({ text: 'Atendimento nº ' + number }).setTimestamp()],
  });
  return channel;
}

/** A equipe escreveu num canal de atendimento: manda para o privado do membro. */
async function handleStaffMessage(msg) {
  const info = parseTopic(msg.channel);
  if (!info || msg.channel.type !== ChannelType.GuildText) return false;
  const cfg = cfgs.getConfig(msg.guild.id).telefone;
  if (!isStaff(msg.member, cfg)) return true;
  const text = msg.content.trim();
  if (text.startsWith('//')) { await msg.react('📝').catch(() => {}); return true; }
  const { files, skipped } = collectFiles(msg);
  if (!text && !files.length) return true;
  const guild = msg.guild;
  const embed = new EmbedBuilder()
    .setColor(cfg.color)
    .setDescription(text ? text.slice(0, 4000) : '*(somente anexo)*')
    .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })
    .setTimestamp();
  embed.setAuthor(cfg.anonymous
    ? { name: 'Equipe de ' + guild.name.slice(0, 200), iconURL: guild.iconURL() || undefined }
    : { name: msg.member.displayName, iconURL: msg.member.displayAvatarURL() });
  try {
    const user = await msg.client.users.fetch(info.userId);
    await user.send({ embeds: [embed], files });
    await msg.react('✅').catch(() => {});
    if (skipped) await msg.reply({ content: '⚠️ ' + skipped + ' anexo(s) não foram enviados (máx. 8 MB cada, até 10).', allowedMentions: { repliedUser: false } }).catch(() => {});
  } catch (e) {
    warn('responder no privado', e);
    await msg.react('❌').catch(() => {});
    await msg.reply({ content: '❌ Não consegui enviar para o privado do membro (ele pode ter saído do servidor ou bloqueado mensagens privadas).', allowedMentions: { repliedUser: false } }).catch(() => {});
  }
  return true;
}

/* ------------------------------- encerrar ------------------------------- */

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
    const e = m.embeds?.[0];
    let who;
    let body;
    if (m.author.bot && e?.author?.name) { who = e.author.name; body = e.description || ''; } else if (m.author.bot) { return null; } else { who = '(equipe) ' + (m.member?.displayName || m.author.username); body = m.content; }
    const parts = [body];
    for (const a of m.attachments.values()) parts.push('[anexo: ' + a.url + ']');
    return '[' + when(m.createdTimestamp) + '] ' + who + ': ' + parts.filter(Boolean).join(' ');
  }).filter(Boolean);
  return lines.join('\n') || '(sem mensagens)';
}

async function closeConversation(guild, channel, info, closer, cfg) {
  try {
    let file;
    if (cfg.transcript && cfg.logChannelId) {
      file = new AttachmentBuilder(Buffer.from(await buildTranscript(channel), 'utf8'), { name: 'transcricao-' + channel.name + '.txt' });
    }
    await sendLog(guild, cfg, {
      embeds: [new EmbedBuilder().setColor(0xda373c).setTitle('📞 Atendimento encerrado')
        .addFields(
          { name: 'Membro', value: '<@' + info.userId + '>', inline: true },
          { name: 'Encerrado por', value: '<@' + closer.id + '>', inline: true },
          { name: 'Atendimento', value: 'nº ' + info.number, inline: true })
        .setTimestamp()],
      files: file ? [file] : [],
    });
  } catch (e) {
    warn('log de encerramento', e);
  }
  try {
    const user = await guild.client.users.fetch(info.userId);
    await user.send({ embeds: [new EmbedBuilder().setColor(cfg.color).setDescription(nonEmpty(fmt(cfg.closeText, { guild, user }), '🔒 Atendimento encerrado.'))
      .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })] });
  } catch { /* membro com privado fechado: sem problema */ }
  setTimeout(() => channel.delete('Atendimento encerrado por ' + closer.tag).catch((e) => warn('apagar canal', e)), 5000);
}

/* ------------------------------- botões e menus ------------------------------- */

async function handleInteraction(i) {
  const [, action, id] = i.customId.split(':');

  // Dentro do canal da equipe
  if (action === 'close') {
    if (!i.guild) return;
    const info = parseTopic(i.channel);
    if (!info) return i.reply({ content: 'Isto só funciona dentro de um atendimento.', flags: EPHEMERAL });
    const cfg = cfgs.getConfig(i.guild.id).telefone;
    if (!isStaff(i.member, cfg)) return i.reply({ content: 'Só a equipe pode encerrar o atendimento.', flags: EPHEMERAL });
    await i.reply('🔒 Encerrando o atendimento em 5 segundos...');
    return closeConversation(i.guild, i.channel, info, i.user, cfg);
  }

  // No privado do membro
  if (i.guild) return;
  const d = drafts.get(id);
  if (!d || d.userId !== i.user.id) {
    return i.update({ embeds: [simple('⌛ Este pedido expirou. Mande sua mensagem de novo para recomeçar.', '#6d6f78')], components: [] }).catch(() => {});
  }
  d.at = Date.now();

  if (action === 'no') {
    dropDraft(id);
    return i.update({ embeds: [simple('❌ Cancelado. Nada foi enviado.', '#6d6f78')], components: [] });
  }

  if (action === 'pick') {
    const gid = i.values?.[0];
    if (!d.guildIds.includes(gid)) return i.deferUpdate().catch(() => {});
    d.guildId = gid;
    return i.update(promptPayload(i.client, d));
  }

  if (action === 're') {
    if (d.guildIds.length > 1) {
      d.guildId = '';
      return i.update(promptPayload(i.client, d));
    }
    dropDraft(id);
    return i.update({ embeds: [simple('🔄 Pedido descartado. Mande a mensagem corrigida e eu monto de novo.', '#6d6f78')], components: [] });
  }

  if (action === 'ok') {
    await i.deferUpdate();
    dropDraft(id);
    const fail = (t) => i.editReply({ embeds: [simple(t, '#da373c')], components: [] }).catch(() => {});
    const guild = i.client.guilds.cache.get(d.guildId);
    if (!guild) return fail('Não consegui encontrar o servidor. Tente de novo mais tarde.');
    const cfg = cfgs.getConfig(guild.id).telefone;
    if (!cfg.enabled || !premium.perks(guild.id).telefone) return fail('O Telefone Vermelho foi desativado neste servidor.');
    if (cfg.blocked.includes(i.user.id)) return fail('🚫 Você não pode abrir atendimento neste servidor no momento.');
    const again = findOpen(i.client, i.user.id);
    if (again) return fail('Você já tem um atendimento aberto em **' + again.guild.name + '**. Escreva aqui para continuar a conversa.');
    try {
      await createConversation(guild, i.user, d, cfg);
      await i.editReply({
        embeds: [new EmbedBuilder().setColor('#23a55a').setDescription(nonEmpty(fmt(cfg.sentText, { guild, user: i.user }), '✅ Mensagem enviada à equipe!'))],
        components: [],
      });
    } catch (e) {
      warn('abrir atendimento', e);
      await fail('Não consegui abrir o atendimento agora. Avise a equipe do servidor (o bot precisa da permissão **Gerenciar Canais**).');
    }
  }
}

/* ------------------------------- comando da equipe ------------------------------- */

const commands = [
  new SlashCommandBuilder().setName('telefone').setDescription('Telefone Vermelho: atendimento por mensagem privada (equipe)')
    .addSubcommand((s) => s.setName('fechar').setDescription('Encerra o atendimento deste canal'))
    .addSubcommand((s) => s.setName('bloquear').setDescription('Impede um membro de abrir atendimentos')
      .addUserOption((o) => o.setName('membro').setDescription('Quem será bloqueado').setRequired(true)))
    .addSubcommand((s) => s.setName('desbloquear').setDescription('Libera um membro bloqueado')
      .addUserOption((o) => o.setName('membro').setDescription('Quem será liberado').setRequired(true))),
];

async function handleSlash(i) {
  if (i.commandName !== 'telefone') return false;
  const cfg = cfgs.getConfig(i.guild.id).telefone;
  if (!isStaff(i.member, cfg)) {
    await i.reply({ content: 'Só a equipe pode usar este comando.', flags: EPHEMERAL });
    return true;
  }
  const sub = i.options.getSubcommand();
  if (sub === 'fechar') {
    const info = parseTopic(i.channel);
    if (!info) {
      await i.reply({ content: 'Use este comando dentro de um canal de atendimento.', flags: EPHEMERAL });
      return true;
    }
    await i.reply('🔒 Encerrando o atendimento em 5 segundos...');
    await closeConversation(i.guild, i.channel, info, i.user, cfg);
    return true;
  }
  const target = i.options.getUser('membro');
  const list = [...cfg.blocked];
  if (sub === 'bloquear') {
    if (target.bot || target.id === i.user.id) {
      await i.reply({ content: 'Escolha outro membro.', flags: EPHEMERAL });
      return true;
    }
    if (list.includes(target.id)) {
      await i.reply({ content: '<@' + target.id + '> já está bloqueado.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
      return true;
    }
    if (list.length >= MAX_BLOCKED) {
      await i.reply({ content: 'A lista de bloqueados está cheia.', flags: EPHEMERAL });
      return true;
    }
    list.push(target.id);
    cfgs.setTelefoneBlocked(i.guild.id, list);
    await i.reply({ content: '🚫 <@' + target.id + '> não pode mais abrir atendimentos.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
    return true;
  }
  const next = list.filter((x) => x !== target.id);
  if (next.length === list.length) {
    await i.reply({ content: '<@' + target.id + '> não estava bloqueado.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
    return true;
  }
  cfgs.setTelefoneBlocked(i.guild.id, next);
  await i.reply({ content: '✅ <@' + target.id + '> foi liberado.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
  return true;
}

module.exports = { commands, handleDM, handleStaffMessage, handleInteraction, handleSlash, parseTopic };
