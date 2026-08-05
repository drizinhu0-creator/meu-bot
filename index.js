const { 
  Client, GatewayIntentBits, Partials, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, 
  ModalBuilder, TextInputBuilder, TextInputStyle, 
  ChannelType, PermissionFlagsBits, AttachmentBuilder,
  EmbedBuilder, REST, Routes, SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==========================================
// SERVIDOR HTTP FAKE PARA O RENDER
// ==========================================
http.createServer((req, res) => {
  res.write("Bot online!");
  res.end();
}).listen(process.env.PORT || 3000, () => {
  console.log("🌐 Servidor HTTP ativo para o Render.");
});

// ==========================================
// BANCO DE DADOS LOCAL (JSON)
// ==========================================
const dbPath = path.join(__dirname, 'database');
if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath, { recursive: true });

function getDB(file) {
  const filePath = path.join(dbPath, `${file}.json`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function saveDB(file, data) {
  const filePath = path.join(dbPath, `${file}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ==========================================
// FORMATADORES E EMBEDS
// ==========================================
const moeda = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
const sucesso = (titulo, desc) => new EmbedBuilder().setColor('#00FF00').setTitle(`🟢 ${titulo}`).setDescription(desc);
const aviso = (titulo, desc) => new EmbedBuilder().setColor('#FFFF00').setTitle(`🟡 ${titulo}`).setDescription(desc);
const erro = (titulo, desc) => new EmbedBuilder().setColor('#FF0000').setTitle(`🔴 ${titulo}`).setDescription(desc);

// ==========================================
// CLIENTE DO BOT
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once('ready', () => {
  console.log(`🤖 Bot online como: ${client.user.tag}`);
});

// ==========================================
// ANTI-PALAVRA / ANTI-LINK E .TRANCAR
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // COMANDO .TRANCAR
  if (message.content.startsWith('.trancar')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return;
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_destrancar_canal').setLabel('Destrancar').setStyle(ButtonStyle.Success).setEmoji('🔓')
    );
    return message.reply({ embeds: [erro('Canal Trancado', '🔒 Canal trancado para mensagens de @everyone.')], components: [row] });
  }

  // ANTI-PALAVRAS E ANTI-LINK
  const configPalavras = getDB('palavras');
  if (configPalavras.palavras && configPalavras.palavras.length > 0) {
    const contemPalavra = configPalavras.palavras.some(p => message.content.toLowerCase().includes(p.toLowerCase()));
    const regexLink = /(https?:\/\/[^\s]+)|(discord\.gg\/[^\s]+)|(discord\.com\/invite\/[^\s]+)|(www\.[^\s]+)/gi;
    const contemLink = configPalavras.antiLink && regexLink.test(message.content);

    if ((contemPalavra || contemLink) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.delete().catch(() => {});
      const punicao = configPalavras.punicao || 'Aviso';
      
      if (punicao === 'Timeout') await message.member.timeout(10 * 60 * 1000, 'Filtro Anti-Palavra/Link').catch(() => {});
      if (punicao === 'Expulsar') await message.member.kick('Filtro Anti-Palavra/Link').catch(() => {});
      if (punicao === 'Banir') await message.member.ban({ reason: 'Filtro Anti-Palavra/Link' }).catch(() => {});

      return message.channel.send({ 
        embeds: [aviso('Mensagem Removida', `${message.author}, sua mensagem violou as regras. Punição: **${punicao}**.`)]
      }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000));
    }
  }
});

// ==========================================
// INTERAÇÕES
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    // 1. COMANDOS SLASH
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'painel') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('painel_tipo_botoes').setLabel('Botões').setStyle(ButtonStyle.Primary).setEmoji('🔘'),
          new ButtonBuilder().setCustomId('painel_tipo_menu').setLabel('Menu de Seleção').setStyle(ButtonStyle.Secondary).setEmoji('📋')
        );
        return interaction.reply({ embeds: [sucesso('Criar Painel', '> Escolha como deseja que os produtos sejam exibidos no painel.')], components: [row], ephemeral: true });
      }

      if (commandName === 'ticket') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tk_setores').setLabel('Configurar Setores').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
          new ButtonBuilder().setCustomId('tk_embed').setLabel('Personalizar Embed').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
          new ButtonBuilder().setCustomId('tk_cargos').setLabel('Cargos do Ticket').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
          new ButtonBuilder().setCustomId('tk_enviar').setLabel('Enviar Painel').setStyle(ButtonStyle.Success).setEmoji('📤')
        );
        return interaction.reply({ embeds: [sucesso('Configuração do Painel de Tickets', '> Configure o painel utilizando os botões abaixo.')], components: [row], ephemeral: true });
      }

      if (commandName === 'reestock') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('reest_embed').setLabel('Personalizar Embed').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('reest_canal_sol').setLabel('Canal de Solicitações').setStyle(ButtonStyle.Primary).setEmoji('📨'),
          new ButtonBuilder().setCustomId('reest_canal_logs').setLabel('Canal de Logs').setStyle(ButtonStyle.Primary).setEmoji('📜'),
          new ButtonBuilder().setCustomId('reest_enviar').setLabel('Enviar Painel').setStyle(ButtonStyle.Success).setEmoji('📤')
        );
        return interaction.reply({ embeds: [sucesso('Painel de Solicitação de Reestoque', '> Configure o painel utilizando os botões abaixo.')], components: [row], ephemeral: true });
      }

      if (commandName === 'vendas') {
        const vendasDB = getDB('vendas');
        const totalVendas = vendasDB.totalVendas || 0;
        const arrecadado = vendasDB.arrecadado || 0;

        const embed = sucesso('Dashboard de Vendas', 'Estatísticas do Servidor')
          .addFields(
            { name: '🛒 Total de Vendas', value: `${totalVendas}`, inline: true },
            { name: '💰 Arrecadado', value: moeda(arrecadado), inline: true },
            { name: '📈 Ticket Médio', value: moeda(totalVendas ? arrecadado / totalVendas : 0), inline: true }
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('vendas_atualizar').setLabel('Atualizar').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
          new ButtonBuilder().setCustomId('vendas_exportar').setLabel('Exportar').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
          new ButtonBuilder().setCustomId('vendas_reset').setLabel('Resetar Estatísticas').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
        );
        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      if (commandName === 'config') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cfg_pix').setLabel('PIX').setStyle(ButtonStyle.Secondary).setEmoji('💳'),
          new ButtonBuilder().setCustomId('cfg_loja').setLabel('Loja').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('cfg_tickets').setLabel('Tickets').setStyle(ButtonStyle.Secondary).setEmoji('🎫'),
          new ButtonBuilder().setCustomId('cfg_reestoque').setLabel('Reestoque').setStyle(ButtonStyle.Secondary).setEmoji('📦'),
          new ButtonBuilder().setCustomId('cfg_vendas').setLabel('Vendas').setStyle(ButtonStyle.Secondary).setEmoji('📊')
        );
        return interaction.reply({ embeds: [sucesso('Configurações do Bot', '> Selecione abaixo o que deseja configurar.')], components: [row], ephemeral: true });
      }
    }

    // 2. BOTÕES
    if (interaction.isButton()) {
      if (interaction.customId === 'btn_destrancar_canal') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) return;
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });
        return interaction.reply({ embeds: [sucesso('Canal Destrancado', '🟢 O canal foi destrancado.')] });
      }

      if (interaction.customId === 'tk_fechar') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false });
        await interaction.channel.setName(`🔒・fechado-${interaction.user.username}`);
        return interaction.reply({ embeds: [aviso('Ticket Fechado', '🔒 O ticket foi fechado.')] });
      }

      if (interaction.customId === 'tk_reabrir') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true });
        await interaction.channel.setName(`🎫・${interaction.user.username}`);
        return interaction.reply({ embeds: [sucesso('Ticket Reaberto', '🟢 Permissões restauradas.')] });
      }

      if (interaction.customId === 'tk_excluir') {
        await interaction.reply({ embeds: [erro('Excluir Ticket', '🗑️ Este ticket será excluído em 5 segundos.')] });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      }
    }

  } catch (err) {
    console.error('Erro na interação:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [erro('Erro Interno', 'Ocorreu um erro ao processar esta ação.')], ephemeral: true }).catch(() => {});
    }
  }
});

// ==========================================
// REGISTRO DE COMANDOS E LOGIN
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('painel').setDescription('Cria o painel de vendas'),
  new SlashCommandBuilder().setName('ticket').setDescription('Cria o painel de tickets'),
  new SlashCommandBuilder().setName('reestock').setDescription('Cria o painel de solicitação de reestoque'),
  new SlashCommandBuilder().setName('vendas').setDescription('Exibe o dashboard de vendas'),
  new SlashCommandBuilder().setName('config').setDescription('Painel geral de configurações'),
  new SlashCommandBuilder().setName('perfil').setDescription('Configura o perfil do bot'),
  new SlashCommandBuilder().setName('dashboard').setDescription('Exibe métricas do sistema'),
  new SlashCommandBuilder().setName('palavras').setDescription('Gerencia palavras proibidas')
].map(c => c.toJSON());

client.login(process.env.TOKEN).then(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log('🔄 Registrando comandos Slash...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Comandos Slash registrados!');
  } catch (e) {
    console.error('Erro nos comandos:', e);
  }
});
