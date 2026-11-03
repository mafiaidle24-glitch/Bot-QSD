// Imagens enviadas pelo painel (ficam em DATA_DIR/uploads/<servidor>/).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
const REF = /^up:([a-f0-9]{12}\.(?:png|jpg|gif|webp))$/;
const NAME = /^[a-f0-9]{12}\.(?:png|jpg|gif|webp)$/;
const MAX_PER_GUILD = 150;

function kind(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const dirOf = (gid) => path.join(DIR, String(gid).replace(/\D/g, ''));

function save(gid, buf) {
  const ext = kind(buf);
  if (!ext) throw new Error('Formato não suportado. Use PNG, JPG, GIF ou WEBP.');
  const d = dirOf(gid);
  fs.mkdirSync(d, { recursive: true });
  if (fs.readdirSync(d).length >= MAX_PER_GUILD) throw new Error('Limite de ' + MAX_PER_GUILD + ' imagens enviadas neste servidor.');
  const name = crypto.randomBytes(6).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(d, name), buf);
  return 'up:' + name;
}

/** Caminho do arquivo de uma referência "up:xxxx.png" (ou null). */
function resolve(gid, ref) {
  const m = REF.exec(String(ref || ''));
  if (!m) return null;
  const p = path.join(dirOf(gid), m[1]);
  return fs.existsSync(p) ? p : null;
}

function pathByName(gid, name) {
  if (!NAME.test(name)) return null;
  const p = path.join(dirOf(gid), name);
  return fs.existsSync(p) ? p : null;
}

module.exports = { save, resolve, pathByName, REF, MAX: 8 * 1024 * 1024 };
