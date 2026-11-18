// Plano Premium por servidor: validade, vantagens e cobrança automática por Pix (Mercado Pago).
const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const db = require('./db');

const EPHEMERAL = MessageFlags.Ephemeral;
const DAY = 86400000;

const commands = [
  new SlashCommandBuilder().setName('premium').setDescription('💎 Veja o Premium deste servidor e assine por Pix'),
  new SlashCommandBuilder().setName('premiumadmin').setDescription('🔑 (Dono do bot) Gerenciar o Premium dos servidores')
    .addSubcommand((s) => s.setName('dar').setDescription('Dar ou somar dias de Premium')
      .addIntegerOption((o) => o.setName('dias').setDescription('Quantos dias').setRequired(true).setMinValue(1).setMaxValue(3650))
      .addStringOption((o) => o.setName('servidor').setDescription('ID do servidor (vazio = este)')))
    .addSubcommand((s) => s.setName('remover').setDescription('Tirar o Premium')
      .addStringOption((o) => o.setName('servidor').setDescription('ID do servidor (vazio = este)')))
    .addSubcommand((s) => s.setName('isentar').setDescription('Isentar um servidor de pagamento (tem tudo do Premium)')
      .addStringOption((o) => o.setName('servidor').setDescription('ID do servidor (vazio = este)'))
      .addBooleanOption((o) => o.setName('ativar').setDescription('Sim = isentar, Não = tirar a isenção (padrão: sim)')))
    .addSubcommand((s) => s.setName('ver').setDescription('Listar os servidores com Premium')),
];
const NAMES = new Set(commands.map((c) => c.name));

/* ------------------------------ configuração ------------------------------ */

const price = () => {
  const n = Number(String(process.env.PREMIUM_PRICE || '').replace(',', '.'));
  return n > 0 ? Math.round(n * 100) / 100 : 14.9;
};
// Promoção: PREMIUM_PRICE = preço de agora; PREMIUM_OLD_PRICE = preço normal (riscado); PREMIUM_PROMO_LABEL = texto da faixa.
const promo = () => {
  const old = Number(String(process.env.PREMIUM_OLD_PRICE || '').replace(',', '.'));
  if (!(old > price())) return null;
  return { oldPrice: Math.round(old * 100) / 100, label: String(process.env.PREMIUM_PROMO_LABEL || '🔥 Promoção').slice(0, 60) };
};
const planDays = () => {
  const n = Math.round(Number(process.env.PREMIUM_DAYS));
  return n > 0 && n <= 365 ? n : 30;
};
const money = (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ',');
const mpOn = () => !!process.env.MP_ACCESS_TOKEN;
const MP_URL = () => (process.env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/$/, '');

/** Vantagens do plano. É aqui que você ajusta números. Infinity = sem limite. */
const PERKS = {
  chatXp: 1.25,        // +25% de XP nas mensagens
  rpgCash: 1.25,       // +25% de dinheiro nas lutas do RPG
  rpgXp: 1.25,         // +25% de XP nas lutas
  bossTries: 5,        // tentativas diárias no chefão (grátis: 3)
  ticketTypes: 10,     // tipos de ticket
  words: 200,          // palavras proibidas no automod
  levelCard: true,     // cartão de rank no aviso de novo nível
  welcomeCard: true,   // cartão personalizado nas boas-vindas e saída
  autoroles: true,     // cargos automáticos
  moderation: true,    // comandos de moderação + automod
  logs: true,          // logs do servidor
  ticketTranscript: true, // transcrição .txt ao fechar ticket
  duelBoss: true,      // /duelo e /chefe
  identity: true,      // nome, foto, banner e bio do bot no servidor
  telefone: true,      // Telefone Vermelho (atendimento por mensagem privada)
  panelButtons: 25,    // botões por painel de cargos
  reactionItems: 20,   // emojis por painel de cargos por reação
  statsChannels: 10,   // canais de estatísticas
  alerts: 20,          // alertas YouTube/Twitch/Kick
  panelPublishes: Infinity,   // publicações de painel de cargos por mês
  messagePublishes: Infinity, // publicações de mensagens/embeds por mês
  wikiPublishes: Infinity,    // publicações da lista da wiki por mês
  customCommands: 100, // comandos personalizados
  triggers: 100,       // respostas automáticas
  reactions: 100,      // reações automáticas
  translationsDay: Infinity,  // traduções por dia
  gamesDay: Infinity,  // usos de comandos de mini jogo por dia
};
const FREE = {
  chatXp: 1, rpgCash: 1, rpgXp: 1, bossTries: 3, ticketTypes: 3, words: 30, levelCard: false,
  welcomeCard: false, autoroles: false, moderation: false, logs: false, ticketTranscript: false, duelBoss: false,
  identity: false, telefone: false,
  reactionItems: 3, statsChannels: 2, alerts: 2,
  panelButtons: 3, panelPublishes: 2, messagePublishes: 2, wikiPublishes: 1,
  customCommands: 5, triggers: 5, reactions: 5, translationsDay: 20, gamesDay: 30,
};
const lim = (n) => (n === Infinity ? 'ilimitado' : String(n));

