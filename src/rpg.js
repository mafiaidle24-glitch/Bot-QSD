// RPG de aventura estilo máfia: lute contra rivais, ganhe grana, compre armas e proteção.
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const db = require('./db');

const EPHEMERAL = MessageFlags.Ephemeral;
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const money = (n) => '$' + Number(n).toLocaleString('pt-BR');

const commands = [
  new SlashCommandBuilder().setName('aventura').setDescription('🕴️ Sua carreira na máfia: lute, ganhe grana e compre equipamentos'),
  new SlashCommandBuilder().setName('aventuraranking').setDescription('🏆 Os maiores mafiosos do servidor'),
  new SlashCommandBuilder().setName('duelo').setDescription('⚔️ Desafie outro membro para um duelo (vale os equipamentos de cada um)')
    .addUserOption((o) => o.setName('membro').setDescription('Quem você quer desafiar').setRequired(true))
    .addIntegerOption((o) => o.setName('aposta').setDescription('Grana apostada (opcional)').setMinValue(0).setMaxValue(1000000)),
  new SlashCommandBuilder().setName('chefe').setDescription('👑 O chefão da semana: todo o servidor ataca junto'),
];
const NAMES = new Set(commands.map((c) => c.name));

/* ---------- conteúdo (vem de rpgdata.js: é lá que você amplia o jogo) ---------- */
const { ENEMIES, ITEMS, TITLES, START, BUSINESSES, BIZ_CAP_HOURS, BIZ_MAX_LEVEL, BIZ_LEVEL_BONUS, BIZ_UPGRADE_FACTOR, CLASSES, CLASS_CHANGE_COST } = require('./rpgdata');
const byAtk = Object.values(ITEMS).filter((x) => x.kind === 'weapon').sort((x, y) => x.atk - y.atk);
const byDef = Object.values(ITEMS).filter((x) => x.kind === 'armor').sort((x, y) => x.def - y.def);
const WEAPONS = [{ id: '', name: 'Punhos', atk: 0, price: 0, emoji: '👊' }, ...byAtk];
const ARMORS = [{ id: '', name: 'Roupa comum', def: 0, price: 0, emoji: '👕' }, ...byDef];
const KIT = { price: ITEMS.kit.price, flat: ITEMS.kit.heal, heal: 0.35 };

/* ---------- jogador ---------- */
const fightCd = new Map();
const xpNeeded = (lvl) => 60 + 60 * lvl;
const weaponOf = (p) => WEAPONS.find((w) => w.id === p.weapon) || WEAPONS[0];
const armorOf = (p) => ARMORS.find((x) => x.id === p.armor) || ARMORS[0];
const clsOf = (p) => CLASSES[p.cls] || { hp: 1, dmg: 1, cash: 1, biz: 1, crit: 0, mission: 1, heal: 1 };
const maxHp = (p) => Math.round((110 + 12 * (p.lvl - 1)) * clsOf(p).hp);
const atkOf = (p) => Math.round((7 + 2 * p.lvl + weaponOf(p).atk) * clsOf(p).dmg);
const defOf = (p) => armorOf(p).def;
const reduction = (def) => 100 / (100 + def * 8);
const titleOf = (lvl) => { let t = TITLES[0][1]; for (const [min, name] of TITLES) if (lvl >= min) t = name; return t; };
const kitHeal = (p) => Math.round(Math.max(KIT.flat, maxHp(p) * KIT.heal) * clsOf(p).heal);

function player(guildId, userId) {
  const g = (db.data.rpg[guildId] ??= {});
  const p = (g[userId] ??= { ...START, biz: [], tick: Date.now() });
  if (Array.isArray(p.biz)) { const o = {}; for (const id of p.biz) o[id] = 1; p.biz = o; } // versão antiga: lista -> níveis
  if (!p.biz || typeof p.biz !== 'object') { p.biz = {}; p.collectAt = 0; }
  if (typeof p.cls !== 'string') p.cls = '';
  if (!p.ver) { p.ver = 2; if (p.wins + p.losses > 0) { p.cash += 300; p.kits += 1; } } // bônus único para quem já jogava antes do ajuste
  ensureDaily(p);
  // regeneração passiva: 3% da vida máxima por minuto
  const now = Date.now();
  const mins = (now - (p.tick || now)) / 60000;
  if (mins >= 0.5 && p.hp < maxHp(p)) p.hp = Math.min(maxHp(p), p.hp + Math.floor(mins * 0.03 * maxHp(p)));
  p.tick = now;
  if (p.hp > maxHp(p)) p.hp = maxHp(p);
  return p;
}

const bar = (cur, max, n = 10) => {
  const f = Math.max(0, Math.min(n, Math.round((cur / max) * n)));
  return '█'.repeat(f) + '░'.repeat(n - f);
};

function pickEnemy(lvl) {
  const eligible = ENEMIES.filter((e) => e.minLvl <= lvl);
  const pool = Math.random() < 0.4 ? eligible : eligible.slice(-3);
  const e = pick(pool);
  return { name: e.name, emoji: e.emoji, hp: e.hp, atk: e.atk, cash: e.cash, xp: e.xp, boss: e.id === 'chefao' };
}

