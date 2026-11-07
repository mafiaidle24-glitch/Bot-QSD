// Wiki de personagens: !comando responde com imagens e lista de comandos por raridade.
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const cfgs = require('./config');
const uploads = require('./uploads');
const premium = require('./premium');

const cooldowns = new Map();
function onCooldown(key, ms) {
  const now = Date.now();
  if ((cooldowns.get(key) || 0) > now) return true;
  cooldowns.set(key, now + ms);
  if (cooldowns.size > 2000) for (const [k, v] of cooldowns) if (v < now) cooldowns.delete(k);
  return false;
}

function allowed(msg, w) {
  if (w.who === 'everyone') return true;
  if (msg.guild.ownerId === msg.author.id) return true;
  if (premium.isBotOwner(msg.author.id)) return true;
  if (w.who === 'roles') return !!msg.member && w.roleIds.some((id) => msg.member.roles.cache.has(id));
  return false;
}

/** Responde "!nome" apenas nos canais da wiki e só para quem tem permissão. Devolve true se tratou a mensagem. */
async function handleMessage(msg) {
  const cfg = cfgs.getConfig(msg.guild.id);
  const w = cfg.wiki;
  const rule = w.channels.find((c) => c.channelId === msg.channelId);
  if (!rule || !w.entries.length) return false;
  const prefix = cfg.commands.prefix;
  if (!prefix || !msg.content.startsWith(prefix)) return false;
  const name = (msg.content.slice(prefix.length).trim().split(/\s+/)[0] || '').toLowerCase();
  if (!name) return false;
  const entry = w.entries.find((e) => e.name === name || e.aliases.includes(name));
  if (!entry) return false;
  if (!allowed(msg, w)) return false;
  if (rule.rarities.length && !rule.rarities.includes(entry.rarity)) {
    // Personagem de outra raridade: avisa onde usar (some sozinho) e não envia.
    const where = w.channels.filter((c) => !c.rarities.length || c.rarities.includes(entry.rarity)).slice(0, 3).map((c) => '<#' + c.channelId + '>');
    const hint = await msg.channel.send({
      content: '⚠️ **!' + entry.name + '** é **' + entry.rarity + '**' + (where.length ? '. Use em ' + where.join(', ') + '.' : '.'),
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (hint) setTimeout(() => hint.delete().catch(() => {}), 8000);
    if (w.deleteCommand && w.who !== 'everyone') await msg.delete().catch(() => {});
    return true;
  }
  if (w.who === 'everyone' && (onCooldown('wc:' + msg.channelId, 1000) || onCooldown('wu:' + msg.author.id, 3000))) return true;

  const files = [];
  entry.images.forEach((ref, i) => {
    const p = uploads.resolve(msg.guild.id, ref);
    if (p) files.push(new AttachmentBuilder(fs.readFileSync(p), { name: 'wiki' + i + path.extname(p) }));
  });
  const content = entry.text.slice(0, 2000);
  if (!content && !files.length) return true;
  await msg.channel.send({ content: content || undefined, files, allowedMentions: { parse: [] } });
  if (w.deleteCommand && w.who !== 'everyone') await msg.delete().catch(() => {});
  return true;
}

/** Publica (ou republica) a lista de comandos, por raridade, no canal da lista. */
async function publishList(guild) {
  const cfg = cfgs.getConfig(guild.id);
  const w = cfg.wiki;
  const prefix = cfg.commands.prefix || '!';
  if (!w.listChannelId) throw new Error('Escolha o canal da lista de comandos.');
  if (!w.entries.length) throw new Error('Cadastre pelo menos um personagem antes de publicar a lista.');
  const channel = await guild.channels.fetch(w.listChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Canal da lista inválido ou sem acesso para o bot.');

  const blocks = []; // { text, size }
  if (w.intro) blocks.push(w.intro.slice(0, 3800));
  for (const r of w.rarities) {
    const lines = w.entries
      .filter((e) => e.rarity === r.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => [prefix + e.name, ...e.aliases.map((a) => prefix + a)].join(' '));
    if (!lines.length) continue;
    const head = '# __' + (r.emoji ? r.emoji + ' ' : '') + r.name.toUpperCase() + '__\n';
    let cur = head;
    for (const ln of lines) {
      if (cur.length + ln.length + 1 > 3800) { blocks.push(cur); cur = ''; }
      cur += ln + '\n';
    }
    if (cur.trim()) blocks.push(cur);
  }

  const messages = [];
  let group = [];
  let size = 0;
  for (const text of blocks) {
    if (group.length >= 10 || size + text.length > 5500) { messages.push(group); group = []; size = 0; }
    group.push(new EmbedBuilder().setColor(w.color).setDescription(text));
    size += text.length;
  }
  if (group.length) messages.push(group);

  const me = guild.client.user.id;
  for (const id of w.listMessageIds) {
    const old = await channel.messages.fetch(id).catch(() => null);
    if (old && old.author.id === me) await old.delete().catch(() => {});
  }
  const ids = [];
  let first = null;
  for (const embeds of messages) {
    const sent = await channel.send({ embeds, allowedMentions: { parse: [] } });
    ids.push(sent.id);
    if (!first) first = sent;
  }
  cfgs.setWikiListIds(guild.id, ids);
  return first.url;
}

module.exports = { handleMessage, publishList };
