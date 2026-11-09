// Diagnóstico do ambiente da hospedagem: mostra o que está disponível (ffmpeg, memória, internet...).
// Roda sozinho quando o bot liga (aparece no Console) e também pelo comando /diagnostico (só o dono do bot).
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const premium = require('./premium');

const commands = [
  new SlashCommandBuilder().setName('diagnostico').setDescription('Mostra o que a hospedagem tem instalado (só o dono do bot)'),
];

const mb = (n) => Math.round(n / 1048576) + ' MB';
const gb = (n) => (n / 1073741824).toFixed(1).replace('.', ',') + ' GB';

/** Roda um programa (sem shell) e devolve a 1ª linha da resposta, ou null se não existir. */
function tool(cmd, args = ['-version']) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, out, errOut) => {
        if (err && err.code === 'ENOENT') return resolve(null);
        const text = String(out || errOut || '').split('\n')[0].trim();
        resolve(err && !text ? null : text || 'ok');
      });
    } catch { resolve(null); }
  });
}

async function net(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return r.status < 500;
  } catch { return false; }
}

function cgroupLimit() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      const n = Number(v);
      if (v !== 'max' && n > 0 && n < 1e15) return n;
    } catch { /* ignora */ }
  }
  return null;
}

/** Monta o relatório: lista de linhas { ok, texto }. */
async function report() {
  const L = [];
  const add = (ok, texto) => L.push({ ok, texto });

  add(true, 'Node.js ' + process.version + ' • ' + os.platform() + '/' + os.arch());
  const lim = cgroupLimit();
  add(true, 'Memória do bot agora: ' + mb(process.memoryUsage().rss) + ' • limite do plano: ' + (lim ? mb(lim) : 'não informado') + ' • do servidor: ' + gb(os.totalmem()));
  try {
    const s = fs.statfsSync(path.resolve('.'));
    add(true, 'Disco livre: ' + gb(s.bavail * s.bsize) + ' de ' + gb(s.blocks * s.bsize));
  } catch { add(false, 'Disco: não consegui medir'); }
  add(true, 'CPUs: ' + os.cpus().length + ' • bot ligado há ' + Math.floor(process.uptime() / 60) + ' min');

  const [ffmpeg, ffprobe, gifsicle, magick, convert, python, git] = await Promise.all([
    tool('ffmpeg'), tool('ffprobe'), tool('gifsicle', ['--version']), tool('magick', ['-version']),
    tool('convert', ['-version']), tool('python3', ['--version']), tool('git', ['--version']),
  ]);
  const one = (nome, v, para) => add(!!v, nome + ': ' + (v ? 'instalado (' + v.slice(0, 60) + ')' : 'não encontrado') + (para ? ' — ' + para : ''));
  one('ffmpeg', ffmpeg, 'converter vídeo em GIF');
  one('ffprobe', ffprobe, 'ler dados de vídeo');
  one('gifsicle', gifsicle, 'compressão de GIF ainda melhor');
  one('ImageMagick', magick || convert, 'editar imagens');
  one('Python 3', python, 'scripts extras');
  one('git', git, 'atualizar direto do GitHub');

  let canvas = false;
  try { require('@napi-rs/canvas').createCanvas(2, 2); canvas = true; } catch { /* sem canvas */ }
  add(canvas, 'Imagens (@napi-rs/canvas): ' + (canvas ? 'funcionando' : 'NÃO carregou — cartões e emojis de imagem não funcionam'));
  add(typeof fetch === 'function', 'fetch (internet no Node): ' + (typeof fetch === 'function' ? 'disponível' : 'indisponível'));

  const [discord, yt, twitch, github] = await Promise.all([
    net('https://discord.com/api/v10/gateway'), net('https://www.youtube.com'), net('https://api.twitch.tv'), net('https://api.github.com'),
  ]);
  add(discord, 'Acesso ao Discord: ' + (discord ? 'ok' : 'FALHOU'));
  add(yt, 'Acesso ao YouTube: ' + (yt ? 'ok' : 'bloqueado') + ' — para alertas de canal');
  add(twitch, 'Acesso à Twitch: ' + (twitch ? 'ok' : 'bloqueado') + ' — para alertas de live');
  add(github, 'Acesso ao GitHub: ' + (github ? 'ok' : 'bloqueado'));
  return L;
}

const format = (L) => L.map((x) => (x.ok ? '✅ ' : '❌ ') + x.texto).join('\n');

/** Imprime no Console (chamado quando o bot liga). */
async function logStartup() {
  try {
    const L = await report();
    console.log('\n===== DIAGNÓSTICO DA HOSPEDAGEM =====\n' + L.map((x) => (x.ok ? '[OK]   ' : '[NÃO]  ') + x.texto).join('\n') + '\n=====================================\n');
  } catch (e) { console.warn('[diagnostico] falhou:', e.message); }
}

async function handleSlash(i) {
  if (i.commandName !== 'diagnostico') return false;
  if (!premium.isBotOwner(i.user.id)) {
    await i.reply({ content: 'Só o dono do bot pode usar este comando.', flags: MessageFlags.Ephemeral });
    return true;
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const L = await report();
  await i.editReply({ content: '**🔧 Diagnóstico da hospedagem**\n' + format(L) });
  return true;
}

module.exports = { commands, handleSlash, logStartup, report };
