const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder, REST, Routes, MessageFlags,
} = require('discord.js');
const crypto = require('crypto');

const cfgs = require('./config');
const db = require('./db');
const { renderCard, renderRank } = require('./card');
const { translate, LANGS, FLAGS, baseLang } = require('./translate');
const { JOKES, FACTS, QUIZ, EIGHT_BALL } = require('./content');

const EPHEMERAL = MessageFlags.Ephemeral;
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
});

/* ----------------------------- utilidades ----------------------------- */

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const avatarOf = (user) => user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
const nameOf = (member, user) => member?.displayName || user.globalName || user.username;
const log = (...a) => console.log('[bot]', ...a);
const warn = (where, e) => console.error(`[bot] erro em ${where}:`, e?.message || e);

function fmt(tpl, v) {
  const user = v.user || v.member?.user;
  return String(tpl || '').replace(/\{(user|username|displayname|server|count|id|args|channel|level)\}/gi, (_, k) => {
    switch (k.toLowerCase()) {
      case 'user': return user ? `<@${user.id}>` : '';
      case 'username': return user?.username ?? '';
      case 'displayname': return nameOf(v.member, user);
      case 'server': return v.guild.name;
      case 'count': return String(v.guild.memberCount);
      case 'id': return user?.id ?? '';
      case 'args': return v.args ?? '';
      case 'channel': return v.channel ? `<#${v.channel.id}>` : '';
      case 'level': return String(v.level ?? '');
      default: return '';
    }
  });
}

function matches(text, trigger, mode) {
  const t = text.toLowerCase().trim();
  const k = trigger.toLowerCase();
  if (mode === 'exact') return t === k;
  if (mode === 'startswith') return t.startsWith(k);
  if (mode === 'contains') return t.includes(k);
  return new RegExp(`(^|[^\\p{L}\\p{N}])\( {escapeRe(k)}( \)|[^\\p{L}\\p{N}])`, 'iu').test(t);
}

const cooldowns = new Map();
function onCooldown(key, ms) {
  const now = Date.now();
  if ((cooldowns.get(key) || 0) > now) return true;
  cooldowns.set(key, now + ms);
  if (cooldowns.size > 5000) for (const [k, v] of cooldowns) if (v < now) cooldowns.delete(k);
  return false;
}

/* ------------------------- níveis / XP ------------------------- */

const xpForLevel = (l) => 5 * l * l + 50 * l + 100;
function levelInfo(totalXp) {
  let level = 0;
  let rest = totalXp;
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, current: rest, needed: xpForLevel(level) };
}

async function applyRewards(guild, member, level, cfg) {
  const eligible = cfg.rewards.filter((r) => r.level <= level && guild.roles.cache.has(r.roleId)).sort((a, b) => a.level - b.level);
  if (!eligible.length) return;
  const give = cfg.stackRewards ? eligible : [eligible[eligible.length - 1]];
  const remove = cfg.stackRewards ? [] : eligible.slice(0, -1);
  await member.roles.add(give.map((r) => r.roleId), 'Recompensa de nível').catch((e) => warn('recompensa', e));
  if (remove.length) await member.roles.remove(remove.map((r) => r.roleId), 'Recompensa de nível').catch(() => {});
}

async function giveXp(guild, member, amount, channel) {
  const cfg = cfgs.getConfig(guild.id).levels;
  if (!cfg.enabled || amount <= 0) return;
  const u = db.getUser(guild.id, member.id);
  const before = levelInfo(u.xp).level;
  u.xp += amount;
  db.save();
  const after = levelInfo(u.xp).level;
  if (after <= before) return;

  await applyRewards(guild, member, after, cfg);
  if (cfg.announce === 'off') return;
  let target = channel;
  if (cfg.announce === 'channel' && cfg.channelId) {
    target = (await guild.channels.fetch(cfg.channelId).catch(() => null)) || channel;
  }
  if (!target?.isTextBased()) return;
  const text = fmt(cfg.message, { member, guild, level: after });
  if (text) await target.send({ content: text, allowedMentions: { users: [member.id] } }).catch((e) => warn('anúncio de nível', e));
}

/* ----------------------- boas-vindas / saída ----------------------- */

async function sendCard(kind, guild, who, opts = {}) {
  const cfg = cfgs.getConfig(guild.id)[kind];
  const user = who.user || who;
  const member = who.user ? who : null;
  const channel = cfg.channelId ? await guild.channels.fetch(cfg.channelId).catch(() => null) : null;
  if (!channel || !channel.isTextBased()) throw new Error('Escolha um canal válido (que o bot consiga ver) para essa mensagem.');

  const payload = {
    content: fmt(cfg.message, { member, user, guild }) || undefined,
    allowedMentions: kind === 'welcome' ? { users: [user.id], roles: [] } : { parse: [] },
  };
  if (cfg.useImage) {
    const buf = await renderCard({
      ...cfg,
      kind,
      name: nameOf(member, user),
      avatarUrl: avatarOf(user),
    });
    payload.files = [new AttachmentBuilder(buf, { name: `${kind}.png` })];
  }
  if (!payload.content && !payload.files) payload.content = user.username;
  return channel.send(payload);
}

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const cfg = cfgs.getConfig(member.guild.id).welcome;
    if (cfg.autoRoleIds.length) {
      const ids = cfg.autoRoleIds.filter((id) => member.guild.roles.cache.has(id));
      if (ids.length) await member.roles.add(ids, 'Cargo automático de boas-vindas').catch((e) => warn('cargo automático', e));
    }
    if (cfg.enabled) await sendCard('welcome', member.guild, member).catch((e) => warn('boas-vindas', e));
    if (cfg.dmEnabled && !member.user.bot) {
      const text = fmt(cfg.dmMessage, { member, guild: member.guild });
      if (text) await member.send(text).catch(() => {});
    }
  } catch (e) {
    warn('GuildMemberAdd', e);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const cfg = cfgs.getConfig(member.guild.id).leave;
    if (cfg.enabled) await sendCard('leave', member.guild, member).catch((e) => warn('saída', e));
  } catch (e) {
    warn('GuildMemberRemove', e);
  }
});

/* ------------------------- painéis de cargos ------------------------- */

const STYLE = { 1: ButtonStyle.Primary, 2: ButtonStyle.Secondary, 3: ButtonStyle.Success, 4: ButtonStyle.Danger };

function buildPanelPayload(guild, panel) {
  const buttons = panel.buttons.map((b) => {
    const role = guild.roles.cache.get(b.roleId);
    const btn = new ButtonBuilder().setCustomId(`rp:\( {panel.id}: \){b.roleId}`).setStyle(STYLE[b.style] || Button
