// Guerra de gangues (Idle Mafia): os membros marcam a defesa (0 a 4 times) e o andamento dos 9 prédios
// (#1..#9) por botões no canal do anúncio; a líder vê a tabela completa (e corrige tudo) no canal de
// análise e no painel. Pontos da defesa: cada time posicionado vale 25 (5 de base x multiplicador 5).
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, MessageFlags, SlashCommandBuilder, PermissionFlagsBits,
} = require('discord.js');
const cfgs = require('./config');
const db = require('./db');

const EPHEMERAL = MessageFlags.Ephemeral;
const PTS_TEAM = 25;
const MAX_REMAIN = 250;
const warn = (where, e) => console.error('[guerra] erro em ' + where + ':', e?.message || e);

const MAX_ACCOUNTS = 5; // contas do jogo por membro do Discord
const clean = (v, n) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
const nk = (name) => clean(name, 40).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

// g.accounts[aid] = { id, uid, ownerName, name, ok }: contas do jogo (uma pessoa do Discord pode ter várias).
// Elas ficam guardadas entre as guerras; g.members[aid] guarda só as marcações da guerra atual.
const store = (gid) => {
  const g = (db.data.guerra[gid] ??= {});
  g.members ??= {}; g.buildings ??= {}; g.log ??= []; g.round ??= 1; g.gameTeams ??= null; g.accounts ??= {}; g.nextAid ??= 1;
  for (const [k, m] of Object.entries(g.members)) { // dados antigos: a chave era o id do Discord
    if (!g.accounts[k] && /^\d{15,25}$/.test(k)) g.accounts[k] = { id: k, uid: k, ownerName: m.name || '', name: m.name || k, ok: false };
  }
  return g;
};
const accountsOf = (g, uid) => Object.values(g.accounts).filter((a) => a.uid === uid);
const findByName = (g, name) => Object.values(g.accounts).find((a) => nk(a.name) === nk(name));

function addAccount(gid, uid, ownerName, name, { leader = false } = {}) {
  const g = store(gid);
  const nm = clean(name, 40);
  if (nm.length < 2) throw new Error('Digite o nome da conta exatamente como aparece no jogo.');
  const dup = findByName(g, nm);
  if (dup) throw new Error(dup.uid === uid ? 'Você já cadastrou essa conta.' : 'Essa conta do jogo já está cadastrada por outra pessoa. Fale com a liderança.');
  if (accountsOf(g, uid).length >= MAX_ACCOUNTS) throw new Error('Limite de ' + MAX_ACCOUNTS + ' contas por pessoa.');
  const id = 'a' + (g.nextAid++).toString(36);
  const a = (g.accounts[id] = { id, uid, ownerName: clean(ownerName, 40), name: nm, ok: !!leader });
  db.save();
  return a;
}
function removeAccount(gid, aid) {
  const g = store(gid);
  delete g.accounts[aid]; delete g.members[aid];
  for (const [n, b] of Object.entries(g.buildings)) if (b.by === aid) b.by = '';
  db.save();
}
function updateAccount(gid, aid, patch) {
  const g = store(gid);
  const a = g.accounts[aid];
  if (!a) throw new Error('Conta não encontrada.');
  if (patch.name !== undefined) {
    const nm = clean(patch.name, 40);
    if (nm.length < 2) throw new Error('Nome muito curto.');
    const dup = findByName(g, nm);
    if (dup && dup.id !== aid) throw new Error('Já existe outra conta com esse nome.');
    a.name = nm;
    if (g.members[aid]) g.members[aid].name = nm;
  }
  if (patch.ok !== undefined) a.ok = !!patch.ok;
  db.save();
  return a;
}

