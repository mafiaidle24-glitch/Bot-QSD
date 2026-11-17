// Cargos por reação de emoji: o membro reage na mensagem e ganha o cargo (tira a reação e perde).
const { EmbedBuilder } = require('discord.js');
const cfgs = require('./config');

const warn = (where, e) => console.error('[cargos-reacao] erro em ' + where + ':', e?.message || e);

/** Chave comparável de um emoji: id (personalizado) ou o próprio caractere (sem o seletor de variação). */
function keyOf(str) {
  const s = String(str || '').trim();
  const m = /^<a?:\w+:(\d{15,25})>$/.exec(s) || /^(\d{15,25})$/.exec(s) || /^\w+:(\d{15,25})$/.exec(s);
  return m ? m[1] : s.replace(/️/g, '');
}
const reactionKey = (emoji) => (emoji.id ? emoji.id : String(emoji.name || '').replace(/️/g, ''));

function buildPayload(panel) {
  const lines = panel.items.map((it) => it.emoji + '  →  <@&' + it.roleId + '>');
  const base = panel.content || (panel.title ? '' : 'Reaja com o emoji para pegar o cargo. Tire a reação para remover.');
  const text = [base, lines.join('\n')].filter(Boolean).join('\n\n').slice(0, panel.useEmbed ? 4000 : 2000);
  if (panel.useEmbed) {
    const e = new EmbedBuilder().setColor(panel.color).setDescription(text || '‎');
    if (panel.title) e.setTitle(panel.title);
    return { content: '', embeds: [e], allowedMentions: { parse: [] } };
  }
  return { content: (panel.title ? '**' + panel.title + '**\n' : '') + text, embeds: [], allowedMentions: { parse: [] } };
}

async function publish(client, guildId, panelId) {
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) throw new Error('O bot não está nesse servidor.');
  const panel = cfgs.getConfig(guildId).reactionRoles.find((p) => p.id === panelId);
  if (!panel) throw new Error('Painel não encontrado. Salve as alterações primeiro.');
  if (!panel.channelId) throw new Error('Escolha o canal onde a mensagem será publicada.');
  if (!panel.items.length) throw new Error('Adicione pelo menos um emoji com cargo.');
  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('Canal inválido ou sem acesso para o bot.');
  const payload = buildPayload(panel);
  let msg = null;
  if (panel.messageId) {
    msg = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (msg && msg.author.id === client.user.id) await msg.edit(payload);
    else msg = null;
  }
  if (!msg) {
    msg = await channel.send(payload);
    cfgs.setReactionMessage(guildId, panelId, msg.id);
  }
  // Tira reações antigas que não fazem mais parte do painel e coloca as novas.
  const wanted = new Set(panel.items.map((it) => keyOf(it.emoji)));
  for (const r of [...msg.reactions.cache.values()]) {
    if (!wanted.has(reactionKey(r.emoji))) await r.remove().catch(() => {});
  }
  const failed = [];
  for (const it of panel.items) {
    const has = msg.reactions.cache.some((r) => reactionKey(r.emoji) === keyOf(it.emoji) && r.me);
    if (has) continue;
    try { await msg.react(it.emoji); } catch (e) { failed.push(it.emoji); }
  }
  return { url: msg.url, failed };
}

/** Chamado a cada reação colocada (add=true) ou tirada (add=false). */
async function handle(reaction, user, add) {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    const msg = reaction.message;
    const guild = msg.guild || (msg.guildId ? reaction.client.guilds.cache.get(msg.guildId) : null);
    if (!guild) return;
    const cfg = cfgs.getConfig(guild.id);
    const panel = cfg.reactionRoles.find((p) => p.messageId === msg.id);
    if (!panel) return;
    const key = reactionKey(reaction.emoji);
    const item = panel.items.find((it) => keyOf(it.emoji) === key);
    if (!item) {
      if (add) await reaction.users.remove(user.id).catch(() => {}); // emoji que não é do painel
      return;
    }
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    const role = guild.roles.cache.get(item.roleId);
    if (!role) return;
    if (add) {
      if (panel.mode === 'single') {
        const others = panel.items.filter((o) => o !== item);
        const drop = others.map((o) => o.roleId).filter((id) => member.roles.cache.has(id));
        if (drop.length) await member.roles.remove(drop, 'Cargos por reação (escolha única)').catch((e) => warn('remover', e));
        for (const o of others) {
          const r = msg.reactions.cache.find((x) => reactionKey(x.emoji) === keyOf(o.emoji));
          if (r) await r.users.remove(user.id).catch(() => {});
        }
      }
      if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Cargos por reação').catch((e) => warn('dar cargo ' + role.name, e));
    } else if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Cargos por reação').catch((e) => warn('tirar cargo ' + role.name, e));
    }
  } catch (e) {
    warn('reação', e);
  }
}

module.exports = { publish, handle, keyOf, reactionKey, buildPayload };
