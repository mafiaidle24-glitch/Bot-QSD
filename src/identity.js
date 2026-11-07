// Identidade do bot por servidor: apelido, foto, banner e bio que aparecem só naquele servidor.
const fs = require('fs');
const uploads = require('./uploads');
const cfgs = require('./config');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMG = 8 * 1024 * 1024;

function dataUri(gid, ref) {
  if (!ref) return null;
  const p = uploads.resolve(gid, ref);
  if (!p) throw new Error('A imagem enviada não foi encontrada. Envie de novo pelo painel.');
  const buf = fs.readFileSync(p);
  if (buf.length > MAX_IMG) throw new Error('Imagem grande demais (máx. 8 MB).');
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
  return 'data:' + (MIME[ext] || 'image/png') + ';base64,' + buf.toString('base64');
}

const explain = (e) => {
  const m = String(e?.message || e);
  if (/Missing Permissions|50013/i.test(m)) return 'O bot não tem a permissão "Alterar apelido" neste servidor.';
  if (/rate limit|You are being rate limited|429/i.test(m)) return 'O Discord limitou as trocas de imagem. Espere alguns minutos e tente de novo.';
  return m.slice(0, 200);
};

/** Aplica (ou, com reset, remove) a identidade. Devolve { ok: [...], errors: [...] }. */
async function apply(client, guildId, { reset = false } = {}) {
  const id = cfgs.getConfig(guildId).identity;
  const out = { ok: [], errors: [] };
  const base = '/guilds/' + guildId + '/members/@me';

  try {
    await client.rest.patch(base, { body: { nick: reset ? null : id.nick || null } });
    out.ok.push(reset || !id.nick ? 'apelido padrão' : 'apelido');
  } catch (e) {
    out.errors.push('Apelido: ' + explain(e));
  }

  const body = {};
  try {
    body.avatar = reset ? null : dataUri(guildId, id.avatar);
    body.banner = reset ? null : dataUri(guildId, id.banner);
    body.bio = reset ? null : id.bio || null;
  } catch (e) {
    out.errors.push(explain(e));
    return out;
  }
  for (const k of ['avatar', 'banner', 'bio']) {
    try {
      await client.rest.patch(base, { body: { [k]: body[k] } });
      out.ok.push(k === 'avatar' ? 'foto' : k === 'banner' ? 'banner' : 'bio');
    } catch (e) {
      out.errors.push((k === 'avatar' ? 'Foto' : k === 'banner' ? 'Banner' : 'Bio') + ': ' + explain(e));
    }
  }
  return out;
}

module.exports = { apply };