/* ------------------------------ Dados ------------------------------ */
function rec(g, aid) {
  const a = g.accounts[aid];
  if (!a) throw new Error('Conta não encontrada.');
  const m = (g.members[aid] ??= { name: a.name, def: null, atk: null, at: 0 });
  m.name = a.name;
  return m;
}
function setDef(gid, aid, n, opts = {}) {
  n = Math.max(0, Math.min(4, Math.floor(Number(n)) || 0));
  const m = rec(store(gid), aid);
  m.def = n; m.at = Date.now();
  if (opts.edited) m.editedAt = Date.now();
  db.save();
  return m;
}
function setAtk(gid, aid, n, opts = {}) {
  n = Math.max(0, Math.min(2, Math.floor(Number(n)) || 0));
  const m = rec(store(gid), aid);
  m.atk = n; m.at = Date.now();
  if (opts.edited) m.editedAt = Date.now();
  db.save();
  return m;
}
function setBuilding(gid, n, remaining, aid, opts = {}) {
  n = Math.floor(Number(n));
  if (!(n >= 1 && n <= 9)) throw new Error('Prédio inválido.');
  const g = store(gid);
  if (remaining === null || remaining === '' || remaining === undefined) { delete g.buildings[n]; db.save(); return null; }
  const r = Math.max(0, Math.min(MAX_REMAIN, Math.floor(Number(remaining))));
  if (!Number.isFinite(r)) throw new Error('Número inválido.');
  const name = g.accounts[aid]?.name || opts.byName || '';
  const b = (g.buildings[n] = { remaining: r, by: aid || '', byName: clean(name, 40), at: Date.now() });
  if (opts.edited) b.edited = true;
  g.log.push({ n, remaining: r, by: clean(name, 40), at: b.at });
  if (g.log.length > 60) g.log.splice(0, g.log.length - 60);
  db.save();
  return b;
}
function deleteMember(gid, aid) { const g = store(gid); delete g.members[aid]; db.save(); } // limpa só as marcações da guerra
function setGameTeams(gid, v) {
  const g = store(gid);
  const n = v === null || v === '' || v === undefined ? null : Math.max(0, Math.min(1000, Math.floor(Number(v))));
  g.gameTeams = Number.isFinite(n) ? n : null;
  db.save();
}
function reset(gid) {
  const g = store(gid);
  g.members = {}; g.buildings = {}; g.log = []; g.gameTeams = null; g.round += 1; // as contas continuam cadastradas
  db.save();
}

function label(cfg, n) {
  const b = cfg.guerra.buildings[n - 1] || {};
  return '#' + n + (b.name ? ' ' + b.name : '') + (b.level ? ' (Nv.' + b.level + ')' : '');
}

function state(gid) {
  const cfg = cfgs.getConfig(gid);
  const g = store(gid);
  const members = Object.values(g.accounts).map((a) => {
    const m = g.members[a.id] || {};
    const took = Object.entries(g.buildings).filter(([, bb]) => bb.by === a.id && bb.remaining === 0).map(([n]) => Number(n)).sort((x, y) => x - y);
    return { id: a.id, uid: a.uid, owner: a.ownerName, name: a.name, ok: !!a.ok, def: m.def ?? null, atk: m.atk ?? null, at: m.at || 0, editedAt: m.editedAt || 0, took };
  }).sort((x, y) => (y.def ?? -1) - (x.def ?? -1) || x.name.localeCompare(y.name));
  const teams = members.reduce((n, m) => n + (m.def || 0), 0);
  const attacks = members.reduce((n, m) => n + (m.atk || 0), 0);
  const buildings = Array.from({ length: 9 }, (_, k) => {
    const bb = g.buildings[k + 1];
    return { n: k + 1, label: label(cfg, k + 1), remaining: bb ? bb.remaining : null, byName: bb?.byName || '', at: bb?.at || 0 };
  });
  return {
    round: g.round, members, buildings, teams, attacks, atkFull: members.filter((m) => m.atk === 2).length, points: teams * PTS_TEAM, gameTeams: g.gameTeams,
    diff: g.gameTeams === null ? null : g.gameTeams - teams,
    full: members.filter((m) => m.def === 4).length,
    marked: members.filter((m) => m.def !== null || m.atk !== null).length,
    pending: members.filter((m) => !m.ok).length,
  };
}