function simulate(p, e) {
  let ph = p.hp;
  let eh = e.hp;
  const log = [];
  for (let r = 1; r <= 30 && ph > 0 && eh > 0; r++) {
    const crit = Math.random() < clsOf(p).crit;
    const d1 = Math.max(1, Math.round(atkOf(p) * (0.85 + Math.random() * 0.3) * (crit ? 1.8 : 1)));
    eh -= d1;
    if (eh <= 0) { log.push('💥 Você acertou **' + d1 + '**' + (crit ? ' (crítico!)' : '') + ' e derrubou o rival!'); break; }
    const d2 = Math.max(1, Math.round(e.atk * (0.85 + Math.random() * 0.3) * reduction(defOf(p))));
    ph -= d2;
    log.push('🗡️ Você causou **' + d1 + '** • ' + e.emoji + ' causou **' + d2 + '**');
  }
  return { won: eh <= 0 && ph > 0, ph: Math.max(0, ph), eh: Math.max(0, eh), log };
}

/* ---------- telas ---------- */
function profileEmbed(p, user, extra) {
  const need = xpNeeded(p.lvl);
  const w = weaponOf(p);
  const a = armorOf(p);
  const e = new EmbedBuilder().setColor(0xb8860b).setTitle((clsOf(p).emoji || '🕴️') + ' ' + user.username + ' • ' + titleOf(p.lvl) + (clsOf(p).name ? ' • ' + clsOf(p).name : '') + ' (nível ' + p.lvl + ')')
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription((extra ? extra + '\n\n' : '') +
      '❤️ **Vida** ' + bar(p.hp, maxHp(p)) + ' ' + p.hp + '/' + maxHp(p) + '\n' +
      '⭐ **XP** ' + bar(p.xp, need) + ' ' + p.xp + '/' + need)
    .addFields(
      { name: '💵 Grana', value: money(p.cash), inline: true },
      { name: '💊 Kits', value: String(p.kits), inline: true },
      { name: '🏆 Vitórias', value: p.wins + ' • ' + p.losses + ' derrotas', inline: true },
      { name: w.emoji + ' Arma', value: w.name + ' (ataque ' + atkOf(p) + ')', inline: true },
      { name: a.emoji + ' Proteção', value: a.name + ' (defesa ' + defOf(p) + ')', inline: true });
  return e;
}

function menuRows(uid) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:fight:' + uid).setLabel('Lutar').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rpg:kit:' + uid).setLabel('Usar kit').setEmoji('💊').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rpg:shop:' + uid).setLabel('Loja').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rpg:biz:' + uid).setLabel('Negócios').setEmoji('🏢').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Perfil').setEmoji('🪪').setStyle(ButtonStyle.Secondary));
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:missions:' + uid).setLabel('Missões do dia').setEmoji('📋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rpg:class:' + uid).setLabel('Classe').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rpg:boss:' + uid).setLabel('Chefão da semana').setEmoji('👑').setStyle(ButtonStyle.Danger));
  return [row1, row2];
}

function shopView(p, uid, note) {
  const wl = WEAPONS.slice(1).map((w) => (p.weapon === w.id ? '✅ ' : '') + w.emoji + ' **' + w.name + '** +' + w.atk + ' ataque — ' + money(w.price)).join('\n');
  const al = ARMORS.slice(1).map((a) => (p.armor === a.id ? '✅ ' : '') + a.emoji + ' **' + a.name + '** +' + a.def + ' defesa — ' + money(a.price)).join('\n');
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('🛒 Loja do Submundo')
    .setDescription((note ? note + '\n\n' : '') + '💵 Você tem **' + money(p.cash) + '**\n\n**Armas**\n' + wl + '\n\n**Proteção**\n' + al + '\n\n💊 **Kit médico** — recupera pelo menos ' + Math.round(KIT.heal * 100) + '% da vida — ' + money(KIT.price));
  const wIdx = WEAPONS.findIndex((w) => w.id === p.weapon);
  const aIdx = ARMORS.findIndex((a) => a.id === p.armor);
  const row = (items, idx, kind) => new ActionRowBuilder().addComponents(items.slice(1).map((it, n) =>
    new ButtonBuilder().setCustomId('rpg:buy' + kind + ':' + uid + ':' + it.id).setLabel(it.name.slice(0, 20)).setEmoji(it.emoji)
      .setStyle(ButtonStyle.Secondary).setDisabled(n + 1 <= idx)));
  const last = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:buykit:' + uid).setLabel('Kit médico ' + money(KIT.price)).setEmoji('💊').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [row(WEAPONS, wIdx, 'w'), row(ARMORS, aIdx, 'a'), last] };
}

/* ---------- negócios (renda por hora, com níveis) ---------- */
const bizLevel = (p, id) => Number(p.biz[id]) || 0;
const bizIncome = (b, lvl) => Math.round(b.income * (1 + BIZ_LEVEL_BONUS * (lvl - 1)));
const upgradeCost = (b, lvl) => Math.round(b.price * BIZ_UPGRADE_FACTOR * lvl);
const incomePerHour = (p) => Math.round(BUSINESSES.reduce((s, b) => s + (bizLevel(p, b.id) ? bizIncome(b, bizLevel(p, b.id)) : 0), 0) * clsOf(p).biz);
function pending(p) {
  if (!Object.keys(p.biz).length || !p.collectAt) return 0;
  const hours = Math.min(BIZ_CAP_HOURS, (Date.now() - p.collectAt) / 3600000);
  return Math.floor(incomePerHour(p) * hours);
}
function collect(p) {
  const n = pending(p);
  if (n > 0) progress(p, 'collect', 1);
  p.cash += n;
  p.collectAt = Date.now();
  db.save();
  return n;
}

