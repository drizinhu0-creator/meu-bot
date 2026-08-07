const { 
  Client, GatewayIntentBits, Partials, ActionRowBuilder, 
  ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, 
  RoleSelectMenuBuilder, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, 
  ChannelType, PermissionFlagsBits, EmbedBuilder, REST, Routes, SlashCommandBuilder 
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
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
// 2. BANCO DE DADOS LOCAL
// ==========================================
const dbFolder = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbFolder)) fs.mkdirSync(dbFolder, { recursive: true });
const dbFile = path.join(dbFolder, 'reestock_data.json');

function carregarDados() {
  if (fs.existsSync(dbFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
      return {
        configGeral: data.configGeral || { pixKey: null, logChannelId: null },
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
    configGeral: { pixKey: null, logChannelId: null }, 
    produtos: {}, carrinhosAtivos: {}, cupons: {}, conexoesVoz: {}, 
    ticketsConfig: { setores: {}, painel: { titulo: 'Central de Atendimento', desc: 'Selecione abaixo o setor desejado:', bannerUrl: null, horarios: [] }, cargos: [] }
  };
}

function salvarDados() {
  try {
    const data = { configGeral, produtos, carrinhosAtivos, cupons, conexoesVoz, ticketsConfig };
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Erro ao salvar banco de dados:', e);
  }
}

const dadosSalvos = carregarDados();
const configGeral = dadosSalvos.configGeral;
const produtos = dadosSalvos.produtos; 
const carrinhosAtivos = dadosSalvos.carrinhosAtivos; 
const cupons = dadosSalvos.cupons; 
const conexoesVoz = dadosSalvos.conexoesVoz;
const ticketsConfig = dadosSalvos.ticketsConfig;

const produtoTemp = new Map(); 
const painelTemp = new Map();  
const carrinhoSessao = new Map(); // Armazena quantidade, cupom aplicado, etc. por userId

function formatarMoeda(valor) {
  const num = parseFloat(valor) || 0;
  return `R$ ${num.toFixed(2).replace('.', ',')}`;
}

async function enviarLog(guild, titulo, desc) {
  if (!configGeral.logChannelId) return;
  const canalLog = guild.channels.cache.get(configGeral.logChannelId);
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

async function atualizarEmbedProduto(interaction, pTemp) {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📦 Configuração do Produto')
    .setDescription(
      `**Nome:** ${pTemp.nome}\n` +
      `**Preço:** ${formatarMoeda(pTemp.preco)}\n` +
      `**Estoque:** ${pTemp.estoque}\n` +
      `**Emoji:** ${pTemp.emoji || 'Nenhum'}\n` +
      `**Descrição:** ${pTemp.desc || 'Nenhuma'}\n` +
      `**Banner:** ${pTemp.bannerUrl ? 'Configurado ✅' : 'Não definido'}\n` +
      `**Cargo entregue:** ${pTemp.cargoId ? `<@&${pTemp.cargoId}>` : 'Não definido'}\n` +
      `**Categoria:** ${pTemp.categoria}`
    );

  if (pTemp.bannerUrl) {
    embed.setImage(pTemp.bannerUrl);
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed] }).catch(() => {});
  } else {
    await interaction.update({ embeds: [embed] }).catch(() => {});
  }
}

