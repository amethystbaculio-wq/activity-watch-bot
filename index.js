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
const COOLDOWN_TIME = 3 * 60 * 60 * 1000; // 3 hours

const usedMessagesToday = new Map(); function getTodayKey() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); } function getRandomUnusedMessage(gameName, messages) { const today = getTodayKey(); const key = `${today}-${gameName}`; if (!usedMessagesToday.has(key)) { usedMessagesToday.set(key, new Set()); } const usedSet = usedMessagesToday.get(key); let availableMessages = messages.filter(msg => !usedSet.has(msg)); if (availableMessages.length === 0) { usedSet.clear(); availableMessages = messages; } const randomMessage = availableMessages[Math.floor(Math.random() * availableMessages.length)]; usedSet.add(randomMessage); return randomMessage; }


const gameMessages = {
  "Dota 2": [
"Roshan feels safer knowing {user} is online.",
"A support's worst nightmare has logged in: {user}.",
"Another player ready to farm for 40 minutes and lose has arrived: {user}.",
"Another lane is about to become educational content thanks to {user}.",
"The MMR donation center is now open. Welcome, {user}.",
"Roshan has been informed he won't be disturbed by {user}.",
"Another expert in avoiding teamfights has logged in: {user}.",
"The Ancient is sweating already. {user} just launched Dota 2.",
"Another "guys we got late game" enthusiast has arrived: {user}.",
"A wardless adventure is about to begin with {user}.",
"Another master of fighting without buyback has logged in: {user}.",
"The Ancient didn't deserve this, {user}.",
"A walking bounty rune has entered the queue: {user}.",
"The enemy carry just checked {user}'s profile and smiled.",
"The buyback button is already nervous about {user}.",
"How many "one last game" are we at now, {user}?",
"Did the MMR not suffer enough already, {user}?",
"{user} opened Dota 2 voluntarily?",
"Are we winning today or conducting experiments again, {user}?",
"Have you considered peace and happiness instead, {user}?",
"Another ranked session? Bold choice, {user}.",
"The ancients are awake. Unfortunately, so is {user}.",
"Another player has entrusted their happiness to Valve: {user}.",
"A future highlight or disaster is loading for {user}.",
"Valve has accepted another sacrifice: {user}.",
"A 40-minute commitment was made without reading the terms and conditions. Welcome back, {user}.",
"The enemy team is about to meet their favorite teammate: {user}.",
"A future documentary titled "What Happened Mid?" starring {user} is in production.",
"Another believer in miracles has launched Dota: {user}.",
"A specialist in turning winning games into close games has arrived: {user}.",
"A future motivational speaker for losing streak survivors has logged in: {user}.",
"Another player has placed their emotional well-being in Valve's hands: {user}.",
"A future highlight clip for somebody is loading. {user} may be involved.",
"Another future legend, disaster, or both has logged in: {user}.",
"The road to Immortal, Herald, or enlightenment begins for {user}.",
"The matchmaking algorithm has entered its villain arc after seeing {user}.",
"The carry has reported for duty: {user}.",
"A future rampage owner has arrived: {user}.",
"The comeback specialist has arrived: {user}.",
"A future MVP screen is warming up for {user}.",
"A specialist in making impossible games winnable has arrived: {user}."
    "not the Dota 2 icon again bro 😭 {user}",
    "{user} has joined Dota 2. Pray for the teammates.",
    "{user} opened Dota 2 and the matchmaking gods started laughing.",
    "bro farming Dota 2 MMR instead of nests 😭 {user}",
    "{user} about to blame their Dota 2 teammates for the next 40 minutes",
    "{user} just logged in and already owes MMR.",
    "{user} has launched Dota 2. Teammates, stay strong.",
    "{user} bro opened Dota 2 just to experience emotional damage again 😭",
    "{user} fighting demons in SEA server once again 💀",
    "{user} willingly entering another 60-minute Dota 2 suffering session",
    "{user} Bro opened Dota 2 and the ancient started shaking. 💀",
    "{user} another monitor about to suffer because of Dota 2 😭",
    "{user} treating Dota 2 ranked like The International qualifiers",
    "{user} Bro opened Dota 2 and the SEA server started rubbing its hands together. ",
    "{user} sacrificing peace of mind for MMR again",
    "Bro chose Dota 2 over nests again. 💀 {user}",
    "another day, another Dota 2 breakdown for {user}"
  ],

  "VALORANT": [
    "Welcome back, {user}. The bottom frag slot missed you.",
    "Another day, another innocent team ruined by {user}",
    "Riot Games thanks {user} for the donation of RR.",
    "bro opened VALORANT just to get one-tapped again 💀 {user}",
    "{user} thinks they’re radiant again 😭",
    "{user} opened Valorant. Prepare for questionable decisions",
    "bro queueing VALORANT like VCT scouts are watching 😭 {user}",
    "{user} about to bottom frag with confidence again 💀",
    "{user}'s teammates are already nervous",
    "bro opened VALORANT just to spectate teammates after 10 seconds 😭 {user}",
    "{user} Fresh out of loading screen, straight into spectator mode.",
    "Remember, {user}: shift walking won't hide the scoreboard",
    "Opening Valorant again, {user}? Didn't we learn yesterday?",
    "{user} Bro loaded into Valorant like he's being paid per death.",
    "Another ranked game, another character development arc for {user}.",
    "{user} Just got on Valorant and already a liability.",
    "The surrender button is preparing itself for {user}.",
    "Congratulations, {user}. You chose stress today.",
    "Welcome back, {user}, future team MVP (Most Valuable Problem).",
    "Today's goal for {user}: hit at least one bullet."
"Opening Valorant after yesterday's performance is admirable, {user}.",
"Riot should send {user} a loyalty award.",
"Future bottom frag detected: {user}.",
"Valorant launched. Excuses preloaded for {user}.",
"Competitive mode fears no one. Except maybe {user}.",
"Opening Valorant? That's one way for {user} to spend the evening.",
"Queueing for ranked with that aim is bold, {user}.",
"Another match where the spike does more damage than {user}.",
"The enemy team is warming up. {user} should too.",
"Opening Valorant after a losing streak is pure optimism, {user}.",
"The enemy Smurf is rubbing their hands together after seeing {user}.",
"Welcome back, {user}. The death cam missed you.",
"{user}'s flashbang accuracy remains undefeated—against teammates.",
"Another ranked match, another life lesson for {user}.",
"Riot Games proudly presents: {user} and The Whiff Returns.",
"Welcome back, {user}, future highlight reel for the enemy.",
"Valorant detected. May {user}'s teammates forgive them.",
"Valorant detected. Somewhere, four strangers just sighed because {user} logged in.",
"{user} opened Valorant. Was life going too well?",
"Another day, another attempt by {user} to outshoot people with better aim and healthier sleep schedules.",
"Queueing up again, {user}? The character growth is impressive.",
"The enemy team just received a mysterious feeling of optimism after {user} logged in.",
"Four teammates are about to learn patience thanks to {user}.",
"The enemy team is warming up. {user} is opening TikTok between rounds.",
"Another match where the minimap knows more than {user}.",
"Valorant opened. {user}'s "my bad" counter has been reset to zero.",
"Welcome back, {user}. The wall you're about to spray appreciates your support.",
"{user}'s future teammates are currently winning their last game. Enjoy being the reason that streak ends.",
"The only thing more random than matchmaking is {user}'s spray pattern.",
"Valorant detected. Please remain calm. {user}'s teammates won't.",
"{user} just opened Valorant. The enemy team gained a fifth player somehow.",
"Welcome back, {user}! The practice bots said they miss farming you.",
"The enemy team just got a notification: "Easy RR available. {user} is online."",
"Valorant launched. Time for {user} to discover new and creative ways to miss.",
"The enemy Jett is already editing the montage featuring {user}.",
"Valorant opened. The walls are preparing to catch more bullets from {user} than enemies.",
"{user}'s crosshair and the enemy's head are in a long-distance relationship.",
"The game started. {user}'s teammates started praying.",
"The enemy team has accepted {user}'s generous RR donation.",
"{user} launched Valorant. The bottom frag spot has been reserved.",
"The queue found four innocent victims for {user}.",
"Opening Valorant after yesterday's performance is a level of confidence I aspire to have, {user}.",
"The enemy team is warming up. {user} is changing skins.",
"Valorant launched. Time for {user} to blame ping again.",
"Valorant detected. The carry has arrived: {user}.",
"The MVP has entered the queue. Welcome back, {user}.",
"{user} has launched Valorant. Time to collect some wins.",
"The clutch king/queen has arrived: {user}.",
"{user} has launched Valorant. Time to make some clips.",
"The star player has arrived. Welcome back, {user}.",
"Welcome back, champion {user}.",
"Valorant detected. Potential top frag spotted: {user}.",
"The star player has logged in. Welcome back, {user}.",
"The enemy team doesn't know it yet, but {user} is about to make their day harder.",
"Another day, another chance for {user} to make the enemy uninstall."
  ],

  "League of Legends": [
"The enemy team is about to meet their strongest ally: {user}.",
"A specialist in turning winnable games into documentaries has arrived: {user}.",
"The enemy Nexus feels unusually safe after {user} logged in.",
"Another player has chosen emotional damage as a hobby: {user}.",
"The enemy team doesn't know it yet, but they're about to get content from {user}.",
"The enemy team has no idea how lucky they are. {user} just connected.",
"Another player has volunteered to test Riot's systems: {user}.",
"Who's getting blamed first, jungle or matchmaking, {user}?",
"How many games until "one last game" becomes five, {user}?",
"Have you prepared your "jungle diff" speech, {user}?",
"Are we playing League or attending therapy today, {user}?",
"How many questionable decisions are scheduled today, {user}?",
"The enemy jungler just got a free leash thanks to {user}.",
"Another collector of shutdown gold has entered the Rift: {user}.",
"The enemy ADC appreciates {user}'s future donations.",
"The cannon minion has more job security than {user}'s Nexus.",
"Another future "where is my team?" has connected: {user}.",
"A future 4-man dive victim has connected: {user}.",
"The top laner is preparing to become a separate game from {user}.",
"The matchmaking system just muttered "good luck" after seeing {user}.",
"A future victim of a level 2 gank has connected: {user}.",
"A future side-lane disappearance is expected from {user}.",
"The Rift welcomes one of its stronger specimens: {user}.",
"A future carry has entered champion select: {user}.",
"The enemy team has received a difficulty increase. {user} has connected.",
"A future reason for victory has connected: {user}.",
"The next teamfight MVP has arrived: {user}.",
"A future legend has entered champion select: {user}."
    "not the League icon again bro 😭 {user}",
    "bro opened League and instantly lost peace of mind 💀 {user}",
    "{user} just opened League and already looks stressed.",
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

  "ROBLOX": [
    "🚨 {user} returned to kindergarten",
    "grown adult detected playing Roblox 💀 {user}",
    "{user} fighting for their life in a Lego universe 💀",
    "bro entered Roblox and forgot adulthood exists 💀 {user}",
    "{user} another daycare session started by Roblox 😭",
    "{user} bro opened Roblox and instantly became 9 years old again 💀",
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

    if (cooldowns.has(activityId)) {
      const last = cooldowns.get(activityId);

      if (now - last < COOLDOWN_TIME) {
        continue;
      }
    }

    cooldowns.set(activityId, now);

    const randomMessage = getRandomUnusedMessage(gameName, messages);
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
    channel.send('🛒 @everyone Friendly reminder to buy your weekly shop before reset!');
  }
}, {
  timezone: 'Asia/Manila'
});

client.login(process.env.DISCORD_TOKEN);