function bizView(p, uid, note) {
  const list = BUSINESSES.map((b) => {
    const lv = bizLevel(p, b.id);
    return lv
      ? '✅ ' + b.emoji + ' **' + b.name + '** nv ' + lv + '/' + BIZ_MAX_LEVEL + ' — ' + money(Math.round(bizIncome(b, lv) * clsOf(p).biz)) + '/h'
      : '🔒 ' + b.emoji + ' ' + b.name + ' — ' + money(b.price) + ' (rende ' + money(b.income) + '/h)';
  }).join('\n');
  const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle('🏢 Seus negócios')
    .setDescription((note ? note + '\n\n' : '') + '💵 Você tem **' + money(p.cash) + '**\n\n' + list +
      '\n\n💰 Para coletar: **' + money(pending(p)) + '**\n📈 Renda: **' + money(incomePerHour(p)) + '/h** (acumula até ' + BIZ_CAP_HOURS + 'h, depois pára — colete sempre!)\n' +
      '⬆️ Use o menu abaixo para **comprar** ou **melhorar** (cada nível rende +' + Math.round(BIZ_LEVEL_BONUS * 100) + '% da renda base).');
  const options = BUSINESSES.map((b) => {
    const lv = bizLevel(p, b.id);
    let label;
    let desc;
    if (!lv) { label = 'Comprar: ' + b.name; desc = money(b.price); }
    else if (lv >= BIZ_MAX_LEVEL) { label = b.name + ' (nível máximo)'; desc = 'Já está no máximo'; }
    else { label = 'Melhorar: ' + b.name + ' → nv ' + (lv + 1); desc = money(upgradeCost(b, lv)); }
    return { label: label.slice(0, 100), description: desc.slice(0, 100), value: b.id, emoji: b.emoji };
  });
  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('rpg:bizsel:' + uid).setPlaceholder('Comprar ou melhorar um negócio…').addOptions(options));
  const last = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:collect:' + uid).setLabel('Coletar').setEmoji('💰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [menu, last] };
}

/** Compra (se ainda não tem) ou melhora (se já tem) um negócio. */
function buyBiz(p, id) {
  const b = BUSINESSES.find((x) => x.id === id);
  if (!b) return '⚠️ Negócio inválido.';
  const lv = bizLevel(p, b.id);
  if (lv >= BIZ_MAX_LEVEL) return '🏆 ' + b.name + ' já está no nível máximo.';
  const cost = lv ? upgradeCost(b, lv) : b.price;
  if (p.cash < cost) return '💸 Faltam **' + money(cost - p.cash) + '** para ' + (lv ? 'melhorar ' : 'comprar ') + b.name + '.';
  const got = collect(p); // acerta o que já rendeu antes de mudar a renda
  p.cash -= cost;
  p.biz[b.id] = lv + 1;
  db.save();
  return (lv ? '⬆️ **' + b.emoji + ' ' + b.name + '** subiu para o nível ' + (lv + 1) + '!' : '🏢 Você comprou **' + b.emoji + ' ' + b.name + '**!') + (got ? ' (+' + money(got) + ' coletados)' : '');
}

/* ---------- classes ---------- */
function classView(p, uid, note) {
  const cur = CLASSES[p.cls];
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle('🎭 Escolha sua classe')
    .setDescription((note ? note + '\n\n' : '') + (cur ? 'Sua classe: **' + cur.emoji + ' ' + cur.name + '**. Trocar custa **' + money(CLASS_CHANGE_COST) + '**.\n\n' : 'A primeira escolha é **grátis**. Trocar depois custa **' + money(CLASS_CHANGE_COST) + '**.\n\n') +
      Object.values(CLASSES).map((c) => c.emoji + ' **' + c.name + '**\n' + c.desc).join('\n\n'));
  const row = new ActionRowBuilder().addComponents(Object.values(CLASSES).map((c) =>
    new ButtonBuilder().setCustomId('rpg:pickcls:' + uid + ':' + c.id).setLabel(c.name).setEmoji(c.emoji)
      .setStyle(p.cls === c.id ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(p.cls === c.id)));
  const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [row, back] };
}

function pickClass(p, id) {
  const c = CLASSES[id];
  if (!c) return '⚠️ Classe inválida.';
  if (p.cls === id) return 'Você já é ' + c.name + '.';
  const cost = p.cls ? CLASS_CHANGE_COST : 0;
  if (p.cash < cost) return '💸 Faltam **' + money(cost - p.cash) + '** para trocar de classe.';
  p.cash -= cost;
  p.cls = id;
  if (p.hp > maxHp(p)) p.hp = maxHp(p);
  db.save();
  return c.emoji + ' Agora você é **' + c.name + '**!' + (cost ? ' (−' + money(cost) + ')' : '');
}

