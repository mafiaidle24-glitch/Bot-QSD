// Pontos semanais da gangue (Idle Mafia): a líder posta os prints da tela "Minha Gangue" no canal de
// pontos, a IA lê nome/cargo/pontos de cada membro e o bot mantém uma imagem de ranking atualizada.
// A semana vai de domingo 21h até sábado 20h59 (horário de Brasília/Fortaleza, UTC-3).
const { AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const cfgs = require('./config');
const db = require('./db');
const coaching = require('./coaching');
const rankimg = require('./rankimg');

const OFFSET = -3 * 3600e3;
const MAX_IMG = 6 * 1024 * 1024;
const KEEP_WEEKS = 12;
const DAILY_READS = 40;
const warn = (where, e) => console.error('[pontos] erro em ' + where + ':', e?.message || e);

const PROMPT = `Esta é uma captura de tela do jogo Idle Mafia. Pode ser a tela "Minha Gangue" (lista de membros com "Contribuição Semanal") ou a tela "Hall da Gangue".
Para a lista de membros, devolva cada membro visível com: "name" (nome exatamente como aparece), "role" (Chefe, Sub-Chefe, Gangster, Picciotto...), "points" (número inteiro ANTES da barra em "N/2740"), "max" (número depois da barra), "lastSeen" (texto como "5d atrás" ou "48m atrás"; escreva "online" se houver bolinha verde) e "rank" (número no canto direito).
Se (e somente se) o texto "Tempo de Atualização Semanal de Contribuição da Gangue" estiver visível na imagem, devolva "resetIn" com o tempo que aparece depois dos dois pontos; caso contrário devolva "resetIn": "".
Se for a tela Hall da Gangue, devolva também "gang": {"level": número do "Nível", "exp": "1.974M", "expMax": "4M"}.
Responda SOMENTE com JSON: {"members":[{"name":"","role":"","points":0,"max":0,"lastSeen":"","rank":0}],"resetIn":"","gang":{"level":0,"exp":"","expMax":""}}
Se a imagem não for nenhuma dessas telas, responda {"members":[]}. Não invente valores.`;

const store = (gid) => {
  const s = (db.data.pontos[gid] ??= {});
  s.weeks ??= {};
  return s;
};
const clean = (v, n) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const nk = (name) => clean(name, 40).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

/* ------------------------------ Semana ------------------------------ */
// chave da semana = data (YYYY-MM-DD) do domingo em que ela começou (às 21h)
function weekKey(t) {
  const d = new Date(t + OFFSET - 21 * 3600e3);
  const sun = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()));
  return sun.toISOString().slice(0, 10);
}
function parseReset(s) {
  const t = String(s || '');
  const d = /(\d+)\s*d/i.exec(t), h = /(\d+)\s*h/i.exec(t), m = /(\d+)\s*m(?!s)/i.exec(t);
  if (!d && !h && !m) return null;
  return ((d ? +d[1] : 0) * 86400 + (h ? +h[1] : 0) * 3600 + (m ? +m[1] : 0) * 60) * 1000;
}
const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
function weekLabel(key) {
  const start = Date.parse(key + 'T00:00:00Z');
  const end = new Date(start + 6 * 86400e3).toISOString().slice(0, 10);
  return dm(key) + ' a ' + dm(end);
}

function week(gid, key) {
  const s = store(gid);
  const w = (s.weeks[key] ??= { members: {}, gang: null, updated: 0 });
  w.members ??= {};
  const keys = Object.keys(s.weeks).sort();
  while (keys.length > KEEP_WEEKS) delete s.weeks[keys.shift()];
  return w;
}

