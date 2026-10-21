const { 
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType 
} = require('discord.js');
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

// Banco de Dados Simples em Arquivo JSON
const DATA_FILE = './config.json';
let config = {
  welcomeChannel: '',
  welcomeMsg: 'Bem-vindo(a) ao servidor, {user}!',
  leaveChannel: '',
  leaveMsg: '{user} saiu do servidor.',
  customCommands: {},
  levels: {}
};

if (fs.existsSync(DATA_FILE)) {
  try { config = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
}

function saveConfig() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
}

// ==================== PAINEL WEB ====================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>BOT QSD - Painel de Configurações</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #18191c; color: #dcddde; margin: 0; padding: 20px; }
        .container { max-width: 800px; margin: auto; background: #2f3136; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        h1, h2 { color: #5865f2; border-bottom: 2px solid #40444b; padding-bottom: 10px; }
        label { display: block; margin-top: 15px; font-weight: bold; }
        input, textarea, select { width: 100%; padding: 10px; margin-top: 5px; background: #40444b; border: 1px solid #202225; color: white; border-radius: 5px; box-sizing: border-box; }
        button { background: #5865f2; color: white; border: none; padding: 12px 20px; border-radius: 5px; margin-top: 20px; cursor: pointer; font-size: 16px; font-weight: bold; width: 100%; }
        button:hover { background: #4752c4; }
        .card { background: #36393f; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 BOT QSD - Painel de Configurações</h1>
        
        <form action="/save" method="POST">
          <div class="card">
            <h2>🎉 Mensagens Automáticas</h2>
            <label>ID do Canal de Boas-Vindas:</label>
            <input type="text" name="welcomeChannel" value="${config.welcomeChannel || ''}" placeholder="Ex: 123456789012345678">
            
            <label>Mensagem de Boas-Vindas ({user} para mencionar):</label>
            <textarea name="welcomeMsg">${config.welcomeMsg}</textarea>

            <label>ID do Canal de Saída:</label>
            <input type="text" name="leaveChannel" value="${config.leaveChannel || ''}" placeholder="Ex: 123456789012345678">

            <label>Mensagem de Saída:</label>
            <textarea name="leaveMsg">${config.leaveMsg}</textarea>
          </div>

          <div class="card">
            <h2>⚡ Comando Personalizado Rápido</h2>
            <label>Nome do Comando (sem prefixo):</label>
            <input type="text" name="cmdName" placeholder="Ex: regras">
            
            <label>Resposta do Bot:</label>
            <textarea name="cmdResponse" placeholder="Ex: Respeite as regras do servidor!"></textarea>
          </div>

          <button type="submit">💾 Salvar Configurações</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/save', (req, res) => {
  config.welcomeChannel = req.body.welcomeChannel;
  config.welcomeMsg = req.body.welcomeMsg;
  config.leaveChannel = req.body.leaveChannel;
  config.leaveMsg = req.body.leaveMsg;

  if (req.body.cmdName && req.body.cmdResponse) {
    config.customCommands[req.body.cmdName.toLowerCase()] = req.body.cmdResponse;
  }

  saveConfig();
  res.send('<h2>✅ Configurações salvas com sucesso! <a href="/">Voltar ao Painel</a></h2>');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Painel Web ativo na porta ${PORT}`);
});

// ==================== DISCORD BOT ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => {
  console.log(`BOT QSD ativado como: ${client.user.tag}`);
});

// 1. Entrada de Membros (Boas-Vindas)
client.on('guildMemberAdd', (member) => {
  if (!config.welcomeChannel) return;
  const channel = member.guild.channels.cache.get(config.welcomeChannel);
  if (channel) {
    const msg = config.welcomeMsg.replace('{user}', `<@${member.id}>`);
    channel.send(msg);
  }
});

// 2. Saída de Membros
client.on('guildMemberRemove', (member) => {
  if (!config.leaveChannel) return;
  const channel = member.guild.channels.cache.get(config.leaveChannel);
  if (channel) {
    const msg = config.leaveMsg.replace('{user}', member.user.username);
    channel.send(msg);
  }
});

// 3. Sistema de Chat (Comandos, XP, Jogos e Comandos Personalizados)
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Sistema de Nível / XP simples
  const userId = message.author.id;
  if (!config.levels[userId]) config.levels[userId] = { xp: 0, level: 1 };
  config.levels[userId].xp += 5;
  
  if (config.levels[userId].xp >= config.levels[userId].level * 100) {
    config.levels[userId].level += 1;
    message.channel.send(`🎉 Parabéns ${message.author}! Subiste para o **Nível ${config.levels[userId].level}**!`);
  }
  saveConfig();

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Comando de Rank
  if (command === '!rank') {
    const userStats = config.levels[userId];
    return message.reply(`📊 **Teu Stats:** Nível: **${userStats.level}** | XP: **${userStats.xp}/${userStats.level * 100}**`);
  }

  // Mini-Jogo: Pedra, Papel ou Tesoura
  if (command === '!ppt') {
    const escolhas = ['pedra', 'papel', 'tesoura'];
    const botEscolha = escolhas[Math.floor(Math.random() * escolhas.length)];
    const userEscolha = args[0]?.toLowerCase();

    if (!escolhas.includes(userEscolha)) {
      return message.reply('Uso correto: `!ppt pedra`, `!ppt papel` ou `!ppt tesoura`');
    }

    if (userEscolha === botEscolha) {
      return message.reply(`Empate! Eu também escolhi **${botEscolha}**! 🤜🤛`);
    }

    const venceu = (userEscolha === 'pedra' && botEscolha === 'tesoura') ||
                  (userEscolha === 'papel' && botEscolha === 'pedra') ||
                  (userEscolha === 'tesoura' && botEscolha === 'papel');

    if (venceu) {
      return message.reply(`Ganhaste! Escolhi **${botEscolha}**! 🎉`);
    } else {
      return message.reply(`Perdeste! Escolhi **${botEscolha}**! 😜`);
    }
  }

  // Mini-Jogo: Adivinhar Número
  if (command === '!adivinhar') {
    const numero = Math.floor(Math.random() * 10) + 1;
    const palpite = parseInt(args[0]);

    if (!palpite || palpite < 1 || palpite > 10) {
      return message.reply('Tenta adivinhar um número entre 1 e 10! Exemplo: `!adivinhar 7`');
    }

    if (palpite === numero) {
      return message.reply(`🎯 Acertaste em cheio! O número era **${numero}**!`);
    } else {
      return message.reply(`❌ Erraste! O número certo era **${numero}**.`);
    }
  }

  // Comandos Personalizados Criados pelo Site
  if (config.customCommands[command.replace('!', '')]) {
    return message.channel.send(config.customCommands[command.replace('!', '')]);
  }
});

client.login(process.env.TOKEN);