let client = null;
let appOwner = '';
/** ID do dono do bot: a variável OWNER_ID ou, se não houver, o dono do aplicativo no Discord. */
const botOwnerId = () => process.env.OWNER_ID || appOwner || '';
const isBotOwner = (id) => !!id && id === botOwnerId();
function init(c) {
  client = c;
  c.application?.fetch().then((a) => { appOwner = a.owner?.ownerId || a.owner?.id || ''; }).catch((e) => console.warn('[premium] dono do app:', e.message));
  setInterval(() => pollPending().catch((e) => console.warn('[premium] verificação:', e.message)), 45_000).unref?.();
}

/* -------------------------------- estado -------------------------------- */

const store = () => db.data.premium;
const ownerGuild = (gid) => !!botOwnerId() && client?.guilds.cache.get(gid)?.ownerId === botOwnerId();
const exemptGuild = (gid) => !!store().guilds[gid]?.exempt;

/** { active, free, until, daysLeft } */
function info(gid) {
  const rec = store().guilds[gid];
  const until = rec?.until || 0;
  const paid = until > Date.now();
  const free = ownerGuild(gid) || exemptGuild(gid);
  return { active: paid || free, free, paid, exempt: exemptGuild(gid), until, daysLeft: paid ? Math.ceil((until - Date.now()) / DAY) : 0 };
}
const isPremium = (gid) => info(gid).active;
const perks = (gid) => (isPremium(gid) ? PERKS : FREE);

function grant(gid, days, by = 'manual') {
  const rec = (store().guilds[gid] ??= { until: 0 });
  const base = Math.max(Date.now(), rec.until || 0);
  rec.until = base + days * DAY;
  rec.by = by;
  db.save();
  return rec.until;
}
function revoke(gid) {
  const rec = store().guilds[gid];
  if (rec?.exempt) { rec.until = 0; delete rec.by; } else delete store().guilds[gid];
  db.save();
}
/** Servidor isento: tem tudo do Premium sem pagar (escolhido pelo dono do bot). */
function setExempt(gid, on) {
  const rec = (store().guilds[gid] ??= { until: 0 });
  if (on) rec.exempt = true; else delete rec.exempt;
  if (!on && !(rec.until > 0)) delete store().guilds[gid];
  db.save();
}

