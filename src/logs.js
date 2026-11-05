// Logs do servidor: registra num canal privado o que acontece (mensagens, entradas, cargos, bans, canais, moderação).
const { EmbedBuilder } = require('discord.js');
const cfgs = require('./config');

const warn = (where, e) => console.error('[logs] erro em ' + where + ':', e?.message || e);
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ts = (d) => '<t:' + Math.floor(new Date(d).getTime() / 1000) + ':R>';
const COLORS = { red: 0xda373c, green: 0x23a55a, yellow: 0xf0b232, blue: 0x5865f2, gray: 0x80848e };

/** Devolve o canal de log se o evento estiver ligado. */
async function target(guild, event, channelId) {
  const cfg = cfgs.getConfig(guild.id).logs;
  if (!cfg.enabled || !cfg.channelId || cfg.events[event] === false) return null;
  if (channelId && cfg.ignoreChannelIds.includes(channelId)) return null;
  const ch = guild.channels.cache.get(cfg.channelId) || (await guild.channels.fetch(cfg.channelId).catch(() => null));
  return ch && ch.isTextBased() ? ch : null;
}

async function post(guild, event, embed, channelId) {
  try {
    const ch = await target(guild, event, channelId);
    if (!ch) return;
    await ch.send({ embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } });
  } catch (e) {
    warn(event, e);
  }
}

const who = (u) => (u ? '<@' + u.id + '> (' + cut(u.username || u.tag || u.id, 40) + ')' : 'desconhecido');

/** Ações de moderação (kick, ban, timeout, warn...) chamadas pelo módulo de moderação. */
function logMod(guild, { action, target: t, moderator, reason, extra }) {
  const e = new EmbedBuilder().setColor(COLORS.yellow).setTitle('🔨 ' + action)
    .addFields(
      { name: 'Membro', value: who(t), inline: true },
      { name: 'Moderador', value: who(moderator), inline: true },
      { name: 'Motivo', value: cut(reason || 'Não informado', 1000) });
  if (extra) e.addFields({ name: 'Detalhes', value: cut(extra, 1000) });
  return post(guild, 'mod', e);
}

function attach(client) {
  client.on('messageDelete', async (m) => {
    if (!m.guild || m.author?.bot) return;
    const files = m.attachments?.size ? [...m.attachments.values()].map((a) => a.name).join(', ') : '';
    const e = new EmbedBuilder().setColor(COLORS.red).setTitle('🗑️ Mensagem apagada')
      .addFields(
        { name: 'Autor', value: who(m.author), inline: true },
        { name: 'Canal', value: '<#' + m.channelId + '>', inline: true },
        { name: 'Conteúdo', value: m.content ? cut(m.content, 1000) : '*(não disponível ou só anexo)*' });
    if (files) e.addFields({ name: 'Anexos', value: cut(files, 500) });
    await post(m.guild, 'messageDelete', e, m.channelId);
  });

  client.on('messageUpdate', async (a, b) => {
    if (!b.guild || b.author?.bot || a.content === b.content || a.content == null || b.content == null) return;
    const e = new EmbedBuilder().setColor(COLORS.blue).setTitle('✏️ Mensagem editada')
      .setDescription('[Ir para a mensagem](' + b.url + ')')
      .addFields(
        { name: 'Autor', value: who(b.author), inline: true },
        { name: 'Canal', value: '<#' + b.channelId + '>', inline: true },
        { name: 'Antes', value: cut(a.content, 1000) || '*(vazio)*' },
        { name: 'Depois', value: cut(b.content, 1000) || '*(vazio)*' });
    await post(b.guild, 'messageEdit', e, b.channelId);
  });

  client.on('guildMemberAdd', async (m) => {
    const e = new EmbedBuilder().setColor(COLORS.green).setTitle('📥 Membro entrou')
      .setThumbnail(m.user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: 'Membro', value: who(m.user), inline: true },
        { name: 'Conta criada', value: ts(m.user.createdAt), inline: true },
        { name: 'Total de membros', value: String(m.guild.memberCount), inline: true });
    await post(m.guild, 'memberJoin', e);
  });

  client.on('guildMemberRemove', async (m) => {
    const roles = m.roles?.cache ? m.roles.cache.filter((r) => r.id !== m.guild.id).map((r) => '<@&' + r.id + '>').join(' ') : '';
    const e = new EmbedBuilder().setColor(COLORS.gray).setTitle('📤 Membro saiu')
      .setThumbnail(m.user.displayAvatarURL({ size: 128 }))
      .addFields({ name: 'Membro', value: who(m.user), inline: true });
    if (m.joinedAt) e.addFields({ name: 'Estava desde', value: ts(m.joinedAt), inline: true });
    if (roles) e.addFields({ name: 'Cargos', value: cut(roles, 1000) });
    await post(m.guild, 'memberLeave', e);
  });

  client.on('guildMemberUpdate', async (a, b) => {
    if (b.user.bot) return;
    if (a.partial) return;
    const added = b.roles.cache.filter((r) => !a.roles.cache.has(r.id));
    const removed = a.roles.cache.filter((r) => !b.roles.cache.has(r.id));
    if (added.size || removed.size) {
      const e = new EmbedBuilder().setColor(COLORS.blue).setTitle('🏷️ Cargos alterados').addFields({ name: 'Membro', value: who(b.user) });
      if (added.size) e.addFields({ name: '➕ Recebeu', value: cut(added.map((r) => '<@&' + r.id + '>').join(' '), 1000) });
      if (removed.size) e.addFields({ name: '➖ Perdeu', value: cut(removed.map((r) => '<@&' + r.id + '>').join(' '), 1000) });
      await post(b.guild, 'roleChange', e);
    }
    if (a.nickname !== b.nickname) {
      const e = new EmbedBuilder().setColor(COLORS.blue).setTitle('📝 Apelido alterado')
        .addFields(
          { name: 'Membro', value: who(b.user) },
          { name: 'Antes', value: a.nickname || '*(nenhum)*', inline: true },
          { name: 'Depois', value: b.nickname || '*(nenhum)*', inline: true });
      await post(b.guild, 'nickChange', e);
    }
  });

  client.on('guildBanAdd', async (ban) => {
    await post(ban.guild, 'ban', new EmbedBuilder().setColor(COLORS.red).setTitle('⛔ Membro banido')
      .addFields({ name: 'Membro', value: who(ban.user), inline: true }, { name: 'Motivo', value: cut(ban.reason || 'Não informado', 500), inline: true }));
  });
  client.on('guildBanRemove', async (ban) => {
    await post(ban.guild, 'ban', new EmbedBuilder().setColor(COLORS.green).setTitle('✅ Banimento removido').addFields({ name: 'Membro', value: who(ban.user) }));
  });

  client.on('channelCreate', async (c) => {
    if (!c.guild || String(c.topic || '').startsWith('ticket:')) return;
    await post(c.guild, 'channel', new EmbedBuilder().setColor(COLORS.green).setTitle('➕ Canal criado').setDescription('#' + c.name + ' (' + c.id + ')'));
  });
  client.on('channelDelete', async (c) => {
    if (!c.guild || String(c.topic || '').startsWith('ticket:')) return;
    await post(c.guild, 'channel', new EmbedBuilder().setColor(COLORS.red).setTitle('➖ Canal apagado').setDescription('#' + c.name));
  });
}

module.exports = { attach, logMod };
