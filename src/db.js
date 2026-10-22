// Armazenamento simples em arquivo JSON (sem dependências nativas).
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'db.json');
fs.mkdirSync(DIR, { recursive: true });

let data = { guilds: {}, users: {} };
try {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data.guilds = raw.guilds || {};
  data.users = raw.users || {};
} catch {
  /* arquivo novo */
}

let timer = null;
function writeNow() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      writeNow();
    } catch (e) {
      console.error('[db] erro ao salvar:', e);
    }
  }, 1500);
}
function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    writeNow();
  } catch (e) {
    console.error('[db] erro ao salvar:', e);
  }
}
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

function getUser(guildId, userId) {
  const g = (data.users[guildId] ??= {});
  return (g[userId] ??= { xp: 0, msgs: 0 });
}
function top(guildId, n = 10) {
  return Object.entries(data.users[guildId] || {})
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, n);
}
function rankOf(guildId, userId) {
  const sorted = Object.entries(data.users[guildId] || {}).sort((a, b) => b[1].xp - a[1].xp);
  const i = sorted.findIndex(([id]) => id === userId);
  return i < 0 ? sorted.length + 1 : i + 1;
}

module.exports = { data, save, flush, getUser, top, rankOf };
