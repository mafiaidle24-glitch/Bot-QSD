const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  OverwriteType,
} = require('discord.js');

const CATEGORY_NAME = '🎫 Tickets';
const OPEN_BUTTON_ID = 'ticket:open';
const CLOSE_BUTTON_ID = 'ticket:close';

async function ensureCategory(guild) {
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
  );

  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
      ],
    });
  }
  return category;
}

async function createTicket(interaction) {
  const { guild, member, user } = interaction;

  // Verifica se a pessoa já tem um ticket aberto
  const existing = guild.channels.cache.find(
    (c) =>
      c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}` ||
      c.topic === `ticket-${user.id}`
  );

  if (existing) {
    return interaction.reply({
      content: `Você já tem um ticket aberto: ${existing}`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const category = await ensureCategory(guild);

  const channel = await guild.channels.create({
    name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `ticket-${user.id}`,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
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
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
  });

  // Adiciona permissão pra cargos de staff (quem tem "Gerenciar Mensagens")
  // Você pode melhorar depois colocando cargos específicos
  const staffRoles = guild.roles.cache.filter((r) =>
    r.permissions.has(PermissionFlagsBits.ManageMessages) && !r.managed
  );

  for (const role of staffRoles.values()) {
    await channel.permissionOverwrites.edit(role.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }).catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Ticket Aberto')
    .setDescription(
      `Olá ${user},\n\nExplique o motivo do seu contato.\nA staff vai te responder em breve.\n\nPara fechar o ticket, clique no botão abaixo.`
    )
    .setFooter({ text: `Ticket de ${user.tag}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_BUTTON_ID)
      .setLabel('Fechar Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );

  await channel.send({
    content: `${user}`,
    embeds: [embed],
    components: [row],
  });

  await interaction.editReply({
    content: `Seu ticket foi criado: ${channel}`,
  });
}

async function closeTicket(interaction) {
  const channel = interaction.channel;

  if (!channel.topic?.startsWith('ticket-')) {
    return interaction.reply({
      content: 'Este comando só pode ser usado dentro de um ticket.',
      ephemeral: true,
    });
  }

  await interaction.reply({
    content: '🔒 Fechando o ticket em 5 segundos...',
  });

  setTimeout(async () => {
    try {
      await channel.delete('Ticket fechado');
    } catch (e) {
      console.error('[tickets] erro ao fechar:', e.message);
    }
  }, 5000);
}

function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Central de Atendimento')
    .setDescription(
      'Precisa de ajuda?\nClique no botão abaixo para abrir um **ticket** privado com a staff.'
    )
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
  if (interaction.customId === OPEN_BUTTON_ID) {
    return createTicket(interaction);
  }
  if (interaction.customId === CLOSE_BUTTON_ID) {
    return closeTicket(interaction);
  }
}

module.exports = {
  handleTicketButton,
  buildTicketPanel,
  OPEN_BUTTON_ID,
  CLOSE_BUTTON_ID,
};