/* ------------------------------ Mensagens ------------------------------ */
function phaseOf(c, gid) {
  if (c.phase === 'defesa' || c.phase === 'ataque') return c.phase;
  const f = gid ? store(gid).forced : null; // fase aberta por comando/automação (vale por 30 h)
  if (f && Date.now() - f.at < 30 * 3600e3) return f.phase;
  const d = new Date(Date.now() - 3 * 3600e3); // Fortaleza (UTC-3)
  const t = d.getUTCDay() * 24 + d.getUTCHours() + d.getUTCMinutes() / 60; // horas desde domingo 0h
  if (t >= 3 * 24 + 21 && t < 4 * 24 + 21) return 'defesa'; // quarta 21h -> quinta 21h
  if (t >= 4 * 24 + 21 && t < 5 * 24 + 21) return 'ataque'; // quinta 21h -> sexta 21h
  return 'fora';
}
const phaseName = (c, gid) => ({ defesa: 'Dia da defesa', ataque: 'Dia da guerra (ataque)' }[phaseOf(c, gid)] || 'Guerra');

function bldLine(b) {
  if (b.remaining === null) return '▫️ **' + b.label + '** — sem informação';
  if (b.remaining === 0) return '✅ **' + b.label + '** — pego' + (b.byName ? ' por ' + b.byName : '');
  return '⚔️ **' + b.label + '** — faltam **' + b.remaining + '** time(s)';
}

