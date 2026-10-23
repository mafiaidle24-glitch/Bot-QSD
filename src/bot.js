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
const warn = (where, e) => console.error('[bot] erro em ' + where + ':', e?.message || e);

function fmt(tpl, v) {
  const user = v.user || v.member?.user;
  return String(tpl || '').replace(/\{(user|username|displayname|server|count|id|args|channel|level)\}/gi, (_, k) => {
    switch (k.toLowerCase()) {
      case 'user': return user ? '<@' + user.id + '>' : '';
      case 'username': return user?.username ?? '';
      case 'displayname': return nameOf(v.member, user);
      case 'server': return v.guild.name;
      case 'count': return String(v.guild.memberCount);
      case 'id': return user?.id ?? '';
      case 'args': return v.args ?? '';
      case 'channel': return v.channel ? '<#' + v.channel.id + '>' : '';
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
  return new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(k) + '($|[^\\p{L}\\p{N}])', 'iu').test(t);
}

const cooldowns = new Map();
function onCooldown(key, ms) {
  const now = Date.now();
  if ((cooldowns.get(key) || 0) > now) return true;
  cooldowns.set(key, now + ms);
  if (cooldowns.size > 5000) for (const [k, v] of cooldowns) if (v < now) cooldowns.delete(k);
  return false;
}

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

async function sendCard(kind, guild, who) {
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
    payload.files = [new AttachmentBuilder(buf, { name: kind + '.png' })];
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

const STYLE = { 1: ButtonStyle.Primary, 2: ButtonStyle.Secondary, 3: ButtonStyle.Success, 4: ButtonStyle.Danger };

function buildPanelPayload(guild, panel) {
  const buttons = panel.buttons.map((b) => {
    const role = guild.roles.cache.get(b.roleId);
    const btn = new ButtonBuilder().setCustomId('rp:' + panel.id + ':' + b.roleId).setStyle(STYLE[b.style] || ButtonStyle.Secondary);
    const label = b.label || (b.emoji ? '' : role?.name || 'Cargo');
    if (label) btn.setLabel(label.slice(0, 80));
    if (b.emoji) {
      try { btn.setEmoji(b.emoji); } catch { if (!label) btn.setLabel(role?.name || 'Cargo'); }
    }
    return btn;
  });
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));

  const text = panel.content || (panel.title ? '' : 'Escolha seus cargos clicando nos botões abaixo:');
  const payload = { components: rows, allowedMentions: { parse: [] } };
  if (panel.useEmbed && (panel.title || panel.content)) {
    const embed = new EmbedBuilder().setColor(panel.color);
    if (panel.title) embed.setTitle(panel.title);
    if (panel.content) embed.setDescription(panel.content);
    payload.embeds = [embed];
    payload.content = '';
  } else {
    payload.embeds = [];
    payload.content = text || 'Escolha seus cargos clicando nos botões abaixo:';
  }
  return payload;
}

async function publishPanel(guildId, panelId) {
  let guild = client.guilds.cache.get(guildId);
  if (!guild) {
    try {
      guild = await client.guilds.fetch(guildId);
    } catch {
      throw new Error('O bot não está nesse servidor.');
    }
  }
  const panel = cfgs.getConfig(guildId).panels.find((p) => p.id === panelId);
  if (!panel) throw new Error('Painel não encontrado. Salve as alterações primeiro.');
  if (!panel.channelId) throw new Error('Escolha o canal onde o painel será publicado.');
  if (!panel.buttons.length) throw new Error('Adicione pelo menos um botão com cargo.');
  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Canal inválido ou sem acesso para o bot.');

  const payload = buildPanelPayload(guild, panel);
  let msg = null;
  if (panel.messageId) {
    msg = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (msg && msg.author.id === client.user.id) await msg.edit(payload);
    else msg = null;
  }
  if (!msg) {
    msg = await channel.send(payload);
    cfgs.setPanelMessage(guildId, panelId, msg.id);
  }
  return msg.url;
}

async function handleRoleButton(i) {
  const [, panelId, roleId] = i.customId.split(':');
  const panel = cfgs.getConfig(i.guild.id).panels.find((p) => p.id === panelId);
  const btn = panel?.buttons.find((b) => b.roleId === roleId);
  if (!btn) return i.reply({ content: 'Este botão não está mais configurado.', flags: EPHEMERAL });
  const role = i.guild.roles.cache.get(roleId);
  if (!role) return i.reply({ content: 'Esse cargo não existe mais.', flags: EPHEMERAL });
  const me = i.guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed || role.position >= me.roles.highest.position) {
    return i.reply({
      content: 'Não consigo gerenciar esse cargo. Peça a um admin para colocar o cargo do bot **acima** dele.',
      flags: EPHEMERAL,
    });
  }
  await i.deferReply({ flags: EPHEMERAL });
  const member = i.member;
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Painel de cargos');
      return i.editReply('➖ Cargo **' + role.name + '** removido.');
    }
    if (panel.mode === 'single') {
      const others = panel.buttons.map((b) => b.roleId).filter((id) => id !== roleId && member.roles.cache.has(id));
      if (others.length) await member.roles.remove(others, 'Painel de cargos (escolha única)');
    }
    await member.roles.add(roleId, 'Painel de cargos');
    return i.editReply('➕ Cargo **' + role.name + '** adicionado!');
  } catch (e) {
    warn('botão de cargo', e);
    return i.editReply('Não consegui alterar seu cargo agora. Avise um administrador.');
  }
}

