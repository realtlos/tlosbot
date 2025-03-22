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
const MODERATORS = ['xtlos', 'yourusername']; // Add your username here

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

// ✅ Load JSON File
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
    console.log("✅ OAuth Token Validated.");
}

// ✅ Start WebSocket Client with auto-reconnect
function startWebSocketClient() {
    let ws = new WebSocket(EVENTSUB_WEBSOCKET_URL);

    ws.on('error', console.error);
    ws.on('open', () => console.log('✅ WebSocket connected'));
    ws.on('message', (data) => handleWebSocketMessage(JSON.parse(data.toString())));
    ws.on('close', () => {
        console.log('❌ WebSocket disconnected. Reconnecting in 5 seconds...');
        setTimeout(startWebSocketClient, 5000);
    });
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
            type: 'channel.chat.notification',
            version: '1',
            condition: { broadcaster_user_id: CHAT_CHANNEL_USER_ID },
            transport: { method: 'websocket', session_id: websocketSessionID }
        })
    });

    if (response.status !== 202) {
        console.error("❌ Failed to subscribe to chat notifications.");
        process.exit(1);
    }
    console.log("✅ Subscribed to chat messages.");
}

// ✅ Handle Chat Messages
async function handleChatMessage(event) {
    const message = event.message.text?.trim();
    const user = event.chatter_user_login?.toLowerCase();

    if (!message || !user) {
        console.log("⚠️ Received invalid message event:", event);
        return;
    }

    console.log(`💬 Received message from ${user}: ${message}`);

    // ✅ Case-sensitive non-prefix commands with custom delays
    const nonPrefixCommands = {
        "LOL": { response: "LOL", delay: 1000 },
        "WOW": { response: "WOW", delay: 2000 },
        "GG": { response: "GG", delay: 500 }
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
        case 'addpoints':
            if (MODERATORS.includes(user)) {
                if (args.length < 2) {
                    await sendChatMessage(`Usage: -addpoints <user> <amount>`);
                    return;
                }
                const targetUser = args[0].toLowerCase();
                const amount = parseInt(args[1], 10);

                if (isNaN(amount) || amount <= 0) {
                    await sendChatMessage(`Invalid amount. Usage: -addpoints <user> <amount>`);
                    return;
                }

                userPoints[targetUser] = (userPoints[targetUser] || 0) + amount;
                saveJSON(POINTS_FILE, userPoints);
                await sendChatMessage(`@${targetUser} has been given ${amount} points! 🎉`);
            } else {
                await sendChatMessage(`@${user}, you do not have permission to add points.`);
            }
            break;

        case 'points':
            const target = args[0]?.toLowerCase() || user;
            await sendChatMessage(`@${target} has ${userPoints[target] || 0} points.`);
            break;

        case 'addcmd':
            if (MODERATORS.includes(user)) {
                const cmd = args[0]?.toLowerCase();
                const response = args.slice(1).join(" ");
                if (!cmd || !response) {
                    await sendChatMessage(`Usage: -addcmd <command> <response>`);
                    return;
                }
                customCommands[cmd] = response;
                saveJSON(COMMANDS_FILE, customCommands);
                await sendChatMessage(`Command "-${cmd}" added!`);
            }
            break;

        case 'delcmd':
            if (MODERATORS.includes(user)) {
                const cmd = args[0]?.toLowerCase();
                if (!cmd || !customCommands[cmd]) {
                    await sendChatMessage(`Command "-${cmd}" does not exist.`);
                    return;
                }
                delete customCommands[cmd];
                saveJSON(COMMANDS_FILE, customCommands);
                await sendChatMessage(`Command "-${cmd}" removed!`);
            }
            break;

        default:
            if (customCommands[command]) {
                await sendChatMessage(customCommands[command]);
            }
    }
}

// ✅ Send Chat Message
async function sendChatMessage(message) {
    console.log("✅ Sending message:", message);
    // Here, implement your logic to send a chat message through the Twitch API or IRC.
}
