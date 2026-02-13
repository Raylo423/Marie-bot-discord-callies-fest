const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- CONFIGURATION ---
// Sur Koyeb/Hébergement, utilisez les variables d'environnement pour plus de sécurité.
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN || TOKEN === "" || TOKEN === "YOUR_TOKEN_HERE") {
    console.error("❌ ERREUR CRITIQUE : Le Token Discord est absent !");
    console.error("Marie ne peut pas démarrer sans son 'mot de passe'.");
    console.error("👉 Solution : Allez sur Koyeb > Votre Service > Settings > Environment Variables.");
    console.error("👉 Ajoutez la variable 'DISCORD_TOKEN' avec votre token comme valeur.");
    process.exit(1);
}
const OWNER_ROLE_ID = '1463484076890783947'; // ID du rôle @owner
const HOSTER_ROLE_ID = '1463496433138274490'; // ID du rôle @Splatfest Hoster
const MATCHMAKER_ROLE_ID = '1463496433138274490'; // ID du rôle @Matchmaker (même ID fourni)
const ANNOUNCEMENT_CHANNEL_ID = '1463429538909257913'; // Nouveau salon d'annonces
const MATCHMAKING_CHANNEL_ID = '1463429949900718263'; // Salon de matchmaking
const FILE_NAME = 'Splatfest team names.txt';
const DATA_FILE = 'splatfest_data.json';
const SUPPORT_CHANNEL_ID = '1463514539705503774'; // Salon de support pour l'IA (How-to-do)
const BATTLE_LOG_CHANNEL_ID = '1463427351751692340'; // Salon pour début/fin/rotations
const MATCHMAKING_CH_MENTION = '<#1463429949900718263>';
// ---------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Stockage des données du Splatfest
const dataPath = path.join(__dirname, DATA_FILE);
let currentSplatfest = {
    roleA: null,
    roleB: null,
    emojiA: null,
    emojiB: null,
    announcementMessageId: null,
    startDate: null, // Format timestamp
    endDate: null,   // Format timestamp
    lastRotationHour: -1
};

// Charger les données au démarrage
if (fs.existsSync(dataPath)) {
    try {
        currentSplatfest = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        console.log("Données Splatfest chargées.");
    } catch (e) {
        console.error("Erreur chargement JSON :", e.message);
    }
}

function saveSplatfestData() {
    try {
        fs.writeFileSync(dataPath, JSON.stringify(currentSplatfest, null, 2), 'utf8');
    } catch (e) {
        console.error("Erreur sauvegarde JSON :", e.message);
    }
}

// Initialisation du fichier texte
const filePath = path.join(__dirname, FILE_NAME);
if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "Splatfest team names:\n\n", 'utf8');
}

// --- LOGIQUE CRC32 POUR SAVE.DAT ---
const CRC32_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC32_TABLE[i] = c;
}

function calculateCRC32(buffer, start, end) {
    let crc = -1;
    for (let i = start; i < end; i++) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}
// ------------------------------------

