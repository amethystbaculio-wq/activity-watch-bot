require('dotenv').config();

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('West Coast bot is alive!');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Web server is running.');
});

const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const CHANNEL_ID = process.env.CHANNEL_ID;

const cooldowns = new Map();
const COOLDOWN_TIME = 60 * 60 * 1000; // 1 hour

const leagueCooldowns = new Map();
const LEAGUE_COOLDOWN = 3 * 60 * 60 * 1000; // 3 hours

const gameMessages = {
  "Dota 2": [
    "not the Dota 2 icon again bro 😭 {user}",
    "🚨 {user} escaped DN for Dota 2 again",
    "bro farming Dota 2 MMR instead of nests 😭 {user}",
    "{user} saw “RAID tonight” and quietly opened Dota 2 💀",
    "PT leader watching {user} queue Dota 2 instead of joining the party 💀",
    "{user} about to blame their Dota 2 teammates for the next 40 minutes",
    "“my team bobo” incoming from {user} after 1 death in Dota 2",
    "bro opened Dota 2 just to experience emotional damage again 😭",
    "{user} fighting demons in SEA server once again 💀",
    "{user} willingly entering another 60-minute Dota 2 suffering session",
    "{user} after dying once in Dota 2: “gg end”",
    "another monitor about to suffer because of Dota 2 😭",
    "{user} treating Dota 2 ranked like The International qualifiers",
    "bro opened Dota 2 the moment raid schedule got posted 💀",
    "{user} sacrificing peace of mind for MMR again",
    "another day, another Dota 2 breakdown for {user}"
  ],

  "VALORANT": [
    "not the VALORANT icon again bro 😭 {user}",
    "🚨 {user} escaped the guild for VALORANT again",
    "bro opened VALORANT the moment raid schedule got posted 💀 {user}",
    "PT members watching {user} lock Jett instead of joining the party 😭",
    "bro opened VALORANT just to get one-tapped again 💀 {user}",
    "{user} thinks they’re radiant again 😭",
    "another emotional damage session started by VALORANT 💀 {user}",
    "bro queueing VALORANT like VCT scouts are watching 😭 {user}",
    "{user} about to bottom frag with confidence again 💀",
    "“team diff” incoming from {user} in 3…2…1…",
    "“my crosshair off today” — {user} after going 3/17 😭",
    "bro opened VALORANT just to spectate teammates after 10 seconds 😭 {user}",
    "another “NT NT NT” incident detected from {user}",
    "bro got one lucky headshot and started feeling immortal 💀 {user}"
  ],

  "League of Legends": [
    "not the League icon again bro 😭 {user}",
    "bro opened League and instantly lost peace of mind 💀 {user}",
    "{user} about to blame jungle in the next 5 minutes",
    "{user} entering champion select already tilted",
    "bro opened League just to get camped and emotionally collapse 😭 {user}",
    "{user} one death away from writing paragraphs in all chat 💀",
    "League detected. Mental stability unavailable for {user}. 💀",
    "“my team so useless” starter pack detected from {user}",
    "bro opened League and abandoned happiness immediately 💀 {user}",
    "{user} about to spam ping teammates after one mistake 😭",
    "another keyboard smashing session started by League of Legends 💀 {user}",
    "bro queueing League like suffering is a hobby 😭 {user}",
    "another “jungle diff” allegation incoming from {user}",
    "{user} loading into solo queue like it’s a daily punishment 😭",
    "bro opened League and immediately became toxic 💀 {user}",
    "another 40-minute mental breakdown started by {user} 😭",
    "{user} fighting more with teammates than enemies 😭",
    "bro entered Summoner’s Rift and lost emotional stability instantly 💀 {user}"
  ],

  "Roblox": [
    "🚨 {user} returned to kindergarten",
    "grown adult detected playing Roblox 💀 {user}",
    "{user} fighting for their life in a Lego universe 💀",
    "bro entered Roblox and forgot adulthood exists 💀 {user}",
    "another daycare session started by Roblox 😭",
    "bro opened Roblox and instantly became 9 years old again 💀",
    "{user} fighting children in Roblox competitive games 😭"
  ]
};

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.activities) return;

  const member = newPresence.member;
  if (!member || member.user.bot) return;

  const userId = member.id;

  for (const activity of newPresence.activities) {
    console.log(`${member.user.tag} activity: ${activity.name} | type: ${activity.type}`);
if (activity.type !== ActivityType.Playing) continue;

const gameName = activity.name;

const messages = gameMessages[gameName];
if (!messages) continue;

const activityId = `${userId}-${gameName}`;
const now = Date.now();
if (gameName === "League of Legends") {
  const lastLeague = leagueCooldowns.get(userId);

  if (lastLeague && now - lastLeague < LEAGUE_COOLDOWN) {
    continue;
  }

  leagueCooldowns.set(userId, now);

} else {
  if (cooldowns.has(activityId)) {
    const last = cooldowns.get(activityId);

    if (now - last < COOLDOWN_TIME) {
      continue;
    }
  }

  cooldowns.set(activityId, now);
}

const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    const finalMessage = randomMessage.replaceAll('{user}', `<@${userId}>`);

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (channel) channel.send(finalMessage);
  }
});

client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
});

// weekly reminder
const cron = require('node-cron');

cron.schedule('0 22 * * 5', async () => {
  const channel = await client.channels.fetch(CHANNEL_ID);

  if (channel) {
    channel.send('🛒 Friendly reminder to buy your weekly shop before reset!');
  }
}, {
  timezone: 'Asia/Manila'
});

client.login(process.env.DISCORD_TOKEN);