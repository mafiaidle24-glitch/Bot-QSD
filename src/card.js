// Geração das imagens (cartão de boas-vindas/saída e cartão de rank).
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Fonte opcional: coloque um .ttf em assets/font.ttf (útil em hospedagens sem fontes instaladas).
const customFont = path.join(__dirname, '..', 'assets', 'font.ttf');
if (fs.existsSync(customFont)) GlobalFonts.registerFromPath(customFont, 'BotFont');
const FONT = fs.existsSync(customFont) ? 'BotFont' : 'sans-serif';
if (GlobalFonts.families.length === 0 && !fs.existsSync(customFont)) {
  console.warn(
    '[card] Nenhuma fonte encontrada no sistema. Instale uma (ex.: "apt install fonts-dejavu-core") ou coloque um arquivo em assets/font.ttf.'
  );
}

const stripEmoji = (s) => String(s || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

const imgCache = new Map(); // url -> { img, exp }

async function fetchImage(src, { guard = true } = {}) {
  if (!src) return null;
  const hit = imgCache.get(src);
  if (hit && hit.exp > Date.now()) return hit.img;
  try {
    const u = new URL(src);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (guard) {
      // Evita que alguém use a URL do fundo para acessar a rede interna do servidor.
      const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
      if (addrs.some((a) => isPrivateIp(a.address))) return null;
    }
    const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!r.ok) return null;
    if (Number(r.headers.get('content-length') || 0) > 8 * 1024 * 1024) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
    const img = await loadImage(buf);
    if (imgCache.size > 30) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(src, { img, exp: Date.now() + 10 * 60 * 1000 });
    return img;
  } catch {
    return null;
  }
}

function drawText(ctx, text, x, y, { size, color, weight = 'bold', maxW = 900, align = 'center' }) {
  if (!text) return;
  let s = size;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    s -= 2;
  } while (ctx.measureText(text).width > maxW && s > 12);
  ctx.lineWidth = Math.max(3, Math.round(s / 5));
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function defaultBackground(ctx, W, H, kind) {
  const stops =
    kind === 'leave'
      ? ['#1b1b2f', '#3a2f4f', '#7a3b4f', '#c0654f']
      : ['#2a2358', '#6b3fa0', '#e0589a', '#f7a072'];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // "sol" e silhueta do chão
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.55, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(15,12,30,0.55)';
  ctx.fillRect(0, H * 0.82, W, H * 0.18);
}

function cover(ctx, img, W, H) {
  const r = Math.max(W / img.width, H / img.height);
  const w = img.width * r;
  const h = img.height * r;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function circleImage(ctx, img, cx, cy, r, fallback = '#5865f2') {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = fallback;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Cartão de boas-vindas / saída. */
async function renderCard(o) {
  const W = 1024;
  const H = 500;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = await fetchImage(o.bgUrl);
  if (bg) cover(ctx, bg, W, H);
  else defaultBackground(ctx, W, H, o.kind);

  const shade = ctx.createLinearGradient(0, H * 0.4, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const av = await fetchImage(o.avatarUrl, { guard: false });
  const cx = W / 2;
  const cy = 180;
  const r = 105;
  circleImage(ctx, av, cx, cy, r);
  ctx.lineWidth = 9;
  ctx.strokeStyle = o.accent || '#e8a33d';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.stroke();

  drawText(ctx, stripEmoji(o.title), cx, 340, { size: 68, color: o.titleColor || '#fff' });
  drawText(ctx, stripEmoji(o.name).toUpperCase(), cx, 398, { size: 44, color: o.nameColor || '#fff', maxW: 880 });
  drawText(ctx, stripEmoji(o.subtitle), cx, 450, { size: 27, color: o.subtitleColor || '#fff' });

  return canvas.toBuffer('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Cartão de rank (/rank). */
async function renderRank(o) {
  const W = 934;
  const H = 282;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#18181c';
  roundRect(ctx, 0, 0, W, H, 24);
  ctx.fill();
  ctx.fillStyle = '#232428';
  roundRect(ctx, 16, 16, W - 32, H - 32, 18);
  ctx.fill();

  const av = await fetchImage(o.avatarUrl, { guard: false });
  circleImage(ctx, av, 136, 141, 82);
  ctx.lineWidth = 7;
  ctx.strokeStyle = o.accent || '#5865f2';
  ctx.beginPath();
  ctx.arc(136, 141, 86, 0, Math.PI * 2);
  ctx.stroke();

  const left = 260;
  drawText(ctx, stripEmoji(o.name), left, 88, { size: 40, color: '#ffffff', maxW: 380, align: 'left' });
  drawText(ctx, `NÍVEL ${o.level}`, W - 50, 70, { size: 38, color: o.accent || '#5865f2', align: 'right', maxW: 300 });
  drawText(ctx, `RANK #${o.rank}`, W - 50, 112, { size: 30, color: '#d0d0d0', align: 'right', maxW: 300 });
  drawText(ctx, `${o.current} / ${o.needed} XP`, W - 50, 160, { size: 24, color: '#b5bac1', weight: 'normal', align: 'right', maxW: 300 });

  const bx = left;
  const by = 190;
  const bw = W - 50 - left;
  const bh = 36;
  ctx.fillStyle = '#111214';
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  const ratio = Math.max(0.02, Math.min(1, o.current / o.needed));
  ctx.fillStyle = o.accent || '#5865f2';
  roundRect(ctx, bx, by, Math.max(bh, bw * ratio), bh, bh / 2);
  ctx.fill();
  drawText(ctx, `${o.totalXp} XP no total`, left, 248, { size: 20, color: '#949ba4', weight: 'normal', align: 'left', maxW: 400 });

  return canvas.toBuffer('image/png');
}

module.exports = { renderCard, renderRank };