client.once('ready', async () => {
    console.log('Marie : Splatfest Manager est prêt !');

    // Tenter de changer le nom d'utilisateur si nécessaire
    if (client.user.username !== 'Marie') {
        try {
            await client.user.setUsername('Marie');
            console.log("Nom d'utilisateur mis à jour en : Marie");
        } catch (e) {
            console.error("Impossible de changer le nom d'utilisateur (Discord impose une limite de changements) :", e.message);
        }
    }

    const configCommand = new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configuration du Splatfest')
        .addSubcommand(sub =>
            sub.setName('splatfest')
                .setDescription('Démarrer la configuration interactive du Splatfest'));

    const nameCommand = new SlashCommandBuilder()
        .setName('add')
        .setDescription('Ajouter votre nom Splatoon')
        .addSubcommand(sub =>
            sub.setName('name')
                .setDescription('Enregistrer votre nom pour le Splatfest'));

    const teamsCommand = new SlashCommandBuilder()
        .setName('teams')
        .setDescription('Télécharger la liste des équipes (.txt)');

    const opCommand = new SlashCommandBuilder()
        .setName('op')
        .setDescription('Commandes opérateur')
        .addSubcommand(sub =>
            sub.setName('match')
                .setDescription('Tirer au sort le type de match (x10, x100, x333)'));

    const resetCommand = new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Réinitialisation de données')
        .addSubcommand(sub =>
            sub.setName('savedata')
                .setDescription('Réinitialise les données Splatfest de votre save.dat')
                .addAttachmentOption(option =>
                    option.setName('file')
                        .setDescription('Votre fichier save.dat')
                        .setRequired(true)));

    const setDatesCommand = new SlashCommandBuilder()
        .setName('set')
        .setDescription('Paramètres administratifs')
        .addSubcommand(sub =>
            sub.setName('dates')
                .setDescription('Définir les dates du Splatfest (JJ/MM/AAAA)')
                .addStringOption(option =>
                    option.setName('start')
                        .setDescription('Date de début (ex: 28/01/2026)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('end')
                        .setDescription('Date de fin (ex: 30/01/2026)')
                        .setRequired(true)));

    console.log('Synchronisation des commandes...');
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.set([configCommand, nameCommand, teamsCommand, opCommand, resetCommand, setDatesCommand]);
            console.log(`Commandes synchronisées sur : ${guild.name}`);
        } catch (e) {
            console.error(`Erreur sur ${guild.name}: ${e.message}`);
        }
    }

    // Lancer le scheduler
    startScheduler();
});

// --- LOGIQUE DE ROTATION ET PLANNING ---
const ROTATIONS = [
    { hour: 0, mode: "Turf War" },
    { hour: 2, mode: "Splat Zones" },
    { hour: 4, mode: "Tower Control" },
    { hour: 6, mode: "Turf War" },
    { hour: 8, mode: "Rainmaker" },
    { hour: 10, mode: "Turf War" }
];

function getFormattedMode(hour) {
    const cycleHour = hour % 12;
    // Trouver la rotation qui correspond à l'heure actuelle du cycle de 12h
    const rot = ROTATIONS.slice().reverse().find(r => cycleHour >= r.hour);
    return rot ? rot.mode : "Turf War";
}

let isFestivalActive = false;

function startScheduler() {
    setInterval(async () => {
        const now = new Date();
        const nowTs = now.getTime();
        const hour = now.getHours();

        if (!currentSplatfest.startDate || !currentSplatfest.endDate) return;

        const startTs = currentSplatfest.startDate;
        const endTs = currentSplatfest.endDate;

        // Salon BATTLE_LOG pour le début/fin
        const battleChannel = await client.channels.fetch(BATTLE_LOG_CHANNEL_ID).catch(() => null);
        // Salon MATCHMAKING pour les rotations
        const matchChannel = await client.channels.fetch(MATCHMAKING_CHANNEL_ID).catch(() => null);

        if (!battleChannel || !matchChannel) return;

        // Début du festival
        if (nowTs >= startTs && nowTs < endTs && !isFestivalActive) {
            isFestivalActive = true;
            await battleChannel.send(`@everyone\n\nSplatfest has begun! Stay tuned to the ${MATCHMAKING_CH_MENTION} channel to find matches!`);
        }

        // Fin du festival
        if (nowTs >= endTs && isFestivalActive) {
            isFestivalActive = false;
            await battleChannel.send(`@everyone\n\n# 🏁 Festival Over!\nThanks for playing, squids!\nUntil the next battle 🦑✨`);
            currentSplatfest.startDate = null;
            currentSplatfest.endDate = null;
            saveSplatfestData();
            return;
        }

        // Rotations toutes les 2h (pendant le festival, dans MATCHMAKING_CHANNEL_ID)
        if (isFestivalActive && hour % 2 === 0 && hour !== (currentSplatfest.lastRotationHour ?? -1) && hour < 21) {
            const mode = getFormattedMode(hour);
            await matchChannel.send(`📢 **Stage Rotation!**\nThe current mode is now: **${mode}** 🦑\nGo join the battle right here!`);
            currentSplatfest.lastRotationHour = hour;
            saveSplatfestData();
        }

        // Reset lastRotationHour à 0h pour la nouvelle journée
        if (hour === 0 && currentSplatfest.lastRotationHour !== -1 && currentSplatfest.lastRotationHour > 20) {
            currentSplatfest.lastRotationHour = -1;
            saveSplatfestData();
        }

    }, 60000); // Vérification chaque minute
}