async function handleTranslate(msg, cfg) {
  const t = cfg.translate;
  if (!t.enabled) return;
  const rule = t.channels.find((c) => c.channelId === msg.channelId);
  if (!rule) return;
  const text = msg.cleanContent.trim();
  if (text.length < 2 || /^(https?:\/\/\S+\s*)+$/.test(text)) return;
  if (cfg.commands.prefix && text.startsWith(cfg.commands.prefix)) return;

  const lines = [];
  for (const target of rule.targets) {
    try {
      const r = await translate(text, target);
      if (!r.text || baseLang(r.from) === baseLang(target) || r.text.trim() === text) continue;
      lines.push('🌐 **' + (r.from || '?') + ' → ' + target + '**\n' + r.text);
    } catch (e) {
      warn('tradução', e);
    }
  }
  if (lines.length) {
    await msg.reply({ content: lines.join('\n\n').slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  }
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    const lang = FLAGS[reaction.emoji.name];
    if (!lang) return;
    if (reaction.partial) await reaction.fetch();
    const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (!msg.guild) return;
    const t = cfgs.getConfig(msg.guild.id).translate;
    if (!t.enabled || !t.flagReactions) return;
    const text = msg.cleanContent?.trim();
    if (!text || onCooldown('flag:' + msg.id + ':' + lang, 60000)) return;
    const r = await translate(text, lang);
    if (!r.text || baseLang(r.from) === baseLang(lang)) return;
    await msg.reply({
      content: ('🌐 **' + (r.from || '?') + ' → ' + lang + '** (pedido de ' + user + ')\n' + r.text).slice(0, 1900),
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (e) {
    warn('tradução por bandeira', e);
  }
});

async function handleCustomCommand(msg, cfg) {
  const prefix = cfg.commands.prefix;
  if (!prefix || !msg.content.startsWith(prefix)) return false;
  const [raw, ...rest] = msg.content.slice(prefix.length).trim().split(/\s+/);
  const name = (raw || '').toLowerCase();
  if (!name) return false;
  const cmd = cfg.commands.list.find((c) => c.name === name || c.aliases.includes(name));
  if (!cmd) return false;
  if (onCooldown('cmd:' + msg.guildId + ':' + msg.author.id + ':' + cmd.name, 2000)) return true;

  const text = fmt(cmd.response, { member: msg.member, user: msg.author, guild: msg.guild, args: rest.join(' '), channel: msg.channel });
  const allowedMentions = { users: [msg.author.id], roles: [] };
  if (cmd.embed) {
    await msg.channel.send({ embeds: [new EmbedBuilder().setColor(cmd.color).setDescription(text.slice(0, 4000))], allowedMentions });
  } else {
    await msg.channel.send({ content: text.slice(0, 2000), allowedMentions });
  }
  return true;
}

async function handleInteraction(msg, cfg) {
  const it = cfg.interaction;
  const content = msg.content;
  if (!content) return;

  if (it.mentionReply && msg.mentions.users.has(client.user.id) && !msg.mentions.everyone && it.mentionReplies.length) {
    if (!onCooldown('mention:' + msg.channelId, 5000)) {
      const text = fmt(pick(it.mentionReplies), { member: msg.member, user: msg.author, guild: msg.guild, channel: msg.channel });
      await msg.reply({ content: text, allowedMentions: { users: [msg.author.id], repliedUser: false } }).catch(() => {});
    }
    return;
  }

  for (const r of it.reactions) {
    if (matches(content, r.trigger, r.match)) await msg.react(r.emoji).catch(() => {});
  }

  for (const t of it.triggers) {
    if (!matches(content, t.trigger, t.match)) continue;
    if (onCooldown('trg:' + msg.channelId + ':' + t.trigger.toLowerCase(), 10000)) break;
    const text = fmt(t.reply, { member: msg.member, user: msg.author, guild: msg.guild, channel: msg.channel });
    const opts = { content: text, allowedMentions: { users: [msg.author.id], roles: [], repliedUser: false } };
    await (t.asReply ? msg.reply(opts) : msg.channel.send(opts)).catch(() => {});
    break;
  }
}

async function handleXp(msg, cfg) {
  const l = cfg.levels;
  if (!l.enabled || l.ignoredChannels.includes(msg.channelId)) return;
  if (!msg.member) msg.member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
  if (!msg.member) return;
  if (l.ignoredRoles.some((id) => msg.member.roles.cache.has(id))) return;
  if (onCooldown('xp:' + msg.guildId + ':' + msg.author.id, l.cooldown * 1000)) return;
  const u = db.getUser(msg.guildId, msg.author.id);
  u.msgs++;
  await giveXp(msg.guild, msg.member, Math.round(rand(l.xpMin, l.xpMax) * l.multiplier), msg.channel);
}

client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guild || msg.author.bot || msg.webhookId) return;
  const cfg = cfgs.getConfig(msg.guild.id);
  try { if (await handleCustomCommand(msg, cfg)) return; } catch (e) { warn('comando personalizado', e); }
  try { await handleGuess(msg); } catch (e) { warn('jogo de adivinhar', e); }
  try { await handleXp(msg, cfg); } catch (e) { warn('xp', e); }
  try { await handleTranslate(msg, cfg); } catch (e) { warn('tradução', e); }
  try { await handleInteraction(msg, cfg); } catch (e) { warn('interação', e); }
});