/* ---- cotas de uso (por mês ou por dia, fuso de São Paulo) ---- */
const PERIOD = { panelPublishes: 'month', messagePublishes: 'month', wikiPublishes: 'month', translationsDay: 'day', gamesDay: 'day' };
function periodKey(kind) {
  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
  return kind === 'month' ? d.slice(0, 7) : d;
}
function usageRec(gid, key) {
  const u = ((store().usage ??= {})[gid] ??= {});
  const per = periodKey(PERIOD[key]);
  if (!u[key] || u[key].p !== per) u[key] = { p: per, n: 0 };
  return u[key];
}
/** { limit, used, left, ok } de uma cota. */
function quota(gid, key) {
  const limit = perks(gid)[key];
  const used = usageRec(gid, key).n;
  return { limit, used, left: limit === Infinity ? Infinity : Math.max(0, limit - used), ok: limit === Infinity || used < limit, per: PERIOD[key] };
}
/** Gasta 1 uso. Devolve false (sem gastar) se a cota acabou. */
function consume(gid, key) {
  const q = quota(gid, key);
  if (!q.ok) return false;
  if (q.limit !== Infinity) { usageRec(gid, key).n++; db.save(); }
  return true;
}
const QUOTA_NAME = { panelPublishes: 'publicações de painéis de cargos', messagePublishes: 'publicações de mensagens', wikiPublishes: 'publicações da lista da wiki', translationsDay: 'traduções', gamesDay: 'usos de mini jogos' };
/** Texto de aviso quando a cota acabou. */
function quotaMsg(gid, key) {
  const q = quota(gid, key);
  return 'Limite do plano grátis atingido: ' + q.limit + ' ' + QUOTA_NAME[key] + (q.per === 'month' ? ' por mês' : ' por dia') + '. Volte ' + (q.per === 'month' ? 'no mês que vem' : 'amanhã') + ' ou assine o 💎 Premium.';
}
const LOCK_MSG = '🔒 Este recurso é exclusivo do plano 💎 Premium. Veja /premium.';


const fmtDate = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
function statusLine(gid) {
  const s = info(gid);
  if (s.free && !s.paid) return '💎 **Premium grátis** (servidor isento)';
  if (s.paid) return '💎 **Premium ativo** até **' + fmtDate(s.until) + '** (' + s.daysLeft + ' dia(s))';
  return '🔒 Este servidor está no plano **grátis**.';
}
function perkLines() {
  return [
    '👋 Boas-vindas e saída com cartão personalizado (grátis: só mensagem)',
    '🎛️ Painéis de cargos: ' + PERKS.panelButtons + ' botões por painel e publicações ilimitadas (grátis: ' + FREE.panelButtons + ' botões, ' + FREE.panelPublishes + ' publicações/mês)',
    '📨 Mensagens e embeds ilimitados (grátis: ' + FREE.messagePublishes + ' publicações/mês)',
    '📖 Wiki de Capos: publicações ilimitadas (grátis: ' + FREE.wikiPublishes + '/mês)',
    '🎫 Até ' + PERKS.ticketTypes + ' tipos de ticket e transcrição (grátis: ' + FREE.ticketTypes + ' tipos, sem transcrição)',
    '🏷️ Autoroles, 🔨 Moderação com automod e 📜 Logs (exclusivos Premium)',
    '🔔 Alertas de YouTube, Twitch e Kick: até ' + PERKS.alerts + ' (grátis: ' + FREE.alerts + ')',
    '📊 Estatísticas do servidor: até ' + PERKS.statsChannels + ' canais (grátis: ' + FREE.statsChannels + ') e 🎭 cargos por reação: ' + PERKS.reactionItems + ' emojis por painel (grátis: ' + FREE.reactionItems + ')',
    '📞 Telefone Vermelho: atendimento por mensagem privada, estilo ModMail (exclusivo Premium)',
    '⭐ +' + Math.round((PERKS.chatXp - 1) * 100) + '% de XP e cartão de rank no aviso de nível',
    '⌨️ Comandos personalizados e 💬 interação: até ' + PERKS.customCommands + ' de cada (grátis: ' + FREE.customCommands + ')',
    '🌐 Traduções ilimitadas (grátis: ' + FREE.translationsDay + ' por dia)',
    '🎮 Mini jogos ilimitados (grátis: ' + FREE.gamesDay + ' usos por dia)',
    '🎭 Identidade do bot no seu servidor: nome, foto, banner e bio',
    '🕴️ RPG: +' + Math.round((PERKS.rpgCash - 1) * 100) + '% de dinheiro e XP, ' + PERKS.bossTries + ' ataques/dia no chefão, /duelo e /chefe (grátis: sem duelo e chefão)',
  ];
}

