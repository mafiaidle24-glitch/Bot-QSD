// Guerra de gangues (Idle Mafia): os membros marcam a defesa (0 a 4 times) e o andamento dos 9 prédios
// (#1..#9) por botões no canal do anúncio; a líder vê a tabela completa (e corrige tudo) no canal de
// análise e no painel. Pontos da defesa: cada time posicionado vale 25 (5 de base x multiplicador 5).
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const cfgs = require('./config');
const db = require('./db');

const EPHEMERAL = MessageFlags.Ephemeral;
const PTS_TEAM = 25;
const MAX_REMAIN = 250;
const warn = (where, e) => console.error('[guerra] erro em ' + where + ':', e?.message || e);

const store = (gid) => {
  const g = (db.data.guerra[gid] ??= {});
  g.members ??= {}; g.buildings ??= {}; g.log ??= []; g.round ??= 1; g.gameTeams ??= null;
  return g;
};
const clean = (v, n) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

/* ------------------------------ Dados ------------------------------ */
function setDef(gid, uid, name, n, opts = {}) {
  n = Math.max(0, Math.min(4, Math.floor(Number(n)) || 0));
  const g = store(gid);
  const m = (g.members[uid] ??= { name: clean(name, 40) || uid, def: null, at: 0 });
  if (name) m.name = clean(name, 40) || m.name;
  m.def = n; m.at = Date.now();
  if (opts.edited) m.editedAt = Date.now();
  db.save();
  return m;
}
function setBuilding(gid, n, remaining, uid, name, opts = {}) {
  n = Math.floor(Number(n));
  if (!(n >= 1 && n <= 9)) throw new Error('Prédio inválido.');
  const g = store(gid);
  if (remaining === null || remaining === '' || remaining === undefined) { delete g.buildings[n]; db.save(); return null; }
  const r = Math.max(0, Math.min(MAX_REMAIN, Math.floor(Number(remaining))));
  if (!Number.isFinite(r)) throw new Error('Número inválido.');
  const b = (g.buildings[n] = { remaining: r, by: uid || '', byName: clean(name, 40), at: Date.now() });
  if (opts.edited) b.edited = true;
  g.log.push({ n, remaining: r, by: clean(name, 40), at: b.at });
  if (g.log.length > 60) g.log.splice(0, g.log.length - 60);
  db.save();
  return b;
}
function deleteMember(gid, uid) { const g = store(gid); delete g.members[uid]; db.save(); }
function setGameTeams(gid, v) {
  const g = store(gid);
  const n = v === null || v === '' || v === undefined ? null : Math.max(0, Math.min(1000, Math.floor(Number(v))));
  g.gameTeams = Number.isFinite(n) ? n : null;
  db.save();
}
function reset(gid) {
  const g = store(gid);
  g.members = {}; g.buildings = {}; g.log = []; g.gameTeams = null; g.round += 1;
  db.save();
}

function label(cfg, n) {
  const b = cfg.guerra.buildings[n - 1] || {};
  return '#' + n + (b.name ? ' ' + b.name : '') + (b.level ? ' (Nv.' + b.level + ')' : '');
}

function state(gid) {
  const cfg = cfgs.getConfig(gid);
  const g = store(gid);
  const members = Object.entries(g.members).map(([id, m]) => {
    const took = Object.entries(g.buildings).filter(([, b]) => b.by === id && b.remaining === 0).map(([n]) => Number(n)).sort((a, b) => a - b);
    return { id, name: m.name, def: m.def, at: m.at, editedAt: m.editedAt || 0, took };
  }).sort((a, b) => (b.def ?? -1) - (a.def ?? -1) || a.name.localeCompare(b.name));
  const teams = members.reduce((s, m) => s + (m.def || 0), 0);
  const buildings = Array.from({ length: 9 }, (_, k) => {
    const b = g.buildings[k + 1];
    return { n: k + 1, label: label(cfg, k + 1), remaining: b ? b.remaining : null, byName: b?.byName || '', at: b?.at || 0 };
  });
  return {
    round: g.round, members, buildings, teams, points: teams * PTS_TEAM, gameTeams: g.gameTeams,
    diff: g.gameTeams === null ? null : g.gameTeams - teams,
    full: members.filter((m) => m.def === 4).length,
  };
}

/* ------------------------------ Mensagens ------------------------------ */
const phaseName = (c) => (c.phase === 'ataque' ? 'Dia da guerra (ataque)' : 'Dia da defesa');

function bldLine(b) {
  if (b.remaining === null) return '▫️ **' + b.label + '** — sem informação';
  if (b.remaining === 0) return '✅ **' + b.label + '** — pego' + (b.byName ? ' por ' + b.byName : '');
  return '⚔️ **' + b.label + '** — faltam **' + b.remaining + '** time(s)';
}