const quizzes = new Map();
const guessGames = new Map();

function gameAllowed(i) {
  const g = cfgs.getConfig(i.guild.id).games;
  if (!g.enabled) {
    i.reply({ content: 'Os mini jogos estão desativados neste servidor.', flags: EPHEMERAL });
    return false;
  }
  if (g.channelId && g.channelId !== i.channelId) {
    i.reply({ content: 'Os jogos só funcionam em <#' + g.channelId + '>.', flags: EPHEMERAL });
    return false;
  }
  return true;
}

function reward(guild, member, channel) {
  const g = cfgs.getConfig(guild.id).games;
  return giveXp(guild, member, g.rewardXp, channel).catch((e) => warn('xp de jogo', e));
}

async function handleGuess(msg) {
  const game = guessGames.get(msg.channelId);
  if (!game) return;
  const m = msg.content.trim().match(/^\d{1,4}$/);
  if (!m) return;
  const n = Number(m[0]);
  game.tries++;
  if (n === game.number) {
    clearTimeout(game.timer);
    guessGames.delete(msg.channelId);
    const xp = cfgs.getConfig(msg.guildId).games.rewardXp;
    await msg.reply({
      content: '🎉 ' + msg.author + ' acertou! O número era **' + game.number + '** (' + game.tries + ' tentativas).' + (xp ? ' +' + xp + ' XP' : ''),
      allowedMentions: { users: [msg.author.id], repliedUser: false },
    }).catch(() => {});
    if (msg.member) await reward(msg.guild, msg.member, msg.channel);
  } else {
    await msg.react(n < game.number ? '⬆️' : '⬇️').catch(() => {});
  }
}

