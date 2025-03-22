const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config({ path: 'auth.env' });

const BOT_USER_ID = process.env.BOT_USER_ID;
const OAUTH_TOKEN = process.env.OAUTH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CHAT_CHANNEL_USER_ID = process.env.CHAT_CHANNEL_USER_ID;

const POINTS_FILE = 'points.json';
const COMMANDS_FILE = 'commands.json';
const MODERATORS = ['xtlos']; // Add moderators here

const EVENTSUB_WEBSOCKET_URL = 'wss://eventsub.wss.twitch.tv/ws';
let websocketSessionID;
let userPoints = loadJSON(POINTS_FILE);
let customCommands = loadJSON(COMMANDS_FILE);

const PREFIX = "-"; // Command prefix

// 🚀 Start Bot
(async () => {
    await validateToken();
    startWebSocketClient();
})();

// ✅ Load JSON File (points.json or commands.json)
function loadJSON(file) {
    if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    return {};
}

// ✅ Save JSON Data
function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ✅ Validate OAuth Token
async function validateToken() {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
        method: 'GET',
        headers: { 'Authorization': `OAuth ${OAUTH_TOKEN}` }
    });

    if (response.status !== 200) {
        console.error("Invalid OAuth Token.");
        process.exit(1);
    }
    console.log("OAuth Token Validated.");
}

// ✅ Start WebSocket Client
function startWebSocketClient() {
    let ws = new WebSocket(EVENTSUB_WEBSOCKET_URL);
    ws.on('error', console.error);
    ws.on('open', () => console.log('WebSocket connected'));
    ws.on('message', (data) => handleWebSocketMessage(JSON.parse(data.toString())));
}

// ✅ Handle WebSocket Messages
function handleWebSocketMessage(data) {
    if (data.metadata.message_type === 'session_welcome') {
        websocketSessionID = data.payload.session.id;
        registerEventSubListeners();
    } else if (data.metadata.message_type === 'notification') {
        handleChatMessage(data.payload.event);
    }
}

// ✅ Register Event Listeners
async function registerEventSubListeners() {
    const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OAUTH_TOKEN}`,
            'Client-Id': CLIENT_ID,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'channel.chat.message',
            version: '1',
            condition: { broadcaster_user_id: CHAT_CHANNEL_USER_ID, user_id: BOT_USER_ID },
            transport: { method: 'websocket', session_id: websocketSessionID }
        })
    });

    if (response.status !== 202) {
        console.error("Failed to subscribe to channel.chat.message.");
        process.exit(1);
    }
    console.log("Subscribed to chat messages.");
}

// ✅ Handle Chat Messages
async function handleChatMessage(event) {
    const message = event.message.text.trim();
    const user = event.chatter_user_login.toLowerCase();
    
    console.log(`Message from ${user}: ${message}`);

    // ✅ Case-sensitive non-prefix commands with custom delays
    const nonPrefixCommands = {
        "LOL": { response: "LOL", delay: 1000 }, // 1 second delay
        "LMAO": { response: "LMAO", delay: 2000 }, // 2-second delay
        "BRUH": { response: "BRUH", delay: 500 } // 0.5-second delay
    };

    if (nonPrefixCommands.hasOwnProperty(message)) {
        const { response, delay } = nonPrefixCommands[message];
        setTimeout(async () => {
            await sendChatMessage(response);
        }, delay);
        return;
    }

    // ✅ Handle commands with prefix
    if (message.startsWith(PREFIX)) {
        const args = message.slice(1).split(" ");
        const command = args.shift().toLowerCase();
        await executeCommand(command, user, args);
    }
}

// ✅ Execute Commands
async function executeCommand(command, user, args) {
    switch (command) {
        case 'addcmd': // Moderator-only command to add new commands
            if (MODERATORS.includes(user)) {
                const newCommand = args[0];
                const response = args.slice(1).join(" ");
                if (newCommand && response) {
                    customCommands[newCommand] = response;
                    saveJSON(COMMANDS_FILE, customCommands);
                    await sendChatMessage(`Command '${newCommand}' added!`);
                } else {
                    await sendChatMessage(`Usage: -addcmd <command> <response>`);
                }
            } else {
                await sendChatMessage(`@${user}, you do not have permission to add commands.`);
            }
            break;

        case 'removecmd': // Moderator-only command to remove commands
            if (MODERATORS.includes(user)) {
                const cmdToRemove = args[0];
                if (cmdToRemove && customCommands[cmdToRemove]) {
                    delete customCommands[cmdToRemove];
                    saveJSON(COMMANDS_FILE, customCommands);
                    await sendChatMessage(`Command '${cmdToRemove}' removed!`);
                } else {
                    await sendChatMessage(`Command '${cmdToRemove}' not found.`);
                }
            } else {
                await sendChatMessage(`@${user}, you do not have permission to remove commands.`);
            }
            break;

        case 'points': // Check points
            await checkPoints(user);
            break;

        case 'givepoints': // Give points to another user
            await givePoints(user, args);
            break;

        case 'gamble': // Gamble points
            await gamblePoints(user, args);
            break;

        default:
            if (customCommands[command]) {
                await sendChatMessage(customCommands[command]);
            }
    }
}

// ✅ Send Chat Message
async function sendChatMessage(message) {
    await fetch('https://api.twitch.tv/helix/chat/messages', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OAUTH_TOKEN}`,
            'Client-Id': CLIENT_ID,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            broadcaster_id: CHAT_CHANNEL_USER_ID,
            sender_id: BOT_USER_ID,
            message: message
        })
    });

    console.log("Sent:", message);
}

// ✅ Check Points
async function checkPoints(user) {
    const points = userPoints[user] || 0;
    await sendChatMessage(`${user}, you have ${points} points.`);
}

// ✅ Give Points
async function givePoints(user, args) {
    const recipient = args[0]?.toLowerCase();
    const amount = parseInt(args[1], 10);

    if (!recipient || isNaN(amount) || amount <= 0) {
        await sendChatMessage(`Usage: -givepoints <user> <amount>`);
        return;
    }

    if ((userPoints[user] || 0) < amount) {
        await sendChatMessage(`@${user}, you don't have enough points.`);
        return;
    }

    userPoints[user] -= amount;
    userPoints[recipient] = (userPoints[recipient] || 0) + amount;
    saveJSON(POINTS_FILE, userPoints);
    await sendChatMessage(`@${user} gave ${amount} points to @${recipient}.`);
}

// ✅ Gamble Points
async function gamblePoints(user, args) {
    const bet = parseInt(args[0], 10);
    if (isNaN(bet) || bet <= 0 || (userPoints[user] || 0) < bet) {
        await sendChatMessage(`@${user}, invalid bet.`);
        return;
    }

    const win = Math.random() < 0.5;
    userPoints[user] += win ? bet : -bet;
    saveJSON(POINTS_FILE, userPoints);
    await sendChatMessage(`@${user} ${win ? "won" : "lost"} ${bet} points!`);
}
