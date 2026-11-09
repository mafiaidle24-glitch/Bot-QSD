// Emojis e figurinhas do servidor, nomeados qsd_01, qsd_02...
const { PermissionFlagsBits } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const gifcompress = require('./gifcompress');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.round(n / 1024) + ' KB');

const LIM = { emoji: { max: 256 * 1024, size: 128 }, sticker: { max: 512 * 1024, size: 320 } };
const isGif = (b) => b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8';

const isVideo = (b) => b.length > 12 && (b.toString('latin1', 4, 8) === 'ftyp' || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3));

/** Vídeo curto (MP4/WebM) -> GIF, usando o ffmpeg da hospedagem. Pega no máx. 6 segundos. */
async function videoToGif(buf, size) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsdv-'));
  const inp = path.join(dir, 'in.vid'), out = path.join(dir, 'out.gif');
  try {
    fs.writeFileSync(inp, buf);
    const vf = 'fps=12,scale=' + size + ':' + size + ':force_original_aspect_ratio=decrease:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-v', 'error', '-t', '6', '-i', inp, '-an', '-vf', vf, '-loop', '0', out],
        { timeout: 60000, windowsHide: true }, (err, so, se) => {
          if (err && err.code === 'ENOENT') return reject(new Error('Esta hospedagem não tem ffmpeg para converter vídeo. Converta em ezgif.com/video-to-gif.'));
          if (err) return reject(new Error('Não consegui converter esse vídeo (' + String(se || err.message).split('\n')[0].slice(0, 100) + ').'));
          resolve();
        });
    });
    return fs.readFileSync(out);
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignora */ } }
}

// Reduz e mantém PNG transparente (a compressão do uploads.js vira JPEG).
async function toPng(buf, size) {
  const img = await loadImage(buf);
  const s = Math.min(size / img.width, size / img.height);
  const w = Math.round(img.width * s);
  const h = Math.round(img.height * s);
  const c = createCanvas(size, size);
  c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c.toBuffer('image/png');
}

function nextName(guild, type) {
  const col = type === 'sticker' ? guild.stickers.cache : guild.emojis.cache;
  let n = 0;
  for (const x of col.values()) {
    const m = /^qsd_(\d+)$/.exec(x.name || '');
    if (m) n = Math.max(n, Number(m[1]));
  }
  return 'qsd_' + String(n + 1).padStart(2, '0');
}

const explain = (e) => {
  const m = String(e?.message || e);
  if (/30008|30018/.test(String(e?.code)) || /Maximum number of (animated )?emojis/i.test(m)) return 'Limite de emojis do servidor atingido.';
  if (/30039/.test(String(e?.code)) || /Maximum number of stickers/i.test(m)) return 'Limite de figurinhas do servidor atingido.';
  if (/50013|Missing Permissions/i.test(m)) return 'O bot precisa da permissão "Gerenciar Expressões".';
  return m.slice(0, 200);
};

async function add(guild, type, buf) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    throw new Error('O bot precisa da permissão "Gerenciar Expressões".');
  }
  await (type === 'sticker' ? guild.stickers : guild.emojis).fetch();
  const lim = LIM[type];
  let note = '';
  if (isVideo(buf)) {
    buf = await videoToGif(buf, lim.size);
    note = 'vídeo convertido em GIF (primeiros 6 segundos). ';
  }
  const gif = isGif(buf);
  let file = buf;
  if (gif) {
    // GIF grande demais (ou figurinha que não é 320x320): reduz e comprime sozinho
    const d = gifcompress.dims(buf);
    if (buf.length > lim.max || (type === 'sticker' && (d.w !== lim.size || d.h !== lim.size))) {
      try {
        const r = await gifcompress.compress(buf, { max: lim.max, size: lim.size, fixedSize: type === 'sticker' });
        file = r.buffer;
        note += (r.after > r.before ? 'GIF ajustado de ' : 'GIF reduzido de ') + fmtSize(r.before) + ' para ' + fmtSize(r.after) + (r.trimmed ? ' (duração encurtada para caber)' : '');
      } catch (e) { throw new Error(e.message); }
    }
  } else file = await toPng(buf, lim.size);
  if (file.length > lim.max) throw new Error((gif ? 'GIF' : 'imagem') + ' acima de ' + lim.max / 1024 + ' KB');
  const name = nextName(guild, type);
  try {
    if (type === 'emoji') await guild.emojis.create({ attachment: file, name, reason: 'Painel do bot' });
    else await guild.stickers.create({ file: { attachment: file, name: name + (gif ? '.gif' : '.png') }, name, tags: 'grinning', reason: 'Painel do bot' });
  } catch (e) { throw new Error(explain(e)); }
  return { name, animated: gif, note };
}

const NAME = /^qsd_\d+$/;

/** Emojis e figurinhas criados pelo painel (nomes qsd_01, qsd_02…). */
async function list(guild) {
  const [em, st] = await Promise.all([guild.emojis.fetch(), guild.stickers.fetch()]);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const mine = (c) => [...c.values()].filter((x) => NAME.test(x.name || ''));
  return {
    emojis: mine(em).map((e) => ({ id: e.id, name: e.name, animated: !!e.animated, url: e.imageURL({ size: 64 }) })).sort(byName),
    stickers: mine(st).map((s) => ({ id: s.id, name: s.name, url: s.url })).sort(byName),
  };
}

/** Apaga um emoji ou figurinha — só os criados pelo painel (qsd_NN). */
async function remove(guild, type, id) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
    throw new Error('O bot precisa da permissão "Gerenciar Expressões".');
  }
  const col = type === 'sticker' ? guild.stickers : guild.emojis;
  const item = (await col.fetch()).get(id);
  if (!item) throw new Error('Não encontrei esse item (talvez já tenha sido apagado).');
  if (!NAME.test(item.name || '')) throw new Error('Só é possível apagar os itens criados pelo painel (qsd_01, qsd_02…).');
  try { await col.delete(id, 'Apagado pelo painel do bot'); } catch (e) { throw new Error(explain(e)); }
  return { ok: true, name: item.name };
}

module.exports = { add, list, remove };
