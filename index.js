// A Discord bot to handle ticket creation and management.
// The bot uses Discord.js v14.

// Require the necessary discord.js and other classes
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  Events,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActivityType
} = require("discord.js");
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const qrcode = require('qrcode'); // NEW: Require the qrcode library
const { joinVoiceChannel, VoiceConnectionStatus } = require('@discordjs/voice'); // NEW: Require voice classes

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers, // KEEP THIS INTENT!
    GatewayIntentBits.GuildPresences, // REQUIRED for role member counts
    GatewayIntentBits.GuildVoiceStates, // REQUIRED for bot to join and stay in voice channel
  ],
  partials: [Partials.Channel],
});

// Configuration - IMPORTANT: Update these values for your server!
const GUILD_ID = process.env.GUILD_ID || 'YOUR_GUILD_ID';
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_BOT_CLIENT_ID';
const BOT_TOKEN = process.env.BOT_TOKEN;

const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || 'YOUR_TICKET_CATEGORY_ID';
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || 'YOUR_STAFF_ROLE_ID'; // Role ID for staff/moderators
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || 'YOUR_LOG_CHANNEL_ID';
const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID || 'YOUR_MOD_LOG_CHANNEL_ID';
const SUGGESTION_CHANNEL_ID = process.env.SUGGESTION_CHANNEL_ID || 'YOUR_SUGGESTION_CHANNEL_ID';
const WELCOME_CHANNEL_ID = '1472186353830854777';
const INVOICE_LOG_CHANNEL_ID = '1431598472649375754'; // New: Channel ID for invoice logs
const AUTO_ROLE_ID = process.env.AUTO_ROLE_ID || 'YOUR_AUTO_ROLE_ID';

// Channel ID for order logs.  Prefer the value from .env so it can be changed without editing code.
const ORDER_LOG_CHANNEL_ID = process.env.ORDER_LOG_CHANNEL_ID || '1425850071689461873'; // fallback if env is missing

// --- VOICE CHANNEL CONFIGURATION ---
// BOT WILL ALWAYS ATTEMPT TO JOIN AND STAY IN THIS CHANNEL. Set in .env
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID; 
// --- END VOICE CHANNEL CONFIGURATION ---

// --- DYNAMIC STATS CONFIGURATION ---
const STATS_CHANNEL_ID = '1472186376232505356'; // <<< SET THE CHANNEL ID HERE
const STATS_CUSTOMER_ROLE_ID = '1431599691136761906'; // Role ID for "Total Customers" count
const REVIEWS_COUNT_CHANNEL_ID = '1425849520952180897'; // Channel ID to count messages for "Total Reviews"
const STATS_FILE_PATH = path.join(__dirname, 'stats.json'); // Path to store persistent stats data
let persistentStats = { messageId: null, lastOrders: 77, lastCustomers: 0, lastReviews: 0 };
// --- END DYNAMIC STATS CONFIGURATION ---

// --- NEW REVIEW SYSTEM CONFIGURATION ---
const REVIEW_CHANNEL_ID = process.env.REVIEW_CHANNEL_ID || 'YOUR_REVIEW_CHANNEL_ID'; // Channel where approved reviews are displayed
const PENDING_REVIEW_LOG_CHANNEL_ID = process.env.PENDING_REVIEW_LOG_CHANNEL_ID || 'YOUR_PENDING_REVIEW_LOG_CHANNEL_ID'; // Channel for staff to see pending reviews
const REVIEW_SUBMITTER_ROLE_ID = '1431599691136761906'; // Role ID for users allowed to submit reviews
const REVIEWS_FILE_PATH = path.join(__dirname, 'reviews.json'); // Path to store reviews
// --- END NEW REVIEW SYSTEM CONFIGURATION ---

// --- NEW AFK SYSTEM CONFIGURATION ---
const AFK_FILE_PATH = path.join(__dirname, 'afk.json'); // Path to store AFK data
const afkUsers = new Map(); // Global Map to store AFK users (will be loaded from file)
// --- END NEW AFK SYSTEM CONFIGURATION ---

// --- NEW UPI SYSTEM CONFIGURATION ---
const UPI_IDS_FILE_PATH = path.join(__dirname, 'upi_ids.json'); // Path to store user UPI IDs
const upiUsers = new Map(); // Global Map to store user UPI IDs (will be loaded from file)
// --- END NEW UPI SYSTEM CONFIGURATION ---

// --- NEW ORDER SYSTEM CONFIGURATION ---
const ORDERS_FILE_PATH = path.join(__dirname, 'orders.json'); // Path to store order numbers
let currentOrderNumber = 77; // Default or initial value
// --- END NEW ORDER SYSTEM CONFIGURATION ---

// Define a directory for transcripts
const TRANSCRIPT_DIR = path.join(__dirname, 'transcripts');

// Service options (used for ticket system and now for review service selection)
const serviceOptions = [
  { id: 'help', label: 'Help / General Inquiry', emoji: '❓' },
  { id: 'buy', label: 'Buy', emoji: '🛒' },
  { id: 'reward_claim', label: 'Reward Claim', emoji: '🎁' },
  { id: 'partnership', label: 'Partnership Inquiry', emoji: '🤝' },
];

// Define slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Closes the current ticket channel.')
    .addStringOption(option => 
        option.setName('reason')
            .setDescription('The reason for closing the ticket.')
            .setRequired(false))
    .toJSON(),
  // NEW: Add user to ticket command
  new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Adds a user to the current ticket channel.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to add to the ticket.')
            .setRequired(true))
    .toJSON(),
  // Removed the old static /qr command
  // Moderation Commands
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kicks a user from the server.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to kick.')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the kick.')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bans a user from the server.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to ban.')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the ban.')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeouts (mutes) a user for a specified duration.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to timeout.')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Duration of timeout in minutes (e.g., 60 for 1 hour, 1440 for 1 day). Max 28 days.')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the timeout.')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Removes timeout from a user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to untimeout.')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removing timeout.')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Deletes a specified number of messages from the channel.')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('The number of messages to delete (1-100).')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100))
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Optional: Only delete messages from this user.')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Locks the current channel or a specified channel, preventing @everyone from sending messages.')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('The channel to lock (defaults to current channel).')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildNews, ChannelType.GuildForum)
            .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlocks the current channel or a specified channel, allowing @everyone to send messages.')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('The channel to unlock (defaults to current channel).')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildNews, ChannelType.GuildForum)
            .setRequired(false))
    .toJSON(),
  // Information Commands
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Displays information about a user.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to get info about (defaults to yourself).')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Displays information about the server.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Displays a user\'s avatar.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user whose avatar to display (defaults to yourself).')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Displays information about a role.')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The role to get info about.')
        .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Displays information about a channel.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to get info about (defaults to current channel).')
        .setRequired(false))
    .toJSON(),
  // Utility/Fun Commands
  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8-ball a yes/no question.')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('The yes/no question to ask.')
        .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Rolls a dice.')
    .addIntegerOption(option =>
      option.setName('sides')
        .setDescription('Number of sides on the dice (default: 6).')
        .setRequired(false)
        .setMinValue(2))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Creates a simple poll with emoji reactions.')
    .addStringOption(option =>
        option.setName('question')
            .setDescription('The question for the poll.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('options')
            .setDescription('Comma-separated options for the poll (e.g., Option1, Option2, Option3). Max 9 options.')
            .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Sets a reminder for yourself.')
    .addIntegerOption(option =>
      option.setName('time')
        .setDescription('The amount of time for the reminder.')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('unit')
        .setDescription('The unit of time.')
        .setRequired(true)
        .addChoices(
          { name: 'Seconds', value: 's' },
          { name: 'Minutes', value: 'm' },
          { name: 'Hours', value: 'h' },
          { name: 'Days', value: 'd' }
        ))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message for the reminder.')
        .setRequired(true))
    .toJSON(),
    // NEW: Remind command as a slash command
    new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Sends a reminder DM to a user about their ticket.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to remind (defaults to ticket owner).')
                .setRequired(false))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The ticket channel to link (defaults to current channel).')
                .setRequired(false))
        .toJSON(),
  new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submit a suggestion for the server.')
    .addStringOption(option =>
      option.setName('suggestion')
        .setDescription('Your suggestion.')
        .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Sets your AFK status.')
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Your AFK message (optional).')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Sends a custom embed message (Admin only).')
    .addStringOption(option =>
      option.setName('json')
        .setDescription('JSON string for the embed object.')
        .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Displays bot statistics.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays a list of commands or detailed info about a specific command.')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('The command to get help for.')
        .setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName('invoice')
    .setDescription('Sends an invoice to a customer via DM.')
    .addUserOption(option =>
        option.setName('customer')
            .setDescription('The customer to send the invoice to.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('Description of the service/product.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('amount')
            .setDescription('The amount due (e.g., "$50.00 USD" or "0.005 BTC").')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('date')
            .setDescription('The due date for the invoice (e.g., "YYYY-MM-DD", "in 7 days").')
            .setRequired(false))
    .addStringOption(option =>
        option.setName('paymentlink')
            .setDescription('Optional: A link for payment (e.g., PayPal, Stripe invoice link).')
            .setRequired(false))
    .addStringOption(option =>
        option.setName('notes')
            .setDescription('Optional: Additional notes for the customer.')
        .setRequired(false))
    .toJSON(),
  // --- NEW REVIEW SYSTEM COMMANDS ---
  // Removed the /submitreview slash command definition here to make the button the sole entry point
  new SlashCommandBuilder()
    .setName('managereviews')
    .setDescription('Manage pending user reviews (Staff only).')
    .toJSON(),
  // --- END NEW REVIEW SYSTEM COMMANDS ---
  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send an embed message to a user via DM.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to DM.')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Title of the embed.')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('description')
      .setDescription('Description of the embed.')
      .setRequired(false))
    .addStringOption(option =>
      option.setName('footer')
        .setDescription('Footer text for the embed.')
        .setRequired(false))
    .toJSON(),
    // === NEW ORDER COMMAND ===
    new SlashCommandBuilder()
        .setName('order')
        .setDescription('Creates a new order with product and quantity.')
        .addStringOption(option =>
            option.setName('product')
                .setDescription('The product you want to order.')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('quantity')
                .setDescription('The quantity of the product.')
                .setRequired(true)
                .setMinValue(1))
        .addUserOption(option =>
            option.setName('buyer')
                .setDescription('Optional: The user who is placing the order.')
                .setRequired(false))
        .toJSON(),
    // === NEW ORDER STATUS COMMAND ===
    new SlashCommandBuilder()
        .setName('setorderstatus')
        .setDescription('Updates the status of an existing order (Staff only).')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The message ID of the order to update.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('status')
                .setDescription('The new status for the order.')
                .setRequired(true)
                .addChoices(
                    { name: 'Pending', value: 'Pending' },
                    { name: 'In Progress', value: 'In Progress' },
                    { name: 'Shipped', value: 'Shipped' },
                    { name: 'Completed', value: 'Completed' },
                    { name: 'Cancelled', value: 'Cancelled' }
                ))
        .toJSON(),
    // === NEW UPI COMMANDS ===
    new SlashCommandBuilder()
        .setName('setupi')
        .setDescription('Sets your default UPI ID for QR code generation.')
        .addStringOption(option =>
            option.setName('upi_id')
                .setDescription('Your UPI ID (e.g., yourname@bank)')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('upi')
        .setDescription('UPI related commands.')
        .addSubcommand(subcommand =>
            subcommand.setName('qr')
                .setDescription('Generates a QR code with a requested amount.')
                .addNumberOption(option =>
                    option.setName('amount')
                        .setDescription('The amount for the payment (e.g., 100.50)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('note')
                        .setDescription('A custom note for the payment.')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('upi_id')
                        .setDescription('Optional: The UPI ID to use (defaults to your saved ID).')
                        .setRequired(false)))
        .toJSON(),
    // --- NEW TICKET CLAIMING COMMANDS ---
    new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claims the current ticket for a staff member.')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('unclaim')
        .setDescription('Unclaims the current ticket.')
        .toJSON()
];

// --- VOICE CHANNEL CONNECTION LOGIC ---

/**
 * Joins the specified voice channel and sets up an auto-reconnect listener.
 * @param {Client} client - The Discord client instance.
 * @param {string} guildId - The ID of the guild.
 * @param {string} channelId - The ID of the voice channel.
 */
function joinAndStayInVoiceChannel(client, guildId, channelId) {
    const guild = client.guilds.cache.get(guildId);
    const channel = guild ? guild.channels.cache.get(channelId) : null;

    if (!channel || channel.type !== ChannelType.GuildVoice) {
        console.error(`[VOICE] Voice Channel with ID ${channelId} not found or is not a voice channel. Skipping automatic join.`);
        return;
    }

    const connection = joinVoiceChannel({
        channelId: channelId,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true, // Deafens the bot so it doesn't transmit audio
        selfMute: false,
    });

    console.log(`[VOICE] Successfully joined channel: ${channel.name}`);

    // Listener to automatically rejoin if disconnected
    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
        try {
            console.log(`[VOICE] Disconnected from ${channel.name}. Attempting reconnect in 5s...`);
            // Wait 5 seconds before attempting to rejoin to avoid rate limits/race conditions
            await new Promise(resolve => setTimeout(resolve, 5000)); 
            // Attempt to re-establish connection
            joinAndStayInVoiceChannel(client, guildId, channelId); 
        } catch (error) {
            connection.destroy();
            console.error(`[VOICE] Error during voice channel reconnect attempt:`, error);
        }
    });

    connection.on('error', error => {
        console.error(`[VOICE] Voice connection error in ${channel.name}:`, error);
        // Destroy the connection; the Disconnected listener will handle the re-connect
        connection.destroy(); 
    });
}

