const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve uma página Web/Dashboard simples
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

app.listen(PORT, () => {
  console.log(`Servidor Web a rodar na porta ${PORT}`);
});

// Inicialização do Bot
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

// Nunca coloques o token em texto limpo no código!
client.login(process.env.TOKEN);