/* ---------- missões diárias ---------- */
const dayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const MISSION_TYPES = [
  { type: 'win', label: (g) => 'Vença **' + g + '** lutas', goal: (l) => 2 + Math.floor(l / 6), icon: '⚔️' },
  { type: 'cash', label: (g) => 'Ganhe **' + money(g) + '** em lutas', goal: (l) => 60 + 30 * l, icon: '💵' },
  { type: 'xp', label: (g) => 'Ganhe **' + g + ' XP** em lutas', goal: (l) => 30 + 20 * l, icon: '⭐' },
  { type: 'heal', label: () => 'Use **1** kit médico', goal: () => 1, icon: '💊' },
  { type: 'collect', label: () => 'Colete a renda dos negócios **1** vez', goal: () => 1, icon: '💰' },
];
const missionReward = (lvl, p) => Math.round((90 + 30 * lvl) * (p ? clsOf(p).mission : 1));
const bonusReward = (lvl, p) => Math.round((200 + 45 * lvl) * (p ? clsOf(p).mission : 1));

function ensureDaily(p) {
  const day = dayKey();
  if (p.daily && p.daily.day === day) return;
  const pool = MISSION_TYPES.filter((m) => m.type !== 'collect' || Object.keys(p.biz).length).slice();
  const chosen = [];
  while (chosen.length < 3 && pool.length) chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  p.daily = { day, bonus: false, missions: chosen.map((m) => ({ type: m.type, goal: m.goal(p.lvl), done: 0, claimed: false })) };
}

function progress(p, type, amount) {
  if (!p.daily) return;
  for (const m of p.daily.missions) if (m.type === type && !m.claimed) m.done = Math.min(m.goal, m.done + amount);
}

function missionsView(p, uid, note) {
  const d = p.daily;
  const ready = d.missions.filter((m) => m.done >= m.goal && !m.claimed).length;
  const lines = d.missions.map((m) => {
    const t = MISSION_TYPES.find((x) => x.type === m.type);
    const state = m.claimed ? '✅ resgatada' : m.done >= m.goal ? '🎁 pronta!' : bar(m.done, m.goal, 8) + ' ' + m.done + '/' + m.goal;
    return t.icon + ' ' + t.label(m.goal) + '\n└ ' + state + ' • prêmio ' + money(missionReward(p.lvl, p));
  }).join('\n\n');
  const allClaimed = d.missions.every((m) => m.claimed);
  const embed = new EmbedBuilder().setColor(0xe67e22).setTitle('📋 Missões do dia')
    .setDescription((note ? note + '\n\n' : '') + lines + '\n\n🏅 Complete **todas** e ganhe bônus de ' + money(bonusReward(p.lvl, p)) + ' + 1 kit' + (d.bonus ? ' — ✅ já recebido' : '') +
      '\n🔄 Novas missões todo dia à meia-noite (horário de Brasília).');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:claim:' + uid).setLabel('Resgatar' + (ready ? ' (' + ready + ')' : '')).setEmoji('🎁').setStyle(ButtonStyle.Success).setDisabled(!ready && (d.bonus || !allClaimed)),
    new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [row] };
}

function claim(p) {
  const d = p.daily;
  let cash = 0;
  let n = 0;
  for (const m of d.missions) if (m.done >= m.goal && !m.claimed) { m.claimed = true; cash += missionReward(p.lvl, p); n++; }
  let text = n ? '🎁 ' + n + ' missão(ões) resgatada(s): **+' + money(cash) + '**' : '';
  if (!d.bonus && d.missions.every((m) => m.claimed)) {
    d.bonus = true;
    cash += bonusReward(p.lvl, p);
    p.kits++;
    text += (text ? '\n' : '') + '🏅 **Bônus do dia!** +' + money(bonusReward(p.lvl, p)) + ' e +1 💊 kit';
  }
  p.cash += cash;
  db.save();
  return text || 'Nada para resgatar ainda.';
}

/* ---------- duelos entre membros ---------- */
const duelCd = new Map();
const critHit = (p) => Math.random() < clsOf(p).crit;

function duelSim(a, b) {
  let ha = maxHp(a);
  let hb = maxHp(b);
  const maxA = ha;
  const maxB = hb;
  let turn = Math.random() < 0.5 ? 0 : 1;
  let rounds = 0;
  while (ha > 0 && hb > 0 && rounds < 60) {
    const att = turn === 0 ? a : b;
    const def = turn === 0 ? b : a;
    const dmg = Math.max(1, Math.round(atkOf(att) * (0.85 + Math.random() * 0.3) * (critHit(att) ? 1.8 : 1) * reduction(defOf(def))));
    if (turn === 0) hb -= dmg; else ha -= dmg;
    turn = 1 - turn;
    rounds++;
  }
  const winner = ha > 0 && hb <= 0 ? 'a' : hb > 0 && ha <= 0 ? 'b' : ha / maxA >= hb / maxB ? 'a' : 'b';
  return { winner, ha: Math.max(0, ha), hb: Math.max(0, hb), maxA, maxB, rounds };
}

function duelCard(p, name) {
  const w = weaponOf(p);
  const ar = armorOf(p);
  return (clsOf(p).emoji || '🕴️') + ' **' + name + '** • nv ' + p.lvl + '\n' + w.emoji + ' ' + w.name + ' • ' + ar.emoji + ' ' + ar.name + '\n❤️ ' + maxHp(p) + ' • ⚔️ ' + atkOf(p) + ' • 🛡️ ' + defOf(p);
}

