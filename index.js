const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,        // Necessário para Entradas e Saídas
        GatewayIntentBits.GuildMessages,       // Necessário para ler mensagens e dar XP
        GatewayIntentBits.MessageContent       // Necessário para comandos e tradutor
    ]
});

// Simulando as configurações que virão do seu site (MongoDB)
let configDoSite = {
    canalBoasVindasId: 'ID_DO_CANAL_AQUI',
    mensagemEntrada: 'Olá {user}, bem-vindo(a) ao servidor **{server}**! 🎉',
    
    canalSaidaId: 'ID_DO_CANAL_AQUI',
    mensagemSaida: 'O membro **{user}** saiu do servidor. 😢',
    
    xpAtivo: true,
    canalRankId: 'ID_DO_CANAL_AQUI', // Se vazio, envia no próprio canal do chat
};

// Armazenamento temporário de XP dos membros
const xpUsuarios = new Map();

client.on('ready', () => {
    console.log(`🤖 Bot ${client.user.tag} está online e pronto!`);
});

// ==========================================
// 1. BOAS-VINDAS (Membro Entrou)
// ==========================================
client.on('guildMemberAdd', async (member) => {
    const canal = member.guild.channels.cache.get(configDoSite.canalBoasVindasId);
    if (!canal) return;

    // Substitui as variáveis personalizadas configuradas no site
    let texto = configDoSite.mensagemEntrada
        .replace('{user}', member.toString())
        .replace('{server}', member.guild.name);

    canal.send(texto);
});

// ==========================================
// 2. MENSAGEM DE SAÍDA (Membro Saiu)
// ==========================================
client.on('guildMemberRemove', async (member) => {
    const canal = member.guild.channels.cache.get(configDoSite.canalSaidaId);
    if (!canal) return;

    let texto = configDoSite.mensagemSaida
        .replace('{user}', member.user.username)
        .replace('{server}', member.guild.name);

    canal.send(texto);
});

// ==========================================
// 3. SISTEMA DE RANK / XP POR MENSAGEM
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // --- TRADUTOR SIMPLES (Exemplo: !traduzir en Olá mundo) ---
    if (message.content.startsWith('!traduzir')) {
        const args = message.content.split(' ');
        const idioma = args[1]; // ex: en, es, fr
        const textoParaTraduzir = args.slice(2).join(' ');

        if (!idioma || !textoParaTraduzir) {
            return message.reply('❌ Use o formato: `!traduzir <idioma> <texto>` (Ex: `!traduzir en Olá tudo bem?`)');
        }

        try {
            // Usa uma API de tradução gratuita
            const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${idioma}&dt=t&q=${encodeURIComponent(textoParaTraduzir)}`;
            
            const res = await fetch(url);
            const data = await res.json();
            const traducao = data[0][0][0];

            return message.reply(`🌐 **Tradução (${idioma.toUpperCase()}):**\n${traducao}`);
        } catch (err) {
            return message.reply('❌ Erro ao traduzir a mensagem.');
        }
    }

    // --- COMANDO PARA GERAR PAINEL DE BOTÕES DE CARGOS ---
    if (message.content === '!painelcargos') {
        const embed = new EmbedBuilder()
            .setTitle('🎭 Escolha seus Cargos')
            .setDescription('Clique nos botões abaixo para receber ou remover cargos!')
            .setColor('#5865F2');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('cargo_notif')
                .setLabel('🔔 Notificações')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('cargo_jogos')
                .setLabel('🎮 Jogador')
                .setStyle(ButtonStyle.Success)
        );

        return message.channel.send({ embeds: [embed], components: [row] });
    }

    // --- SISTEMA DE XP / LEVEL UP ---
    if (configDoSite.xpAtivo) {
        const userId = message.author.id;
        let dadosUsuario = xpUsuarios.get(userId) || { xp: 0, level: 1 };

        dadosUsuario.xp += Math.floor(Math.random() * 10) + 5; // Ganha entre 5 e 15 de XP
        const xpNecessario = dadosUsuario.level * 100;

        // Subiu de Nível!
        if (dadosUsuario.xp >= xpNecessario) {
            dadosUsuario.level += 1;
            dadosUsuario.xp = 0;

            const canalNotif = message.guild.channels.cache.get(configDoSite.canalRankId) || message.channel;
            canalNotif.send(`🎉 Parabéns ${message.author}! Você subiu para o **Nível ${dadosUsuario.level}**! 🚀`);
        }

        xpUsuarios.set(userId, dadosUsuario);
    }
});

// ==========================================
// GERENCIADOR DE CLIQUES NOS BOTÕES DE CARGOS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // IDs dos Cargos configurados no seu Discord
    const cargos = {
        'cargo_notif': 'ID_DO_CARGO_NOTIFICACOES',
        'cargo_jogos': 'ID_DO_CARGO_JOGOS'
    };

    const roleId = cargos[interaction.customId];
    if (!roleId) return;

    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) {
        return interaction.reply({ content: '❌ Cargo não encontrado no Discord!', ephemeral: true });
    }

    if (interaction.member.roles.cache.has(roleId)) {
        await interaction.member.roles.remove(roleId);
        interaction.reply({ content: '🗑️ Cargo **' + role.name + '** removido!', ephemeral: true });
    } else {
        await interaction.member.roles.add(roleId);
        interaction.reply({ content: '✅ Você recebeu o cargo **' + role.name + '**!', ephemeral: true });
    }
});

client.login('MTU1MDM2OTAwNzI4NTA1MTQxMg.GvbKIl.hmSloXa7d7eYCvhhU8hrtOKfOASPQ0Z5Lr72AM');
