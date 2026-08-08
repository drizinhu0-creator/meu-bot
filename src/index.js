const { 
  Client, GatewayIntentBits, Partials, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, 
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, 
  TextInputStyle, ChannelType, PermissionFlagsBits, EmbedBuilder, 
  REST, Routes, SlashCommandBuilder, AttachmentBuilder 
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ==========================================
// 1. SERVIDOR HTTP PARA O RENDER (24/7)
// ==========================================
http.createServer((req, res) => {
  res.write("Bot Online 24/7!");
  res.end();
}).listen(process.env.PORT || 3000, () => {
  console.log("🌐 Servidor HTTP ativo para o Render.");
});

// ==========================================
// 2. BANCO DE DADOS PERSISTENTE (JSON)
// ==========================================
const dbFolder = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbFolder)) fs.mkdirSync(dbFolder, { recursive: true });
const dbFile = path.join(dbFolder, 'reestock_data.json');

function carregarDados() {
  if (fs.existsSync(dbFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
      return {
        configServidor: data.configServidor || {}, 
        produtos: data.produtos || {},             
        paineis: data.paineis || {},               
        carrinhosAtivos: data.carrinhosAtivos || {}, 
        cupons: data.cupons || {},                 
        conexoesVoz: data.conexoesVoz || {},
        ticketsConfig: data.ticketsConfig || { setores: {}, painel: { titulo: 'Central', desc: 'Atendimento' }, cargos: [] }
      };
    } catch (e) {
      console.error('Erro ao ler banco de dados:', e);
    }
  }
  return { configServidor: {}, produtos: {}, painéis: {}, carrinhosAtivos: {}, cupons: {}, conexoesVoz: {}, ticketsConfig: {} };
}

function salvarDados() {
  try {
    const data = { configServidor, produtos, painéis: painel, carrinhosAtivos, cupons, conexoesVoz, ticketsConfig };
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erro ao salvar banco de dados:', e);
  }
}

const dadosSalvos = carregarDados();
const configServidor = dadosSalvos.configServidor;
const produtos = dadosSalvos.produtos;
const painel = dadosSalvos.paineis || dadosSalvos.painéis || {};
const carrinhosAtivos = dadosSalvos.carrinhosAtivos;
const cupons = dadosSalvos.cupons;
const conexoesVoz = dadosSalvos.conexoesVoz;
const ticketsConfig = dadosSalvos.ticketsConfig || {};

const produtoTemp = new Map();
const painelTemp = new Map();
const reestockTemp = new Map(); // userId -> produtoId selecionado para reestock
const aguardandoUploadPix = new Map(); 

function formatarMoeda(valor) {
  const num = parseFloat(valor) || 0;
  return `R$ ${num.toFixed(2).replace('.', ',')}`;
}

async function enviarLog(guild, titulo, desc) {
  if (!guild) return;
  const cfg = configServidor[guild.id];
  if (!cfg || !cfg.logChannelId) return;
  const canalLog = guild.channels.cache.get(cfg.logChannelId);
  if (!canalLog) return;
  const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`📋 ${titulo}`).setDescription(desc).setTimestamp();
  await canalLog.send({ embeds: [embed] }).catch(() => {});
}

const sucesso = (titulo, desc) => new EmbedBuilder().setColor('#57F287').setTitle(`🟢 ${titulo}`).setDescription(desc);
const aviso = (titulo, desc) => new EmbedBuilder().setColor('#FEE75C').setTitle(`⚠️ ${titulo}`).setDescription(desc);
const erro = (titulo, desc) => new EmbedBuilder().setColor('#ED4245').setTitle(`🔴 ${titulo}`).setDescription(desc);

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
// 3. CAPTURA DE UPLOAD (QR CODE PIX)
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const guildId = aguardandoUploadPix.get(message.author.id);
  if (!guildId) return;

  const anexo = message.attachments.first();
  if (!anexo || !['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(anexo.contentType)) {
    await message.reply({ embeds: [erro('Erro', 'Envie uma imagem válida para o QR Code.')] }).then(msg => setTimeout(() => msg.delete().catch(()=>{}), 4000));
    return;
  }

  if (!configServidor[guildId]) configServidor[guildId] = {};
  configServidor[guildId].pixQrCode = anexo.url;
  salvarDados();
  aguardandoUploadPix.delete(message.author.id);

  await message.delete().catch(() => {});
  await message.channel.send({ content: `${message.author}`, embeds: [sucesso('QR Code salvo', 'O QR Code PIX foi salvo com sucesso.')] }).then(msg => setTimeout(() => msg.delete().catch(()=>{}), 5000));
});

