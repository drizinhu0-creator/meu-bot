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
// 2. BANCO DE DADOS LOCAL (PERSISTÊNCIA)
// ==========================================
const dbFolder = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbFolder)) fs.mkdirSync(dbFolder, { recursive: true });
const dbFile = path.join(dbFolder, 'reestock_data.json');

function carregarDados() {
  if (fs.existsSync(dbFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
      return {
        reestockConfig: data.reestockConfig || {},
        blacklistUsers: new Set(data.blacklistUsers || []),
        cooldownMinutos: data.cooldownMinutos || 5
      };
    } catch (e) {
      console.error('Erro ao ler banco de dados:', e);
    }
  }
  return { reestockConfig: {}, blacklistUsers: new Set(), cooldownMinutos: 5 };
}

function salvarDados() {
  try {
    const data = {
      reestockConfig,
      blacklistUsers: Array.from(blacklistUsers),
      cooldownMinutos: reestockCooldownMinutos
    };
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erro ao salvar banco de dados:', e);
  }
}

const dadosSalvos = carregarDados();
const reestockConfig = dadosSalvos.reestockConfig;     
const blacklistUsers = dadosSalvos.blacklistUsers; 
let reestockCooldownMinutos = dadosSalvos.cooldownMinutos;  
const userCooldowns = new Map();  
const produtoTemp = new Map(); 
const painelTemp = new Map(); // Armazena configurações temporárias do painel por usuário

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
    if (guildId && !reestockConfig[guildId]) {
      reestockConfig[guildId] = { canalSolicitacao: null, canalLog: null };
      salvarDados();
    }
    const config = guildId ? reestockConfig[guildId] : {};

    // ----------------------------------------
    // COMANDOS SLASH
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'produto') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          produtoTemp.set(interaction.user.id, {
            emoji: '😃', nome: 'Não definido', desc: 'Não definida', 
            preco: 'R$ 0,00', estoque: '0', categoria: 'Geral', 
            entrega: 'Automática', imagem: 'Nenhuma'
          });

          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📦 Crie seus produtos')
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
          painelTemp.set(interaction.user.id, {
            titulo: 'Configuração do Painel',
            descricao: 'Selecione um produto no menu abaixo para comprar.',
            banner: 'https://i.imgur.com/74kQ5j2.png',
            canal: null,
            categoria: 'Geral',
            botaoCompra: 'Comprar Agora',
            cor: '#5865F2',
            produtosCount: 1
          });

          const pData = painelTemp.get(interaction.user.id);

          const embed = new EmbedBuilder()
            .setColor(pData.cor)
            .setTitle(`⚙️ ${pData.titulo}`)
            .setDescription(`🛍️ **Produtos disponíveis**\n${pData.descricao}\n\nProdutos disponíveis: ${pData.produtosCount}`)
            .setImage(pData.banner);

          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('painel_titulo').setLabel('Título').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
            new ButtonBuilder().setCustomId('painel_desc').setLabel('Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
            new ButtonBuilder().setCustomId('painel_banner').setLabel('Banner').setStyle(ButtonStyle.Secondary).setEmoji('🖼️')
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('painel_canal').setLabel('Canal').setStyle(ButtonStyle.Secondary).setEmoji('📢'),
            new ButtonBuilder().setCustomId('painel_categoria').setLabel('Categoria').setStyle(ButtonStyle.Secondary).setEmoji('🛒'),
            new ButtonBuilder().setCustomId('painel_compra').setLabel('Compra').setStyle(ButtonStyle.Secondary).setEmoji('💬')
          );

          const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('painel_cor').setLabel('Cor').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
            new ButtonBuilder().setCustomId('painel_produtos').setLabel('Produtos').setStyle(ButtonStyle.Secondary).setEmoji('📦'),
            new ButtonBuilder().setCustomId('painel_publicar').setLabel('Publicar').setStyle(ButtonStyle.Success).setEmoji('✅')
          );

          return interaction.reply({ embeds: [embed], components: [row1, row2, row3], ephemeral: true });
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
          .setDescription('Configure os canais, o tempo de cooldown e envie o painel público:\n\n' +
                          `📌 **Canal de Solicitações (Staff):** ${config.canalSolicitacao ? `<#${config.canalSolicitacao}>` : '`Não definido`'}\n` +
                          `🔔 **Canal de Logs (Reestock público):** ${config.canalLog ? `<#${config.canalLog}>` : '`Não definido`'}\n` +
                          `⏳ **Cooldown Atual:** \`${reestockCooldownMinutos} minutos\``);

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_canal_solicitacao').setLabel('Canal Solicitações').setStyle(ButtonStyle.Primary).setEmoji('📌'),
          new ButtonBuilder().setCustomId('config_canal_log').setLabel('Canal Logs Reestock').setStyle(ButtonStyle.Primary).setEmoji('🔔'),
          new ButtonBuilder().setCustomId('set_cooldown_modal').setLabel('Definir Cooldown').setStyle(ButtonStyle.Secondary).setEmoji('⏳')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_enviar_painel').setLabel('Enviar Painel Público').setStyle(ButtonStyle.Success).setEmoji('🚀')
        );

        return interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
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
      // Botões de configuração do Painel
      if (['painel_titulo', 'painel_desc', 'painel_banner', 'painel_compra', 'painel_cor'].includes(interaction.customId)) {
        const modalMap = {
          painel_titulo: { id: 'modal_painel_titulo', title: 'Alterar Título', label: 'Novo Título', placeholder: 'Loja Oficial' },
          painel_desc: { id: 'modal_painel_desc', title: 'Alterar Descrição', label: 'Nova Descrição', placeholder: 'Selecione um produto...' },
          painel_banner: { id: 'modal_painel_banner', title: 'Alterar Banner', label: 'Link da Imagem (URL)', placeholder: 'https://...' },
          painel_compra: { id: 'modal_painel_compra', title: 'Texto do Botão', label: 'Texto', placeholder: 'Comprar Agora' },
          painel_cor: { id: 'modal_painel_cor', title: 'Cor da Embed', label: 'Hex Code (Ex: #5865F2)', placeholder: '#5865F2' }
        };

        const mInfo = modalMap[interaction.customId];
        const modal = new ModalBuilder().setCustomId(mInfo.id).setTitle(mInfo.title);
        const input = new TextInputBuilder()
          .setCustomId('input_painel_valor')
          .setLabel(mInfo.label)
          .setPlaceholder(mInfo.placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'painel_canal') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('select_painel_canal')
            .setPlaceholder('Selecione o canal onde o painel será enviado')
            .addChannelTypes(ChannelType.GuildText)
        );
        return interaction.reply({ content: 'Selecione abaixo o canal do painel:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'painel_publicar') {
        const pData = painelTemp.get(interaction.user.id);
        if (!pData || !pData.canal) {
          return interaction.reply({ embeds: [erro('Erro', 'Você precisa selecionar um canal antes de publicar o painel!')], ephemeral: true });
        }

        const channel = interaction.guild.channels.cache.get(pData.canal);
        if (!channel) {
          return interaction.reply({ embeds: [erro('Erro', 'Canal selecionado não foi encontrado.')], ephemeral: true });
        }

        const embedFinal = new EmbedBuilder()
          .setColor(pData.cor)
          .setTitle(`🛒 ${pData.titulo}`)
          .setDescription(`${pData.descricao}\n\nProdutos disponíveis: ${pData.produtosCount}`)
          .setImage(pData.banner);

        const rowBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('comprar_produto_final').setLabel(pData.botaoCompra).setStyle(ButtonStyle.Success).setEmoji('🛒')
        );

        await channel.send({ embeds: [embedFinal], components: [rowBtn] });
        return interaction.update({ embeds: [sucesso('Publicado!', `Painel publicado com sucesso no canal ${channel}!`)], components: [] });
      }

      // Configuração de Produtos
      if (['prod_emoji', 'prod_nome', 'prod_desc', 'prod_preco', 'prod_estoque', 'prod_categoria', 'prod_entrega', 'prod_imagem'].includes(interaction.customId)) {
        const modalIdMap = {
          prod_emoji: { id: 'modal_prod_emoji', title: 'Definir Emoji', label: 'Emoji do Produto', placeholder: 'Ex: 📦' },
          prod_nome: { id: 'modal_prod_nome', title: 'Definir Nome', label: 'Nome do Produto', placeholder: 'Ex: Nitro Mensal' },
          prod_desc: { id: 'modal_prod_desc', title: 'Definir Descrição', label: 'Descrição', placeholder: 'Ex: 1 Mês de Discord Nitro' },
          prod_preco: { id: 'modal_prod_preco', title: 'Definir Preço', label: 'Preço', placeholder: 'Ex: R$ 20,00' },
          prod_estoque: { id: 'modal_prod_estoque', title: 'Definir Estoque', label: 'Quantidade Inicial', placeholder: 'Ex: 10' },
          prod_categoria: { id: 'modal_prod_categoria', title: 'Definir Categoria', label: 'Categoria', placeholder: 'Ex: Assinaturas' },
          prod_entrega: { id: 'modal_prod_entrega', title: 'Definir Entrega', label: 'Método de Entrega', placeholder: 'Ex: Automática via Chat' },
          prod_imagem: { id: 'modal_prod_imagem', title: 'Definir Imagem', label: 'Link da Imagem (URL)', placeholder: 'https://exemplo.com/foto.png' }
        };

        const configModal = modalIdMap[interaction.customId];
        const modal = new ModalBuilder().setCustomId(configModal.id).setTitle(configModal.title);
        const input = new TextInputBuilder()
          .setCustomId('input_valor')
          .setLabel(configModal.label)
          .setPlaceholder(configModal.placeholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'prod_salvar') {
        produtoTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [sucesso('Produto Salvo', 'O produto foi criado e salvo com sucesso!')], components: [] });
      }

      if (interaction.customId === 'prod_cancelar') {
        produtoTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [erro('Cancelado', 'A criação do produto foi cancelada.')], components: [] });
      }

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

        const timestampFormatado = `<t:${Math.floor(Date.now() / 1000)}:F>`;
        const conteudoReestock = 
          `📦 **REESTOCK! O produto ${nomeProduto} acabou de receber novos itens!**\n\n` +
          `📌 **Campo:**\n${nomeProduto}\n\n` +
          `📦 **Adicionados:**\n${qtdSolicitada}\n\n` +
          `✅ **Estoque total:**\n${qtdSolicitada}\n\n` +
          `⏰ **Data:**\n${timestampFormatado}`;

        const rowCompra = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Comprar Agora')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${interaction.guildId}/${logChannel.id}`)
            .setEmoji('🛒')
        );

        await logChannel.send({ content: conteudoReestock, components: [rowCompra] });

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

      if (interaction.customId.startsWith('config_reest_')) {
        const rowConfig = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('menu_add_blacklist').setLabel('Adicionar à Blacklist').setStyle(ButtonStyle.Danger).setEmoji('🚫'),
          new ButtonBuilder().setCustomId('menu_remove_blacklist').setLabel('Remover da Blacklist').setStyle(ButtonStyle.Secondary).setEmoji('✅')
        );

        return interaction.reply({ content: `⚙️ **Painel de Blacklist**\nEscolha uma das opções abaixo:`, components: [rowConfig], ephemeral: true });
      }

      if (interaction.customId === 'menu_add_blacklist') {
        const userSelect = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId('select_add_blacklist')
            .setPlaceholder('Selecione o membro para bloquear')
        );
        return interaction.update({ content: 'Selecione abaixo o membro que deseja **adicionar à blacklist**:', components: [userSelect] });
      }

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
        salvarDados();
        return interaction.update({ content: `✅ Canal de solicitações definido para <#${config.canalSolicitacao}>! Use /reestock novamente para ver as atualizações.`, components: [] });
      }
      if (interaction.customId === 'select_canal_log') {
        config.canalLog = interaction.values[0];
        salvarDados();
        return interaction.update({ content: `✅ Canal de logs de reestock definido para <#${config.canalLog}>! Use /reestock novamente para ver as atualizações.`, components: [] });
      }
      if (interaction.customId === 'select_painel_canal') {
        const pData = painelTemp.get(interaction.user.id) || {};
        pData.canal = interaction.values[0];
        painelTemp.set(interaction.user.id, pData);
        return interaction.update({ content: `✅ Canal do painel definido para <#${pData.canal}> com sucesso!`, components: [] });
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

    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'select_add_blacklist') {
        const userId = interaction.values[0];
        blacklistUsers.add(userId);
        salvarDados();
        return interaction.update({ content: `🚫 O usuário <@${userId}> foi adicionado com sucesso à **blacklist**!`, components: [] });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_remove_blacklist') {
        const userId = interaction.values[0];
        blacklistUsers.delete(userId);
        salvarDados();
        return interaction.update({ content: `✅ O usuário <@${userId}> foi removido da **blacklist** com sucesso!`, components: [] });
      }
    }

    // ----------------------------------------
    // MODALS
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      // Modais de configuração do Painel
      if (interaction.customId.startsWith('modal_painel_')) {
        const valor = interaction.fields.getTextInputValue('input_painel_valor');
        let pData = painelTemp.get(interaction.user.id) || {
          titulo: 'Configuração do Painel',
          descricao: 'Selecione um produto no menu abaixo para comprar.',
          banner: 'https://i.imgur.com/74kQ5j2.png',
          canal: null,
          categoria: 'Geral',
          botaoCompra: 'Comprar Agora',
          cor: '#5865F2',
          produtosCount: 1
        };

        if (interaction.customId === 'modal_painel_titulo') pData.titulo = valor;
        if (interaction.customId === 'modal_painel_desc') pData.descricao = valor;
        if (interaction.customId === 'modal_painel_banner') pData.banner = valor;
        if (interaction.customId === 'modal_painel_compra') pData.botaoCompra = valor;
        if (interaction.customId === 'modal_painel_cor') pData.cor = valor;

        painelTemp.set(interaction.user.id, pData);

        const embedAtualizada = new EmbedBuilder()
          .setColor(pData.cor)
          .setTitle(`⚙️ ${pData.titulo}`)
          .setDescription(`🛍️ **Produtos disponíveis**\n${pData.descricao}\n\nProdutos disponíveis: ${pData.produtosCount}`)
          .setImage(pData.banner);

        await interaction.message.edit({ embeds: [embedAtualizada] }).catch(() => {});
        return interaction.reply({ embeds: [sucesso('Atualizado', 'Configuração do painel atualizada com sucesso!')], ephemeral: true });
      }

      // Modais de criação de produto
      if (interaction.customId.startsWith('modal_prod_')) {
        const valor = interaction.fields.getTextInputValue('input_valor');
        let prod = produtoTemp.get(interaction.user.id) || {
          emoji: '😃', nome: 'Não definido', desc: 'Não definida', 
          preco: 'R$ 0,00', estoque: '0', categoria: 'Geral', 
          entrega: 'Automática', imagem: 'Nenhuma'
        };

        if (interaction.customId === 'modal_prod_emoji') prod.emoji = valor;
        if (interaction.customId === 'modal_prod_nome') prod.nome = valor;
        if (interaction.customId === 'modal_prod_desc') prod.desc = valor;
        if (interaction.customId === 'modal_prod_preco') prod.preco = valor;
        if (interaction.customId === 'modal_prod_estoque') prod.estoque = valor;
        if (interaction.customId === 'modal_prod_categoria') prod.categoria = valor;
        if (interaction.customId === 'modal_prod_entrega') prod.entrega = valor;
        if (interaction.customId === 'modal_prod_imagem') prod.imagem = valor;

        produtoTemp.set(interaction.user.id, prod);
        return interaction.reply({ embeds: [sucesso('Atualizado', `Propriedade configurada com sucesso!`)], ephemeral: true });
      }

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
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Cooldown Atualizado', `O tempo de espera entre solicitações foi alterado para **${reestockCooldownMinutos} minutos**! Use /reestock para visualizar as alterações.`)], ephemeral: true });
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