const PPT = { pedra: '🪨', papel: '📄', tesoura: '✂️' };
const PPT_WINS = { pedra: 'tesoura', papel: 'pedra', tesoura: 'papel' };

function quizRows(state, disabled) {
  const row = new ActionRowBuilder();
  state.opts.forEach((o, idx) => {
    const b = new ButtonBuilder()
      .setCustomId('quiz:' + state.id + ':' + idx)
      .setLabel(('ABCD'[idx] + ') ' + o.t).slice(0, 80))
      .setStyle(disabled ? (o.correct ? ButtonStyle.Success : ButtonStyle.Secondary) : ButtonStyle.Primary)
      .setDisabled(disabled);
    row.addComponents(b);
  });
  return [row];
}

async function startQuiz(i) {
  const q = pick(QUIZ);
  const opts = shuffle(q.options.map((t, idx) => ({ t, correct: idx === q.answer })));
  const state = { id: crypto.randomBytes(4).toString('hex'), opts, tried: new Set(), done: false };
  const xp = cfgs.getConfig(i.guild.id).games.rewardXp;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🧠 Quiz relâmpago')
    .setDescription('**' + q.q + '**\n\nO primeiro a acertar ganha' + (xp ? ' **' + xp + ' XP**' : '') + '! Você tem 20 segundos.');
  await i.reply({ embeds: [embed], components: quizRows(state, false) });
  quizzes.set(state.id, state);
  state.timer = setTimeout(async () => {
    quizzes.delete(state.id);
    if (state.done) return;
    const right = state.opts.find((o) => o.correct).t;
    await i.editReply({ embeds: [EmbedBuilder.from(embed).setDescription('⏰ Tempo esgotado! A resposta era **' + right + '**.')], components: quizRows(state, true) }).catch(() => {});
  }, 20000);
}

async function handleQuizButton(i) {
  const [, id, idxStr] = i.customId.split(':');
  const state = quizzes.get(id);
  if (!state || state.done) return i.reply({ content: 'Esse quiz já terminou.', flags: EPHEMERAL });
  if (state.tried.has(i.user.id)) return i.reply({ content: 'Você já tentou neste quiz!', flags: EPHEMERAL });
  state.tried.add(i.user.id);
  const chosen = state.opts[Number(idxStr)];
  if (!chosen?.correct) return i.reply({ content: '❌ Errou! Aguarde os outros...', flags: EPHEMERAL });

  state.done = true;
  clearTimeout(state.timer);
  quizzes.delete(id);
  const xp = cfgs.getConfig(i.guild.id).games.rewardXp;
  const old = i.message.embeds[0];
  await i.update({
    embeds: [EmbedBuilder.from(old).setColor(0x23a55a).setDescription('🏆 ' + i.user + ' acertou: **' + chosen.t + '**!' + (xp ? ' +' + xp + ' XP' : ''))],
    components: quizRows(state, true),
  });
  await reward(i.guild, i.member, i.channel);
}

async function handlePptButton(i) {
  const [, ownerId, choice] = i.customId.split(':');
  if (i.user.id !== ownerId) return i.reply({ content: 'Esse jogo é de outra pessoa. Use /ppt para jogar!', flags: EPHEMERAL });
  const bot = pick(Object.keys(PPT));
  let result = '🤝 Empate!';
  let won = false;
  if (PPT_WINS[choice] === bot) { result = '🏆 Você ganhou!'; won = true; }
  else if (PPT_WINS[bot] === choice) result = '💀 Eu ganhei!';
  const xp = cfgs.getConfig(i.guild.id).games.rewardXp;
  await i.update({ content: PPT[choice] + ' **' + choice + '** × **' + bot + '** ' + PPT[bot] + '\n' + result + (won && xp ? ' +' + xp + ' XP' : ''), components: [] });
  if (won) await reward(i.guild, i.member, i.channel);
}

