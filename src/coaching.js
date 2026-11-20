// Coaching de gangue (Idle Mafia): o membro posta o print da tela "Formações" no canal de formações,
// o bot manda a imagem para o Gemini (Google) ler, guarda só o último print de cada membro e mantém
// uma tabela atualizada no Discord e no painel. A equipe pode corrigir qualquer erro de leitura.
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const cfgs = require('./config');
const uploads = require('./uploads');
const db = require('./db');
const premium = require('./premium');

const EPHEMERAL = MessageFlags.Ephemeral;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_IMG = 6 * 1024 * 1024;
const warn = (where, e) => console.error('[coaching] erro em ' + where + ':', e?.message || e);

/* ------------------------------ Poder (407.5T etc.) ------------------------------ */
const UNITS = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12, QA: 1e15, QI: 1e18 };
const POWER_RE = /^([\d]+(?:[.,]\d+)?)\s*([A-Za-z]{0,2})$/;
function normPower(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, '');
  const m = POWER_RE.exec(s);
  if (!m) return '';
  const u = m[2];
  return m[1].replace(',', '.') + (u.length === 2 ? u[0].toUpperCase() + u[1].toLowerCase() : u.toUpperCase());
}
function powerValue(p) {
  const m = POWER_RE.exec(String(p || ''));
  if (!m) return null;
  const u = UNITS[m[2].toUpperCase()];
  return u === undefined ? null : parseFloat(m[1].replace(',', '.')) * u;
}
function formatValue(n) {
  if (!(n > 0)) return '—';
  const list = [['Qi', 1e18], ['Qa', 1e15], ['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]];
  for (const [u, f] of list) if (n >= f) return (Math.round((n / f) * 10) / 10) + u;
  return String(Math.round(n));
}

/* ------------------------------ Dados ------------------------------ */
const store = (gid) => ((db.data.coaching[gid] ??= { members: {} }).members ??= {}, db.data.coaching[gid]);
const clean = (v, n) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

function normTeams(list) {
  const out = [];
  for (const t of (Array.isArray(list) ? list : []).slice(0, 8)) {
    if (!t || typeof t !== 'object') continue;
    const power = normPower(t.power);
    const capos = (Array.isArray(t.capos) ? t.capos : []).map((c) => clean(c, 30)).filter(Boolean).slice(0, 8);
    const name = clean(t.name, 40) || 'Time ' + (out.length + 1);
    if (!power && !capos.length) continue;
    out.push({ name, power, capos });
  }
  return out;
}
const totalOf = (teams) => teams.reduce((n, t) => n + (powerValue(t.power) || 0), 0);

function saveMember(gid, uid, name, teams, extra = {}) {
  const g = store(gid);
  const old = g.members[uid] || {};
  const total = totalOf(teams);
  const hist = [...(old.hist || [])];
  if (!extra.edited && total > 0) hist.push({ at: Date.now(), total });
  g.members[uid] = {
    name: clean(name, 40) || old.name || uid,
    teams,
    total,
    at: extra.edited ? old.at || Date.now() : Date.now(),
    editedAt: extra.edited ? Date.now() : old.editedAt || 0,
    src: extra.src || old.src || '',
    hist: hist.slice(-8),
  };
  db.save();
  return g.members[uid];
}
const deleteMember = (gid, uid) => { const g = store(gid); const had = !!g.members[uid]; delete g.members[uid]; db.save(); return had; };
const listMembers = (gid) => Object.entries(store(gid).members).map(([id, m]) => ({ id, ...m, totalText: formatValue(m.total) })).sort((a, b) => b.total - a.total);

/* ------------------------------ Gemini ------------------------------ */
const PROMPT = `Esta é uma captura de tela do jogo Idle Mafia, tela "Formações" (times de Capos).
Extraia apenas os 4 times de guerra: os chamados "TIME 1", "TIME 2", "TIME 3" e "TIME 4" (podem ter sufixo DEF ou DEF/ATK). IGNORE "Batalha Amistosa", "TIME 0", arena, kingpin, times com nomes livres e times vazios (poder 0). Se não existirem times com esses nomes, devolva os times que tiverem Capos e poder maior que 0. Para cada time devolva: "name" (nome do time como aparece, ex: "TIME 1 DEF/ATK", "TIME 3 DEF"), "power" (o poder exatamente como aparece, número com unidade, ex: "407.5T") e "capos" (lista com os nomes dos Capos do time, se der para ler; senão lista vazia).
Responda SOMENTE com JSON no formato {"teams":[{"name":"","power":"","capos":[""]}]}.
Se a imagem não for a tela de Formações do jogo, responda {"teams":[]}. Não invente valores: se algo não estiver legível, deixe o campo vazio.`;

async function gemini(b64, mime, prompt = PROMPT) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('NO_KEY');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (r.status === 429) throw new Error('A IA está com muitos pedidos agora. Tente de novo em um minuto.');
  if (r.status === 400 || r.status === 403) throw new Error('A chave da IA (GEMINI_API_KEY) foi recusada. Avise o dono do bot.');
  if (!r.ok) throw new Error('A IA respondeu com erro ' + r.status + '.');
  const j = await r.json();
  const txt = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  const body = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(body); } catch { throw new Error('Não consegui entender a resposta da IA. Tente enviar o print de novo.'); }
}