/* ------------------------------ Mercado Pago ------------------------------ */

async function mp(path, opts = {}) {
  const r = await fetch(MP_URL() + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + process.env.MP_ACCESS_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Mercado Pago: ' + (j.message || j.error || 'erro ' + r.status));
  return j;
}

const WAIT_MIN = 30; // validade do código Pix

/** Cria (ou reaproveita) uma cobrança Pix para o servidor. */
async function createPayment(gid, userId) {
  if (!mpOn()) throw new Error('A cobrança ainda não foi configurada pelo dono do bot.');
  const now = Date.now();
  for (const [id, p] of Object.entries(store().payments)) {
    if (p.guildId === gid && p.userId === userId && p.status === 'pending' && Math.abs(p.amount - price()) < 0.001 && now - p.created < (WAIT_MIN - 3) * 60000 && p.code) return { id, ...p };
  }
  const amount = price();
  const key = 'qsd-' + gid + '-' + userId + '-' + now;
  const email = process.env.MP_PAYER_EMAIL || 'cliente@qsd-bot.com';
  const desc = 'Premium ' + planDays() + ' dias - servidor ' + gid;
  let id, td;
  // 1) API de Orders (a nova, que o Mercado Pago quer que todos usem)
  if (process.env.MP_USE_PAYMENTS !== '1') {
    try {
      const amt = amount.toFixed(2);
      const j = await mp('/v1/orders', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': key },
        body: JSON.stringify({
          type: 'online',
          processing_mode: 'automatic',
          total_amount: amt,
          external_reference: gid,
          description: desc,
          transactions: { payments: [{ amount: amt, payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'PT' + WAIT_MIN + 'M' }] },
          payer: { email },
        }),
      });
      const pm = j.transactions?.payments?.[0]?.payment_method || {};
      if (!pm.qr_code) throw new Error('resposta sem código Pix');
      id = String(j.id);
      td = { qr_code: pm.qr_code, qr_code_base64: pm.qr_code_base64 };
    } catch (e) {
      console.error('[premium] API de Orders falhou, usando a de Pagamentos:', e.message);
    }
  }
  // 2) API de Pagamentos (reserva, enquanto o Mercado Pago ainda aceitar)
  if (!id) {
    const body = {
      transaction_amount: amount,
      description: desc,
      payment_method_id: 'pix',
      external_reference: gid,
      date_of_expiration: new Date(now + WAIT_MIN * 60000).toISOString().replace('Z', '+00:00'),
      payer: { email },
    };
    const base = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (base.startsWith('https://')) body.notification_url = base + '/mp/webhook';
    const j = await mp('/v1/payments', { method: 'POST', headers: { 'X-Idempotency-Key': key }, body: JSON.stringify(body) });
    td = j.point_of_interaction?.transaction_data || {};
    id = String(j.id);
  }
  if (!td.qr_code) throw new Error('O Mercado Pago não devolveu o código Pix. Confira se o Pix está ativado na conta.');
  const rec = {
    guildId: gid, userId, amount, days: planDays(), status: 'pending', created: now, applied: false,
    code: td.qr_code, qr: td.qr_code_base64 || '',
  };
  store().payments[id] = rec;
  db.save();
  return { id, ...rec };
}

