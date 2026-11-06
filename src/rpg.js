// RPG de aventura estilo máfia: lute contra rivais, ganhe grana, compre armas e proteção.
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const db = require('./db');

const EPHEMERAL = MessageFlags.Ephemeral;
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const money = (n) => '$' + Number(n).toLocaleString('pt-BR');

const commands = [
  new SlashCommandBuilder().setName('aventura').setDescription('🕴️ Sua carreira na máfia: lute, ganhe grana e compre equipamentos'),
  new SlashCommandBuilder().setName('aventuraranking').setDescription('🏆 Os maiores mafiosos do servidor'),
];
const NAMES = new Set(commands.map((c) => c.name));

/* ---------- conteúdo (vem de rpgdata.js: é lá que você amplia o jogo) ---------- */
const { ENEMIES, ITEMS, TITLES, START, BUSINESSES, BIZ_CAP_HOURS } = require('./rpgdata');
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
const maxHp = (p) => 100 + 12 * (p.lvl - 1);
const atkOf = (p) => 6 + 2 * p.lvl + weaponOf(p).atk;
const defOf = (p) => armorOf(p).def;
const reduction = (def) => 100 / (100 + def * 8);
const titleOf = (lvl) => { let t = TITLES[0][1]; for (const [min, name] of TITLES) if (lvl >= min) t = name; return t; };
const kitHeal = (p) => Math.max(KIT.flat, Math.round(maxHp(p) * KIT.heal));

function player(guildId, userId) {
  const g = (db.data.rpg[guildId] ??= {});
  const p = (g[userId] ??= { ...START, biz: [], tick: Date.now() });
  if (!Array.isArray(p.biz)) { p.biz = []; p.collectAt = 0; }
  // regeneração passiva: 2% da vida máxima por minuto
  const now = Date.now();
  const mins = (now - (p.tick || now)) / 60000;
  if (mins >= 0.5 && p.hp < maxHp(p)) p.hp = Math.min(maxHp(p), p.hp + Math.floor(mins * 0.02 * maxHp(p)));
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
  const pool = Math.random() < 0.25 ? eligible : eligible.slice(-3);
  const e = pick(pool);
  return { name: e.name, emoji: e.emoji, hp: e.hp, atk: e.atk, cash: e.cash, xp: e.xp, boss: e.id === 'chefao' };
}

function simulate(p, e) {
  let ph = p.hp;
  let eh = e.hp;
  const log = [];
  for (let r = 1; r <= 30 && ph > 0 && eh > 0; r++) {
    const d1 = Math.max(1, Math.round(atkOf(p) * (0.85 + Math.random() * 0.3)));
    eh -= d1;
    if (eh <= 0) { log.push('💥 Você acertou **' + d1 + '** e derrubou o rival!'); break; }
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
  const e = new EmbedBuilder().setColor(0xb8860b).setTitle('🕴️ ' + user.username + ' • ' + titleOf(p.lvl) + ' (nível ' + p.lvl + ')')
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

function menuRow(uid) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:fight:' + uid).setLabel('Lutar').setEmoji('⚔️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rpg:kit:' + uid).setLabel('Usar kit').setEmoji('💊').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rpg:shop:' + uid).setLabel('Loja').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rpg:biz:' + uid).setLabel('Negócios').setEmoji('🏢').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Perfil').setEmoji('🪪').setStyle(ButtonStyle.Secondary));
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

/* ---------- negócios (renda por hora) ---------- */
const incomePerHour = (p) => BUSINESSES.filter((b) => p.biz.includes(b.id)).reduce((s, b) => s + b.income, 0);
function pending(p) {
  if (!p.biz.length || !p.collectAt) return 0;
  const hours = Math.min(BIZ_CAP_HOURS, (Date.now() - p.collectAt) / 3600000);
  return Math.floor(incomePerHour(p) * hours);
}
function collect(p) {
  const n = pending(p);
  p.cash += n;
  p.collectAt = Date.now();
  db.save();
  return n;
}

function bizView(p, uid, note) {
  const list = BUSINESSES.map((b) => (p.biz.includes(b.id) ? '✅ ' : '') + b.emoji + ' **' + b.name + '** — rende ' + money(b.income) + '/h — ' + (p.biz.includes(b.id) ? 'seu' : money(b.price))).join('\n');
  const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle('🏢 Seus negócios')
    .setDescription((note ? note + '\n\n' : '') + '💵 Você tem **' + money(p.cash) + '**\n\n' + list +
      '\n\n💰 Para coletar: **' + money(pending(p)) + '**\n📈 Renda: **' + money(incomePerHour(p)) + '/h** (acumula até ' + BIZ_CAP_HOURS + 'h, depois pára — colete sempre!)');
  const buys = new ActionRowBuilder().addComponents(BUSINESSES.map((b) =>
    new ButtonBuilder().setCustomId('rpg:buyb:' + uid + ':' + b.id).setLabel(b.name.split(' ')[0].slice(0, 20)).setEmoji(b.emoji)
      .setStyle(ButtonStyle.Secondary).setDisabled(p.biz.includes(b.id))));
  const last = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rpg:collect:' + uid).setLabel('Coletar').setEmoji('💰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rpg:menu:' + uid).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [buys, last] };
}

