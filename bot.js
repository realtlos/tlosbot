const tmi = require('tmi.js');
const fs = require('fs');
const fetch = require('node-fetch');
require('dotenv').config({ path: 'auth.env' });

// -------------------------
// Utility Functions
// -------------------------
function loadJSON(file) {
    try {
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    } catch (error) {
        console.error(`Error loading ${file}:`, error);
        return {};
    }
}

function saveJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error saving ${file}:`, error);
    }
}

// -------------------------
// Persistent Storage Files
// -------------------------
const POINTS_FILE = 'points.json';
const COMMANDS_FILE = 'commands.json';
let userPoints = loadJSON(POINTS_FILE);
let customCommands = loadJSON(COMMANDS_FILE);
let sevenTVEmotes = [];

// -------------------------
// Configuration & Moderators
// -------------------------
const PREFIX = "-"; 
const MODERATORS = ['xtlos', 'yourusername'];

// -------------------------
// TMI.js Client Setup
// -------------------------
const client = new tmi.Client({
    options: { debug: true },
    identity: {
        username: process.env.BOT_USERNAME,
        password: process.env.OAUTH_TOKEN
    },
    channels: [process.env.CHANNEL]
});

// Connect the bot to Twitch
client.connect().catch(console.error);

client.on('connected', () => {
    console.log(`✅ Connected to Twitch`);
    load7TVEmotes(); // Load 7TV emotes on startup
});

// -------------------------
// Fetch 7TV Emotes
// -------------------------
async function load7TVEmotes() {
    try {
        const response = await fetch(`https://7tv.io/v3/users/twitch/${process.env.TWITCH_ID}`);
        const data = await response.json();
        sevenTVEmotes = data.emote_set?.emotes.map(e => e.name) || [];
        console.log(`🎭 Loaded ${sevenTVEmotes.length} 7TV emotes.`);
    } catch (error) {
        console.error("❌ Failed to fetch 7TV emotes:", error);
    }
}

// -------------------------
// Message Handler
// -------------------------
client.on('message', (channel, tags, message, self) => {
    if (self) return;

    const username = tags.username.toLowerCase();
    const trimmedMessage = message.trim();
    console.log(`[💬] ${username}: "${trimmedMessage}"`);

    // -------------------------
    // Auto-response for non-prefix triggers
    // -------------------------
    const autoResponses = { "LOL": 1000, "WOW": 2000, "GG": 500 };
    
    if (autoResponses[trimmedMessage]) {
        setTimeout(() => {
            client.say(channel, trimmedMessage);
            console.log(`📢 Auto-response: ${trimmedMessage}`);
        }, autoResponses[trimmedMessage]);
        return;
    }

    // -------------------------
    // Detect 7TV Emotes
    // -------------------------
    if (sevenTVEmotes.includes(trimmedMessage)) {
        client.say(channel, `@${username} used 7TV emote: ${trimmedMessage} 👀`);
        return;
    }

    // -------------------------
    // Command Handling
    // -------------------------
    if (!trimmedMessage.startsWith(PREFIX)) return;
    
    const args = trimmedMessage.slice(PREFIX.length).split(/\s+/);
    const command = args.shift()?.toLowerCase();
    if (!command) return;

    console.log(`[⚡ COMMAND] ${username} used "${command}" with args: [${args}]`);

    switch (command) {
        case 'addpoints':
            if (!MODERATORS.includes(username)) {
                client.say(channel, `@${username}, you don't have permission.`);
                return;
            }
            if (args.length < 2) {
                client.say(channel, `Usage: -addpoints <user> <amount>`);
                return;
            }
            const targetUser = args[0].toLowerCase();
            const amount = parseInt(args[1], 10);
            if (isNaN(amount) || amount <= 0) {
                client.say(channel, `Invalid amount. Usage: -addpoints <user> <amount>`);
                return;
            }
            userPoints[targetUser] = (userPoints[targetUser] || 0) + amount;
            saveJSON(POINTS_FILE, userPoints);
            client.say(channel, `@${targetUser} received ${amount} points! 🎉`);
            break;

        case 'points':
            const target = args[0] ? args[0].toLowerCase() : username;
            client.say(channel, `@${target} has ${userPoints[target] || 0} points.`);
            break;

        case 'addcmd':
            if (!MODERATORS.includes(username)) return;
            const newCmd = args[0]?.toLowerCase();
            const newResponse = args.slice(1).join(" ");
            if (!newCmd || !newResponse) {
                client.say(channel, `Usage: -addcmd <command> <response>`);
                return;
            }
            customCommands[newCmd] = newResponse;
            saveJSON(COMMANDS_FILE, customCommands);
            client.say(channel, `Command "-${newCmd}" added!`);
            break;

        case 'delcmd':
            if (!MODERATORS.includes(username)) return;
            const delCmd = args[0]?.toLowerCase();
            if (!delCmd || !customCommands[delCmd]) {
                client.say(channel, `Command "-${delCmd}" does not exist.`);
                return;
            }
            delete customCommands[delCmd];
            saveJSON(COMMANDS_FILE, customCommands);
            client.say(channel, `Command "-${delCmd}" removed!`);
            break;

        case 'gamble':
            const gambleAmount = parseInt(args[0], 10);

            // Check if the user provided a valid amount
            if (isNaN(gambleAmount) || gambleAmount <= 0) {
                client.say(channel, `@${username}, please provide a valid amount to gamble.`);
                return;
            }

            // Check if the user has enough points
            if (!userPoints[username] || userPoints[username] < gambleAmount) {
                client.say(channel, `@${username}, you don't have enough points to gamble.`);
                return;
            }

            // Simulate a 50% chance of winning
            const win = Math.random() < 0.5; // 50% chance to win

            // Calculate the result and update points
            if (win) {
                userPoints[username] += gambleAmount;
                saveJSON(POINTS_FILE, userPoints);
                client.say(channel, `@${username} gambled ${gambleAmount} points and won! 🎉 You now have ${userPoints[username]} points.`);
            } else {
                userPoints[username] -= gambleAmount;
                saveJSON(POINTS_FILE, userPoints);
                client.say(channel, `@${username} gambled ${gambleAmount} points and lost. 😞 You now have ${userPoints[username]} points.`);
            }
            break;

        default:
            if (customCommands[command]) {
                client.say(channel, customCommands[command]);
            } else {
                console.warn(`Unknown command: ${command}`);
            }
    }
});