const langChoices = LANGS.map(([name, value]) => ({ name, value }));
const slashCommands = [
  new SlashCommandBuilder().setName('rank').setDescription('Mostra o cartão de nível').addUserOption((o) => o.setName('membro').setDescription('Outro membro')),
  new SlashCommandBuilder().setName('top').setDescription('Ranking de níveis do servidor'),
  new SlashCommandBuilder().setName('traduzir').setDescription('Traduz um texto')
    .addStringOption((o) => o.setName('texto').setDescription('Texto para traduzir').setRequired(true).setMaxLength(1500))
    .addStringOption((o) => o.setName('idioma').setDescription('Idioma de destino').setRequired(true).addChoices(...langChoices)),
  new SlashCommandBuilder().setName('dado').setDescription('Rola dados')
    .addIntegerOption((o) => o.setName('lados').setDescription('Lados do dado (padrão 6)').setMinValue(2).setMaxValue(1000))
    .addIntegerOption((o) => o.setName('quantidade').setDescription('Quantos dados (padrão 1)').setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder().setName('moeda').setDescription('Cara ou coroa'),
  new SlashCommandBuilder().setName('ppt').setDescription('Pedra, papel e tesoura contra o bot'),
  new SlashCommandBuilder().setName('quiz').setDescription('Pergunta relâmpago: o primeiro a acertar ganha XP'),
  new SlashCommandBuilder().setName('adivinhar').setDescription('Adivinhe o número secreto de 1 a 100 digitando no chat'),
  new SlashCommandBuilder().setName('piada').setDescription('Uma piada (de tiozão)'),
  new SlashCommandBuilder().setName('fato').setDescription('Um fato aleatório'),
  new SlashCommandBuilder().setName('abracar').setDescription('Dê um abraço em alguém')
    .addUserOption((o) => o.setName('membro').setDescription('Quem vai receber').setRequired(true)),
  new SlashCommandBuilder().setName('bola8').setDescription('Pergunte à bola 8 mágica')
    .addStringOption((o) => o.setName('pergunta').setDescription('Sua pergunta').setRequired(true).setMaxLength(200)),
  new SlashCommandBuilder().setName('painel').setDescription('Link do painel de configuração do bot'),
].map((c) => c.setDMPermission(false).toJSON());

async function registerCommands(guild) {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: slashCommands });
  } catch (e) {
    warn('registrar comandos em ' + guild.name, e);
  }
}

