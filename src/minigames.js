// Mini jogos extras: /ship (compatibilidade) e /rali (rali de palavras).
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const crypto = require('crypto');

const EPHEMERAL = MessageFlags.Ephemeral;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const commands = [
  new SlashCommandBuilder().setName('ship').setDescription('Mede a compatibilidade entre dois membros 💘')
    .addUserOption((o) => o.setName('membro').setDescription('Primeira pessoa').setRequired(true))
    .addUserOption((o) => o.setName('com').setDescription('Segunda pessoa (se vazio, é você)')),
  new SlashCommandBuilder().setName('rali').setDescription('Rali de palavras: cada palavra começa com a última letra da anterior')
    .addSubcommand((s) => s.setName('iniciar').setDescription('Começa um rali neste canal'))
    .addSubcommand((s) => s.setName('parar').setDescription('Encerra o rali e mostra o placar')),
];
const NAMES = new Set(commands.map((c) => c.name));

/* ---------- /ship ---------- */
const TIERS = [
  [0, ['💔 Nem a pau. Melhor ficarem só na amizade.', '🧊 Frio igual o polo sul.', '🙈 Nem o destino quis tentar.']],
  [20, ['😬 Difícil, mas milagres existem.', '🌧️ Muito pouca química por aqui.', '🤝 Melhor como colegas.']],
  [40, ['🙂 Tem uma chance, se esforçarem.', '🌱 Uma sementinha de algo bom.', '☕ Um café pode ajudar.']],
  [60, ['😊 Olha só, tem química!', '✨ A coisa está esquentando.', '🎵 Dá até para dançar junto.']],
  [80, ['😍 Que casal lindo!', '🔥 Faíscas por todos os lados!', '💞 O universo está torcendo por vocês.']],
  [100, ['💘 ALMAS GÊMEAS! Casem logo!', '👑 Casal perfeito, sem discussão.']],
];

function shipScore(a, b) {
  if (a === b) return 100;
  const key = [a, b].sort().join(':') + ':qsd-ship';
  return crypto.createHash('sha256').update(key).digest().readUInt16BE(0) % 101;
}

function shipName(n1, n2) {
  const a = n1.replace(/[^\p{L}\p{N}]/gu, '') || n1;
  const b = n2.replace(/[^\p{L}\p{N}]/gu, '') || n2;
  return a.slice(0, Math.ceil(a.length / 2)) + b.slice(Math.floor(b.length / 2));
}

function shipPhrase(score, seed) {
  let list = TIERS[0][1];
  for (const [min, l] of TIERS) if (score >= min) list = l;
  return list[seed % list.length];
}

