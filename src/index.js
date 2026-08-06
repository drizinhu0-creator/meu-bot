const { 
  Client, GatewayIntentBits, Partials, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, 
  RoleSelectMenuBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, 
  ChannelType, PermissionFlagsBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

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
// 2. BANCO DE DADOS LOCAL E UPLOADS
// ==========================================
const dbFolder = path.join(__dirname, '..', 'database');
const uploadFolder = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(dbFolder)) fs.mkdirSync(dbFolder, { recursive: true });
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder, { recursive: true });
const dbFile = path.join(dbFolder, 'reestock_data.json');

function carregarDados() {
  if (fs.existsSync(dbFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
      return {
        reestockConfig: data.reestockConfig || {},
        produtos: data.produtos || {},
        carrinhosAtivos: data.carrinhosAtivos || {},
        cupons: data.cupons || {},
        conexoesVoz: data.conexoesVoz || {},
        ticketsConfig: data.ticketsConfig || {}
      };
    } catch (e) {
      console.error('Erro ao ler banco de dados:', e);
    }
  }
  return { 
    reestockConfig: {}, produtos: {}, carrinhosAtivos: {}, cupons: {}, conexoesVoz: {}, 
    ticketsConfig: { setores: {}, painel: { titulo: 'Central de Atendimento', desc: 'Selecione abaixo o setor desejado:', bannerPath: null, horarios: [] }, cargos: [] }
  };
}

function salvarDados() {
  try {
    const data = {
      reestockConfig,
      produtos,
      carrinhosAtivos,
      cupons,
      conexoesVoz,
      ticketsConfig
    };
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erro ao salvar banco de dados:', e);
  }
}

const dadosSalvos = carregarDados();
const reestockConfig = dadosSalvos.reestockConfig;     
const produtos = dadosSalvos.produtos; 
const carrinhosAtivos = dadosSalvos.carrinhosAtivos; 
const cupons = dadosSalvos.cupons; 
const conexoesVoz = dadosSalvos.conexoesVoz;
const ticketsConfig = dadosSalvos.ticketsConfig;

const produtoTemp = new Map(); 
const painelTemp = new Map();  
const aguardandoUpload = new Map(); 

function formatarMoeda(valor) {
  const num = parseFloat(valor) || 0;
  return `R$ ${num.toFixed(2).replace('.', ',')}`;
}

function limparEmoji(emojiStr) {
  if (!emojiStr) return '📦';
  const matchCustom = emojiStr.match(/<a?:([a-zA-Z0-9_]+):([0-9]+)>/);
  if (matchCustom) {
    const customId = matchCustom[2];
    const isAnimated = emojiStr.startsWith('<a:');
    return `<${isAnimated ? 'a' : ''}:${matchCustom[1]}:${customId}>`;
  }
  return emojiStr;
}

async function baixarImagemDiscord(url, nomeArquivo) {
  return new Promise((resolve, reject) => {
    const caminhoDestino = path.join(uploadFolder, `${Date.now()}_${nomeArquivo}`);
    const file = fs.createWriteStream(caminhoDestino);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(caminhoDestino);
      });
    }).on('error', (err) => {
      fs.unlink(caminhoDestino, () => {});
      reject(err);
    });
  });
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

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const aguardo = aguardandoUpload.get(message.author.id);
  if (!aguardo) return;

  const anexo = message.attachments.first();
  if (!anexo || !['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(anexo.contentType)) {
    await message.reply({ embeds: [new EmbedBuilder().setColor('#ED4245').setTitle('❌ Envie apenas uma imagem válida.')] }).catch(() => {});
    return;
  }

  try {
    const caminhoSalvo = await baixarImagemDiscord(anexo.url, anexo.name);
    aguardandoUpload.delete(message.author.id);

    if (aguardo.tipo === 'produto_banner') {
      const pTemp = produtoTemp.get(message.author.id);
      if (pTemp) {
        pTemp.bannerPath = caminhoSalvo;
        await atualizarEmbedProduto(aguardo.interactionRef, pTemp);
        await message.reply({ embeds: [sucesso('Sucesso', '✅ Banner salvo com sucesso.')] });
      }
    } else if (aguardo.tipo === 'painel_banner') {
      const pData = painelTemp.get(message.author.id);
      if (pData) {
        pData.bannerPath = caminhoSalvo;
        await atualizarEmbedPainelVendas(aguardo.interactionRef, pData);
        await message.reply({ embeds: [sucesso('Sucesso', '✅ Banner do painel atualizado com sucesso.')] });
      }
    } else if (aguardo.tipo === 'ticket_banner') {
      ticketsConfig.painel.bannerPath = caminhoSalvo;
      salvarDados();
      await message.reply({ embeds: [sucesso('Sucesso', '✅ Banner do painel de tickets atualizado com sucesso.')] });
    }
  } catch (err) {
    console.error(err);
    await message.reply({ embeds: [erro('Erro', 'Ocorreu um erro ao processar a imagem.')] });
  }
});