// Aide pour vérifier si un membre a un rôle (plus robuste que .cache.has)
function hasRole(member, roleId) {
    if (!member) return false;
    return member.roles.cache.has(roleId) || (member._roles && member._roles.includes(roleId));
}

client.on('interactionCreate', async interaction => {
    // 1. Slash Commands
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'config' && interaction.options.getSubcommand() === 'splatfest') {
            if (!hasRole(interaction.member, OWNER_ROLE_ID)) {
                return interaction.reply({ content: "❌ Seuls les membres avec le rôle @owner peuvent configurer le Splatfest.", flags: [MessageFlags.Ephemeral] });
            }

            // Réinitialisation du fichier texte pour le nouveau Splatfest
            fs.writeFileSync(filePath, "Splatfest team names:\n\n", 'utf8');

            await interaction.reply({ content: "🎨 **Configuration du Splatfest lancée !**\nVeuillez répondre aux questions suivantes dans ce salon.", flags: [MessageFlags.Ephemeral] });

            const filter = m => m.author.id === interaction.user.id;
            const channel = interaction.channel;

            try {
                await channel.send("1️⃣ Quel est le **rôle** pour la Team Ayo ? (Mentionnez le rôle @Role)");
                const collectedRoleA = await channel.awaitMessages({ filter, max: 1, time: 60000 });
                const roleA = collectedRoleA.first().mentions.roles.first();
                if (!roleA) return channel.send("❌ Erreur : Vous devez mentionner un rôle.");

                await channel.send("2️⃣ Quel est le **rôle** pour la Team Oly ? (Mentionnez le rôle @Role)");
                const collectedRoleB = await channel.awaitMessages({ filter, max: 1, time: 60000 });
                const roleB = collectedRoleB.first().mentions.roles.first();
                if (!roleB) return channel.send("❌ Erreur : Vous devez mentionner un rôle.");

                await channel.send("3️⃣ Quel **émoji** les utilisateurs doivent réagir pour la Team Ayo ?");
                const collectedEmojiA = await channel.awaitMessages({ filter, max: 1, time: 60000 });
                const emojiA = collectedEmojiA.first().content.trim();

                await channel.send("4️⃣ Quel **émoji** les utilisateurs doivent réagir pour la Team Oly ?");
                const collectedEmojiB = await channel.awaitMessages({ filter, max: 1, time: 60000 });
                const emojiB = collectedEmojiB.first().content.trim();

                currentSplatfest = { roleA: roleA.id, roleB: roleB.id, emojiA, emojiB };

                const announcement = `@everyone 
🎤 **Splatfest Announcement!**
Hey Inklings and Octolings!
A fresh new Splatfest is about to hit Inkopolis, and it’s time to choose your side. The plaza lights are glowing, the music is pumping, and the turf is waiting for your ink!

🎉 **Which team will YOU join?**
<@&${roleA.id}> — Bright, bold, and ready to shine
<@&${roleB.id}> — Strong, steady, and ready to fight

To join the battle, react with the emoji of your team:
${emojiA} for <@&${roleA.id}>  
${emojiB} for <@&${roleB.id}>

Pick your side, show your colors, and get ready for the freshest showdown in Inkopolis.

Stay fresh! 🦑💥`;

                const announcementChannel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
                const sentMessage = await announcementChannel.send(announcement);
                await sentMessage.react(emojiA);
                await sentMessage.react(emojiB);
                currentSplatfest.announcementMessageId = sentMessage.id;

                saveSplatfestData();

                await channel.send(`✅ **Annonce envoyée dans <#${ANNOUNCEMENT_CHANNEL_ID}> !**`);
            } catch (e) {
                console.error(e);
                channel.send("❌ La configuration a expiré ou une erreur est survenue.");
            }
        }

        if (interaction.commandName === 'add' && interaction.options.getSubcommand() === 'name') {
            const hasRoleA = interaction.member.roles.cache.has(currentSplatfest.roleA);
            const hasRoleB = interaction.member.roles.cache.has(currentSplatfest.roleB);

            if (!hasRoleA && !hasRoleB) {
                return interaction.reply({ content: "❌ Vous devez d'abord choisir une équipe en réagissant à l'annonce !", flags: [MessageFlags.Ephemeral] });
            }

            const modal = new ModalBuilder()
                .setCustomId('splatoonNameModal')
                .setTitle('Splatfest Registration');

            const nameInput = new TextInputBuilder()
                .setCustomId('splatoonNameInput')
                .setLabel("Nom dans Splatoon (Invisible pour les autres)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            await interaction.showModal(modal);
        }

        if (interaction.commandName === 'teams') {
            const isMatchmaker = hasRole(interaction.member, MATCHMAKER_ROLE_ID) || hasRole(interaction.member, OWNER_ROLE_ID);
            // Vérification du rôle Splatfest Hoster / Matchmaker (même ID)
            if (!isMatchmaker) {
                return interaction.reply({ content: "❌ Seuls les membres avec le rôle @Matchmaker peuvent télécharger la liste.", flags: [MessageFlags.Ephemeral] });
            }

            if (!fs.existsSync(filePath)) {
                return interaction.reply({ content: "❌ Le fichier est introuvable.", flags: [MessageFlags.Ephemeral] });
            }

            await interaction.reply({
                content: "📄 Voici la liste actuelle des équipes :",
                files: [filePath],
                flags: [MessageFlags.Ephemeral]
            });
        }

        if (interaction.commandName === 'op' && interaction.options.getSubcommand() === 'match') {
            const isMatchmaker = hasRole(interaction.member, MATCHMAKER_ROLE_ID) || hasRole(interaction.member, OWNER_ROLE_ID);
            // Restriction rôle
            if (!isMatchmaker) {
                return interaction.reply({ content: "❌ Seuls les Matchmakers peuvent utiliser cette commande.", flags: [MessageFlags.Ephemeral] });
            }

            // Calcul des nouvelles probabilités
            const rand = Math.random() * 100;
            let matchType = "Normal";

            if (rand <= 5) {
                matchType = "x333"; // 5%
            } else if (rand <= 20) {
                matchType = "x100"; // 5 + 15 = 20
            } else if (rand <= 50) {
                matchType = "x10"; // 20 + 30 = 50
            } else {
                matchType = "Normal"; // Reste (50%)
            }

            await interaction.reply({ content: `🎲 Tirage en cours...`, flags: [MessageFlags.Ephemeral] });

            const matchmakingChannel = await client.channels.fetch(MATCHMAKING_CHANNEL_ID);
            if (matchmakingChannel) {
                await matchmakingChannel.send(`# ||${matchType}|| match!`);
            }
        }

        if (interaction.commandName === 'reset' && interaction.options.getSubcommand() === 'savedata') {
            const attachment = interaction.options.getAttachment('file');

            if (!attachment.name.endsWith('.dat')) {
                return interaction.reply({ content: "❌ Veuillez envoyer un fichier `.dat` (généralement `save.dat`).", flags: [MessageFlags.Ephemeral] });
            }

            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            https.get(attachment.url, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', async () => {
                    let buffer = Buffer.concat(chunks);
                    const receivedSize = buffer.length;

                    // Détermination de l'offset selon la taille du fichier
                    // Full save (Wii U dump) : ~1 Mo, data à 0x24000
                    // Compact save (SaveMii/Decrypted) : ~52 Ko
                    let OFFSET_START;
                    if (receivedSize >= 1048576) {
                        OFFSET_START = 0x242D0;
                    } else if (receivedSize >= 53888) {
                        OFFSET_START = 0xB2E0; // Offset identifié pour le format Compact (SaveMii)
                    } else {
                        return interaction.editReply({
                            content: `❌ Le fichier reçu est trop petit (${receivedSize} octets). Un fichier \`save.dat\` valide doit faire au moins 53 888 octets.`
                        });
                    }

                    const OFFSET_END = OFFSET_START + 16;

                    // Vider les 16 octets avec des zéros
                    for (let i = OFFSET_START; i < OFFSET_END; i++) {
                        buffer[i] = 0x00;
                    }

                    // Correction du Checksum pour le format Compact (~52KB)
                    if (receivedSize < 1048576) {
                        const newCrc = calculateCRC32(buffer, 0x10, buffer.length);
                        buffer.writeUInt32BE(newCrc, 0x08);
                        console.log(`[Marie] Checksum corrigé : 0x${newCrc.toString(16).toUpperCase()}`);
                    }

                    // Créer un fichier temporaire pour le renvoi
                    const tempPath = path.join(__dirname, 'temp_save.dat');
                    fs.writeFileSync(tempPath, buffer);

                    await interaction.editReply({
                        content: "✅ Ta sauvegarde a été réinitialisée ! Voici ton nouveau fichier `save.dat`. Remplace l'ancien sur ta Wii U via SaveMii.",
                        files: [{
                            attachment: tempPath,
                            name: 'save.dat'
                        }]
                    });

                    // Supprimer le fichier temporaire après envoi
                    fs.unlinkSync(tempPath);
                });
            }).on('error', (err) => {
                console.error(err);
                interaction.editReply({ content: "❌ Erreur lors du téléchargement du fichier." });
            });
        }

        if (interaction.commandName === 'set' && interaction.options.getSubcommand() === 'dates') {
            if (!hasRole(interaction.member, OWNER_ROLE_ID)) {
                return interaction.reply({ content: "❌ Seuls les membres avec le rôle @owner peuvent définir les dates.", flags: [MessageFlags.Ephemeral] });
            }

            const startStr = interaction.options.getString('start');
            const endStr = interaction.options.getString('end');

            const parseDate = (str) => {
                const parts = str.split('/');
                if (parts.length !== 3) return null;
                const d = new Date(parts[2], parts[1] - 1, parts[0], 0, 0, 0);
                return isNaN(d.getTime()) ? null : d.getTime();
            };

            const startTs = parseDate(startStr);
            const endTs = parseDate(endStr);

            if (!startTs || !endTs) {
                return interaction.reply({ content: "❌ Format de date invalide. Utilisez `JJ/MM/AAAA` (ex: 28/01/2026).", flags: [MessageFlags.Ephemeral] });
            }

            currentSplatfest.startDate = startTs;
            currentSplatfest.endDate = endTs;
            currentSplatfest.lastRotationHour = -1;
            saveSplatfestData();

            await interaction.reply({ content: `✅ Dates du Splatfest enregistrées !\n🏁 Début : ${startStr}\n🔚 Fin : ${endStr}\n\nMarie s'occupera des annonces automatiquement !`, flags: [MessageFlags.Ephemeral] });
        }
    }

    // 2. Modal Submit
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'splatoonNameModal') {
            const splatName = interaction.fields.getTextInputValue('splatoonNameInput');
            const hasRoleA = interaction.member.roles.cache.has(currentSplatfest.roleA);
            const teamLabel = hasRoleA ? "team A" : "team B";

            const entry = `"${splatName}" = "${teamLabel}"\n`;

            try {
                fs.appendFileSync(filePath, entry, 'utf8');
                await interaction.reply({ content: `✅ Merci **${splatName}** ! Ton nom a été enregistré pour la **${teamLabel}**. 🦑`, flags: [MessageFlags.Ephemeral] });
            } catch (e) {
                console.error(e);
                await interaction.reply({ content: "❌ Erreur lors de l'enregistrement.", flags: [MessageFlags.Ephemeral] });
            }
        }
    }
});

