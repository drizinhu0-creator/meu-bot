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
// 1. SERVIDOR HTTP PARA O RENDER (PORTA)
// ==========================================
http.createServer((req, res) => {
  res.write("Bot Venix Online 24/7!");
  res.end();
}).listen(process.env.PORT || 3000, () => {
  console.log("🌐 Servidor HTTP ativo para o Render.");
});

// ==========================================
// 2. ESTRUTURA DE BANCO DE DADOS LOCAL (JSON)
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

// Helper para baixar e salvar imagens enviadas
async function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const savePath = path.join(uploadsFolder, filename);
    const file = fs.createWriteStream(savePath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(savePath);
      });
    }).on('error', (err) => {
      fs.unlink(savePath, () => {});
      reject(err);
    });
  });
}

// ==========================================
// 3. EMBEDS PADRONIZADAS (RESPOSTAS SISTEMA)
// ==========================================
const moeda = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
const sucesso = (titulo, desc) => new EmbedBuilder().setColor('#57F287').setTitle(`🟢 ${titulo}`).setDescription(desc);
const aviso = (titulo, desc) => new EmbedBuilder().setColor('#FEE75C').setTitle(`🟡 ${titulo}`).setDescription(desc);
const erro = (titulo, desc) => new EmbedBuilder().setColor('#ED4245').setTitle(`🔴 ${titulo}`).setDescription(desc);

// ==========================================
// 4. INICIALIZAÇÃO DO CLIENTE DISCORD
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
  console.log(`🤖 Bot iniciado com sucesso como: ${client.user.tag}`);
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
// 6. MANIPULAÇÃO DE INTERAÇÕES E COMANDOS
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    // ----------------------------------------
    // A. COMANDOS SLASH ( / )
    // ----------------------------------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

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

      // Resposta padrão para outros comandos
      return interaction.reply({ embeds: [sucesso('Comando Executado', `O comando **/${commandName}** está pronto para ser configurado!`)], ephemeral: true });
    }

    // ----------------------------------------
    // B. RESPOSTAS DE BOTÕES
    // ----------------------------------------
    if (interaction.isButton()) {
      // Destrancar canal (.trancar)
      if (interaction.customId === 'btn_destrancar_canal') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
          return interaction.reply({ embeds: [erro('Sem Permissão', 'Você não pode destrancar este canal.')], ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true });
        return interaction.reply({ embeds: [sucesso('Canal Destrancado', '🔓 O canal foi destrancado com sucesso.')] });
      }

      // Alterar Nome no /perfil (Abre Modal)
      if (interaction.customId === 'perfil_nome') {
        const modal = new ModalBuilder()
          .setCustomId('modal_perfil_nome')
          .setTitle('Alterar Nome do Bot');

        const input = new TextInputBuilder()
          .setCustomId('novo_nome')
          .setLabel('Novo Nome')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
    }

    // ----------------------------------------
    // C. RESPOSTAS DE MODALS
    // ----------------------------------------
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_perfil_nome') {
        const novoNome = interaction.fields.getTextInputValue('novo_nome');
        await client.user.setUsername(novoNome).catch(() => {});
        return interaction.reply({ embeds: [sucesso('Nome Alterado', `O nome do bot foi alterado para **${novoNome}**!`)], ephemeral: true });
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
// 7. REGISTRO DE COMANDOS SLASH NO DISCORD
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('produto').setDescription('Gerencia a criação de produtos'),
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
