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
const https = require('https');

// ==========================================
// 1. SERVIDOR HTTP PARA O RENDER
// ==========================================
http.createServer((req, res) => {
  res.write("Bot Venix Online 24/7!");
  res.end();
}).listen(process.env.PORT || 3000, () => {
  console.log("🌐 Servidor HTTP ativo para o Render.");
});

// ==========================================
// 2. BANCO DE DADOS LOCAL (JSON)
// ==========================================
const dbFolder = path.join(__dirname, 'database');
const uploadsFolder = path.join(__dirname, 'uploads');

if (!fs.existsSync(dbFolder)) fs.mkdirSync(dbFolder, { recursive: true });
if (!fs.existsSync(uploadsFolder)) fs.mkdirSync(uploadsFolder, { recursive: true });

function getDB(file) {
  const filePath = path.join(dbFolder, `${file}.json`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function saveDB(file, data) {
  const filePath = path.join(dbFolder, `${file}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ==========================================
// 3. EMBEDS PADRONIZADAS
// ==========================================
const moeda = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
const sucesso = (titulo, desc) => new EmbedBuilder().setColor('#57F287').setTitle(`🟢 ${titulo}`).setDescription(desc);
const aviso = (titulo, desc) => new EmbedBuilder().setColor('#FEE75C').setTitle(`🟡 ${titulo}`).setDescription(desc);
const erro = (titulo, desc) => new EmbedBuilder().setColor('#ED4245').setTitle(`🔴 ${titulo}`).setDescription(desc);

// ==========================================
// 4. CLIENTE DISCORD
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
  console.log(`🤖 Bot iniciado como: ${client.user.tag}`);
});

// ==========================================
// 5. COMANDO PREFIXO (.TRANCAR)
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  if (message.content.startsWith('.trancar')) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply({ embeds: [erro('Acesso Negado', 'Você não tem permissão para trancar este canal.')] });
    }

    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_destrancar_canal').setLabel('Destrancar').setStyle(ButtonStyle.Success).setEmoji('🔓')
    );
    return message.channel.send({ 
      embeds: [erro('Canal Trancado', `🔒 Este canal foi trancado por **${message.author.username}**.`)] ,
      components: [row]
    });
  }
});

// ==========================================
// 6. MANIPULAÇÃO DE INTERAÇÕES
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    // ----------------------------------------
    // A. COMANDOS SLASH
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // /produto (Painel de Gerenciamento de Produtos)
      if (commandName === 'produto') {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📦 Gerenciamento de Produtos')
          .setDescription('Configure e gerencie seus produtos utilizando os botões abaixo.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('prod_criar').setLabel('Criar Produto').setStyle(ButtonStyle.Success).setEmoji('➕'),
          new ButtonBuilder().setCustomId('prod_listar').setLabel('Meus Produtos').setStyle(ButtonStyle.Primary).setEmoji('📋')
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // /painel
      if (commandName === 'painel') {
        const produtosDB = getDB('produtos');
        const listaProdutos = Object.keys(produtosDB);

        if (listaProdutos.length === 0) {
          return interaction.reply({
            embeds: [erro('Nenhum Produto Cadastrado', 'Você precisa cadastrar pelo menos **1 produto** usando `/produto` antes de criar um painel!')],
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('⚙️ Configuração do Painel')
          .setDescription(
            '🛍️ **Produtos disponíveis**\n' +
            'Selecione um produto no menu abaixo para comprar.\n\n' +
            `Produtos disponíveis: ${listaProdutos.length}`
          );

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pnl_titulo').setLabel('Título').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('pnl_descricao').setLabel('Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
          new ButtonBuilder().setCustomId('pnl_banner').setLabel('Banner').setStyle(ButtonStyle.Secondary).setEmoji('🖼️')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pnl_canal').setLabel('Canal').setStyle(ButtonStyle.Secondary).setEmoji('📢'),
          new ButtonBuilder().setCustomId('pnl_categoria').setLabel('Categoria').setStyle(ButtonStyle.Secondary).setEmoji('🛒'),
          new ButtonBuilder().setCustomId('pnl_compra').setLabel('Compra').setStyle(ButtonStyle.Secondary).setEmoji('💬')
        );

        const row3 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pnl_cor').setLabel('Cor').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
          new ButtonBuilder().setCustomId('pnl_produtos').setLabel('Produtos').setStyle(ButtonStyle.Secondary).setEmoji('📦'),
          new ButtonBuilder().setCustomId('pnl_publicar').setLabel('Publicar').setStyle(ButtonStyle.Success).setEmoji('✅')
        );

        return interaction.reply({ embeds: [embed], components: [row1, row2, row3], ephemeral: true });
      }

      // /reestock (Painel de Solicitação de Reestoque)
      if (commandName === 'reestock') {
        const config = getDB('reestock_config') || { titulo: 'Painel de Solicitação de Reestoque', desc: 'Configure o painel utilizando os botões abaixo.' };

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`📦 ${config.titulo}`)
          .setDescription(config.desc);

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('reest_embed').setLabel('Personalizar Embed').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('reest_canal_sol').setLabel('Canal de Solicitações').setStyle(ButtonStyle.Primary).setEmoji('📨')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('reest_canal_logs').setLabel('Canal de Logs').setStyle(ButtonStyle.Primary).setEmoji('📜'),
          new ButtonBuilder().setCustomId('reest_enviar').setLabel('Enviar Painel').setStyle(ButtonStyle.Success).setEmoji('📤')
        );

        return interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
      }

      // /ticket
      if (commandName === 'ticket') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('tk_setores').setLabel('Configurar Setores').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
          new ButtonBuilder().setCustomId('tk_embed').setLabel('Personalizar Embed').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
          new ButtonBuilder().setCustomId('tk_enviar').setLabel('Enviar Painel').setStyle(ButtonStyle.Success).setEmoji('📢'),
          new ButtonBuilder().setCustomId('tk_cargos').setLabel('Cargos do Ticket').setStyle(ButtonStyle.Secondary).setEmoji('👥')
        );

        const embed = sucesso('Configuração do Painel de Tickets', '> Configure seu painel utilizando os botões abaixo.');
        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // /perfil
      if (commandName === 'perfil') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('perfil_avatar').setLabel('Alterar Avatar').setStyle(ButtonStyle.Primary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId('perfil_banner').setLabel('Alterar Banner').setStyle(ButtonStyle.Primary).setEmoji('🌄'),
          new ButtonBuilder().setCustomId('perfil_nome').setLabel('Alterar Nome').setStyle(ButtonStyle.Secondary).setEmoji('📛'),
          new ButtonBuilder().setCustomId('perfil_preview').setLabel('Pré-visualizar').setStyle(ButtonStyle.Secondary).setEmoji('👀'),
          new ButtonBuilder().setCustomId('perfil_reset').setLabel('Restaurar Padrão').setStyle(ButtonStyle.Danger).setEmoji('♻️')
        );

        const embed = sucesso('Perfil do Bot', 'Personalize o perfil do bot.')
          .addFields(
            { name: 'Nome atual', value: client.user.username, inline: true },
            { name: 'Avatar', value: client.user.avatar ? 'Configurado ✅' : 'Padrão ❌', inline: true }
          );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // /dashboard
      if (commandName === 'dashboard') {
        const embed = sucesso('Dashboard Geral', 'Estatísticas do Sistema')
          .addFields(
            { name: '🤖 Nome do Bot', value: client.user.tag, inline: true },
            { name: '📡 Ping API', value: `${client.ws.ping}ms`, inline: true },
            { name: '👥 Servidores', value: `${client.guilds.cache.size}`, inline: true }
          );
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      return interaction.reply({ embeds: [sucesso('Comando Executado', `O comando **/${commandName}** está em desenvolvimento.`)], ephemeral: true });
    }

    // ----------------------------------------
    // B. BOTÕES E INTERAÇÕES
    // ----------------------------------------
    if (interaction.isButton()) {
      // Destrancar canal
      if (interaction.customId === 'btn_destrancar_canal') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({ embeds: [erro('Sem Permissão', 'Você não pode destrancar este canal.')], ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });
        return interaction.reply({ embeds: [sucesso('Canal Destrancado', '🔓 O canal foi destrancado com sucesso.')] });
      }

      // /reestock - Personalizar Embed (Abre Modal)
      if (interaction.customId === 'reest_embed') {
        const modal = new ModalBuilder()
          .setCustomId('modal_reest_embed')
          .setTitle('Personalizar Embed de Reestoque');

        const inputTitulo = new TextInputBuilder()
          .setCustomId('reest_titulo')
          .setLabel('Título da Embed')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const inputDesc = new TextInputBuilder()
          .setCustomId('reest_desc')
          .setLabel('Descrição da Embed')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(inputTitulo), new ActionRowBuilder().addComponents(inputDesc));
        return interaction.showModal(modal);
      }

      // /reestock - Canal de Solicitações (Abre Menu de Canais)
      if (interaction.customId === 'reest_canal_sol') {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_reest_solicita')
          .setPlaceholder('Selecione o canal de solicitações...')
          .addOptions([
            { label: 'Este canal atual', value: interaction.channel.id, emoji: '💬' }
          ]);

        // Adiciona alguns canais de texto do servidor se houver
        const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText && c.id !== interaction.channel.id).firsts?.(24) || [];
        for (const ch of channels) {
          selectMenu.addOptions({ label: `#${ch.name}`, value: ch.id, emoji: '📁' });
        }

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({ content: '📨 Selecione abaixo onde as solicitações de reestoque serão enviadas:', components: [row], ephemeral: true });
      }

      // /reestock - Canal de Logs (Abre Menu de Canais)
      if (interaction.customId === 'reest_canal_logs') {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_reest_logs')
          .setPlaceholder('Selecione o canal de logs...')
          .addOptions([
            { label: 'Este canal atual', value: interaction.channel.id, emoji: '💬' }
          ]);

        const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText && c.id !== interaction.channel.id).firsts?.(24) || [];
        for (const ch of channels) {
          selectMenu.addOptions({ label: `#${ch.name}`, value: ch.id, emoji: '📜' });
        }

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({ content: '📜 Selecione abaixo onde os logs de reestoque serão enviados:', components: [row], ephemeral: true });
      }

      // /reestock - Enviar Painel
      if (interaction.customId === 'reest_enviar') {
        const config = getDB('reestock_config') || { titulo: 'Painel de Solicitação de Reestoque', desc: 'Configure o painel utilizando os botões abaixo.' };
        const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`📦 ${config.titulo}`).setDescription(config.desc);
        
        await interaction.channel.send({ embeds: [embed] });
        return interaction.reply({ embeds: [sucesso('Painel Enviado', '📤 O painel de reestoque foi publicado neste canal com sucesso!')], ephemeral: true });
      }
    }

    // ----------------------------------------
    // C. SELECT MENUS
    // ----------------------------------------
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_reest_solicita') {
        const channelId = interaction.values[0];
        let config = getDB('reestock_config');
        config.canalSol = channelId;
        saveDB('reestock_config', config);
        return interaction.update({ content: `🟢 Canal de solicitações definido para <#${channelId}> com sucesso!`, components: [] });
      }

      if (interaction.customId === 'select_reest_logs') {
        const channelId = interaction.values[0];
        let config = getDB('reestock_config');
        config.canalLogs = channelId;
        saveDB('reestock_config', config);
        return interaction.update({ content: `🟢 Canal de logs definido para <#${channelId}> com sucesso!`, components: [] });
      }
    }

    // ----------------------------------------
    // D. MODALS
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_reest_embed') {
        const titulo = interaction.fields.getTextInputValue('reest_titulo');
        const desc = interaction.fields.getTextInputValue('reest_desc');

        saveDB('reestock_config', { titulo, desc, canalSol: null, canalLogs: null });

        return interaction.reply({ embeds: [sucesso('Embed Atualizada', '📝 O título e a descrição do painel de reestoque foram salvos com sucesso!')], ephemeral: true });
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
// 7. REGISTRO DOS COMANDOS
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('produto').setDescription('Gerencia a criação e edição de produtos'),
  new SlashCommandBuilder().setName('painel').setDescription('Cria o painel de vendas'),
  new SlashCommandBuilder().setName('ticket').setDescription('Cria e gerencia o sistema de tickets'),
  new SlashCommandBuilder().setName('reestock').setDescription('Painel de solicitação de reestoque'),
  new SlashCommandBuilder().setName('perfil').setDescription('Personaliza o perfil do bot'),
  new SlashCommandBuilder().setName('config').setDescription('Configurações gerais do sistema'),
  new SlashCommandBuilder().setName('cupom').setDescription('Gerencia cupons de desconto'),
  new SlashCommandBuilder().setName('conectar').setDescription('Conecta o bot a uma call de voz'),
  new SlashCommandBuilder().setName('dashboard').setDescription('Exibe métricas do bot'),
  new SlashCommandBuilder().setName('vendas').setDescription('Dashboard financeiro e de vendas')
].map(c => c.toJSON());

client.login(process.env.TOKEN).then(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log('🔄 Registrando comandos Slash...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Comandos Slash registrados com sucesso!');
  } catch (e) {
    console.error('Erro ao registrar comandos:', e);
  }
});
