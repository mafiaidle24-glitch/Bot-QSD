// Estatísticas do servidor: canais de voz (trancados) cujo nome mostra um número que se atualiza sozinho.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const cfgs = require('./config');

const warn = (where, e) => console.error('[estatisticas] erro em ' + where + ':', e?.message || e);
const lastGood = new Map(); // evita renomear à toa

async function ensureMembers(guild) {
  if (guild.members.cache.size >= guild.memberCount * 0.95) return;
  await guild.members.fetch().catch(() => {});
}

async function count(guild, item) {
  switch (item.type) {
    case 'humans': await ensureMembers(guild); return guild.members.cache.filter((m) => !m.user.bot).size;
    case 'bots': await ensureMembers(guild); return guild.members.cache.filter((m) => m.user.bot).size;
    case 'boosts': return guild.premiumSubscriptionCount || 0;
    case 'channels': return guild.channels.cache.size;
    case 'roles': return Math.max(0, guild.roles.cache.size - 1);
    case 'role': {
      await ensureMembers(guild);
      const r = guild.roles.cache.get(item.roleId);
      return r ? r.members.size : 0;
    }
    default: return guild.memberCount;
  }
}

const nameFor = (item, n) => {
  const t = item.name.includes('{count}') ? item.name.replace(/\{count\}/gi, String(n)) : item.name + ': ' + n;
  return t.slice(0, 100);
};

/** Cria os canais que faltam e atualiza os nomes. Devolve uma linha de resultado por item. */
async function refresh(client, guildId) {
  const cfg = cfgs.getConfig(guildId);
  const out = [];
  if (!cfg.stats.enabled || !cfg.stats.items.length) return out;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return out;
  await guild.channels.fetch().catch(() => {});
  const me = guild.members.me;
  for (const item of cfg.stats.items) {
    try {
      const n = await count(guild, item);
      const name = nameFor(item, n);
      let ch = item.channelId ? guild.channels.cache.get(item.channelId) : null;
      if (!ch) {
        const parent = cfg.stats.categoryId && guild.channels.cache.get(cfg.stats.categoryId) ? cfg.stats.categoryId : undefined;
        ch = await guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent,
          reason: 'Estatísticas do servidor',
          permissionOverwrites: [
            { id: guild.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
            { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
          ],
        });
        cfgs.setStatsChannel(guildId, item.id, ch.id);
        lastGood.set(ch.id, name);
        out.push({ id: item.id, ok: true, name, created: true });
        continue;
      }
      if (ch.name !== name && lastGood.get(ch.id) !== name) {
        await ch.setName(name, 'Estatísticas do servidor');
        lastGood.set(ch.id, name);
        out.push({ id: item.id, ok: true, name, updated: true });
      } else out.push({ id: item.id, ok: true, name });
    } catch (e) {
      warn('item ' + item.id, e);
      out.push({ id: item.id, ok: false, error: e.message || String(e) });
    }
  }
  return out;
}

async function tick(client) {
  for (const g of client.guilds.cache.values()) {
    if (cfgs.getConfig(g.id).stats.enabled) await refresh(client, g.id).catch((e) => warn('tick', e));
  }
}

module.exports = { refresh, tick, count, nameFor };