// --- STATS DATA PERSISTENCE FUNCTIONS ---
/**
 * Loads persistent stats data from the stats.json file.
 */
async function loadStatsData() {
    try {
        const data = await fs.readFile(STATS_FILE_PATH, 'utf8');
        persistentStats = JSON.parse(data);
        // Ensure all required properties exist with defaults if missing
        if (!persistentStats.messageId) persistentStats.messageId = null;
        if (typeof persistentStats.lastOrders !== 'number') persistentStats.lastOrders = 77;
        if (typeof persistentStats.lastCustomers !== 'number') persistentStats.lastCustomers = 0;
        if (typeof persistentStats.lastReviews !== 'number') persistentStats.lastReviews = 0;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('stats.json not found, initializing with defaults.');
            await saveStatsData(persistentStats);
        } else {
            console.error("Error loading stats data:", error);
        }
    }
}

/**
 * Saves persistent stats data to the stats.json file.
 * @param {Object} data - The stats object to save.
 */
async function saveStatsData(data) {
    try {
        await fs.writeFile(STATS_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving stats data:", error);
    }
}

// --- CORE STATS MESSAGE UPDATE FUNCTION (UPDATED FOR EXACT REVIEWS COUNT) ---

/**
 * Calculates current statistics and updates the designated channel message.
 * This runs every 60 seconds.
 */
async function updateStatsMessage() {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild || !persistentStats.messageId || !STATS_CHANNEL_ID) return;

    const statsChannel = guild.channels.cache.get(STATS_CHANNEL_ID);
    if (!statsChannel || !statsChannel.isTextBased()) {
        console.warn(`Stats channel with ID ${STATS_CHANNEL_ID} not found or is not a text channel.`);
        return;
    }

    try {
        // --- 1. Calculate Stats ---
        
        // Total Successful Orders: Use currentOrderNumber - 1 (for an exact count)
        const totalOrders = currentOrderNumber - 1; 

        // Total Customers: Count members with the specific role
        let totalCustomers = 0;
        const customerRole = guild.roles.cache.get(STATS_CUSTOMER_ROLE_ID);
        if (customerRole) {
            // Ensure members cache is populated for accurate role count 
            await guild.members.fetch({ force: false, withPresences: false }).catch(err => {
                console.warn("Could not fetch guild members for stats, relying on cache/partial data.", err.message);
            });
            totalCustomers = guild.members.cache.filter(member => member.roles.cache.has(STATS_CUSTOMER_ROLE_ID)).size;
        }

        // Total Approved Reviews: Load ALL reviews and filter by 'approved' status for exact count
        const allReviews = await loadReviews();
        const approvedReviews = allReviews.filter(r => r.status === 'approved');
        const totalReviews = approvedReviews.length;
        
        // --- 2. Create/Update Embed ---
        const statsEmbed = new EmbedBuilder()
            .setColor('#2b2d31') // Dark background color
            .setTitle('📈 Ender Store - Overall Insights')
            .setDescription(`**Stats last updated:** <t:${Math.floor(Date.now() / 1000)}:R>`)
            .addFields(
                // REMOVED '+' SIGN for exact count
                { name: '✅ Total Successful Orders', value: `\`${totalOrders}\``, inline: false },
                // KEPT '+' SIGN for approximate count (based on role)
                { name: '👥 Total Customers', value: `\`${totalCustomers}\`+`, inline: false },
                // UPDATED FIELD NAME and REMOVED '+' SIGN for exact count
                { name: '⭐ Total Feedbacks', value: `\`${totalReviews}\``, inline: false }
            )
            .setImage('attachment://stats.gif') // Assuming stats.gif is the animated image
            .setFooter({ text: 'Thank you for choosing Ender Store!' })
            .setTimestamp();
            
        // --- 3. Update Persistent Stats ---
        persistentStats.lastOrders = totalOrders;
        persistentStats.lastCustomers = totalCustomers;
        persistentStats.lastReviews = totalReviews;
        await saveStatsData(persistentStats);

        // --- 4. Edit Message ---
        const statsMessage = await statsChannel.messages.fetch(persistentStats.messageId).catch(() => null);

        if (statsMessage) {
            // Edit the existing message
            await statsMessage.edit({ embeds: [statsEmbed] }).catch(err => {
                 console.error("Error editing stats message:", err);
            });
        } else {
             console.error(`Stats message ID ${persistentStats.messageId} not found. Use !statssetup again.`);
        }

    } catch (error) {
        console.error("Error updating stats message:", error);
    }
}
// --- END CORE STATS MESSAGE UPDATE FUNCTION ---

// --- NEW AFK SYSTEM FUNCTIONS ---

/**
 * Loads AFK user data from the afk.json file.
 * @returns {Promise<Map<string, Object>>} A Map where keys are user IDs and values are AFK objects.
 */
async function loadAfkData() {
    try {
        const data = await fs.readFile(AFK_FILE_PATH, 'utf8');
        const afkArray = JSON.parse(data);
        afkUsers.clear(); // Clear existing map before loading
        afkArray.forEach(afkEntry => afkUsers.set(afkEntry.userId, afkEntry));
        return afkUsers;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('afk.json not found, returning empty Map.');
            return new Map();
        }
        console.error("Error loading AFK data:", error);
        return new Map();
    }
}

/**
 * Saves AFK user data to the afk.json file.
 * @param {Map<string, Object>} currentAfkUsers - The Map of AFK objects to save.
 */
async function saveAfkData(currentAfkUsers) {
    try {
        const afkArray = Array.from(currentAfkUsers.values());
        await fs.writeFile(AFK_FILE_PATH, JSON.stringify(afkArray, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving AFK data:", error);
    }
}

/**
 * Sends a log message to the log channel for AFK status changes.
 * @param {Guild} guild - The Discord guild.
 * @param {User} user - The user whose AFK status changed.
 * @param {string} type - 'set' or 'clear'.
 * @param {Object} afkInfo - The AFK information (status, timestamp, etc.).
 */
async function sendAfkLog(guild, user, type, afkInfo = {}) {
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel || !logChannel.isTextBased()) {
        console.warn(`Log channel with ID ${LOG_CHANNEL_ID} not found or is not a text channel.`);
        return;
    }

    let embed;
    if (type === 'set') {
        embed = new EmbedBuilder()
            .setColor('#f1c40f') // Yellow for AFK status set
            .setTitle('😴 User Went AFK')
            .setDescription(`${user.tag} is now AFK.`)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Status', value: afkInfo.status || 'No status provided', inline: true },
                { name: 'Time', value: `<t:${Math.floor(afkInfo.timestamp / 1000)}:R>`, inline: false }
            )
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
    } else if (type === 'clear') {
        const timeAfk = Math.round((Date.now() - afkInfo.timestamp) / 60000);
        embed = new EmbedBuilder()
            .setColor('#2ecc71') // Green for AFK status cleared
            .setTitle('👋 User Returned from AFK')
            .setDescription(`${user.tag} is no longer AFK.`)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Was AFK For', value: `${timeAfk} minutes`, inline: true }
            )
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();
    }

    if (embed) {
        try {
            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error("Error sending AFK log:", error);
        }
    }
}
// --- END NEW AFK SYSTEM FUNCTIONS ---

// --- NEW UPI SYSTEM FUNCTIONS ---
/**
 * Loads UPI ID data from the upi_ids.json file.
 * @returns {Promise<Map<string, string>>} A Map where keys are user IDs and values are UPI IDs.
 */
async function loadUpiIds() {
    try {
        const data = await fs.readFile(UPI_IDS_FILE_PATH, 'utf8');
        const upiArray = JSON.parse(data);
        upiUsers.clear(); // Clear existing map before loading
        upiArray.forEach(entry => upiUsers.set(entry.userId, entry.upiId));
        return upiUsers;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('upi_ids.json not found, returning empty Map.');
            return new Map();
        }
        console.error("Error loading UPI IDs:", error);
        return new Map();
    }
}

/**
 * Saves UPI ID data to the upi_ids.json file.
 * @param {Map<string, string>} currentUpiUsers - The Map of UPI IDs to save.
 */
async function saveUpiIds(currentUpiUsers) {
    try {
        const upiArray = Array.from(currentUpiUsers.entries()).map(([userId, upiId]) => ({ userId, upiId }));
        await fs.writeFile(UPI_IDS_FILE_PATH, JSON.stringify(upiArray, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving UPI IDs:", error);
    }
}
// --- END NEW UPI SYSTEM FUNCTIONS ---


/**
 * Loads reviews from the reviews.json file.
 * @returns {Promise<Array<Object>>} An array of review objects.
 */
async function loadReviews() {
    try {
        const data = await fs.readFile(REVIEWS_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File does not exist, return empty array
            return [];
        }
        console.error("Error loading reviews:", error);
        return [];
    }
}

/**
 * Saves reviews to the reviews.json file.
 * @param {Array<Object>} reviews - The array of review objects to save.
 */
async function saveReviews(reviews) {
    try {
        await fs.writeFile(REVIEWS_FILE_PATH, JSON.stringify(reviews, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving reviews:", error);
    }
}

/**
 * Loads the current order number from the orders.json file.
 * @returns {Promise<number>} The current order number.
 */
async function loadOrdersFile() {
    try {
        const data = await fs.readFile(ORDERS_FILE_PATH, 'utf8');
        const orderData = JSON.parse(data);
        return orderData.currentOrderNumber;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('orders.json not found, starting with default order number.');
            return 77;
        }
        console.error("Error loading orders data:", error);
        return 77;
    }
}

/**
 * Saves the current order number to the orders.json file.
 * @param {number} orderNumber - The current order number to save.
 */
async function saveOrdersFile(orderNumber) {
    try {
        const orderData = { currentOrderNumber: orderNumber };
        await fs.writeFile(ORDERS_FILE_PATH, JSON.stringify(orderData, null, 2), 'utf8');
    } catch (error) {
        console.error("Error saving orders data:", error);
    }
}

/**
 * Generates an Embed for an approved review.
 * @param {Client} client - The Discord client instance.
 * @param {Object} review - The review object.
 * @returns {EmbedBuilder} The Discord Embed.
 */
async function generateReviewEmbed(client, review) {
    // Fetch user to ensure correct avatar + username
    const user = await client.users.fetch(review.userId).catch(() => null);
    const userName = user ? user.username : review.userName || "Unknown User";
    const userAvatar = user ? user.displayAvatarURL({ dynamic: true, size: 1024 }) : null; // Ensure dynamic and size for a good quality avatar

    // Star rating system
    const filledStars = "⭐".repeat(review.rating);
    const emptyStars = "✦".repeat(5 - review.rating);
    const starDisplay = `${filledStars}${emptyStars}`;

    // Format date
    const reviewDate = new Date(review.timestamp).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });

    // Support both product & service for backward compatibility
    const productName = review.product || review.service || "Unknown Product";

    const embed = new EmbedBuilder()
        .setColor("#f39c12") // Gold for reviews
        .setTitle(`💬 New Review`)
        .setDescription(`''${review.reviewText}''`)
        .setAuthor({
            name: userName,
            iconURL: userAvatar
        })
        .addFields(
            { name: "⭐ Rating", value: `${starDisplay} (${review.rating}/5)`, inline: true },
            { name: "🛒 Product", value: productName, inline: true },
            { name: "👤 Reviewer", value: `<@${review.userId}>`, inline: true }
        )
        // Updated: Set the reviewer's avatar as the thumbnail, with a fallback
        .setThumbnail(userAvatar || "https://placehold.co/100x100/f39c12/ffffff?text=Review") 
        .setFooter({ 
            text: `Review #${review.id} • ${reviewDate} • Powered by Ender Store` 
        })
        .setTimestamp(new Date(review.timestamp));

    return embed;
}
/**
 * Sends a notification to the pending review log channel.
 * @param {Object} review - The pending review object.
 * @param {Interaction} interaction - The original interaction.
 */
async function sendPendingReviewNotification(review, interaction) {
    const logChannel = interaction.guild.channels.cache.get(PENDING_REVIEW_LOG_CHANNEL_ID);
    if (!logChannel || !logChannel.isTextBased()) {
        console.warn(`Pending review log channel with ID ${PENDING_REVIEW_LOG_CHANNEL_ID} not found or is not a text channel.`);
        return;
    }

    // Fetch user to get their avatar
    const user = await interaction.client.users.fetch(review.userId).catch(() => null);
    const userAvatar = user ? user.displayAvatarURL() : null;

    const reviewEmbed = new EmbedBuilder()
        .setColor('#f1c40f') // Yellow for pending
        .setTitle('📝 New Pending Review')
        .setDescription(`A new review has been submitted by ${review.userName}.`)
        .setAuthor({ // Set the author with the user's name and avatar
            name: review.userName,
            iconURL: userAvatar
        })
        .addFields(
            { name: 'Review ID', value: review.id, inline: true },
            { name: 'Submitted By', value: `${review.userName} (${review.userId})`, inline: true },
            { name: 'Rating', value: `${'⭐'.repeat(review.rating)} (${review.rating}/5)`, inline: true },
            { name: 'Service', value: review.service, inline: true },
            { name: 'Review Text', value: review.reviewText }
        )
        .setTimestamp(new Date(review.timestamp));

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`approve_review_${review.id}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`reject_review_${review.id}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    try {
        await logChannel.send({
            content: `<@&${STAFF_ROLE_ID}> New review to manage!`,
            embeds: [reviewEmbed],
            components: [actionRow]
        });
    } catch (error) {
        console.error("Error sending pending review notification:", error);
    }
}

/**
 * Updates the review management panel message.
 * @param {Client} client - The Discord client instance.
 * @param {Interaction} interaction - The interaction that triggered the update.
 * @param {string} messageId - The ID of the message to update.
 */
async function updateReviewManagementPanel(client, interaction, messageId) {
    const reviews = await loadReviews();
    const pendingReviews = reviews.filter(r => r.status === 'pending');

    const embeds = [];
    const components = [];

    if (pendingReviews.length === 0) {
        embeds.push(new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('✅ No Pending Reviews')
            .setDescription('All reviews have been processed!')
            .setTimestamp());
    } else {
        embeds.push(new EmbedBuilder()
            .setColor('#f1c40f')
            .setTitle('📝 Pending Reviews')
            .setDescription(`There are ${pendingReviews.length} reviews awaiting your approval.`)
            .setTimestamp());

        // For each review, generate a review embed and action row
        for (const review of pendingReviews.slice(0, 5)) { // Limit to 5 reviews per panel update
            const reviewEmbed = await generateReviewEmbed(client, review); // Pass the client here
            embeds.push(reviewEmbed);

            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`approve_review_${review.id}`)
                    .setLabel('Approve')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`reject_review_${review.id}`)
                    .setLabel('Reject')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            ));
        }
    }

    try {
        const channel = interaction.channel;
        const message = await channel.messages.fetch(messageId);
        await message.edit({ embeds: embeds, components: components });
    } catch (error) {
        console.error("Error updating review management panel:", error);
    }
}

