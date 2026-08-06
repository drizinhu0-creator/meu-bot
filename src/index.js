const { 
  Client, GatewayIntentBits, Partials, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, 
  UserSelectMenuBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, 
  ChannelType, PermissionFlagsBits, EmbedBuilder, REST, Routes, SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==========================================
// 1. SERVIDOR HTTP PARA O RENDER (MANTÉM 24/7)
// ==========================================
http.createServer((req, res) => {
  res.write("Bot Online 24/7!");
  res.end();
}).listen(process.env.PORT || 3000, () => {
  console.log("🌐 Servidor HTTP ativo para o Render.");
});

// ==========================================
// 2. BANCO DE DADOS LOCAL (JSON)
// ==========================================
const reestockConfig = {};     // Configurações de canais por servidor
const blacklistUsers = new Set(); // Usuários bloqueados de enviar solicitações
const userCooldowns = new Map();  // Cooldown de usuários (userId -> timestamp)
let reestockCooldownMinutos = 5;  // Cooldown padrão em minutos

// ==========================================
// 3. EMBEDS PADRONIZADAS
// ==========================================
const sucesso = (titulo, desc) => new EmbedBuilder().setColor('#57F287').setTitle(`🟢 ${titulo}`).setDescription(desc);
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
  console.log(`🤖 Bot conectado como: ${client.user.tag}`);
});

