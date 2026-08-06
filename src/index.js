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
        blacklistUsers: new Set(data.blacklistUsers || []),
        cooldownMinutos: data.cooldownMinutos || 5,
        produtos: data.produtos || {},
        carrinhosAtivos: data.carrinhosAtivos || {},
        cupons: data.cupons || {},
        conexoesVoz: data.conexoesVoz || {}
      };
    } catch (e) {
      console.error('Erro ao ler banco de dados:', e);
    }
  }
  return { reestockConfig: {}, blacklistUsers: new Set(), cooldownMinutos: 5, produtos: {}, carrinhosAtivos: {}, cupons: {}, conexoesVoz: {} };
}

function salvarDados() {
  try {
    const data = {
      reestockConfig,
      blacklistUsers: Array.from(blacklistUsers),
      cooldownMinutos: reestockCooldownMinutos,
      produtos,
      carrinhosAtivos,
      cupons,
      conexoesVoz
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
const produtos = dadosSalvos.produtos; 
const carrinhosAtivos = dadosSalvos.carrinhosAtivos; 
const cupons = dadosSalvos.cupons; 
const conexoesVoz = dadosSalvos.conexoesVoz;

const produtoTemp = new Map(); 
const painelTemp = new Map();  
const cupomTemp = new Map();   // userId -> dados do cupom em edição
const perfilTemp = new Map();  // userId -> dados do perfil em edição
const vozTimers = new Map();   // guildId -> { startTime, interval }
const aguardandoUpload = new Map(); 

// Formatar valor em Reais (R$ 0,00)
function formatarMoeda(valor) {
  const num = parseFloat(valor) || 0;
  return `R$ ${num.toFixed(2).replace('.', ',')}`;
}

// Extrair Emoji limpo para exibição sem formato de ID bruto
function limparEmoji(emojiStr) {
  if (!emojiStr) return 'Não definido';
  const matchCustom = emojiStr.match(/<a?:([a-zA-Z0-9_]+):([0-9]+)>/);
  if (matchCustom) {
    const customId = matchCustom[2];
    const isAnimated = emojiStr.startsWith('<a:');
    return `<${isAnimated ? 'a' : ''}:${matchCustom[1]}:${customId}>`;
  }
  return emojiStr;
}

// Download de imagem via anexo Discord
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

// ==========================================
// 3. EMBEDS PADRONIZADAS
// ==========================================
const sucesso = (titulo, desc) => new EmbedBuilder().setColor('#57F287').setTitle(`🟢 ${titulo}`).setDescription(desc);
const aviso = (titulo, desc) => new EmbedBuilder().setColor('#FEE75C').setTitle(`⚠️ ${titulo}`).setDescription(desc);
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
// 5. CAPTURA DE UPLOAD DE IMAGENS NO CHAT
// ==========================================
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
        await message.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('✅ Banner salvo com sucesso.')] });
      }
    } else if (aguardo.tipo === 'painel_banner') {
      const pData = painelTemp.get(message.author.id);
      if (pData) {
        pData.bannerPath = caminhoSalvo;
        await atualizarEmbedPainel(aguardo.interactionRef, pData);
        await message.reply({ embeds: [new EmbedBuilder().setColor('#57F287').setTitle('✅ Banner do painel atualizado com sucesso.')] });
      }
    } else if (aguardo.tipo === 'perfil_avatar') {
      await client.user.setAvatar(caminhoSalvo);
      await message.reply({ embeds: [sucesso('Avatar Atualizado', '✅ Avatar atualizado com sucesso.')] });
    } else if (aguardo.tipo === 'perfil_banner') {
      await client.user.setBanner(caminhoSalvo);
      await message.reply({ embeds: [sucesso('Banner Atualizado', '✅ Banner atualizado com sucesso.')] });
    }
  } catch (err) {
    console.error(err);
    await message.reply({ embeds: [erro('Erro', 'Ocorreu um erro ao processar a imagem.')] });
  }
});