/**
 * Creates and shows the review submission modal.
 * @param {Interaction} interaction - The interaction to respond to.
 */
async function showReviewSubmissionModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('review_submission_modal')
        .setTitle('Submit Your Service Review');

    const ratingInput = new TextInputBuilder()
        .setCustomId('ratingInput')
        .setLabel('Your Rating (1-5 Stars)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 5')
        .setRequired(true);

    const serviceInput = new TextInputBuilder()
        .setCustomId('serviceInput')
        .setLabel('Service You Are Reviewing')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., Logo Design, Website Development')
        .setRequired(true);

    const reviewTextInput = new TextInputBuilder()
        .setCustomId('reviewTextInput')
        .setLabel('Your Review Message')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Tell us about your experience! Max 500 characters.')
        .setRequired(true)
        .setMaxLength(500);

    const firstActionRow = new ActionRowBuilder().addComponents(ratingInput);
    const secondActionRow = new ActionRowBuilder().addComponents(serviceInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(reviewTextInput);

    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

    await interaction.showModal(modal);
}

// Function to fetch all messages from a channel for transcript
async function fetchAllMessages(channel) {
  let allMessages = [];
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) {
      options.before = lastId;
    }

    const messages = await channel.messages.fetch(options);
    allMessages.push(...messages.values());
    if (messages.size < 100) {
      break;
    }
    lastId = messages.last().id;
  }
  return allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

// Function to send a moderation log
async function sendModLog(guild, action, target, moderator, reason = 'No reason provided', duration = null) {
  const modLogChannel = guild.channels.cache.get(MOD_LOG_CHANNEL_ID);
  if (!modLogChannel || !modLogChannel.isTextBased()) {
    console.warn(`Mod log channel with ID ${MOD_LOG_CHANNEL_ID} not found or is not a text channel.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${action} | User: ${target.tag}`)
    .setColor("#e74c3c")
    .addFields(
      { name: 'Target', value: `${target.tag} (${target.id})`, inline: true },
      { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true },
      { name: 'Reason', value: reason || 'No reason provided' }
    )
    .setTimestamp()
    .setFooter({ text: `User ID: ${target.id}` });

  if (duration) {
    embed.addFields({ name: 'Duration', value: duration, inline: true });
  }

  await modLogChannel.send({ embeds: [embed] });
}

// New function to send invoice logs
async function sendInvoiceLog(invoiceDetails, interaction) {
    const invoiceLogChannel = interaction.guild.channels.cache.get(INVOICE_LOG_CHANNEL_ID);
    if (!invoiceLogChannel || !invoiceLogChannel.isTextBased()) {
        console.warn(`Invoice log channel with ID ${INVOICE_LOG_CHANNEL_ID} not found or is not a text channel.`);
        return;
    }

    const logEmbed = new EmbedBuilder()
        .setTitle("💸 Invoice Sent")
        .setColor("#2ecc71") // Green for success/information
        .addFields(
            { name: 'Customer', value: `${invoiceDetails.customer.tag} (${invoiceDetails.customer.id})`, inline: true },
            { name: 'Sent By', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
            { name: 'Description', value: invoiceDetails.description },
            { name: 'Amount', value: invoiceDetails.amount },
        )
        .setTimestamp()
        .setFooter({ text: `Invoice ID: ${Date.now()}` }); // Simple unique ID

    if (invoiceDetails.Date) {
        logEmbed.addFields({ name: 'Due Date', value: invoiceDetails.Date, inline: true });
    }
    if (invoiceDetails.paymentLink) {
        logEmbed.addFields({ name: 'Payment Link', value: `[Click Here](${invoiceDetails.paymentLink})`, inline: false });
    }
    if (invoiceDetails.notes) {
        logEmbed.addFields({ name: 'Notes', value: invoiceDetails.notes, inline: false });
    }

    await invoiceLogChannel.send({ embeds: [logEmbed] });
}

// Function to create a ticket channel
async function createTicketChannel(interaction, ticketType, initialMessageContent = null) {
    const guild = interaction.guild;
    const user = interaction.user;
    const category = guild.channels.cache.get(TICKET_CATEGORY_ID);

    // --- EDITED: Sanitize username for channel name ---
    const sanitizedUsername = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const channelName = `ticket-${sanitizedUsername}`;

    const existingTicket = guild.channels.cache.find(
        (channel) =>
            channel.name === channelName &&
            channel.topic &&
            channel.topic.includes(user.id)
    );

    if (existingTicket) {
        const alreadyOpenEmbed = new EmbedBuilder()
            .setColor("#e74c3c")
            .setTitle("⚠️ Ticket Already Open")
            .setDescription(`You already have an open ticket. Please use the existing one: ${existingTicket}`);
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [alreadyOpenEmbed], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [alreadyOpenEmbed], ephemeral: true });
        }
        return;
    }

    try {
        // build permission overwrites carefully to avoid invalid types
        const overwrites = [
            {
                id: guild.roles.everyone.id, // @everyone role
                deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
                id: user.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                ],
            },
        ];

        // only include staff role if configured and the role exists in this guild
        if (STAFF_ROLE_ID) {
            const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);
            if (staffRole) {
                overwrites.push({
                    id: staffRole.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                    ],
                });
            } else {
                console.warn('STAFF_ROLE_ID set but role not found in guild:', STAFF_ROLE_ID);
            }
        }

        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            // only set parent when a category exists (avoid passing null)
            ...(category && { parent: category.id }),
            topic: `Ticket for ${user.tag} (${user.id}) | Type: ${ticketType}`,
            permissionOverwrites: overwrites,
        });
        
        const closeButton = new ButtonBuilder()
            .setCustomId(`close_ticket_button`) // Simplified ID
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒');

        const claimButton = new ButtonBuilder()
            .setCustomId(`claim_ticket_button`)
            .setLabel('Claim Ticket')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🙋‍♂️');

        const row = new ActionRowBuilder().addComponents(closeButton, claimButton);

        // --- EDITED: New attractive and informative welcome embed ---
        const welcomeEmbed = new EmbedBuilder()
            .setColor("#5865F2") // Discord Blurple
            .setAuthor({ name: `Ender Store Support`, iconURL: guild.iconURL() })
            .setTitle(`Welcome to your ticket, ${user.username}!`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription("Our team has been notified and will be with you shortly. To help us resolve your issue faster, please provide as much detail as possible.")
            .addFields(
                { name: '👤 Ticket Owner', value: `${user}`, inline: true },
                { name: '📂 Ticket Type', value: `\`${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)}\``, inline: true },
                { name: '⏰ Created At', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Ticket ID: ${ticketChannel.id}` });


        if (initialMessageContent) {
            welcomeEmbed.addFields({ name: '📝Details Provided', value: initialMessageContent, inline: false });
        }

        await ticketChannel.send({ content: `<@${user.id}>, welcome! <@&${STAFF_ROLE_ID}>`, embeds: [welcomeEmbed], components: [row] });

        // --- EDITED: More attractive success message ---
        const successEmbed = new EmbedBuilder()
            .setColor("#57F287") // A nice Discord green
            .setAuthor({ name: "Ticket Created!", iconURL: guild.iconURL() })
            .setTitle("Your Ticket is Ready! ✨")
            .setDescription(`Your Ticket Is Now Processed . Please click the button below to go directly to your ticket.`)
            .addFields(
                { name: 'Channel', value: `${ticketChannel}`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: `Ender Store | We appreciate your patience!` });
            
        const jumpButton = new ButtonBuilder()
            .setLabel('Go to Ticket')
            .setStyle(ButtonStyle.Link)
            .setEmoji('➡️')
            .setURL(ticketChannel.url);

        const successRow = new ActionRowBuilder().addComponents(jumpButton);

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [successEmbed], components: [successRow], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [successEmbed], components: [successRow], ephemeral: true });
        }

    } catch (error) {
        console.error("Error creating ticket channel:", error);
        const errorEmbed = new EmbedBuilder()
            .setColor("#e74c3c")
            .setTitle("❌ Error")
            .setDescription("There was an error trying to create your ticket. Please try again later or contact a staff member.");
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
}


// Register slash commands and prepare bot
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  try {
    await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });
    console.log(`Transcript directory created at: ${TRANSCRIPT_DIR}`);
  } catch (error) {
    console.error(`Error creating transcript directory: ${error.message}`);
  }

  // --- REVIEW SYSTEM FILE CHECK ---
  try {
    await fs.access(REVIEWS_FILE_PATH);
    console.log(`Reviews file found at: ${REVIEWS_FILE_PATH}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('reviews.json not found, creating an empty one.');
      await fs.writeFile(REVIEWS_FILE_PATH, '[]', 'utf8');
    } else {
      console.error(`Error accessing reviews file: ${error.message}`);
    }
  }

  // --- AFK SYSTEM FILE CHECK AND LOAD ---
  try {
    await fs.access(AFK_FILE_PATH);
    console.log(`AFK file found at: ${AFK_FILE_PATH}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('afk.json not found, creating an empty one.');
      await fs.writeFile(AFK_FILE_PATH, '[]', 'utf8');
    } else {
      console.error(`Error accessing AFK file: ${error.message}`);
    }
  }
  await loadAfkData(); // Load AFK data into the Map on bot ready
  console.log(`Loaded ${afkUsers.size} AFK users.`);

  // --- UPI SYSTEM FILE CHECK AND LOAD ---
  try {
    await fs.access(UPI_IDS_FILE_PATH);
    console.log(`UPI IDs file found at: ${UPI_IDS_FILE_PATH}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('upi_ids.json not found, creating an empty one.');
      await fs.writeFile(UPI_IDS_FILE_PATH, '[]', 'utf8');
    } else {
      console.error(`Error accessing UPI IDs file: ${error.message}`);
    }
  }
  await loadUpiIds(); // Load UPI data into the Map on bot ready
  console.log(`Loaded ${upiUsers.size} UPI IDs.`);

  // --- ORDER SYSTEM FILE CHECK AND LOAD ---
  try {
    await fs.access(ORDERS_FILE_PATH);
    console.log(`Orders file found at: ${ORDERS_FILE_PATH}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('orders.json not found, creating an empty one with initial order number.');
      await saveOrdersFile(currentOrderNumber);
    } else {
      console.error(`Error accessing orders file: ${error.message}`);
    }
  }
  currentOrderNumber = await loadOrdersFile(); // Load order number from file on bot ready
  console.log(`Loaded initial order number: ${currentOrderNumber}`);

  // --- STATS SYSTEM FILE CHECK AND LOAD ---
  try {
    await fs.access(STATS_FILE_PATH);
    console.log(`Stats file found at: ${STATS_FILE_PATH}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('stats.json not found, creating an empty one.');
      await fs.writeFile(STATS_FILE_PATH, '{}', 'utf8');
    } else {
      console.error(`Error accessing stats file: ${error.message}`);
    }
  }
  await loadStatsData(); // Load persistent stats on bot ready
  console.log(`Loaded persistent stats. Message ID: ${persistentStats.messageId}`);
  // --- END STATS SYSTEM FILE CHECK AND LOAD ---
  
  // --- VOICE CHANNEL AUTO-JOIN ---
  if (VOICE_CHANNEL_ID && GUILD_ID) {
    // Requires both @discordjs/voice and GuildVoiceStates intent
    joinAndStayInVoiceChannel(client, GUILD_ID, VOICE_CHANNEL_ID);
  }

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering slash commands:', error);
  }

  
  
  // Rotating activity status
  const statuses = [
    { name: 'EnderStore - Chill Store', type: ActivityType.Watching },
    { name: `0 tickets`, type: ActivityType.Listening }, // Placeholder, will be updated dynamically
    { name: 'members', type: ActivityType.Watching }
  ];
  let statusIndex = 0;

  setInterval(async () => {
    // Fetch fresh member count
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        // Use guild.memberCount (which is usually up-to-date with Guild Members Intent)
        const memberCount = guild.memberCount; 
        statuses[2].name = `${memberCount} members`;

        // Update ticket count
        const ticketCategory = guild.channels.cache.get(TICKET_CATEGORY_ID);
        const ticketChannelCount = ticketCategory ? ticketCategory.children.cache.filter(c => c.type === ChannelType.GuildText).size : 0;
        statuses[1].name = `${ticketChannelCount} tickets`;
    }
    
    const currentStatus = statuses[statusIndex];
    client.user.setActivity(currentStatus.name, { type: currentStatus.type });

    statusIndex = (statusIndex + 1) % statuses.length;
  }, 10000); // 10s interval for activity status

  // Rotating online status
  const presenceStatuses = ['online', 'idle', 'dnd'];
  let presenceIndex = 0;

  setInterval(() => {
    const currentPresence = presenceStatuses[presenceIndex];
    client.user.setStatus(currentPresence);

    presenceIndex = (presenceIndex + 1) % presenceStatuses.length;
  }, 2000); // 5s interval for online status

    // --- START STATS MESSAGE REFRESH INTERVAL ---
    // Update the stats message every 60 seconds (1 minute)
    setInterval(updateStatsMessage, 60000);
    // Attempt an initial update after 5 seconds to give time for API setup
    setTimeout(updateStatsMessage, 5000);
    // --- END STATS MESSAGE REFRESH INTERVAL ---

});

