// Alertas de YouTube (vídeo novo), Twitch e Kick (live começou).
// YouTube: feed RSS público (sem chave). Twitch: API oficial se houver TWITCH_CLIENT_ID/SECRET, senão decapi.me.
// Kick: API oficial se houver KICK_CLIENT_ID/SECRET, senão o endereço público (pode ser bloqueado pela Kick).
const cfgs = require('./config');
const db = require('./db');

const UA = 'Mozilla/5.0 (compatible; BotQSD/1.0; +https://discord.gg/zGPGHEJUMJ)';
const warnOnce = new Set();
const warn = (where, e) => {
  const k = where + ':' + (e?.message || e);
  if (warnOnce.has(k)) return;
  warnOnce.add(k);
  console.error('[alertas] erro em ' + where + ':', e?.message || e);
};

async function http(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8', ...(opts.headers || {}) }, signal: AbortSignal.timeout(12_000) });
  return r;
}
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

/* ------------------------------ YouTube ------------------------------ */
const refCache = new Map();
async function ytChannelId(target) {
  const t = String(target || '').trim();
  let m = /(UC[\w-]{22})/.exec(t);
  if (m) return m[1];
  let url;
  if (/^https?:\/\//i.test(t)) url = t;
  else if (/^@?[\w.-]+$/.test(t)) url = 'https://www.youtube.com/' + (t.startsWith('@') ? t : '@' + t);
  else throw new Error('Não entendi esse canal do YouTube. Cole o link do canal ou o @nome.');
  if (!/^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i.test(url)) throw new Error('O link precisa ser do YouTube.');
  if (refCache.has(url)) return refCache.get(url);
  const r = await http(url, { headers: { Cookie: 'CONSENT=YES+1; SOCS=CAI' } });
  if (!r.ok) throw new Error('Canal do YouTube não encontrado (' + r.status + ').');
  const html = await r.text();
  m = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)
    || /"externalId":"(UC[\w-]{22})"/.exec(html) || /"channelId":"(UC[\w-]{22})"/.exec(html) || /channel_id=(UC[\w-]{22})/.exec(html);
  if (!m) throw new Error('Não consegui achar o ID desse canal. Tente colar o link no formato youtube.com/channel/UC…');
  refCache.set(url, m[1]);
  return m[1];
}

async function ytFeed(channelId) {
  const r = await http('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
  if (!r.ok) throw new Error('YouTube respondeu ' + r.status);
  const xml = await r.text();
  const author = decode((/<author>\s*<name>([^<]*)<\/name>/.exec(xml) || [])[1]);
  const videos = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = (/<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e) || [])[1];
    if (!id) continue;
    videos.push({
      id,
      title: decode((/<title>([^<]*)<\/title>/.exec(e) || [])[1]),
      published: Date.parse((/<published>([^<]+)<\/published>/.exec(e) || [])[1]) || 0,
      url: 'https://www.youtube.com/watch?v=' + id,
    });
  }
  return { author, videos };
}

/* ------------------------------ Twitch ------------------------------ */
const twLogin = (t) => {
  const m = /twitch\.tv\/([\w]{2,25})/i.exec(String(t)) || /^@?([\w]{2,25})$/.exec(String(t).trim());
  if (!m) throw new Error('Não entendi esse canal da Twitch. Cole o link ou o nome do canal.');
  return m[1].toLowerCase();
};
let twTok = { v: '', exp: 0 };
async function twToken() {
  if (twTok.v && Date.now() < twTok.exp) return twTok.v;
  const body = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' });
  const r = await http('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Chaves da Twitch inválidas.');
  twTok = { v: j.access_token, exp: Date.now() + (j.expires_in - 600) * 1000 };
  return twTok.v;
}
/** → { live, id, title, name, game } */
async function twStatus(target) {
  const login = twLogin(target);
  if (process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET) {
    const r = await http('https://api.twitch.tv/helix/streams?user_login=' + login, { headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: 'Bearer ' + (await twToken()) } });
    if (r.status === 401) twTok = { v: '', exp: 0 };
    if (!r.ok) throw new Error('Twitch respondeu ' + r.status);
    const s = ((await r.json()).data || [])[0];
    return s ? { live: true, id: s.id, title: s.title, name: s.user_name, game: s.game_name, url: 'https://www.twitch.tv/' + login }
      : { live: false, name: login, url: 'https://www.twitch.tv/' + login };
  }
  const up = await http('https://decapi.me/twitch/uptime/' + login);
  const txt = (await up.text()).trim();
  if (!up.ok) throw new Error('Serviço da Twitch indisponível (' + up.status + ').');
  if (/not found|does not exist|no user/i.test(txt)) throw new Error('Canal da Twitch não encontrado.');
  if (/offline/i.test(txt)) return { live: false, name: login, url: 'https://www.twitch.tv/' + login };
  let title = '';
  try { title = (await (await http('https://decapi.me/twitch/title/' + login)).text()).trim(); } catch { /* sem título */ }
  return { live: true, id: 'tw-' + login, title, name: login, url: 'https://www.twitch.tv/' + login };
}