// Réactions : Rôles et Protection
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.message.id !== currentSplatfest.announcementMessageId) return;

    try {
        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        const isEmojiA = reaction.emoji.name === currentSplatfest.emojiA || reaction.emoji.toString() === currentSplatfest.emojiA;
        const isEmojiB = reaction.emoji.name === currentSplatfest.emojiB || reaction.emoji.toString() === currentSplatfest.emojiB;

        if (isEmojiA) {
            // Si l'utilisateur change de team (retrait Team B)
            if (member.roles.cache.has(currentSplatfest.roleB)) {
                await member.roles.remove(currentSplatfest.roleB);
                // Retirer l'ancienne réaction de l'autre team
                const otherReaction = reaction.message.reactions.cache.find(r => r.emoji.name === currentSplatfest.emojiB || r.emoji.toString() === currentSplatfest.emojiB);
                if (otherReaction) await otherReaction.users.remove(user.id).catch(() => { });
            }
            await member.roles.add(currentSplatfest.roleA);
        } else if (isEmojiB) {
            // Si l'utilisateur change de team (retrait Team A)
            if (member.roles.cache.has(currentSplatfest.roleA)) {
                await member.roles.remove(currentSplatfest.roleA);
                // Retirer l'ancienne réaction de l'autre team
                const otherReaction = reaction.message.reactions.cache.find(r => r.emoji.name === currentSplatfest.emojiA || r.emoji.toString() === currentSplatfest.emojiA);
                if (otherReaction) await otherReaction.users.remove(user.id).catch(() => { });
            }
            await member.roles.add(currentSplatfest.roleB);
        } else {
            // Suppression de la réaction non autorisée
            await reaction.users.remove(user.id);
        }
    } catch (e) { console.error("Erreur gestion réaction :", e.message); }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot || reaction.message.id !== currentSplatfest.announcementMessageId) return;
    try {
        const member = await reaction.message.guild.members.fetch(user.id);
        if (reaction.emoji.name === currentSplatfest.emojiA || reaction.emoji.toString() === currentSplatfest.emojiA) await member.roles.remove(currentSplatfest.roleA);
        if (reaction.emoji.name === currentSplatfest.emojiB || reaction.emoji.toString() === currentSplatfest.emojiB) await member.roles.remove(currentSplatfest.roleB);
    } catch (e) { console.error(e); }
});

