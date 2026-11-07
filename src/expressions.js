// Emojis e figurinhas do servidor, nomeados qsd_01, qsd_02...
const { PermissionFlagsBits } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const LIM = { emoji: { max: 256 * 1024, size: 128 }, sticker: { max: 512 * 1024, size: 320 } };
const isGif = (b) => b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8';

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
  const gif = isGif(buf);
  const lim = LIM[type];
  const file = gif ? buf : await toPng(buf, lim.size);
  if (file.length > lim.max) throw new Error((gif ? 'GIF' : 'imagem') + ' acima de ' + lim.max / 1024 + ' KB');
  const name = nextName(guild, type);
  try {
    if (type === 'emoji') await guild.emojis.create({ attachment: file, name, reason: 'Painel do bot' });
    else await guild.stickers.create({ file: { attachment: file, name: name + (gif ? '.gif' : '.png') }, name, tags: 'grinning', reason: 'Painel do bot' });
  } catch (e) { throw new Error(explain(e)); }
  return { name, animated: gif };
}

module.exports = { add };