// WELCOMER FEATURE WITH AUTO-ROLE
client.on(Events.GuildMemberAdd, async member => {
  const welcomeChannel = client.channels.cache.get(WELCOME_CHANNEL_ID);

  const autoRole = member.guild.roles.cache.get(AUTO_ROLE_ID);
  if (autoRole) {
    try {
      await member.roles.add(autoRole);
      console.log(`Successfully added role to ${member.user.tag}`);
    } catch (error) {
      console.error(`Failed to add role to ${member.user.tag}:`, error);
    }
  } else {
    console.warn(`Auto-role with ID ${AUTO_ROLE_ID} not found.`);
  }

  if (welcomeChannel && welcomeChannel.type === ChannelType.GuildText) {
    const welcomeImage = new AttachmentBuilder('./welcome.jpg');

    const welcomeEmbed = new EmbedBuilder()
      .setColor('#2b2d31')
      .setTitle('Welcome To EnderStore')
      .setDescription(
        `We're thrilled to have you, **${member.user.username}**! 👋\n\n` +
        `**Total Members:** ${member.guild.memberCount}\n\n` +
        `Before you dive in, make sure to check out our <#1402276035831005216> channel to understand the server rules.\n\n` +
        `Feel free to introduce yourself in our <#1425872552969900082> channel and explore our services in the dedicated sections.\n\n` +
        `If you have any questions or need assistance, don't hesitate to ask our friendly staff!`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setImage('attachment://welcome.png')
      .setFooter({
        text: 'Powered by EndStore',
        iconURL: client.user.displayAvatarURL()
      })
      .setTimestamp();

    try {
      await welcomeChannel.send({
        content: `<@${member.user.id}>`,
        embeds: [welcomeEmbed],
        files: [welcomeImage]
      });
    } catch (error) {
      console.error(`Failed to send welcome message for ${member.user.tag}:`, error);
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // AFK check - User sends a message, so they are back from AFK
  if (afkUsers.has(message.author.id)) {
      const afkInfo = afkUsers.get(message.author.id);
      afkUsers.delete(message.author.id); // Remove from AFK
      await saveAfkData(afkUsers); // Save updated AFK data

      try {
          const welcomeBackEmbed = new EmbedBuilder()
              .setColor('#57F287') // Green color for welcome back
              .setTitle('👋 Welcome Back!')
              .setDescription(`You are no longer AFK, ${message.author}!`)
              .addFields(
                  { name: 'Your AFK Status', value: afkInfo.status || 'No specific status.', inline: false },
                  { name: 'To return', value: 'Just send a message in any channel!', inline: false }
              )
              .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
              .setTimestamp();
          
          await message.reply({ embeds: [welcomeBackEmbed] });
          await sendAfkLog(message.guild, message.author, 'clear', afkInfo); // Log AFK return

      } catch (error) {
          console.error(`Error handling AFK return for ${message.author.tag}:`, error);
          await message.reply(`Welcome back, ${message.author}! I've removed your AFK status. (Couldn't send fancy message)`);
      }
  }

  // Check for AFK mentions
  message.mentions.users.forEach(async (mentionedUser) => {
    if (afkUsers.has(mentionedUser.id)) {
        const afkInfo = afkUsers.get(mentionedUser.id);
        const timeAfk = Math.round((Date.now() - afkInfo.timestamp) / 60000); // Time in minutes

        const afkMentionEmbed = new EmbedBuilder()
            .setColor(0x3498db) // Blue color for AFK mention
            .setAuthor({
                name: `${mentionedUser.tag} is currently AFK! 😴`,
                iconURL: mentionedUser.displayAvatarURL({ dynamic: true })
            })
            .setDescription(`**Status:** "${afkInfo.status}"\n**Been AFK for:** ${timeAfk} minutes`)
            .setFooter({ text: `They went AFK at ${new Date(afkInfo.timestamp).toLocaleString()}` })
            .setTimestamp();

        await message.channel.send({ embeds: [afkMentionEmbed] });
     }
  });


  // Command to create the ticket panel with a select menu
  if (message.content === "!ticketpanel") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply("You do not have permission to use this command.");
    }

    const embed = new EmbedBuilder()
        .setColor("#f1c40f")
        .setTitle("🎫 Ender Store | Ticket Support")
        .setDescription(
            "Welcome to **Ender Store** — your gateway to products, rewards, and partnerships! ✨\n" +
            "Choose an option below and our team will assist you promptly."
        )
        .addFields(
            { name: "❓ Help / General Inquiry", value: "Questions? Need guidance?", inline: true },
            { name: "🛒 Buy", value: "Purchase products securely.", inline: true },
            { name: "🎁 Reward Claim", value: "Redeem your bonuses!", inline: true },
            { name: "🤝 Partnership", value: "Discuss collaborations.", inline: true }
        )
        .setThumbnail(client.user.displayAvatarURL())
        .setImage("https://placehold.co/600x200/f1c40f/2c3e50?text=ENDER+STORE+TICKETS")
        .setTimestamp()
        .setFooter({ text: "Ender Store | Premium Digital Hub", iconURL: client.user.displayAvatarURL() });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_service_type')
      .setPlaceholder('Select a ticket type to begin...')
      .addOptions(
        serviceOptions.map(option => ({
          label: option.label,
          value: option.id,
          emoji: option.emoji,
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete();
  }

  // --- NEW REVIEW SYSTEM MESSAGE COMMAND ---
  if (message.content === "!reviewpanel") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You do not have permission to use this command.");
    }

    const embeds = [];
    embeds.push(new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('🌟 Leave a Review for Ender Store Services! ?')
      .setDescription('Share your experience with our services by clicking the button below. Your feedback helps us improve!')
      .setTimestamp());

    const submitReviewButton = new ButtonBuilder()
      .setCustomId('submit_review_button')
      .setLabel('Submit A Review')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✍️');

    const row = new ActionRowBuilder().addComponents(submitReviewButton);

    try {
      // EDITED: Send the review panel to the channel where the command was used
      await message.channel.send({ embeds: embeds, components: [row] });
    } catch (error) {
      console.error("Error creating review panel:", error);
      await message.reply({ content: "There was an error creating the review panel. Check bot permissions.", ephemeral: true });
    }

    await message.delete();
  }

  // --- END NEW REVIEW SYSTEM MESSAGE COMMAND ---

  // --- NEW STATS SETUP COMMAND (UPDATED FOR EXACT REVIEWS COUNT) ---
  if (message.content === "!statssetup") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return message.reply("You do not have permission to use this command.");
    }

    const statsChannel = message.guild.channels.cache.get(STATS_CHANNEL_ID);
    if (!statsChannel || !statsChannel.isTextBased()) {
        return message.reply(`STATS_CHANNEL_ID is not configured correctly. Please set it to a valid channel ID: \`${STATS_CHANNEL_ID}\``);
    }
    
    // Initial embed using saved persistent data (or default 0s)
    const initialEmbed = new EmbedBuilder()
        .setColor('#2b2d31') 
        .setTitle('📈 Ender Store - Overall Insights')
        .setDescription(`**Stats last updated:** <t:${Math.floor(Date.now() / 1000)}:R>`)
        .addFields(
            // REMOVED '+' SIGN for exact count
            { name: '✅ Total Successful Orders', value: `\`${currentOrderNumber - 1}\``, inline: false },
            // KEPT '+' SIGN for approximate count (based on role)
            { name: '👥 Total Customers (Role)', value: `\`${persistentStats.lastCustomers}\`+`, inline: false },
            // UPDATED FIELD NAME and REMOVED '+' SIGN for exact count
            { name: '⭐ Total Approved Reviews', value: `\`${persistentStats.lastReviews}\``, inline: false }
        )
        .setImage('attachment://stats.gif') 
        .setFooter({ text: 'Thank you for choosing Ender Store!' })
        .setTimestamp();

    try {
        const statsGif = new AttachmentBuilder('./stats.gif', { name: 'stats.gif' });

        const sentMessage = await statsChannel.send({ embeds: [initialEmbed], files: [statsGif] });
        
        // Save the message ID for future updates
        persistentStats.messageId = sentMessage.id;
        await saveStatsData(persistentStats);

        await message.reply({ content: `✅ Dynamic stats message created and its ID (\`${sentMessage.id}\`) has been saved. It will refresh every minute.`, ephemeral: true });
        await message.delete();
    } catch (error) {
        console.error("Error creating stats message:", error);
        await message.reply({ content: "❌ Error: Could not create the stats message. Check bot permissions (Send Messages, Embed Links, Attach Files) in the stats channel, and ensure the `stats.gif` file exists.", ephemeral: true });
    }
  }

  // New utility command to manually set the existing stats message ID
  if (message.content.startsWith("!statsid ")) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You do not have permission to use this command.");
    }
    const parts = message.content.split(/\s+/);
    const newId = parts[1];
    if (!newId || !/^[0-9]+$/.test(newId)) {
      return message.reply("Please provide a valid numeric message ID. Example: `!statsid 123456789012345678`.");
    }
    persistentStats.messageId = newId;
    await saveStatsData(persistentStats);
    return message.reply(`✅ Stats message ID has been updated to \`${newId}\`. The bot will use this ID on the next refresh.`);
  }

  // --- END NEW STATS SETUP COMMAND ---

  // Basic ping command
  if (message.content === "!ping") {
    message.reply("Pong! 🏓");
  }

  // !say command
  if (message.content.startsWith("!say ")) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You do not have permission to use the `!say` command.");
    }
    const messageToSay = message.content.slice("!say ".length).trim();
    if (messageToSay.length > 0) {
      await message.channel.send(messageToSay);
      await message.delete();
    } else {
      await message.reply("Please provide a message for me to say. Example: `!say Hello everyone!`");
    }
  }

  // !sendfile command
  if (message.content.startsWith("!sendfile")) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You do not have permission to use the `!sendfile` command.");
    }
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      try {
        await message.channel.send({ files: [{ attachment: attachment.url, name: attachment.name }] });
        await message.delete();
      } catch (error) {
        console.error("Error sending file:", error);
        await message.reply("There was an error sending the file. Please try again.");
      }
    } else {
      await message.reply("Please attach a file with the `!sendfile` command. Example: `!sendfile` (and attach a file)");
    }
  }
  
  // --- REMOVED THE OLD !remind COMMAND ---

});