// Funções de atualização em tempo real
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

  if (pTemp.bannerPath && fs.existsSync(pTemp.bannerPath)) {
    const attachment = new AttachmentBuilder(pTemp.bannerPath, { name: 'banner.png' });
    embed.setImage('attachment://banner.png');
    await interaction.editReply({ embeds: [embed], files: [attachment] }).catch(() => {});
  } else {
    await interaction.editReply({ embeds: [embed], files: [] }).catch(() => {});
  }
}

async function atualizarEmbedPainel(interaction, pData) {
  const embed = new EmbedBuilder()
    .setColor(pData.cor || '#5865F2')
    .setTitle(`🛒 ${pData.titulo}`)
    .setDescription(`🛍️ **Descrição:**\n${pData.descricao}\n\n**Modo de Exibição:** ${pData.modoExibicao === 'menu' ? 'Menu de Seleção' : 'Botões'}`);

  if (pData.bannerPath && fs.existsSync(pData.bannerPath)) {
    const attachment = new AttachmentBuilder(pData.bannerPath, { name: 'banner.png' });
    embed.setImage('attachment://banner.png');
    await interaction.editReply({ embeds: [embed], files: [attachment] }).catch(() => {});
  } else {
    await interaction.editReply({ embeds: [embed], files: [] }).catch(() => {});
  }
}