/* ------------------------------ Dados ------------------------------ */
function ingest(gid, parsed, atMs) {
  const list = Array.isArray(parsed?.members) ? parsed.members : [];
  const key = weekKey(atMs); // pela hora da mensagem (o "resetIn" lido pela IA já veio errado antes)
  const w = week(gid, key);
  for (const k of Object.keys(store(gid).weeks)) if (k > key) delete store(gid).weeks[k]; // semana do futuro = leitura errada
  let n = 0;
  for (const r of list.slice(0, 60)) {
    const name = clean(r?.name, 40);
    const raw = String(r?.points ?? '').replace(/[.,\s]/g, '');
    if (!name || !/^\d{1,6}$/.test(raw)) continue;
    const pts = Number(raw);
    if (pts > 100000) continue;
    const max = Math.floor(Number(r?.max)) || 2740;
    w.members[nk(name)] = { name, role: clean(r?.role, 20), points: pts, max, lastSeen: clean(r?.lastSeen, 20), at: atMs };
    n++;
  }
  const g = parsed?.gang;
  if (g && Number(g.level) > 0) w.gang = { level: Math.floor(Number(g.level)), exp: clean(g.exp, 12), expMax: clean(g.expMax, 12) };
  w.updated = atMs;
  db.save();
  return { key, count: n };
}
function setMember(gid, key, nkey, name, points) {
  const w = week(gid, key);
  const old = w.members[nkey];
  const p = Math.max(0, Math.min(100000, Math.floor(Number(points)) || 0));
  w.members[nkey] = { ...(old || { role: '', max: 2740, lastSeen: '' }), name: clean(name || old?.name || nkey, 40), points: p, at: Date.now(), edited: true };
  db.save();
}
function removeMember(gid, key, nkey) { delete week(gid, key).members[nkey]; db.save(); }

function listWeek(gid, key) {
  const w = store(gid).weeks[key];
  const rows = Object.entries(w?.members || {}).map(([id, m]) => ({ id, ...m }));
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return { key, label: weekLabel(key), rows, gang: w?.gang || null, total: rows.reduce((s, r) => s + r.points, 0), zero: rows.filter((r) => r.points === 0).length };
}
function weeks(gid) {
  const s = store(gid);
  return Object.keys(s.weeks).sort().reverse().map((k) => {
    const l = listWeek(gid, k);
    return { key: k, label: l.label, count: l.rows.length, total: l.total, top: l.rows.slice(0, 3).map((r) => r.name + ' (' + r.points + ')') };
  });
}

/* ------------------------------ Imagem ------------------------------ */
const UNIT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
function amount(v) { // "1.974M" -> 1974000 (o ponto é separador de milhar ou decimal; o jogo usa ponto)
  const m = /^\s*([\d.,]+)\s*([KMBT]?)/i.exec(String(v || ''));
  if (!m) return 0;
  return (Number(m[1].replace(',', '.')) || 0) * (UNIT[m[2].toUpperCase()] || 1);
}
function ratio(g) {
  const a = amount(g.exp), b = amount(g.expMax);
  return a > 0 && b > 0 ? Math.min(1, a / b) : -1;
}
function imageOpts(gid, key, guildName) {
  const cfg = cfgs.getConfig(gid);
  const c = cfg.pontos;
  const l = listWeek(gid, key);
  const now = new Date(Date.now() + OFFSET);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    title: 'RANKING SEMANAL',
    subtitle: (guildName ? guildName + ' · ' : '') + 'Semana ' + l.label,
    color: c.color,
    rows: l.rows.map((r) => ({ name: r.name, role: r.role, points: r.points, max: r.max })),
    max: 2740, goal: c.goal,
    gang: l.gang ? { ...l.gang, ratio: ratio(l.gang) } : null,
    summary: l.rows.length + ' membros · total ' + l.total + ' pontos · ' + l.zero + ' sem pontos',
    footer: 'Atualizado em ' + pad(now.getUTCDate()) + '/' + pad(now.getUTCMonth() + 1) + ' ' + pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + (c.goal > 0 ? ' · Meta mínima: ' + c.goal + ' pontos (em laranja quem está abaixo)' : ''),
  };
}

async function publish(client, gid, key = weekKey(Date.now()), { create = true } = {}) {
  const cfg = cfgs.getConfig(gid);
  const c = cfg.pontos;
  const chId = c.rankChannelId || c.channelId;
  if (!c.enabled || !chId) return null;
  const guild = client.guilds.cache.get(gid);
  const ch = guild && (await guild.channels.fetch(chId).catch(() => null));
  if (!ch || !ch.isTextBased()) return null;
  const l = listWeek(gid, key);
  if (!l.rows.length) return null;
  const buf = rankimg.render(imageOpts(gid, key, guild?.name));
  const payload = { content: '🏆 **Ranking semanal** — ' + l.label, files: [new AttachmentBuilder(buf, { name: 'ranking-semanal.png' })], attachments: [] };
  let msg = c.rankMessageId ? await ch.messages.fetch(c.rankMessageId).catch(() => null) : null;
  if (msg && msg.author.id !== client.user.id) msg = null;
  if (msg) { await msg.edit(payload); return msg; }
  if (!create) return null;
  const { attachments, ...send } = payload;
  msg = await ch.send(send);
  cfgs.setPontosMessage(gid, msg.id);
  await msg.pin().catch(() => {});
  return msg;
}