function announcePayload(gid) {
  const cfg = cfgs.getConfig(gid);
  const c = cfg.guerra;
  const st = state(gid);
  const e = new EmbedBuilder().setColor(c.color).setTitle('⚔️ Guerra de gangues — ' + phaseName(c, gid))
    .setDescription([
      '🛡️ **Defesa:** toque em **Defesa** e diga quantos times (0 a 4) você colocou.',
      '⚔️ **Ataque:** toque em **Ataque** e diga quantos ataques (0 a 2) você já fez.',
      '🏢 **Prédios:** toque em **Atualizar prédio**, escolha o número e diga quantas equipes ainda faltam (**0** = prédio pego).',
      '📋 **Minha ficha** mostra só as suas marcações. 👤 **Minhas contas**: cadastre o nome exato de cada conta sua no jogo (pode ter mais de uma).',
      '', st.buildings.map(bldLine).join('\n'),
    ].join('\n'))
    .setFooter({ text: st.marked + '/' + st.members.length + ' conta(s) marcaram · ' + st.teams + ' time(s) na defesa · ' + st.attacks + ' ataque(s) · atualizado automaticamente' }).setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('gu:def').setLabel('Defesa').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('gu:atk').setLabel('Ataque').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('gu:bld').setLabel('Atualizar prédio').setEmoji('🏢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('gu:me').setLabel('Minha ficha').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('gu:acs').setLabel('Minhas contas').setEmoji('👤').setStyle(ButtonStyle.Secondary));
  return { embeds: [e], components: [row] };
}

function analysisPayload(gid) {
  const cfg = cfgs.getConfig(gid);
  const c = cfg.guerra;
  const st = state(gid);
  const head = ['**Defesa:** ' + st.teams + ' time(s) · **' + st.points + '** pontos · ' + st.full + ' membro(s) com 4/4', '**Ataque:** ' + st.attacks + ' ataque(s) feito(s) · ' + st.atkFull + ' membro(s) com 2/2'];
  if (st.diff !== null) head.push(st.diff === 0 ? '✅ Bate com o placar do jogo (' + st.gameTeams + ' times).' : '⚠️ O jogo diz **' + st.gameTeams + '** time(s); marcado: **' + st.teams + '** (diferença ' + (st.diff > 0 ? '+' : '') + st.diff + ').');
  head.push('', '**Prédios**', st.buildings.map(bldLine).join('\n'));
  const e1 = new EmbedBuilder().setColor(c.color).setTitle('📊 Análise da guerra — ' + phaseName(c, gid)).setDescription(head.join('\n').slice(0, 4000));
  const lines = st.members.map((m, i) => '`' + String(i + 1).padStart(2, ' ') + '.` **' + m.name + '**' + (m.ok ? '' : ' ❔') + ' — 🛡️ ' + (m.def === null ? '?' : m.def) + '/4 · ⚔️ ' + (m.atk === null ? '?' : m.atk) + '/2' + (m.took.length ? ' · 🏢 ' + m.took.map((n) => '#' + n).join(' ') : '') + (m.editedAt ? ' ✏️' : ''));
  let desc = '', shown = 0;
  for (const l of lines) { if (desc.length + l.length + 1 > 3900) break; desc += l + '\n'; shown++; }
  if (shown < lines.length) desc += '… e mais ' + (lines.length - shown) + ' no painel.';
  const e2 = new EmbedBuilder().setColor(c.color).setTitle('👥 Membros')
    .setDescription(desc.trim() || 'Nenhuma conta cadastrada ainda.')
    .setFooter({ text: 'Guerra nº ' + st.round + ' · ✏️ = corrigido pela líder · ❔ = conta ainda não confirmada · atualizado automaticamente' }).setTimestamp();
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
const row = (...c) => new ActionRowBuilder().addComponents(...c);

function mineEmbed(gid, uid) {
  const cfg = cfgs.getConfig(gid);
  const g = store(gid);
  const accs = accountsOf(g, uid);
  const e = new EmbedBuilder().setColor(cfg.guerra.color).setTitle('📋 Minha ficha — ' + phaseName(cfg.guerra, gid));
  if (!accs.length) return e.setDescription('Você ainda não cadastrou nenhuma conta do jogo. Toque em **Minhas contas**.');
  return e.setDescription(accs.map((a) => {
    const m = g.members[a.id] || {};
    const mine = Object.entries(g.buildings).filter(([, b]) => b.by === a.id).sort((x, y) => x[0] - y[0]);
    return ['**' + a.name + '**' + (a.ok ? ' ✔' : ' ❔'),
      '🛡️ Defesa: ' + (m.def !== null && m.def !== undefined ? m.def + '/4' : 'não marcou') + ' · ⚔️ Ataque: ' + (m.atk !== null && m.atk !== undefined ? m.atk + '/2' : 'não marcou'),
      '🏢 ' + (mine.length ? mine.map(([n, b]) => '#' + n + (b.remaining === 0 ? ' pego' : ' faltam ' + b.remaining)).join(' · ') : 'nenhum prédio atualizado')].join('\n');
  }).join('\n\n').slice(0, 4000));
}

function accountsView(gid, uid, note) {
  const g = store(gid);
  const accs = accountsOf(g, uid);
  const comps = [];
  const btns = [new ButtonBuilder().setCustomId('gu:addacc').setLabel('Adicionar conta').setEmoji('➕').setStyle(ButtonStyle.Success)];
  comps.push(row(...btns));
  if (accs.length) comps.push(row(new StringSelectMenuBuilder().setCustomId('gu:rmsel').setPlaceholder('Remover uma conta…')
    .addOptions(accs.map((a) => ({ label: a.name.slice(0, 100), value: a.id })))));
  return {
    content: (note ? note + '\n\n' : '') + '👤 **Suas contas do jogo**\n' + (accs.length ? accs.map((a) => '• **' + a.name + '** ' + (a.ok ? '✔ confirmada' : '❔ a confirmar pela liderança')).join('\n') : 'Nenhuma ainda.') +
      '\n\nUse o nome **exatamente como aparece no jogo**. Se você joga com mais de uma conta, cadastre todas.',
    components: comps, embeds: [],
  };
}

function nameModal(next, prefill) {
  return new ModalBuilder().setCustomId('gu:nm:' + next).setTitle('Sua conta no jogo')
    .addComponents(row(new TextInputBuilder().setCustomId('nome').setLabel('Nome exato no jogo').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(2).setMaxLength(40).setValue(String(prefill || '').slice(0, 40))));
}

// prompt de cada ação para uma conta já escolhida
function prompt(cfg, act, acc, multi) {
  const who = multi ? '**' + acc.name + '** — ' : '';
  if (act === 'def') {
    return { content: '🛡️ ' + who + 'quantos times você colocou na defesa?', components: [row(...[0, 1, 2, 3, 4].map((n) =>
      new ButtonBuilder().setCustomId('gu:d:' + n + ':' + acc.id).setLabel(n + '/4').setStyle(n === 4 ? ButtonStyle.Success : ButtonStyle.Secondary)))] };
  }
  if (act === 'atk') {
    return { content: '⚔️ ' + who + 'quantos ataques você já fez?', components: [row(...[0, 1, 2].map((n) =>
      new ButtonBuilder().setCustomId('gu:a:' + n + ':' + acc.id).setLabel(n + '/2').setStyle(n === 2 ? ButtonStyle.Success : ButtonStyle.Secondary)))] };
  }
  const menu = new StringSelectMenuBuilder().setCustomId('gu:bsel:' + acc.id).setPlaceholder('Escolha o prédio…')
    .addOptions(Array.from({ length: 9 }, (_, k) => ({ label: label(cfg, k + 1).slice(0, 100), value: String(k + 1) })));
  return { content: '🏢 ' + who + 'qual prédio você quer atualizar?', components: [row(menu)] };
}

async function handleInteraction(i) {
  try {
    const gid = i.guild.id;
    const cfg = cfgs.getConfig(gid);
    if (!cfg.guerra.enabled) return i.reply({ content: 'A ficha da guerra está desligada.', flags: EPHEMERAL });
    const g = store(gid);
    const uid = i.user.id;
    const [, act, arg, arg2] = i.customId.split(':');
    const mineAcc = (aid) => { const a = g.accounts[aid]; return a && a.uid === uid ? a : null; };
    const deny = () => i.reply({ content: '⚠️ Essa conta não é sua (ou foi removida). Abra o botão de novo.', flags: EPHEMERAL });

    // Defesa / Ataque / Atualizar prédio: descobre qual conta usar
    if (i.isButton() && (act === 'def' || act === 'atk' || act === 'bld')) {
      const accs = accountsOf(g, uid);
      if (!accs.length) return i.showModal(nameModal(act, nameOf(i)));
      if (accs.length === 1) return i.reply({ ...prompt(cfg, act, accs[0], false), flags: EPHEMERAL });
      const menu = new StringSelectMenuBuilder().setCustomId('gu:pk:' + act).setPlaceholder('Qual conta?')
        .addOptions(accs.map((a) => ({ label: a.name.slice(0, 100), value: a.id })));
      return i.reply({ content: 'Você tem mais de uma conta. Qual delas?', components: [row(menu)], flags: EPHEMERAL });
    }
    if (i.isStringSelectMenu?.() && act === 'pk') {
      const a = mineAcc(i.values?.[0]);
      if (!a) return deny();
      return i.update({ ...prompt(cfg, arg, a, true) });
    }
    if (i.isButton() && act === 'd') {
      const a = mineAcc(arg2); if (!a) return deny();
      const n = Math.max(0, Math.min(4, Number(arg) || 0));
      setDef(gid, a.id, n); schedule(i.client, gid);
      return i.update({ content: '✅ **' + a.name + '** — defesa registrada: **' + n + '/4** time(s).', components: [] });
    }
    if (i.isButton() && act === 'a') {
      const a = mineAcc(arg2); if (!a) return deny();
      const n = Math.max(0, Math.min(2, Number(arg) || 0));
      setAtk(gid, a.id, n); schedule(i.client, gid);
      return i.update({ content: '✅ **' + a.name + '** — ataque registrado: **' + n + '/2**.', components: [] });
    }
    if (i.isStringSelectMenu?.() && act === 'bsel') {
      const a = mineAcc(arg); if (!a) return deny();
      const n = Number(i.values?.[0]);
      if (!(n >= 1 && n <= 9)) return i.reply({ content: 'Prédio inválido.', flags: EPHEMERAL });
      const modal = new ModalBuilder().setCustomId('gu:bm:' + n + ':' + a.id).setTitle(label(cfg, n).slice(0, 45))
        .addComponents(row(new TextInputBuilder().setCustomId('faltam').setLabel('Quantas equipes faltam? (0 = prédio pego)'.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3).setPlaceholder('Ex.: 19')));
      return i.showModal(modal);
    }
    if (i.isModalSubmit() && act === 'bm') {
      const a = mineAcc(arg2); if (!a) return deny();
      const n = Number(arg);
      const raw = String(i.fields.getTextInputValue('faltam') || '').trim();
      if (!/^\d{1,3}$/.test(raw)) return i.reply({ content: '⚠️ Digite só um número, por exemplo **19** (ou **0** se o prédio foi pego).', flags: EPHEMERAL });
      const r = Number(raw);
      if (r > MAX_REMAIN) return i.reply({ content: '⚠️ Esse número parece alto demais. Confira e tente de novo.', flags: EPHEMERAL });
      setBuilding(gid, n, r, a.id); schedule(i.client, gid);
      return i.reply({ content: r === 0 ? '✅ **' + label(cfg, n) + '** marcado como **pego** por **' + a.name + '**!' : '✅ **' + label(cfg, n) + '**: faltam **' + r + '** time(s).', flags: EPHEMERAL });
    }

    // Contas
    if (i.isButton() && act === 'me') return i.reply({ embeds: [mineEmbed(gid, uid)], flags: EPHEMERAL });
    if (i.isButton() && act === 'acs') return i.reply({ ...accountsView(gid, uid), flags: EPHEMERAL });
    if (i.isButton() && act === 'addacc') return i.showModal(nameModal('acs', ''));
    if (i.isModalSubmit() && act === 'nm') {
      let a;
      try { a = addAccount(gid, uid, nameOf(i), i.fields.getTextInputValue('nome')); } catch (e) { return i.reply({ content: '⚠️ ' + e.message, flags: EPHEMERAL }); }
      schedule(i.client, gid);
      if (arg === 'def' || arg === 'atk' || arg === 'bld') return i.reply({ content: '✅ Conta **' + a.name + '** cadastrada (a liderança confere depois).\n\n' + prompt(cfg, arg, a, false).content, components: prompt(cfg, arg, a, false).components, flags: EPHEMERAL });
      return i.reply({ ...accountsView(gid, uid, '✅ Conta **' + a.name + '** cadastrada. A liderança vai conferir o nome.'), flags: EPHEMERAL });
    }
    if (i.isStringSelectMenu?.() && act === 'rmsel') {
      const a = mineAcc(i.values?.[0]); if (!a) return deny();
      removeAccount(gid, a.id); schedule(i.client, gid);
      return i.update({ ...accountsView(gid, uid, '🗑️ Conta **' + a.name + '** removida.') });
    }
  } catch (e) {
    warn('interação', e);
    if (!i.replied && !i.deferred) i.reply({ content: 'Algo deu errado.', flags: EPHEMERAL }).catch(() => {});
  }
}


/* ------------------------------ Postagem automática e comandos ------------------------------ */
// Janela da guerra em Fortaleza (UTC-3): quarta 21h -> quinta 21h = defesa; quinta 21h -> sexta 21h = ataque.
// "wed" = data da quarta-feira daquela guerra (identifica a guerra, para não postar duas vezes).
function windowNow() {
  const d = new Date(Date.now() - 3 * 3600e3);
  const dow = d.getUTCDay(), h = d.getUTCHours();
  let phase = null;
  if ((dow === 3 && h >= 21) || (dow === 4 && h < 21)) phase = 'defesa';
  else if ((dow === 4 && h >= 21) || (dow === 5 && h < 21)) phase = 'ataque';
  const wed = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow - 3))).toISOString().slice(0, 10);
  return { phase, wed };
}