// ==========================================
// 6. MANIPULAÇÃO DE INTERAÇÕES
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    const guildId = interaction.guildId;
    if (guildId && !reestockConfig[guildId]) {
      reestockConfig[guildId] = { canalSolicitacao: null, canalLog: null };
      salvarDados();
    }

    // ----------------------------------------
    // COMANDOS SLASH
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'produto') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'criar') {
          produtoTemp.set(interaction.user.id, {
            id: Date.now().toString(),
            emoji: 'Não definido', nome: 'Não definido', desc: 'Não definida', 
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

          return interaction.reply({ embeds: [embed], components: [row1, row2, row3], ephemeral: true });
        }
      }

      if (commandName === 'painel') {
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

          return interaction.reply({ embeds: [embedEtapa1], components: [rowEtapa1], ephemeral: true });
        }
      }

      if (commandName === 'cupom') {
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

        return interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
      }

      if (commandName === 'perfil') {
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

        return interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
      }

      if (commandName === 'conectar') {
        const conexaoAtiva = conexoesVoz[guildId];
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
        return interaction.reply({ embeds: [embed], components: [botoes], ephemeral: true });
      }

      if (commandName === 'ticket') {
        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎫 Atendimento').setDescription('Selecione o setor desejado:');
        const menu = new StringSelectMenuBuilder().setCustomId('ticket_setor').setPlaceholder('Atendimento').addOptions([{ label: 'Suporte', value: 'suporte' }]);
        return interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (commandName === 'reestock') return interaction.reply({ embeds: [sucesso('Reestock', 'Configurado.')], ephemeral: true });
      if (commandName === 'dashboard') return interaction.reply({ embeds: [sucesso('Dashboard', 'Online.')], ephemeral: true });
      if (commandName === 'cupom') return interaction.reply({ embeds: [sucesso('Cupom', 'Ativo.')], ephemeral: true });
      if (commandName === 'conectar') return interaction.reply({ embeds: [sucesso('Conectar', 'Ativo.')], ephemeral: true });
    }

    // ----------------------------------------
    // BOTÕES E INTERAÇÕES GERAIS
    // ----------------------------------------
    if (interaction.isButton()) {
      // Painel Modo
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

        return interaction.update({ embeds: [embed], components: [row1, row2] });
      }

      // Produto
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

      if (interaction.customId === 'prod_banner') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'produto_banner', interactionRef: interaction });
        return interaction.reply({ content: '🖼️ Envie a imagem do banner em até 60 segundos no chat.', ephemeral: true });
      }

      if (interaction.customId === 'prod_cargo') {
        const menu = new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder().setCustomId('select_cargo_produto').setPlaceholder('Selecione o cargo entregue automaticamente')
        );
        return interaction.reply({ content: 'Selecione o cargo que será entregue na aprovação:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'prod_salvar') {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (!pTemp || pTemp.nome === 'Não definido' || pTemp.preco <= 0) {
          return interaction.reply({ embeds: [aviso('Atenção', 'Preencha ao menos o nome e o preço corretamente antes de salvar.')], ephemeral: true });
        }
        produtos[pTemp.id] = pTemp;
        salvarDados();
        produtoTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [sucesso('Sucesso', '✅ Produto criado com sucesso.')], components: [] });
      }

      if (interaction.customId === 'prod_cancelar') {
        produtoTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [aviso('Cancelado', 'A criação do produto foi cancelada.')], components: [] });
      }

      // Painel Config
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

      if (interaction.customId === 'p_alt_banner') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'painel_banner', interactionRef: interaction });
        return interaction.reply({ content: '🖼️ Envie a imagem do banner em até 60 segundos.', ephemeral: true });
      }

      if (interaction.customId === 'p_sel_produtos') {
        const prodKeys = Object.keys(produtos);
        if (prodKeys.length === 0) {
          return interaction.reply({ embeds: [aviso('Atenção', 'Não há produtos cadastrados no servidor ainda!')], ephemeral: true });
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

        return interaction.reply({ content: 'Selecione abaixo os produtos desejados:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
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

        return interaction.reply({ embeds: [embedView], components, files, ephemeral: true });
      }

      if (interaction.customId === 'p_publicar') {
        const menu = new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder().setCustomId('select_canal_publicar_painel').setPlaceholder('Selecione o canal de destino').addChannelTypes(ChannelType.GuildText)
        );
        return interaction.reply({ content: 'Selecione o canal onde deseja **publicar o painel**:', components: [menu], ephemeral: true });
      }

      if (interaction.customId === 'p_cancelar') {
        painelTemp.delete(interaction.user.id);
        return interaction.update({ embeds: [aviso('Cancelado', 'A criação do painel foi cancelada.')], components: [] });
      }

      // CUPOM BOTÕES
      if (interaction.customId === 'cupom_criar') {
        const modal = new ModalBuilder().setCustomId('modal_cupom_criar').setTitle('Criar Cupom');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_nome').setLabel('Nome do Cupom').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_tipo').setLabel('Tipo: percentual ou fixo').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_valor').setLabel('Valor (Ex: 10% ou R$ 5,00)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_max').setLabel('Qtd Máxima de Usos').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_min').setLabel('Valor Mínimo da Compra (Opcional)').setStyle(TextInputStyle.Short).setRequired(false))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'cupom_editar') {
        const cupomKeys = Object.keys(cupons);
        if (cupomKeys.length === 0) return interaction.reply({ embeds: [aviso('Atenção', 'Não há cupons cadastrados.')], ephemeral: true });

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_cupom_editar')
          .setPlaceholder('Selecione o cupom para editar')
          .addOptions(cupomKeys.slice(0, 25).map(nome => ({ label: nome, value: nome })));

        return interaction.reply({ content: 'Selecione o cupom:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 'cupom_excluir') {
        const cupomKeys = Object.keys(cupons);
        if (cupomKeys.length === 0) return interaction.reply({ embeds: [aviso('Atenção', 'Não há cupons cadastrados.')], ephemeral: true });

        const select = new StringSelectMenuBuilder()
          .setCustomId('select_cupom_excluir')
          .setPlaceholder('Selecione o cupom para excluir')
          .addOptions(cupomKeys.slice(0, 25).map(nome => ({ label: nome, value: nome })));

        return interaction.reply({ content: 'Selecione o cupom a ser excluído:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      }

      if (interaction.customId === 'cupom_listar') {
        const cupomKeys = Object.keys(cupons);
        if (cupomKeys.length === 0) return interaction.reply({ embeds: [aviso('Atenção', 'Nenhum cupom cadastrado.')], ephemeral: true });

        let desc = '';
        cupomKeys.forEach(nome => {
          const c = cupons[nome];
          desc += `🎟️ **${nome}**\n• Desconto: ${c.valor}\n• Restantes: ${c.maxUsos - (c.utilizados || 0)}\n• Utilizados: ${c.utilizados || 0}\n• Status: ${c.ativo !== false ? 'Ativo 🟢' : 'Inativo 🔴'}\n\n`;
        });

        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('📋 Lista de Cupons').setDescription(desc)], ephemeral: true });
      }

      if (interaction.customId === 'cupom_fechar') {
        return interaction.message.delete().catch(() => {});
      }

      // PERFIL BOTÕES
      if (interaction.customId === 'perfil_avatar') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'perfil_avatar', interactionRef: interaction });
        return interaction.reply({ content: '🖼️ Envie a nova imagem do avatar em até 60 segundos no chat.', ephemeral: true });
      }

      if (interaction.customId === 'perfil_banner') {
        aguardandoUpload.set(interaction.user.id, { tipo: 'perfil_banner', interactionRef: interaction });
        return interaction.reply({ content: '🖼️ Envie a imagem do banner em até 60 segundos no chat.', ephemeral: true });
      }

      if (interaction.customId === 'perfil_nome') {
        const modal = new ModalBuilder().setCustomId('modal_perfil_nome').setTitle('Alterar Nome do Bot');
        const input = new TextInputBuilder().setCustomId('val_nome').setLabel('Novo Nome').setStyle(TextInputStyle.Short).setRequired(true);
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

      // CONEXÃO DE VOZ BOTÕES
      if (interaction.customId === 'voz_conectar' || interaction.customId === 'voz_mudar') {
        const menu = new ChannelSelectMenuBuilder()
          .setCustomId('select_canal_voz')
          .setPlaceholder('Selecione o canal de voz')
          .addChannelTypes(ChannelType.GuildVoice);

        return interaction.reply({ content: 'Selecione o canal de voz desejado:', components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      }

      if (interaction.customId === 'voz_desconectar') {
        const connection = getVoiceConnection(guildId);
        if (connection) connection.destroy();
        delete conexoesVoz[guildId];
        salvarDados();

        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎧 Bot Conectado').setDescription('O bot não está conectado a nenhum canal de voz.');
        const botoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('voz_conectar').setLabel('Conectar').setStyle(ButtonStyle.Success).setEmoji('🔗'),
          new ButtonBuilder().setCustomId('voz_fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        return interaction.update({ embeds: [embed], components: [botoes] });
      }

      if (interaction.customId === 'voz_fechar') {
        return interaction.message.delete().catch(() => {});
      }

      // Botões de Carrinho e Pagamento
      if (interaction.customId.startsWith('comprar_btn_') || interaction.customId === 'comprar_produto_menu') {
        const userId = interaction.user.id;
        if (carrinhosAtivos[userId]) {
          return interaction.reply({ embeds: [aviso('Atenção', 'Você já possui um carrinho aberto.')], ephemeral: true });
        }

        const prodId = interaction.customId.startsWith('comprar_btn_') ? interaction.customId.split('_')[2] : interaction.values[0];
        const prod = produtos[prodId];
        if (!prod) return interaction.reply({ embeds: [erro('Erro', 'Produto não encontrado.')], ephemeral: true });

        const categoriaCanal = interaction.channel.parent;
        const canalCarrinho = await interaction.guild.channels.create({
          name: `🛒・${interaction.user.username}`,
          type: ChannelType.GuildText,
          parent: categoriaCanal ? categoriaCanal.id : null,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
          ]
        });

        carrinhosAtivos[userId] = { canalId: canalCarrinho.id, prodId, qtd: 1, cupomAplicado: null };
        salvarDados();

        const embedCarrinho = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`Carrinho de ${interaction.user.username}`)
          .setDescription(
            `**${prod.emoji !== 'Não definido' ? prod.emoji : '📦'} ${prod.nome}**\n` +
            `${prod.desc}\n\n` +
            `📦 **Quantidade:** 1x\n` +
            `💰 **Valor Original:** ${formatarMoeda(prod.preco)}\n` +
            `🏷️ **Desconto:** R$ 0,00\n` +
            `💵 **Valor Final:** ${formatarMoeda(prod.preco)}`
          );

        let files = [];
        if (prod.bannerPath && fs.existsSync(prod.bannerPath)) {
          const attachment = new AttachmentBuilder(prod.bannerPath, { name: 'banner.png' });
          embedCarrinho.setImage('attachment://banner.png');
          files.push(attachment);
        }

        const row1 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cart_qtd').setLabel('Quantidade').setStyle(ButtonStyle.Primary).setEmoji('➕'),
          new ButtonBuilder().setCustomId('cart_cupom').setLabel('Aplicar Cupom').setStyle(ButtonStyle.Secondary).setEmoji('🏷️'),
          new ButtonBuilder().setCustomId('cart_cancel').setLabel('Cancelar').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cart_pagar').setLabel('Finalizar Compra').setStyle(ButtonStyle.Success).setEmoji('💳')
        );

        await canalCarrinho.send({ content: `<@${userId}>`, embeds: [embedCarrinho], components: [row1, row2], files });
        return interaction.reply({ content: `✅ Carrinho criado com sucesso em <#${canalCarrinho.id}>!`, ephemeral: true });
      }

      if (interaction.customId === 'cart_qtd') {
        const modal = new ModalBuilder().setCustomId('modal_cart_qtd').setTitle('Alterar Quantidade');
        const input = new TextInputBuilder().setCustomId('val_qtd').setLabel('Quantidade desejada').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'cart_cupom') {
        const modal = new ModalBuilder().setCustomId('modal_cart_cupom').setTitle('Aplicar Cupom');
        const input = new TextInputBuilder().setCustomId('val_cupom').setLabel('Código do Cupom').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'cart_cancel') {
        delete carrinhosAtivos[interaction.user.id];
        salvarDados();
        await interaction.channel.delete().catch(() => {});
      }

      if (interaction.customId === 'cart_pagar') {
        const embedPagamento = new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('💳 Pagamento PIX')
          .setDescription('Utilize a chave PIX abaixo para pagar.\n\n**Chave PIX:** `exemplo@pix.com`');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('pix_ja_paguei').setLabel('Já realizei o pagamento').setStyle(ButtonStyle.Success).setEmoji('✅')
        );

        return interaction.update({ embeds: [embedPagamento], components: [row] });
      }

      if (interaction.customId === 'pix_ja_paguei') {
        const embedStaff = new EmbedBuilder()
          .setColor('#FEE75C')
          .setTitle('🔔 Confirmação de Pagamento')
          .setDescription(`O usuário ${interaction.user} informou que realizou o pagamento.\nDeseja aprovar esta compra?`);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('aprovar_compra').setLabel('Aprovar').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('recusar_compra').setLabel('Recusar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        await interaction.channel.send({ content: '@everyone Staff', embeds: [embedStaff], components: [row] });
        return interaction.reply({ content: '✅ Aviso enviado para a staff com sucesso!', ephemeral: true });
      }

      if (interaction.customId === 'aprovar_compra') {
        await interaction.message.edit({ embeds: [sucesso('Aprovado', '✅ Compra aprovada com sucesso.')], components: [] });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 4000);
      }
    }

    // ----------------------------------------
    // SELECT MENUS (Cargos, Produtos, Canais, etc)
    // ----------------------------------------
    if (interaction.isRoleSelectMenu()) {
      if (interaction.customId === 'select_cargo_produto') {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (pTemp) {
          pTemp.cargoId = interaction.values[0];
          await atualizarEmbedProduto(interaction, pTemp);
        }
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Cargo salvo com sucesso.')], ephemeral: true });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_produtos_painel') {
        const pData = painelTemp.get(interaction.user.id);
        if (pData) pData.produtosSelecionados = interaction.values;
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Produtos selecionados com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'select_cupom_editar') {
        const cupomNome = interaction.values[0];
        cupomTemp.set(interaction.user.id, cupomNome);
        const modal = new ModalBuilder().setCustomId('modal_cupom_editar_val').setTitle(`Editar Cupom: ${cupomNome}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_val').setLabel('Novo Desconto (Ex: 15% ou R$ 10,00)').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c_max').setLabel('Nova Qtd Máxima').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'select_cupom_excluir') {
        const cupomNome = interaction.values[0];
        delete cupons[cupomNome];
        salvarDados();
        return interaction.update({ embeds: [sucesso('Excluído', `✅ Cupom **${cupomNome}** excluído com sucesso.`)], components: [] });
      }
    }

    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId === 'select_canal_publicar_painel') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        const pData = painelTemp.get(interaction.user.id);

        if (!channel || !pData) return interaction.reply({ embeds: [erro('Erro', 'Canal ou dados inválidos.')], ephemeral: true });

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

        await channel.send({ embeds: [embedFinal], components, files });
        return interaction.update({ embeds: [sucesso('Publicado', '✅ Painel publicado com sucesso.')], components: [] });
      }

      if (interaction.customId === 'select_canal_voz') {
        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) return interaction.reply({ embeds: [erro('Erro', 'Canal de voz inválido.')], ephemeral: true });

        try {
          joinVoiceChannel({
            channelId: channel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
          });

          const timestamp = Math.floor(Date.now() / 1000);
          conexoesVoz[interaction.guild.id] = { canalId: channel.id, timestamp };
          salvarDados();

          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🎧 Bot Conectado')
            .setDescription(`**Canal:** ${channel.name}\n**Conectado há:** <t:${timestamp}:R>`);

          const botoes = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('voz_mudar').setLabel('Mudar de Call').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
            new ButtonBuilder().setCustomId('voz_desconectar').setLabel('Desconectar').setStyle(ButtonStyle.Danger).setEmoji('🔌')
          );

          return interaction.update({ embeds: [embed], components: [botoes] });
        } catch (e) {
          console.error(e);
          return interaction.reply({ embeds: [erro('Erro', 'Não foi possível entrar no canal de voz.')], ephemeral: true });
        }
      }
    }

    // ----------------------------------------
    // MODALS
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      const val = interaction.fields.getTextInputValue('val_input').trim();

      if (interaction.customId.startsWith('modal_p_')) {
        const pTemp = produtoTemp.get(interaction.user.id);
        if (!pTemp) return interaction.reply({ embeds: [erro('Erro', 'Sessão expirada.')], ephemeral: true });

        if (interaction.customId === 'modal_p_nome') pTemp.nome = val;
        if (interaction.customId === 'modal_p_preco') pTemp.preco = parseFloat(val.replace(',', '.')) || 0;
        if (interaction.customId === 'modal_p_estoque') pTemp.estoque = parseInt(val) || 0;
        if (interaction.customId === 'modal_p_emoji') pTemp.emoji = val;
        if (interaction.customId === 'modal_p_desc') pTemp.desc = val;
        if (interaction.customId === 'modal_p_categoria') pTemp.categoria = val;

        await atualizarEmbedProduto(interaction, pTemp);
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Salvo com sucesso.')], ephemeral: true });
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

        await atualizarEmbedPainel(interaction, pData);
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Configuração atualizada.')], ephemeral: true });
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

      if (interaction.customId === 'modal_cupom_editar_val') {
        const cupomNome = cupomTemp.get(interaction.user.id);
        const novoVal = interaction.fields.getTextInputValue('c_val');
        const novoMax = parseInt(interaction.fields.getTextInputValue('c_max')) || 10;

        if (cupons[cupomNome]) {
          cupons[cupomNome].valor = novoVal;
          cupons[cupomNome].maxUsos = novoMax;
          salvarDados();
        }
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Cupom atualizado com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_perfil_nome') {
        const novoNome = interaction.fields.getTextInputValue('val_nome');
        await client.user.setUsername(novoNome);
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Nome atualizado com sucesso.')], ephemeral: true });
      }

      if (interaction.customId === 'modal_cart_cupom') {
        const codigoCupom = interaction.fields.getTextInputValue('val_cupom');
        const carrinho = carrinhosAtivos[interaction.user.id];
        if (!carrinho) return interaction.reply({ embeds: [erro('Erro', 'Carrinho não encontrado.')], ephemeral: true });

        const cupom = cupons[codigoCupom];
        if (!cupom || !cupom.ativo || (cupom.utilizados >= cupom.maxUsos)) {
          return interaction.reply({ embeds: [aviso('Atenção', 'Cupom inválido ou expirado.')], ephemeral: true });
        }

        carrinho.cupomAplicado = codigoCupom;
        const prod = produtos[carrinho.prodId];
        let valorOriginal = prod.preco * carrinho.qtd;
        let descontoStr = 'R$ 0,00';
        let valorFinal = valorOriginal;

        if (cupom.tipo.toLowerCase().includes('percentual') || cupom.valor.includes('%')) {
          const percent = parseFloat(cupom.valor.replace('%', '')) || 0;
          const valorDesconto = (valorOriginal * percent) / 100;
          valorFinal = valorOriginal - valorDesconto;
          descontoStr = `${percent}% (${formatarMoeda(valorDesconto)})`;
        } else {
          const valorFixo = parseFloat(cupom.valor.replace('R$', '').replace(',', '.')) || 0;
          valorFinal = Math.max(0, valorOriginal - valorFixo);
          descontoStr = formatarMoeda(valorFixo);
        }

        cupom.utilizados = (cupom.utilizados || 0) + 1;
        salvarDados();

        const embedCarrinho = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`Carrinho de ${interaction.user.username}`)
          .setDescription(
            `**${prod.emoji !== 'Não definido' ? prod.emoji : '📦'} ${prod.nome}**\n` +
            `📦 **Quantidade:** ${carrinho.qtd}x\n` +
            `💰 **Valor Original:** ${formatarMoeda(valorOriginal)}\n` +
            `🏷️ **Desconto:** ${descontoStr}\n` +
            `💵 **Valor Final:** ${formatarMoeda(valorFinal)}`
          );

        await interaction.message.edit({ embeds: [embedCarrinho] });
        return interaction.reply({ embeds: [sucesso('Sucesso', '✅ Cupom aplicado com sucesso em tempo real.')], ephemeral: true });
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
// 7. REGISTRO DE COMANDOS SLASH
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('produto').setDescription('Gerenciamento de produtos').addSubcommand(sub => sub.setName('criar').setDescription('Criar produto por botões')),
  new SlashCommandBuilder().setName('painel').setDescription('Painel de vendas').addSubcommand(sub => sub.setName('criar').setDescription('Criar painel por interface')),
  new SlashCommandBuilder().setName('cupom').setDescription('Gerenciador de cupons por interface'),
  new SlashCommandBuilder().setName('perfil').setDescription('Personalizar perfil do bot'),
  new SlashCommandBuilder().setName('conectar').setDescription('Gerenciar conexão em canais de voz'),
  new SlashCommandBuilder().setName('ticket').setDescription('Atendimento').addSubcommand(sub => sub.setName('criar').setDescription('Criar tickets')),
  new SlashCommandBuilder().setName('reestock').setDescription('Configurações de reestock'),
  new SlashCommandBuilder().setName('dashboard').setDescription('Dashboard'),
  new SlashCommandBuilder().setName('conectar').setDescription('Voz')
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