async function ship(i) {
  const u1 = i.options.getUser('membro');
  const u2 = i.options.getUser('com') || i.user;
  const m1 = await i.guild.members.fetch(u1.id).catch(() => null);
  const m2 = await i.guild.members.fetch(u2.id).catch(() => null);
  const n1 = (m1 && m1.displayName) || u1.username;
  const n2 = (m2 && m2.displayName) || u2.username;
  const score = shipScore(u1.id, u2.id);
  const filled = Math.round(score / 10);
  const bar = '❤️'.repeat(filled) + '🖤'.repeat(10 - filled);
  const color = score >= 80 ? 0xff3b6b : score >= 50 ? 0xf0b232 : score >= 25 ? 0x5865f2 : 0x80848e;
  const same = u1.id === u2.id;
  const embed = new EmbedBuilder().setColor(color).setTitle('💘 Ship: ' + shipName(n1, n2))
    .setDescription('**' + n1.replace(/[*_~|>\u0060]/g, '') + '** ➕ **' + n2.replace(/[*_~|>\u0060]/g, '') + '**\n\n' + bar + '\n# ' + score + '%\n' +
      (same ? '🪞 Amor próprio é o mais importante!' : shipPhrase(score, parseInt(u1.id.slice(-3), 10) + parseInt(u2.id.slice(-3), 10))));
  return i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

/* ---------- /rali (rali de palavras) ---------- */
const START_WORDS = ['banana', 'cidade', 'estrela', 'floresta', 'montanha', 'pirata', 'dragao', 'oceano', 'tesouro', 'guerreiro', 'cavalo', 'janela', 'musica', 'ferro', 'moeda', 'castelo', 'tempestade', 'aventura', 'rainha', 'lanterna'];
const WORD = /^[\p{L}]{3,25}$/u;
const IDLE_MS = 60 * 1000;
const rallies = new Map(); // canal -> jogo

const lastLetter = (w) => norm(w).slice(-1);
const firstLetter = (w) => norm(w).slice(0, 1);
const points = (w) => 1 + Math.floor(w.length / 5);

function scoreboard(game) {
  const list = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
  const medals = ['🥇', '🥈', '🥉'];
  return list.slice(0, 10).map(([id, p], n) => (medals[n] || '**' + (n + 1) + '.**') + ' <@' + id + '> — ' + p + ' pts').join('\n') || 'Ninguém jogou. 😅';
}

async function endRally(channel, why, reward) {
  const game = rallies.get(channel.id);
  if (!game) return;
  clearTimeout(game.timer);
  rallies.delete(channel.id);
  const list = [...game.scores.entries()].sort((a, b) => b[1] - a[1]);
  const embed = new EmbedBuilder().setColor(0x23a55a).setTitle('🏁 Rali encerrado!')
    .setDescription(why + '\n\n' + scoreboard(game) + '\n\nPalavras válidas: **' + game.count + '**');
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  if (list.length && game.count >= 5 && reward) {
    const member = await channel.guild.members.fetch(list[0][0]).catch(() => null);
    if (member) await reward(channel.guild, member, channel);
  }
}

function armTimer(channel, game, reward) {
  clearTimeout(game.timer);
  game.timer = setTimeout(() => endRally(channel, '⏰ Ninguém respondeu por 1 minuto.', reward), IDLE_MS);
}

async function startRally(i, helpers) {
  if (!helpers.gameAllowed(i)) return;
  if (rallies.has(i.channelId)) return i.reply({ content: 'Já existe um rali neste canal! Continue jogando ou use /rali parar.', flags: EPHEMERAL });
  const word = pick(START_WORDS);
  const game = { last: word, used: new Set([norm(word)]), lastUser: '', scores: new Map(), count: 0, starter: i.user.id, timer: null };
  rallies.set(i.channelId, game);
  armTimer(i.channel, game, helpers.reward);
  return i.reply('🏁 **Rali de palavras!** Digite uma palavra que comece com a **última letra** da anterior.\n' +
    '• Não vale repetir palavra nem jogar duas vezes seguidas.\n• Palavras com 3+ letras, uma por mensagem.\n• O rali termina após 1 minuto sem jogadas.\n\n' +
    'Palavra inicial: **' + word.toUpperCase() + '** → comece com **' + lastLetter(word).toUpperCase() + '**');
}

async function stopRally(i, helpers) {
  const game = rallies.get(i.channelId);
  if (!game) return i.reply({ content: 'Não há rali rolando neste canal.', flags: EPHEMERAL });
  if (i.user.id !== game.starter && !i.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    return i.reply({ content: 'Só quem começou o rali ou a equipe pode encerrar.', flags: EPHEMERAL });
  }
  await i.reply({ content: '🛑 Rali encerrado.', flags: EPHEMERAL });
  return endRally(i.channel, '🛑 Encerrado manualmente.', helpers.reward);
}

/** Chamado em toda mensagem: devolve true se era uma jogada do rali. */
async function handleMessage(msg, helpers) {
  const game = rallies.get(msg.channelId);
  if (!game) return false;
  const word = msg.content.trim();
  if (!WORD.test(word)) return false; // conversa normal
  const w = norm(word);
  if (firstLetter(w) !== lastLetter(game.last)) return false; // pode ser conversa; só joga quem acerta a letra
  if (msg.author.id === game.lastUser) { await msg.react('🚫').catch(() => {}); return true; }
  if (game.used.has(w)) { await msg.react('♻️').catch(() => {}); return true; }
  game.used.add(w);
  game.last = word;
  game.lastUser = msg.author.id;
  game.count++;
  game.scores.set(msg.author.id, (game.scores.get(msg.author.id) || 0) + points(word));
  armTimer(msg.channel, game, helpers.reward);
  await msg.react('✅').catch(() => {});
  if (game.count % 10 === 0) {
    await msg.channel.send({ content: '🔥 **' + game.count + ' palavras!** Próxima letra: **' + lastLetter(word).toUpperCase() + '**\n' + scoreboard(game), allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

async function handleSlash(i, helpers) {
  if (!NAMES.has(i.commandName)) return false;
  if (i.commandName === 'ship') { if (helpers.gameAllowed(i)) await ship(i); return true; }
  if (i.commandName === 'rali') {
    if (i.options.getSubcommand() === 'iniciar') await startRally(i, helpers);
    else await stopRally(i, helpers);
    return true;
  }
  return false;
}

module.exports = { commands, handleSlash, handleMessage, shipScore };