async function readPrint(att) {
  if (att.size && att.size > MAX_IMG) throw new Error('Imagem muito grande (máx. 6 MB).');
  const r = await fetch(att.url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error('Não consegui baixar a imagem.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_IMG) throw new Error('Imagem muito grande (máx. 6 MB).');
  const mime = /^image\/(png|jpe?g|webp)$/i.test(att.contentType || '') ? att.contentType.split(';')[0] : 'image/png';
  const j = await gemini(buf.toString('base64'), mime);
  return normTeams(j.teams);
}

/* ------------------------------ Visual ------------------------------ */
const isStaff = (member, cfg) =>
  !!member && (member.permissions?.has(PermissionFlagsBits.ManageGuild) || cfg.coaching.staffRoleIds.some((id) => member.roles?.cache.has(id)));

function memberEmbed(cfg, uid, m, note) {
  const e = new EmbedBuilder().setColor(cfg.coaching.color)
    .setTitle('🕴️ Formações de ' + m.name)
    .setDescription('**Poder total:** ' + formatValue(m.total) + (note ? '\n' + note : ''));
  for (const t of m.teams.slice(0, 8)) {
    e.addFields({ name: t.name + ' — ' + (t.power || '?'), value: t.capos.length ? t.capos.join(', ') : '—', inline: false });
  }
  e.setFooter({ text: m.editedAt ? '✏️ Corrigido pela equipe' : '🤖 Lido por IA — se algo estiver errado, a equipe pode corrigir' });
  return e;
}
const buttons = (uid) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('co:ed:' + uid).setLabel('Corrigir').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('co:rm:' + uid).setLabel('Descartar').setEmoji('🗑️').setStyle(ButtonStyle.Danger));

async function refreshTable(client, gid) {
  const cfg = cfgs.getConfig(gid);
  const c = cfg.coaching;
  if (!c.enabled || !c.tableChannelId) return;
  try {
    const guild = client.guilds.cache.get(gid);
    const ch = guild && (await guild.channels.fetch(c.tableChannelId).catch(() => null));
    if (!ch || !ch.isTextBased()) return;
    const list = listMembers(gid);
    const lines = list.slice(0, 40).map((m, i) => '`' + String(i + 1).padStart(2, ' ') + '.` **' + m.name + '** — ' + m.totalText + '  ·  ' + m.teams.map((t) => t.power || '?').join(' / '));
    const e = new EmbedBuilder().setColor(c.color).setTitle('🕴️ Formações da gangue')
      .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : 'Ninguém enviou o print das Formações ainda.')
      .setFooter({ text: list.length + ' membro(s) · atualizado automaticamente' }).setTimestamp();
    let msg = c.tableMessageId ? await ch.messages.fetch(c.tableMessageId).catch(() => null) : null;
    if (msg && msg.author.id !== client.user.id) msg = null;
    if (msg) await msg.edit({ embeds: [e] });
    else {
      msg = await ch.send({ embeds: [e] });
      cfgs.setCoachingTable(gid, msg.id);
      await msg.pin().catch(() => {});
    }
  } catch (e) { warn('tabela', e); }
}