/** Consulta o pagamento no MP e, se aprovado, ativa o Premium (uma única vez). */
async function checkPayment(id) {
  const rec = store().payments[String(id)];
  if (!rec) return null;
  if (rec.applied || rec.status === 'cancelled') return { id: String(id), ...rec };
  let paid, dead, amountOk, refOk;
  if (String(id).startsWith('ORD')) { // API de Orders
    const j = await mp('/v1/orders/' + encodeURIComponent(id));
    const pays = j.transactions?.payments || [];
    const st = [j.status, ...pays.map((x) => x.status)].map((x) => String(x || '').toLowerCase());
    paid = st.some((x) => ['processed', 'approved', 'accredited'].includes(x));
    dead = !paid && st.some((x) => ['canceled', 'cancelled', 'expired', 'failed', 'refunded', 'rejected'].includes(x));
    amountOk = Number(j.total_amount ?? pays[0]?.amount) >= rec.amount - 0.001;
    refOk = String(j.external_reference || '') === rec.guildId;
  } else { // API de Pagamentos
    const j = await mp('/v1/payments/' + encodeURIComponent(id));
    paid = j.status === 'approved';
    dead = ['cancelled', 'rejected', 'refunded', 'charged_back'].includes(j.status);
    amountOk = Number(j.transaction_amount) >= rec.amount - 0.001;
    refOk = String(j.external_reference || '') === rec.guildId;
  }
  if (!amountOk || !refOk) return { id: String(id), ...rec };
  if (paid) {
    rec.status = 'approved';
    rec.applied = true;
    rec.qr = '';
    const until = grant(rec.guildId, rec.days, 'pix:' + id);
    db.save();
    notifyPaid(rec, until);
  } else if (dead) {
    rec.status = 'cancelled';
    rec.qr = '';
    db.save();
  }
  return { id: String(id), ...rec };
}

function notifyPaid(rec, until) {
  const text = '🎉 Pagamento confirmado! O **Premium** do servidor está ativo até **' + fmtDate(until) + '**. Obrigado por apoiar o bot!';
  client?.users.fetch(rec.userId).then((u) => u.send(text)).catch(() => {});
}

let polling = false;
async function pollPending() {
  if (polling || !mpOn()) return;
  polling = true;
  try {
    const now = Date.now();
    for (const [id, p] of Object.entries(store().payments)) {
      if (p.applied || p.status !== 'pending') continue;
      if (now - p.created > 2 * 3600000) { p.status = 'cancelled'; p.qr = ''; db.save(); continue; }
      await checkPayment(id).catch(() => {});
    }
  } finally { polling = false; }
}

/** Webhook do Mercado Pago: só confere o id; quem decide é a consulta à API. */
async function handleWebhook(body, query) {
  const id = body?.data?.id || query?.['data.id'] || query?.id;
  if (id) await checkPayment(String(id)).catch(() => {});
}

const publicPayment = (p) => (p ? { id: p.id, status: p.status, amount: p.amount, days: p.days, code: p.code, qr: p.qr, expires: p.created + WAIT_MIN * 60000 } : null);

/* -------------------------------- Discord -------------------------------- */

function mainView(gid) {
  const s = info(gid);
  const e = new EmbedBuilder().setColor(s.active ? 0xf1c40f : 0x5865f2).setTitle('💎 Premium')
    .setDescription(statusLine(gid) + '\n\n**Vantagens**\n' + perkLines().join('\n') +
      '\n\n**Plano:** ' + (promo() ? '~~' + money(promo().oldPrice) + '~~ **' + money(price()) + '** ' + promo().label : money(price())) + ' por ' + planDays() + ' dias, pago por Pix. A ativação é automática e os dias são somados se você renovar antes de acabar.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pm:buy').setLabel(s.paid ? 'Renovar por Pix' : 'Assinar por Pix').setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(!mpOn()),
  );
  if (!mpOn()) e.setFooter({ text: 'A cobrança ainda não foi ativada pelo dono do bot.' });
  return { embeds: [e], components: [row] };
}

