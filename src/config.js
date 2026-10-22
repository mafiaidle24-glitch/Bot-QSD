// Configuração por servidor: valores padrão, validação e cache.
const crypto = require('crypto');
const db = require('./db');

const ID = /^\d{15,25}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const LANG = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/;

const str = (v, max, def = '') => (typeof v === 'string' ? v.slice(0, max) : def);
const bool = (v, def = false) => (typeof v === 'boolean' ? v : def);
const int = (v, min, max, def) => {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
};
const flt = (v, min, max, def) => {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
};
const sid = (v) => (typeof v === 'string' && ID.test(v) ? v : '');
const col = (v, def) => (typeof v === 'string' && HEX.test(v) ? v : def);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const idList = (v, max) => [...new Set(arr(v, max).map(sid).filter(Boolean))];
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const url = (v) => {
  if (typeof v !== 'string' || !v) return '';
  try {
    const u = new URL(v.trim());
    return /^https?:$/.test(u.protocol) && v.length <= 500 ? u.toString() : '';
  } catch {
    return '';
  }
};

function defaults() {
  return {
    welcome: {
      enabled: false,
      channelId: '',
      message:
        'Bem-vindo {user} ao servidor **{server}**! Fique à vontade para tirar suas dúvidas. 🤙👊\nVocê é o membro número **{count}**.',
      useImage: true,
      bgUrl: '',
      title: 'BEM-VINDO(A)',
      subtitle: 'ESTOU À DISPOSIÇÃO, DIVIRTA-SE!',
      accent: '#e8a33d',
      titleColor: '#b9a3e3',
      nameColor: '#7fe0c3',
      subtitleColor: '#d98b5f',
      dmEnabled: false,
      dmMessage: 'Olá {username}! Seja muito bem-vindo(a) ao **{server}**. 👋',
      autoRoleIds: [],
    },
    leave: {
      enabled: false,
      channelId: '',
      message: '**{username}** saiu do servidor. 😢 Agora somos {count} membros.',
      useImage: true,
      bgUrl: '',
      title: 'ATÉ LOGO!',
      subtitle: 'SENTIREMOS SUA FALTA',
      accent: '#c0392b',
      titleColor: '#f0a0a0',
      nameColor: '#ffffff',
      subtitleColor: '#d0d0d0',
    },
    panels: [],
    levels: {
      enabled: true,
      xpMin: 15,
      xpMax: 25,
      cooldown: 60,
      multiplier: 1,
      announce: 'channel', // 'same' | 'channel' | 'off'
      channelId: '',
      message: '🎉 {user} subiu para o **nível {level}**!',
      ignoredChannels: [],
      ignoredRoles: [],
      rewards: [],
      stackRewards: true,
    },
    commands: { prefix: '!', list: [] },
    interaction: {
      mentionReply: true,
      mentionReplies: ['Oi {user}! Precisa de algo? 👋', 'Estou por aqui! Use `/rank`, `/quiz` ou `/piada`. 😎'],
      triggers: [],
      reactions: [],
    },
    translate: { enabled: false, flagReactions: true, channels: [] },
    games: { enabled: true, channelId: '', rewardXp: 25 },
  };
}