function announcePayload(gid) {
  const cfg = cfgs.getConfig(gid);
  const c = cfg.guerra;
  const st = state(gid);
  const e = new EmbedBuilder().setColor(c.color).setTitle('⚔️ Guerra de gangues — ' + phaseName(c))
    .setDescription([
      '🛡️ **Defesa:** toque em **Defesa** e diga quantos times (0 a 4) você colocou.',
      '🏢 **Prédios:** toque em **Atualizar prédio**, escolha o número e diga quantas equipes ainda faltam (**0** = prédio pego).',
      '📋 **Minha ficha** mostra só as suas marcações.',
      '', st.buildings.map(bldLine).join('\n'),
    ].join('\n'))
    .setFooter({ text: st.members.length + ' membro(s) marcaram · ' + st.teams + ' time(s) na defesa · atualizado automaticamente' }).setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gu:def').setLabel('Defesa').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('gu:bld').setLabel('Atualizar prédio').setEmoji('🏢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('gu:me').setLabel('Minha ficha').setEmoji('📋').setStyle(ButtonStyle.Secondary));
  return { embeds: [e], components: [row] };
}

function analysisPayload(gid) {
  const cfg = cfgs.getConfig(gid);
  const c = cfg.guerra;
  const st = state(gid);
  const head = ['**Defesa:** ' + st.teams + ' time(s) · **' + st.points + '** pontos · ' + st.full + ' membro(s) com 4/4'];
  if (st.diff !== null) head.push(st.diff === 0 ? '✅ Bate com o placar do jogo (' + st.gameTeams + ' times).' : '⚠️ O jogo diz **' + st.gameTeams + '** time(s); marcado: **' + st.teams + '** (diferença ' + (st.diff > 0 ? '+' : '') + st.diff + ').');
  head.push('', '**Prédios**', st.buildings.map(bldLine).join('\n'));
  const e1 = new EmbedBuilder().setColor(c.color).setTitle('📊 Análise da guerra — ' + phaseName(c)).setDescription(head.join('\n').slice(0, 4000));
  const lines = st.members.map((m, i) => '`' + String(i + 1).padStart(2, ' ') + '.` **' + m.name + '** — 🛡️ ' + (m.def === null ? '?' : m.def) + '/4' + (m.took.length ? ' · 🏢 ' + m.took.map((n) => '#' + n).join(' ') : '') + (m.editedAt ? ' ✏️' : ''));
  let desc = '', shown = 0;
  for (const l of lines) { if (desc.length + l.length + 1 > 3900) break; desc += l + '\n'; shown++; }
  if (shown < lines.length) desc += '… e mais ' + (lines.length - shown) + ' no painel.';
  const e2 = new EmbedBuilder().setColor(c.color).setTitle('👥 Membros')
    .setDescription(desc.trim() || 'Ninguém marcou nada ainda.')
    .setFooter({ text: 'Guerra nº ' + st.round + ' · ✏️ = corrigido pela líder · atualizado automaticamente' }).setTimestamp();
  return { embeds: [e1, e2] };
}

async function chanOf(client, gid, id) {
  const guild = client.guilds.cache.get(gid);
  const ch = guild && id && (await guild.channels.fetch(id).catch(() => null));
  return ch && ch.isTextBased() ? ch : null;
}

// Cria ou edita uma mensagem fixa do bot; guarda o id para editar da próxima vez.
async function upsert(client, gid, which, payload, { createIfMissing }) {
  const c = cfgs.getConfig(gid).guerra;
  const chId = which === 'analysis' ? c.analysisChannelId : c.announceChannelId;
  const msgId = which === 'analysis' ? c.analysisMessageId : c.announceMessageId;
  const ch = await chanOf(client, gid, chId);
  if (!ch) return null;
  let msg = msgId ? await ch.messages.fetch(msgId).catch(() => null) : null;
  if (msg && msg.author.id !== client.user.id) msg = null;
  if (msg) { await msg.edit(payload); return msg; }
  if (!createIfMissing) return null;
  msg = await ch.send(payload);
  cfgs.setGuerraMessage(gid, which, msg.id);
  await msg.pin().catch(() => {});
  return msg;
}

async function refresh(client, gid, { create = false } = {}) {
  const c = cfgs.getConfig(gid).guerra;
  if (!c.enabled) return;
  try { await upsert(client, gid, 'announce', announcePayload(gid), { createIfMissing: create }); } catch (e) { warn('ficha', e); }
  try { await upsert(client, gid, 'analysis', analysisPayload(gid), { createIfMissing: true }); } catch (e) { warn('análise', e); }
}

