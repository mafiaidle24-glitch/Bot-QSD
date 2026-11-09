// Compressor de GIF animado, sem dependências: lê o GIF, reduz o tamanho, junta quadros e
// reduz as cores até caber no limite (emoji 256 KB, figurinha 512 KB).
'use strict';

const MAX_FRAMES = 600; // GIFs maiores que isso são recusados
const KEEP_FRAMES = 100; // quadros guardados na memória (o resto é pulado de forma uniforme)
const MAX_PIXELS = 4_000_000; // tamanho máximo do GIF original (largura x altura)

/* ------------------------------------------------------------------ leitura */

function lzwDecode(data, minCode, npix) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = new Uint8Array(npix);
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1, prev = -1, first = 0;
  let bits = 0, nbits = 0, pos = 0, o = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (o < npix) {
    while (nbits < size && pos < data.length) { bits |= data[pos++] << nbits; nbits += 8; }
    if (nbits < size) break;
    const code = bits & mask;
    bits >>>= size; nbits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let sp = 0, cur = code;
    if (prev === -1) { out[o++] = suffix[code]; prev = code; first = code; continue; }
    if (code >= next) { stack[sp++] = first; cur = prev; }
    while (cur >= clear) { stack[sp++] = suffix[cur]; cur = prefix[cur]; }
    first = suffix[cur];
    stack[sp++] = first;
    while (sp > 0 && o < npix) out[o++] = stack[--sp];
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = first; next++;
      if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; }
    }
    prev = code;
  }
  return out;
}

/** Lê o GIF e devolve { w, h, frames: [{ rgba, delay }] } já com cada quadro "montado". */
function readGif(buf, { fitSize, keep = KEEP_FRAMES } = {}) {
  if (buf.length < 14 || buf.toString('latin1', 0, 3) !== 'GIF') throw new Error('Arquivo não é um GIF válido.');
  const W = buf.readUInt16LE(6), H = buf.readUInt16LE(8);
  if (!W || !H || W * H > MAX_PIXELS) throw new Error('GIF com dimensões inválidas ou grandes demais.');
  const flags = buf[10];
  let p = 13, gct = null;
  if (flags & 0x80) { const n = 3 * (1 << ((flags & 7) + 1)); gct = buf.subarray(p, p + n); p += n; }

  // 1ª passada: lista os quadros (sem montar), para saber quantos pular
  const raws = [];
  let gce = { delay: 10, disposal: 0, transp: -1 };
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) {
        const pk = buf[p + 1];
        gce = { disposal: (pk >> 2) & 7, transp: pk & 1 ? buf[p + 4] : -1, delay: buf.readUInt16LE(p + 2) };
      }
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1;
      p++;
    } else if (b === 0x2c) {
      const f = { left: buf.readUInt16LE(p), top: buf.readUInt16LE(p + 2), w: buf.readUInt16LE(p + 4), h: buf.readUInt16LE(p + 6), gce };
      const pk = buf[p + 8];
      p += 9;
      f.interlace = !!(pk & 0x40);
      f.ct = gct;
      if (pk & 0x80) { const n = 3 * (1 << ((pk & 7) + 1)); f.ct = buf.subarray(p, p + n); p += n; }
      f.minCode = buf[p++];
      const chunks = [];
      while (p < buf.length && buf[p] !== 0) { chunks.push(buf.subarray(p + 1, p + 1 + buf[p])); p += buf[p] + 1; }
      p++;
      f.data = Buffer.concat(chunks);
      raws.push(f);
      gce = { delay: 10, disposal: 0, transp: -1 };
      if (raws.length > MAX_FRAMES) throw new Error('GIF com quadros demais (máx. ' + MAX_FRAMES + ').');
    } else break;
  }
  if (!raws.length) throw new Error('GIF sem imagens.');

  const every = Math.max(1, Math.ceil(raws.length / keep));
  const canvas = new Uint8Array(W * H * 4);
  const frames = [];
  let acc = 0;
  raws.forEach((f, idx) => {
    const g = f.gce;
    const saved = g.disposal === 3 ? canvas.slice() : null;
    if (f.ct) {
      const px = lzwDecode(f.data, f.minCode, f.w * f.h);
      const rowOf = (y) => {
        if (!f.interlace) return y;
        const q = Math.ceil(f.h / 8), q2 = Math.ceil((f.h - 4) / 8), q3 = Math.ceil((f.h - 2) / 4);
        if (y < q) return y * 8;
        if (y < q + q2) return (y - q) * 8 + 4;
        if (y < q + q2 + q3) return (y - q - q2) * 4 + 2;
        return (y - q - q2 - q3) * 2 + 1;
      };
      for (let y = 0; y < f.h; y++) {
        const dy = f.top + rowOf(y);
        if (dy >= H) continue;
        for (let x = 0; x < f.w; x++) {
          const dx = f.left + x;
          if (dx >= W) continue;
          const c = px[y * f.w + x];
          if (c === g.transp) continue;
          const o = (dy * W + dx) * 4, ci = c * 3;
          canvas[o] = f.ct[ci]; canvas[o + 1] = f.ct[ci + 1]; canvas[o + 2] = f.ct[ci + 2]; canvas[o + 3] = 255;
        }
      }
    }
    const d = g.delay <= 1 ? 10 : g.delay; // navegadores tratam 0/1 como 10 (0,1 s)
    acc += d;
    if (idx % every === 0 || idx === raws.length - 1 && !frames.length) {
      frames.push({ rgba: fitSize ? fitSquare(canvas, W, H, fitSize) : canvas.slice(), delay: acc });
      acc = 0;
    } else if (frames.length) frames[frames.length - 1].delay += d, acc = 0;
    if (g.disposal === 2) {
      for (let y = f.top; y < Math.min(H, f.top + f.h); y++) canvas.fill(0, (y * W + f.left) * 4, (y * W + Math.min(W, f.left + f.w)) * 4);
    } else if (g.disposal === 3 && saved) canvas.set(saved);
  });
  return { w: W, h: H, frames, total: raws.length };
}