// ==========================================
// 5. MANIPULAÇÃO DE INTERAÇÕES
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    const guildId = interaction.guildId;
    if (!reestockConfig[guildId]) {
      reestockConfig[guildId] = { canalSolicitacao: null, canalLog: null };
    }
    const config = reestockConfig[guildId];

    // ----------------------------------------
    // COMANDOS SLASH
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'produto') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📦 Gerenciamento de Produtos')
            .setDescription('Configure as propriedades do seu produto utilizando os botões abaixo.');

          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_emoji').setLabel('Emoji').setStyle(ButtonStyle.Secondary).setEmoji('😃'),
            new ButtonBuilder().setCustomId('prod_nome').setLabel('Nome').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
            new ButtonBuilder().setCustomId('prod_desc').setLabel('Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
            new ButtonBuilder().setCustomId('prod_preco').setLabel('Preço').setStyle(ButtonStyle.Secondary).setEmoji('💰')
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_estoque').setLabel('Estoque').setStyle(ButtonStyle.Secondary).setEmoji('📦'),
            new ButtonBuilder().setCustomId('prod_categoria').setLabel('Categoria').setStyle(ButtonStyle.Secondary).setEmoji('📁'),
            new ButtonBuilder().setCustomId('prod_entrega').setLabel('Entrega').setStyle(ButtonStyle.Secondary).setEmoji('🚚'),
            new ButtonBuilder().setCustomId('prod_imagem').setLabel('Imagem').setStyle(ButtonStyle.Secondary).setEmoji('🖼️')
          );

          const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_salvar').setLabel('Salvar Produto').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId('prod_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('❌')
          );

          return interaction.reply({ embeds: [embed], components: [row1, row2, row3], ephemeral: true });
        }
      }

      if (commandName === 'painel') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🛒 Loja Oficial')
            .setDescription('Escolha um dos nossos produtos para sua compra.');

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('comprar_produto').setLabel('Comprar Agora').setStyle(ButtonStyle.Success).setEmoji('🛒')
          );

          return interaction.reply({ embeds: [embed], components: [row] });
        }
      }

      if (commandName === 'ticket') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🎫 Atendimento Exclusivo')
            .setDescription('Para iniciar seu atendimento, selecione o tipo de suporte desejado abaixo.');

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_ticket_setor')
            .setPlaceholder('Selecione o tipo de atendimento')
            .addOptions([
              { label: 'Suporte Geral', value: 'suporte', emoji: '💬' },
              { label: 'Financeiro / Compras', value: 'financeiro', emoji: '💰' }
            ]);

          const row = new ActionRowBuilder().addComponents(selectMenu);
          return interaction.reply({ embeds: [embed], components: [row] });
        }
      }

      if (commandName === 'reestock') {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('⚙️ Configuração do Sistema de Reestoque')
          .setDescription('Configure os canais e envie o painel público de solicitação:\n\n' +
                          `📌 **Canal de Solicitações (Staff aprovar):** ${config.canalSolicitacao ? `<#${config.canalSolicitacao}>` : '`Não definido`'}\n` +
                          `🔔 **Canal de Logs (Reestock público):** ${config.canalLog ? `<#${config.canalLog}>` : '`Não definido`'}\n` +
                          `⏳ **Cooldown Atual:** \`${reestockCooldownMinutos} minutos\``);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_canal_solicitacao').setLabel('Canal Solicitações').setStyle(ButtonStyle.Primary).setEmoji('📌'),
          new ButtonBuilder().setCustomId('config_canal_log').setLabel('Canal Logs Reestock').setStyle(ButtonStyle.Primary).setEmoji('🔔'),
          new ButtonBuilder().setCustomId('config_enviar_painel').setLabel('Enviar Painel Público').setStyle(ButtonStyle.Success).setEmoji('🚀')
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      if (commandName === 'dashboard') {
        return interaction.reply({ embeds: [sucesso('Dashboard', `Status: Online\nLatência: ${client.ws.ping}ms`)], ephemeral: true });
      }
      if (commandName === 'cupom') {
        return interaction.reply({ embeds: [sucesso('Cupons', 'Gerenciamento ativo.')], ephemeral: true });
      }
      if (commandName === 'conectar') {
        if (!interaction.member.voice.channel) return interaction.reply({ embeds: [erro('Erro', 'Entre em um canal de voz!')], ephemeral: true });
        return interaction.reply({ embeds: [sucesso('Conectado', 'Voz vinculada.')], ephemeral: true });
      }
    }

    // ----------------------------------------
    // BOTÕES E INTERAÇÕES
    // ----------------------------------------
    if (interaction.isButton()) {
      if (interaction.customId === 'config_canal_solicitacao') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('select_canal_solicitacao')
            .setPlaceholder('Selecione o canal onde a staff aprova')
            .addChannelTypes(ChannelType.GuildText)
        );
        return interaction.reply({ content: 'Selecione o canal de **Solicitações**:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'config_canal_log') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('select_canal_log')
            .setPlaceholder('Selecione o canal de logs de reestock')
            .addChannelTypes(ChannelType.GuildText)
        );
        return interaction.reply({ content: 'Selecione o canal de **Logs/Reestock**:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'config_enviar_painel') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('select_canal_painel_publico')
            .setPlaceholder('Selecione onde enviar o painel')
            .addChannelTypes(ChannelType.GuildText)
        );
        return interaction.reply({ content: 'Selecione abaixo em qual canal deseja **publicar o painel**:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'btn_abrir_modal_reestock') {
        if (blacklistUsers.has(interaction.user.id)) {
          return interaction.reply({ embeds: [erro('Bloqueado', 'Você está proibido de enviar novas solicitações de reestoque.')], ephemeral: true });
        }

        const agora = Date.now();
        const ultimoEnvio = userCooldowns.get(interaction.user.id) || 0;
        const tempoMs = reestockCooldownMinutos * 60 * 1000;

        if (agora - ultimoEnvio < tempoMs) {
          const minutosRestantes = Math.ceil((tempoMs - (agora - ultimoEnvio)) / (60 * 1000));
          return interaction.reply({ embeds: [erro('Aguarde', `Você deve aguardar **${minutosRestantes} minuto(s)** para enviar uma nova solicitação.`)], ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId('modal_enviar_reestock')
          .setTitle('Solicitar Produto para Estoque');

        const nomeProd = new TextInputBuilder()
          .setCustomId('reest_nome')
          .setLabel('Nome do Produto')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const qtdProd = new TextInputBuilder()
          .setCustomId('reest_qtd')
          .setLabel('Quantidade Solicitada (Ex: 10x)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nomeProd), new ActionRowBuilder().addComponents(qtdProd));
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith('aprovar_reest_')) {
        if (!config.canalLog) {
          return interaction.reply({ embeds: [erro('Erro', 'O canal de logs/reestock não foi configurado!')], ephemeral: true });
        }

        const logChannel = interaction.guild.channels.cache.get(config.canalLog);
        if (!logChannel) {
          return interaction.reply({ embeds: [erro('Erro', 'Canal de logs não encontrado.')], ephemeral: true });
        }

        const originalEmbed = interaction.message.embeds[0];
        const fields = originalEmbed.fields;
        const nomeProduto = fields.find(f => f.name.includes('Produto'))?.value || 'Produto';
        const qtdSolicitada = fields.find(f => f.name.includes('Quantidade'))?.value || '10x';

        const reestockEmbed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`REESTOCK! O produto ${nomeProduto} acabou de receber novos itens!`)
          .addFields(
            { name: '📌 Campo:', value: nomeProduto, inline: false },
            { name: '📦 Adicionados:', value: qtdSolicitada, inline: false },
            { name: '✅ Estoque total:', value: qtdSolicitada, inline: false },
            { name: '⏰ Data:', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
          );

        const rowCompra = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('comprar_produto').setLabel('Comprar Agora').setStyle(ButtonStyle.Success).setEmoji('🛒')
        );

        await logChannel.send({ embeds: [reestockEmbed], components: [rowCompra] });

        const aprovadoEmbed = new EmbedBuilder(originalEmbed.data)
          .setColor('#57F287')
          .setTitle('✅ Solicitação Aprovada e Postada!')
          .addFields({ name: '👤 Aprovado por', value: `${interaction.user}` });

        await interaction.message.edit({ embeds: [aprovadoEmbed], components: [] });
        return interaction.reply({ content: `Solicitação aprovada e enviada para o canal ${logChannel}!`, ephemeral: true });
      }

      if (interaction.customId.startsWith('recusar_reest_')) {
        const originalEmbed = interaction.message.embeds[0];

        const recusadoEmbed = new EmbedBuilder(originalEmbed.data)
          .setColor('#ED4245')
          .setTitle('❌ Solicitação Recusada')
          .addFields({ name: '👤 Recusado por', value: `${interaction.user}` });

        await interaction.message.edit({ embeds: [recusadoEmbed], components: [] });
        return interaction.reply({ content: `Solicitação recusada com sucesso.`, ephemeral: true });
      }

      // Botão ⚙️ de Configurações
      if (interaction.customId.startsWith('config_reest_')) {
        const rowConfig = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('menu_add_blacklist').setLabel('Adicionar à Blacklist').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
          new ButtonBuilder().setCustomId('menu_remove_blacklist').setLabel('Remover da Blacklist').setStyle(ButtonStyle.Secondary).setEmoji('✅'),
          new ButtonBuilder().setCustomId('set_cooldown_modal').setLabel('Definir Cooldown').setStyle(ButtonStyle.Primary).setEmoji('⏳')
        );

        return interaction.reply({ content: `⚙️ **Painel de Configuração da Blacklist e Cooldown**\nEscolha uma das opções abaixo:`, components: [rowConfig], ephemeral: true });
      }

      // Abre barra/menu para escolher membro para adicionar à Blacklist
      if (interaction.customId === 'menu_add_blacklist') {
        const userSelect = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId('select_add_blacklist')
            .setPlaceholder('Selecione o membro para bloquear')
        );
        return interaction.update({ content: 'Selecione abaixo o membro que deseja **adicionar à blacklist**:', components: [userSelect] });
      }

      // Abre barra/menu para escolher membro para remover da Blacklist
      if (interaction.customId === 'menu_remove_blacklist') {
        if (blacklistUsers.size === 0) {
          return interaction.update({ content: '⚠️ Não há nenhum membro na blacklist atualmente.', components: [] });
        }

        const options = [];
        for (const userId of blacklistUsers) {
          const member = await interaction.guild.members.fetch(userId).catch(() => null);
          const name = member ? member.user.tag : userId;
          options.push({ label: name.substring(0, 100), value: userId });
        }

        const selectMenu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('select_remove_blacklist')
            .setPlaceholder('Selecione o membro para desbloquear')
            .addOptions(options)
        );

        return interaction.update({ content: 'Selecione abaixo o membro que deseja **remover da blacklist**:', components: [selectMenu] });
      }

      if (interaction.customId === 'set_cooldown_modal') {
        const modal = new ModalBuilder()
          .setCustomId('modal_salvar_cooldown')
          .setTitle('Configurar Cooldown');

        const inputTempo = new TextInputBuilder()
          .setCustomId('tempo_minutos')
          .setLabel('Tempo em minutos')
          .setPlaceholder('Ex: 10')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(inputTempo));
        return interaction.showModal(modal);
      }
    }

    // ----------------------------------------
    // SELECT MENUS (CANAIS E USUÁRIOS)
    // ----------------------------------------
    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === 'select_canal_solicitacao') {
        config.canalSolicitacao = interaction.values[0];
        return interaction.update({ content: `✅ Canal de solicitações definido para <#${config.canalSolicitacao}>!`, components: [] });
      }
      if (interaction.customId === 'select_canal_log') {
        config.canalLog = interaction.values[0];
        return interaction.update({ content: `✅ Canal de logs de reestock definido para <#${config.canalLog}>!`, components: [] });
      }
      if (interaction.customId === 'select_canal_painel_publico') {
        const canalId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(canalId);

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📦 Solicitar Produtos para Estoque')
          .setDescription('Clique no botão abaixo para enviar sua solicitação de reestoque para a equipe.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('btn_abrir_modal_reestock').setLabel('Solicitar Produto').setStyle(ButtonStyle.Primary).setEmoji('🛒')
        );

        await channel.send({ embeds: [embed], components: [row] });
        return interaction.update({ content: `🚀 Painel público publicado com sucesso no canal ${channel}!`, components: [] });
      }
    }

    // Menu de seleção de usuário (User Select Menu para adicionar à Blacklist)
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'select_add_blacklist') {
        const userId = interaction.values[0];
        blacklistUsers.add(userId);
        return interaction.update({ content: `🚫 O usuário <@${userId}> foi adicionado com sucesso à **blacklist**!`, components: [] });
      }
    }

    // Menu de seleção de string (Para remover da Blacklist)
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_remove_blacklist') {
        const userId = interaction.values[0];
        blacklistUsers.delete(userId);
        return interaction.update({ content: `✅ O usuário <@${userId}> foi removido da **blacklist** com sucesso!`, components: [] });
      }
    }

    // ----------------------------------------
    // MODALS
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_enviar_reestock') {
        const nome = interaction.fields.getTextInputValue('reest_nome');
        const qtd = interaction.fields.getTextInputValue('reest_qtd');

        if (!config.canalSolicitacao) {
          return interaction.reply({ embeds: [erro('Erro', 'O canal de solicitações da staff não foi configurado pelo comando /reestock.')], ephemeral: true });
        }

        const solicitacaoChannel = interaction.guild.channels.cache.get(config.canalSolicitacao);
        if (!solicitacaoChannel) {
          return interaction.reply({ embeds: [erro('Erro', 'Canal de solicitações não encontrado.')], ephemeral: true });
        }

        userCooldowns.set(interaction.user.id, Date.now());

        const staffEmbed = new EmbedBuilder()
          .setColor('#FEE75C')
          .setTitle('📦 Nova Solicitação de Reestoque Pendente')
          .addFields(
            { name: '👤 Solicitante', value: `${interaction.user} (${interaction.user.tag})`, inline: false },
            { name: '📦 Nome do Produto', value: nome, inline: false },
            { name: '📊 Quantidade Solicitada', value: qtd, inline: false }
          )
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`aprovar_reest_${interaction.user.id}`).setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(`recusar_reest_${interaction.user.id}`).setLabel('Recusar').setStyle(ButtonStyle.Danger).setEmoji('❌'),
          new ButtonBuilder().setCustomId(`config_reest_${interaction.user.id}`).setStyle(ButtonStyle.Secondary).setEmoji('⚙️')
        );

        await solicitacaoChannel.send({ embeds: [staffEmbed], components: [row] });
        return interaction.reply({ embeds: [sucesso('Solicitação Enviada', `Sua solicitação de **${nome}** foi enviada para a staff analisar!`)], ephemeral: true });
      }

      if (interaction.customId === 'modal_salvar_cooldown') {
        const tempoInput = parseInt(interaction.fields.getTextInputValue('tempo_minutos'));
        if (isNaN(tempoInput) || tempoInput < 0) {
          return interaction.reply({ embeds: [erro('Erro', 'Digite um número válido de minutos.')], ephemeral: true });
        }

        reestockCooldownMinutos = tempoInput;
        return interaction.reply({ embeds: [sucesso('Cooldown Atualizado', `O tempo de espera entre solicitações foi alterado para **${reestockCooldownMinutos} minutos**!`)], ephemeral: true });
      }
    }

  } catch (err) {
    console.error('Erro na interação:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [erro('Erro', 'Ocorreu um erro ao processar esta ação.')], ephemeral: true }).catch(() => {});
    }
  }
});

// ==========================================
// 6. REGISTRO AUTOMÁTICO DE COMANDOS SLASH
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('produto')
    .setDescription('Gerenciamento de produtos')
    .addSubcommand(sub => sub.setName('criar').setDescription('Abre o painel de criação de produtos')),
  
  new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Sistema de painel de vendas')
    .addSubcommand(sub => sub.setName('criar').setDescription('Cria o painel de compras no canal')),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Sistema de atendimento')
    .addSubcommand(sub => sub.setName('criar').setDescription('Cria o painel de tickets')),

  new SlashCommandBuilder().setName('reestock').setDescription('Configura o sistema de reestoque'),
  new SlashCommandBuilder().setName('dashboard').setDescription('Métricas do bot'),
  new SlashCommandBuilder().setName('cupom').setDescription('Gerencia cupons de desconto'),
  new SlashCommandBuilder().setName('conectar').setDescription('Conecta o bot a um canal de voz')
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