/* ------------------------------ Eventos ------------------------------ */
const isImage = (a) => /^image\//i.test(a.contentType || '') || /\.(png|jpe?g|webp)(\?|$)/i.test(a.url || a.name || '');
const noKeyWarned = new Set();
const reads = new Map(); // gid -> { day, n }

async function readOne(att) {
  if (att.size && att.size > MAX_IMG) throw new Error('Imagem muito grande (máx. 6 MB).');
  const r = await fetch(att.url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error('Não consegui baixar a imagem.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_IMG) throw new Error('Imagem muito grande (máx. 6 MB).');
  const mime = /^image\/(png|jpe?g|webp)$/i.test(att.contentType || '') ? att.contentType.split(';')[0] : 'image/png';
  return coaching.gemini(buf.toString('base64'), mime, PROMPT);
}

const isLeader = (member) => !!member && (member.permissions?.has(PermissionFlagsBits.ManageGuild) || false);

async function handleMessage(msg) {
  if (!msg.guild || msg.author?.bot) return;
  const gid = msg.guild.id;
  const c = cfgs.getConfig(gid).pontos;
  if (!c.enabled || !c.channelId || msg.channel.id !== c.channelId) return;
  const imgs = [...msg.attachments.values()].filter(isImage).slice(0, 10);
  if (!imgs.length) return;
  if (!isLeader(msg.member)) return; // só a liderança alimenta o ranking
  if (!process.env.GEMINI_API_KEY) {
    if (!noKeyWarned.has(gid)) { noKeyWarned.add(gid); await msg.reply('⚠️ A leitura por IA ainda não está ligada: o dono do bot precisa colocar a chave `GEMINI_API_KEY` na hospedagem.').catch(() => {}); }
    return;
  }
  const day = new Date(Date.now() + OFFSET).toISOString().slice(0, 10);
  const rd = reads.get(gid) && reads.get(gid).day === day ? reads.get(gid) : { day, n: 0 };
  reads.set(gid, rd);
  if (rd.n + imgs.length > DAILY_READS) { await msg.reply('⏳ Limite de leituras de hoje atingido. Tente amanhã ou corrija pelo painel.').catch(() => {}); return; }
  await msg.react('⏳').catch(() => {});
  let total = 0, ok = 0, key = '';
  const errs = [], failed = [];
  let idx = 0;
  for (const att of imgs) {
    idx++;
    rd.n++;
    try {
      const j = await readOne(att);
      const r = ingest(gid, j, msg.createdTimestamp || Date.now());
      if (r.count > 0 || j.gang) { ok++; total += r.count; key = r.key; } else { errs.push((imgs.length > 1 ? 'imagem ' + idx + ' de ' + imgs.length + ': ' : '') + 'não é a tela "Minha Gangue"'); failed.push(idx); }
    } catch (e) { errs.push((imgs.length > 1 ? 'imagem ' + idx + ' de ' + imgs.length + ': ' : '') + (e.message === 'NO_KEY' ? 'sem chave da IA' : /aborted|timeout/i.test(e.message) ? 'a IA demorou demais para responder' : e.message.replace(/[.!?]\s*$/, '')) ); failed.push(idx); }
  }
  msg.reactions?.cache?.get('⏳')?.users.remove(msg.client.user.id).catch(() => {});
  if (ok > 0) {
    await msg.react('✅').catch(() => {});
    await msg.reply('✅ Li **' + total + '** membro(s) (semana ' + weekLabel(key) + ').' + ' O ranking foi atualizado.' + (errs.length ? '\n⚠️ Não consegui ler: ' + errs.join('; ') + '. Reenvie só ' + (failed.length > 1 ? 'essas imagens' : 'essa imagem') + '.' : '')).catch(() => {});
    publish(msg.client, gid, key).catch((e) => warn('ranking', e));
  } else {
    await msg.react('❌').catch(() => {});
    await msg.reply('❌ ' + ((errs[0] || 'Não consegui ler nada.').replace(/[.!?]?\s*$/, '.')) + ' Envie o print da tela **Minha Gangue**, inteiro e sem cortes.').catch(() => {});
  }
}

module.exports = { handleMessage, publish, ingest, weekKey, parseReset, weekLabel, listWeek, weeks, setMember, removeMember, PROMPT };