/* ------------------------------------------------------------- redimensionar */

/** Redimensiona por média de área (com cor ponderada pela transparência). */
function resize(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * yr, y1 = Math.min(sh, (y + 1) * yr);
    for (let x = 0; x < dw; x++) {
      const x0 = x * xr, x1 = Math.min(sw, (x + 1) * xr);
      let r = 0, g = 0, b = 0, a = 0, wt = 0;
      const iy0 = Math.floor(y0), iy1 = Math.min(sh, Math.max(iy0 + 1, Math.ceil(y1)));
      const ix0 = Math.floor(x0), ix1 = Math.min(sw, Math.max(ix0 + 1, Math.ceil(x1)));
      for (let yy = iy0; yy < iy1; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0) || 1;
        for (let xx = ix0; xx < ix1; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0) || 1;
          const w = wx * wy, o = (yy * sw + xx) * 4, al = src[o + 3];
          a += al * w; wt += w;
          if (al) { r += src[o] * al * w; g += src[o + 1] * al * w; b += src[o + 2] * al * w; }
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(a / wt);
    }
  }
  return out;
}

/** Encaixa a imagem num quadrado size x size (mantém a proporção, bordas transparentes). */
function fitSquare(src, sw, sh, size) {
  const s = Math.min(size / sw, size / sh);
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const small = w === sw && h === sh ? src : resize(src, sw, sh, w, h);
  if (w === size && h === size) return small === src ? src.slice() : small;
  const out = new Uint8Array(size * size * 4);
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) out.set(small.subarray(y * w * 4, (y + 1) * w * 4), ((y + oy) * size + ox) * 4);
  return out;
}

/* ------------------------------------------------------------- paleta (cortes) */

