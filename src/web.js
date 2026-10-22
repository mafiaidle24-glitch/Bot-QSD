// Painel web: login com Discord (OAuth2) + API de configuração.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const cfgs = require('./config');
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

  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((e) => {
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
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: 'O bot não está neste servidor.' });
    const member = await guild.members.fetch(req.session.user.id).catch(() => null);
    const ok = member && (guild.ownerId === member.id || member.permissions.has(PermissionFlagsBits.ManageGuild));
    if (!ok) return res.status(403).json({ error: 'Você precisa da permissão "Gerenciar Servidor".' });
    req.guild = guild;
    req.member = member;
    next();
  });

  /* ------------------------------- API ------------------------------- */

  const inviteUrl = (guildId) => {
    const perms = new PermissionsBitField([
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.UseExternalEmojis, PermissionFlagsBits.ManageRoles,
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
    const me = guild.members.me;
    const channels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
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
      roles,
      botCanManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
    });
  }));

  app.put('/api/guilds/:id/config', requireAuth, guildAccess, (req, res) => {
    const clean = cfgs.setConfig(req.guild.id, req.body);
    res.json({ config: clean });
  });

  app.post('/api/guilds/:id/panels/:panelId/publish', requireAuth, guildAccess, wrap(async (req, res) => {
    try {
      const link = await bot.publishPanel(req.guild.id, req.params.panelId);
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

  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.listen(PORT, () => console.log(`[web] Painel em ${BASE_URL} (porta ${PORT})`));
}

module.exports = { startWeb };
