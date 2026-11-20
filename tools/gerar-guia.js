// Gera assets/coaching-guia.png (guia limpo de como montar as formações).
const fs = require('fs'), path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.registerFromPath(path.join(__dirname, '..', 'assets', 'font.ttf'), 'BotFont');
const F = 'BotFont';
const W = 1200, H = 1180;
const c = createCanvas(W, H), x = c.getContext('2d');
const rr = (a, b, w, h, r) => { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); };
const t = (s, a, b, { size = 30, color = '#fff', w = 'bold', align = 'left', max = 0 } = {}) => {
  let z = size; x.textBaseline = 'middle'; x.textAlign = align; x.fillStyle = color; x.font = `${w} ${z}px ${F}`;
  if (max) while (z > 12 && x.measureText(s).width > max) { z--; x.font = `${w} ${z}px ${F}`; }
  x.fillText(s, a, b);
};
const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d1e24'); g.addColorStop(1, '#101114');
x.fillStyle = g; x.fillRect(0, 0, W, H);
x.fillStyle = '#e67e22'; x.fillRect(0, 0, W, 10);
t('COMO MONTAR SUAS FORMAÇÕES', W / 2, 72, { size: 50, align: 'center' });
t('Siga os passos e envie UM print com os 4 times no canal de formações', W / 2, 122, { size: 25, color: '#b5bac1', w: 'normal', align: 'center' });

const steps = [
  ['Toque em Batalha', 'No canto inferior direito do jogo.'],
  ['Abra Formações', 'No canto superior da tela de Batalha.'],
  ['Monte os 4 times de guerra', 'TIME 1, TIME 2, TIME 3 e TIME 4, com 5 Capos cada.'],
  ['Não repita Capos', 'Um mesmo Capo não pode estar em dois times da guerra.'],
  ['Confira o poder dos times', 'Veja o poder de cada time antes de tirar o print.'],
  ['Tire UM print com os 4 times', 'Os quatro times precisam aparecer na mesma imagem.'],
];
let y = 175;
steps.forEach(([a, b], i) => {
  x.fillStyle = '#24262d'; rr(x, 50, y, W - 100, 96, 18); x.fill();
  x.fillStyle = '#e67e22'; x.beginPath(); x.arc(106, y + 48, 30, 0, 7); x.fill();
  t(String(i + 1), 106, y + 49, { size: 34, color: '#111' , align: 'center' });
  t(a, 160, y + 32, { size: 31, max: W - 260 });
  t(b, 160, y + 68, { size: 23, color: '#b5bac1', w: 'normal', max: W - 260 });
  y += 110;
});

// esquema: 4 times de 5 capos
y += 5;
t('Seu print deve ficar assim:', W / 2, y + 15, { size: 28, color: '#e67e22', align: 'center' }); y += 50;
for (let r = 0; r < 4; r++) {
  const rowY = y + r * 56;
  x.fillStyle = '#24262d'; rr(x, 250, rowY, 700, 46, 12); x.fill();
  t('TIME ' + (r + 1), 275, rowY + 24, { size: 24 });
  for (let k = 0; k < 5; k++) { x.fillStyle = ['#e67e22', '#3498db', '#2ecc71', '#9b59b6', '#e74c3c'][k]; x.beginPath(); x.arc(520 + k * 80, rowY + 23, 16, 0, 7); x.fill(); }
}
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'coaching-guia.png'), c.toBuffer('image/png'));
console.log('ok', W, H);
