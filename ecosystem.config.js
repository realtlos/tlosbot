module.exports = {
    apps: [
      {
        name: "your-bot-name",
        script: "bot.js",
        env: {
          BOT_USERNAME: "yourbotname",
          OAUTH_TOKEN: "oauth:yourtoken",
          CHANNEL: "yourchannelname",
          CLIENT_ID: "yourclientid",
          TWITCH_ID: "yourtwitchid"
        }
      }
    ]
  };
  