// --- NEW: Helper function to show the close ticket modal ---
async function showCloseTicketModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId(`close_ticket_modal_${interaction.channel.id}`)
        .setTitle('Close Ticket');

    const reasonInput = new TextInputBuilder()
        .setCustomId('closeReasonInput')
        .setLabel("Reason for closing this ticket?")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('e.g., Issue resolved, customer unresponsive, etc.')
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(reasonInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;

    if (interaction.isChatInputCommand()) {
        // Ticket close command
        if (interaction.commandName === 'close') {
            const channel = interaction.channel;
            if (!channel.name.startsWith('ticket-')) {
                return await interaction.reply({ content: "This command can only be used in a ticket channel.", ephemeral: true });
            }
            const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) || (STAFF_ROLE_ID && interaction.member.roles.cache.has(STAFF_ROLE_ID));
            if (!isStaff) {
                return await interaction.reply({ content: "You do not have permission to close tickets.", ephemeral: true });
            }
            
            await showCloseTicketModal(interaction);
        } else if (interaction.commandName === 'adduser') {
            const channel = interaction.channel;
            if (!channel.name.startsWith('ticket-')) {
                return await interaction.reply({ content: "This command can only be used in a ticket channel.", ephemeral: true });
            }
            const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) || (STAFF_ROLE_ID && interaction.member.roles.cache.has(STAFF_ROLE_ID));
            if (!isStaff) {
                return await interaction.reply({ content: "You do not have permission to add users to tickets.", ephemeral: true });
            }

            const userToAdd = interaction.options.getUser('user');
            // FIX: Use channel.guild.members.fetch(userToAdd.id, { force: true }) if you absolutely need the member object fresh, 
            // but rely on cache first if the bot has the GuildMembers Intent. Since the intent is enabled, we use cache.
            const memberToAdd = interaction.guild.members.cache.get(userToAdd.id); 

            if (!memberToAdd) {
                return await interaction.reply({ content: "That user is not in this server (or bot hasn't cached them yet).", ephemeral: true });
            }

            try {
                await channel.permissionOverwrites.edit(memberToAdd.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });

                const addEmbed = new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setDescription(`✅ ${userToAdd} has been added to the ticket by ${interaction.user}.`);
                await interaction.reply({ embeds: [addEmbed] });

            } catch (error) {
                console.error("Error adding user to ticket:", error);
                await interaction.reply({ content: "There was an error trying to add the user to the ticket.", ephemeral: true });
            }
        }
        else if (interaction.commandName === 'claim') {
            const channel = interaction.channel;
            if (!channel.name.startsWith('ticket-')) {
                return await interaction.reply({ content: "This command can only be used in a ticket channel.", ephemeral: true });
            }
            const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
            if (!isStaff) {
                return await interaction.reply({ content: "Only staff members can claim tickets.", ephemeral: true });
            }
            if (channel.topic.includes('Claimed by:')) {
                return await interaction.reply({ content: "This ticket has already been claimed.", ephemeral: true });
            }

            const newTopic = `${channel.topic} | Claimed by: ${interaction.user.id}`;
            await channel.setTopic(newTopic);

            const claimEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setDescription(`✅ This ticket has been claimed by ${interaction.user}.`);
            await interaction.reply({ embeds: [claimEmbed] });

        } else if (interaction.commandName === 'unclaim') {
            const channel = interaction.channel;
            if (!channel.name.startsWith('ticket-')) {
                return await interaction.reply({ content: "This command can only be used in a ticket channel.", ephemeral: true });
            }
             const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
            if (!isStaff) {
                return await interaction.reply({ content: "Only staff members can unclaim tickets.", ephemeral: true });
            }
            if (!channel.topic.includes('Claimed by:')) {
                return await interaction.reply({ content: "This ticket is not currently claimed.", ephemeral: true });
            }
            
            const topicParts = channel.topic.split(' | ');
            const claimerId = topicParts.find(part => part.startsWith('Claimed by:')).replace('Claimed by: ', '');
            
            if (interaction.user.id !== claimerId && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return await interaction.reply({ content: `You cannot unclaim a ticket claimed by <@${claimerId}>.`, ephemeral: true });
            }

            const newTopic = topicParts.filter(part => !part.startsWith('Claimed by:')).join(' | ');
            await channel.setTopic(newTopic);

            const unclaimEmbed = new EmbedBuilder()
                .setColor('#f1c40f')
                .setDescription(`⚠️ This ticket has been unclaimed by ${interaction.user} and is now open for other staff members.`);
            await interaction.reply({ embeds: [unclaimEmbed] });
        }
        // Removed the old static /qr command handler
        // Moderation Commands (permissions checks are already inside each command)
        else if (interaction.commandName === 'kick') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return await interaction.reply({ content: "You do not have permission to kick members.", ephemeral: true });
            }
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            if (!member) {
                return await interaction.reply({ content: "That user is not in this server.", ephemeral: true });
            }
            if (!member.kickable) {
                return await interaction.reply({ content: "I cannot kick that user. They might have a higher role or I lack permissions.", ephemeral: true });
            }
            try {
                await member.kick(reason);
                await interaction.reply({ content: `Successfully kicked ${user.tag} for: ${reason}`, ephemeral: true });
                await sendModLog(interaction.guild, 'Kick', user, interaction.user, reason);
            } catch (error) {
                console.error("Error kicking user:", error);
                await interaction.reply({ content: "There was an error trying to kick the user.", ephemeral: true });
            }
        } else if (interaction.commandName === 'ban') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return await interaction.reply({ content: "You do not have permission to ban members.", ephemeral: true });
            }
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            if (member && !member.bannable) {
                return await interaction.reply({ content: "I cannot ban that user. They might have a higher role or I lack permissions.", ephemeral: true });
            }
            try {
                await interaction.guild.members.ban(user.id, { reason: reason });
                await interaction.reply({ content: `Successfully banned ${user.tag} for: ${reason}`, ephemeral: true });
                await sendModLog(interaction.guild, 'Ban', user, interaction.user, reason);
            } catch (error) {
                console.error("Error banning user:", error);
                await interaction.reply({ content: "There was an error trying to ban the user.", ephemeral: true });
            }
        } else if (interaction.commandName === 'timeout') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return await interaction.reply({ content: "You do not have permission to timeout members.", ephemeral: true });
            }
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            const durationMinutes = interaction.options.getInteger('duration');
            const durationMillis = durationMinutes * 60 * 1000;
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            if (!member) {
                return await interaction.reply({ content: "That user is not in this server.", ephemeral: true });
            }
            if (!member.moderatable) {
                return await interaction.reply({ content: "I cannot timeout that user. They might have a higher role or I lack permissions.", ephemeral: true });
            }
            if (durationMillis > 2419200000) { // Max 28 days
                return await interaction.reply({ content: "The timeout duration cannot exceed 28 days.", ephemeral: true });
            }
            try {
                await member.timeout(durationMillis, reason);
                await interaction.reply({ content: `Successfully timed out ${user.tag} for ${durationMinutes} minutes for: ${reason}`, ephemeral: true });
                await sendModLog(interaction.guild, 'Timeout', user, interaction.user, reason, `${durationMinutes} minutes`);
            } catch (error) {
                console.error("Error timing out user:", error);
                await interaction.reply({ content: "There was an error trying to timeout the user.", ephemeral: true });
            }
        } else if (interaction.commandName === 'untimeout') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return await interaction.reply({ content: "You do not have permission to remove timeouts.", ephemeral: true });
            }
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            const reason = interaction.options.getString('reason') || 'No reason provided.';
            if (!member) {
                return await interaction.reply({ content: "That user is not in this server.", ephemeral: true });
            }
            if (!member.moderatable) {
                return await interaction.reply({ content: "I cannot remove the timeout for that user. They might have a higher role or I lack permissions.", ephemeral: true });
            }
            try {
                await member.timeout(null, reason);
                await interaction.reply({ content: `Successfully removed timeout from ${user.tag}. Reason: ${reason}`, ephemeral: true });
                await sendModLog(interaction.guild, 'Untimeout', user, interaction.user, reason);
            } catch (error) {
                console.error("Error removing timeout:", error);
                await interaction.reply({ content: "There was an error trying to remove the timeout.", ephemeral: true });
            }
        } else if (interaction.commandName === 'purge') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return await interaction.reply({ content: "You do not have permission to purge messages.", ephemeral: true });
            }
            const amount = interaction.options.getInteger('amount');
            const user = interaction.options.getUser('user');
            try {
                let fetchedMessages;
                if (user) {
                    fetchedMessages = (await interaction.channel.messages.fetch({ limit: 100 })).filter(m => m.author.id === user.id);
                } else {
                    fetchedMessages = await interaction.channel.messages.fetch({ limit: amount });
                }
                const messagesToDelete = user ? fetchedMessages.first(amount) : fetchedMessages;
                await interaction.channel.bulkDelete(messagesToDelete, true);
                await interaction.reply({ content: `Successfully deleted ${messagesToDelete.length} messages.`, ephemeral: true });
            } catch (error) {
                console.error("Error purging messages:", error);
                await interaction.reply({ content: "There was an error trying to purge messages. Make sure they are not older than 14 days.", ephemeral: true });
            }
        } else if (interaction.commandName === 'lock') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return await interaction.reply({ content: "You do not have permission to lock channels.", ephemeral: true });
            }
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            try {
                await channel.permissionOverwrites.edit(interaction.guild.id, {
                    SendMessages: false,
                });
                await interaction.reply({ content: `🔒 ${channel} has been locked.`, ephemeral: true });
                await sendModLog(interaction.guild, 'Channel Lock', channel, interaction.user, `Channel locked by ${interaction.user.tag}`);
            } catch (error) {
                console.error("Error locking channel:", error);
                await interaction.reply({ content: "There was an error trying to lock the channel.", ephemeral: true });
            }
        } else if (interaction.commandName === 'unlock') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
                return await interaction.reply({ content: "You do not have permission to unlock channels.", ephemeral: true });
            }
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            try {
                await channel.permissionOverwrites.edit(interaction.guild.id, {
                    SendMessages: null,
                });
                await interaction.reply({ content: `🔓 ${channel} has been unlocked.`, ephemeral: true });
                await sendModLog(interaction.guild, 'Channel Unlock', channel, interaction.user, `Channel unlocked by ${interaction.user.tag}`);
            } catch (error) {
                console.error("Error unlocking channel:", error);
                await interaction.reply({ content: "There was an error trying to unlock the channel.", ephemeral: true });
            }
        } else if (interaction.commandName === 'userinfo') {
            const user = interaction.options.getUser('user') || interaction.user;
            const member = interaction.guild.members.cache.get(user.id);
            const userEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('User Information')
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
                .addFields(
                    { name: 'Username', value: user.username, inline: true },
                    { name: 'Discriminator', value: user.discriminator, inline: true },
                    { name: 'ID', value: user.id, inline: true },
                    { name: 'Joined Discord', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Roles', value: member.roles.cache.filter(role => role.id !== interaction.guild.id).map(role => role.toString()).join(', ') || 'No Roles', inline: false }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [userEmbed], ephemeral: true });
        } else if (interaction.commandName === 'serverinfo') {
            const guild = interaction.guild;
            const serverEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle(guild.name)
                .setThumbnail(guild.iconURL({ dynamic: true, size: 1024 }))
                .addFields(
                    { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
                    // FIX: Use guild.memberCount instead of guild.members.cache.size for better performance with large guilds
                    { name: 'Members', value: `${guild.memberCount}`, inline: true }, 
                    { name: 'Text Channels', value: `${guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size}`, inline: true },
                    { name: 'Voice Channels', value: `${guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size}`, inline: true },
                    { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Creation Date', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [serverEmbed], ephemeral: true });
        } else if (interaction.commandName === 'avatar') {
            const user = interaction.options.getUser('user') || interaction.user;
            const avatarEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle(`${user.username}'s Avatar`)
                .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
                .setTimestamp();
            await interaction.reply({ embeds: [avatarEmbed], ephemeral: true });
        } else if (interaction.commandName === 'roleinfo') {
            const role = interaction.options.getRole('role');
            const roleEmbed = new EmbedBuilder()
                .setColor(role.color || '#3498db')
                .setTitle(`Role Information for ${role.name}`)
                .addFields(
                    { name: 'ID', value: role.id, inline: true },
                    { name: 'Members', value: `${role.members.size}`, inline: true },
                    { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
                    { name: 'Color', value: `${role.hexColor}`, inline: true },
                    { name: 'Position', value: `${role.position}`, inline: true },
                    { name: 'Creation Date', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [roleEmbed], ephemeral: true });
        } else if (interaction.commandName === 'channelinfo') {
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            const channelEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle(`Channel Information for #${channel.name}`)
                .addFields(
                    { name: 'ID', value: channel.id, inline: true },
                    { name: 'Type', value: ChannelType[channel.type], inline: true },
                    { name: 'Created At', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Topic', value: channel.topic || 'No topic set', inline: false }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [channelEmbed], ephemeral: true });
        } else if (interaction.commandName === '8ball') {
            const question = interaction.options.getString('question');
            const responses = [
                "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes - definitely.",
                "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.",
                "Signs point to yes.", "Reply hazy, try again.", "Better not tell you now.",
                "Cannot predict now.", "Concentrate and ask again.", "Don't count on it.", "My reply is no.",
                "My sources say no.", "Outlook not so good.", "Very doubtful."
            ];
            const response = responses[Math.floor(Math.random() * responses.length)];
            const embed = new EmbedBuilder()
                .setColor('#7289DA')
                .setTitle('The Magic 8-Ball has spoken!')
                .addFields(
                    { name: 'Question', value: question },
                    { name: 'Answer', value: response }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (interaction.commandName === 'roll') {
            const sides = interaction.options.getInteger('sides') || 6;
            const roll = Math.floor(Math.random() * sides) + 1;
            await interaction.reply({ content: `You rolled a **${roll}** on a ${sides}-sided die!`, ephemeral: true });
        } else if (interaction.commandName === 'poll') {
            const question = interaction.options.getString('question');
            const optionsString = interaction.options.getString('options');
            const options = optionsString ? optionsString.split(',').map(o => o.trim()) : ['Yes', 'No'];
            const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
            if (options.length > emojis.length) {
                return await interaction.reply({ content: `You can only have up to ${emojis.length} options for a poll.`, ephemeral: true });
            }
            const pollEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle(`📊 Poll: ${question}`)
                .setDescription(options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n'))
                .setFooter({ text: `Poll started by ${interaction.user.tag}` })
                .setTimestamp();
            const pollMessage = await interaction.reply({ embeds: [pollEmbed], fetchReply: true });
            for (let i = 0; i < options.length; i++) {
                await pollMessage.react(emojis[i]);
            }
        } else if (interaction.commandName === 'remindme') {
            const time = interaction.options.getInteger('time');
            const unit = interaction.options.getString('unit');
            const message = interaction.options.getString('message');
            let durationMillis;
            let unitText;
            switch (unit) {
                case 's':
                    durationMillis = time * 1000;
                    unitText = `second${time > 1 ? 's' : ''}`;
                    break;
                case 'm':
                    durationMillis = time * 60 * 1000;
                    unitText = `minute${time > 1 ? 's' : ''}`;
                    break;
                case 'h':
                    durationMillis = time * 60 * 60 * 1000;
                    unitText = `hour${time > 1 ? 's' : ''}`;
                    break;
                case 'd':
                    durationMillis = time * 24 * 60 * 60 * 1000;
                    unitText = `day${time > 1 ? 's' : ''}`;
                    break;
            }
            await interaction.reply({ content: `I will remind you about "${message}" in ${time} ${unitText}.`, ephemeral: true });
            setTimeout(async () => {
                const reminderEmbed = new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle('🔔 Reminder!')
                    .setDescription(message)
                    .setTimestamp();
                try {
                    await interaction.user.send({ embeds: [reminderEmbed] });
                } catch (error) {
                    console.error(`Could not send reminder DM to ${interaction.user.tag}:`, error);
                    await interaction.followUp({ content: `I tried to send you a reminder about "${message}", but your DMs are closed.`, ephemeral: true });
                }
            }, durationMillis);
        } else if (interaction.commandName === 'remind') {
            // Defer the reply to give the bot time to process
            await interaction.deferReply({ ephemeral: true });

            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !(STAFF_ROLE_ID && interaction.member.roles.cache.has(STAFF_ROLE_ID))) {
                return await interaction.editReply({ content: "You do not have permission to use this command.", ephemeral: true });
            }

            let targetUser = interaction.options.getUser('user');
            let ticketChannel = interaction.options.getChannel('channel');
            let ticketOwner = null;

            const isTicketChannel = interaction.channel.name.startsWith('ticket-') && interaction.channel.topic;

            if (isTicketChannel) {
                 ticketChannel = interaction.channel;
                const userIdMatch = interaction.channel.topic.match(/\((\d{17,19})\)/);
                if (userIdMatch && userIdMatch[1]) {
                    try {
                        ticketOwner = await client.users.fetch(userIdMatch[1]);
                    } catch (error) {
                        console.error("Could not fetch user from ticket topic:", error);
                    }
                }
            }
            
            // Set the target user if not specified in the command
            if (!targetUser) {
                if (ticketOwner) {
                    targetUser = ticketOwner;
                } else {
                    return await interaction.editReply({ content: "I couldn't automatically find a user for this ticket. Please specify one with the user option.", ephemeral: true });
                }
            }

            // Ensure a ticket channel is found
            if (!ticketChannel) {
                return await interaction.editReply({ content: "This command must be used in a ticket channel or you must provide a channel in the command.", ephemeral: true });
            }
            
            try {
                // Prepare the attachment from your bot's file manager
                const reminderGif = new AttachmentBuilder('./dm.gif');

                // Prepare the embed
                const reminderEmbed = new EmbedBuilder()
                    .setColor("#8A2BE2") // A purple color to match the theme
                    .setTitle("Your Ticket Needs Attention!🎫")
                    .setAuthor({ name: "Ender Store", iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                    .setDescription(
                        `> Hey ${targetUser},\n\n` +
                        `> We are still waiting for your response in the ticket.\n` +
                        `> Please click the button below to view your ticket.\n\n` +
                        `Kindly respond when you're available. We're here to help!`
                    )
                    .setImage('attachment://dm.gif')
                    .setFooter({ text: "Ender Store Support Team", iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setTimestamp();

                // Prepare the buttons
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('View Ticket')
                            .setStyle(ButtonStyle.Link)
                            .setURL(ticketChannel.url)
                            .setEmoji('🔗'),
                        new ButtonBuilder()
                            .setLabel('Server')
                            .setStyle(ButtonStyle.Link)
                            // This creates a link to the server itself. 
                            .setURL(`https://discord.com/channels/${interaction.guild.id}`)
                            .setEmoji('🛡️')
                    );
                
                // Send the DM
                await targetUser.send({
                    embeds: [reminderEmbed],
                    files: [reminderGif],
                    components: [row]
                });

                // Confirm in the original channel
                await interaction.editReply({ content: `✅ Successfully sent a reminder to ${targetUser.tag}.`, ephemeral: false});
                
            } catch (error) {
                console.error("Error sending reminder DM:", error);
                if (error.code === 50007) { // Discord API error for "Cannot send messages to this user"
                     await interaction.editReply({ content: `❌ Failed to send a DM to ${targetUser.tag}. They might have their DMs disabled.`, ephemeral: true });
                } else {
                     await interaction.editReply({ content: "An error occurred while trying to send the reminder.", ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'suggest') {
            const suggestionText = interaction.options.getString('suggestion');
            const suggestionChannel = interaction.guild.channels.cache.get(SUGGESTION_CHANNEL_ID);
            if (!suggestionChannel || !suggestionChannel.isTextBased()) {
                return await interaction.reply({ content: "Suggestion channel not configured correctly.", ephemeral: true });
            }
            const suggestionEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('New Suggestion')
                .setDescription(suggestionText)
                .setFooter({ text: `Suggested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            try {
                const suggestionMessage = await suggestionChannel.send({ embeds: [suggestionEmbed]});
                await suggestionMessage.react('👍');
                await suggestionMessage.react('👎');
                await interaction.reply({ content: "Your suggestion has been submitted!", ephemeral: true });
            } catch (error) {
                console.error("Error sending suggestion:", error);
                await interaction.reply({ content: "There was an error submitting your suggestion.", ephemeral: true });
            }
        } else if (interaction.commandName === 'afk') {
            const status = interaction.options.getString('status') || 'No reason provided.';
            
            if (afkUsers.has(interaction.user.id)) {
                return await interaction.reply({ content: 'You are already AFK. To remove your AFK status, simply send a message in any channel.', ephemeral: true });
            }

            try {
                const afkEntry = {
                    userId: interaction.user.id,
                    status: status,
                    timestamp: Date.now(),
                };
                afkUsers.set(interaction.user.id, afkEntry);
                await saveAfkData(afkUsers); // Save AFK data

                const afkSetEmbed = new EmbedBuilder()
                    .setColor('#f1c40f') // Yellow for setting AFK
                    .setTitle('😴 You are now AFK!')
                    .setDescription(`I've set your AFK status. I'll let people know if they mention you.`)
                    .addFields(
                        { name: 'Your Status', value: status, inline: false },
                        { name: 'To return', value: 'Just send a message in any channel!', inline: false }
                    )
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                await interaction.reply({ embeds: [afkSetEmbed], ephemeral: true });
                await sendAfkLog(interaction.guild, interaction.user, 'set', afkEntry); // Log AFK set

            } catch (error) {
                console.error(`Error setting AFK status for ${interaction.user.tag}:`, error);
                await interaction.reply({ content: `There was an error setting your AFK status. Your status is: **${status}**`, ephemeral: true });
            }
        } else if (interaction.commandName === 'embed') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
            }
            const jsonString = interaction.options.getString('json');
            try {
                const embedData = JSON.parse(jsonString);
                const embed = new EmbedBuilder(embedData);
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: `Invalid JSON format for the embed. Error: ${error.message}`, ephemeral: true });
            }
        } else if (interaction.commandName === 'stats') {
            const guilds = client.guilds.cache.size;
            const users = client.users.cache.size;
            const uptime = client.uptime;
            const statsEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle('Bot Statistics')
                .addFields(
                    { name: 'Servers', value: `${guilds}`, inline: true },
                    // FIX: Use guild.memberCount instead of guild.members.cache.size for better performance with large guilds
                    { name: 'Users', value: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0).toString(), inline: true },
                    { name: 'Uptime', value: `${Math.floor(uptime / (1000 * 60 * 60))}h ${Math.floor((uptime / (1000 * 60)) % 60)}m ${Math.floor((uptime / 1000) % 60)}s`, inline: false }
                )
                .setTimestamp();
            await interaction.reply({ embeds: [statsEmbed], ephemeral: true });
        } else if (interaction.commandName === 'help') {
            const commandName = interaction.options.getString('command');
            if (commandName) {
                const command = commands.find(cmd => cmd.name === commandName);
                if (!command) {
                    return await interaction.reply({ content: `I could not find a command named **${commandName}**.`, ephemeral: true });
                }
                const helpEmbed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`Help for /${command.name}`)
                    .setDescription(command.description)
                    .addFields(
                        { name: 'Options', value: command.options.length > 0 ? command.options.map(opt => `\`${opt.name}\`: ${opt.description}${opt.required ? ' (Required)' : ''}`).join('\n') : 'This command has no options.' }
                    )
                    .setTimestamp();
                await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
            } else {
                const commandList = commands.map(cmd => `\`/${cmd.name}\` - ${cmd.description}`).join('\n');
                const helpEmbed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('Bot Commands')
                    .setDescription(`Here is a list of all available slash commands:\n\n${commandList}`)
                    .setFooter({ text: 'Use /help [command] for more details on a specific command.' })
                    .setTimestamp();
                await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
            }
        } else if (interaction.commandName === 'invoice') {
            // Defer the reply immediately to prevent "Unknown interaction" error
            await interaction.deferReply({ ephemeral: true }); 

            const customer = interaction.options.getUser('customer');
            const description = interaction.options.getString('description');
            const amount = interaction.options.getString('amount');
            const dueDate = interaction.options.getString('date') || 'N/A';
            const paymentLink = interaction.options.getString('paymentlink') || 'N/A';
            const notes = interaction.options.getString('notes') || 'No additional notes.';
            
            const invoiceEmbed = new EmbedBuilder()
                .setTitle("📝 New Invoice from Ender Store")
                .setDescription("Hello! You have a new invoice from EnderStore.")
                .setColor("#3498db")
                .setThumbnail(interaction.guild.iconURL())
                .addFields(
                    { name: 'Description', value: description },
                    { name: 'Amount Due', value: amount, inline: true },
                    { name: 'Due Date', value: dueDate, inline: true },
                )
                .setFooter({ text: 'Thank you for your business!' })
                .setTimestamp();

            if (paymentLink !== 'N/A') {
                invoiceEmbed.addFields({ name: 'Payment Link', value: `[Click Here to Pay](${paymentLink})` });
            }

            if (notes !== 'No additional notes.') {
                invoiceEmbed.addFields({ name: 'Notes', value: notes });
            }

            try {
                await customer.send({ embeds: [invoiceEmbed] });
                // Use editReply since we already deferred
                await interaction.editReply({ content: `Successfully sent an invoice to ${customer.tag}.`, ephemeral: true });
                await sendInvoiceLog({ customer, description, amount, date: dueDate, paymentLink, notes }, interaction);
            } catch (error) {
                console.error("Error sending invoice:", error);
                // Use editReply since we already deferred
                await interaction.editReply({ content: `Failed to send invoice to ${customer.tag}. They might have DMs disabled.`, ephemeral: true });
            }
        } else if (interaction.commandName === 'managereviews') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return await interaction.reply({ content: "You do not have permission to manage reviews.", ephemeral: true });
            }
            const logChannel = interaction.guild.channels.cache.get(PENDING_REVIEW_LOG_CHANNEL_ID);
            if (!logChannel || !logChannel.isTextBased()) {
                return await interaction.reply({ content: `Pending review log channel with ID ${PENDING_REVIEW_LOG_CHANNEL_ID} not found or is not a text channel.`, ephemeral: true });
            }
            const reviews = await loadReviews();
            const pendingReviews = reviews.filter(r => r.status === 'pending');
            const embeds = [];
            const components = [];
            if (pendingReviews.length === 0) {
                embeds.push(new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('✅ No Pending Reviews')
                    .setDescription('There are currently no reviews awaiting your approval.')
                    .setTimestamp());
            } else {
                embeds.push(new EmbedBuilder()
                    .setColor('#f1c40f')
                    .setTitle('📝 Pending Reviews')
                    .setDescription(`There are ${pendingReviews.length} reviews awaiting your approval. Use the buttons below to approve or reject them.`)
                    .setTimestamp());
                pendingReviews.slice(0, 5).forEach(review => {
                    embeds.push(new EmbedBuilder()
                        .setColor('#f1c40f')
                        .setTitle(`Review ID: ${review.id}`)
                        .setDescription(`**Submitted By:** ${review.userName} (${review.userId})\n**Service:** ${review.service}\n**Rating:** ${'⭐'.repeat(review.rating)} (${review.rating}/5)\n**Review:** ${review.reviewText.substring(0, 200)}${review.reviewText.length > 200 ? '...' : ''}`)
                        .setFooter({ text: `Submitted on ${new Date(review.timestamp).toLocaleString()}` })
                        .setTimestamp(new Date(review.timestamp)));
                    components.push(new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`approve_review_${review.id}`)
                            .setLabel('Approve')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('✅'),
                        new ButtonBuilder()
                            .setCustomId(`reject_review_${review.id}`)
                            .setLabel('Reject')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('❌')
                    ));
                });
            }
            await interaction.reply({ embeds: embeds, components: components, ephemeral: true });
        } else if (interaction.commandName === 'dm') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
            }
            const user = interaction.options.getUser('user');
            const title = interaction.options.getString('title') || 'Message from Server Staff';
            const description = interaction.options.getString('description') || 'You have received a message from a staff member.';
            const footer = interaction.options.getString('footer') || interaction.guild.name;
            const dmEmbed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor("#3498db")
                .setFooter({ text: footer, iconURL: interaction.guild.iconURL() })
                .setTimestamp();
            try {
                await user.send({ embeds: [dmEmbed] });
                await interaction.reply({ content: `Successfully sent a DM to ${user.tag}.`, ephemeral: true });
            } catch (error) {
                console.error(`Error sending DM to ${user.tag}:`, error);
                await interaction.reply({ content: `Failed to send DM to ${user.tag}. They might have DMs disabled.`, ephemeral: true });
            }
        } else if (interaction.commandName === 'order') {
            // Defer the reply immediately to prevent "Unknown interaction" error
            await interaction.deferReply({ ephemeral: true }); 

            const product = interaction.options.getString('product');
            const quantity = interaction.options.getInteger('quantity');
            const buyer = interaction.options.getUser('buyer') || interaction.user;
            
            // Get the current order number and increment it
            const orderNumber = currentOrderNumber;
            currentOrderNumber++;
            await saveOrdersFile(currentOrderNumber); // Save the new order number

            const offerFile = new AttachmentBuilder('./offer.gif');

            const orderLogChannel = interaction.guild.channels.cache.get(ORDER_LOG_CHANNEL_ID);
            if (!orderLogChannel || !orderLogChannel.isTextBased()) {
                // Use editReply because we have already deferred.
                return await interaction.editReply({
                    content: `Order log channel not found. Please ensure the bot can access the channel with ID ${ORDER_LOG_CHANNEL_ID}.`,
                    ephemeral: true
                });
            } // no change here, just ensuring the variable is now env-driven
            
            const orderEmbed = new EmbedBuilder()
                .setTitle('🛒New Order From Customer ')
                .setColor('#2ecc71')
                .setDescription(`**✅ Order Completed!**`)
                .addFields(
                    { name: 'Order Number', value: `#${orderNumber}`, inline: true },
                    { name: 'Buyer', value: `${buyer.toString()} (${buyer.tag})`, inline: true },
                    { name: 'Product', value: product, inline: true },
                    { name: 'Quantity', value: quantity.toString(), inline: true }
                )
                .setImage('attachment://offer.gif')
                .setFooter({ text: `Order Completed by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                .setTimestamp();

            try {
                await orderLogChannel.send({
                    embeds: [orderEmbed],
                    files: [offerFile]
                });

                // Use editReply because we have already deferred.
                await interaction.editReply({
                    content: `✅ The order for **${product}** (Order #${orderNumber}) has been successfully created and sent to the order log channel.`,
                    ephemeral: true
                });

            } catch (error) {
                console.error('Failed to create order message:', error);
                // Use editReply because we have already deferred.
                await interaction.editReply({
                    content: 'There was an error creating your order. Please check the bot\'s permissions or try again later.',
                    ephemeral: true
                });
            }
        } else if (interaction.commandName === 'setorderstatus') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return await interaction.reply({ content: "You do not have permission to manage order statuses.", ephemeral: true });
            }
            const messageId = interaction.options.getString('messageid');
            const newStatus = interaction.options.getString('status');
            const orderChannel = interaction.guild.channels.cache.get(ORDER_LOG_CHANNEL_ID);
            if (!orderChannel || !orderChannel.isTextBased()) {
                return await interaction.reply({ content: "Order log channel not configured correctly.", ephemeral: true });
            } // same, env variable now applies
            try {
                const orderMessage = await orderChannel.messages.fetch(messageId);
                const originalEmbed = orderMessage.embeds[0];
                if (!originalEmbed) {
                    return await interaction.reply({ content: "Could not find a valid embed on that message.", ephemeral: true });
                }
                const updatedEmbed = EmbedBuilder.from(originalEmbed);
                // Find and update the "Status" field, or add it if it doesn't exist
                const statusFieldIndex = updatedEmbed.data.fields.findIndex(field => field.name === 'Status');
                if (statusFieldIndex > -1) {
                    updatedEmbed.spliceFields(statusFieldIndex, 1, { name: 'Status', value: newStatus, inline: true });
                } else {
                    updatedEmbed.addFields({ name: 'Status', value: newStatus, inline: true });
                }
                
                updatedEmbed.setDescription(`The order status has been updated by ${interaction.user.tag}.`);
                updatedEmbed.setColor(newStatus === 'Completed' ? '#2ecc71' : newStatus === 'Cancelled' ? '#e74c3c' : '#f1c40f');
                await orderMessage.edit({ embeds: [updatedEmbed] });
                await interaction.reply({ content: `Successfully updated order status to **${newStatus}**.`, ephemeral: true });
            } catch (error) {
                console.error("Error setting order status:", error);
                // Discord returns a 10008 Unknown Message if the ID is invalid or message deleted
                if (error.code === 10008) {
                    await interaction.reply({ content: "Order message not found – the ID may be wrong or the message was deleted.", ephemeral: true });
                } else {
                    await interaction.reply({ content: "There was an error updating the order status. Please ensure the message ID is correct and is in the order channel.", ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'setupi') { // NEW: Handle /setupi command
            const upiId = interaction.options.getString('upi_id');
            upiUsers.set(interaction.user.id, upiId);
            await saveUpiIds(upiUsers);

            const setupiEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('✅ UPI ID Set!')
                .setDescription(`Your default UPI ID has been set to: \`${upiId}\`
`)
                .setFooter({ text: 'You can now use /upi qr without specifying a UPI ID.' })
                .setTimestamp();

            await interaction.reply({ embeds: [setupiEmbed], ephemeral: true });
        } else if (interaction.commandName === 'upi') { // NEW: Handle /upi command (with subcommand qr)
            if (interaction.options.getSubcommand() === 'qr') {
                await interaction.deferReply({ ephemeral: false }); // Defer for QR generation time

                const amount = interaction.options.getNumber('amount');
                // Updated default note
                const note = interaction.options.getString('note') || 'Im Paying To EnderStore For A Product/Service';
                let targetUpiId = interaction.options.getString('upi_id');

                if (!targetUpiId) {
                    targetUpiId = upiUsers.get(interaction.user.id);
                    if (!targetUpiId) {
                        return await interaction.editReply({
                            content: 'You have not set a default UPI ID. Please use `/setupi <your_upi_id>` or provide a UPI ID with this command.',
                            ephemeral: true
                        });
                    }
                }

                // Construct UPI deep link (e.g., upi://pay?pa=yourname@bank&pn=YourName&am=100.00&cu=INR&tn=Payment)
                const merchantName = encodeURIComponent(interaction.guild.name || 'Discord Merchant'); // Using guild name as merchant name
                const encodedNote = encodeURIComponent(note);
                const upiLink = `upi://pay?pa=${targetUpiId}&pn=${merchantName}&am=${amount.toFixed(2)}&cu=INR&tn=${encodedNote}`;

                try {
                    // Generate QR code as a data URL (base64 encoded PNG)
                    const qrCodeDataURL = await qrcode.toDataURL(upiLink);
                    // Convert data URL to buffer
                    const base64Data = qrCodeDataURL.split(',')[1];
                    const qrBuffer = Buffer.from(base64Data, 'base64');

                    const qrAttachment = new AttachmentBuilder(qrBuffer, { name: 'upi_qr_code.png' });

                    const qrEmbed = new EmbedBuilder()
                        .setColor("#3498db")
                        .setTitle(`💸 QR Code for ₹${amount.toFixed(2)}`)
                        .setDescription(`Scan this QR code to pay **₹${amount.toFixed(2)}**.`)
                        .addFields(
                            { name: 'Amount', value: `₹${amount.toFixed(2)}`, inline: true },
                            { name: 'PayNote', value: `\`${note}\``, inline: true }
                        )
                        .setImage('attachment://upi_qr_code.png')
                        .setFooter({ text: `Generated by ${interaction.user.tag}` })
                        .setTimestamp();

                    // Create buttons for copying
                    const copyUpiIdButton = new ButtonBuilder()
                        .setCustomId(`copy_upi_id_${interaction.user.id}_${targetUpiId}`)
                        .setLabel('Copy UPI ID')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📋');

                    const copyAmountButton = new ButtonBuilder()
                        .setCustomId(`copy_amount_${interaction.user.id}_${amount.toFixed(2)}`)
                        .setLabel('Copy Amount')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('💰');
                    
                    const copyPaynoteButton = new ButtonBuilder()
                        .setCustomId(`copy_paynote_${interaction.user.id}_${note}`)
                        .setLabel('Copy Paynote')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📝');

                    const buttonRow = new ActionRowBuilder().addComponents(
                        copyUpiIdButton,
                        copyAmountButton,
                        copyPaynoteButton
                    );

                    await interaction.editReply({
                        embeds: [qrEmbed],
                        files: [qrAttachment],
                        components: [buttonRow] // Add the button row here
                    });

                } catch (error) {
                    console.error("Error generating UPI QR code:", error);
                    await interaction.editReply({ content: "There was an error generating the QR code. Please try again later.", ephemeral: true });
                }
            }
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_service_type') {
            const ticketType = interaction.values[0];
            
            // --- NEW: Handle 'help' ticket type with a modal ---
            if (ticketType === 'help') {
                const modal = new ModalBuilder()
                    .setCustomId('help_ticket_modal')
                    .setTitle('❓ Help & General Inquiry');

                const issueInput = new TextInputBuilder()
                    .setCustomId('issueInput')
                    .setLabel('What do you need help with?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Please describe your question or issue in detail...')
                    .setRequired(true);
                
                modal.addComponents(new ActionRowBuilder().addComponents(issueInput));
                await interaction.showModal(modal);

            } else if (ticketType === 'buy') {
                const modal = new ModalBuilder()
                    .setCustomId('buy_ticket_modal')
                    .setTitle('🛒 Buy a Service or Product');

                const serviceInput = new TextInputBuilder()
                    .setCustomId('serviceInput')
                    .setLabel('What Service/Product are you buying?')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g., Logo Design, Web Hosting, Nitro Decos etc.')
                    .setRequired(true);

                const paymentInput = new TextInputBuilder()
                    .setCustomId('paymentInput')
                    .setLabel('What is your preferred payment method?')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g., Upi,etc.')
                    .setRequired(true);

                const quantityInput = new TextInputBuilder()
                    .setCustomId('quantityInput')
                    .setLabel('Quantity')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('1x,2x,4x, etc.')
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(serviceInput),
                    new ActionRowBuilder().addComponents(paymentInput),
                    new ActionRowBuilder().addComponents(quantityInput)
                );

                await interaction.showModal(modal);
            } else {
                // For 'partnership', 'reward_claim', create ticket directly
                await createTicketChannel(interaction, ticketType);
            }
        }
    }
    // Handle button interactions
else if (interaction.isButton()) {
        if (interaction.customId === 'submit_review_button') {
            await showReviewSubmissionModal(interaction);
        } else if (interaction.customId === 'close_ticket_button') {
            const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) || (STAFF_ROLE_ID && interaction.member.roles.cache.has(STAFF_ROLE_ID));
            if (!isStaff) {
                return await interaction.reply({ content: "You do not have permission to close tickets.", ephemeral: true });
            }
            await showCloseTicketModal(interaction);
        }
        else if (interaction.customId === 'claim_ticket_button') {
             const channel = interaction.channel;
            const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
            if (!isStaff) {
                return await interaction.reply({ content: "Only staff members can claim tickets.", ephemeral: true });
            }
            if (channel.topic.includes('Claimed by:')) {
                return await interaction.reply({ content: "This ticket has already been claimed.", ephemeral: true });
            }

            const newTopic = `${channel.topic} | Claimed by: ${interaction.user.id}`;
            await channel.setTopic(newTopic);

            const claimEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setDescription(`✅ This ticket has been claimed by ${interaction.user}.`);
            await interaction.reply({ embeds: [claimEmbed] });
        }
        else if (interaction.customId.startsWith('approve_review_')) {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return await interaction.reply({ content: "You do not have permission to approve reviews.", ephemeral: true });
            }
            const reviewId = interaction.customId.split('_')[2];
            const reviews = await loadReviews();
            const reviewIndex = reviews.findIndex(r => r.id === reviewId);
            if (reviewIndex === -1) {
                return await interaction.reply({ content: "Review not found.", ephemeral: true });
            }
            reviews[reviewIndex].status = 'approved';
            await saveReviews(reviews);
            // Pass the 'client' object here
            const approvedEmbed = await generateReviewEmbed(client, reviews[reviewIndex]);
            const reviewChannel = interaction.guild.channels.cache.get(REVIEW_CHANNEL_ID);
            if (reviewChannel && reviewChannel.isTextBased()) {
                await reviewChannel.send({ embeds: [approvedEmbed] });
            }
            await interaction.update({ content: `✅ Review #${reviewId} has been approved and posted!`, embeds: [], components: [] });
        } else if (interaction.customId.startsWith('reject_review_')) {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return await interaction.reply({ content: "You do not have permission to reject reviews.", ephemeral: true });
            }
            const reviewId = interaction.customId.split('_')[2];
            const reviews = await loadReviews();
            const reviewIndex = reviews.findIndex(r => r.id === reviewId);
            if (reviewIndex === -1) {
                return await interaction.reply({ content: "Review not found.", ephemeral: true });
            }
            reviews.splice(reviewIndex, 1); // Remove the review
            await saveReviews(reviews);
            await interaction.update({ content: `❌ Review #${reviewId} has been rejected and removed.`, embeds: [], components: [] });
        }
        // --- NEW COPY BUTTON HANDLERS ---
        else if (interaction.customId.startsWith('copy_upi_id_')) {
            const upiId = interaction.customId.split('_')[4]; // Extract UPI ID from customId
            await interaction.reply({ content: `\`${upiId}\` has been copied to your clipboard!`, ephemeral: true });
        } else if (interaction.customId.startsWith('copy_amount_')) {
            const amount = interaction.customId.split('_')[3]; // Extract amount from customId
            await interaction.reply({ content: `\`₹${amount}\` has been copied to your clipboard!`, ephemeral: true });
        } else if (interaction.customId.startsWith('copy_paynote_')) {
            // Reconstruct the note from the customId due to potential spaces
            const noteParts = interaction.customId.split('_').slice(3);
            const note = noteParts.join('_'); // Join parts back with '_'
            await interaction.reply({ content: `\`${note}\` has been copied to your clipboard!`, ephemeral: true });
        }
        // --- END NEW COPY BUTTON HANDLERS ---
    }
    // Handle modal submissions
    else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('close_ticket_modal_')) {
            await interaction.deferReply({ ephemeral: true });
            
            const reason = interaction.fields.getTextInputValue('closeReasonInput');
            const channelId = interaction.customId.split('_')[3];
            const channel = interaction.guild.channels.cache.get(channelId);

            if (!channel) {
                return interaction.editReply({ content: 'Could not find the ticket channel. It may have already been deleted.', ephemeral: true });
            }
            
            try {
                // 1. Fetch transcript
                const messages = await fetchAllMessages(channel);
                const transcriptContent = messages.map(m => `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
                const transcriptFileName = `transcript-${channel.name}-${Date.now()}.txt`;
                const transcriptPath = path.join(TRANSCRIPT_DIR, transcriptFileName);
                await fs.writeFile(transcriptPath, transcriptContent, 'utf8');

                // 2. Parse topic for owner and claimer
                const topic = channel.topic || '';
                const ownerIdMatch = topic.match(/\((\d{17,19})\)/);
                const ownerId = ownerIdMatch ? ownerIdMatch[1] : null;

                const claimerIdMatch = topic.match(/Claimed by: (\d{17,19})/);
                const claimerId = claimerIdMatch ? claimerIdMatch[1] : null;

                const ticketOwner = ownerId ? await client.users.fetch(ownerId).catch(() => null) : null;
                const ticketClaimer = claimerId ? await client.users.fetch(claimerId).catch(() => null) : null;
                const ticketCloser = interaction.user;
                
                // 3. Send DM to ticket owner
if (ticketOwner) {
    const ticketId = channel.id.slice(-4);
    const closeDmEmbed = new EmbedBuilder()
        .setAuthor({ name: 'Ender Store', iconURL: interaction.guild.iconURL() })
        .setTitle('Ticket Closed')
        .setColor('#2b2d31')
        .addFields(
            { name: '#️⃣ Ticket ID', value: `\`${ticketId}\``, inline: false },
            { name: '✅ Opened By', value: ticketOwner.toString(), inline: true },
            { name: '❌ Closed By', value: ticketCloser.toString(), inline: true },
            { name: '⏰ Open Time', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:F>`, inline: false },
            { name: '💁 Claimed By', value: ticketClaimer ? ticketClaimer.toString() : 'None', inline: false },
            { name: '❓ Reason', value: reason, inline: false }
        )
        .setTimestamp();

    try {
        const transcriptAttachmentForDM = new AttachmentBuilder(transcriptPath);

        // Upload transcript to log channel first to get a public URL
        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        let transcriptURL = null;

        if (logChannel && logChannel.isTextBased()) {
            const logMessage = await logChannel.send({ files: [transcriptAttachmentForDM] });
            transcriptURL = logMessage.attachments.first().url;
        }

        // Only add button if upload succeeded
        const components = transcriptURL
            ? [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('📥 Download Transcript')
                        .setStyle(ButtonStyle.Link)
                        .setURL(transcriptURL)
                )
              ]
            : [];

        await ticketOwner.send({
            embeds: [closeDmEmbed],
            components
        });
    } catch (dmError) {
        console.error(`Could not DM transcript to user ${ownerId}:`, dmError);
    }
}

                // 4. Send log message
                const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#e74c3c')
                        .setTitle('Ticket Closed')
                        .setDescription(`Ticket \`${channel.name}\` was closed by ${ticketCloser}.`)
                        .addFields(
                           { name: 'Opened By', value: ticketOwner ? ticketOwner.toString() : 'Unknown', inline: true },
                           { name: 'Claimed By', value: ticketClaimer ? ticketClaimer.toString() : 'None', inline: true },
                           { name: 'Closed By', value: ticketCloser.toString(), inline: true },
                           { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    const transcriptAttachment = new AttachmentBuilder(transcriptPath);
                    await logChannel.send({ embeds: [logEmbed], files: [transcriptAttachment] });
                }

                // 5. Delete channel and confirm
                await interaction.editReply({ content: 'Ticket is being closed and archived.', ephemeral: true });
                await channel.delete();

            } catch (error) {
                 console.error("Error during ticket close process:", error);
                 await interaction.editReply({ content: 'An error occurred while closing the ticket.', ephemeral: true });
            }
        }
        else if (interaction.customId === 'review_submission_modal') {
            await interaction.deferReply({ ephemeral: true });
            const rating = parseInt(interaction.fields.getTextInputValue('ratingInput'));
            const service = interaction.fields.getTextInputValue('serviceInput');
            const reviewText = interaction.fields.getTextInputValue('reviewTextInput');
            if (isNaN(rating) || rating < 1 || rating > 5) {
                return await interaction.editReply({ content: 'The rating must be a number between 1 and 5.' });
            }
            const newReview = {
                id: Date.now().toString(), // Simple unique ID
                userId: interaction.user.id,
                userName: interaction.user.tag,
                rating,
                service,
                reviewText,
                timestamp: Date.now(),
                status: 'pending' // All new reviews are pending by default
            };
            const reviews = await loadReviews();
            reviews.push(newReview);
            await saveReviews(reviews);
            await sendPendingReviewNotification(newReview, interaction);
            await interaction.editReply({ content: 'Your review has been submitted and is awaiting staff approval. Thank you for your feedback!' });
        } else if (interaction.customId === 'buy_ticket_modal') {
            await interaction.deferReply({ ephemeral: true });
            const service = interaction.fields.getTextInputValue('serviceInput');
            const payment = interaction.fields.getTextInputValue('paymentInput');
            const quantity = interaction.fields.getTextInputValue('quantityInput') || 'Not specified';
            
            const initialMessage = `
            **Service/Product:** ${service}
            **Payment Method:** ${payment}
            **Quantity:** ${quantity}
            `;
            
            await createTicketChannel(interaction, 'buy', initialMessage);
        
        // --- NEW: Handle the 'help' modal submission ---
        } else if (interaction.customId === 'help_ticket_modal') {
            await interaction.deferReply({ ephemeral: true });
            const issueDetails = interaction.fields.getTextInputValue('issueInput');
            
            const initialMessage = `
            **Issue/Question:** ${issueDetails}
            `;

            await createTicketChannel(interaction, 'help', initialMessage);
        }
    }
});

client.login(BOT_TOKEN);