/** Paleta pelo corte mediano. Devolve { pal: Uint8Array(n*3), map: Uint16Array(32768) } (bin RGB555 -> índice). */
function buildPalette(frames, n) {
  const cnt = new Uint32Array(32768);
  const sum = new Float64Array(32768 * 3);
  for (const fr of frames) {
    const d = fr.rgba;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
      cnt[k]++; sum[k * 3] += d[i]; sum[k * 3 + 1] += d[i + 1]; sum[k * 3 + 2] += d[i + 2];
    }
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) bins.push(k);
  const chan = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  let boxes = [bins];
  while (boxes.length < n) {
    let bi = -1, best = 0, bc = 0;
    boxes.forEach((bx, i) => {
      if (bx.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0;
        for (const k of bx) { const v = chan(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        const score = (hi - lo) * Math.log2(bx.length + 1);
        if (score > best) { best = score; bi = i; bc = c; }
      }
    });
    if (bi < 0) break;
    const bx = boxes[bi].slice().sort((a, b) => chan(a, bc) - chan(b, bc));
    let tot = 0; for (const k of bx) tot += cnt[k];
    let run = 0, cut = 1;
    for (let i = 0; i < bx.length - 1; i++) { run += cnt[bx[i]]; cut = i + 1; if (run >= tot / 2) break; }
    boxes.splice(bi, 1, bx.slice(0, cut), bx.slice(cut));
  }
  const pal = new Uint8Array(Math.max(1, boxes.length) * 3);
  boxes.forEach((bx, i) => {
    let r = 0, g = 0, b = 0, t = 0;
    for (const k of bx) { r += sum[k * 3]; g += sum[k * 3 + 1]; b += sum[k * 3 + 2]; t += cnt[k]; }
    if (t) { pal[i * 3] = Math.round(r / t); pal[i * 3 + 1] = Math.round(g / t); pal[i * 3 + 2] = Math.round(b / t); }
  });
  const np = pal.length / 3;
  const map = new Uint16Array(32768).fill(0xffff);
  const nearest = (k) => {
    const r = ((k >> 10) << 3) | 4, g = (((k >> 5) & 31) << 3) | 4, b = ((k & 31) << 3) | 4;
    let bi2 = 0, bd = 1e9;
    for (let i = 0; i < np; i++) {
      const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b;
      const dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (dd < bd) { bd = dd; bi2 = i; }
    }
    return bi2;
  };
  return { pal, np, lookup: (k) => (map[k] === 0xffff ? (map[k] = nearest(k)) : map[k]) };
}

/* --------------------------------------------------------------- escrita (LZW) */

function lzwEncode(idx, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  const out = [];
  let cur = 0, nb = 0;
  const put = (code, size) => { cur |= code << nb; nb += size; while (nb >= 8) { out.push(cur & 255); cur >>>= 8; nb -= 8; } };
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map();
  put(clear, size);
  let w = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const c = idx[i], key = (w << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) { w = hit; continue; }
    put(w, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else { put(clear, size); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    w = c;
  }
  put(w, size);
  put(eoi, size);
  if (nb > 0) out.push(cur & 255);
  return Buffer.from(out);
}

function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); parts.push(Buffer.from([n]), data.subarray(i, i + n)); }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/**
 * Monta o GIF. frames: [{ idx: Uint8Array(size*size), delay }] com índice 0 = transparente.
 * Com transparência de verdade (hasAlpha) cada quadro vem inteiro; sem ela, só o que mudou.
 */
