// Moderação: avisos, silenciar, expulsar, banir + automod (spam, convites, links, palavras proibidas).
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const cfgs = require('./config');
const db = require('./db');
const logs = require('./logs');
const premium = require('./premium');

const EPHEMERAL = MessageFlags.Ephemeral;
const warn = (where, e) => console.error('[moderacao] erro em ' + where + ':', e?.message || e);
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const commands = [
  new SlashCommandBuilder().setName('avisar').setDescription('Dá um aviso a um membro (equipe)')
    .addUserOption((o) => o.setName('membro').setDescription('Quem vai receber').setRequired(true))
    .addStringOption((o) => o.setName('motivo').setDescription('Motivo do aviso').setRequired(true).setMaxLength(300)),
  new SlashCommandBuilder().setName('avisos').setDescription('Mostra os avisos de um membro (equipe)')
    .addUserOption((o) => o.setName('membro').setDescription('Membro').setRequired(true)),
  new SlashCommandBuilder().setName('limparavisos').setDescription('Apaga todos os avisos de um membro (equipe)')
    .addUserOption((o) => o.setName('membro').setDescription('Membro').setRequired(true)),
  new SlashCommandBuilder().setName('silenciar').setDescription('Deixa um membro sem falar por um tempo (equipe)')
    .addUserOption((o) => o.setName('membro').setDescription('Membro').setRequired(true))
    .addIntegerOption((o) => o.setName('minutos').setDescription('Por quantos minutos (máx. 40320 = 28 dias)').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setMaxLength(300)),
  new SlashCommandBuilder().setName('tirarsilencio').setDescription('Remove o silêncio de um membro (equipe)')
    .addUserOption((o) => o.setName('membro').setDescription('Membro').setRequired(true)),
  new SlashCommandBuilder().setName('expulsar').setDescription('Expulsa um membro do servidor (equipe)')
    .addUserOption((o) => o.setName('membro').setDescription('Membro').setRequired(true))
    .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setMaxLength(300)),
  new SlashCommandBuilder().setName('banir').setDescription('Bane um membro do servidor (equipe)')
    .addUserOption((o) => o.setName('membro').setDescription('Membro').setRequired(true))
    .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setMaxLength(300)),
  new SlashCommandBuilder().setName('desbanir').setDescription('Remove o banimento de alguém (equipe)')
    .addStringOption((o) => o.setName('id').setDescription('ID do usuário banido').setRequired(true).setMaxLength(25)),
];
const NAMES = new Set(commands.map((c) => c.name));