function payView(p) {
  const e = new EmbedBuilder().setColor(0x23a55a).setTitle('💠 Pague ' + money(p.amount) + ' por Pix')
    .setDescription('1. Abra o app do seu banco e escolha **Pix → Copia e Cola** (ou leia o QR code).\n2. Cole o código abaixo e pague.\n3. Em até 1 minuto o Premium ativa sozinho. Se quiser, toque em **Já paguei**.\n\nVale por ' + WAIT_MIN + ' minutos.\n\n**Código Pix** (toque e segure para copiar):\n```\n' + p.code + '\n```');
  const files = [];
  if (p.qr) {
    files.push(new AttachmentBuilder(Buffer.from(p.qr, 'base64'), { name: 'pix.png' }));
    e.setImage('attachment://pix.png');
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pm:chk:' + p.id).setLabel('Já paguei').setEmoji('✅').setStyle(ButtonStyle.Primary));
  return { embeds: [e], components: [row], files };
}

async function handleSlash(i) {
  if (!NAMES.has(i.commandName)) return false;
  if (i.commandName === 'premium') {
    await i.reply({ ...mainView(i.guild.id), flags: EPHEMERAL });
    return true;
  }
  if (!isBotOwner(i.user.id)) {
    await i.reply({ content: 'Só o dono do bot pode usar isso.', flags: EPHEMERAL });
    return true;
  }
  const sub = i.options.getSubcommand();
  const gid = (i.options.getString('servidor') || i.guild.id).trim();
  if (sub === 'ver') {
    const rows = Object.entries(store().guilds).filter(([, r]) => r.until > Date.now() || r.exempt)
      .map(([id, r]) => '• ' + (client.guilds.cache.get(id)?.name || id) + (r.exempt ? ' — isento' : '') + (r.until > Date.now() ? ' — até ' + fmtDate(r.until) : ''));
    await i.reply({ content: rows.length ? '**Servidores com Premium:**\n' + rows.join('\n') : 'Nenhum servidor com Premium (além dos seus) agora.', flags: EPHEMERAL });
  } else if (sub === 'isentar') {
    const on = i.options.getBoolean('ativar') !== false;
    setExempt(gid, on);
    await i.reply({ content: (on ? '✅ **' : '🗑️ Isenção removida de **') + (client.guilds.cache.get(gid)?.name || gid) + (on ? '** agora é isento de pagamento.' : '**.'), flags: EPHEMERAL });
  } else if (sub === 'dar') {
    const until = grant(gid, i.options.getInteger('dias'), 'admin');
    await i.reply({ content: '✅ Premium de **' + (client.guilds.cache.get(gid)?.name || gid) + '** vai até **' + fmtDate(until) + '**.', flags: EPHEMERAL });
  } else {
    revoke(gid);
    await i.reply({ content: '🗑️ Premium removido de **' + (client.guilds.cache.get(gid)?.name || gid) + '**.', flags: EPHEMERAL });
  }
  return true;
}

async function handleButton(i) {
  const [, action, id] = i.customId.split(':');
  if (action === 'buy') {
    await i.deferReply({ flags: EPHEMERAL });
    try {
      const p = await createPayment(i.guild.id, i.user.id);
      return void (await i.editReply(payView(p)));
    } catch (e) {
      return void (await i.editReply({ content: '❌ ' + e.message }));
    }
  }
  if (action === 'chk') {
    await i.deferReply({ flags: EPHEMERAL });
    try {
      const p = await checkPayment(id);
      if (!p) return void (await i.editReply({ content: 'Pagamento não encontrado.' }));
      if (p.status === 'approved') return void (await i.editReply({ content: '🎉 Pago! ' + statusLine(p.guildId) }));
      if (p.status === 'cancelled') return void (await i.editReply({ content: '⌛ Esse Pix expirou. Use /premium para gerar outro.' }));
      return void (await i.editReply({ content: '⏳ Ainda não recebi o pagamento. Pode levar até 1 minuto depois de pagar; tente de novo.' }));
    } catch (e) {
      return void (await i.editReply({ content: '❌ ' + e.message }));
    }
  }
}

module.exports = {
  botOwnerId, isBotOwner, commands, handleSlash, handleButton, init, info, isPremium, perks, grant, revoke, setExempt, quota, consume, quotaMsg, LOCK_MSG, lim, statusLine, perkLines,
  mpOn, price, promo, planDays, money, createPayment, checkPayment, handleWebhook, publicPayment, pollPending,
  PERKS, FREE, store, fmtDate,
};