async function runSlash(i) {
  const cfg = cfgs.getConfig(i.guild.id);
  switch (i.commandName) {
    case 'rank': {
      if (!cfg.levels.enabled) return i.reply({ content: 'O sistema de níveis está desativado.', flags: EPHEMERAL });
      await i.deferReply();
      const user = i.options.getUser('membro') || i.user;
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      const u = db.getUser(i.guild.id, user.id);
      const info = levelInfo(u.xp);
      const buf = await renderRank({
        name: nameOf(member, user), avatarUrl: avatarOf(user), level: info.level, rank: db.rankOf(i.guild.id, user.id),
        current: info.current, needed: info.needed, totalXp: u.xp,
      });
      return i.editReply({ files: [new AttachmentBuilder(buf, { name: 'rank.png' })] });
    }
    case 'top': {
      if (!cfg.levels.enabled) return i.reply({ content: 'O sistema de níveis está desativado.', flags: EPHEMERAL });
      const list = db.top(i.guild.id, 10);
      if (!list.length) return i.reply({ content: 'Ninguém tem XP ainda. Comece a conversar! 💬', flags: EPHEMERAL });
      const medals = ['🥇', '🥈', '🥉'];
      const lines = list.map((u, n) => (medals[n] || '**' + (n + 1) + '.**') + ' <@' + u.id + '> — nível **' + levelInfo(u.xp).level + '** • ' + u.xp + ' XP');
      return i.reply({
        embeds: [new EmbedBuilder().setColor(0xf0b232).setTitle('🏆 Top ' + list.length + ' • ' + i.guild.name).setDescription(lines.join('\n'))],
        allowedMentions: { parse: [] },
      });
    }
    case 'traduzir': {
      await i.deferReply();
      try {
        const r = await translate(i.options.getString('texto'), i.options.getString('idioma'));
        return i.editReply({ content: ('🌐 **' + (r.from || '?') + ' → ' + i.options.getString('idioma') + '**\n' + r.text).slice(0, 1900), allowedMentions: { parse: [] } });
      } catch {
        return i.editReply('Não consegui traduzir agora. Tente de novo em instantes.');
      }
    }
    case 'dado': {
      if (!gameAllowed(i)) return;
      const sides = i.options.getInteger('lados') ?? 6;
      const qty = i.options.getInteger('quantidade') ?? 1;
      const rolls = Array.from({ length: qty }, () => rand(1, sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      return i.reply('🎲 d' + sides + ' × ' + qty + ': **' + rolls.join(', ') + '**' + (qty > 1 ? ' (total ' + total + ')' : ''));
    }
    case 'moeda':
      if (!gameAllowed(i)) return;
      return i.reply(Math.random() < 0.5 ? '🪙 **Cara!**' : '🪙 **Coroa!**');
    case 'ppt': {
      if (!gameAllowed(i)) return;
      const row = new ActionRowBuilder().addComponents(
        Object.entries(PPT).map(([k, e]) =>
          new ButtonBuilder().setCustomId('ppt:' + i.user.id + ':' + k).setLabel(k[0].toUpperCase() + k.slice(1)).setEmoji(e).setStyle(ButtonStyle.Secondary)
        )
      );
      return i.reply({ content: i.user + ', escolha sua jogada:', components: [row], allowedMentions: { users: [i.user.id] } });
    }
    case 'quiz':
      if (!gameAllowed(i)) return;
      return startQuiz(i);
    case 'adivinhar': {
      if (!gameAllowed(i)) return;
      if (guessGames.has(i.channelId)) return i.reply({ content: 'Já existe um jogo de adivinhar rolando neste canal!', flags: EPHEMERAL });
      const game = { number: rand(1, 100), tries: 0 };
      game.timer = setTimeout(() => guessGames.delete(i.channelId), 10 * 60 * 1000);
      guessGames.set(i.channelId, game);
      const xp = cfgs.getConfig(i.guild.id).games.rewardXp;
      return i.reply('🔢 Pensei em um número de **1 a 100**. Digite seus palpites no chat! ⬆️ = maior, ⬇️ = menor.' + (xp ? ' Quem acertar ganha **' + xp + ' XP**.' : ''));
    }
    case 'piada': return i.reply('😄 ' + pick(JOKES));
    case 'fato': return i.reply('🧠 **Você sabia?** ' + pick(FACTS));
    case 'abracar': {
      const target = i.options.getUser('membro');
      const text = target.id === i.user.id ? i.user + ' abraçou a si mesmo... 🥲 (vem cá, ganha um abraço do bot!)' : i.user + ' deu um abraço apertado em ' + target + '! 🤗';
      return i.reply({ content: text, allowedMentions: { users: [target.id] } });
    }
    case 'bola8':
      return i.reply('🎱 **' + i.options.getString('pergunta') + '**\n' + pick(EIGHT_BALL));
    case 'painel':
      return i.reply({ content: '⚙️ Painel de configuração: ' + BASE_URL, flags: EPHEMERAL });
  }
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (!i.guild) return;
    if (i.isChatInputCommand()) return await runSlash(i);
    if (i.isButton()) {
      if (i.customId.startsWith('rp:')) return await handleRoleButton(i);
      if (i.customId.startsWith('quiz:')) return await handleQuizButton(i);
      if (i.customId.startsWith('ppt:')) return await handlePptButton(i);
    }
  } catch (e) {
    warn('interação', e);
    const msg = { content: 'Ops, algo deu errado. Tente novamente.', flags: EPHEMERAL };
    if (i.deferred || i.replied) await i.followUp(msg).catch(() => {});
    else await i.reply(msg).catch(() => {});
  }
});

client.once(Events.ClientReady, async () => {
  log('Online como ' + client.user.tag + ' em ' + client.guilds.cache.size + ' servidor(es).');
  client.user.setActivity('/rank • /quiz • /piada');
  for (const guild of client.guilds.cache.values()) await registerCommands(guild);
});
client.on(Events.GuildCreate, (g) => registerCommands(g));
client.on(Events.Error, (e) => warn('client', e));

async function start() {
  if (!process.env.DISCORD_TOKEN) throw new Error('Falta DISCORD_TOKEN no arquivo .env');
  await client.login(process.env.DISCORD_TOKEN);
}

module.exports = { client, start, sendCard, publishPanel, fmt };