function buyBiz(p, id) {
  const b = BUSINESSES.find((x) => x.id === id);
  if (!b) return '⚠️ Negócio inválido.';
  if (p.biz.includes(b.id)) return '✅ Esse negócio já é seu.';
  if (p.cash < b.price) return '💸 Faltam **' + money(b.price - p.cash) + '** para comprar ' + b.name + '.';
  const got = collect(p); // acerta o que já rendeu antes de mudar a renda
  p.cash -= b.price;
  p.biz.push(b.id);
  if (!p.collectAt) p.collectAt = Date.now();
  db.save();
  return '🏢 Você comprou **' + b.emoji + ' ' + b.name + '**!' + (got ? ' (+' + money(got) + ' coletados)' : '');
}

/* ---------- ações ---------- */
function fight(p, uid) {
  const left = (fightCd.get(uid) || 0) - Date.now();
  if (left > 0) return { text: '⏳ Respire um pouco: espere **' + Math.ceil(left / 1000) + 's** para a próxima luta.' };
  if (p.hp < Math.ceil(maxHp(p) * 0.2)) return { text: '🩸 Você está ferido demais para lutar. Use um 💊 kit ou espere sua vida voltar.' };
  fightCd.set(uid, Date.now() + 12000);
  const e = pickEnemy(p.lvl);
  const hpBefore = p.hp;
  const r = simulate(p, e);
  p.hp = r.won ? r.ph : Math.max(1, Math.round(maxHp(p) * 0.15));
  const rounds = r.log.length;
  const sum = '⚔️ ' + rounds + ' rodada(s) • ❤️ você: ' + hpBefore + ' → ' + (r.won ? r.ph : 0) + ' • ' + e.emoji + ' rival: ' + bar(r.won ? 0 : r.eh, e.hp, 8);
  let text;
  let won = r.won;
  if (r.won) {
    const cash = rand(e.cash[0], e.cash[1]);
    p.cash += cash; p.xp += e.xp; p.wins++;
    text = (e.boss ? '👑 **O Chefão em pessoa!** ' : '') + e.emoji + ' **' + e.name + '** foi derrubado!\n' + sum + '\n🏆 **Vitória!** +' + money(cash) + ' • +' + e.xp + ' XP';
    while (p.xp >= xpNeeded(p.lvl)) {
      p.xp -= xpNeeded(p.lvl);
      p.lvl++;
      p.hp = maxHp(p);
      text += '\n🎉 **Subiu para o nível ' + p.lvl + '!** Vida restaurada.';
    }
  } else {
    const lost = Math.floor(p.cash * 0.1);
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
    await i.reply({ embeds: [profileEmbed(p, i.user, '🕴️ Bem-vindo ao submundo! Lute, junte grana e compre equipamentos.')], components: [menuRow(i.user.id)], flags: EPHEMERAL });
    return true;
  }
  const all = Object.entries(db.data.rpg[i.guild.id] || {}).sort((a, b) => b[1].lvl - a[1].lvl || b[1].xp - a[1].xp || b[1].wins - a[1].wins).slice(0, 10);
  const medals = ['🥇', '🥈', '🥉'];
  const text = all.map(([id, p], n) => (medals[n] || '**' + (n + 1) + '.**') + ' <@' + id + '> — nível **' + p.lvl + '** • ' + p.wins + ' vitórias • ' + money(p.cash)).join('\n') || 'Ninguém jogou ainda. Use /aventura!';
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xb8860b).setTitle('🏆 Maiores mafiosos').setDescription(text)], allowedMentions: { parse: [] } });
  return true;
}

async function handleButton(i) {
  const [, action, uid, extra] = i.customId.split(':');
  if (i.user.id !== uid) return i.reply({ content: 'Esse menu é de outra pessoa. Use /aventura para abrir o seu.', flags: EPHEMERAL });
  const p = player(i.guild.id, uid);
  const back = (extraText, color) => {
    const embeds = [];
    if (extraText && color) embeds.push(new EmbedBuilder().setColor(color).setDescription(extraText));
    embeds.push(profileEmbed(p, i.user, color ? '' : extraText));
    return i.update({ embeds, components: [menuRow(uid)] });
  };
  switch (action) {
    case 'menu': return back();
    case 'fight': { const f = fight(p, uid); return back(f.text, f.won === undefined ? 0x808080 : f.won ? 0x23a55a : 0xda373c); }
    case 'kit': return back(useKit(p));
    case 'shop': return i.update(shopView(p, uid));
    case 'buyw': return i.update(shopView(p, uid, buy(p, WEAPONS, extra, 'weapon')));
    case 'buya': return i.update(shopView(p, uid, buy(p, ARMORS, extra, 'armor')));
    case 'biz': return i.update(bizView(p, uid));
    case 'collect': {
      const n = pending(p);
      if (!p.biz.length) return i.update(bizView(p, uid, '🏢 Você ainda não tem negócios. Compre o primeiro!'));
      if (n < 1) return i.update(bizView(p, uid, '⏳ Ainda não rendeu nada para coletar.'));
      collect(p);
      return i.update(bizView(p, uid, '💰 Você coletou **' + money(n) + '**!'));
    }
    case 'buyb': return i.update(bizView(p, uid, buyBiz(p, extra)));
    case 'buykit': {
      if (p.cash < KIT.price) return i.update(shopView(p, uid, '💸 Faltam ' + money(KIT.price - p.cash) + ' para um kit.'));
      p.cash -= KIT.price; p.kits++; db.save();
      return i.update(shopView(p, uid, '💊 Kit comprado! Você tem ' + p.kits + '.'));
    }
  }
}

module.exports = { commands, handleSlash, handleButton, _t: { pickEnemy, simulate, player, atkOf, defOf, maxHp, WEAPONS, ARMORS, xpNeeded, fight, buy, useKit, fightCd, buyBiz, collect, pending, incomePerHour } };