/* ------------------------------ Eventos ------------------------------ */
const cooldown = new Map();
const noKeyWarned = new Set();
const inScope = (msg, c) => {
  const ch = msg.channel;
  // só o(s) canal(is) de formações: os canais de coaching ficam livres para conversa e outros prints
  return c.channelIds.includes(ch.id) || (ch.parentId && c.channelIds.includes(ch.parentId));
};
const isImage = (a) => /^image\//i.test(a.contentType || '') || /\.(png|jpe?g|webp)(\?|$)/i.test(a.url || a.name || '');

async function handleMessage(msg) {
  try {
    if (!msg.guild || msg.author.bot) return;
    const cfg = cfgs.getConfig(msg.guild.id);
    const c = cfg.coaching;
    if (!c.enabled || !inScope(msg, c)) return;
    const att = [...msg.attachments.values()].find(isImage);
    if (!att) return;
    // Equipe pode postar o print de outra pessoa mencionando o membro.
    let target = msg.author;
    let targetMember = msg.member;
    if (isStaff(msg.member, cfg) && msg.mentions.users.size === 1) {
      target = msg.mentions.users.first();
      targetMember = msg.mentions.members?.get(target.id) || null;
    }
    const last = cooldown.get(msg.author.id) || 0;
    if (Date.now() - last < 20_000) return;
    cooldown.set(msg.author.id, Date.now());
    if (!process.env.GEMINI_API_KEY) {
      if (!noKeyWarned.has(msg.guild.id)) { noKeyWarned.add(msg.guild.id); await msg.reply('⚠️ A leitura de prints ainda não foi ligada pelo dono do bot (falta a chave da IA).').catch(() => {}); }
      return;
    }
    if (!premium.quota(msg.guild.id, 'coachingDay').ok) return void (await msg.reply(premium.quotaMsg(msg.guild.id, 'coachingDay')).catch(() => {}));
    await msg.react('⏳').catch(() => {});
    try {
      const teams = await readPrint(att);
      if (!teams.length) {
        await msg.reply('❌ Não encontrei times de **Formações** nessa imagem. Envie o print da tela de Formações, inteiro e sem cortes.').catch(() => {});
        await msg.react('❌').catch(() => {});
        return;
      }
      premium.consume(msg.guild.id, 'coachingDay');
      const name = targetMember?.displayName || target.globalName || target.username;
      const m = saveMember(msg.guild.id, target.id, name, teams, { src: msg.url });
      await msg.reply({ embeds: [memberEmbed(cfg, target.id, m)], components: [buttons(target.id)], allowedMentions: { repliedUser: false } }).catch(() => {});
      await msg.react('✅').catch(() => {});
      refreshTable(msg.client, msg.guild.id);
    } catch (e) {
      await msg.reply('❌ ' + (e.message === 'NO_KEY' ? 'Falta a chave da IA.' : e.message)).catch(() => {});
      await msg.react('❌').catch(() => {});
    } finally {
      msg.reactions?.cache?.get('⏳')?.users.remove(msg.client.user.id).catch(() => {});
    }
  } catch (e) { warn('mensagem', e); }
}