async function atualizarEmbedPainelVendas(interaction, pData) {
  const embed = new EmbedBuilder()
    .setColor(pData.cor || '#5865F2')
    .setTitle(`${pData.titulo}`)
    .setDescription(`${pData.descricao}`);

  if (pData.bannerUrl) {
    embed.setImage(pData.bannerUrl);
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed] }).catch(() => {});
  } else {
    await interaction.update({ embeds: [embed] }).catch(() => {});
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'config') {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        if (sub === 'pix') {
          const chave = interaction.options.getString('chave');
          configGeral.pixKey = chave;
          salvarDados();
          return interaction.editReply({ embeds: [sucesso('Chave PIX', `Chave PIX configurada com sucesso:\n\`${chave}\``)] });
        }
        if (sub === 'log') {
          const canal = interaction.options.getChannel('canal');
          configGeral.logChannelId = canal.id;
          salvarDados();
          return interaction.editReply({ embeds: [sucesso('Canal de Logs', `Canal de logs definido para ${canal}`)] });
        }
      }

      if (commandName === 'produto') {
        await interaction.deferReply({ ephemeral: true });
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          produtoTemp.set(interaction.user.id, {
            id: Date.now().toString(),
            emoji: '', nome: '', desc: '', 
            preco: 0, estoque: 0, bannerUrl: null, categoria: 'Geral', 
            cargoId: null
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
              `**Banner:** Não definido\n` +
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
            new ButtonBuilder().setCustomId('prod_banner').setLabel('Banner (URL)').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
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

      if (commandName === 'cupom') {
        await interaction.deferReply({ ephemeral: true });
        const total = Object.keys(cupons).length;
        const ativos = Object.values(cupons).filter(c => c.ativo !== false).length;

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🏷 Gerenciador de Cupons')
          .setDescription(
            `📊 **Estatísticas:**\n` +
            `• **Total de cupons:** ${total}\n` +
            `• **Cupons ativos:** ${ativos}`
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
            `**Avatar atual:** [Ver Link](${client.user.displayAvatarURL({ size: 512 })})\n` +
            `**Banner atual:** ${client.user.bannerURL() ? '[Ver Banner](' + client.user.bannerURL({ size: 512 }) + ')' : 'Não definido'}`
          )
          .setThumbnail(client.user.displayAvatarURL());

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('perfil_avatar').setLabel('Alterar Avatar (URL)').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
          new ButtonBuilder().setCustomId('perfil_banner').setLabel('Alterar Banner (URL)').setStyle(ButtonStyle.Secondary).setEmoji('🌄'),
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
    }

    if (interaction.isButton()) {
      if (['prod_nome', 'prod_preco', 'prod_estoque', 'prod_emoji', 'prod_desc', 'prod_categoria', 'prod_banner'].includes(interaction.customId)) {
        const mapModal = {
          prod_nome: { id: 'modal_p_nome', title: 'Nome do Produto', label: 'Nome', placeholder: 'Ex: 🚀 Impulsos' },
          prod_preco: { id: 'modal_p_preco', title: 'Preço do Produto', label: 'Preço em Reais', placeholder: 'Ex: 3.50' },
          prod_estoque: { id: 'modal_p_estoque', title: 'Estoque Inicial', label: 'Apenas números inteiros', placeholder: 'Ex: 10' },
          prod_emoji: { id: 'modal_p_emoji', title: 'Emoji do Produto', label: 'Emoji opcional', placeholder: 'Ex: 🚀' },
          prod_desc: { id: 'modal_p_desc', title: 'Descrição do Produto', label: 'Descrição detalhada opcional', placeholder: 'Ex: Impulsos para evoluir seu servidor' },
          prod_categoria: { id: 'modal_p_categoria', title: 'Categoria', label: 'Nome da Categoria', placeholder: 'Ex: Discord' },
          prod_banner: { id: 'modal_p_banner', title: 'Banner do Produto', label: 'Link URL da Imagem', placeholder: 'https://site.com/imagem.png' }
        };
        const info = mapModal[interaction.customId];
        const modal = new ModalBuilder().setCustomId(info.id).setTitle(info.title);
        const input = new TextInputBuilder().setCustomId('val_input').setLabel(info.label).setPlaceholder(info.placeholder).setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (['p_alt_titulo', 'p_alt_desc', 'p_alt_cor', 'p_alt_banner'].includes(interaction.customId)) {
        const mapPainelModal = {
          p_alt_titulo: { id: 'modal_painel_titulo', title: 'Alterar Título', label: 'Título', placeholder: 'Loja Oficial' },
          p_alt_desc: { id: 'modal_painel_desc', title: 'Alterar Descrição', label: 'Descrição', placeholder: 'Selecione abaixo...' },
          p_alt_cor: { id: 'modal_painel_cor', title: 'Alterar Cor', label: 'Hex Code', placeholder: '#5865F2' },
          p_alt_banner: { id: 'modal_painel_banner', title: 'Alterar Banner do Painel', label: 'Link URL da Imagem', placeholder: 'https://site.com/banner.png' }
        };
        const info = mapPainelModal[interaction.customId];
        const modal = new ModalBuilder().setCustomId(info.id).setTitle(info.title);
        const input = new TextInputBuilder().setCustomId('val_input').setLabel(info.label).setPlaceholder(info.placeholder).setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'cupom_criar') {
        const modal = new ModalBuilder().setCustomId('modal_cupom_criar').setTitle('Criar Cupom');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_nome').setLabel('Nome do Cupom').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_tipo').setLabel('Tipo: percentual ou fixo').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_valor').setLabel('Valor (Ex: 10 ou 5.00)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_max').setLabel('Qtd Máxima de Usos').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_prod').setLabel('ID do Produto (Opcional)').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'cupom_editar') {
        const cupomKeys = Object.keys(cupons);
        if (cupomKeys.length === 0) return interaction.reply({ embeds: [aviso('Atenção', 'Nenhum cupom para editar.')], ephemeral: true });
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_cupom_editar')
          .setPlaceholder('Selecione o cupom para editar')
          .addOptions(cupomKeys.map(k => ({ label: k, value: k })));
        return interaction.reply({ content: 'Selecione o cupom:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 'cupom_excluir') {
        const cupomKeys = Object.keys(cupons);
        if (cupomKeys.length === 0) return interaction.reply({ embeds: [aviso('Atenção', 'Nenhum cupom para excluir.')], ephemeral: true });
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_cupom_excluir')
          .setPlaceholder('Selecione o cupom para excluir')
          .addOptions(cupomKeys.map(k => ({ label: k, value: k })));
        return interaction.reply({ content: 'Selecione o cupom:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 'cupom_listar') {
        const cupomKeys = Object.keys(cupons);
        if (cupomKeys.length === 0) return interaction.reply({ embeds: [aviso('Atenção', 'Nenhum cupom cadastrado.')], ephemeral: true });
        let desc = '';
        cupomKeys.forEach(nome => {
          const c = cupons[nome];
          desc += `🎟️ **${nome}**\n• Tipo: ${c.tipo}\n• Valor: ${c.valor}\n• Usos: ${c.utilizados || 0}/${c.maxUsos}\n\n`;
        });
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📋 Lista de Cupons').setDescription(desc)], ephemeral: true });
      }

      if (interaction.customId === 'cupom_fechar') {
        return interaction.message.delete().catch(() => {});
      }

      if (interaction.customId === 'perfil_nome') {
        const modal = new ModalBuilder().setCustomId('modal_perfil_nome').setTitle('Alterar Nome do Bot');
        const input = new TextInputBuilder().setCustomId('val_input').setLabel('Novo Nome').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'perfil_avatar') {
        const modal = new ModalBuilder().setCustomId('modal_perfil_avatar').setTitle('Alterar Avatar do Bot');
        const input = new TextInputBuilder().setCustomId('val_input').setLabel('Link URL da Imagem').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'perfil_banner') {
        const modal = new ModalBuilder().setCustomId('modal_perfil_banner').setTitle('Alterar Banner do Bot');
        const input = new TextInputBuilder().setCustomId('val_input').setLabel('Link URL da Imagem').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'perfil_visualizar') {
        const embedView = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('👀 Prévia do Perfil do Bot')
          .setDescription(`**Nome:** ${client.user.username}`)
          .setThumbnail(client.user.displayAvatarURL());
        return interaction.reply({ embeds: [embedView], ephemeral: true });
      }

      if (interaction.customId === 'perfil_fechar') {
        return interaction.message.delete().catch(() => {});
      }

      // BOTÃO DE COMPRA DIRETA NO PAINEL
      if (interaction.customId.startsWith('comprar_btn_')) {
        const prodId = interaction.customId.replace('comprar_btn_', '');
        const prod = produtos[prodId];
        if (!prod || prod.estoque <= 0) {
          return interaction.reply({ embeds: [aviso('Produto Indisponível', '❌ Sem estoque disponível')], ephemeral: true });
        }

        if (carrinhosAtivos[interaction.user.id]) {
          return interaction.reply({ embeds: [aviso('Carrinho Existente', '⚠️ Você já possui um carrinho aberto.')], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Criar canal exatamente abaixo do canal atual
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

        carrinhosAtivos[interaction.user.id] = canalCarrinho.id;
        carrinhoSessao.set(interaction.user.id, { prodId, qtd: 1, cupom: null });
        salvarDados();

        await enviarLog(interaction.guild, 'Carrinho Criado', `Carrinho criado para ${interaction.user} (${canalCarrinho.name})`);

        const embedCarrinho = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`Revisão do Pedido — ${interaction.user.username}`)
          .setDescription(prod.desc ? `${prod.desc}` : 'Entrega rápida e fácil via carrinho!');

        if (prod.bannerUrl) {
          embedCarrinho.setImage(prod.bannerUrl);
        }

        embedCarrinho.addFields(
          { name: '\u200b', value: `» **(1x)** ${prod.nome} — **${formatarMoeda(prod.preco)}** por unidade · subtotal **${formatarMoeda(prod.preco)}**\nestoque ${prod.estoque}` },
          { name: '\u200b', value: `🛒 Total de itens — 1\n💰 Total à vista — **${formatarMoeda(prod.preco)}**` }
        );

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('carrinho_pagar').setLabel('Ir para o Pagamento').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('carrinho_qtd').setLabel('Editar Quantidade').setStyle(ButtonStyle.Primary).setEmoji('🟦')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('carrinho_cupom').setLabel('Usar Cupom').setStyle(ButtonStyle.Secondary).setEmoji('🎟️'),
          new ButtonBuilder().setCustomId('carrinho_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('🟥')
        );

        await canalCarrinho.send({ content: `${interaction.user}`, embeds: [embedCarrinho], components: [row1, row2] });
        return interaction.editReply({ content: `✅ Seu carrinho foi criado com sucesso em <#${canalCarrinho.id}>!` });
      }

      // BOTÕES DENTRO DO CARRINHO
      const sessao = carrinhoSessao.get(interaction.user.id);

      if (interaction.customId === 'carrinho_cancelar') {
        delete carrinhosAtivos[interaction.user.id];
        carrinhoSessao.delete(interaction.user.id);
        salvarDados();
        await enviarLog(interaction.guild, 'Carrinho Fechado', `Carrinho de ${interaction.user.tag} foi cancelado/fechado.`);
        await interaction.update({ content: '❌ Carrinho cancelado e excluído.', embeds: [], components: [] }).catch(() => {});
        setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
        return;
      }

      if (interaction.customId === 'carrinho_pagar') {
        if (!sessao) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });
        
        if (!configGeral.pixKey) {
          return interaction.reply({ 
            content: '❌ Não há uma chave PIX cadastrada no momento.\nEntre em contato com a administração.', 
            ephemeral: true 
          });
        }

        const prod = produtos[sessao.prodId];
        if (!prod || prod.estoque < sessao.qtd) {
          return interaction.reply({ embeds: [aviso('Indisponível', 'Produto sem estoque suficiente.')], ephemeral: true });
        }

        // Atualizar estoque
        prod.estoque -= sessao.qtd;
        salvarDados();

        await enviarLog(interaction.guild, 'Compra Realizada', 
          `Produto: ${prod.nome}\nUsuário: ${interaction.user}\nQuantidade: ${sessao.qtd}\nValor: ${formatarMoeda(prod.preco * sessao.qtd)}\nID do carrinho: ${interaction.channel.id}`
        );

        await interaction.update({ 
          content: `✅ Pagamento Aprovado!\n\n**Chave PIX para transferência:**\n\`${configGeral.pixKey}\`\n\nObrigado pela compra! Este canal será fechado em breve.`, 
          embeds: [], 
          components: [] 
        }).catch(() => {});

        delete carrinhosAtivos[interaction.user.id];
        carrinhoSessao.delete(interaction.user.id);
        salvarDados();
        setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
        return;
      }

      if (interaction.customId === 'carrinho_qtd') {
        const modal = new ModalBuilder().setCustomId('modal_carrinho_qtd').setTitle('Editar Quantidade');
        const input = new TextInputBuilder().setCustomId('val_input').setLabel('Nova quantidade').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'carrinho_cupom') {
        const modal = new ModalBuilder().setCustomId('modal_carrinho_cupom').setTitle('Aplicar Cupom');
        const input = new TextInputBuilder().setCustomId('val_input').setLabel('Nome do Cupom').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // Demais botões respondem com deferUpdate
      await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'painel_modo_botao' || interaction.customId === 'painel_modo_menu') {
        const modo = interaction.customId === 'painel_modo_menu' ? 'menu' : 'botao';
        painelTemp.set(interaction.user.id, {
          titulo: 'Loja Oficial',
          descricao: 'Selecione abaixo para adquirir nossos produtos.',
          bannerUrl: null,
          cor: '#5865F2',
          modoExibicao: modo,
          produtosSelecionados: []
        });

        const pData = painelTemp.get(interaction.user.id);
        const embed = new EmbedBuilder()
          .setColor(pData.cor)
          .setTitle(`${pData.titulo}`)
          .setDescription(`${pData.descricao}`);

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('p_alt_titulo').setLabel('Título').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
          new ButtonBuilder().setCustomId('p_alt_desc').setLabel('Descrição').setStyle(ButtonStyle.Secondary).setEmoji('📄'),
          new ButtonBuilder().setCustomId('p_alt_banner').setLabel('Banner (URL)').setStyle(ButtonStyle.Secondary).setEmoji('🖼️'),
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

      if (interaction.customId === 'prod_cargo') {
        const menu = new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder().setCustomId('select_cargo_produto').setPlaceholder('Selecione o cargo entregue automaticamente')
        );
        return interaction.followUp({ content: 'Selecione o cargo:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'prod_salvar') {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (!pTemp || !pTemp.nome || pTemp.preco <= 0) {
          return interaction.followUp({ embeds: [aviso('Atenção', 'Preencha ao menos o nome e o preço corretamente antes de salvar.')], ephemeral: true });
        }
        produtos[pTemp.id] = pTemp;
        salvarDados();
        await enviarLog(interaction.guild, 'Produto Criado', `Produto **${pTemp.nome}** criado por ${interaction.user}`);
        produtoTemp.delete(interaction.user.id);
        return interaction.editReply({ embeds: [sucesso('Sucesso', '✅ Produto criado com sucesso.')], components: [] });
      }

      if (interaction.customId === 'prod_cancelar') {
        produtoTemp.delete(interaction.user.id);
        return interaction.editReply({ embeds: [aviso('Cancelado', 'A criação do produto foi cancelada.')], components: [] });
      }

      if (interaction.customId === 'p_sel_produtos') {
        const prodKeys = Object.keys(produtos);
        if (prodKeys.length === 0) {
          return interaction.followUp({ embeds: [aviso('Atenção', 'Não há produtos cadastrados!')], ephemeral: true });
        }
        const options = prodKeys.slice(0, 25).map(id => {
          const prod = produtos[id];
          const disponivel = prod.estoque > 0;
          return {
            label: prod.nome.substring(0, 100),
            description: disponivel ? `💰 Valor: ${formatarMoeda(prod.preco)} | 📦 Estoque: ${prod.estoque}` : `❌ Sem estoque disponível`,
            value: id,
            emoji: '📦'
          };
        });
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_produtos_painel')
          .setPlaceholder('Selecione os produtos para o painel')
          .setMinValues(1)
          .setMaxValues(options.length)
          .addOptions(options);

        return interaction.followUp({ content: 'Selecione abaixo os produtos:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 'p_visualizar') {
        const pData = painelTemp.get(interaction.user.id);
        const embedView = new EmbedBuilder()
          .setColor(pData.cor || '#5865F2')
          .setTitle(`${pData.titulo}`)
          .setDescription(`${pData.descricao}`);

        if (pData.bannerUrl) embedView.setImage(pData.bannerUrl);

        let components = [];
        if (pData.modoExibicao === 'menu' && pData.produtosSelecionados && pData.produtosSelecionados.length > 0) {
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
          const selectMenu = new StringSelectMenuBuilder().setCustomId('comprar_produto_menu').setPlaceholder('Selecione um produto para comprar').addOptions(options);
          components.push(new ActionRowBuilder().addComponents(selectMenu));
        } else if (pData.produtosSelecionados) {
          const rowBtn = new ActionRowBuilder();
          pData.produtosSelecionados.slice(0, 5).forEach(id => {
            const prod = produtos[id];
            if (prod) {
              rowBtn.addComponents(
                new ButtonBuilder().setCustomId(`comprar_btn_${id}`).setLabel(prod.nome).setStyle(prod.estoque > 0 ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🛒')
              );
            }
          });
          if (rowBtn.components.length > 0) components.push(rowBtn);
        }

        return interaction.followUp({ embeds: [embedView], components, ephemeral: true });
      }

      if (interaction.customId === 'p_publicar') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder().setCustomId('select_canal_publicar_painel').setPlaceholder('Selecione o canal de destino').addChannelTypes(ChannelType.GuildText)
        );
        return interaction.followUp({ content: 'Selecione o canal onde deseja **publicar o painel**:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'p_cancelar') {
        painelTemp.delete(interaction.user.id);
        return interaction.editReply({ embeds: [aviso('Cancelado', 'A criação do painel foi cancelada.')], components: [] });
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
        return interaction.followUp({ embeds: [sucesso('Sucesso', '✅ Cargo salvo.')], ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'select_produtos_painel') {
        const pData = painelTemp.get(interaction.user.id);
        if (pData) pData.produtosSelecionados = interaction.values;
        return interaction.followUp({ embeds: [sucesso('Sucesso', '✅ Produtos selecionados.')], ephemeral: true });
      }

      if (interaction.customId === 'select_cupom_excluir') {
        const nome = interaction.values[0];
        delete cupons[nome];
        salvarDados();
        return interaction.followUp({ embeds: [sucesso('Sucesso', `✅ Cupom **${nome}** excluído.`)], ephemeral: true });
      }

      if (interaction.customId === 'comprar_produto_menu') {
        const prodId = interaction.values[0];
        const prod = produtos[prodId];
        
        if (!prod || prod.estoque <= 0) {
          return interaction.followUp({ embeds: [aviso('Indisponível', '❌ Sem estoque disponível')], ephemeral: true });
        }

        if (carrinhosAtivos[interaction.user.id]) {
          return interaction.followUp({ embeds: [aviso('Carrinho Existente', '⚠️ Você já possui um carrinho aberto.')], ephemeral: true });
        }

        // Criar canal exatamente abaixo do canal atual onde o menu foi acionado
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

        carrinhosAtivos[interaction.user.id] = canalCarrinho.id;
        carrinhoSessao.set(interaction.user.id, { prodId, qtd: 1, cupom: null });
        salvarDados();

        await enviarLog(interaction.guild, 'Carrinho Criado', `Carrinho criado para ${interaction.user} (${canalCarrinho.name})`);

        const embedCarrinho = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`Revisão do Pedido — ${interaction.user.username}`)
          .setDescription(prod.desc ? `${prod.desc}` : 'Entrega rápida e fácil via carrinho!');

        if (prod.bannerUrl) embedCarrinho.setImage(prod.bannerUrl);

        embedCarrinho.addFields(
          { name: '\u200b', value: `» **(1x)** ${prod.nome} — **${formatarMoeda(prod.preco)}** por unidade · subtotal **${formatarMoeda(prod.preco)}**\nestoque ${prod.estoque}` },
          { name: '\u200b', value: `🛒 Total de itens — 1\n💰 Total à vista — **${formatarMoeda(prod.preco)}**` }
        );

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('carrinho_pagar').setLabel('Ir para o Pagamento').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('carrinho_qtd').setLabel('Editar Quantidade').setStyle(ButtonStyle.Primary).setEmoji('🟦')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('carrinho_cupom').setLabel('Usar Cupom').setStyle(ButtonStyle.Secondary).setEmoji('🎟️'),
          new ButtonBuilder().setCustomId('carrinho_cancelar').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('🟥')
        );

        await canalCarrinho.send({ content: `${interaction.user}`, embeds: [embedCarrinho], components: [row1, row2] });
        return interaction.followUp({ content: `✅ Seu carrinho foi criado com sucesso em <#${canalCarrinho.id}>!`, ephemeral: true });
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
          .setTitle(`${pData.titulo}`)
          .setDescription(`${pData.descricao}`);

        if (pData.bannerUrl) embedFinal.setImage(pData.bannerUrl);

        let components = [];
        if (pData.modoExibicao === 'menu' && pData.produtosSelecionados && pData.produtosSelecionados.length > 0) {
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
          const selectMenu = new StringSelectMenuBuilder().setCustomId('comprar_produto_menu').setPlaceholder('Selecione um produto para comprar').addOptions(options);
          components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        await channel.send({ embeds: [embedFinal], components });
        return interaction.followUp({ embeds: [sucesso('Publicado', '✅ Painel publicado com sucesso.')], ephemeral: true });
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
        if (interaction.customId === 'modal_p_banner') pTemp.bannerUrl = val;

        await interaction.deferReply({ ephemeral: true });
        await atualizarEmbedProduto(interaction, pTemp);
        return interaction.editReply({ embeds: [sucesso('Sucesso', '✅ Salvo com sucesso.')] });
      }

      if (interaction.customId.startsWith('modal_painel_')) {
        const pData = painelTemp.get(interaction.user.id);
        if (!pData) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });

        if (interaction.customId === 'modal_painel_titulo') pData.titulo = val;
        if (interaction.customId === 'modal_painel_desc') pData.descricao = val;
        if (interaction.customId === 'modal_painel_cor') pData.cor = val.startsWith('#') ? val : '#5865F2';
        if (interaction.customId === 'modal_painel_banner') pData.bannerUrl = val;

        await interaction.deferReply({ ephemeral: true });
        await atualizarEmbedPainelVendas(interaction, pData);
        return interaction.editReply({ embeds: [sucesso('Sucesso', '✅ Configuração atualizada.')] });
      }

      if (interaction.customId === 'modal_cupom_criar') {
        const nome = interaction.fields.getTextInputValue('c_nome');
        const tipo = interaction.fields.getTextInputValue('c_tipo');
        const valor = interaction.fields.getTextInputValue('c_valor');
        const maxUsos = parseInt(interaction.fields.getTextInputValue('c_max')) || 10;
        const produtoId = interaction.fields.getTextInputValue('c_prod') || null;

        cupons[nome] = { tipo, valor, maxUsos, utilizados: 0, produtoId, ativo: true };
        salvarDados();
        await enviarLog(interaction.guild, 'Cupom Criado', `Cupom **${nome}** criado por ${interaction.user}`);
        return interaction.reply({ embeds: [sucesso('Sucesso', `✅ Cupom **${nome}** criado com sucesso.`)], ephemeral: true });
      }

      if (interaction.customId === 'modal_carrinho_qtd') {
        const sessao = carrinhoSessao.get(interaction.user.id);
        if (!sessao) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });
        const novaQtd = parseInt(val) || 1;
        const prod = produtos[sessao.prodId];
        if (novaQtd > prod.estoque) {
          return interaction.reply({ embeds: [aviso('Estoque Insuficiente', `Estoque disponível: ${prod.estoque}`)], ephemeral: true });
        }
        sessao.qtd = novaQtd;
        salvarDados();

        let total = prod.preco * sessao.qtd;
        if (sessao.cupom) {
          const c = cupons[sessao.cupom];
          if (c.tipo === 'percentual') total -= total * (parseFloat(c.valor) / 100);
          else total -= parseFloat(c.valor.replace(',', '.'));
          if (total < 0) total = 0;
        }

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setFields(
            { name: '\u200b', value: `» **(${sessao.qtd}x)** ${prod.nome} — **${formatarMoeda(prod.preco)}** por unidade · subtotal **${formatarMoeda(prod.preco * sessao.qtd)}**\nestoque ${prod.estoque}` },
            { name: '\u200b', value: `🛒 Total de itens — ${sessao.qtd}\n💰 Total à vista — **${formatarMoeda(total)}**` }
          );

        await interaction.update({ embeds: [embed] }).catch(() => {});
        return interaction.followUp({ content: `✅ Quantidade alterada para ${sessao.qtd}.`, ephemeral: true });
      }

      if (interaction.customId === 'modal_carrinho_cupom') {
        const sessao = carrinhoSessao.get(interaction.user.id);
        if (!sessao) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });
        const cupomObj = cupons[val];
        if (!cupomObj || !cupomObj.ativo) {
          return interaction.reply({ embeds: [aviso('Cupom Inválido', 'Cupom não encontrado ou inativo.')], ephemeral: true });
        }
        if (cupomObj.produtoId && cupomObj.produtoId !== sessao.prodId) {
          return interaction.reply({ embeds: [aviso('Cupom Inválido', 'Este cupom não é válido para este produto.')], ephemeral: true });
        }
        if (cupomObj.utilizados >= cupomObj.maxUsos) {
          return interaction.reply({ embeds: [aviso('Cupom Esgotado', 'Este cupom atingiu o limite de usos.')], ephemeral: true });
        }

        sessao.cupom = val;
        cupomObj.utilizados = (cupomObj.utilizados || 0) + 1;
        salvarDados();

        await enviarLog(interaction.guild, 'Cupom Usado', `Cupom **${val}** utilizado por ${interaction.user}`);

        const prod = produtos[sessao.prodId];
        let total = prod.preco * sessao.qtd;
        if (cupomObj.tipo === 'percentual') total -= total * (parseFloat(cupomObj.valor) / 100);
        else total -= parseFloat(cupomObj.valor.replace(',', '.'));
        if (total < 0) total = 0;

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setFields(
            { name: '\u200b', value: `» **(${sessao.qtd}x)** ${prod.nome} — **${formatarMoeda(prod.preco)}** por unidade · subtotal **${formatarMoeda(prod.preco * sessao.qtd)}**\nestoque ${prod.estoque}` },
            { name: '\u200b', value: `🛒 Total de itens — ${sessao.qtd}\n🎟️ Cupom aplicado: ${val}\n💰 Total à vista — **${formatarMoeda(total)}**` }
          );

        await interaction.update({ embeds: [embed] }).catch(() => {});
        return interaction.followUp({ content: `✅ Cupom **${val}** aplicado com sucesso!`, ephemeral: true });
      }

      if (interaction.customId === 'modal_perfil_nome') {
        await client.user.setUsername(val);
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Nome do bot atualizado.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_perfil_avatar') {
        await client.user.setAvatar(val);
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Avatar do bot atualizado.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_perfil_banner') {
        await client.user.setBanner(val).catch(() => {});
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Banner do bot atualizado.')], ephemeral: true });
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
  new SlashCommandBuilder().setName('config').setDescription('Configurações do bot')
    .addSubcommand(sub => sub.setName('pix').setDescription('Configurar chave PIX').addStringOption(opt => opt.setName('chave').setDescription('Chave PIX').setRequired(true)))
    .addSubcommand(sub => sub.setName('log').setDescription('Configurar canal de logs').addChannelOption(opt => opt.setName('canal').setDescription('Canal de logs').setRequired(true))),
  new SlashCommandBuilder().setName('produto').setDescription('Gerenciamento de produtos').addSubcommand(sub => sub.setName('criar').setDescription('Criar produto por botões')),
  new SlashCommandBuilder().setName('painel').setDescription('Painel de vendas').addSubcommand(sub => sub.setName('criar').setDescription('Criar painel por interface')),
  new SlashCommandBuilder().setName('cupom').setDescription('Gerenciador de cupons por interface'),
  new SlashCommandBuilder().setName('perfil').setDescription('Personalizar perfil do bot'),
  new SlashCommandBuilder().setName('conectar').setDescription('Gerenciar conexão em canais de voz')
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