/* ------------------------------ Kick ------------------------------ */
const kickSlug = (t) => {
  const m = /kick\.com\/([\w-]{2,40})/i.exec(String(t)) || /^@?([\w-]{2,40})$/.exec(String(t).trim());
  if (!m) throw new Error('Não entendi esse canal da Kick. Cole o link ou o nome do canal.');
  return m[1].toLowerCase();
};
let kickTok = { v: '', exp: 0 };
async function kickToken() {
  if (kickTok.v && Date.now() < kickTok.exp) return kickTok.v;
  const body = new URLSearchParams({ client_id: process.env.KICK_CLIENT_ID, client_secret: process.env.KICK_CLIENT_SECRET, grant_type: 'client_credentials' });
  const r = await http('https://id.kick.com/oauth/token', { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Chaves da Kick inválidas.');
  kickTok = { v: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 600) * 1000 };
  return kickTok.v;
}
async function kickStatus(target) {
  const slug = kickSlug(target);
  const url = 'https://kick.com/' + slug;
  if (process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET) {
    const r = await http('https://api.kick.com/public/v1/channels?slug=' + slug, { headers: { Authorization: 'Bearer ' + (await kickToken()) } });
    if (r.status === 401) kickTok = { v: '', exp: 0 };
    if (!r.ok) throw new Error('Kick respondeu ' + r.status);
    const c = ((await r.json()).data || [])[0];
    if (!c) throw new Error('Canal da Kick não encontrado.');
    const live = !!(c.stream && c.stream.is_live);
    return { live, id: live ? 'kick-' + slug + '-' + (c.stream.start_time || '') : '', title: c.stream_title || '', name: c.slug || slug, game: c.category?.name || '', url };
  }
  const r = await http('https://kick.com/api/v2/channels/' + slug, { headers: { Accept: 'application/json' } });
  if (r.status === 404) throw new Error('Canal da Kick não encontrado.');
  if (!r.ok) throw new Error('A Kick bloqueou a consulta (' + r.status + '). Para a Kick funcionar de forma estável, configure KICK_CLIENT_ID e KICK_CLIENT_SECRET.');
  let j;
  try { j = await r.json(); } catch { throw new Error('A Kick não respondeu direito. Configure KICK_CLIENT_ID e KICK_CLIENT_SECRET.'); }
  const ls = j.livestream;
  return { live: !!ls, id: ls ? 'kick-' + slug + '-' + (ls.id || ls.created_at || '') : '', title: ls?.session_title || '', name: j.user?.username || slug, game: ls?.categories?.[0]?.name || '', url };
}

/* ------------------------------ Envio ------------------------------ */
function render(item, v) {
  const role = item.roleId ? '<@&' + item.roleId + '>' : '';
  let text = item.message
    .replace(/\{name\}/gi, v.name || item.name || '').replace(/\{title\}/gi, v.title || '')
    .replace(/\{url\}/gi, v.url || '').replace(/\{game\}/gi, v.game || '')
    .replace(/\{platform\}/gi, { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick' }[item.platform]);
  if (/\{role\}/i.test(text)) text = text.replace(/\{role\}/gi, role);
  else if (role) text = role + ' ' + text;
  if (v.url && !text.includes(v.url)) text += '\n' + v.url;
  return text.replace(/\n{3,}/g, '\n\n').slice(0, 1990);
}
async function send(client, guildId, item, v, prefix = '') {
  const guild = client.guilds.cache.get(guildId);
  const ch = guild && (await guild.channels.fetch(item.channelId).catch(() => null));
  if (!ch || !ch.isTextBased()) throw new Error('Canal de aviso não encontrado ou sem acesso.');
  await ch.send({ content: prefix + render(item, v), allowedMentions: { roles: item.roleId ? [item.roleId] : [], users: [] } });
}

/* ------------------------------ Ciclo ------------------------------ */
const stateOf = (gid, id) => {
  const g = (db.data.alerts[gid] ??= {});
  return (g[id] ??= {});
};

async function check(client, gid, item) {
  const st = stateOf(gid, item.id);
  if (st.target !== item.target || st.platform !== item.platform) { for (const k of Object.keys(st)) delete st[k]; st.target = item.target; st.platform = item.platform; }
  if (item.platform === 'youtube') {
    st.ref ||= await ytChannelId(item.target);
    const { author, videos } = await ytFeed(st.ref);
    const seen = new Set(st.seen || []);
    if (!st.init) { // primeira vez: só memoriza o que já existe
      st.seen = videos.map((x) => x.id).slice(0, 40); st.init = true; db.save(); return;
    }
    const fresh = videos.filter((x) => !seen.has(x.id) && Date.now() - x.published < 3 * 86400_000).reverse().slice(-3);
    for (const x of fresh) await send(client, gid, item, { name: item.name || author, title: x.title, url: x.url });
    st.seen = [...new Set([...videos.map((x) => x.id), ...(st.seen || [])])].slice(0, 40);
    db.save();
    return;
  }
  const s = item.platform === 'twitch' ? await twStatus(item.target) : await kickStatus(item.target);
  if (!st.init) { st.init = true; st.live = s.live; st.sid = s.id || ''; st.off = 0; db.save(); return; }
  if (s.live) {
    st.off = 0;
    if (!st.live || (s.id && st.sid && s.id !== st.sid && !s.id.startsWith('tw-'))) {
      st.live = true; st.sid = s.id || '';
      db.save();
      await send(client, gid, item, { name: item.name || s.name, title: s.title, game: s.game, url: s.url });
    }
  } else if (st.live) {
    st.off = (st.off || 0) + 1; // só considera "acabou" depois de 2 checagens (evita aviso repetido se a live cair um minuto)
    if (st.off >= 2) { st.live = false; st.sid = ''; st.off = 0; }
    db.save();
  }
}

let running = false;
async function tick(client) {
  if (running) return;
  running = true;
  try {
    for (const g of client.guilds.cache.values()) {
      const cfg = cfgs.getConfig(g.id);
      if (!cfg.alerts.enabled) continue;
      for (const item of cfg.alerts.items) {
        if (!item.target || !item.channelId) continue;
        try { await check(client, g.id, item); } catch (e) { warn(item.platform + ' ' + item.target, e); }
      }
    }
  } finally { running = false; }
}

/** Botão "Testar" do painel: confere o canal e manda um aviso de teste. */
async function test(client, gid, itemId) {
  const item = cfgs.getConfig(gid).alerts.items.find((x) => x.id === itemId);
  if (!item) throw new Error('Alerta não encontrado. Salve as alterações primeiro.');
  if (!item.target) throw new Error('Preencha o canal/link.');
  if (!item.channelId) throw new Error('Escolha o canal do Discord onde o aviso será enviado.');
  let v;
  if (item.platform === 'youtube') {
    const id = await ytChannelId(item.target);
    const { author, videos } = await ytFeed(id);
    const x = videos[0];
    v = { name: item.name || author, title: x ? x.title : 'Título do vídeo', url: x ? x.url : 'https://www.youtube.com/channel/' + id };
  } else {
    const s = item.platform === 'twitch' ? await twStatus(item.target) : await kickStatus(item.target);
    v = { name: item.name || s.name, title: s.title || 'Título da live', game: s.game, url: s.url };
  }
  await send(client, gid, item, v, '🧪 **Teste do alerta** (assim vai aparecer):\n');
  return { found: v.name };
}

module.exports = { tick, test, ytChannelId, ytFeed, twStatus, kickStatus, render };
