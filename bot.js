const tmi = require('tmi.js');
const fs = require('fs');
require('dotenv').config({ path: 'auth.env' });

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
// Persistent Storage Files
// -------------------------
const POINTS_FILE = 'points.json';
const COMMANDS_FILE = 'commands.json';
let userPoints = loadJSON(POINTS_FILE);
let customCommands = loadJSON(COMMANDS_FILE);

// -------------------------
// Configuration & Moderators
// -------------------------
const PREFIX = "-"; // Command prefix
// Make sure moderator names are in lowercase.
const MODERATORS = ['xtlos', 'yourusername'];

// -------------------------
// TMI.js Client Setup
// -------------------------
const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.OAUTH_TOKEN // This should be formatted like "oauth:abcdef123456"
  },
  channels: [ process.env.CHANNEL ]
});

// Connect the bot to Twitch
client.connect().catch(console.error);

// -------------------------
// Message Handler
// -------------------------
client.on('message', (channel, tags, message, self) => {
  if (self) return; // Ignore messages from the bot itself

  const username = tags.username.toLowerCase();
  const trimmedMessage = message.trim();
  console.log(`Received message from ${username}: "${trimmedMessage}"`);

  // -------------------------
  // Non-Prefix Commands (case-sensitive)
  // -------------------------
  // These commands trigger only if the message exactly matches the key.
  if (trimmedMessage === "LOL" || trimmedMessage === "WOW" || trimmedMessage === "GG") {
    const delays = {
      "LOL": 1000,
      "WOW": 2000,
      "GG": 500
    };
    const response = trimmedMessage;
    setTimeout(() => {
      client.say(channel, response);
      console.log(`Sent non-prefix command response: ${response}`);
    }, delays[trimmedMessage]);
    return;
  }

  // -------------------------
  // Commands with Prefix (e.g., "-addpoints")
  // -------------------------
  if (trimmedMessage.startsWith(PREFIX)) {
    const args = trimmedMessage.slice(PREFIX.length).split(" ").filter(arg => arg !== '');
    const command = args.shift()?.toLowerCase();
    if (!command) {
      console.warn("No command detected after prefix.");
      return;
    }
    console.log(`Command "${command}" with arguments [${args}] from ${username}`);

    switch (command) {
      case 'addpoints':
        console.log(`[addpoints] Command invoked by ${username}. Moderator list: ${MODERATORS.join(', ')}`);
        if (!MODERATORS.includes(username)) {
          console.warn(`[addpoints] Unauthorized attempt by ${username}`);
          client.say(channel, `@${username}, you do not have permission to add points.`);
          return;
        }
        if (args.length < 2) {
          console.warn(`[addpoints] Insufficient arguments provided by ${username}: ${args}`);
          client.say(channel, `Usage: -addpoints <user> <amount>`);
          return;
        }
        const targetUser = args[0].toLowerCase();
        const amount = parseInt(args[1], 10);
        if (isNaN(amount) || amount <= 0) {
          console.warn(`[addpoints] Invalid amount provided by ${username}: ${args[1]}`);
          client.say(channel, `Invalid amount. Usage: -addpoints <user> <amount>`);
          return;
        }
        userPoints[targetUser] = (userPoints[targetUser] || 0) + amount;
        saveJSON(POINTS_FILE, userPoints);
        console.log(`[addpoints] Added ${amount} points to ${targetUser}. New total: ${userPoints[targetUser]}`);
        client.say(channel, `@${targetUser} has been given ${amount} points! 🎉`);
        break;

      case 'points': {
        const target = args[0] ? args[0].toLowerCase() : username;
        client.say(channel, `@${target} has ${userPoints[target] || 0} points.`);
        break;
      }
      
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
        
      default:
        if (customCommands[command]) {
          client.say(channel, customCommands[command]);
        } else {
          console.warn(`Unknown command: ${command}`);
        }
    }
  }
});