/* ---------- quem é equipe / quem é isento ---------- */
function isStaff(member, guild, cfg) {
  if (!member) return false;
  if (guild.ownerId === member.id) return true;
  if (premium.isBotOwner(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return cfg.staffRoleIds.some((id) => member.roles.cache.has(id));
}

function isExempt(member, guild, mod) {
  if (isStaff(member, guild, mod)) return true;
  const a = mod.automod;
  if (a.exemptUserIds.includes(member.id)) return true;
  return a.exemptRoleIds.some((id) => member.roles.cache.has(id));
}

/* ---------- avisos (guardados no db.json) ---------- */
function warnsOf(guildId, userId) {
  const g = (db.data.warns[guildId] ??= {});
  return (g[userId] ??= []);
}

async function dm(user, guild, text) {
  try { await user.send('**' + guild.name + '**: ' + text); } catch { /* DM fechada */ }
}

/** Confere se quem pune pode punir o alvo (hierarquia) e se o bot consegue. */
function check(i, target, kind) {
  if (!target) return 'Esse membro não está no servidor.';
  if (target.id === i.user.id) return 'Você não pode fazer isso com você mesmo.';
  if (target.id === i.client.user.id) return 'Não posso fazer isso comigo.';
  if (target.id === i.guild.ownerId) return 'Não dá para punir o dono do servidor.';
  const modHigh = i.member.roles.highest.position;
  if (i.guild.ownerId !== i.user.id && target.roles.highest.position >= modHigh) return 'Esse membro tem um cargo igual ou acima do seu.';
  const ok = kind === 'kick' ? target.kickable : kind === 'ban' ? target.bannable : target.moderatable;
  if (!ok) return 'Não consigo punir esse membro: o cargo dele está acima do meu ou me falta permissão. Dê ao bot as permissões de moderação e coloque o cargo dele acima.';
  return '';
}

/** Dá um aviso e aplica a punição automática se atingiu o limite. Devolve texto de resumo. */
async function addWarn(guild, user, byId, reason, mod) {
  const list = warnsOf(guild.id, user.id);
  list.push({ id: Date.now().toString(36), by: byId, reason: cut(reason, 300), at: Date.now() });
  if (list.length > 50) list.shift();
  db.save();
  const total = list.length;
  logs.logMod(guild, { action: 'Aviso', target: user, moderator: { id: byId, username: byId === guild.client.user.id ? 'Automod' : undefined }, reason, extra: 'Total de avisos: ' + total });
  if (mod.dmUser) await dm(user, guild, 'você recebeu um aviso. Motivo: ' + reason + ' (avisos: ' + total + ')');

  const ap = mod.autoPunish;
  let punished = '';
  if (ap.action !== 'none' && total % ap.threshold === 0) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    const why = 'Atingiu ' + total + ' avisos';
    try {
      if (member && ap.action === 'timeout' && member.moderatable) { await member.timeout(ap.minutes * 60000, why); punished = 'silenciado por ' + ap.minutes + ' min'; }
      else if (member && ap.action === 'kick' && member.kickable) { await member.kick(why); punished = 'expulso'; }
      else if (ap.action === 'ban' && (!member || member.bannable)) { await guild.members.ban(user.id, { reason: why }); punished = 'banido'; }
    } catch (e) { warn('punição automática', e); }
    if (punished) {
      logs.logMod(guild, { action: 'Punição automática', target: user, moderator: { id: guild.client.user.id, username: 'Automod' }, reason: why, extra: 'Resultado: ' + punished });
      if (mod.dmUser && ap.action !== 'ban') await dm(user, guild, 'por acumular avisos você foi ' + punished + '.');
    }
  }
  return { total, punished };
}

/* ---------- comandos ---------- */
async function handleSlash(i, cfgAll) {
  if (!NAMES.has(i.commandName)) return false;
  if (!premium.perks(i.guild.id).moderation) {
    await i.reply({ content: premium.LOCK_MSG, flags: EPHEMERAL });
    return true;
  }
  const mod = cfgAll.moderation;
  if (!isStaff(i.member, i.guild, mod)) {
    await i.reply({ content: 'Só a equipe de moderação pode usar este comando.', flags: EPHEMERAL });
    return true;
  }
  const user = i.options.getUser('membro');
  const reason = i.options.getString('motivo') || 'Não informado';
  const target = user ? await i.guild.members.fetch(user.id).catch(() => null) : null;
  const done = (t) => i.reply({ content: t, flags: EPHEMERAL, allowedMentions: { parse: [] } });
  const bad = (kind) => { const m = check(i, target, kind); return m ? done('⚠️ ' + m) : null; };

  switch (i.commandName) {
    case 'avisar': {
      const b = bad('moderate'); if (b) { await b; return true; }
      const r = await addWarn(i.guild, user, i.user.id, reason, mod);
      await done('⚠️ Aviso dado a <@' + user.id + '> (total: ' + r.total + ')' + (r.punished ? ' — ' + r.punished + ' automaticamente.' : '.'));
      return true;
    }
    case 'avisos': {
      const list = warnsOf(i.guild.id, user.id);
      if (!list.length) { await done('<@' + user.id + '> não tem avisos. ✅'); return true; }
      const lines = list.slice(-15).map((w, n) => (list.length > 15 ? list.length - 15 + n + 1 : n + 1) + '. <t:' + Math.floor(w.at / 1000) + ':d> — ' + w.reason + ' (por <@' + w.by + '>)');
      await i.reply({ embeds: [new EmbedBuilder().setColor(0xf0b232).setTitle('Avisos de ' + user.username + ' (' + list.length + ')').setDescription(cut(lines.join('\n'), 4000))], flags: EPHEMERAL, allowedMentions: { parse: [] } });
      return true;
    }
    case 'limparavisos': {
      const n = warnsOf(i.guild.id, user.id).length;
      db.data.warns[i.guild.id][user.id] = [];
      db.save();
      logs.logMod(i.guild, { action: 'Avisos limpos', target: user, moderator: i.user, reason: 'Limpou ' + n + ' aviso(s)' });
      await done('🧹 ' + n + ' aviso(s) de <@' + user.id + '> apagado(s).');
      return true;
    }
    case 'silenciar': {
      const b = bad('moderate'); if (b) { await b; return true; }
      const min = i.options.getInteger('minutos');
      await target.timeout(min * 60000, reason);
      logs.logMod(i.guild, { action: 'Silenciado', target: user, moderator: i.user, reason, extra: min + ' minuto(s)' });
      if (mod.dmUser) await dm(user, i.guild, 'você foi silenciado por ' + min + ' min. Motivo: ' + reason);
      await done('🔇 <@' + user.id + '> silenciado por ' + min + ' min.');
      return true;
    }
    case 'tirarsilencio': {
      const b = bad('moderate'); if (b) { await b; return true; }
      await target.timeout(null, 'Silêncio removido por ' + i.user.tag);
      logs.logMod(i.guild, { action: 'Silêncio removido', target: user, moderator: i.user, reason: 'Removido pela equipe' });
      await done('🔊 Silêncio de <@' + user.id + '> removido.');
      return true;
    }
    case 'expulsar': {
      const b = bad('kick'); if (b) { await b; return true; }
      if (mod.dmUser) await dm(user, i.guild, 'você foi expulso. Motivo: ' + reason);
      await target.kick(reason + ' (por ' + i.user.tag + ')');
      logs.logMod(i.guild, { action: 'Expulso', target: user, moderator: i.user, reason });
      await done('👢 <@' + user.id + '> expulso.');
      return true;
    }
    case 'banir': {
      if (target) { const b = bad('ban'); if (b) { await b; return true; } }
      if (mod.dmUser) await dm(user, i.guild, 'você foi banido. Motivo: ' + reason);
      await i.guild.members.ban(user.id, { reason: reason + ' (por ' + i.user.tag + ')' });
      logs.logMod(i.guild, { action: 'Banido', target: user, moderator: i.user, reason });
      await done('⛔ <@' + user.id + '> banido.');
      return true;
    }
    case 'desbanir': {
      const id = (i.options.getString('id') || '').trim();
      if (!/^\d{15,25}$/.test(id)) { await done('⚠️ Informe o ID numérico do usuário banido.'); return true; }
      const ok = await i.guild.members.unban(id, 'Por ' + i.user.tag).then(() => true).catch(() => false);
      if (ok) logs.logMod(i.guild, { action: 'Desbanido', target: { id }, moderator: i.user, reason: 'Removido pela equipe' });
      await done(ok ? '✅ Banimento removido.' : '⚠️ Não achei esse usuário na lista de banidos.');
      return true;
    }
  }
  return false;
}

/* ---------- automod ---------- */
const recent = new Map(); // guild:user -> [{ t, id, ch }]
const wordCache = new Map();
const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite|discord\.com\/invite)\/[a-z0-9-]+/i;
const LINK = /\bhttps?:\/\/[^\s<>]+|\bwww\.[^\s<>]+/gi;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function wordRegex(list) {
  const key = list.join('|');
  let re = wordCache.get(key);
  if (!re) {
    const esc = list.map((w) => norm(w).replace(/[.*+?^$|()[\]{}\\]/g, '\\$&')).filter(Boolean);
    re = esc.length ? new RegExp('(?:^|[^a-z0-9])(?:' + esc.join('|') + ')(?:$|[^a-z0-9])', 'i') : null;
    wordCache.set(key, re);
    if (wordCache.size > 20) wordCache.delete(wordCache.keys().next().value);
  }
  return re;
}