async function duelStart(i) {
  const target = i.options.getUser('membro');
  const bet = i.options.getInteger('aposta') || 0;
  if (target.bot) return i.reply({ content: 'Bots não duelam. 🤖', flags: EPHEMERAL });
  if (target.id === i.user.id) return i.reply({ content: 'Você não pode duelar contra você mesmo.', flags: EPHEMERAL });
  const left = (duelCd.get(i.user.id) || 0) - Date.now();
  if (left > 0) return i.reply({ content: '⏳ Espere ' + Math.ceil(left / 1000) + 's para desafiar de novo.', flags: EPHEMERAL });
  const me = player(i.guild.id, i.user.id);
  if (me.cash < bet) return i.reply({ content: '💸 Você não tem ' + money(bet) + ' para apostar.', flags: EPHEMERAL });
  duelCd.set(i.user.id, Date.now() + 30000);
  const exp = (Date.now() + 2 * 60 * 1000).toString(36);
  const base = ':' + target.id + ':' + i.user.id + ':' + bet + ':' + exp;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:duelyes' + base).setLabel('Aceitar').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rpg:duelno' + base).setLabel('Recusar').setEmoji('🏳️').setStyle(ButtonStyle.Secondary));
  const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle('⚔️ Desafio de duelo!')
    .setDescription('<@' + i.user.id + '> desafiou <@' + target.id + '>' + (bet ? ' valendo **' + money(bet) + '**' : ' (sem aposta)') + '!\n\n' +
      duelCard(me, i.member?.displayName || i.user.username) + '\n\n' +
      '<@' + target.id + '>, você tem 2 minutos para aceitar. O duelo usa os equipamentos de cada um e **não gasta sua vida**.');
  return i.reply({ embeds: [embed], components: [row], allowedMentions: { users: [target.id] } });
}

