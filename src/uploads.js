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

/** Recorta a imagem em círculo (PNG com fundo transparente, 256x256). */
async function round(buf) {
  if (!kind(buf)) throw new Error('Formato não suportado. Use PNG, JPG, GIF ou WEBP.');
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(buf);
  const S = 256;
  const side = Math.min(img.width, img.height);
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
  return canvas.toBuffer('image/png');
}

/**
 * Reduz a imagem (largura máx. 1000 px, ou 1400 em alta qualidade) e salva em JPEG leve.
 * Processa uma de cada vez para não estourar a memória. Se algo falhar, devolve a original.
 */
let chain = Promise.resolve();
function compress(buf, opts) {
  const run = () => compressNow(buf, opts || {});
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function compressNow(buf, { hq } = {}) {
  const k = kind(buf);
  if (!k) throw new Error('Formato não suportado. Use PNG, JPG, GIF ou WEBP.');
  if (k === 'gif') return buf;
  try {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const img = await loadImage(buf);
    if (img.width * img.height > 40000000) throw new Error('Imagem enorme demais.');
    const maxW = hq ? 1400 : 1000;
    const maxH = hq ? 3000 : 2400;
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toBuffer('image/jpeg', hq ? 92 : 85);
    return out.length < buf.length ? out : buf;
  } catch (e) {
    console.error('[uploads] compressão falhou, mantendo a original:', e.message);
    return buf;
  }
}

module.exports = { save, resolve, pathByName, round, compress, REF, MAX: 8 * 1024 * 1024 };
