const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const app = express();

// O Bot-Hosting fornece a porta através da variável SERVER_PORT ou PORT
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

// Servidor Web / Dashboard Simples
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>BOT QSD - Painel</title>
      <style>
        body { font-family: sans-serif; background: #1e1e2e; color: #fff; text-align: center; padding: 50px; }
        h1 { color: #5865F2; }
        .status { background: #2b2d42; display: inline-block; padding: 15px 25px; border-radius: 8px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>🤖 BOT QSD</h1>
      <p>O teu Bot para Discord está Ativo e Online!</p>
      <div class="status">Status: 🟢 Ligado 24/7</div>
    </body>
    </html>
  `);
});

// É necessário escutar em '0.0.0.0' para o Bot-Hosting conseguir reencaminhar o tráfego
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Web a rodar na porta ${PORT}`);
});

// Inicialização do Bot Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Bot ligado com sucesso como: ${client.user.tag}`);
});

// Escutar e responder às mensagens no chat
client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!ping') {
    message.reply('Pong! 🏓 O BOT QSD está funcional!');
  } else if (message.content.toLowerCase() === 'oi' || message.content.toLowerCase() === 'olá') {
    message.reply(`Olá, ${message.author.username}! Como posso ajudar?`);
  }
});

// Login seguro usando a variável de ambiente
client.login(process.env.TOKEN);