const duelDone = new Set();
async function duelAnswer(i, parts) {
  const [, action, targetId, challengerId, betStr, expStr] = parts;
  const bet = Number(betStr) || 0;
  if (duelDone.has(i.message.id)) return i.reply({ content: 'Esse duelo já foi resolvido.', flags: EPHEMERAL });
  if (Date.now() > parseInt(expStr, 36)) {
    duelDone.add(i.message.id);
    return i.update({ embeds: [new EmbedBuilder().setColor(0x808080).setTitle('⌛ Desafio expirado').setDescription('<@' + targetId + '> não respondeu a tempo.')], components: [], allowedMentions: { parse: [] } });
  }
  duelDone.add(i.message.id);
  if (duelDone.size > 500) duelDone.delete(duelDone.values().next().value);
  if (action === 'duelno') {
    return i.update({ embeds: [new EmbedBuilder().setColor(0x808080).setTitle('🏳️ Desafio recusado').setDescription('<@' + targetId + '> recusou o duelo de <@' + challengerId + '>.')], components: [], allowedMentions: { parse: [] } });
  }
  const a = player(i.guild.id, challengerId);
  const b = player(i.guild.id, targetId);
  if (bet && (a.cash < bet || b.cash < bet)) {
    return i.update({ embeds: [new EmbedBuilder().setColor(0x808080).setTitle('💸 Duelo cancelado').setDescription('Um dos dois não tem mais ' + money(bet) + ' para a aposta.')], components: [], allowedMentions: { parse: [] } });
  }
  const names = async (id) => { const m = await i.guild.members.fetch(id).catch(() => null); return (m && m.displayName) || 'Membro'; };
  const na = await names(challengerId);
  const nb = await names(targetId);
  const r = duelSim(a, b);
  const winId = r.winner === 'a' ? challengerId : targetId;
  const win = r.winner === 'a' ? a : b;
  const lose = r.winner === 'a' ? b : a;
  win.duelWins = (win.duelWins || 0) + 1;
  lose.duelLosses = (lose.duelLosses || 0) + 1;
  if (bet) { win.cash += bet; lose.cash -= bet; }
  db.save();
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 Duelo: ' + na + ' vs ' + nb)
    .setDescription(duelCard(a, na) + '\n\n' + duelCard(b, nb) + '\n\n⚔️ ' + r.rounds + ' golpes • ❤️ ' + na + ': ' + r.ha + '/' + r.maxA + ' • ❤️ ' + nb + ': ' + r.hb + '/' + r.maxB +
      '\n\n👑 **Vencedor: <@' + winId + '>**' + (bet ? ' — leva ' + money(bet) + '!' : '!'));
  return i.update({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
}

/* ---------- chefão da semana ---------- */
const BOSS_NAMES = [['Don Vittorio, o Cão Sarnento', '🐺'], ['O Barão do Porto', '⚓'], ['A Viúva Negra', '🕷️'], ['Capo dei Capi', '👑'], ['O Senhor do Submundo', '😈'], ['Il Dottore', '🩺'], ['A Sombra de Palermo', '🥷']];
const BOSS_TRIES_PER_DAY = 3;
const BOSS_ROUNDS = 8;

function weekKey() {
  const [y, m, d] = dayKey().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(d - ((dt.getUTCDay() + 6) % 7)); // segunda-feira
  return dt.toISOString().slice(0, 10);
}

const power = (p) => atkOf(p) * maxHp(p) / reduction(defOf(p));
const topRank = (boss) => Object.entries(boss.dmg).sort((x, y) => y[1] - x[1]);

/** Paga os prêmios (uma vez só). share = fração do prêmio total distribuída pelo dano. */
function payBoss(guildId, boss, share, finisher) {
  if (boss.paid) return [];
  boss.paid = true;
  const rank = topRank(boss);
  const total = rank.reduce((s, [, d]) => s + d, 0) || 1;
  const pool = Math.round(boss.pool * share);
  const lines = [];
  rank.forEach(([id, d], n) => {
    const p = (db.data.rpg[guildId] ||= {})[id];
    if (!p) return;
    let cash = Math.max(100, Math.round(pool * d / total));
    let extra = '';
    if (n === 0) { p.kits = (p.kits || 0) + 2; extra += ' +2 💊'; }
    else if (n < 3) { p.kits = (p.kits || 0) + 1; extra += ' +1 💊'; }
    if (finisher && id === finisher) { cash += Math.round(boss.pool * 0.1); extra += ' (golpe final!)'; }
    p.cash += cash;
    lines.push((['🥇', '🥈', '🥉'][n] || '▫️') + ' <@' + id + '> — ' + d.toLocaleString('pt-BR') + ' de dano • +' + money(cash) + extra);
  });
  db.save();
  return lines.slice(0, 10);
}

function ensureBoss(guildId, announce) {
  const store = db.data.rpgboss;
  const wk = weekKey();
  let boss = store[guildId];
  let escaped = null;
  if (boss && boss.week !== wk) {
    // o chefe da semana passada: paga 30% do prêmio pela participação, se ninguém o derrubou
    if (!boss.defeated && !boss.paid && Object.keys(boss.dmg).length) escaped = { boss, lines: payBoss(guildId, boss, 0.3) };
    boss = null;
  }
  if (!boss) {
    const players = Object.values(db.data.rpg[guildId] || {}).filter((p) => p && p.lvl);
    const top = players.sort((x, y) => power(y) - power(x))[0] || { lvl: 1, weapon: '', armor: '', cls: '' };
    const [name, emoji] = BOSS_NAMES[Math.floor(Date.parse(wk) / 604800000) % BOSS_NAMES.length];
    const hpMax = Math.max(400, Math.round(atkOf(top) * BOSS_ROUNDS * 35));
    boss = {
      week: wk, name, emoji, level: top.lvl + 2, hpMax, hp: hpMax,
      atk: Math.max(10, Math.round(maxHp(top) * 0.075 / reduction(defOf(top)))),
      pool: Math.round(3000 + top.lvl * 900), dmg: {}, tries: {}, defeated: false, paid: false,
    };
    store[guildId] = boss;
    db.save();
    if (announce) announce('new', boss);
  }
  return { boss, escaped };
}

function bossView(p, uid, boss, note) {
  const day = dayKey();
  const used = p.bossDay === day ? p.bossTries || 0 : 0;
  const left = Math.max(0, BOSS_TRIES_PER_DAY - used);
  const rank = topRank(boss).slice(0, 5).map(([id, d], n) => (['🥇', '🥈', '🥉'][n] || '▫️') + ' <@' + id + '> — ' + d.toLocaleString('pt-BR')).join('\n') || 'Ninguém atacou ainda.';
  const mine = boss.dmg[uid] || 0;
  const embed = new EmbedBuilder().setColor(boss.defeated ? 0x23a55a : 0x8e44ad).setTitle(boss.emoji + ' Chefão da semana: ' + boss.name)
    .setDescription((note ? note + '\n\n' : '') +
      (boss.defeated ? '✅ **Derrotado!** Voltará na próxima segunda-feira.' : '❤️ ' + bar(boss.hp, boss.hpMax, 12) + ' ' + boss.hp.toLocaleString('pt-BR') + '/' + boss.hpMax.toLocaleString('pt-BR')) +
      '\n\n**Ranking de dano**\n' + rank + '\n\nSeu dano: **' + mine.toLocaleString('pt-BR') + '** • Tentativas hoje: **' + left + '/' + BOSS_TRIES_PER_DAY + '**' +
      '\n\n🎁 Prêmio total: ' + money(boss.pool) + ' dividido pelo dano de cada um + kits para o top 3. Se ninguém o derrubar até domingo, ele escapa e paga só 30%.' +
      '\n⚠️ Cada ataque dura até ' + BOSS_ROUNDS + ' rodadas e custa vida (precisa de mais de 35%).');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:bossatk:' + uid).setLabel('Atacar').setEmoji('⚔️').setStyle(ButtonStyle.Danger).setDisabled(boss.defeated || left < 1),
    new ButtonBuilder().setCustomId('rpg:boss:' + uid).setLabel('Atualizar').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [row] };
}

/** Um ataque ao chefão. Devolve { text, killed }. */
function bossAttack(p, uid, boss) {
  if (boss.defeated) return { text: '✅ O chefão já foi derrotado esta semana!' };
  const day = dayKey();
  if (p.bossDay !== day) { p.bossDay = day; p.bossTries = 0; }
  if (p.bossTries >= BOSS_TRIES_PER_DAY) return { text: '⏳ Você já usou as ' + BOSS_TRIES_PER_DAY + ' tentativas de hoje. Volte amanhã!' };
  if (p.hp < Math.ceil(maxHp(p) * 0.35)) return { text: '🩸 Você está ferido demais. Use um 💊 kit ou espere a vida voltar.' };
  p.bossTries++;
  let hp = p.hp;
  let dealt = 0;
  let r = 0;
  for (; r < BOSS_ROUNDS && hp > 0; r++) {
    const crit = critHit(p);
    dealt += Math.max(1, Math.round(atkOf(p) * (0.85 + Math.random() * 0.3) * (crit ? 1.8 : 1)));
    hp -= Math.max(1, Math.round(boss.atk * (0.85 + Math.random() * 0.3) * reduction(defOf(p))));
  }
  const ko = hp <= 0;
  p.hp = ko ? Math.max(1, Math.round(maxHp(p) * 0.1)) : hp;
  dealt = Math.min(dealt, boss.hp);
  boss.hp -= dealt;
  boss.dmg[uid] = (boss.dmg[uid] || 0) + dealt;
  let killed = false;
  if (boss.hp <= 0) { boss.hp = 0; boss.defeated = true; killed = true; }
  db.save();
  return { text: boss.emoji + ' Você atacou **' + boss.name + '** por ' + r + ' rodada(s) e causou **' + dealt.toLocaleString('pt-BR') + '** de dano!' + (ko ? '\n💫 Você foi nocauteado e ficou com ' + p.hp + ' de vida.' : '\n❤️ Vida: ' + p.hp + '/' + maxHp(p)), killed };
}

/* ---------- ações ---------- */
function fight(p, uid) {
  const left = (fightCd.get(uid) || 0) - Date.now();
  if (left > 0) return { text: '⏳ Respire um pouco: espere **' + Math.ceil(left / 1000) + 's** para a próxima luta.' };
  if (p.hp < Math.ceil(maxHp(p) * 0.35)) return { text: '🩸 Você está ferido demais para lutar. Use um 💊 kit ou espere sua vida voltar.' };
  fightCd.set(uid, Date.now() + 12000);
  const e = pickEnemy(p.lvl);
  const hpBefore = p.hp;
  const r = simulate(p, e);
  p.hp = r.won ? r.ph : Math.max(1, Math.round(maxHp(p) * 0.25));
  const rounds = r.log.length;
  const sum = '⚔️ ' + rounds + ' rodada(s) • ❤️ você: ' + hpBefore + ' → ' + (r.won ? r.ph : 0) + ' • ' + e.emoji + ' rival: ' + bar(r.won ? 0 : r.eh, e.hp, 8);
  let text;
  let won = r.won;
  if (r.won) {
    const cash = Math.round(rand(e.cash[0], e.cash[1]) * clsOf(p).cash);
    p.cash += cash; p.xp += e.xp; p.wins++;
    progress(p, 'win', 1); progress(p, 'cash', cash); progress(p, 'xp', e.xp);
    text = (e.boss ? '👑 **O Chefão em pessoa!** ' : '') + e.emoji + ' **' + e.name + '** foi derrubado!\n' + sum + '\n🏆 **Vitória!** +' + money(cash) + ' • +' + e.xp + ' XP';
    while (p.xp >= xpNeeded(p.lvl)) {
      p.xp -= xpNeeded(p.lvl);
      p.lvl++;
      p.hp = maxHp(p);
      text += '\n🎉 **Subiu para o nível ' + p.lvl + '!** Vida restaurada.';
    }
  } else {
    const lost = Math.floor(p.cash * 0.05);
    p.cash -= lost; p.losses++;
    text = e.emoji + ' **' + e.name + '** foi mais forte.\n' + sum + '\n💀 **Derrota!** Perdeu ' + money(lost) + '. Dica: compre arma/proteção na 🛒 Loja ou use um kit antes de lutar.';
  }
  db.save();
  return { text, won };
}

function useKit(p) {
  if (p.kits < 1) return '💊 Você não tem kits. Compre na 🛒 Loja.';
  if (p.hp >= maxHp(p)) return '❤️ Sua vida já está cheia.';
  p.kits--;
  progress(p, 'heal', 1);
  p.hp = Math.min(maxHp(p), p.hp + kitHeal(p));
  db.save();
  return '💊 Kit usado! Vida: **' + p.hp + '/' + maxHp(p) + '**';
}

function buy(p, list, id, field) {
  const it = list.find((x) => x.id === id);
  if (!it) return '⚠️ Item inválido.';
  const cur = list.findIndex((x) => x.id === p[field]);
  if (list.indexOf(it) <= cur) return '✅ Você já tem algo igual ou melhor.';
  if (p.cash < it.price) return '💸 Faltam **' + money(it.price - p.cash) + '** para comprar ' + it.name + '.';
  p.cash -= it.price;
  p[field] = it.id;
  db.save();
  return '🛍️ Você comprou **' + it.emoji + ' ' + it.name + '**!';
}

/* ---------- entradas ---------- */
async function handleSlash(i, helpers) {
  if (!NAMES.has(i.commandName)) return false;
  if (!helpers.gameAllowed(i)) return true;
  if (i.commandName === 'aventura') {
    const p = player(i.guild.id, i.user.id);
    db.save();
    await i.reply({ embeds: [profileEmbed(p, i.user, '🕴️ Bem-vindo ao submundo! Lute, junte grana e compre equipamentos.')], components: menuRows(i.user.id), flags: EPHEMERAL });
    return true;
  }
  if (i.commandName === 'duelo') { await duelStart(i); return true; }
  if (i.commandName === 'chefe') {
    const p = player(i.guild.id, i.user.id);
    const { boss, escaped } = ensureBoss(i.guild.id);
    await announceEscaped(i.channel, escaped);
    await i.reply({ ...bossView(p, i.user.id, boss), flags: EPHEMERAL, allowedMentions: { parse: [] } });
    return true;
  }
  const all = Object.entries(db.data.rpg[i.guild.id] || {}).sort((a, b) => b[1].lvl - a[1].lvl || b[1].xp - a[1].xp || b[1].wins - a[1].wins).slice(0, 10);
  const medals = ['🥇', '🥈', '🥉'];
  const text = all.map(([id, p], n) => (medals[n] || '**' + (n + 1) + '.**') + ' <@' + id + '> — nível **' + p.lvl + '** • ' + p.wins + ' vitórias • ' + money(p.cash)).join('\n') || 'Ninguém jogou ainda. Use /aventura!';
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xb8860b).setTitle('🏆 Maiores mafiosos').setDescription(text)], allowedMentions: { parse: [] } });
  return true;
}