const START_TEXT = {
  defesa: '🛡️ **Começou o dia da defesa!** Toque em **Defesa** e diga quantos times (0 a 4) você colocou. Quem tem mais de uma conta cadastra em **Minhas contas**.',
  ataque: '⚔️ **Começou o dia do ataque!** Toque em **Ataque** (0 a 2) e vá atualizando os prédios (#1 a #9) conforme a guerra anda.',
};

// Posta uma ficha NOVA no canal do anúncio (fixa a nova e tira os botões da antiga).
// Defesa = guerra nova: limpa as marcações da anterior (as contas cadastradas ficam).
async function launch(client, gid, phase, { clear = phase === 'defesa' } = {}) {
  const c = cfgs.getConfig(gid).guerra;
  if (!c.enabled) return { ok: false, reason: 'A ficha da guerra está desligada no painel (aba ⚔️ Guerra).' };
  const ch = await chanOf(client, gid, c.announceChannelId);
  if (!ch) return { ok: false, reason: 'Escolha o canal do anúncio da guerra no painel (aba ⚔️ Guerra).' };
  if (clear) reset(gid);
  const g = store(gid);
  g.forced = { phase, at: Date.now() };
  const w = windowNow();
  if (w.phase === phase) { g.auto ??= {}; g.auto[phase === 'defesa' ? 'def' : 'atk'] = w.wed; } // já postada nesta guerra
  db.save();
  const old = c.announceMessageId ? await ch.messages.fetch(c.announceMessageId).catch(() => null) : null;
  const payload = announcePayload(gid);
  payload.content = START_TEXT[phase];
  let msg;
  try { msg = await ch.send(payload); }
  catch (e) {
    const perm = e?.code === 50013 || e?.code === 50001;
    return { ok: false, reason: perm ? 'O bot não tem permissão para enviar mensagens nesse canal.' : (e?.message || 'erro ao enviar') };
  }
  cfgs.setGuerraMessage(gid, 'announce', msg.id);
  await msg.pin().catch(() => {});
  if (old && old.author.id === client.user.id) { // a ficha antiga fica como histórico, sem botões
    await old.unpin().catch(() => {});
    await old.edit({ components: [] }).catch(() => {});
  }
  try { await upsert(client, gid, 'analysis', analysisPayload(gid), { createIfMissing: true }); } catch (e) { warn('análise', e); }
  return { ok: true, msg };
}