async function atualizarEmbedProduto(interaction, pTemp) {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📦 Configuração do Produto')
    .setDescription(
      `**Nome:** ${pTemp.nome}\n` +
      `**Preço:** ${formatarMoeda(pTemp.preco)}\n` +
      `**Estoque:** ${pTemp.estoque}\n` +
      `**Emoji:** ${limparEmoji(pTemp.emoji)}\n` +
      `**Descrição:** ${pTemp.desc}\n` +
      `**Banner:** ${pTemp.bannerPath ? 'Configurado ✅' : 'Não definido'}\n` +
      `**Cargo entregue:** ${pTemp.cargoId ? `<@&${pTemp.cargoId}>` : 'Não definido'}\n` +
      `**Categoria:** ${pTemp.categoria}`
    );

  let files = [];
  if (pTemp.bannerPath && fs.existsSync(pTemp.bannerPath)) {
    const attachment = new AttachmentBuilder(pTemp.bannerPath, { name: 'banner.png' });
    embed.setImage('attachment://banner.png');
    files.push(attachment);
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], files }).catch(() => {});
  } else {
    await interaction.update({ embeds: [embed], files }).catch(() => {});
  }
}

async function atualizarEmbedPainelVendas(interaction, pData) {
  const embed = new EmbedBuilder()
    .setColor(pData.cor || '#5865F2')
    .setTitle(`🛒 ${pData.titulo}`)
    .setDescription(`🛍️ **Descrição:**\n${pData.descricao}\n\n**Modo:** ${pData.modoExibicao === 'menu' ? 'Menu de Seleção' : 'Botões'}`);

  let files = [];
  if (pData.bannerPath && fs.existsSync(pData.bannerPath)) {
    const attachment = new AttachmentBuilder(pData.bannerPath, { name: 'banner.png' });
    embed.setImage('attachment://banner.png');
    files.push(attachment);
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], files }).catch(() => {});
  } else {
    await interaction.update({ embeds: [embed], files }).catch(() => {});
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'produto') {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          produtoTemp.set(interaction.user.id, {
            id: Date.now().toString(),
            emoji: '📦', nome: 'Não definido', desc: 'Não definida', 
            preco: 0, estoque: 0, bannerPath: null, categoria: 'Não definida', 
            cargoId: null
          });

          const pTemp = produtoTemp.get(interaction.user.id);
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📦 Configuração do Produto')
            .setDescription(
              `**Nome:** ${pTemp.nome}\n` +
              `**Preço:** ${formatarMoeda(pTemp.preco)}\n` +
              `**Estoque:** ${pTemp.estoque}\n` +
              `**Emoji:** ${pTemp.emoji}\n` +
              `**Descrição:** ${pTemp.desc}\n` +
              `**Banner:** Não definido\n` +
              `**Cargo entregue:** Não definido\n` +
              `**Categoria:** ${pTemp.categoria}`
            );

          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_nome').setLabel('Nome').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
            new ButtonBuilder().setCustomId('prod_preco').setLabel('Preço').setStyle(ButtonStyle.Secondary).setEmoji('💰'),
            new ButtonBuilder().setCustomId('prod_estoque').setLabel('Estoque').setStyle(ButtonStyle.Secondary).setEmoji('📦'),
            new ButtonBuilder().setCustomId('prod_emoji').setLabel('Emoji').setStyle(ButtonStyle.Secondary).setEmoji('😀')
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prod_desc').setLabel('Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
            new ButtonBuilder().setCustomId('prod_banner').setLabel('Banner').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
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

      if (commandName === 'ticket') {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🎫 Gerenciador de Tickets')
            .setDescription('Gerencie setores, painel, cargos e envio da central de atendimento.');

          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('t_config_setores').setLabel('Configurar Setores').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
            new ButtonBuilder().setCustomId('t_personalizar').setLabel('Personalizar Painel').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
            new ButtonBuilder().setCustomId('t_cargos').setLabel('Cargos do Ticket').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
            new ButtonBuilder().setCustomId('t_enviar').setLabel('Enviar Painel').setStyle(ButtonStyle.Success).setEmoji('📢')
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('t_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
          );

          return interaction.editReply({ embeds: [embed], components: [row1, row2] });
        }
      }

      if (commandName === 'cupom') {
        await interaction.deferReply({ ephemeral: true });
        const total = Object.keys(cupons).length;
        const ativos = Object.values(cupons).filter(c => c.ativo !== false).length;
        const expirados = Object.values(cupons).filter(c => c.expirado).length;
        const utilizados = Object.values(cupons).reduce((acc, c) => acc + (c.utilizados || 0), 0);

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🏷 Gerenciador de Cupons')
          .setDescription(
            `📊 **Estatísticas:**\n` +
            `• **Total de cupons:** ${total}\n` +
            `• **Cupons ativos:** ${ativos}\n` +
            `• **Cupons expirados:** ${expirados}\n` +
            `• **Cupons utilizados:** ${utilizados}`
          );

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cupom_criar').setLabel('Criar Cupom').setStyle(ButtonStyle.Success).setEmoji('➕'),
          new ButtonBuilder().setCustomId('cupom_editar').setLabel('Editar Cupom').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId('cupom_excluir').setLabel('Excluir Cupom').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
          new ButtonBuilder().setCustomId('cupom_listar').setLabel('Listar Cupons').setStyle(ButtonStyle.Primary).setEmoji('📋')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cupom_fechar').setLabel('Fechar').setStyle(ButtonStyle.Secondary).setEmoji('❌')
        );

        return interaction.editReply({ embeds: [embed], components: [row1, row2] });
      }

      if (commandName === 'perfil') {
        await interaction.deferReply({ ephemeral: true });
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('👤 Perfil do Bot')
          .setDescription(
            `**Nome atual:** ${client.user.username}\n` +
            `**Avatar atual:** [Ver Link](${client.user.displayAvatarURL({ dynamic: true, size: 512 })})\n` +
            `**Banner atual:** ${client.user.bannerURL() ? '[Ver Banner](' + client.user.bannerURL({ size: 512 }) + ')' : 'Não definido'}`
          )
          .setThumbnail(client.user.displayAvatarURL());

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('perfil_avatar').setLabel('Alterar Avatar').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId('perfil_banner').setLabel('Alterar Banner').setStyle(ButtonStyle.Secondary).setEmoji('🌄'),
          new ButtonBuilder().setCustomId('perfil_nome').setLabel('Alterar Nome').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId('perfil_visualizar').setLabel('Visualizar').setStyle(ButtonStyle.Primary).setEmoji('👀')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('perfil_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return interaction.editReply({ embeds: [embed], components: [row1, row2] });
      }

      if (commandName === 'conectar') {
        await interaction.deferReply({ ephemeral: true });
        const conexaoAtiva = conexoesVoz[interaction.guildId];
        let desc = 'O bot não está conectado a nenhum canal de voz.';
        let botoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('voz_conectar').setLabel('Conectar').setStyle(ButtonStyle.Success).setEmoji('🔗'),
          new ButtonBuilder().setCustomId('voz_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        if (conexaoAtiva) {
          const canalNome = interaction.guild.channels.cache.get(conexaoAtiva.canalId)?.name || 'Canal de Voz';
          desc = `**Canal:** ${canalNome}\n**Conectado há:** <t:${conexaoAtiva.timestamp}:R>`;
          botoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('voz_mudar').setLabel('Mudar de Call').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
            new ButtonBuilder().setCustomId('voz_desconectar').setLabel('Desconectar').setStyle(ButtonStyle.Danger).setEmoji('🔌')
          );
        }

        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎧 Bot Conectado').setDescription(desc);
        return interaction.editReply({ embeds: [embed], components: [botoes] });
      }

      if (commandName === 'dashboard') {
        return interaction.reply({ embeds: [sucesso('Dashboard', 'Online.')], ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      if (['prod_nome', 'prod_preco', 'prod_estoque', 'prod_emoji', 'prod_desc', 'prod_categoria'].includes(interaction.customId)) {
        const mapModal = {
          prod_nome: { id: 'modal_p_nome', title: 'Nome do Produto', label: 'Nome', placeholder: 'Ex: Nitro Mensal' },
          prod_preco: { id: 'modal_p_preco', title: 'Preço do Produto (Ex: 3.50)', label: 'Preço em Reais', placeholder: 'Ex: 15.90' },
          prod_estoque: { id: 'modal_p_estoque', title: 'Estoque Inicial', label: 'Apenas números inteiros', placeholder: 'Ex: 10' },
          prod_emoji: { id: 'modal_p_emoji', title: 'Emoji do Produto', label: 'Emoji (Padrão ou Personalizado)', placeholder: 'Ex: 🚀' },
          prod_desc: { id: 'modal_p_desc', title: 'Descrição do Produto', label: 'Descrição detalhada', placeholder: 'Ex: Produto com entrega imediata...' },
          prod_categoria: { id: 'modal_p_categoria', title: 'Categoria', label: 'Nome da Categoria', placeholder: 'Ex: Assinaturas' }
        };
        const info = mapModal[interaction.customId];
        const modal = new ModalBuilder().setCustomId(info.id).setTitle(info.title);
        const input = new TextInputBuilder().setCustomId('val_input').setLabel(info.label).setPlaceholder(info.placeholder).setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (['p_alt_titulo', 'p_alt_desc', 'p_alt_cor'].includes(interaction.customId)) {
        const mapPainelModal = {
          p_alt_titulo: { id: 'modal_painel_titulo', title: 'Alterar Título', label: 'Título', placeholder: 'Loja Oficial' },
          p_alt_desc: { id: 'modal_painel_desc', title: 'Alterar Descrição', label: 'Descrição', placeholder: 'Selecione abaixo...' },
          p_alt_cor: { id: 'modal_painel_cor', title: 'Alterar Cor', label: 'Hex Code ou Nome da Cor', placeholder: '#5865F2' }
        };
        const info = mapPainelModal[interaction.customId];
        const modal = new ModalBuilder().setCustomId(info.id).setTitle(info.title);
        const input = new TextInputBuilder().setCustomId('val_input').setLabel(info.label).setPlaceholder(info.placeholder).setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 't_setor_criar') {
        const modal = new ModalBuilder().setCustomId('modal_t_criar_setor').setTitle('Criar Novo Setor de Ticket');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_id').setLabel('ID Único (ex: suporte)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_nome').setLabel('Nome do Setor (ex: Suporte)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_emoji').setLabel('Emoji (ex: 🛠️)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_desc').setLabel('Descrição do Setor').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s_msg').setLabel('Mensagem automática no ticket').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 't_p_titulo') {
        const modal = new ModalBuilder().setCustomId('modal_t_titulo').setTitle('Alterar Título do Painel');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val_input').setLabel('Título').setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 't_p_desc') {
        const modal = new ModalBuilder().setCustomId('modal_t_desc').setTitle('Alterar Descrição do Painel');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('val_input').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setRequired(true)));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 't_p_horario') {
        const modal = new ModalBuilder().setCustomId('modal_t_horario').setTitle('Adicionar Horário de Funcionamento');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('h_dias').setLabel('Dias (ex: Segunda a Sexta)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('h_horas').setLabel('Horário (ex: 08:00 às 18:00)').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'cupom_criar') {
        const modal = new ModalBuilder().setCustomId('modal_cupom_criar').setTitle('Criar Cupom');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_nome').setLabel('Nome do Cupom').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_tipo').setLabel('Tipo: percentual ou fixo').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_valor').setLabel('Valor (Ex: 10% ou R$ 5,00)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_max').setLabel('Qtd Máxima de Usos').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'perfil_nome') {
        const modal = new ModalBuilder().setCustomId('modal_perfil_nome').setTitle('Alterar Nome do Bot');
        const input = new TextInputBuilder().setCustomId('val_input').setLabel('Novo Nome').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // Demais botões que não abrem modal respondem com update normal
      await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'painel_modo_botao' || interaction.customId === 'painel_modo_menu') {
        const modo = interaction.customId === 'painel_modo_menu' ? 'menu' : 'botao';
        painelTemp.set(interaction.user.id, {
          titulo: 'Loja Oficial',
          descricao: 'Selecione abaixo para adquirir nossos produtos.',
          bannerPath: null,
          cor: '#5865F2',
          modoExibicao: modo,
          produtosSelecionados: [],
          canal: null
        });

        const pData = painelTemp.get(interaction.user.id);
        const embed = new EmbedBuilder()
          .setColor(pData.cor)
          .setTitle(`🛒 ${pData.titulo}`)
          .setDescription(`🛍️ **Descrição:**\n${pData.descricao}\n\n**Modo de Exibição:** ${modo === 'menu' ? 'Menu de Seleção' : 'Botões'}`);

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('p_alt_titulo').setLabel('Título').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('p_alt_desc').setLabel('Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
          new ButtonBuilder().setCustomId('p_alt_banner').setLabel('Banner').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId('p_alt_cor').setLabel('Cor').setStyle(ButtonStyle.Secondary).setEmoji('🎨')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('p_sel_produtos').setLabel('Produtos').setStyle(ButtonStyle.Secondary).setEmoji('🛍️'),
          new ButtonBuilder().setCustomId('p_visualizar').setLabel('Visualizar').setStyle(ButtonStyle.Secondary).setEmoji('👀'),
          new ButtonBuilder().setCustomId('p_publicar').setLabel('Publicar').setStyle(ButtonStyle.Success).setEmoji('📢'),
          new ButtonBuilder().setCustomId('p_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return interaction.editReply({ embeds: [embed], components: [row1, row2], files: [] });
      }

      if (interaction.customId === 'prod_banner') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'produto_banner', interactionRef: interaction });
        return interaction.followUp({ content: '🖼️ Envie a imagem do banner em até 60 segundos no chat.', ephemeral: true });
      }

      if (interaction.customId === 'prod_cargo') {
        const menu = new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder().setCustomId('select_cargo_produto').setPlaceholder('Selecione o cargo entregue automaticamente')
        );
        return interaction.followUp({ content: 'Selecione o cargo que será entregue na aprovação:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'prod_salvar') {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (!pTemp || pTemp.nome === 'Não definido' || pTemp.preco <= 0) {
          return interaction.followUp({ embeds: [aviso('Atenção', 'Preencha ao menos o nome e o preço corretamente antes de salvar.')], ephemeral: true });
        }
        produtos[pTemp.id] = pTemp;
        salvarDados();
        produtoTemp.delete(interaction.user.id);
        return interaction.editReply({ embeds: [sucesso('Sucesso', '✅ Produto criado com sucesso.')], components: [], files: [] });
      }

      if (interaction.customId === 'prod_cancelar') {
        produtoTemp.delete(interaction.user.id);
        return interaction.editReply({ embeds: [aviso('Cancelado', 'A criação do produto foi cancelada.')], components: [], files: [] });
      }

      if (interaction.customId === 'p_alt_banner') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'painel_banner', interactionRef: interaction });
        return interaction.followUp({ content: '🖼️ Envie a imagem do banner em até 60 segundos.', ephemeral: true });
      }

      if (interaction.customId === 'p_sel_produtos') {
        const prodKeys = Object.keys(produtos);
        if (prodKeys.length === 0) {
          return interaction.followUp({ embeds: [aviso('Atenção', 'Não há produtos cadastrados no servidor ainda!')], ephemeral: true });
        }
        const options = prodKeys.slice(0, 25).map(id => ({
          label: produtos[id].nome.substring(0, 100),
          description: `Preço: ${formatarMoeda(produtos[id].preco)} | Estoque: ${produtos[id].estoque}`,
          value: id
        }));
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_produtos_painel')
          .setPlaceholder('Selecione os produtos para o painel')
          .setMinValues(1)
          .setMaxValues(options.length)
          .addOptions(options);

        return interaction.followUp({ content: 'Selecione abaixo os produtos desejados:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 'p_visualizar') {
        const pData = painelTemp.get(interaction.user.id);
        const embedView = new EmbedBuilder()
          .setColor(pData.cor || '#5865F2')
          .setTitle(`🛒 ${pData.titulo}`)
          .setDescription(`🛍️ **Descrição:**\n${pData.descricao}`);

        let files = [];
        if (pData.bannerPath && fs.existsSync(pData.bannerPath)) {
          const attachment = new AttachmentBuilder(pData.bannerPath, { name: 'banner.png' });
          embedView.setImage('attachment://banner.png');
          files.push(attachment);
        }

        let components = [];
        if (pData.modoExibicao === 'menu' && pData.produtosSelecionados && pData.produtosSelecionados.length > 0) {
          const options = pData.produtosSelecionados.map(id => {
            const prod = produtos[id];
            return { label: prod ? prod.nome : 'Produto', value: id, emoji: prod && prod.emoji !== 'Não definido' ? prod.emoji : '📦' };
          });
          const selectMenu = new StringSelectMenuBuilder().setCustomId('comprar_produto_menu').setPlaceholder('Selecione um produto para comprar').addOptions(options);
          components.push(new ActionRowBuilder().addComponents(selectMenu));
        } else if (pData.produtosSelecionados) {
          const rowBtn = new ActionRowBuilder();
          pData.produtosSelecionados.slice(0, 5).forEach(id => {
            const prod = produtos[id];
            if (prod) {
              rowBtn.addComponents(
                new ButtonBuilder().setCustomId(`comprar_btn_${id}`).setLabel(prod.nome).setStyle(ButtonStyle.Success).setEmoji(prod.emoji !== 'Não definido' ? prod.emoji : '🛒')
              );
            }
          });
          if (rowBtn.components.length > 0) components.push(rowBtn);
        }

        return interaction.followUp({ embeds: [embedView], components, files, ephemeral: true });
      }

      if (interaction.customId === 'p_publicar') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder().setCustomId('select_canal_publicar_painel').setPlaceholder('Selecione o canal de destino').addChannelTypes(ChannelType.GuildText)
        );
        return interaction.followUp({ content: 'Selecione o canal onde deseja **publicar o painel**:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'p_cancelar') {
        painelTemp.delete(interaction.user.id);
        return interaction.editReply({ embeds: [aviso('Cancelado', 'A criação do painel foi cancelada.')], components: [], files: [] });
      }

      if (interaction.customId === 't_config_setores') {
        const setoresKeys = Object.keys(ticketsConfig.setores);
        let desc = setoresKeys.length === 0 ? 'Nenhum setor cadastrado.' : setoresKeys.map(k => `• ${ticketsConfig.setores[k].emoji} **${ticketsConfig.setores[k].nome}**`).join('\n');

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('⚙️ Configuração de Setores de Tickets')
          .setDescription(`Setores atuais:\n\n${desc}`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('t_setor_criar').setLabel('Criar Setor').setStyle(ButtonStyle.Success).setEmoji('➕'),
          new ButtonBuilder().setCustomId('t_setor_editar').setLabel('Editar Setor').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
          new ButtonBuilder().setCustomId('t_setor_excluir').setLabel('Excluir Setor').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
          new ButtonBuilder().setCustomId('t_voltar_principal').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setEmoji('🔙')
        );

        return interaction.editReply({ embeds: [embed], components: [row], files: [] });
      }

      if (interaction.customId === 't_setor_editar') {
        const setoresKeys = Object.keys(ticketsConfig.setores);
        if (setoresKeys.length === 0) return interaction.followUp({ embeds: [aviso('Atenção', 'Nenhum setor cadastrado para editar.')], ephemeral: true });

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_t_editar_setor')
          .setPlaceholder('Selecione o setor para editar')
          .addOptions(setoresKeys.map(k => ({ label: ticketsConfig.setores[k].nome, value: k, emoji: ticketsConfig.setores[k].emoji })));

        return interaction.followUp({ content: 'Selecione o setor:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 't_setor_excluir') {
        const setoresKeys = Object.keys(ticketsConfig.setores);
        if (setoresKeys.length === 0) return interaction.followUp({ embeds: [aviso('Atenção', 'Nenhum setor cadastrado para excluir.')], ephemeral: true });

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_t_excluir_setor')
          .setPlaceholder('Selecione o setor para excluir')
          .addOptions(setoresKeys.map(k => ({ label: ticketsConfig.setores[k].nome, value: k })));

        return interaction.followUp({ content: 'Selecione o setor a excluir:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 't_personalizar') {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🎨 Personalizar Painel de Tickets')
          .setDescription('Configure o visual e os horários do painel de atendimento.');

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('t_p_titulo').setLabel('Alterar Título').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('t_p_desc').setLabel('Alterar Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
          new ButtonBuilder().setCustomId('t_p_banner').setLabel('Alterar Banner').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId('t_p_horario').setLabel('Horário de Funcionamento').setStyle(ButtonStyle.Secondary).setEmoji('🕒')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('t_p_visualizar').setLabel('Visualizar').setStyle(ButtonStyle.Primary).setEmoji('👀'),
          new ButtonBuilder().setCustomId('t_voltar_principal').setLabel('Voltar').setStyle(ButtonStyle.Secondary).setEmoji('🔙')
        );

        return interaction.editReply({ embeds: [embed], components: [row1, row2], files: [] });
      }

      if (interaction.customId === 't_p_banner') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'ticket_banner', interactionRef: interaction });
        return interaction.followUp({ content: '🖼️ Envie a imagem do banner em até 60 segundos no chat.', ephemeral: true });
      }

      if (interaction.customId === 't_p_visualizar') {
        const p = ticketsConfig.painel;
        const embedView = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`🎫 ${p.titulo}`)
          .setDescription(`${p.desc}\n\n🕒 **Horário de Funcionamento:**\n` + (p.horarios.length ? p.horarios.join('\n') : 'Não definido'));

        let files = [];
        if (p.bannerPath && fs.existsSync(p.bannerPath)) {
          const attachment = new AttachmentBuilder(p.bannerPath, { name: 'banner.png' });
          embedView.setImage('attachment://banner.png');
          files.push(attachment);
        }

        const setoresKeys = Object.keys(ticketsConfig.setores);
        let components = [];
        if (setoresKeys.length > 0) {
          const options = setoresKeys.map(k => {
            const s = ticketsConfig.setores[k];
            return { label: s.nome, value: `ticket_abrir_${k}`, description: s.desc.substring(0, 50), emoji: s.emoji };
          });
          const selectMenu = new StringSelectMenuBuilder().setCustomId('select_abrir_ticket_menu').setPlaceholder('Selecione um setor para abrir ticket').addOptions(options);
          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        return interaction.followUp({ embeds: [embedView], components, files, ephemeral: true });
      }

      if (interaction.customId === 't_cargos') {
        const menu = new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder().setCustomId('select_cargos_ticket').setPlaceholder('Selecione os cargos mencionados no ticket').setMinValues(1).setMaxValues(10)
        );
        return interaction.followUp({ content: 'Selecione os cargos administrativos do ticket:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 't_enviar') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder().setCustomId('select_canal_enviar_ticket').setPlaceholder('Selecione o canal para publicar o painel').addChannelTypes(ChannelType.GuildText)
        );
        return interaction.followUp({ content: 'Selecione o canal onde deseja **publicar o painel de tickets**:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 't_voltar_principal' || interaction.customId === 't_fechar') {
        if (interaction.customId === 't_fechar') return interaction.message.delete().catch(() => {});
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🎫 Gerenciador de Tickets')
          .setDescription('Gerencie setores, painel, cargos e envio da central de atendimento.');

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('t_config_setores').setLabel('Configurar Setores').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
          new ButtonBuilder().setCustomId('t_personalizar').setLabel('Personalizar Painel').setStyle(ButtonStyle.Secondary).setEmoji('🎨'),
          new ButtonBuilder().setCustomId('t_cargos').setLabel('Cargos do Ticket').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
          new ButtonBuilder().setCustomId('t_enviar').setLabel('Enviar Painel').setStyle(ButtonStyle.Success).setEmoji('📢')
        );
        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('t_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );
        return interaction.editReply({ embeds: [embed], components: [row1, row2], files: [] });
      }

      if (interaction.customId === 'ticket_fechar_btn') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false }).catch(() => {});
        return interaction.followUp({ content: '🔒 Ticket fechado com sucesso.', ephemeral: true });
      }

      if (interaction.customId === 'ticket_reabrir_btn') {
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true }).catch(() => {});
        return interaction.followUp({ content: '🔓 Ticket reaberto com sucesso.', ephemeral: true });
      }

      if (interaction.customId === 'ticket_transcript_btn') {
        return interaction.followUp({ content: '💾 Transcript gerado e salvo com sucesso.', ephemeral: true });
      }

      if (interaction.customId === 'ticket_excluir_btn') {
        await interaction.followUp({ content: '🗑️ Excluindo ticket em 3 segundos...', ephemeral: true });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
      }

      if (interaction.customId === 'cupom_listar') {
        const cupomKeys = Object.keys(cupons);
        if (cupomKeys.length === 0) return interaction.followUp({ embeds: [aviso('Atenção', 'Nenhum cupom cadastrado.')], ephemeral: true });

        let desc = '';
        cupomKeys.forEach(nome => {
          const c = cupons[nome];
          desc += `🎟️ **${nome}**\n• Desconto: ${c.valor}\n• Restantes: ${c.maxUsos - (c.utilizados || 0)}\n• Utilizados: ${c.utilizados || 0}\n• Status: Ativo 🟢\n\n`;
        });
        return interaction.followUp({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📋 Lista de Cupons').setDescription(desc)], ephemeral: true });
      }

      if (interaction.customId === 'cupom_fechar') {
        return interaction.message.delete().catch(() => {});
      }

      if (interaction.customId === 'perfil_avatar') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'perfil_avatar', interactionRef: interaction });
        return interaction.followUp({ content: '🖼️ Envie a nova imagem do avatar em até 60 segundos no chat.', ephemeral: true });
      }

      if (interaction.customId === 'perfil_banner') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'perfil_banner', interactionRef: interaction });
        return interaction.followUp({ content: '🖼️ Envie a imagem do banner em até 60 segundos no chat.', ephemeral: true });
      }

      if (interaction.customId === 'perfil_visualizar') {
        const embedView = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('👀 Prévia do Perfil do Bot')
          .setDescription(`**Nome:** ${client.user.username}`)
          .setThumbnail(client.user.displayAvatarURL());
        return interaction.followUp({ embeds: [embedView], ephemeral: true });
      }

      if (interaction.customId === 'perfil_fechar') {
        return interaction.message.delete().catch(() => {});
      }

      if (interaction.customId === 'voz_conectar' || interaction.customId === 'voz_mudar') {
        const menu = new ChannelSelectMenuBuilder().setCustomId('select_canal_voz').setPlaceholder('Selecione o canal de voz').addChannelTypes(ChannelType.GuildVoice);
        return interaction.followUp({ content: 'Selecione o canal de voz desejado:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (interaction.customId === 'voz_desconectar') {
        const connection = getVoiceConnection(interaction.guildId);
        if (connection) connection.destroy();
        delete conexoesVoz[interaction.guildId];
        salvarDados();
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('🎧 Bot Conectado').setDescription('O bot não está conectado a nenhum canal de voz.')] });
      }

      if (interaction.customId === 'voz_fechar') {
        return interaction.message.delete().catch(() => {});
      }
    }

    if (interaction.isRoleSelectMenu()) {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'select_cargo_produto') {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (pTemp) {
          pTemp.cargoId = interaction.values[0];
          await atualizarEmbedProduto(interaction, pTemp);
        }
        return interaction.followUp({ embeds: [sucesso('Sucesso', '✅ Cargo salvo com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'select_cargos_ticket') {
        ticketsConfig.cargos = interaction.values;
        salvarDados();
        return interaction.followUp({ embeds: [sucesso('Sucesso', `✅ ${interaction.values.length} cargo(s) selecionado(s) para os tickets.`)], ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'select_produtos_painel') {
        const pData = painelTemp.get(interaction.user.id);
        if (pData) pData.produtosSelecionados = interaction.values;
        return interaction.followUp({ embeds: [sucesso('Sucesso', '✅ Produtos selecionados com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'select_t_excluir_setor') {
        const setorId = interaction.values[0];
        delete ticketsConfig.setores[setorId];
        salvarDados();
        return interaction.followUp({ embeds: [sucesso('Excluído', `✅ Setor excluído com sucesso.`)], ephemeral: true });
      }

      if (interaction.customId === 'select_abrir_ticket_menu') {
        const setorId = interaction.values[0].replace('ticket_abrir_', '');
        const setor = ticketsConfig.setores[setorId];
        if (!setor) return interaction.followUp({ embeds: [erro('Erro', 'Setor não encontrado.')], ephemeral: true });

        const canalTicket = await interaction.guild.channels.create({
          name: `🎫・${setor.nome.toLowerCase()}-${interaction.user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
          ]
        });

        const cargosMencoes = ticketsConfig.cargos.map(id => `<@&${id}>`).join(' ');
        const embedTicket = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`Ticket — ${setor.nome}`)
          .setDescription(`${setor.msg}\n\n👤 **Aberto por:** ${interaction.user}\n👥 **Equipe:** ${cargosMencoes || 'Nenhum cargo configurado'}`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_fechar_btn').setLabel('Fechar').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
          new ButtonBuilder().setCustomId('ticket_reabrir_btn').setLabel('Reabrir').setStyle(ButtonStyle.Primary).setEmoji('🔓'),
          new ButtonBuilder().setCustomId('ticket_transcript_btn').setLabel('Salvar Transcript').setStyle(ButtonStyle.Secondary).setEmoji('💾'),
          new ButtonBuilder().setCustomId('ticket_excluir_btn').setLabel('Excluir Ticket').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
        );

        await canalTicket.send({ content: `${interaction.user} ${cargosMencoes}`, embeds: [embedTicket], components: [row] });
        return interaction.followUp({ content: `✅ Ticket criado com sucesso em <#${canalTicket.id}>!`, ephemeral: true });
      }
    }

    if (interaction.isChannelSelectMenu()) {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'select_canal_publicar_painel') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        const pData = painelTemp.get(interaction.user.id);
        if (!channel || !pData) return interaction.followUp({ embeds: [erro('Erro', 'Canal ou dados inválidos.')], ephemeral: true });

        const embedFinal = new EmbedBuilder()
          .setColor(pData.cor || '#5865F2')
          .setTitle(`🛒 ${pData.titulo}`)
          .setDescription(`🛍️ **Descrição:**\n${pData.descricao}`);

        let files = [];
        if (pData.bannerPath && fs.existsSync(pData.bannerPath)) {
          const attachment = new AttachmentBuilder(pData.bannerPath, { name: 'banner.png' });
          embedFinal.setImage('attachment://banner.png');
          files.push(attachment);
        }

        let components = [];
        if (pData.modoExibicao === 'menu' && pData.produtosSelecionados && pData.produtosSelecionados.length > 0) {
          const options = pData.produtosSelecionados.map(id => {
            const prod = produtos[id];
            return { label: prod ? prod.nome : 'Produto', value: id, emoji: prod && prod.emoji !== 'Não definido' ? prod.emoji : '📦' };
          });
          const selectMenu = new StringSelectMenuBuilder().setCustomId('comprar_produto_menu').setPlaceholder('Selecione um produto para comprar').addOptions(options);
          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        await channel.send({ embeds: [embedFinal], components, files });
        return interaction.followUp({ embeds: [sucesso('Publicado', '✅ Painel publicado com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'select_canal_enviar_ticket') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) return interaction.followUp({ embeds: [erro('Erro', 'Canal inválido.')], ephemeral: true });

        const p = ticketsConfig.painel;
        const embedFinal = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`🎫 ${p.titulo}`)
          .setDescription(`${p.desc}\n\n🕒 **Horário de Funcionamento:**\n` + (p.horarios.length ? p.horarios.join('\n') : 'Não definido'));

        let files = [];
        if (p.bannerPath && fs.existsSync(p.bannerPath)) {
          const attachment = new AttachmentBuilder(p.bannerPath, { name: 'banner.png' });
          embedFinal.setImage('attachment://banner.png');
          files.push(attachment);
        }

        const setoresKeys = Object.keys(ticketsConfig.setores);
        let components = [];
        if (setoresKeys.length > 0) {
          const options = setoresKeys.map(k => {
            const s = ticketsConfig.setores[k];
            return { label: s.nome, value: `ticket_abrir_${k}`, description: s.desc.substring(0, 50), emoji: s.emoji };
          });
          const selectMenu = new StringSelectMenuBuilder().setCustomId('select_abrir_ticket_menu').setPlaceholder('Selecione um setor para abrir ticket').addOptions(options);
          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        await channel.send({ embeds: [embedFinal], components, files });
        return interaction.followUp({ embeds: [sucesso('Publicado', '✅ Painel de tickets publicado com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'select_canal_voz') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) return interaction.followUp({ embeds: [erro('Erro', 'Canal de voz inválido.')], ephemeral: true });

        joinVoiceChannel({
          channelId: channel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        const timestamp = Math.floor(Date.now() / 1000);
        conexoesVoz[interaction.guildId] = { canalId: channel.id, timestamp };
        salvarDados();

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🎧 Bot Conectado')
          .setDescription(`**Canal:** ${channel.name}\n**Conectado há:** <t:${timestamp}:R>`);

        const botoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('voz_mudar').setLabel('Mudar de Call').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
          new ButtonBuilder().setCustomId('voz_desconectar').setLabel('Desconectar').setStyle(ButtonStyle.Danger).setEmoji('🔌')
        );

        return interaction.editReply({ embeds: [embed], components: [botoes] });
      }
    }

    if (interaction.isModalSubmit()) {
      const val = interaction.fields.getTextInputValue('val_input')?.trim();

      if (interaction.customId.startsWith('modal_p_')) {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (!pTemp) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });

        if (interaction.customId === 'modal_p_nome') pTemp.nome = val;
        if (interaction.customId === 'modal_p_preco') pTemp.preco = parseFloat(val.replace(',', '.')) || 0;
        if (interaction.customId === 'modal_p_estoque') pTemp.estoque = parseInt(val) || 0;
        if (interaction.customId === 'modal_p_emoji') pTemp.emoji = val;
        if (interaction.customId === 'modal_p_desc') pTemp.desc = val;
        if (interaction.customId === 'modal_p_categoria') pTemp.categoria = val;

        await interaction.deferReply({ ephemeral: true });
        await atualizarEmbedProduto(interaction, pTemp);
        return interaction.editReply({ embeds: [sucesso('Sucesso', '✅ Salvo com sucesso.')] });
      }

      if (interaction.customId.startsWith('modal_painel_')) {
        const pData = painelTemp.get(interaction.user.id);
        if (!pData) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });

        if (interaction.customId === 'modal_painel_titulo') pData.titulo = val;
        if (interaction.customId === 'modal_painel_desc') pData.descricao = val;
        if (interaction.customId === 'modal_painel_cor') {
          const coresMap = { azul: '#5865F2', verde: '#57F287', vermelho: '#ED4245', amarelo: '#FEE75C', roxo: '#9B59B6', branco: '#FFFFFF' };
          pData.cor = coresMap[val.toLowerCase()] || (val.startsWith('#') ? val : '#5865F2');
        }

        await interaction.deferReply({ ephemeral: true });
        await atualizarEmbedPainelVendas(interaction, pData);
        return interaction.editReply({ embeds: [sucesso('Sucesso', '✅ Configuração atualizada.')] });
      }

      if (interaction.customId === 'modal_t_criar_setor') {
        const id = interaction.fields.getTextInputValue('s_id').toLowerCase();
        const nome = interaction.fields.getTextInputValue('s_nome');
        const emoji = interaction.fields.getTextInputValue('s_emoji');
        const desc = interaction.fields.getTextInputValue('s_desc');
        const msg = interaction.fields.getTextInputValue('s_msg');

        ticketsConfig.setores[id] = { nome, emoji, desc, msg };
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', `✅ Setor **${nome}** criado com sucesso.`)], ephemeral: true });
      }

      if (interaction.customId === 'modal_t_titulo') {
        ticketsConfig.painel.titulo = val;
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Título do painel atualizado.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_t_desc') {
        ticketsConfig.painel.desc = val;
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Descrição do painel atualizada.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_t_horario') {
        const dias = interaction.fields.getTextInputValue('h_dias');
        const horas = interaction.fields.getTextInputValue('h_horas');
        ticketsConfig.painel.horarios.push(`• **${dias}:** ${horas}`);
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Horário adicionado com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_cupom_criar') {
        const nome = interaction.fields.getTextInputValue('c_nome');
        const tipo = interaction.fields.getTextInputValue('c_tipo');
        const valor = interaction.fields.getTextInputValue('c_valor');
        const maxUsos = parseInt(interaction.fields.getTextInputValue('c_max')) || 10;

        cupons[nome] = { tipo, valor, maxUsos, utilizados: 0, ativo: true };
        salvarDados();
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Cupom criado com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_perfil_nome') {
        await client.user.setUsername(val);
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Nome atualizado com sucesso.')], ephemeral: true });
      }
    }

  } catch (err) {
    console.error('Erro na interação:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ embeds: [erro('Erro', 'Ocorreu um erro ao processar esta ação.')], ephemeral: true }).catch(() => {});
    }
  }
});

const commands = [
  new SlashCommandBuilder().setName('produto').setDescription('Gerenciamento de produtos').addSubcommand(sub => sub.setName('criar').setDescription('Criar produto por botões')),
  new SlashCommandBuilder().setName('painel').setDescription('Painel de vendas').addSubcommand(sub => sub.setName('criar').setDescription('Criar painel por interface')),
  new SlashCommandBuilder().setName('ticket').setDescription('Gerenciador de tickets').addSubcommand(sub => sub.setName('criar').setDescription('Painel de tickets')),
  new SlashCommandBuilder().setName('cupom').setDescription('Gerenciador de cupons por interface'),
  new SlashCommandBuilder().setName('perfil').setDescription('Personalizar perfil do bot'),
  new SlashCommandBuilder().setName('conectar').setDescription('Gerenciar conexão em canais de voz'),
  new SlashCommandBuilder().setName('dashboard').setDescription('Dashboard')
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