/** Se o chefe da semana passada escapou, avisa o canal com quem recebeu o quê. */
async function announceEscaped(channel, escaped) {
  if (!escaped || !escaped.lines.length || !channel) return;
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x808080).setTitle('🌫️ ' + escaped.boss.name + ' escapou!').setDescription('Ninguém o derrubou a tempo. Prêmio de participação:\n' + escaped.lines.join('\n'))], allowedMentions: { parse: [] } }).catch(() => {});
}

async function handleButton(i) {
  const [, action, uid, extra] = i.customId.split(':');
  if (action === 'duelyes' || action === 'duelno') {
    if (i.user.id !== uid) return i.reply({ content: 'Só quem foi desafiado pode responder.', flags: EPHEMERAL });
    return duelAnswer(i, i.customId.split(':'));
  }
  if (i.user.id !== uid) return i.reply({ content: 'Esse menu é de outra pessoa. Use /aventura para abrir o seu.', flags: EPHEMERAL });
  const p = player(i.guild.id, uid);
  const back = (extraText, color) => {
    const embeds = [];
    if (extraText && color) embeds.push(new EmbedBuilder().setColor(color).setDescription(extraText));
    embeds.push(profileEmbed(p, i.user, color ? '' : extraText));
    return i.update({ embeds, components: menuRows(uid) });
  };
  switch (action) {
    case 'menu': return back();
    case 'fight': { const f = fight(p, uid); return back(f.text, f.won === undefined ? 0x808080 : f.won ? 0x23a55a : 0xda373c); }
    case 'kit': return back(useKit(p));
    case 'shop': return i.update(shopView(p, uid));
    case 'buyw': return i.update(shopView(p, uid, buy(p, WEAPONS, extra, 'weapon')));
    case 'buya': return i.update(shopView(p, uid, buy(p, ARMORS, extra, 'armor')));
    case 'biz': return i.update(bizView(p, uid));
    case 'missions': return i.update(missionsView(p, uid));
    case 'claim': { const t = claim(p); return i.update(missionsView(p, uid, t)); }
    case 'collect': {
      const n = pending(p);
      if (!Object.keys(p.biz).length) return i.update(bizView(p, uid, '🏢 Você ainda não tem negócios. Compre o primeiro!'));
      if (n < 1) return i.update(bizView(p, uid, '⏳ Ainda não rendeu nada para coletar.'));
      collect(p);
      return i.update(bizView(p, uid, '💰 Você coletou **' + money(n) + '**!'));
    }
    case 'boss': {
      const { boss, escaped } = ensureBoss(i.guild.id);
      await announceEscaped(i.channel, escaped);
      return i.update(bossView(p, uid, boss));
    }
    case 'bossatk': {
      const { boss, escaped } = ensureBoss(i.guild.id);
      await announceEscaped(i.channel, escaped);
      const r = bossAttack(p, uid, boss);
      await i.update(bossView(p, uid, boss, r.text));
      if (r.killed) {
        const lines = payBoss(i.guild.id, boss, 1, uid);
        await i.channel.send({ embeds: [new EmbedBuilder().setColor(0x23a55a).setTitle('☠️ ' + boss.name + ' foi derrotado!')
          .setDescription('<@' + uid + '> deu o golpe final! Prêmios:\n' + lines.join('\n'))], allowedMentions: { parse: [] } }).catch(() => {});
      }
      return;
    }
    case 'class': return i.update(classView(p, uid));
    case 'pickcls': return i.update(classView(p, uid, pickClass(p, extra)));
    case 'buykit': {
      if (p.cash < KIT.price) return i.update(shopView(p, uid, '💸 Faltam ' + money(KIT.price - p.cash) + ' para um kit.'));
      p.cash -= KIT.price; p.kits++; db.save();
      return i.update(shopView(p, uid, '💊 Kit comprado! Você tem ' + p.kits + '.'));
    }
  }
}

async function handleSelect(i) {
  const [, action, uid] = i.customId.split(':');
  if (i.user.id !== uid) return i.reply({ content: 'Esse menu é de outra pessoa. Use /aventura para abrir o seu.', flags: EPHEMERAL });
  const p = player(i.guild.id, uid);
  if (action === 'bizsel') return i.update(bizView(p, uid, buyBiz(p, i.values[0])));
}

module.exports = { commands, handleSlash, handleButton, handleSelect, _t: { duelSim, ensureBoss, bossAttack, payBoss, weekKey, power, BOSS_TRIES_PER_DAY, pickEnemy, simulate, player, atkOf, defOf, maxHp, WEAPONS, ARMORS, xpNeeded, fight, buy, useKit, fightCd, buyBiz, collect, pending, incomePerHour, pickClass, clsOf, bizLevel, upgradeCost, ensureDaily, progress, claim, MISSION_TYPES } };