// Roda a cada minuto: quando chega a hora, posta a ficha da fase.
async function tick(client) {
  const w = windowNow();
  for (const guild of client.guilds.cache.values()) {
    try {
      const gid = guild.id;
      const c = cfgs.getConfig(gid).guerra;
      const g = store(gid);
      if (!g.auto) { // primeira vez: não repete uma fase que já estava em andamento antes de ligar a automação
        g.auto = {};
        if (w.phase) g.auto[w.phase === 'defesa' ? 'def' : 'atk'] = w.wed;
        db.save();
        continue;
      }
      if (!w.phase || !c.enabled || !c.auto || !c.announceChannelId) continue;
      const k = w.phase === 'defesa' ? 'def' : 'atk';
      if (g.auto[k] === w.wed) continue;
      g.auto[k] = w.wed; db.save(); // marca antes: se falhar, não fica tentando toda hora
      const r = await launch(client, gid, w.phase);
      if (!r.ok) warn('postagem automática (' + w.phase + ')', new Error(r.reason));
    } catch (e) { warn('tick', e); }
  }
}

const commands = [
  new SlashCommandBuilder().setName('guerra').setDescription('Posta a ficha da guerra no canal do anúncio (liderança)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('defesa').setDescription('Posta a ficha de DEFESA e começa uma guerra nova')
      .addBooleanOption((o) => o.setName('limpar').setDescription('Limpar as marcações da guerra anterior (padrão: sim)')))
    .addSubcommand((s) => s.setName('ataque').setDescription('Posta a ficha de ATAQUE (mantém as marcações da defesa)')),
];