// ==========================================
// 4. INTERACTION CREATE (HANDLER GLOBAL)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'config') {
        await interaction.deferReply({ ephemeral: true });
        const guildId = interaction.guildId;
        const cfg = configServidor[guildId] || {};

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('⚙️ Configuração')
          .setDescription(
            `Configure as principais opções do sistema.\n\n` +
            `• **Chave PIX:** \`${cfg.pixKey || 'Não configurada'}\`\n` +
            `• **QR Code:** ${cfg.pixQrCode ? 'Configurado ✅' : 'Não configurado'}\n` +
            `• **Nome do Recebedor:** \`${cfg.pixReceiverName || 'Não configurado'}\`\n` +
            `• **Canal de Logs:** ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Não configurado'}`
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_menu_pix').setLabel('Configurar PIX').setStyle(ButtonStyle.Primary).setEmoji('💳'),
          new ButtonBuilder().setCustomId('config_menu_logs').setLabel('Configurar Logs').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
          new ButtonBuilder().setCustomId('config_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'produto') {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          produtoTemp.set(interaction.user.id, {
            id: Date.now().toString(),
            guildId: interaction.guildId,
            emoji: '', nome: '', desc: '', 
            preco: 0, estoque: 0, imagem: null, categoria: 'Geral', 
            cargoId: null, dataCriacao: new Date().toISOString()
          });

          const pTemp = produtoTemp.get(interaction.user.id);
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📦 Configuração do Produto')
            .setDescription(
              `**Nome:** Não definido\n` +
              `**Preço:** R$ 0,00\n` +
              `**Estoque:** 0\n` +
              `**Emoji:** Nenhum\n` +
              `**Descrição:** Nenhuma\n` +
              `**Imagem:** Não definida\n` +
              `**Cargo entregue:** Não definido\n` +
              `**Categoria:** Geral`
            );

          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_nome').setLabel('Nome').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
            new ButtonBuilder().setCustomId('prod_preco').setLabel('Preço').setStyle(ButtonStyle.Secondary).setEmoji('💰'),
            new ButtonBuilder().setCustomId('prod_estoque').setLabel('Estoque').setStyle(ButtonStyle.Secondary).setEmoji('📦'),
            new ButtonBuilder().setCustomId('prod_emoji').setLabel('Emoji').setStyle(ButtonStyle.Secondary).setEmoji('😀')
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_desc').setLabel('Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
            new ButtonBuilder().setCustomId('prod_banner').setLabel('Imagem (URL)').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
            new ButtonBuilder().setCustomId('prod_cargo').setLabel('Cargo').setStyle(ButtonStyle.Secondary).setEmoji('🎁'),
            new ButtonBuilder().setCustomId('prod_categoria').setLabel('Categoria').setStyle(ButtonStyle.Secondary).setEmoji('📂')
          );

          const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_salvar').setLabel('Salvar Produto').setStyle(ButtonStyle.Success).setEmoji('💾'),
            new ButtonBuilder().setCustomId('prod_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('❌')
          );

          return interaction.editReply({ embeds: [embed], components: [row1, row2, row3] });
        }
      }

      if (commandName === 'painel') {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          const embedEtapa1 = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🛒 Criação de Painel — Etapa 1')
            .setDescription('Como deseja publicar os produtos no painel?');

          const rowEtapa1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('painel_modo_botao').setLabel('Botão').setStyle(ButtonStyle.Primary).setEmoji('🔘'),
            new ButtonBuilder().setCustomId('painel_modo_menu').setLabel('Menu de Seleção').setStyle(ButtonStyle.Secondary).setEmoji('📑')
          );

          return interaction.editReply({ embeds: [embedEtapa1], components: [rowEtapa1] });
        }
      }

      if (commandName === 'reestock') {
        await interaction.deferReply({ ephemeral: true });
        const prodKeys = Object.keys(produtos);
        if (prodKeys.length === 0) {
          return interaction.editReply({ 
            embeds: [aviso('Nenhum produto cadastrado', 'Crie um produto primeiro usando `/produto criar`.')] 
          });
        }

        const options = prodKeys.slice(0, 25).map(id => ({
          label: produtos[id].nome.substring(0, 100),
          description: `Estoque atual: ${produtos[id].estoque}`,
          value: id,
          emoji: '🛒'
        }));

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_reestock_produto')
          .setPlaceholder('Selecione o produto que receberá estoque')
          .addOptions(options);

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📦 Reestoque')
          .setDescription('Selecione abaixo o produto que receberá estoque:');

        return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
      }

      if (commandName === 'cupom') {
        await interaction.deferReply({ ephemeral: true });
        const total = Object.keys(cupons).length;
        const ativos = Object.values(cupons).filter(c => c.ativo !== false).length;

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🏷 Gerenciador de Cupons')
          .setDescription(`📊 **Estatísticas:**\n• **Total de cupons:** ${total}\n• **Cupons ativos:** ${ativos}`);

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cupom_criar').setLabel('Criar Cupom').setStyle(ButtonStyle.Success).setEmoji('➕'),
          new ButtonBuilder().setCustomId('cupom_excluir').setLabel('Excluir Cupom').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
          new ButtonBuilder().setCustomId('cupom_listar').setLabel('Listar Cupons').setStyle(ButtonStyle.Primary).setEmoji('📋'),
          new ButtonBuilder().setCustomId('cupom_fechar').setLabel('Fechar').setStyle(ButtonStyle.Secondary).setEmoji('❌')
        );

        return interaction.editReply({ embeds: [embed], components: [row1] });
      }

      if (commandName === 'perfil') {
        await interaction.deferReply({ ephemeral: true });
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('👤 Perfil do Bot')
          .setDescription(`**Nome atual:** ${client.user.username}\n**Avatar atual:** [Ver Link](${client.user.displayAvatarURL({ size: 512 })})`)
          .setThumbnail(client.user.displayAvatarURL());

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('perfil_avatar').setLabel('Alterar Avatar').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId('perfil_nome').setLabel('Alterar Nome').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId('perfil_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return interaction.editReply({ embeds: [embed], components: [row] });
      }

      if (commandName === 'conectar') {
        await interaction.deferReply({ ephemeral: true });
        const conexaoAtiva = conexoesVoz[interaction.guildId];
        let desc = 'O bot não está conectado a nenhum canal de voz.';
        let botoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('conectar_abrir').setLabel('Conectar').setStyle(ButtonStyle.Success).setEmoji('🔗'),
          new ButtonBuilder().setCustomId('conectar_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        if (conexaoAtiva) {
          const canalNome = interaction.guild.channels.cache.get(conexaoAtiva.canalId)?.name || 'Canal de Voz';
          desc = `Canal: 🔊 ${canalNome}\nConectado há: <t:${conexaoAtiva.timestamp}:R>`;
          botoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('conectar_mudar').setLabel('Mudar de Call').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
            new ButtonBuilder().setCustomId('conectar_desconectar').setLabel('Desconectar').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
            new ButtonBuilder().setCustomId('conectar_fechar').setLabel('Fechar').setStyle(ButtonStyle.Secondary).setEmoji('❌')
          );
        }

        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎵 Bot Conectado').setDescription(desc);
        return interaction.editReply({ embeds: [embed], components: [botoes] });
      }

      if (commandName === 'ticket') {
        await interaction.deferReply({ ephemeral: true });
        return interaction.editReply({ content: 'Sistema de ticket ativo.' });
      }

      if (commandName === 'palavras') {
        await interaction.deferReply({ ephemeral: true });
        return interaction.editReply({ content: 'Sistema de filtro de palavras ativo.' });
      }
    }

    if (interaction.isButton()) {
      const cid = interaction.customId;

      if (cid === 'config_menu_pix') {
        const guildId = interaction.guildId;
        const cfg = configServidor[guildId] || {};
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('💳 Configuração de Pagamento')
          .setDescription('Configure os dados que serão utilizados\nno pagamento dos pedidos.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_pix_chave').setLabel('Chave PIX').setStyle(ButtonStyle.Primary).setEmoji('🔑'),
          new ButtonBuilder().setCustomId('config_pix_qrcode').setLabel('QR Code').setStyle(ButtonStyle.Primary).setEmoji('📷'),
          new ButtonBuilder().setCustomId('config_pix_nome').setLabel('Nome do Recebedor').setStyle(ButtonStyle.Primary).setEmoji('👤'),
          new ButtonBuilder().setCustomId('config_voltar').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
        );
        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (cid === 'config_menu_logs') {
        const menu = new ChannelSelectMenuBuilder().setCustomId('select_canal_logs').setPlaceholder('Selecione o canal de logs').addChannelTypes(ChannelType.GuildText);
        return interaction.reply({ content: 'Selecione o canal que receberá os logs:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (cid === 'config_fechar' || cid === 'conectar_fechar') {
        return interaction.message.delete().catch(() => {});
      }

      if (cid === 'config_voltar') {
        const guildId = interaction.guildId;
        const cfg = configServidor[guildId] || {};
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('⚙️ Configuração')
          .setDescription(
            `Configure as principais opções do sistema.\n\n` +
            `• **Chave PIX:** \`${cfg.pixKey || 'Não configurada'}\`\n` +
            `• **QR Code:** ${cfg.pixQrCode ? 'Configurado ✅' : 'Não configurado'}\n` +
            `• **Nome do Recebedor:** \`${cfg.pixReceiverName || 'Não configurado'}\`\n` +
            `• **Canal de Logs:** ${cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Não configurado'}`
          );
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_menu_pix').setLabel('Configurar PIX').setStyle(ButtonStyle.Primary).setEmoji('💳'),
          new ButtonBuilder().setCustomId('config_menu_logs').setLabel('Configurar Logs').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
          new ButtonBuilder().setCustomId('config_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );
        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (cid === 'config_pix_chave') {
        const modal = new ModalBuilder().setCustomId('modal_config_chave').setTitle('Chave PIX');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val_input').setLabel('Digite a chave PIX').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (cid === 'config_pix_qrcode') {
        aguardandoUploadPix.set(interaction.user.id, interaction.guildId);
        return interaction.reply({ content: '📷 Envie agora a imagem do QR Code PIX nesta conversa.', ephemeral: true });
      }

      if (cid === 'config_pix_nome') {
        const modal = new ModalBuilder().setCustomId('modal_config_nome').setTitle('Nome do Recebedor');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val_input').setLabel('Nome que aparecerá na tela').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (cid === 'conectar_abrir' || cid === 'conectar_mudar') {
        const menu = new ChannelSelectMenuBuilder().setCustomId('select_canal_voz').setPlaceholder('Selecione o canal de voz').addChannelTypes(ChannelType.GuildVoice);
        return interaction.reply({ content: 'Selecione o canal de voz:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (cid === 'conectar_desconectar') {
        const connection = getVoiceConnection(interaction.guildId);
        if (connection) connection.destroy();
        delete conexoesVoz[interaction.guildId];
        salvarDados();

        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎵 Bot Conectado').setDescription('O bot não está conectado a nenhum canal de voz.');
        const botoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('conectar_abrir').setLabel('Conectar').setStyle(ButtonStyle.Success).setEmoji('🔗'),
          new ButtonBuilder().setCustomId('conectar_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );
        return interaction.update({ embeds: [embed], components: [botoes] });
      }

      if (['prod_nome', 'prod_preco', 'prod_estoque', 'prod_emoji', 'prod_desc', 'prod_categoria', 'prod_banner'].includes(cid)) {
        const mapModal = {
          prod_nome: { id: 'modal_p_nome', title: 'Nome do Produto', label: 'Nome' },
          prod_preco: { id: 'modal_p_preco', title: 'Preço', label: 'Preço em Reais (Ex: 3.50)' },
          prod_estoque: { id: 'modal_p_estoque', title: 'Estoque', label: 'Estoque numérico' },
          prod_emoji: { id: 'modal_p_emoji', title: 'Emoji', label: 'Emoji opcional' },
          prod_desc: { id: 'modal_p_desc', title: 'Descrição', label: 'Descrição opcional' },
          prod_categoria: { id: 'modal_p_categoria', title: 'Categoria', label: 'Categoria' },
          prod_banner: { id: 'modal_p_banner', title: 'Imagem', label: 'Link URL da imagem' }
        };
        const info = mapModal[cid];
        const modal = new ModalBuilder().setCustomId(info.id).setTitle(info.title);
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val_input').setLabel(info.label).setStyle(TextInputStyle.Short).setRequired(false)));
        return interaction.showModal(modal);
      }

      if (cid === 'prod_cargo') {
        const menu = new RoleSelectMenuBuilder().setCustomId('select_cargo_produto').setPlaceholder('Selecione o cargo entregue');
        return interaction.reply({ content: 'Selecione o cargo:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (cid === 'prod_salvar') {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (!pTemp || !pTemp.nome || pTemp.preco <= 0) {
          return interaction.reply({ embeds: [aviso('Atenção', 'Preencha ao menos o nome e o preço.')], ephemeral: true });
        }
        produtos[pTemp.id] = pTemp;
        salvarDados();
        enviarLog(interaction.guild, 'Produto Criado', `Produto **${pTemp.nome}** criado por ${interaction.user}`);
        produtoTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [sucesso('Sucesso', '✅ Produto criado e salvo permanentemente.')], components: [] });
      }

      if (cid === 'prod_cancelar') {
        produtoTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [aviso('Cancelado', 'Criação cancelada.')], components: [] });
      }

      if (cid === 'carrinho_cancelar') {
        const cartKey = Object.keys(carrinhosAtivos).find(k => carrinhosAtivos[k].channelId === interaction.channelId);
        if (cartKey) {
          const carrinho = carrinhosAtivos[cartKey];
          const prod = produtos[carrinho.productId];
          if (prod) {
            prod.estoque += carrinho.quantity; 
            salvarDados();
          }
          enviarLog(interaction.guild, 'Carrinho Fechado', `Carrinho de <@${carrinho.userId}> cancelado.`);
          delete carrinhosAtivos[cartKey];
          salvarDados();
        }
        await interaction.update({ content: '🔴 Pedido cancelado\n\nO pagamento foi cancelado.', embeds: [], components: [] }).catch(() => {});
        setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        return;
      }

      if (cid === 'carrinho_pagar') {
        const cartKey = Object.keys(carrinhosAtivos).find(k => carrinhosAtivos[k].channelId === interaction.channelId);
        if (!cartKey) return interaction.reply({ embeds: [erro('Erro', 'Carrinho não encontrado.')], ephemeral: true });
        const carrinho = carrinhosAtivos[cartKey];
        const cfg = configServidor[interaction.guildId] || {};

        if (!cfg.pixKey) {
          return interaction.reply({ embeds: [aviso('Pagamento indisponível', 'Não há uma chave PIX cadastrada no momento.\nEntre em contato com a administração.')], ephemeral: true });
        }

        const prod = produtos[carrinho.productId];
        let total = prod.preco * carrinho.quantity;
        if (carrinho.desconto) {
          total -= carrinho.desconto;
          if (total < 0) total = 0;
        }

        const embedPag = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('💳 Pagamento')
          .setDescription(
            `Valor a pagar: **${formatarMoeda(total)}**\n\n` +
            `Chave PIX:\n\`${cfg.pixKey}\`\n\n` +
            `Nome do recebedor:\n\`${cfg.pixReceiverName || 'Não configurado'}\`\n\n` +
            `QR Code:\n${cfg.pixQrCode ? '[Ver QR Code abaixo]' : 'Não configurado'}`
          );

        if (cfg.pixQrCode) embedPag.setImage(cfg.pixQrCode);

        const rowPag = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pag_copia').setLabel('PIX Copia e Cola').setStyle(ButtonStyle.Primary).setEmoji('📋'),
          new ButtonBuilder().setCustomId('pag_paguei').setLabel('Já Paguei').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('carrinho_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return interaction.update({ embeds: [embedPag], components: [rowPag] });
      }

      if (cid === 'pag_copia') {
        const cfg = configServidor[interaction.guildId] || {};
        return interaction.reply({ content: `🔑 **Chave PIX Copia e Cola:**\n\`${cfg.pixKey}\``, ephemeral: true });
      }

      if (cid === 'pag_paguei') {
        const cartKey = Object.keys(carrinhosAtivos).find(k => carrinhosAtivos[k].channelId === interaction.channelId);
        if (cartKey) {
          carrinhosAtivos[cartKey].status = 'pending_confirmation';
          salvarDados();
          enviarLog(interaction.guild, 'Pagamento Informado', `Cliente <@${carrinhosAtivos[cartKey].userId}> informou o pagamento no canal <#${interaction.channelId}>.`);
        }
        return interaction.update({ content: '🟡 **Pagamento informado**\n\nSeu pagamento foi marcado como realizado.\nAguarde a confirmação.', embeds: [], components: [] });
      }

      if (cid.startsWith('comprar_btn_')) {
        const prodId = cid.replace('comprar_btn_', '');
        const prod = produtos[prodId];
        if (!prod || prod.estoque <= 0) {
          return interaction.reply({ embeds: [aviso('Produto Indisponível', '❌ Sem estoque disponível')], ephemeral: true });
        }

        if (Object.values(carrinhosAtivos).some(c => c.userId === interaction.user.id)) {
          return interaction.reply({ embeds: [aviso('Carrinho Existente', '⚠️ Você já possui um carrinho aberto.')], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        prod.estoque -= 1;
        salvarDados();

        const posicaoAtual = interaction.channel.position;
        const canalCarrinho = await interaction.guild.channels.create({
          name: `🛒・carrinho-${interaction.user.username.toLowerCase()}`,
          type: ChannelType.GuildText,
          parent: interaction.channel.parent || null,
          position: posicaoAtual + 1,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
          ]
        });

        const cartId = Date.now().toString();
        carrinhosAtivos[cartId] = {
          cartId, guildId: interaction.guildId, userId: interaction.user.id,
          channelId: canalCarrinho.id, productId: prodId, quantity: 1, desconto: 0, status: 'open'
        };
        salvarDados();

        enviarLog(interaction.guild, 'Carrinho Criado', `Carrinho criado para ${interaction.user} (${canalCarrinho.name})`);

        const embedCarrinho = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`Revisão do Pedido — ${interaction.user.username}`)
          .setDescription(prod.desc ? `${prod.desc}` : 'Entrega rápida e fácil via carrinho!');

        if (prod.imagem) embedCarrinho.setImage(prod.imagem);

        embedCarrinho.addFields(
          { name: '\u200b', value: `» **(1x)** ${prod.name || prod.nome} — **${formatarMoeda(prod.preco)}** por unidade · subtotal **${formatarMoeda(prod.preco)}**\nestoque ${prod.estoque}` },
          { name: '\u200b', value: `📦 Estoque disponível: ${prod.estoque}\n🛒 Total de itens — 1\n💰 Total à vista — **${formatarMoeda(prod.preco)}**` }
        );

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('carrinho_pagar').setLabel('Ir para o Pagamento').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('carrinho_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('🟥')
        );

        await canalCarrinho.send({ content: `${interaction.user}`, embeds: [embedCarrinho], components: [row1] });
        return interaction.editReply({ content: `✅ Seu carrinho foi criado com sucesso em <#${canalCarrinho.id}>!` });
      }

      if (cid === 'painel_modo_botao' || cid === 'painel_modo_menu') {
        const modo = cid === 'painel_modo_menu' ? 'menu' : 'botao';
        painelTemp.set(interaction.user.id, {
          titulo: 'Loja Oficial', descricao: 'Selecione abaixo para adquirir nossos produtos.',
          banner: null, cor: '#5865F2', modoExibicao: modo, produtosSelecionados: []
        });
        const pData = painelTemp.get(interaction.user.id);
        const embed = new EmbedBuilder().setColor(pData.cor).setTitle(pData.titulo).setDescription(pData.descricao);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('p_sel_produtos').setLabel('Produtos').setStyle(ButtonStyle.Secondary).setEmoji('🛍️'),
          new ButtonBuilder().setCustomId('p_publicar').setLabel('Publicar').setStyle(ButtonStyle.Success).setEmoji('📢'),
          new ButtonBuilder().setCustomId('p_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );
        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (cid === 'p_sel_produtos') {
        const prodKeys = Object.keys(produtos);
        if (prodKeys.length === 0) return interaction.reply({ embeds: [aviso('Atenção', 'Nenhum produto cadastrado.')], ephemeral: true });
        const options = prodKeys.slice(0, 25).map(id => ({
          label: produtos[id].nome.substring(0, 100),
          description: `💰 Valor: ${formatarMoeda(produtos[id].preco)} | 📦 Estoque: ${produtos[id].estoque}`,
          value: id
        }));
        const select = new StringSelectMenuBuilder().setCustomId('select_produtos_painel').setPlaceholder('Selecione os produtos').setMinValues(1).setMaxValues(options.length).addOptions(options);
        return interaction.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (cid === 'p_publicar') {
        const menu = new ChannelSelectMenuBuilder().setCustomId('select_canal_publicar_painel').setPlaceholder('Selecione o canal').addChannelTypes(ChannelType.GuildText);
        return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (cid === 'p_cancelar') {
        painelTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [aviso('Cancelado', 'Operação cancelada.')], components: [] });
      }

      if (cid === 'perfil_nome') {
        const modal = new ModalBuilder().setCustomId('modal_perfil_nome').setTitle('Alterar Nome');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val_input').setLabel('Novo Nome').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
      if (cid === 'perfil_avatar') {
        const modal = new ModalBuilder().setCustomId('modal_perfil_avatar').setTitle('Alterar Avatar');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val_input').setLabel('Link URL da Imagem').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_produtos_painel') {
        const pData = painelTemp.get(interaction.user.id);
        if (pData) pData.produtosSelecionados = interaction.values;
        return interaction.reply({ content: '✅ Produtos selecionados com sucesso.', ephemeral: true });
      }

      // TRATAMENTO DA SELEÇÃO DE PRODUTO PARA REESTOCK
      if (interaction.customId === 'select_reestock_produto') {
        const prodId = interaction.values[0];
        const prod = produtos[prodId];
        if (!prod) return interaction.reply({ embeds: [erro('Erro', 'Produto não encontrado.')], ephemeral: true });

        reestockTemp.set(interaction.user.id, prodId);

        const modal = new ModalBuilder().setCustomId('modal_reestock_qtd').setTitle('Reestoque');
        const input = new TextInputBuilder()
          .setCustomId('val_input')
          .setLabel('Quantidade a adicionar')
          .setPlaceholder('Ex: 20')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId.startsWith('comprar_menu_painel_')) {
        const prodId = interaction.values[0];
        const prod = produtos[prodId];
        if (!prod || prod.estoque <= 0) {
          return interaction.reply({ embeds: [aviso('Indisponível', '❌ Sem estoque disponível')], ephemeral: true });
        }
        if (Object.values(carrinhosAtivos).some(c => c.userId === interaction.user.id)) {
          return interaction.reply({ embeds: [aviso('Carrinho Existente', '⚠️ Você já possui um carrinho aberto.')], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        prod.estoque -= 1;
        salvarDados();

        const posicaoAtual = interaction.channel.position;
        const canalCarrinho = await interaction.guild.channels.create({
          name: `🛒・carrinho-${interaction.user.username.toLowerCase()}`,
          type: ChannelType.GuildText,
          parent: interaction.channel.parent || null,
          position: posicaoAtual + 1,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
          ]
        });

        const cartId = Date.now().toString();
        carrinhosAtivos[cartId] = {
          cartId, guildId: interaction.guildId, userId: interaction.user.id,
          channelId: canalCarrinho.id, productId: prodId, quantity: 1, desconto: 0, status: 'open'
        };
        salvarDados();

        enviarLog(interaction.guild, 'Carrinho Criado', `Carrinho criado para ${interaction.user} (${canalCarrinho.name})`);

        const embedCarrinho = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`Revisão do Pedido — ${interaction.user.username}`)
          .setDescription(prod.desc ? `${prod.desc}` : 'Entrega rápida e fácil via carrinho!');

        if (prod.imagem) embedCarrinho.setImage(prod.imagem);

        embedCarrinho.addFields(
          { name: '\u200b', value: `» **(1x)** ${prod.nome} — **${formatarMoeda(prod.preco)}** por unidade · subtotal **${formatarMoeda(prod.preco)}**\nestoque ${prod.estoque}` },
          { name: '\u200b', value: `📦 Estoque disponível: ${prod.estoque}\n🛒 Total de itens — 1\n💰 Total à vista — **${formatarMoeda(prod.preco)}**` }
        );

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('carrinho_pagar').setLabel('Ir para o Pagamento').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('carrinho_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('🟥')
        );

        await canalCarrinho.send({ content: `${interaction.user}`, embeds: [embedCarrinho], components: [row1] });
        return interaction.editReply({ content: `✅ Seu carrinho foi criado com sucesso em <#${canalCarrinho.id}>!` });
      }
    }

    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === 'select_canal_logs') {
        const channelId = interaction.values[0];
        const guildId = interaction.guildId;
        if (!configServidor[guildId]) configServidor[guildId] = {};
        configServidor[guildId].logChannelId = channelId;
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', 'Canal de logs configurado com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'select_canal_voz') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) return interaction.reply({ embeds: [erro('Erro', 'Canal inválido.')], ephemeral: true });

        joinVoiceChannel({
          channelId: channel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        const timestamp = Math.floor(Date.now() / 1000);
        conexoesVoz[interaction.guildId] = { canalId: channel.id, timestamp };
        salvarDados();

        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎵 Bot Conectado').setDescription(`Canal: 🔊 ${channel.name}\nConectado há: <t:${timestamp}:R>`);
        const botoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('conectar_mudar').setLabel('Mudar de Call').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
          new ButtonBuilder().setCustomId('conectar_desconectar').setLabel('Desconectar').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
          new ButtonBuilder().setCustomId('conectar_fechar').setLabel('Fechar').setStyle(ButtonStyle.Secondary).setEmoji('❌')
        );
        return interaction.update({ embeds: [embed], components: [botoes] }).catch(() => interaction.reply({ embeds: [embed], components: [botoes], ephemeral: true }));
      }

      if (interaction.customId === 'select_canal_publicar_painel') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        const pData = painelTemp.get(interaction.user.id);
        if (!channel || !pData) return interaction.reply({ embeds: [erro('Erro', 'Dados inválidos.')], ephemeral: true });

        const embedFinal = new EmbedBuilder().setColor(pData.cor).setTitle(pData.titulo).setDescription(pData.descricao);
        let components = [];

        if (pData.modoExibicao === 'menu' && pData.produtosSelecionados.length > 0) {
          const options = pData.produtosSelecionados.map(id => {
            const prod = produtos[id];
            const disponivel = prod && prod.estoque > 0;
            return {
              label: prod ? prod.nome : 'Produto',
              value: id,
              description: disponivel ? `💰 Valor: ${formatarMoeda(prod.preco)} | 📦 Estoque: ${prod.estoque}` : `❌ Sem estoque disponível`,
              emoji: '📦'
            };
          });
          components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('comprar_menu_painel_global').setPlaceholder('Selecione um produto para comprar').addOptions(options)
          ));
        }

        const msgPainel = await channel.send({ embeds: [embedFinal], components });

        const panelId = Date.now().toString();
        painel[panelId] = {
          panelId, guildId: interaction.guildId, channelId: channel.id,
          messageId: msgPainel.id, titulo: pData.titulo, descricao: pData.descricao,
          modoExibicao: pData.modoExibicao, produtos: pData.produtosSelecionados
        };
        salvarDados();

        return interaction.reply({ embeds: [sucesso('Publicado', '✅ Painel publicado e salvo permanentemente.')], ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      const val = interaction.fields.getTextInputValue('val_input')?.trim();

      if (interaction.customId === 'modal_reestock_qtd') {
        const prodId = reestockTemp.get(interaction.user.id);
        const prod = produtos[prodId];
        if (!prod) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });

        const qtdAdicionar = parseInt(val) || 0;
        if (qtdAdicionar <= 0) {
          return interaction.reply({ embeds: [erro('Erro', 'Informe um número inteiro válido.')], ephemeral: true });
        }

        const estoqueAntigo = prod.estoque;
        prod.estoque += qtdAdicionar;
        salvarDados();
        reestockTemp.delete(interaction.user.id);

        // Enviar log de reestock no canal configurado
        await enviarLog(interaction.guild, 'Reestock realizado',
          `Produto:\n${prod.nome}\n\n` +
          `Estoque antigo:\n${estoqueAntigo}\n\n` +
          `Estoque adicionado:\n+${qtdAdicionar}\n\n` +
          `Novo estoque:\n${prod.estoque}\n\n` +
          `Responsável:\n${interaction.user}`
        );

        const embedSucesso = new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('🟢 Estoque atualizado')
          .setDescription(
            `Produto: ${prod.nome}\n` +
            `Estoque anterior: ${estoqueAntigo}\n` +
            `Adicionado: +${qtdAdicionar}\n` +
            `Estoque atual: ${prod.estoque}`
          );

        return interaction.reply({ embeds: [embedSucesso], ephemeral: true });
      }

      if (interaction.customId === 'modal_config_chave') {
        const guildId = interaction.guildId;
        if (!configServidor[guildId]) configServidor[guildId] = {};
        configServidor[guildId].pixKey = val;
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', 'Chave PIX configurada com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_config_nome') {
        const guildId = interaction.guildId;
        if (!configServidor[guildId]) configServidor[guildId] = {};
        configServidor[guildId].pixReceiverName = val;
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', 'Nome do recebedor salvo com sucesso.')], ephemeral: true });
      }

      if (interaction.customId.startsWith('modal_p_')) {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (!pTemp) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });

        if (interaction.customId === 'modal_p_nome') pTemp.nome = val;
        if (interaction.customId === 'modal_p_preco') pTemp.preco = parseFloat(val.replace(',', '.')) || 0;
        if (interaction.customId === 'modal_p_estoque') pTemp.estoque = parseInt(val) || 0;
        if (interaction.customId === 'modal_p_emoji') pTemp.emoji = val;
        if (interaction.customId === 'modal_p_desc') pTemp.desc = val;
        if (interaction.customId === 'modal_p_categoria') pTemp.categoria = val;
        if (interaction.customId === 'modal_p_banner') pTemp.imagem = val;

        return interaction.reply({ embeds: [sucesso('Sucesso', 'Atributo atualizado.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_perfil_nome') {
        await client.user.setUsername(val);
        return interaction.reply({ embeds: [sucesso('Sucesso', 'Nome atualizado.')], ephemeral: true });
      }
      if (interaction.customId === 'modal_perfil_avatar') {
        await client.user.setAvatar(val);
        return interaction.reply({ embeds: [sucesso('Sucesso', 'Avatar atualizado.')], ephemeral: true });
      }
    }

  } catch (err) {
    console.error('Erro na interação:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [erro('Erro', 'Ocorreu um erro interno.')], ephemeral: true }).catch(() => {});
    }
  }
});

// ==========================================
// 5. REGISTRO DE COMANDOS SLASH EXCLUSIVOS
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('config').setDescription('Painel de configurações do sistema'),
  new SlashCommandBuilder().setName('produto').setDescription('Gerenciamento de produtos').addSubcommand(sub => sub.setName('criar').setDescription('Criar produto')),
  new SlashCommandBuilder().setName('painel').setDescription('Painel de vendas').addSubcommand(sub => sub.setName('criar').setDescription('Criar painel')),
  new SlashCommandBuilder().setName('cupom').setDescription('Gerenciador de cupons'),
  new SlashCommandBuilder().setName('reestock').setDescription('Adicionar estoque a um produto'),
  new SlashCommandBuilder().setName('perfil').setDescription('Perfil do bot'),
  new SlashCommandBuilder().setName('conectar').setDescription('Gerenciar voz'),
  new SlashCommandBuilder().setName('ticket').setDescription('Sistema de tickets'),
  new SlashCommandBuilder().setName('palavras').setDescription('Filtro de palavras')
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
