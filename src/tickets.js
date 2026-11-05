const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const CATEGORY_NAME = '🎫 Tickets';
const OPEN_BUTTON_ID = 'ticket:open';
const CLOSE_BUTTON_ID = 'ticket:close';
const EPHEMERAL = MessageFlags.Ephemeral;

// Nome do canal: só letras/números do nome de usuário; se ficar vazio, usa o final do ID.
function channelNameFor(user) {
  const clean = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  return 'ticket-' + (clean || user.id.slice(-6));
}

async function ensureCategory(guild) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
  );
  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: guild.members.me.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels],
        },
      ],
    });
  }
  return category;
}

// Cargos da staff: quem tem "Gerenciar Mensagens" (ignora @everyone e cargos de bots).
function staffRolesOf(guild) {
  return guild.roles.cache.filter(
    (r) => r.id !== guild.id && !r.managed && r.permissions.has(PermissionFlagsBits.ManageMessages)
  );
}

async function createTicket(interaction) {
  const { guild, user } = interaction;
  const me = guild.members.me;

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: 'Não consigo criar o ticket: o bot precisa da permissão **Gerenciar Canais**. Avise um administrador.',
      flags: EPHEMERAL,
    });
  }

  // Um ticket aberto por pessoa (identificado pelo tópico do canal).
  const existing = guild.channels.cache.find((c) => c.topic === 'ticket-' + user.id);
  if (existing) {
    return interaction.reply({
      content: 'Você já tem um ticket aberto: ' + existing,
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  try {
    const category = await ensureCategory(guild);

    const channel = await guild.channels.create({
      name: channelNameFor(user),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'ticket-' + user.id,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    for (const role of staffRolesOf(guild).values()) {
      await channel.permissionOverwrites
        .edit(role.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true })
        .catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Ticket Aberto')
      .setDescription(
        'Olá ' + user + ',\n\nExplique o motivo do seu contato.\nA staff vai te responder em breve.\n\nPara fechar o ticket, clique no botão abaixo.'
      )
      .setFooter({ text: 'Ticket de ' + user.username })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CLOSE_BUTTON_ID)
        .setLabel('Fechar Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );

    await channel.send({
      content: '' + user,
      embeds: [embed],
      components: [row],
      allowedMentions: { users: [user.id] },
    });

    await interaction.editReply({ content: 'Seu ticket foi criado: ' + channel });
  } catch (e) {
    console.error('[tickets] erro ao criar:', e.message);
    await interaction.editReply({
      content: 'Não consegui criar o ticket agora. Avise um administrador (confira as permissões do bot).',
    });
  }
}

async function closeTicket(interaction) {
  const channel = interaction.channel;

  if (!channel.topic?.startsWith('ticket-')) {
    return interaction.reply({
      content: 'Este botão só funciona dentro de um ticket.',
      flags: EPHEMERAL,
    });
  }

  // Só o dono do ticket ou a staff podem fechar.
  const ownerId = channel.topic.slice('ticket-'.length);
  const isOwner = interaction.user.id === ownerId;
  const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (!isOwner && !isStaff) {
    return interaction.reply({
      content: 'Só o dono do ticket ou a staff podem fechá-lo.',
      flags: EPHEMERAL,
    });
  }

  await interaction.reply({ content: '🔒 Fechando o ticket em 5 segundos...' });

  setTimeout(async () => {
    try {
      await channel.delete('Ticket fechado por ' + interaction.user.username);
    } catch (e) {
      console.error('[tickets] erro ao fechar:', e.message);
    }
  }, 5000);
}

function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Central de Atendimento')
    .setDescription('Precisa de ajuda?\nClique no botão abaixo para abrir um **ticket** privado com a staff.')
    .setFooter({ text: 'Bot QSD • Sistema de Tickets' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_BUTTON_ID)
      .setLabel('Abrir Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫')
  );

  return { embeds: [embed], components: [row] };
}

async function handleTicketButton(interaction) {
  if (interaction.customId === OPEN_BUTTON_ID) return createTicket(interaction);
  if (interaction.customId === CLOSE_BUTTON_ID) return closeTicket(interaction);
}

module.exports = {
  handleTicketButton,
  buildTicketPanel,
  OPEN_BUTTON_ID,
  CLOSE_BUTTON_ID,
};
