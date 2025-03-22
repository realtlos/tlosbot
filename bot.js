const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config({ path: 'auth.env' });

// Environment variables (ensure these are properly set in auth.env)
const BOT_USER_ID = process.env.BOT_USER_ID;
const OAUTH_TOKEN = process.env.OAUTH_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CHAT_CHANNEL_USER_ID = process.env.CHAT_CHANNEL_USER_ID;

// Files for persistent storage
const POINTS_FILE = 'points.json';
const COMMANDS_FILE = 'commands.json';

// Moderator list: all names must be lowercase (incoming usernames are lowercased)
const MODERATORS = ['xtlos', 'yourusername'];

// Twitch EventSub WebSocket URL
const EVENTSUB_WEBSOCKET_URL = 'wss://eventsub.wss.twitch.tv/ws';

let websocketSessionID;
let userPoints = loadJSON(POINTS_FILE);
let customCommands = loadJSON(COMMANDS_FILE);

const PREFIX = "-"; // Command prefix

// -------------------------
// Bot Startup
// -------------------------
(async () => {
  await validateToken();
  startWebSocketClient();
})();

// -------------------------
// Utility Functions
// -------------------------
function loadJSON(file) {
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      console.error(`Error parsing ${file}:`, error);
      return {};
    }
  }
  return {};
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing ${file}:`, error);
  }
}

// -------------------------
// Twitch Token Validation
// -------------------------
async function validateToken() {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      method: 'GET',
      headers: { 'Authorization': `OAuth ${OAUTH_TOKEN}` }
    });
    if (response.status !== 200) {
      console.error("Invalid OAuth Token.");
      process.exit(1);
    }
    console.log("✅ OAuth Token Validated.");
  } catch (error) {
    console.error("Error validating OAuth Token:", error);
    process.exit(1);
  }
}

// -------------------------
// WebSocket Client with Auto-Reconnect
// -------------------------
function startWebSocketClient() {
  const ws = new WebSocket(EVENTSUB_WEBSOCKET_URL);

  ws.on('open', () => {
    console.log('✅ WebSocket connected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  ws.on('message', (data) => {
    try {
      const parsedData = JSON.parse(data.toString());
      handleWebSocketMessage(parsedData);
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  });
  
  ws.on('close', () => {
    console.log('❌ WebSocket disconnected. Reconnecting in 5 seconds...');
    setTimeout(startWebSocketClient, 5000);
  });
}

// -------------------------
// Handle WebSocket Messages from Twitch
// -------------------------
function handleWebSocketMessage(data) {
  console.log("Received WebSocket message:", JSON.stringify(data));
  
  // Expecting a session welcome or a notification
  if (data.metadata.message_type === 'session_welcome') {
    websocketSessionID = data.payload.session.id;
    console.log("Session Welcome received. Session ID:", websocketSessionID);
    registerEventSubListeners();
  } else if (data.metadata.message_type === 'notification') {
    if (data.payload && data.payload.event) {
      handleChatMessage(data.payload.event);
    } else {
      console.warn("Notification received with no event payload.");
    }
  } else {
    console.warn("Unhandled WebSocket message type:", data.metadata.message_type);
  }
}

// -------------------------
// Register EventSub Listeners
// -------------------------
async function registerEventSubListeners() {
  try {
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
      console.error("❌ Failed to subscribe to chat notifications. Response status:", response.status);
      process.exit(1);
    }
    console.log("✅ Subscribed to chat notifications.");
  } catch (error) {
    console.error("Error during subscription to EventSub:", error);
    process.exit(1);
  }
}

// -------------------------
// Handle Chat Messages
// -------------------------
async function handleChatMessage(event) {
  console.log("Chat event received:", JSON.stringify(event));
  
  // Check event structure – adjust based on actual payload structure from Twitch
  const message = event.message?.text?.trim();
  const user = event.chatter_user_login?.toLowerCase();

  if (!message || !user) {
    console.warn("⚠️ Received invalid message event:", JSON.stringify(event));
    return;
  }

  // Log the exact message (in quotes) to catch extra spaces or formatting issues
  console.log(`💬 Received message from ${user}: "${message}"`);

  // -------------------------
  // Non-Prefix Commands (case-sensitive)
  // -------------------------
  // These will trigger only if the message exactly equals the key (e.g. "LOL")
  const nonPrefixCommands = {
    "LOL": { response: "LOL", delay: 1000 },
    "WOW": { response: "WOW", delay: 2000 },
    "GG":  { response: "GG",  delay: 500 }
  };

  if (nonPrefixCommands.hasOwnProperty(message)) {
    console.log(`Non-prefix command "${message}" recognized.`);
    const { response, delay } = nonPrefixCommands[message];
    setTimeout(async () => {
      await sendChatMessage(response);
    }, delay);
    return;
  }

  // -------------------------
  // Commands with Prefix (e.g., "-addpoints")
  // -------------------------
  if (message.startsWith(PREFIX)) {
    const args = message.slice(PREFIX.length).split(" ").filter(arg => arg !== '');
    const command = args.shift()?.toLowerCase();
    if (!command) {
      console.warn("No command found after prefix in message:", message);
      return;
    }
    console.log(`Command "${command}" with arguments [${args}] from ${user}`);
    await executeCommand(command, user, args);
  }
}

// -------------------------
// Execute Commands
// -------------------------
async function executeCommand(command, user, args) {
  switch (command) {
    case 'addpoints':
      console.log(`User "${user}" is attempting -addpoints. Moderator list: [${MODERATORS.join(', ')}]`);
      if (!MODERATORS.includes(user)) {
        console.warn(`User ${user} is not authorized to add points.`);
        await sendChatMessage(`@${user}, you do not have permission to add points.`);
        return;
      }
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
      console.log(`Added ${amount} points to ${targetUser}`);
      await sendChatMessage(`@${targetUser} has been given ${amount} points! 🎉`);
      break;

    case 'points':
      const target = args[0]?.toLowerCase() || user;
      await sendChatMessage(`@${target} has ${userPoints[target] || 0} points.`);
      break;

    case 'addcmd':
      if (!MODERATORS.includes(user)) return;
      const newCmd = args[0]?.toLowerCase();
      const newResponse = args.slice(1).join(" ");
      if (!newCmd || !newResponse) {
        await sendChatMessage(`Usage: -addcmd <command> <response>`);
        return;
      }
      customCommands[newCmd] = newResponse;
      saveJSON(COMMANDS_FILE, customCommands);
      console.log(`Added custom command: ${newCmd}`);
      await sendChatMessage(`Command "-${newCmd}" added!`);
      break;

    case 'delcmd':
      if (!MODERATORS.includes(user)) return;
      const delCmd = args[0]?.toLowerCase();
      if (!delCmd || !customCommands[delCmd]) {
        await sendChatMessage(`Command "-${delCmd}" does not exist.`);
        return;
      }
      delete customCommands[delCmd];
      saveJSON(COMMANDS_FILE, customCommands);
      console.log(`Deleted custom command: ${delCmd}`);
      await sendChatMessage(`Command "-${delCmd}" removed!`);
      break;

    default:
      // Check if a custom command exists
      if (customCommands[command]) {
        await sendChatMessage(customCommands[command]);
      } else {
        console.warn(`Unknown command: ${command}`);
      }
  }
}

// -------------------------
// Send Chat Message
// -------------------------
async function sendChatMessage(message) {
  console.log("✅ Sending message:", message);
  // TODO: Implement your logic to send a chat message through Twitch's API or IRC.
  // For example, if you are using tmi.js or an HTTP endpoint, place that code here.
}
