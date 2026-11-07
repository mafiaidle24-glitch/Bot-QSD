// Painel web: login com Discord (OAuth2) + API de configuração.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const cfgs = require('./config');
const uploads = require('./uploads');
const wiki = require('./wiki');
const tickets = require('./tickets');
const identity = require('./identity');
const expressions = require('./expressions');
const premium = require('./premium');
const { renderCard } = require('./card');
const { LANGS } = require('./translate');

const API = 'https://discord.com/api/v10';

function startWeb(bot) {
  const { client } = bot;
  const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const PORT = Number(process.env.SERVER_PORT || process.env.PORT) || 3000;
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID || client.user.id;
  const SECRET = process.env.DISCORD_CLIENT_SECRET;
  if (!SECRET) console.warn('[web] DISCORD_CLIENT_SECRET não definido: o login no painel não vai funcionar.');
  if (!process.env.SESSION_SECRET) console.warn('[web] SESSION_SECRET não definido: usando um valor temporário (logins caem ao reiniciar).');

  const app = express();
  if (BASE_URL.startsWith('https')) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));
  app.use(
    session({
      name: 'qsd.sid',
      secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https'), maxAge: 24 * 3600 * 1000 },
    })
  );
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 150, standardHeaders: true, legacyHeaders: false }));
  const previewLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((e) => {
      console.error('[web]', e);
      res.status(500).json({ error: e.message || 'Erro interno' });
    });

  /* ------------------------------ login ------------------------------ */

  app.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const q = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: BASE_URL + '/auth/callback',
      response_type: 'code',
      scope: 'identify guilds',
      state,
      prompt: 'none',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${q}`);
  });

  app.get('/auth/callback', wrap(async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) return res.status(400).send('Login inválido. Volte e tente de novo.');
    delete req.session.oauthState;
    const tokenRes = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: SECRET || '',
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: BASE_URL + '/auth/callback',
      }),
    });
    if (!tokenRes.ok) return res.status(400).send('Não foi possível autenticar com o Discord. Confira o CLIENT_SECRET e o Redirect.');
    const { access_token } = await tokenRes.json();
    const headers = { Authorization: `Bearer ${access_token}` };
    const [user, guilds] = await Promise.all([
      fetch(`${API}/users/@me`, { headers }).then((r) => r.json()),
      fetch(`${API}/users/@me/guilds`, { headers }).then((r) => r.json()),
    ]);
    req.session.regenerate((err) => {
      if (err) return res.status(500).send('Erro de sessão.');
      req.session.user = { id: user.id, username: user.global_name || user.username, avatar: user.avatar };
      req.session.guilds = (Array.isArray(guilds) ? guilds : []).map((g) => ({
        id: g.id, name: g.name, icon: g.icon, owner: g.owner, permissions: g.permissions,
      }));
      res.redirect('/');
    });
  }));

  app.get('/auth/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

  const requireAuth = (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'Faça login.' }));

  const canManageBits = (perm, owner) => {
    if (owner) return true;
    const p = BigInt(perm || 0);
    return (p & PermissionFlagsBits.Administrator) !== 0n || (p & PermissionFlagsBits.ManageGuild) !== 0n;
  };

  /** Confere (ao vivo) se quem chamou administra o servidor e se o bot está nele. */
  const guildAccess = wrap(async (req, res, next) => {
    const gid = String(req.params.id || '').slice(0, 30);
    const guild = client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
    if (!guild) return res.status(404).json({ error: `O bot não está neste servidor (id recebido: ${gid || 'vazio'}).` });
    const member = await guild.members.fetch(req.session.user.id).catch(() => null);
    const ok = member && (guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.ManageGuild));
    if (!ok) return res.status(403).json({ error: 'Você precisa da permissão "Gerenciar Servidor".' });
    req.guild = guild;
    req.member = member;
    next();
  });

  /* ------------------------------ Premium ------------------------------ */

  const isBotOwner = (req) => premium.isBotOwner(req.session.user?.id);
  const premiumState = (gid) => ({
    ...premium.info(gid),
    mp: premium.mpOn(),
    price: premium.price(),
    days: premium.planDays(),
    perks: premium.perkLines(),
    limits: { ticketTypes: premium.perks(gid).ticketTypes, words: premium.perks(gid).words, levelCard: premium.perks(gid).levelCard },
    features: ['welcomeCard', 'autoroles', 'moderation', 'logs', 'levelCard', 'ticketTranscript', 'duelBoss', 'identity'].reduce((o, k) => ({ ...o, [k]: !!premium.perks(gid)[k] }), {}),
    quotas: ['panelPublishes', 'messagePublishes', 'wikiPublishes', 'translationsDay', 'gamesDay'].reduce((o, k) => {
      const q = premium.quota(gid, k);
      return { ...o, [k]: { limit: q.limit === Infinity ? null : q.limit, used: q.used, per: q.per } };
    }, {}),
    maxPanelButtons: premium.perks(gid).panelButtons,
  });

  // Webhook do Mercado Pago (sem login): só reconsulta o pagamento na API deles.
  app.post('/mp/webhook', wrap(async (req, res) => {
    await premium.handleWebhook(req.body, req.query);
    res.sendStatus(200);
  }));

  app.get('/api/guilds/:id/premium', requireAuth, guildAccess, (req, res) => res.json(premiumState(req.guild.id)));

  app.post('/api/guilds/:id/premium/checkout', requireAuth, guildAccess, rateLimit({ windowMs: 60_000, limit: 6 }), wrap(async (req, res) => {
    try {
      res.json({ payment: premium.publicPayment(await premium.createPayment(req.guild.id, req.session.user.id)) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  app.get('/api/guilds/:id/premium/payments/:pid', requireAuth, guildAccess, wrap(async (req, res) => {
    const rec = premium.store().payments[String(req.params.pid)];
    if (!rec || rec.guildId !== req.guild.id) return res.status(404).json({ error: 'Pagamento não encontrado.' });
    try {
      const p = await premium.checkPayment(req.params.pid);
      res.json({ payment: premium.publicPayment(p), premium: premiumState(req.guild.id) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // Área do dono do bot: dar/tirar Premium de qualquer servidor.
  const requireBotOwner = (req, res, next) => (isBotOwner(req) ? next() : res.status(403).json({ error: 'Só o dono do bot.' }));
  app.get('/api/owner/guilds', requireAuth, requireBotOwner, (req, res) => {
    res.json(client.guilds.cache.map((g) => ({ id: g.id, name: g.name, members: g.memberCount, ...premium.info(g.id) })).sort((a, b) => a.name.localeCompare(b.name)));
  });
  app.post('/api/owner/premium', requireAuth, requireBotOwner, (req, res) => {
    const gid = String(req.body?.guildId || '');
    if (!client.guilds.cache.has(gid)) return res.status(404).json({ error: 'Servidor não encontrado.' });
    if (req.body?.action === 'revoke') premium.revoke(gid);
    else if (req.body?.action === 'exempt') premium.setExempt(gid, req.body.on !== false);
    else {
      const d = Math.round(Number(req.body?.days));
      if (!(d >= 1 && d <= 3650)) return res.status(400).json({ error: 'Dias inválidos (1 a 3650).' });
      premium.grant(gid, d, 'painel');
    }
    res.json({ ok: true, premium: premium.info(gid) });
  });

  /* ------------------------------- API ------------------------------- */

  const inviteUrl = (guildId) => {
    const perms = new PermissionsBitField([
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.UseExternalEmojis, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ChangeNickname,
      PermissionFlagsBits.ManageGuildExpressions,
    ]).bitfield;
    const q = new URLSearchParams({ client_id: CLIENT_ID, permissions: String(perms), scope: 'bot applications.commands', guild_id: guildId });
    return `https://discord.com/oauth2/authorize?${q}`;
  };

  app.get('/api/me', requireAuth, (req, res) => {
    res.json({
      user: req.session.user,
      bot: { id: client.user.id, username: client.user.username, avatar: client.user.displayAvatarURL({ size: 64, extension: 'png' }) },
      langs: LANGS,
    });
  });

  app.get('/api/guilds', requireAuth, (req, res) => {
    const list = (req.session.guilds || [])
      .filter((g) => canManageBits(g.permissions, g.owner))
      .map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
        botIn: client.guilds.cache.has(g.id),
        invite: inviteUrl(g.id),
      }))
      .sort((a, b) => Number(b.botIn) - Number(a.botIn) || a.name.localeCompare(b.name));
    res.json(list);
  });

  app.get('/api/guilds/:id/data', requireAuth, guildAccess, wrap(async (req, res) => {
    const guild = req.guild;
    await guild.channels.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});
    // Lista de membros (para escolher contas isentas etc.). Limitada para não pesar na memória.
    await guild.members.fetch({ limit: 1000 }).catch(() => {});
    const members = guild.members.cache
      .filter((m) => !m.user.bot)
      .map((m) => ({ id: m.id, name: m.displayName || m.user.username }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 500);
    const me = guild.members.me;
    const channels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name }));
    const categories = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name }));
    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id, name: r.name, color: r.hexColor === '#000000' ? '' : r.hexColor,
        assignable: !r.managed && r.position < me.roles.highest.position,
      }));
    res.json({
      guild: { id: guild.id, name: guild.name },
      config: cfgs.getConfig(guild.id),
      channels,
      categories,
      members,
      roles,
      botCanManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
      premium: premiumState(guild.id),
      isBotOwner: isBotOwner(req),
    });
  }));

  app.put('/api/guilds/:id/config', requireAuth, guildAccess, (req, res) => {
    const clean = cfgs.setConfig(req.guild.id, req.body);
    res.json({ config: clean, notices: cfgs.setConfig.notes || [] });
  });

  // Envio de imagens do celular/computador (corpo = bytes da imagem)
  app.post('/api/guilds/:id/uploads', requireAuth, guildAccess, express.raw({ type: '*/*', limit: uploads.MAX }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Nenhuma imagem recebida (máx. 8 MB).' });
      const buf = req.query.round === '1' ? await uploads.round(req.body) : req.body;
      res.json({ ref: uploads.save(req.guild.id, buf) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Wiki: envio de imagem com compressão automática (uma de cada vez)
  app.post('/api/guilds/:id/wiki/upload', requireAuth, guildAccess, express.raw({ type: '*/*', limit: uploads.MAX }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Nenhuma imagem recebida (máx. 8 MB).' });
      const buf = await uploads.compress(req.body, { hq: req.query.hq === '1' });
      res.json({ ref: uploads.save(req.guild.id, buf), bytes: buf.length });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/guilds/:id/tickets/publish', requireAuth, guildAccess, wrap(async (req, res) => {
    try {
      res.json({ ok: true, url: await tickets.publishPanel(req.guild) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  app.post('/api/guilds/:id/wiki/publish-list', requireAuth, guildAccess, wrap(async (req, res) => {
    try {
      if (!premium.quota(req.guild.id, 'wikiPublishes').ok) return res.status(403).json({ error: premium.quotaMsg(req.guild.id, 'wikiPublishes') });
      const url = await wiki.publishList(req.guild);
      premium.consume(req.guild.id, 'wikiPublishes');
      res.json({ ok: true, url });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // Identidade do bot neste servidor (apelido, foto, banner, bio): aplica ou remove.
  app.post('/api/guilds/:id/identity/:action', requireAuth, guildAccess, rateLimit({ windowMs: 60_000, limit: 4 }), wrap(async (req, res) => {
    const action = req.params.action;
    if (!['apply', 'reset'].includes(action)) return res.status(400).json({ error: 'Ação inválida.' });
    if (action === 'apply' && !premium.perks(req.guild.id).identity) return res.status(403).json({ error: premium.LOCK_MSG });
    res.json(await identity.apply(client, req.guild.id, { reset: action === 'reset' }));
  }));

  app.get('/api/guilds/:id/uploads/:file', requireAuth, guildAccess, (req, res) => {
    const p = uploads.pathByName(req.guild.id, String(req.params.file));
    if (!p) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400').sendFile(p);
  });

  app.post('/api/guilds/:id/messages/:msgId/publish', requireAuth, guildAccess, wrap(async (req, res) => {
    try {
      if (!premium.quota(req.guild.id, 'messagePublishes').ok) return res.status(403).json({ error: premium.quotaMsg(req.guild.id, 'messagePublishes') });
      const link = await bot.publishMessage(req.guild.id, req.params.msgId);
      premium.consume(req.guild.id, 'messagePublishes');
      res.json({ ok: true, url: link });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  app.post('/api/guilds/:id/panels/:panelId/publish', requireAuth, guildAccess, wrap(async (req, res) => {
    try {
      if (!premium.quota(req.guild.id, 'panelPublishes').ok) return res.status(403).json({ error: premium.quotaMsg(req.guild.id, 'panelPublishes') });
      const link = await bot.publishPanel(req.guild.id, req.params.panelId);
      premium.consume(req.guild.id, 'panelPublishes');
      res.json({ ok: true, url: link });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  app.post('/api/guilds/:id/test/:kind', requireAuth, guildAccess, wrap(async (req, res) => {
    const kind = req.params.kind;
    if (!['welcome', 'leave'].includes(kind)) return res.status(400).json({ error: 'Tipo inválido.' });
    try {
      await bot.sendCard(kind, req.guild, req.member);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // Prévia ao vivo da imagem (usa o rascunho enviado, sem salvar)
  app.post('/api/guilds/:id/preview/:kind', requireAuth, guildAccess, previewLimit, wrap(async (req, res) => {
    const kind = req.params.kind;
    if (!['welcome', 'leave'].includes(kind)) return res.status(400).json({ error: 'Tipo inválido.' });
    const clean = cfgs.validate(req.guild.id, { [kind]: req.body })[kind];
    const user = req.member.user;
    const buf = await renderCard({
      ...clean,
      kind,
      name: req.member.displayName,
      avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
    });
    res.set('Content-Type', 'image/png').send(buf);
  }));

  // Emojis e figurinhas do servidor (nomeados qsd_01, qsd_02...)
  app.post('/api/guilds/:id/expressions/:type', requireAuth, guildAccess, express.raw({ type: '*/*', limit: uploads.MAX }), async (req, res) => {
    try {
      const type = req.params.type;
      if (!['emoji', 'sticker'].includes(type)) return res.status(400).json({ error: 'Tipo inválido.' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Nenhuma imagem recebida (máx. 8 MB).' });
      res.json(await expressions.add(req.guild, type, req.body));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.listen(PORT, () => console.log(`[web] Painel em ${BASE_URL} (porta ${PORT})`));
}

module.exports = { startWeb };