async function handleSlash(i) {
  if (i.commandName !== 'guerra') return false;
  const c = cfgs.getConfig(i.guild.id).guerra;
  const isStaff = i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || (c.staffRoleIds || []).some((r) => i.member?.roles?.cache?.has(r));
  if (!isStaff) { await i.reply({ content: '🔒 Só a liderança pode usar este comando.', flags: EPHEMERAL }); return true; }
  await i.deferReply({ flags: EPHEMERAL });
  const sub = i.options.getSubcommand();
  const clear = sub === 'defesa' ? i.options.getBoolean('limpar') !== false : false;
  const r = await launch(i.client, i.guild.id, sub === 'defesa' ? 'defesa' : 'ataque', { clear });
  if (!r.ok) { await i.editReply('❌ ' + r.reason); return true; }
  await i.editReply('✅ Ficha de **' + (sub === 'defesa' ? 'defesa' : 'ataque') + '** postada: ' + r.msg.url + (clear ? '\n🧹 As marcações da guerra anterior foram limpas (as contas cadastradas continuam).' : ''));
  return true;
}

module.exports = { commands, handleSlash, launch, tick, windowNow, handleInteraction, refresh, schedule, state, setDef, setAtk, phaseOf, setBuilding, deleteMember, addAccount, removeAccount, updateAccount, MAX_ACCOUNTS, setGameTeams, reset, label, announcePayload, analysisPayload, PTS_TEAM };