function writeGif(frames, size, pal, np, hasAlpha, tol) {
  let bitsN = 1; while ((1 << bitsN) < np + 1) bitsN++;
  const tableSize = 1 << bitsN;
  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'latin1');
  head.writeUInt16LE(size, 6); head.writeUInt16LE(size, 8);
  head[10] = 0x80 | ((bitsN - 1) << 4) | (bitsN - 1);
  const ct = Buffer.alloc(tableSize * 3);
  for (let i = 0; i < np; i++) { ct[(i + 1) * 3] = pal[i * 3]; ct[(i + 1) * 3 + 1] = pal[i * 3 + 1]; ct[(i + 1) * 3 + 2] = pal[i * 3 + 2]; }
  const parts = [head, ct, Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])];
  let shown = null;
  const palDist = (a, b) => {
    const dr = ct[a * 3] - ct[b * 3], dg = ct[a * 3 + 1] - ct[b * 3 + 1], db = ct[a * 3 + 2] - ct[b * 3 + 2];
    return dr * dr + dg * dg + db * db;
  };
  frames.forEach((f, n) => {
    let x0 = 0, y0 = 0, w = size, h = size, data = f.idx;
    if (!hasAlpha && n > 0) {
      const cur = f.idx.slice();
      let minX = size, minY = size, maxX = -1, maxY = -1;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (cur[i] === shown[i] || (tol && palDist(cur[i], shown[i]) <= tol)) cur[i] = 0; // igual ao que já aparece
        else { shown[i] = cur[i]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      if (maxX < 0) { x0 = 0; y0 = 0; w = 1; h = 1; data = Uint8Array.of(0); }
      else {
        x0 = minX; y0 = minY; w = maxX - minX + 1; h = maxY - minY + 1;
        data = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) data.set(cur.subarray((y + y0) * size + x0, (y + y0) * size + x0 + w), y * w);
      }
    } else if (!hasAlpha) shown = f.idx.slice();
    const gce = Buffer.from([0x21, 0xf9, 4, (hasAlpha ? 2 : 1) << 2 | 1, f.delay & 255, f.delay >> 8, 0, 0]);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c; desc.writeUInt16LE(x0, 1); desc.writeUInt16LE(y0, 3); desc.writeUInt16LE(w, 5); desc.writeUInt16LE(h, 7);
    const minCode = Math.max(2, bitsN);
    parts.push(gce, desc, Buffer.from([minCode]), subBlocks(lzwEncode(data, minCode)));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ principal */

const tick = () => new Promise((r) => setImmediate(r));

function encode(frames, size, colors, tol, step) {
  const kept = [];
  for (let i = 0; i < frames.length; i += step) {
    let delay = 0;
    for (let j = i; j < Math.min(frames.length, i + step); j++) delay += frames[j].delay;
    kept.push({ rgba: frames[i].rgba, delay: Math.min(65535, Math.max(2, delay)) });
  }
  const hasAlpha = kept.some((f) => { for (let i = 3; i < f.rgba.length; i += 4) if (f.rgba[i] < 128) return true; return false; });
  const { pal, np, lookup } = buildPalette(kept, Math.min(colors, 255));
  const out = kept.map((f) => {
    const idx = new Uint8Array(size * size), d = f.rgba;
    for (let i = 0, o = 0; i < d.length; i += 4, o++) {
      idx[o] = d[i + 3] < 128 ? 0 : lookup(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)) + 1;
    }
    return { idx, delay: f.delay };
  });
  return { buf: writeGif(out, size, pal, np, hasAlpha, tol), frames: kept.length };
}

/**
 * Comprime um GIF até caber em `max` bytes.
 * opts: { max, size, fixedSize } — fixedSize (figurinha) mantém sempre size x size.
 * Devolve { buffer, before, after, size, frames, trimmed }.
 */
async function compress(buf, { max, size, fixedSize = false }) {
  const base = readGif(buf, { fitSize: size });
  await tick();
  // do melhor para o pior: [fator do tamanho, pular quadros, cores, tolerância]
  const ladder = fixedSize
    ? [[1, 1, 256, 0], [1, 1, 128, 6], [1, 2, 128, 6], [1, 2, 64, 12], [1, 3, 64, 12], [1, 3, 32, 20], [1, 4, 32, 30], [1, 5, 24, 40]]
    : [[1, 1, 256, 0], [1, 1, 128, 6], [1, 2, 128, 6], [0.75, 2, 64, 12], [0.75, 3, 64, 12], [0.5, 3, 32, 20], [0.5, 4, 32, 30], [0.5, 5, 24, 40]];
  const cache = new Map();
  const framesAt = (factor) => {
    if (factor === 1) return base.frames;
    if (!cache.has(factor)) {
      const s = Math.max(16, Math.round(size * factor));
      cache.set(factor, base.frames.map((f) => ({ rgba: resize(f.rgba, size, size, s, s), delay: f.delay })));
    }
    return cache.get(factor);
  };
  const sizeOf = (factor) => (factor === 1 ? size : Math.max(16, Math.round(size * factor)));
  let last = null;
  for (const [factor, step, colors, tol] of ladder) {
    const r = encode(framesAt(factor), sizeOf(factor), colors, tol, step);
    last = { ...r, size: sizeOf(factor), factor, colors, tol, step };
    if (r.buf.length <= max) return { buffer: r.buf, before: buf.length, after: r.buf.length, size: last.size, frames: r.frames, trimmed: false };
    await tick();
  }
  // último recurso: encurta a duração (mantém o começo) até caber
  const [factor, , colors, tol] = ladder[ladder.length - 1];
  const all = framesAt(factor);
  let n = Math.floor(all.length * Math.min(0.9, max / last.buf.length));
  while (n >= 4) {
    const r = encode(all.slice(0, n), sizeOf(factor), colors, tol, 5);
    if (r.buf.length <= max) return { buffer: r.buf, before: buf.length, after: r.buf.length, size: sizeOf(factor), frames: r.frames, trimmed: true };
    n = Math.floor(n * 0.75);
    await tick();
  }
  throw new Error('Não consegui reduzir esse GIF para ' + Math.round(max / 1024) + ' KB. Use um GIF mais curto.');
}

/** Largura e altura de um GIF (do cabeçalho). */
function dims(buf) {
  return buf.length > 10 ? { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) } : { w: 0, h: 0 };
}

module.exports = { compress, dims, _t: { readGif, lzwDecode, lzwEncode, resize, fitSquare, buildPalette } };
