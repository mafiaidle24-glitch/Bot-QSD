// Configuração por servidor: valores padrão, validação e cache.
const crypto = require('crypto');
const db = require('./db');
const premium = require('./premium');

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

// Imagem: link http(s) ou arquivo enviado pelo painel ("up:<id>.png").
const img = (v) => (typeof v === 'string' && /^up:[a-f0-9]{12}\.(png|jpg|gif|webp)$/.test(v) ? v : url(v));

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
    messages: [],
    autoroles: { memberRoleIds: [], botRoleIds: [] },
    identity: { nick: '', avatar: '', banner: '', bio: '' },
    moderation: {
      staffRoleIds: [],
      dmUser: true,
      autoPunish: { threshold: 3, action: 'timeout', minutes: 60 },
      automod: {
        enabled: false,
        action: 'warn', // 'delete' = só apaga | 'warn' = apaga e dá um aviso
        notice: true,
        spam: { enabled: true, max: 5, seconds: 6 },
        invites: { enabled: true },
        links: { enabled: false, allowed: ['tenor.com', 'giphy.com', 'youtube.com', 'youtu.be', 'discordapp.com', 'discordapp.net'] },
        words: { enabled: false, list: [] },
        exemptRoleIds: [],
        exemptUserIds: [],
        ignoredChannelIds: [],
      },
    },
    logs: {
      enabled: false,
      channelId: '',
      ignoreChannelIds: [],
      events: { messageDelete: true, messageEdit: true, memberJoin: true, memberLeave: true, roleChange: true, nickChange: true, ban: true, channel: true, mod: true },
    },
    tickets: {
      enabled: false,
      categoryId: '',
      staffRoleIds: [],
      logChannelId: '',
      maxPerUser: 1,
      pingStaff: true,
      transcript: true,
      userCanClose: true,
      naming: 'type-user', // 'type-user' | 'number'
      counter: 0,
      panel: {
        channelId: '',
        messageId: '',
        title: 'Central de Atendimento',
        description: 'Precisa de ajuda?\nClique em um botão abaixo para abrir um **ticket** privado com a equipe.',
        color: '#5865f2',
        types: [{ id: 'suporte', label: 'Suporte', emoji: '🎫', style: 1, welcome: 'Olá {user}! Explique o motivo do seu contato. A equipe vai te responder em breve.' }],
      },
    },
    wiki: {
      channels: [], // [{ channelId, rarities: [] }]  (rarities vazio = todas)
      who: 'owner', // 'owner' | 'roles' | 'everyone'
      roleIds: [],
      deleteCommand: true,
      listChannelId: '',
      listMessageIds: [],
      intro: '',
      color: '#3aa0ff',
      rarities: [{ name: 'Mythical', emoji: '' }, { name: 'Legendary', emoji: '' }, { name: 'Epic', emoji: '' }, { name: 'Rare', emoji: '' }],
      entries: [],
    },
    levels: {
      enabled: true,
      xpMin: 15,
      xpMax: 25,
      cooldown: 60,
      multiplier: 1,
      announce: 'channel', // 'same' | 'channel' | 'off'
      announceStyle: 'text', // 'text' | 'card'
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

function sanitizeEmbed(e) {
  e = e && typeof e === 'object' ? e : {};
  return {
    title: str(e.title, 256),
    url: url(e.url),
    description: str(e.description, 4000),
    color: col(e.color, '#5865f2'),
    authorName: str(e.authorName, 256),
    authorIcon: img(e.authorIcon),
    authorUrl: url(e.authorUrl),
    thumbnail: img(e.thumbnail),
    image: img(e.image),
    footerText: str(e.footerText, 2048),
    footerIcon: img(e.footerIcon),
    timestamp: bool(e.timestamp, false),
    fields: arr(e.fields, 25)
      .map((f) => ({ name: str(f?.name, 256), value: str(f?.value, 1024), inline: bool(f?.inline, false) }))
      .filter((f) => f.name && f.value),
  };
}

function sanitizeContainer(c) {
  c = c && typeof c === 'object' ? c : {};
  const items = [];
  for (const x of arr(c.items, 25)) {
    if (!x || typeof x !== 'object') continue;
    if (x.type === 'text') items.push({ type: 'text', content: str(x.content, 2000) });
    else if (x.type === 'section') items.push({ type: 'section', content: str(x.content, 2000), image: img(x.image), desc: str(x.desc, 256) });
    else if (x.type === 'gallery') {
      items.push({
        type: 'gallery',
        images: arr(x.images, 10).map((g) => ({ src: img(g?.src), desc: str(g?.desc, 256) })).filter((g) => g.src),
      });
    } else if (x.type === 'separator') items.push({ type: 'separator', divider: bool(x.divider, true), large: bool(x.large, false) });
  }
  return {
    color: typeof c.color === 'string' && HEX.test(c.color) ? c.color : '',
    spoiler: bool(c.spoiler, false),
    items,
  };
}

const LOG_EVENTS = ['messageDelete', 'messageEdit', 'memberJoin', 'memberLeave', 'roleChange', 'nickChange', 'ban', 'channel', 'mod'];
function sanitizeLogs(l) {
  l = l && typeof l === 'object' ? l : {};
  const ev = l.events && typeof l.events === 'object' ? l.events : {};
  const events = {};
  for (const k of LOG_EVENTS) events[k] = bool(ev[k], true);
  return { enabled: bool(l.enabled, false), channelId: sid(l.channelId), ignoreChannelIds: idList(l.ignoreChannelIds, 50), events };
}
function domains(v, max) {
  return arr(v, max).map((x) => String(x || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').slice(0, 80)).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x));
}
function sanitizeModeration(m) {
  m = m && typeof m === 'object' ? m : {};
  const ap = m.autoPunish && typeof m.autoPunish === 'object' ? m.autoPunish : {};
  const a = m.automod && typeof m.automod === 'object' ? m.automod : {};
  const sp = a.spam && typeof a.spam === 'object' ? a.spam : {};
  const inv = a.invites && typeof a.invites === 'object' ? a.invites : {};
  const li = a.links && typeof a.links === 'object' ? a.links : {};
  const wo = a.words && typeof a.words === 'object' ? a.words : {};
  const d = defaults().moderation.automod;
  return {
    staffRoleIds: idList(m.staffRoleIds, 10),
    dmUser: bool(m.dmUser, true),
    autoPunish: {
      threshold: int(ap.threshold, 1, 20, 3),
      action: oneOf(ap.action, ['none', 'timeout', 'kick', 'ban'], 'timeout'),
      minutes: int(ap.minutes, 1, 40320, 60),
    },
    automod: {
      enabled: bool(a.enabled, false),
      action: oneOf(a.action, ['delete', 'warn'], 'warn'),
      notice: bool(a.notice, true),
      spam: { enabled: bool(sp.enabled, true), max: int(sp.max, 3, 20, 5), seconds: int(sp.seconds, 2, 60, 6) },
      invites: { enabled: bool(inv.enabled, true) },
      links: { enabled: bool(li.enabled, false), allowed: li.allowed === undefined ? d.links.allowed.slice() : domains(li.allowed, 50) },
      words: { enabled: bool(wo.enabled, false), list: arr(wo.list, 200).map((x) => String(x || '').toLowerCase().trim().slice(0, 40)).filter(Boolean) },
      exemptRoleIds: idList(a.exemptRoleIds, 20),
      exemptUserIds: idList(a.exemptUserIds, 20),
      ignoredChannelIds: idList(a.ignoredChannelIds, 50),
    },
  };
}
function sanitizeAutoroles(a) {
  a = a && typeof a === 'object' ? a : {};
  return { memberRoleIds: idList(a.memberRoleIds, 10), botRoleIds: idList(a.botRoleIds, 10) };
}

// Identidade do bot neste servidor (só imagens enviadas pelo painel).
function sanitizeIdentity(x) {
  x = x && typeof x === 'object' ? x : {};
  const up = (v) => (typeof v === 'string' && /^up:[a-f0-9]{12}\.(png|jpg|gif|webp)$/.test(v) ? v : '');
  return { nick: str(x.nick, 32).trim(), avatar: up(x.avatar), banner: up(x.banner), bio: str(x.bio, 190).trim() };
}

// Tickets: atendimento privado por canal.
function sanitizeTickets(t, old) {
  t = t && typeof t === 'object' ? t : {};
  const d = defaults().tickets;
  const p = t.panel && typeof t.panel === 'object' ? t.panel : {};
  const usedIds = new Set();
  let types = arr(p.types, 10).map((x) => {
    x = x && typeof x === 'object' ? x : {};
    let id = typeof x.id === 'string' && /^[a-z0-9]{3,12}$/.test(x.id) ? x.id : newId();
    while (usedIds.has(id)) id = newId();
    usedIds.add(id);
    return {
      id,
      label: str(x.label, 80, 'Ticket').trim() || 'Ticket',
      emoji: str(x.emoji, 64).trim(),
      style: int(x.style, 1, 4, 1),
      welcome: str(x.welcome, 1500, d.panel.types[0].welcome),
    };
  });
  if (!types.length) types = d.panel.types.map((x) => ({ ...x }));
  return {
    enabled: bool(t.enabled, false),
    categoryId: sid(t.categoryId),
    staffRoleIds: idList(t.staffRoleIds, 10),
    logChannelId: sid(t.logChannelId),
    maxPerUser: int(t.maxPerUser, 1, 5, 1),
    pingStaff: bool(t.pingStaff, true),
    transcript: bool(t.transcript, true),
    userCanClose: bool(t.userCanClose, true),
    naming: oneOf(t.naming, ['type-user', 'number'], 'type-user'),
    counter: int(old?.tickets?.counter, 0, 100000000, 0),
    panel: {
      channelId: sid(p.channelId),
      messageId: typeof old?.tickets?.panel?.messageId === 'string' ? old.tickets.panel.messageId : '',
      title: str(p.title, 256, d.panel.title),
      description: str(p.description, 4000, d.panel.description),
      color: col(p.color, d.panel.color),
      types,
    },
  };
}

// Wiki de personagens: comandos como !ateu que respondem com imagens.
function sanitizeWiki(w, old) {
  w = w && typeof w === 'object' ? w : {};
  const rarities = arr(w.rarities, 10)
    .map((r) => ({ name: str(r?.name, 30).trim(), emoji: str(r?.emoji, 64).trim() }))
    .filter((r) => r.name);
  const rar = rarities.length ? rarities : defaults().wiki.rarities;
  const rarNames = rar.map((r) => r.name);
  const clean = (s) => str(s, 32).toLowerCase().replace(/\s+/g, '').replace(/^[^\p{L}\p{N}_-]+/u, '');
  const used = new Set();
  const usedIds = new Set();
  const entries = [];
  for (const e of arr(w.entries, 300)) {
    if (!e || typeof e !== 'object') continue;
    const name = clean(e.name);
    if (!name || used.has(name)) continue;
    used.add(name);
    const aliases = [];
    for (const a of arr(e.aliases, 10).map(clean)) {
      if (!a || used.has(a)) continue;
      used.add(a);
      aliases.push(a);
    }
    let id = typeof e.id === 'string' && /^[a-z0-9]{4,12}$/.test(e.id) ? e.id : newId();
    while (usedIds.has(id)) id = newId();
    usedIds.add(id);
    entries.push({
      id,
      name,
      aliases,
      rarity: oneOf(e.rarity, rarNames, rarNames[0]),
      text: str(e.text, 1500),
      images: arr(e.images, 4).map(img).filter(Boolean),
    });
  }
  const channels = [];
  const seenCh = new Set();
  for (const c of arr(w.channels, 20)) {
    const id = sid(c?.channelId);
    if (!id || seenCh.has(id)) continue;
    seenCh.add(id);
    channels.push({ channelId: id, rarities: [...new Set(arr(c.rarities, 10).filter((n) => rarNames.includes(n)))] });
  }
  for (const id of [...idList(w.channelIds, 20), sid(w.channelId)]) { // versões antigas
    if (id && !seenCh.has(id)) { seenCh.add(id); channels.push({ channelId: id, rarities: [] }); }
  }
  return {
    channels,
    who: oneOf(w.who, ['owner', 'roles', 'everyone'], 'owner'),
    roleIds: idList(w.roleIds, 10),
    deleteCommand: bool(w.deleteCommand, true),
    listChannelId: sid(w.listChannelId),
    listMessageIds: idList(old?.wiki?.listMessageIds, 20),
    intro: str(w.intro, 1500),
    color: col(w.color, '#3aa0ff'),
    rarities: rar,
    entries,
  };
}

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function sanitize(input, old) {
  const d = defaults();
  const i = input && typeof input === 'object' ? input : {};
  const oldPanels = new Map((old?.panels || []).map((p) => [p.id, p]));
  const oldMsgs = new Map((old?.messages || []).map((m) => [m.id, m]));

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

  // Mensagens com embed (construtor)
  const usedMsgIds = new Set();
  out.messages = arr(i.messages, 50).map((m) => {
    m = m && typeof m === 'object' ? m : {};
    let id = typeof m.id === 'string' && /^[a-z0-9]{4,12}$/.test(m.id) ? m.id : newId();
    while (usedMsgIds.has(id)) id = newId();
    usedMsgIds.add(id);
    return {
      id,
      name: str(m.name, 60, 'Mensagem'),
      channelId: sid(m.channelId),
      messageId: oldMsgs.get(id)?.messageId || '',
      content: str(m.content, 2000),
      pingRoles: bool(m.pingRoles, false),
      layout: oneOf(m.layout, ['embed', 'container'], 'embed'),
      container: sanitizeContainer(m.container),
      embeds: arr(m.embeds, 10).map(sanitizeEmbed),
    };
  });

  out.wiki = sanitizeWiki(i.wiki, old);
  out.tickets = sanitizeTickets(i.tickets, old);
  out.logs = sanitizeLogs(i.logs);
  out.autoroles = sanitizeAutoroles(i.autoroles);
  out.identity = sanitizeIdentity(i.identity);
  out.moderation = sanitizeModeration(i.moderation);

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
    announceStyle: oneOf(l.announceStyle, ['text', 'card'], 'text'),
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

/** Aplica os limites do plano grátis. Devolve avisos do que foi cortado. */
function applyLimits(guildId, clean) {
  const pk = premium.perks(guildId);
  const notes = [];
  const types = clean.tickets?.panel?.types;
  if (types && types.length > pk.ticketTypes) { types.length = pk.ticketTypes; notes.push('Tickets: o plano grátis permite ' + pk.ticketTypes + ' tipos (os extras não foram salvos).'); }
  const words = clean.moderation?.automod?.words?.list;
  if (words && words.length > pk.words) { words.length = pk.words; notes.push('Automod: o plano grátis permite ' + pk.words + ' palavras proibidas (as extras não foram salvas).'); }
  const cap = (list, n, what) => { if (Array.isArray(list) && list.length > n) { list.length = n; notes.push(what + ': o plano grátis permite ' + n + ' (os extras não foram salvos).'); } };
  for (const p of clean.panels || []) cap(p.buttons, pk.panelButtons, 'Painel de cargos "' + (p.name || p.title || 'sem nome') + '" botões');
  cap(clean.commands?.list, pk.customCommands, 'Comandos personalizados');
  cap(clean.interaction?.triggers, pk.triggers, 'Respostas automáticas');
  cap(clean.interaction?.reactions, pk.reactions, 'Reações automáticas');
  if (clean.levels && clean.levels.announceStyle === 'card' && !pk.levelCard) { clean.levels.announceStyle = 'text'; notes.push('O cartão no aviso de nível é um recurso Premium.'); }
  return notes;
}

function setConfig(guildId, input) {
  const clean = sanitize(input, getConfig(guildId));
  setConfig.notes = applyLimits(guildId, clean);
  db.data.guilds[guildId] = clean;
  cache.set(guildId, clean);
  db.save();
  return clean;
}

/** Valida um rascunho sem salvar (usado na prévia). */
function validate(guildId, input) {
  return sanitize(input, getConfig(guildId));
}

function setMessageRef(guildId, id, messageId) {
  const cfg = getConfig(guildId);
  const m = cfg.messages.find((x) => x.id === id);
  if (!m) return;
  m.messageId = messageId;
  db.data.guilds[guildId] = cfg;
  db.save();
}

function setTicketPanelMessage(guildId, messageId) {
  const cfg = getConfig(guildId);
  cfg.tickets.panel.messageId = String(messageId || '');
  db.data.guilds[guildId] = cfg;
  db.save();
}

/** Próximo número de ticket do servidor (1, 2, 3...). */
function nextTicketNumber(guildId) {
  const cfg = getConfig(guildId);
  cfg.tickets.counter += 1;
  db.data.guilds[guildId] = cfg;
  db.save();
  return cfg.tickets.counter;
}

function setWikiListIds(guildId, ids) {
  const cfg = getConfig(guildId);
  cfg.wiki.listMessageIds = idList(ids, 20);
  db.data.guilds[guildId] = cfg;
  db.save();
}

function setPanelMessage(guildId, panelId, messageId) {
  const cfg = getConfig(guildId);
  const p = cfg.panels.find((x) => x.id === panelId);
  if (!p) return;
  p.messageId = messageId;
  db.data.guilds[guildId] = cfg;
  db.save();
}

module.exports = { defaults, getConfig, setConfig, validate, setPanelMessage, setMessageRef, setWikiListIds, setTicketPanelMessage, nextTicketNumber, newId };
