// Imagem do ranking semanal de pontos da gangue (desenhada com canvas).
// draw() recebe qualquer contexto 2D, assim dá para testar no navegador também.
const COLS_FROM = 17; // acima disso usa duas colunas

const strip = (s) => String(s || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(ctx, FONT, t, x, y, { size = 24, color = '#fff', weight = 'bold', align = 'left', maxW = 0 } = {}) {
  let s = size;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.font = weight + ' ' + s + 'px ' + FONT;
  if (maxW) while (s > 11 && ctx.measureText(t).width > maxW) { s -= 1; ctx.font = weight + ' ' + s + 'px ' + FONT; }
  ctx.fillText(t, x, y);
}

function size(n) {
  const cols = n >= COLS_FROM ? 2 : 1;
  const colW = 700, pad = 30, gap = 24, rowH = 56, headH = 170, footH = 70;
  const per = Math.max(1, Math.ceil(Math.max(n, 1) / cols));
  return { cols, colW, pad, gap, rowH, headH, footH, per, W: pad * 2 + cols * colW + (cols - 1) * gap, H: headH + per * rowH + footH };
}

/**
 * o = { title, subtitle, color, rows:[{name, role, points, max}], max, goal, gang:{level, exp, expMax}, footer }
 */
function draw(ctx, o, FONT = 'sans-serif') {
  const rows = o.rows || [];
  const L = size(rows.length);
  const accent = o.color || '#e67e22';
  const g = ctx.createLinearGradient(0, 0, 0, L.H);
  g.addColorStop(0, '#1b1c20'); g.addColorStop(1, '#111214');
  ctx.fillStyle = g; ctx.fillRect(0, 0, L.W, L.H);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, L.W, 8);

  text(ctx, FONT, strip(o.title || 'RANKING SEMANAL'), L.pad, 52, { size: 44, color: '#ffffff', maxW: L.W - 360 });
  text(ctx, FONT, strip(o.subtitle || ''), L.pad, 98, { size: 22, color: '#b5bac1', weight: 'normal', maxW: L.W - 360 });
  if (o.gang && o.gang.level) {
    text(ctx, FONT, 'GANGUE NÍVEL ' + o.gang.level, L.W - L.pad, 48, { size: 28, color: accent, align: 'right', maxW: 300 });
    if (o.gang.exp) text(ctx, FONT, o.gang.exp + (o.gang.expMax ? ' / ' + o.gang.expMax : ''), L.W - L.pad, 84, { size: 20, color: '#d0d0d0', weight: 'normal', align: 'right', maxW: 300 });
    if (o.gang.ratio >= 0) {
      const bx = L.W - L.pad - 300, by = 104, bw = 300, bh = 14;
      ctx.fillStyle = '#0c0d0e'; rr(ctx, bx, by, bw, bh, 7); ctx.fill();
      ctx.fillStyle = accent; rr(ctx, bx, by, Math.max(bh, bw * Math.min(1, o.gang.ratio)), bh, 7); ctx.fill();
    }
  }
  text(ctx, FONT, o.summary || '', L.pad, 138, { size: 20, color: '#949ba4', weight: 'normal', maxW: L.W - L.pad * 2 });

  const MEDAL = ['#f1c40f', '#c0c5cc', '#cd7f32'];
  rows.forEach((r, i) => {
    const col = Math.floor(i / L.per), line = i % L.per;
    const x = L.pad + col * (L.colW + L.gap), y = L.headH + line * L.rowH;
    ctx.fillStyle = '#232428'; rr(ctx, x, y, L.colW, L.rowH - 6, 12); ctx.fill();
    const cy = y + (L.rowH - 6) / 2;
    ctx.fillStyle = i < 3 ? MEDAL[i] : '#4e5058';
    ctx.beginPath(); ctx.arc(x + 30, cy, 19, 0, Math.PI * 2); ctx.fill();
    text(ctx, FONT, String(i + 1), x + 30, cy + 1, { size: 20, color: i < 3 ? '#1b1c20' : '#ffffff', align: 'center', maxW: 30 });
    text(ctx, FONT, strip(r.name) || '?', x + 62, cy - 9, { size: 24, color: '#ffffff', maxW: 250 });
    const roleTxt = strip(r.role || '');
    text(ctx, FONT, roleTxt, x + 62, cy + 15, { size: 14, color: '#949ba4', weight: 'normal', maxW: 150 });
    if (r.rank > 0) {
      // "Rank 34" (posição da rua no jogo) logo depois do cargo
      ctx.font = 'normal 14px ' + FONT;
      const rx = x + 62 + Math.min(150, roleTxt ? ctx.measureText(roleTxt).width + 10 : 0);
      text(ctx, FONT, (roleTxt ? '· ' : '') + 'Rank ' + r.rank, rx, cy + 15, { size: 14, color: accent, maxW: 100 });
    }
    const max = r.max || o.max || 2740;
    const bx = x + 330, bw = L.colW - 330 - 130, bh = 18, by = cy - bh / 2;
    ctx.fillStyle = '#111214'; rr(ctx, bx, by, bw, bh, 9); ctx.fill();
    const low = o.goal > 0 && r.points < o.goal;
    const color = r.points <= 0 ? '#7a2e2e' : low ? '#d35400' : '#2ecc71';
    if (r.points > 0) { ctx.fillStyle = color; rr(ctx, bx, by, Math.max(bh, bw * Math.min(1, r.points / max)), bh, 9); ctx.fill(); }
    text(ctx, FONT, String(r.points), x + L.colW - 62, cy - 1, { size: 26, color: r.points <= 0 ? '#e74c3c' : low ? '#e67e22' : '#ffffff', align: 'right', maxW: 80 });
    text(ctx, FONT, '/' + max, x + L.colW - 14, cy + 2, { size: 14, color: '#6d7078', weight: 'normal', align: 'right', maxW: 50 });
  });
  text(ctx, FONT, o.footer || '', L.pad, L.H - 34, { size: 18, color: '#6d7078', weight: 'normal', maxW: L.W - L.pad * 2 });
}

function render(o) {
  const fs = require('fs'), path = require('path');
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  const font = path.join(__dirname, '..', 'assets', 'font.ttf');
  if (fs.existsSync(font)) { try { GlobalFonts.registerFromPath(font, 'BotFont'); } catch { /* já registrada */ } }
  const FONT = fs.existsSync(font) ? 'BotFont' : 'sans-serif';
  const L = size((o.rows || []).length);
  const canvas = createCanvas(L.W, L.H);
  draw(canvas.getContext('2d'), o, FONT);
  return canvas.toBuffer('image/png');
}

module.exports = { draw, render, size };