function hostOf(link) {
  try { return new URL(link.startsWith('http') ? link : 'https://' + link).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function violation(msg, a) {
  const text = msg.content || '';
  if (a.invites.enabled && INVITE.test(text)) return 'convite de outro servidor';
  if (a.links.enabled) {
    const found = text.match(LINK) || [];
    for (const l of found) {
      const h = hostOf(l);
      if (h && !a.links.allowed.some((d) => h === d || h.endsWith('.' + d))) return 'link não permitido';
    }
  }
  if (a.words.enabled && a.words.list.length) {
    const re = wordRegex(a.words.list);
    if (re && re.test(' ' + norm(text) + ' ')) return 'palavra proibida';
  }
  return '';
}

async function punish(msg, why, mod, extraIds) {
  const a = mod.automod;
  const ids = [msg.id, ...(extraIds || [])];
  try {
    if (ids.length > 1) await msg.channel.bulkDelete(ids, true);
    else await msg.delete();
  } catch { await msg.delete().catch(() => {}); }
  if (a.notice) {
    const note = await msg.channel.send({ content: '<@' + msg.author.id + '>, sua mensagem foi removida pelo automod (' + why + ').', allowedMentions: { users: [msg.author.id] } }).catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => {}), 6000);
  }
  if (a.action === 'warn') await addWarn(msg.guild, msg.author, msg.client.user.id, 'Automod: ' + why, mod);
  else logs.logMod(msg.guild, { action: 'Automod', target: msg.author, moderator: { id: msg.client.user.id, username: 'Automod' }, reason: 'Apagou mensagem: ' + why });
}

/** Devolve true se a mensagem foi apagada pelo automod. */
async function automod(msg, cfgAll) {
  const mod = cfgAll.moderation;
  const a = mod.automod;
  if (!a.enabled || !msg.member || msg.author.bot || !premium.perks(msg.guild.id).moderation) return false;
  if (a.ignoredChannelIds.includes(msg.channelId)) return false;
  if (isExempt(msg.member, msg.guild, mod)) return false;

  const why = violation(msg, a);
  if (why) { await punish(msg, why, mod); return true; }

  if (a.spam.enabled) {
    const key = msg.guildId + ':' + msg.author.id;
    const now = Date.now();
    const list = (recent.get(key) || []).filter((x) => now - x.t < a.spam.seconds * 1000);
    list.push({ t: now, id: msg.id, ch: msg.channelId });
    recent.set(key, list);
    if (recent.size > 2000) recent.delete(recent.keys().next().value);
    if (list.length >= a.spam.max) {
      recent.delete(key);
      const extra = list.filter((x) => x.ch === msg.channelId && x.id !== msg.id).map((x) => x.id);
      await punish(msg, 'spam', mod, extra);
      return true;
    }
  }
  return false;
}

module.exports = { commands, handleSlash, automod };