function sanitizeCard(x, d, welcome) {
  x = x && typeof x === 'object' ? x : {};
  const o = {
    enabled: bool(x.enabled, d.enabled),
    channelId: sid(x.channelId),
    message: str(x.message, 2000, d.message),
    useImage: bool(x.useImage, d.useImage),
    bgUrl: url(x.bgUrl),
    title: str(x.title, 40, d.title),
    subtitle: str(x.subtitle, 70, d.subtitle),
    accent: col(x.accent, d.accent),
    titleColor: col(x.titleColor, d.titleColor),
    nameColor: col(x.nameColor, d.nameColor),
    subtitleColor: col(x.subtitleColor, d.subtitleColor),
  };
  if (welcome) {
    o.dmEnabled = bool(x.dmEnabled, d.dmEnabled);
    o.dmMessage = str(x.dmMessage, 2000, d.dmMessage);
    o.autoRoleIds = idList(x.autoRoleIds, 10);
  }
  return o;
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function sanitize(input, old) {
  const d = defaults();
  const i = input && typeof input === 'object' ? input : {};
  const oldPanels = new Map((old?.panels || []).map((p) => [p.id, p]));

  const out = {};
  out.welcome = sanitizeCard(i.welcome, d.welcome, true);
  out.leave = sanitizeCard(i.leave, d.leave, false);

  // Painéis de cargos (botões)
  out.panels = arr(i.panels, 20).map((p) => {
    p = p && typeof p === 'object' ? p : {};
    const id = typeof p.id === 'string' && /^[a-z0-9]{4,12}$/.test(p.id) ? p.id : newId();
    const seen = new Set();
    const buttons = [];
    for (const b of arr(p.buttons, 25)) {
      const roleId = sid(b?.roleId);
      if (!roleId || seen.has(roleId)) continue;
      seen.add(roleId);
      buttons.push({
        roleId,
        label: str(b.label, 80),
        emoji: str(b.emoji, 64).trim(),
        style: int(b.style, 1, 4, 2),
      });
    }
    return {
      id,
      name: str(p.name, 60, 'Painel'),
      channelId: sid(p.channelId),
      messageId: oldPanels.get(id)?.messageId || '',
      useEmbed: bool(p.useEmbed, true),
      title: str(p.title, 256),
      content: str(p.content, 2000),
      color: col(p.color, '#5865f2'),
      mode: oneOf(p.mode, ['toggle', 'single'], 'toggle'),
      buttons,
    };
  });

  // Níveis
  const l = i.levels && typeof i.levels === 'object' ? i.levels : {};
  const xpMin = int(l.xpMin, 1, 500, d.levels.xpMin);
  out.levels = {
    enabled: bool(l.enabled, d.levels.enabled),
    xpMin,
    xpMax: Math.max(xpMin, int(l.xpMax, 1, 1000, d.levels.xpMax)),
    cooldown: int(l.cooldown, 0, 3600, d.levels.cooldown),
    multiplier: flt(l.multiplier, 0.1, 10, 1),
    announce: oneOf(l.announce, ['same', 'channel', 'off'], d.levels.announce),
    channelId: sid(l.channelId),
    message: str(l.message, 500, d.levels.message),
    ignoredChannels: idList(l.ignoredChannels, 50),
    ignoredRoles: idList(l.ignoredRoles, 25),
    stackRewards: bool(l.stackRewards, true),
    rewards: arr(l.rewards, 30)
      .map((r) => ({ level: int(r?.level, 1, 1000, 0), roleId: sid(r?.roleId) }))
      .filter((r) => r.level > 0 && r.roleId),
  };

  // Comandos personalizados
  const c = i.commands && typeof i.commands === 'object' ? i.commands : {};
  const names = new Set();
  out.commands = {
    prefix: str(c.prefix, 3, d.commands.prefix).trim(),
    list: arr(c.list, 100)
      .map((x) => ({
        name: str(x?.name, 32).toLowerCase().replace(/\s+/g, ''),
        aliases: arr(x?.aliases, 10)
          .map((a) => str(a, 32).toLowerCase().replace(/\s+/g, ''))
          .filter(Boolean),
        response: str(x?.response, 2000),
        embed: bool(x?.embed, false),
        color: col(x?.color, '#5865f2'),
      }))
      .filter((x) => {
        if (!x.name || !x.response || names.has(x.name)) return false;
        names.add(x.name);
        return true;
      }),
  };

  // Interação
  const t = i.interaction && typeof i.interaction === 'object' ? i.interaction : {};
  const MATCH = ['word', 'contains', 'exact', 'startswith'];
  out.interaction = {
    mentionReply: bool(t.mentionReply, true),
    mentionReplies: arr(t.mentionReplies, 20).map((s) => str(s, 500)).filter(Boolean),
    triggers: arr(t.triggers, 100)
      .map((x) => ({
        trigger: str(x?.trigger, 100).trim(),
        match: oneOf(x?.match, MATCH, 'word'),
        reply: str(x?.reply, 2000),
        asReply: bool(x?.asReply, true),
      }))
      .filter((x) => x.trigger && x.reply),
    reactions: arr(t.reactions, 100)
      .map((x) => ({
        trigger: str(x?.trigger, 100).trim(),
        match: oneOf(x?.match, MATCH, 'word'),
        emoji: str(x?.emoji, 64).trim(),
      }))
      .filter((x) => x.trigger && x.emoji),
  };

  // Tradução
  const tr = i.translate && typeof i.translate === 'object' ? i.translate : {};
  out.translate = {
    enabled: bool(tr.enabled, false),
    flagReactions: bool(tr.flagReactions, true),
    channels: arr(tr.channels, 25)
      .map((x) => ({
        channelId: sid(x?.channelId),
        targets: [...new Set(arr(x?.targets, 3).filter((s) => typeof s === 'string' && LANG.test(s)))],
      }))
      .filter((x) => x.channelId && x.targets.length),
  };

  // Jogos
  const g = i.games && typeof i.games === 'object' ? i.games : {};
  out.games = {
    enabled: bool(g.enabled, true),
    channelId: sid(g.channelId),
    rewardXp: int(g.rewardXp, 0, 1000, d.games.rewardXp),
  };

  return out;
}

const cache = new Map();

function getConfig(guildId) {
  let c = cache.get(guildId);
  if (!c) {
    c = sanitize(db.data.guilds[guildId] || {}, db.data.guilds[guildId]);
    cache.set(guildId, c);
  }
  return c;
}

function setConfig(guildId, input) {
  const clean = sanitize(input, getConfig(guildId));
  db.data.guilds[guildId] = clean;
  cache.set(guildId, clean);
  db.save();
  return clean;
}

/** Valida um rascunho sem salvar (usado na prévia). */
function validate(guildId, input) {
  return sanitize(input, getConfig(guildId));
}

function setPanelMessage(guildId, panelId, messageId) {
  const cfg = getConfig(guildId);
  const p = cfg.panels.find((x) => x.id === panelId);
  if (!p) return;
  p.messageId = messageId;
  db.data.guilds[guildId] = cfg;
  db.save();
}

module.exports = { defaults, getConfig, setConfig, validate, setPanelMessage, newId };