/* ------------------------------ Correção pela equipe ------------------------------ */
const teamLine = (t) => t.name + ' | ' + t.power + ' | ' + t.capos.join(', ');
function parseLine(line, i) {
  const parts = String(line || '').split('|').map((x) => x.trim());
  if (!parts[0] && parts.length === 1) return null;
  let name, power, capos;
  if (parts.length >= 3) [name, power, capos] = [parts[0], parts[1], parts.slice(2).join(',')];
  else if (parts.length === 2) [name, power, capos] = [parts[0], parts[1], ''];
  else [name, power, capos] = ['Time ' + (i + 1), parts[0], ''];
  power = normPower(power);
  if (!power) throw new Error('Linha ' + (i + 1) + ': o poder precisa ser como "407.5T". Use: Nome | poder | capos');
  return { name, power, capos: capos.split(',').map((x) => x.trim()).filter(Boolean) };
}

async function handleInteraction(i) {
  try {
    const cfg = cfgs.getConfig(i.guild.id);
    if (!cfg.coaching.enabled) return i.reply({ content: 'O coaching está desligado.', flags: EPHEMERAL });
    if (!isStaff(i.member, cfg)) return i.reply({ content: 'Só a equipe pode corrigir ou descartar.', flags: EPHEMERAL });
    const [, act, uid] = i.customId.split(':');
    if (i.isButton() && act === 'ed') {
      const m = store(i.guild.id).members[uid];
      if (!m) return i.reply({ content: 'Esse registro não existe mais.', flags: EPHEMERAL });
      const modal = new ModalBuilder().setCustomId('co:md:' + uid).setTitle(('Corrigir: ' + m.name).slice(0, 45));
      const rows = m.teams.slice(0, 5).map((t, n) => new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('t' + n).setLabel('Time ' + (n + 1) + ' (Nome | poder | capos)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400).setValue(teamLine(t).slice(0, 400))));
      return i.showModal(modal.addComponents(...rows));
    }
    if (i.isButton() && act === 'rm') {
      deleteMember(i.guild.id, uid);
      refreshTable(i.client, i.guild.id);
      return i.update({ content: '🗑️ Registro descartado por ' + i.user.username + '.', embeds: [], components: [] });
    }
    if (i.isModalSubmit() && act === 'md') {
      const m = store(i.guild.id).members[uid];
      if (!m) return i.reply({ content: 'Esse registro não existe mais.', flags: EPHEMERAL });
      const teams = [];
      try {
        for (let n = 0; n < 5; n++) {
          let v = '';
          try { v = i.fields.getTextInputValue('t' + n); } catch { continue; }
          const t = parseLine(v, n);
          if (t) teams.push(t);
        }
      } catch (e) { return i.reply({ content: '⚠️ ' + e.message, flags: EPHEMERAL }); }
      const upd = saveMember(i.guild.id, uid, m.name, normTeams(teams), { edited: true });
      refreshTable(i.client, i.guild.id);
      const payload = { embeds: [memberEmbed(cfg, uid, upd)], components: [buttons(uid)] };
      return i.isFromMessage?.() ? i.update(payload) : i.reply({ ...payload, flags: EPHEMERAL });
    }
  } catch (e) {
    warn('interação', e);
    if (!i.replied && !i.deferred) i.reply({ content: 'Algo deu errado.', flags: EPHEMERAL }).catch(() => {});
  }
}

/* --------------- boas-vindas no canal de coaching novo --------------- */
const path = require('path');
const fs = require('fs');
const GUIA = path.join(__dirname, '..', 'assets', 'coaching-guia.jpg');
const DEFAULT_WELCOME = 'Bem-vindo(a) ao seu canal de coaching, {member}! 🕴️ Aqui a liderança vai te orientar. Siga o passo a passo da imagem para montar seus times e depois envie o print da tela **Formações** no canal de formações.';

// Quem recebe as boas-vindas: membros com permissão própria de ver o canal que não são da equipe nem bots.
async function findNewMembers(ch, cfg) {
  const people = [], skipped = [];
  for (const ow of ch.permissionOverwrites?.cache?.values?.() || []) {
    if (ow.type !== 1 && String(ow.type) !== 'member') continue;
    if (!ow.allow?.has?.(PermissionFlagsBits.ViewChannel)) continue;
    const m = await ch.guild.members.fetch(ow.id).catch(() => null);
    if (!m || m.user.bot) continue;
    if (isStaff(m, cfg)) skipped.push(m.displayName || m.user.username); else people.push(m);
  }
  return { people, skipped };
}

// Tenta mandar as boas-vindas e devolve { sent, reason } (o motivo ajuda a achar o problema).
async function welcome(ch, { force = false } = {}) {
  if (!ch?.guild || !ch.isTextBased?.() || ch.isThread?.()) return { sent: false, reason: 'Esse não é um canal de texto.' };
  const cfg = cfgs.getConfig(ch.guild.id);
  const c = cfg.coaching;
  if (!c.enabled) return { sent: false, reason: 'O coaching está desligado no painel.' };
  if (!c.welcomeEnabled) return { sent: false, reason: 'As boas-vindas automáticas estão desligadas no painel.' };
  if (!c.categoryId) return { sent: false, reason: 'Falta escolher a categoria dos canais de coaching.' };
  if (ch.parentId !== c.categoryId) return { sent: false, reason: 'O canal não está dentro da categoria escolhida no painel.' };
  if (ch.id === c.tableChannelId || c.channelIds.includes(ch.id)) return { sent: false, reason: 'Esse canal é o da tabela ou o de formações.' };
  const done = (store(ch.guild.id).welcomed ??= {});
  if (done[ch.id] && !force) return { sent: false, reason: 'As boas-vindas já foram enviadas neste canal.' };
  const { people, skipped } = await findNewMembers(ch, cfg);
  if (!people.length) {
    return { sent: false, reason: 'Não achei nenhum membro (sem cargo de liderança) com acesso ao canal.' + (skipped.length ? ' Contei como liderança: ' + skipped.join(', ') + '. Se algum deles não é líder, tire o cargo dele da lista "Cargos que podem corrigir" ou a permissão Gerenciar Servidor.' : ' Adicione o membro ao canal pelo nome dele (não só por cargo).') };
  }
  done[ch.id] = Date.now(); // marca antes de enviar: nunca manda duas vezes
  db.save?.();
  const mentions = people.slice(0, 5).map((m) => '<@' + m.id + '>').join(' ');
  const text = String(c.welcomeText || DEFAULT_WELCOME).replace(/\{member\}/g, mentions);
  const payload = { content: text.slice(0, 1900), allowedMentions: { users: people.slice(0, 5).map((m) => m.id) } };
  const mine = c.welcomeImage ? (c.welcomeImage.startsWith('up:') ? uploads.resolve(ch.guild.id, c.welcomeImage) : c.welcomeImage) : null;
  if (mine) payload.files = [new AttachmentBuilder(mine, { name: 'boas-vindas' + (path.extname(String(mine).split('?')[0]) || '.png') })];
  else if (fs.existsSync(GUIA)) payload.files = [new AttachmentBuilder(GUIA, { name: 'passo-a-passo-formacoes.jpg' })];
  try { await ch.send(payload); } catch (e) {
    delete done[ch.id];
    const perm = e?.code === 50013 || e?.code === 50001;
    return { sent: false, reason: perm ? 'O bot não tem permissão para ver/escrever nesse canal. Dê ao cargo do bot acesso ao canal (Ver canal, Enviar mensagens e Anexar arquivos).' : 'Erro ao enviar: ' + (e?.message || e) };
  }
  return { sent: true, reason: 'Boas-vindas enviadas para ' + people.map((m) => m.displayName || m.user.username).join(', ') + '.' };
}

async function handleChannel(ch) {
  if (!ch?.guild || !ch.parentId) return;
  const r = await welcome(ch);
  if (!r.sent && !/já foram|não está dentro|desligad|Esse não/.test(r.reason)) console.log('[coaching] boas-vindas não enviadas (#' + ch.name + '): ' + r.reason);
}

module.exports = { handleChannel, welcome, DEFAULT_WELCOME, handleMessage, handleInteraction, refreshTable, listMembers, saveMember, deleteMember, normTeams, normPower, powerValue, formatValue, readPrint, gemini, parseLine };