// --- SYSTÈME D'IA EN DM ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.guild) return; // Uniquement DMs

    const content = message.content.toLowerCase();
    const userName = message.author.globalName || message.author.username;

    // Détection de langue
    const isFrench = content.includes('problème') || content.includes('aide') || content.includes('marche pas') || content.includes('salut') || content.includes('comment') || content.includes('compris') || content.includes('installer') || content.includes('chemin');

    await message.channel.sendTyping();

    try {
        const supportChannel = await client.channels.fetch(SUPPORT_CHANNEL_ID).catch(() => null);
        let lessonsLoaded = [];

        if (supportChannel) {
            const messages = await supportChannel.messages.fetch({ limit: 100 });
            lessonsLoaded = messages.filter(m => !m.author.bot).map(m => m.content);
        }

        // --- MOTEUR DE "REBORN TEACHER" ---
        const teach = (input, context) => {
            const inputLower = input.toLowerCase();

            // On cherche la leçon la plus pertinente dans le contexte
            let bestLesson = "";
            let maxScore = 0;

            context.forEach(lesson => {
                const lessonLower = lesson.toLowerCase();
                // On privilégie les mots techniques
                const techKeywords = ['boss', 'ftp', 'storage_usb', 'storage_mlc', 'opt', 'common', 'install', 'save', 'reset', 'savedata', 'chemin', 'path'];
                let score = techKeywords.filter(k => inputLower.includes(k) && lessonLower.includes(k)).length * 2;

                // On ajoute un score pour les mots communs non vides (min 3 lettres)
                const commonWords = inputLower.split(/\s+/).filter(w => w.length >= 3);
                score += commonWords.filter(w => lessonLower.includes(w)).length;

                if (score > maxScore) {
                    maxScore = score;
                    bestLesson = lesson;
                }
            });

            if (maxScore < 2) return null; // Pas assez pertinent

            // --- SYNTHÈSE PERSONNALISÉE (PAS DE COPIER-COLLER) ---

            // Cas FTP / BOSS FILES
            if (bestLesson.includes('BOSS FILES') || bestLesson.includes('opt/')) {
                return isFrench ? `Alors, concernant ta question sur les **fichiers boss**, c'est tout bête ! 🎓
        
Imagine que ta Wii U est comme un casier. Tu dois aller mettre les nouveaux fichiers exactement là où sont les anciens. Voici le "cours" pour toi :
1️⃣ Connecte-toi via FTP.
2️⃣ Si tes jeux sont sur USB, va dans : \`/storage_usb/usr/boss/00050000/10176a00/user/common/data/opt/\`
3️⃣ Si c'est sur la mémoire de la console, c'est dans : \`/storage_mlc/usr/boss/00050000/10176a00/user/common/data/opt/\`
4️⃣ Remplace les fichiers par les nouveaux. 

Pense bien à le faire à **chaque festival**, d'accord ? 🥰`
                    : `Alright, about the **boss files**, it's super simple! 🎓
        
Think of your Wii U like a locker. You need to put the new files exactly where the old ones are. Here's your "lesson":
1️⃣ Connect via FTP.
2️⃣ If your games are on USB, go to: \`/storage_usb/usr/boss/00050000/10176a00/user/common/data/opt/\`
3️⃣ If it's on the console memory, it's in: \`/storage_mlc/usr/boss/00050000/10176a00/user/common/data/opt/\`
4️⃣ Replace the files with the new ones.

Make sure to do this for **every festival**, okay? 🥰`;
            }

            // Cas SAVE / RESET
            if (bestLesson.includes('save.dat') || bestLesson.includes('/reset')) {
                return isFrench ? `Ah, pour ta **sauvegarde**, j'ai la solution ! ✨
        
C'est très simple : envoie-moi ton fichier \`save.dat\` en utilisant ma commande \`/reset savedata\`. Je vais le "nettoyer" pour qu'il soit tout propre pour le nouveau festival. Tu n'as rien d'autre à faire, je m'occupe de tout le côté technique !`
                    : `Ah, for your **save file**, I've got the fix! ✨
        
It's very simple: just send me your \`save.dat\` file using my \`/reset savedata\` command. I'll "clean" it up so it's ready for the new festival. You don't have to do anything else, I'll handle the technical part!`;
            }

            // Cas REGISTRATION
            if (bestLesson.includes('/add name')) {
                return isFrench ? `Tu veux t'enregistrer ? Voici comment faire comme un pro :
🎒 D'abord, choisis ton équipe dans le salon des annonces.
👤 Ensuite, utilise ma commande \`/add name\` pour m'enregistrer ton pseudo exact.
C'est indispensable pour que je te reconnaisse pendant le Splatfest ! 🥰`
                    : `Want to register? Here's how to do it like a pro:
🎒 First, pick your team in the announcement channel.
👤 Then, use my \`/add name\` command to give me your exact name.
It's mandatory so I can recognize you during the Splatfest! 🥰`;
            }

            // Cas par défaut (Réexplication IA)
            return isFrench ? `J'ai fouillé dans mes cours et voici ce qu'il faut retenir :
            
> ✨ En gros : ${bestLesson.replace(/#/g, '').split('\n').slice(0, 3).join(' ').substring(0, 200)}...
            
Pour mieux t'aider, je t'ai simplifié ça : essaye de suivre les étapes du tutoriel dans le salon d'aide, c'est vraiment la clé ! 💖`
                : `I've looked into my notes and here's the main point:
            
> ✨ Basically: ${bestLesson.replace(/#/g, '').split('\n').slice(0, 3).join(' ').substring(0, 200)}...
            
To help you better, I've simplified it: just try to follow the steps in the help channel, that's really the secret! 💖`;
        };

        const explanation = teach(message.content, lessonsLoaded);

        if (content.includes('save') || content.includes('donnée') || content.includes('reset')) {
            await message.reply(isFrench ? `Coucou **${userName}** ! ✨ Pour ta sauvegarde, utilise simplement ma commande \`/reset savedata\` avec ton \`save.dat\`. Je vais te le préparer pour le festival en un clin d'œil !`
                : `Hi **${userName}**! ✨ For your save file, just use my \`/reset savedata\` command with your \`save.dat\`. I'll have it festival-ready in no time!`);
        } else if (explanation) {
            await message.reply(isFrench ? `Ne t'en fais pas **${userName}**, Marie la prof est là ! 🎓💖\n\n${explanation}`
                : `Don't worry **${userName}**, Teacher Marie is here! 🎓💖\n\n${explanation}`);
        } else {
            // Pas de réponse si rien n'est matché pour éviter de spammer en DM
        }

    } catch (e) {
        console.error(e);
        // On évite de répondre en cas d'erreur pour ne pas bloquer les DMs
    }
});

client.login(TOKEN);