const timers = new Map();
function schedule(client, gid) { // junta várias marcações seguidas em uma só edição
  if (timers.has(gid)) return;
  timers.set(gid, setTimeout(() => { timers.delete(gid); refresh(client, gid); }, 1500));
}

/* ------------------------------ Interações ------------------------------ */
const nameOf = (i) => i.member?.displayName || i.user.globalName || i.user.username;

function mineEmbed(gid, uid) {
  const cfg = cfgs.getConfig(gid);
  const g = store(gid);
  const m = g.members[uid];
  const mine = Object.entries(g.buildings).filter(([, b]) => b.by === uid).sort((a, b) => a[0] - b[0]);
  return new EmbedBuilder().setColor(cfg.guerra.color).setTitle('📋 Minha ficha — ' + phaseName(cfg.guerra))
    .setDescription([
      '🛡️ **Defesa:** ' + (m && m.def !== null ? m.def + '/4 time(s)' : 'ainda não marcou'),
      '🏢 **Prédios que você atualizou:**',
      mine.length ? mine.map(([n, b]) => '• ' + label(cfg, Number(n)) + ' — ' + (b.remaining === 0 ? 'pego ✅' : 'faltam ' + b.remaining)).join('\n') : '• nenhum ainda',
    ].join('\n'));
}

async function handleInteraction(i) {
  try {
    const gid = i.guild.id;
    const cfg = cfgs.getConfig(gid);
    if (!cfg.guerra.enabled) return i.reply({ content: 'A ficha da guerra está desligada.', flags: EPHEMERAL });
    const [, act, arg] = i.customId.split(':');

    if (i.isButton() && act === 'def') {
      const row = new ActionRowBuilder().addComponents([0, 1, 2, 3, 4].map((n) =>
        new ButtonBuilder().setCustomId('gu:d:' + n).setLabel(n + '/4').setStyle(n === 4 ? ButtonStyle.Success : ButtonStyle.Secondary)));
      return i.reply({ content: '🛡️ Quantos times você colocou na defesa?', components: [row], flags: EPHEMERAL });
    }
    if (i.isButton() && act === 'd') {
      const n = Math.max(0, Math.min(4, Number(arg) || 0));
      setDef(gid, i.user.id, nameOf(i), n);
      schedule(i.client, gid);
      return i.update({ content: '✅ Defesa registrada: **' + n + '/4** time(s).', components: [] });
    }
    if (i.isButton() && act === 'bld') {
      const menu = new StringSelectMenuBuilder().setCustomId('gu:bsel').setPlaceholder('Escolha o prédio…')
        .addOptions(Array.from({ length: 9 }, (_, k) => ({ label: label(cfg, k + 1).slice(0, 100), value: String(k + 1) })));
      return i.reply({ content: '🏢 Qual prédio você quer atualizar?', components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
    }
    if (i.isStringSelectMenu?.() && act === 'bsel') {
      const n = Number(i.values?.[0]);
      if (!(n >= 1 && n <= 9)) return i.reply({ content: 'Prédio inválido.', flags: EPHEMERAL });
      const modal = new ModalBuilder().setCustomId('gu:bm:' + n).setTitle(label(cfg, n).slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('faltam').setLabel('Quantas equipes ainda faltam? (0 = prédio pego)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setPlaceholder('Ex.: 19')));
      return i.showModal(modal);
    }
    if (i.isModalSubmit() && act === 'bm') {
      const n = Number(arg);
      const raw = String(i.fields.getTextInputValue('faltam') || '').trim();
      if (!/^\d{1,3}$/.test(raw)) return i.reply({ content: '⚠️ Digite só um número, por exemplo **19** (ou **0** se o prédio foi pego).', flags: EPHEMERAL });
      const r = Number(raw);
      if (r > MAX_REMAIN) return i.reply({ content: '⚠️ Esse número parece alto demais. Confira e tente de novo.', flags: EPHEMERAL });
      setBuilding(gid, n, r, i.user.id, nameOf(i));
      schedule(i.client, gid);
      return i.reply({ content: r === 0 ? '✅ **' + label(cfg, n) + '** marcado como **pego**!' : '✅ **' + label(cfg, n) + '**: faltam **' + r + '** time(s).', flags: EPHEMERAL });
    }
    if (i.isButton() && act === 'me') {
      return i.reply({ embeds: [mineEmbed(gid, i.user.id)], flags: EPHEMERAL });
    }
  } catch (e) {
    warn('interação', e);
    if (!i.replied && !i.deferred) i.reply({ content: 'Algo deu errado.', flags: EPHEMERAL }).catch(() => {});
  }
}

module.exports = { handleInteraction, refresh, schedule, state, setDef, setBuilding, deleteMember, setGameTeams, reset, label, announcePayload, analysisPayload, PTS_TEAM };
