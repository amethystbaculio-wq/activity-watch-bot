require('dotenv').config();

// SAFETY NET: prevent unhandled errors from crashing the whole bot
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('West Coast bot is alive!');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Web server is running.');
});

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const CHANNEL_ID = process.env.CHANNEL_ID;

const LOOT_CATEGORY_ID = process.env.LOOT_CATEGORY_ID;

const ENABLE_GAME_FEED = false;

// ==============================
// WEST COAST RECRUITMENT SYSTEM
// ==============================
const APPLICATION_CHANNEL_ID = process.env.APPLICATION_CHANNEL_ID;
const RECRUITMENT_TRACKER_CHANNEL_ID = process.env.RECRUITMENT_TRACKER_CHANNEL_ID;
const RECRUITMENT_OFFICER_ROLE_ID = process.env.RECRUITMENT_OFFICER_ROLE_ID;
const APPLICANT_ROLE_ID = process.env.APPLICANT_ROLE_ID;
const ACCEPTED_ROLE_ID = process.env.ACCEPTED_ROLE_ID;

let nextApplicationNumber = Number(process.env.RECRUITMENT_START_NUMBER || 1);

const applications = new Map();
// userId -> application flow state while the applicant is answering DM questions.
const dmApplications = new Map();
// userId -> { appId, label } for officer follow-up requests after an application exists.
const pendingApplicantReplies = new Map();

function getNextAppId() {
  const appId = `APP-${String(nextApplicationNumber).padStart(4, '0')}`;
  nextApplicationNumber++;
  return appId;
}

function isRecruitmentOfficer(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  if (RECRUITMENT_OFFICER_ROLE_ID && interaction.member.roles?.cache?.has(RECRUITMENT_OFFICER_ROLE_ID)) {
    return true;
  }
  return interaction.member.permissions?.has('ManageGuild') || false;
}

function buildRecruitmentPanel() {
  const embed = new EmbedBuilder()
    .setDescription(
`Hello! Thank you for your interest in joining West Coast 🍁

Kindly click apply button below to proceed with your application.`
    )
    .setColor('Blue');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('recruitment_apply')
      .setLabel('Apply')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary)
  );

  return { embed, row };
}

function buildApplicationEmbed(app) {
  return new EmbedBuilder()
    .setTitle(`${app.appId} | ${app.ign}`)
    .setDescription(
`**Application ${app.appId}**

**Applicant**
<@${app.userId}>

**Main Character IGN**
${app.ign}

**Location**
${app.location}

**Most Active Playing Time**
${app.activeTime}

**Anti-Cheat Agreement**
${app.antiCheatAgreement}

**Play Style**
${app.playStyle}

**Status**
${app.status}

━━━━━━━━━━━━━━

**Decision History**
${app.history.length ? app.history.join('\n') : 'No actions yet.'}`
    )
    .setColor('Orange')
    .setTimestamp(app.createdAt);
}

function buildApplicationButtons(app) {
  const closed =
    app.status.includes('Closed') ||
    app.status.includes('Accepted') ||
    app.status.includes('Rejected');

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`app:request:${app.appId}`)
        .setLabel('Send DM')
        .setEmoji('💬')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(closed),

      new ButtonBuilder()
        .setCustomId(`app:accept:${app.appId}`)
        .setLabel('Accept')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(closed),

      new ButtonBuilder()
        .setCustomId(`app:reject:${app.appId}`)
        .setLabel('Reject')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(closed),

      new ButtonBuilder()
        .setCustomId(`app:close:${app.appId}`)
        .setLabel('Close')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function updateApplicationMessage(app) {
  try {
    const thread = await client.channels.fetch(app.threadId);
    const msg = await thread.messages.fetch(app.messageId);

    await msg.edit({
      embeds: [buildApplicationEmbed(app)],
      components: buildApplicationButtons(app)
    });
  } catch (err) {
    console.error('Failed to update application message:', err);
  }
}

async function closeApplicationThread(app, reason) {
  try {
    const thread = await client.channels.fetch(app.threadId);

    if (!thread || !thread.isThread()) {
      console.log('Thread not found or not a thread.');
      return;
    }

    await thread.send(`🔒 **Thread auto-closed:** ${reason}`);

    // Archive first
    await thread.setArchived(true, reason);

    // Then lock it
    await thread.setLocked(true, reason);

    console.log(`Application thread closed: ${app.appId}`);
  } catch (err) {
    console.error('Failed to auto-close application thread:', err);
  }
}

async function addRoleToMember(guild, userId, roleId) {
  if (!guild || !roleId) return;

  try {
    const member = await guild.members.fetch(userId);
    await member.roles.add(roleId);
  } catch (err) {
    console.error(`Failed to add role ${roleId} to ${userId}:`, err);
  }
}

async function removeRoleFromMember(guild, userId, roleId) {
  if (!guild || !roleId) return;

  try {
    const member = await guild.members.fetch(userId);
    await member.roles.remove(roleId);
  } catch (err) {
    console.error(`Failed to remove role ${roleId} from ${userId}:`, err);
  }
}

async function setupRecruitmentPanel() {
  if (!APPLICATION_CHANNEL_ID) {
    console.log('📝 APPLICATION_CHANNEL_ID is not set. Recruitment panel skipped.');
    return;
  }

  const channel = await client.channels.fetch(APPLICATION_CHANNEL_ID).catch(() => null);

  if (!channel) {
    console.log('📝 Recruitment application channel not found.');
    return;
  }

  const { embed, row } = buildRecruitmentPanel();
  const panelId = process.env.RECRUITMENT_PANEL_ID;

  if (panelId) {
    try {
      const oldPanel = await channel.messages.fetch(panelId);

      await oldPanel.edit({
        embeds: [embed],
        components: [row]
      });

      console.log('📝 Recruitment panel UPDATED');
      return;
    } catch (err) {
      console.log('📝 Recruitment panel ID not found, creating a new one.');
    }
  }

  const msg = await channel.send({
    embeds: [embed],
    components: [row]
  });

  console.log('SAVE THIS RECRUITMENT_PANEL_ID:', msg.id);
  await msg.pin().catch(() => {});
}


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
'Another "guys we got late game" enthusiast has arrived: {user}.',
"A wardless adventure is about to begin with {user}.",
"Another master of fighting without buyback has logged in: {user}.",
"The Ancient didn't deserve this, {user}.",
"A walking bounty rune has entered the queue: {user}.",
"The enemy carry just checked {user}'s profile and smiled.",
"The buyback button is already nervous about {user}.",
'How many "one last game" are we at now, {user}?',
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
'A future documentary titled "What Happened Mid?" starring {user} is in production.',
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
"A specialist in making impossible games winnable has arrived: {user}.",
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
    "Today's goal for {user}: hit at least one bullet.",
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
`Valorant opened. {user}'s "my bad" counter has been reset to zero.`,
"Welcome back, {user}. The wall you're about to spray appreciates your support.",
"{user}'s future teammates are currently winning their last game. Enjoy being the reason that streak ends.",
"The only thing more random than matchmaking is {user}'s spray pattern.",
"Valorant detected. Please remain calm. {user}'s teammates won't.",
"{user} just opened Valorant. The enemy team gained a fifth player somehow.",
"Welcome back, {user}! The practice bots said they miss farming you.",
'The enemy team just got a notification: "Easy RR available. {user} is online."',
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
'How many games until "one last game" becomes five, {user}?',
'Have you prepared your "jungle diff" speech, {user}?',
"Are we playing League or attending therapy today, {user}?",
"How many questionable decisions are scheduled today, {user}?",
"The enemy jungler just got a free leash thanks to {user}.",
"Another collector of shutdown gold has entered the Rift: {user}.",
"The enemy ADC appreciates {user}'s future donations.",
"The cannon minion has more job security than {user}'s Nexus.",
'Another future "where is my team?" has connected: {user}.',
"A future 4-man dive victim has connected: {user}.",
"The top laner is preparing to become a separate game from {user}.",
'The matchmaking system just muttered "good luck" after seeing {user}.',
"A future victim of a level 2 gank has connected: {user}.",
"A future side-lane disappearance is expected from {user}.",
"The Rift welcomes one of its stronger specimens: {user}.",
"A future carry has entered champion select: {user}.",
"The enemy team has received a difficulty increase. {user} has connected.",
"A future reason for victory has connected: {user}.",
"The next teamfight MVP has arrived: {user}.",
"A future legend has entered champion select: {user}.",
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

const parties = new Map();
const pendingPartyConfigs = new Map();

client.on('presenceUpdate', async (oldPresence, newPresence) => {
if (!ENABLE_GAME_FEED) return;
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

function buildPartyButtons(party) {
  const isFull = party?.full || false;

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('join_tank')
      .setLabel('Join as Tank')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isFull),

    new ButtonBuilder()
      .setCustomId('join_healer')
      .setLabel('Join as Healer')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isFull),

    new ButtonBuilder()
      .setCustomId('join_dps')
      .setLabel('Join as DPS')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isFull)
  );

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('leave_party')
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('party_full')
      .setLabel(isFull ? 'Reopen' : 'Full')
      .setStyle(isFull ? ButtonStyle.Success : ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId('party_delete')
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger)
  );

  return [buttons, controls];
}

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (!message.content.startsWith('-party_old ')) return;

  const title = message.content.slice(11).trim();

  if (!title) {
    return message.reply('Please provide a party title.');
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
`<t:${Math.floor(Date.now() / 1000)}:D>

Tank: —
Healer: —
DPS: —
DPS: —
DPS: —
DPS: —
DPS: —
DPS: —

0/8

Created by: ${message.author}`
    );

  const sent = await message.channel.send({
    embeds: [embed],
    components: buildPartyButtons({ full: false })
  });

 parties.set(sent.id, {
  creatorId: message.author.id,
  title,
  date: Math.floor(Date.now() / 1000),
  tank: null,
  healer: null,
  dps: [],
  full: false
});

});

function buildPartyEmbed(party) {
  const filled =
    (party.tank ? 1 : 0) +
    (party.healer ? 1 : 0) +
    party.dps.length;

  const dpsLines = [];
  for (let i = 0; i < 6; i++) {
    dpsLines.push(`DPS: ${party.dps[i] || '—'}`);
  }

  return new EmbedBuilder()
    .setTitle(party.full ? `${party.title} [FULL]` : party.title)
    .setDescription(
`<t:${party.date}:D>

Tank: ${party.tank || '—'}
Healer: ${party.healer || '—'}
${dpsLines.join('\n')}

${party.full ? 'FULL' : `${filled}/8`}

Created by: <@${party.creatorId}>`
    );
}


client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (!message.content.startsWith('-party ')) return;

  const title = message.content.slice(7).trim();

  if (!title) {
    return message.reply('Please provide a party title.');
  }

  pendingPartyConfigs.set(message.author.id, {
  creatorId: message.author.id,
  channelId: message.channel.id,
  title,
  size: null,
  roles: []
});

  const sizeMenu = new StringSelectMenuBuilder()
    .setCustomId('config_party_size')
    .setPlaceholder('Select Party Size')
    .addOptions(
      { label: '4-man', value: '4' },
      { label: '8-man', value: '8' }
    );

  const setupMessage = await message.reply({
  content: 'Select the party size:',
  components: [new ActionRowBuilder().addComponents(sizeMenu)]
});

setTimeout(() => {
  setupMessage.delete().catch(() => {});
}, 60000);

return;
});

const roleLabels = {
  tank: 'Tank',
  healer: 'Healer',
  mercenary: 'Mercenary',
  swordmaster: 'Sword Master',
  forceuser: 'Force User',
  ice: 'Ice Stacker',
  archer: 'Archer',
  dps: 'DPS',
  member: 'Member'
};

const customRoleClasses = {
  healer: ['Inquisitor', 'Physician', 'Saint'],
  mercenary: ['Barbarian', 'Destroyer'],
  swordmaster: ['Gladiator', 'Moonlord'],
  forceuser: ['Majesty', 'Smasher'],
  ice: ['Adept', 'Elestra'],
  archer: ['Artillery', 'Sniper', 'Tempest', 'Windwalker'],
  dps: ['Abyss Walker', 'Adept', 'Artillery', 'Barbarian', 'Blade Dancer', 'Crusader', 'Dark Avenger', 'Dark Summoner', 'Destroyer', 'Elestra', 'Gear Master', 'Gladiator', 'Guardian', 'Inquisitor', 'Light Fury', 'Majesty', 'Moonlord', 'Physician', 'Raven', 'Ripper', 'Saint', 'Saleana', 'Shooting Star', 'Smasher', 'Sniper', 'Soul Eater', 'Spirit Dancer', 'Tempest', 'Windwalker'],
  member: [
    'Abyss Walker',
    'Adept',
    'Artillery',
    'Barbarian',
    'Blade Dancer',
    'Crusader',
    'Dark Avenger',
    'Dark Summoner',
    'Destroyer',
    'Elestra',
    'Gear Master',
    'Gladiator',
    'Guardian',
    'Inquisitor',
    'Light Fury',
    'Majesty',
    'Moonlord',
    'Physician',
    'Raven',
    'Ripper',
    'Saint',
    'Saleana',
    'Shooting Star',
    'Smasher',
    'Sniper',
    'Soul Eater',
    'Spirit Dancer',
    'Tempest',
    'Windwalker'
  ]
};

function buildConfiguredParty(title, creatorId, size, selectedRoles) {
  const slots = [];

  for (const role of selectedRoles) {
    slots.push({
      role,
      label: roleLabels[role],
      user: null
    });
  }

  const remaining = size - slots.length;
  const fillerLabel = selectedRoles.length === 0 ? 'Member' : 'DPS';

  for (let i = 0; i < remaining; i++) {
    slots.push({
      role: selectedRoles.length === 0 ? 'member' : 'dps',
      label: fillerLabel,
      user: null
    });
  }

  return {
  creatorId,
  title,
  date: Math.floor(Date.now() / 1000),
  size,
  slots,
  full: false,
  threadCreated: false,
  threadId: null,
  type: 'custom'
};
}

function getPartyMembers(party) {
  return party.slots
    .filter(slot => slot.user)
    .map(slot => {
      const match = slot.user.match(/<@(\d+)>/);
      return match ? `<@${match[1]}>` : null;
    })
    .filter(Boolean);
}

function getThreadDate() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric'
  });
}

function buildConfiguredPartyEmbed(party) {
  const filled = party.slots.filter(slot => slot.user).length;

  const lines = party.slots.map(slot => {
    return `${slot.label}: ${slot.user || '—'}`;
  });

  return new EmbedBuilder()
    .setTitle(party.full ? `${party.title} [FULL]` : party.title)
    .setDescription(
`<t:${party.date}:D>

${lines.join('\n')}

${party.full ? 'FULL' : `${filled}/${party.size}`}

Created by: <@${party.creatorId}>`
    );
}

function buildConfiguredPartyButtons(party) {
  const isFull = party.full || false;

  const joinButtons = [];

  const uniqueRoles = [...new Set(party.slots.map(slot => slot.role))];

  for (const role of uniqueRoles) {
    const label = roleLabels[role] || (role === 'dps' ? 'DPS' : 'Member');

    joinButtons.push(
      new ButtonBuilder()
        .setCustomId(`custom_join_${role}`)
        .setLabel(`Join ${label}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isFull)
    );
  }

  const rows = [];

  for (let i = 0; i < joinButtons.length; i += 5) {
  rows.push(
    new ActionRowBuilder().addComponents(joinButtons.slice(i, i + 5))
  );
}

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('custom_leave')
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('custom_full')
      .setLabel(isFull ? 'Reopen' : 'Full')
      .setStyle(isFull ? ButtonStyle.Success : ButtonStyle.Danger),

new ButtonBuilder()
  .setCustomId('custom_thread')
  .setLabel('Create Thread')
  .setStyle(ButtonStyle.Primary)
  .setDisabled(!isFull || party.threadCreated),


    new ButtonBuilder()
      .setCustomId('custom_delete')
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger)
  );

  rows.push(controls);

  return rows;
}

client.on('interactionCreate', async interaction => {
  try {
   console.log("Interaction received:", interaction.customId);
  if (
  !interaction.isButton() &&
  !interaction.isStringSelectMenu() &&
  !interaction.isModalSubmit()
) return;


// ==============================
// Recruitment interaction handlers
// ==============================

if (interaction.isButton() && interaction.customId === 'recruitment_apply') {
  await interaction.deferReply({ ephemeral: true });

  dmApplications.set(interaction.user.id, {
    step: 'ign',
    userId: interaction.user.id,
    username: interaction.user.tag,
    guildId: interaction.guild.id,
    ign: null,
    location: null,
    activeTime: null,
    antiCheatAgreement: null,
    playStyle: null
  });

  await addRoleToMember(interaction.guild, interaction.user.id, APPLICANT_ROLE_ID);

  try {
    await interaction.user.send(
`🌊 **West Coast Application**

Let's start your application.

**Question 1/6**
Enter your **Main Character IGN**.`
    );

    return interaction.editReply({
      content: '📩 I sent you a DM with the application questions.'
    });
  } catch (err) {
    dmApplications.delete(interaction.user.id);

    return interaction.editReply({
      content: 'I could not DM you. Please enable DMs from server members, then click Apply again.'
    });
  }
}

if (interaction.isStringSelectMenu() && interaction.customId === 'dm_app_location') {
  const form = dmApplications.get(interaction.user.id);

  if (!form) {
    return interaction.reply({
      content: 'Your application session expired. Please click Apply again.',
      ephemeral: true
    });
  }

  form.location = interaction.values[0];
  form.step = 'activeTime';

  await interaction.update({
    content: `Location selected: **${form.location}**`,
    components: []
  });

  return interaction.user.send(
`**Question 3/6**
What's your most active playing time?

Example:
10am-6pm`
  );
}

if (interaction.isStringSelectMenu() && interaction.customId === 'dm_app_anticheat') {
  const form = dmApplications.get(interaction.user.id);

  if (!form) {
    return interaction.reply({
      content: 'Your application session expired. Please click Apply again.',
      ephemeral: true
    });
  }

  form.antiCheatAgreement = interaction.values[0];

  await interaction.update({
    content: `Anti-cheat agreement selected: **${form.antiCheatAgreement}**`,
    components: []
  });

  if (form.antiCheatAgreement === 'No') {
    dmApplications.delete(interaction.user.id);

    return interaction.user.send(
`Your application has been stopped.

West Coast does not tolerate modders or cheaters. You must agree not to use such mods before applying.`
    );
  }

  form.step = 'playStyle';

  const playStyleMenu = new StringSelectMenuBuilder()
    .setCustomId('dm_app_playstyle')
    .setPlaceholder('Casual or Competitive?')
    .addOptions(
      { label: 'Casual', value: 'Casual' },
      { label: 'Competitive', value: 'Competitive' }
    );

  return interaction.user.send({
    content: '**Question 5/6**\nWould you describe yourself as casual or competitive? No wrong answer.',
    components: [new ActionRowBuilder().addComponents(playStyleMenu)]
  });
}

if (interaction.isStringSelectMenu() && interaction.customId === 'dm_app_playstyle') {
  const form = dmApplications.get(interaction.user.id);

  if (!form) {
    return interaction.reply({
      content: 'Your application session expired. Please click Apply again.',
      ephemeral: true
    });
  }

  form.playStyle = interaction.values[0];
  form.step = 'statsGear';

  await interaction.update({
    content: `Play style selected: **${form.playStyle}**`,
    components: []
  });

  return interaction.user.send(
`**Question 6/6**
Please post an image of your **stats and gears**.`
  );
}

if (interaction.isButton() && interaction.customId.startsWith('app:')) {
  if (!isRecruitmentOfficer(interaction)) {
    return interaction.reply({
      content: 'Only recruitment officers can use this button.',
      ephemeral: true
    });
  }

  const [, action, appId] = interaction.customId.split(':');
  const app = applications.get(appId);

  if (!app) {
    return interaction.reply({
      content: 'Application data was not found. The bot may have restarted.',
      ephemeral: true
    });
  }

if (action === 'request') {
  const modal = new ModalBuilder()
    .setCustomId(`app:requestModal:${app.appId}`)
    .setTitle(`Send DM - ${app.appId}`);

  const requestInput = new TextInputBuilder()
    .setCustomId('request_text')
    .setLabel('Message to send to applicant')
    .setPlaceholder('Example: Please send your Dragon Jade screenshot.')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(requestInput));
  return interaction.showModal(modal);
}

 if (action === 'accept') {
  app.status = '🟢 Accepted';
  app.history.push(`✅ Accepted by <@${interaction.user.id}>`);
  await updateApplicationMessage(app);

  await interaction.reply({
    content: 'Application accepted.',
    ephemeral: true
  });

  await client.users.fetch(app.userId)
  .then(user => user.send(
`✅ **Application Accepted!**

Welcome to **West Coast** 🍁

Feel free to join conversations, raids, and guild activities.`
  ))
  .catch(() => interaction.followUp({
    content: 'Could not DM the applicant.',
    ephemeral: true
  }));

const guild = client.guilds.cache.get(app.guildId) || await client.guilds.fetch(app.guildId);

await addRoleToMember(guild, app.userId, ACCEPTED_ROLE_ID);
await removeRoleFromMember(guild, app.userId, APPLICANT_ROLE_ID);

await closeApplicationThread(app, 'Application accepted');
return;
}

 if (action === 'reject') {
  app.status = '🔴 Rejected';
  app.history.push(`❌ Rejected by <@${interaction.user.id}>`);
  await updateApplicationMessage(app);

  await interaction.reply({
    content: 'Application rejected.',
    ephemeral: true
  });

  await client.users.fetch(app.userId)
  .then(user => user.send(
`❌ **Application Rejected**

Thank you for applying to **West Coast**.

Unfortunately, your application was not accepted at this time.`
  ))
  .catch(() => interaction.followUp({
    content: 'Could not DM the applicant.',
    ephemeral: true
  }));

const guild = await client.guilds.fetch(app.guildId);
await removeRoleFromMember(guild, app.userId, APPLICANT_ROLE_ID);

await closeApplicationThread(app, 'Application rejected');
return;
}

  if (action === 'close') {
    app.status = '⚫ Closed';
    app.history.push(`🔒 Closed by <@${interaction.user.id}>`);
    await updateApplicationMessage(app);

    const thread = await client.channels.fetch(app.threadId);
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});

    return interaction.reply({
      content: 'Application thread closed.',
      ephemeral: true
    });
  }
}

if (interaction.isModalSubmit() && interaction.customId.startsWith('app:requestModal:')) {
  if (!isRecruitmentOfficer(interaction)) {
    return interaction.reply({
      content: 'Only recruitment officers can send DMs.',
      ephemeral: true
    });
  }

  const appId = interaction.customId.split(':')[2];
  const app = applications.get(appId);

  if (!app) {
    return interaction.reply({
      content: 'Application data was not found. The bot may have restarted.',
      ephemeral: true
    });
  }

  const requestText = interaction.fields.getTextInputValue('request_text');

  app.status = '🔵 Waiting for Applicant Reply';
  app.history.push(`📩 DM sent by <@${interaction.user.id}>: ${requestText}`);
  await updateApplicationMessage(app);

  pendingApplicantReplies.set(app.userId, {
    appId: app.appId,
    label: requestText
  });

  const thread = await client.channels.fetch(app.threadId);

  await thread.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('📩 DM Sent to Applicant')
        .setDescription(
`**Officer**
<@${interaction.user.id}>

**Applicant**
<@${app.userId}>

**Message**
${requestText}`
        )
        .setColor('Blue')
        .setTimestamp()
    ]
  });

  try {
    const user = await client.users.fetch(app.userId);

    await user.send(
`📩 **Message from West Coast Officers**

${requestText}

You may reply here. Your response will be forwarded to the recruitment thread.`
    );
  } catch (err) {
    await thread.send(`⚠️ Could not DM <@${app.userId}>. They may have DMs disabled.`);

    return interaction.reply({
      content: 'I logged the message, but I could not DM the applicant.',
      ephemeral: true
    });
  }

  return interaction.reply({
    content: 'DM sent to applicant and logged in this thread.',
    ephemeral: true
  });
}


if (interaction.isButton()) {
  if (interaction.customId === 'open_suggestion_modal') {

    const modal = new ModalBuilder()
      .setCustomId('suggestion_modal')
      .setTitle('Guild Suggestion');

    const input = new TextInputBuilder()
      .setCustomId('suggestion_input')
      .setLabel('Your suggestion')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);

    return interaction.showModal(modal);
  }
}

if (interaction.isModalSubmit()) {
  if (interaction.customId === 'suggestion_modal') {

    const suggestion = interaction.fields.getTextInputValue('suggestion_input');

    const channel = await client.channels.fetch(process.env.SUGGESTION_CHANNEL_ID);

    const id = Math.floor(10000 + Math.random() * 90000);

    const embed = new EmbedBuilder()
      .setTitle(`📮 Guild Suggestion #${id}`)
      .setDescription(suggestion)
      .setColor("Green")
      .setFooter({ text: "Anonymous submission" });

    const msg = await channel.send({ embeds: [embed] });

    await msg.react("👍");
    await msg.react("👎");

    return interaction.reply({
      content: "✅ Suggestion submitted anonymously!",
      ephemeral: true
    });
  }
}


  if (interaction.isStringSelectMenu()) {


if (interaction.customId === 'config_party_size') {
  const config = pendingPartyConfigs.get(interaction.user.id);
if (!config) {
  return interaction.reply({
    content: 'Configuration expired.',
    ephemeral: true
  });
}

if (interaction.user.id !== config.creatorId) {
  return interaction.reply({
    content: 'Only the party creator can configure this.',
    ephemeral: true
  });
}

  config.size = interaction.values[0];

  const roleMenu = new StringSelectMenuBuilder()
    .setCustomId('config_required_roles')
    .setPlaceholder('Select required roles')
    .setMinValues(1)
    .setMaxValues(Math.min(Number(config.size), 7))
    .addOptions(
      { label: 'Tank', value: 'tank' },
{ label: 'Healer', value: 'healer' },
{ label: 'Mercenary', value: 'mercenary' },
{ label: 'Sword Master', value: 'swordmaster' },
{ label: 'Force User', value: 'forceuser' },
{ label: 'Ice Stacker', value: 'ice' },
{ label: 'Archer', value: 'archer' }
    );

  const skipButton = new ButtonBuilder()
  .setCustomId('config_skip_roles')
  .setLabel('Skip')
  .setStyle(ButtonStyle.Success);

  return interaction.update({
    content:
`Party Size: ${config.size}-man

Select the required roles, or click Skip if no special roles are needed.`,
    components: [
      new ActionRowBuilder().addComponents(roleMenu),
      new ActionRowBuilder().addComponents(skipButton)
    ]
  });
}

if (interaction.customId === 'config_required_roles') {
  const config = pendingPartyConfigs.get(interaction.user.id);

  if (!config || interaction.user.id !== config.creatorId) {
    return interaction.reply({
      content: 'Only the party creator can configure this.',
      ephemeral: true
    });
  }

  const selectedRoles = interaction.values;
  const size = Number(config.size);

  if (selectedRoles.length > size) {
    return interaction.reply({
      content: `A ${size}-man party can only have up to ${size} required roles.`,
      ephemeral: true
    });
  }

  const party = buildConfiguredParty(
    config.title,
    config.creatorId,
    size,
    selectedRoles
  );

  const channel = await client.channels.fetch(config.channelId);

  const sent = await channel.send({
    embeds: [buildConfiguredPartyEmbed(party)],
    components: buildConfiguredPartyButtons(party)
  });

  parties.set(sent.id, party);
  pendingPartyConfigs.delete(interaction.user.id);

  return interaction.update({
    content: 'Party created successfully.',
    components: []
  });
}

if (interaction.customId.startsWith('custom_select_tank_')) {
  const messageId = interaction.customId.replace('custom_select_tank_', '');
  const party = parties.get(messageId);

  if (!party) {
    return interaction.update({
      content: 'Party not found.',
      components: []
    });
  }

  const userEntry = `<@${interaction.user.id}> (${interaction.values[0]})`;

  const tankSlot = party.slots.find(slot => slot.role === 'tank');

  if (!tankSlot) {
    return interaction.update({
      content: 'Tank slot not found.',
      components: []
    });
  }

  if (tankSlot.user) {
    return interaction.update({
      content: 'Tank slot is already filled.',
      components: []
    });
  }

  for (const slot of party.slots) {
    if (slot.user && slot.user.includes(interaction.user.id)) {
      slot.user = null;
    }
  }

  tankSlot.user = userEntry;

  const originalMessage = await interaction.channel.messages.fetch(messageId);

  await originalMessage.edit({
    embeds: [buildConfiguredPartyEmbed(party)],
    components: buildConfiguredPartyButtons(party)
  });

  return interaction.update({
    content: `You joined as Tank (${interaction.values[0]}).`,
    components: []
  });
}

if (interaction.customId.startsWith('custom_select_')) {
  const parts = interaction.customId.split('_');
  const role = parts[2];
  const messageId = parts.slice(3).join('_');

  const party = parties.get(messageId);

  if (!party) {
    return interaction.update({
      content: 'Party not found.',
      components: []
    });
  }

  const slot = party.slots.find(slot => slot.role === role && !slot.user);

  if (!slot) {
    return interaction.update({
      content: `${roleLabels[role] || 'Slot'} is already filled.`,
      components: []
    });
  }

  for (const slot of party.slots) {
    if (slot.user && slot.user.includes(interaction.user.id)) {
      slot.user = null;
    }
  }

  slot.user = `<@${interaction.user.id}> (${interaction.values[0]})`;

  const originalMessage = await interaction.channel.messages.fetch(messageId);

  await originalMessage.edit({
    embeds: [buildConfiguredPartyEmbed(party)],
    components: buildConfiguredPartyButtons(party)
  });

  return interaction.update({
    content: `You joined as ${roleLabels[role]} (${interaction.values[0]}).`,
    components: []
  });
}

if (interaction.customId.startsWith('custom_thread_channel_')) {
  const messageId = interaction.customId.replace('custom_thread_channel_', '');
  const party = parties.get(messageId);

  if (!party) {
    return interaction.update({
      content: 'Party not found.',
      components: []
    });
  }

  if (interaction.user.id !== party.creatorId) {
    return interaction.update({
      content: 'Only the party creator can create this thread.',
      components: []
    });
  }

  if (party.threadCreated) {
    return interaction.update({
      content: 'A thread has already been created for this party.',
      components: []
    });
  }

  const channelId = interaction.values[0];
  const selectedChannel = await client.channels.fetch(channelId);

  const threadName = `${party.title} - ${getThreadDate()}`.slice(0, 100);
  const members = getPartyMembers(party);

  const threadStarter = await selectedChannel.send({
    content:
`✅ **${party.title}**

${members.join(' ')}

Thread for this run.`
  });

  const thread = await threadStarter.startThread({
    name: threadName,
    autoArchiveDuration: 1440
  });

  party.threadCreated = true;
  party.threadId = thread.id;

  const originalMessage = await interaction.channel.messages.fetch(messageId);

  await originalMessage.edit({
    embeds: [buildConfiguredPartyEmbed(party)],
    components: buildConfiguredPartyButtons(party)
  });

  await thread.send(
`${members.join(' ')}

Please coordinate here.`
  );

  return interaction.update({
    content: `Thread created in <#${selectedChannel.id}>: ${thread.url}`,
    components: []
  });
}

}

if (
  interaction.isStringSelectMenu() &&
  (
    interaction.customId.startsWith('select_tank_') ||
    interaction.customId.startsWith('select_healer_') ||
    interaction.customId.startsWith('select_dps_')
  )
) {
    const parts = interaction.customId.split('_');
    const role = parts[1];
    const messageId = parts[2];

    const party = parties.get(messageId);
    if (!party) return interaction.update({ content: 'Party not found.', components: [] });

    if (party.full) {
      return interaction.update({
        content: 'This party is already marked as full.',
        components: []
      });
    }

    const selectedClass = interaction.values[0];
    const userId = interaction.user.id;
    const userEntry = `<@${userId}> (${selectedClass})`;

    if (party.tank && party.tank.includes(userId)) party.tank = null;
    if (party.healer && party.healer.includes(userId)) party.healer = null;
    party.dps = party.dps.filter(player => !player.includes(userId));

    if (role === 'tank') {
      if (party.tank) {
        return interaction.update({
          content: 'Tank slot is already filled. Please join as DPS instead if you still want to join.',
          components: []
        });
      }
      party.tank = userEntry;
    }

    if (role === 'healer') {
      if (party.healer) {
        return interaction.update({
          content: 'Healer slot is already filled. Please join as DPS instead if you still want to join.',
          components: []
        });
      }
      party.healer = userEntry;
    }

    if (role === 'dps') {
      if (party.dps.length >= 6) {
        return interaction.update({
          content: 'DPS slots are already full.',
          components: []
        });
      }
      party.dps.push(userEntry);
    }

    const originalMessage = await interaction.channel.messages.fetch(messageId);

    await originalMessage.edit({
      embeds: [buildPartyEmbed(party)]
    });

    return interaction.update({
      content: `You joined as ${role.toUpperCase()} (${selectedClass}).`,
      components: []
    });
  }

if (interaction.customId === 'config_skip_roles') {
  const config = pendingPartyConfigs.get(interaction.user.id);

  if (!config) {
    return interaction.reply({
      content: 'Configuration expired.',
      ephemeral: true
    });
  }

  if (interaction.user.id !== config.creatorId) {
    return interaction.reply({
      content: 'Only the party creator can configure this.',
      ephemeral: true
    });
  }

  const party = buildConfiguredParty(
    config.title,
    config.creatorId,
    Number(config.size),
    []
  );

  const channel = await client.channels.fetch(config.channelId);

  const sent = await channel.send({
    embeds: [buildConfiguredPartyEmbed(party)],
    components: buildConfiguredPartyButtons(party)
  });

  parties.set(sent.id, party);
  pendingPartyConfigs.delete(interaction.user.id);

  return interaction.update({
    content: 'Party created successfully.',
    components: []
  });
}

// These two handlers operate on the *ephemeral* class-select reply message
// (not the original party embed), so they must run before the party lookup
// below — interaction.message.id here would be the ephemeral message's id,
// which is never stored in the `parties` map.
if (interaction.customId.startsWith("custom_page_")) {

    const parts = interaction.customId.split("_");

    const role = parts[2];
    const messageId = parts[3];
    const page = Number(parts[4]);

    const classes = customRoleClasses[role];

    const pageSize = 25;
    const totalPages = Math.ceil(classes.length / pageSize);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`custom_select_${role}_${messageId}`)
        .setPlaceholder(`Select your ${roleLabels[role]} class (${page + 1}/${totalPages})`)
        .addOptions(
            classes
                .slice(page * pageSize, (page + 1) * pageSize)
                .map(c => ({
                    label: c,
                    value: c
                }))
        );

    const buttons = [];

    if (page > 0) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`custom_page_${role}_${messageId}_${page - 1}`)
                .setLabel("◀ Previous")
                .setStyle(ButtonStyle.Secondary)
        );
    }

    if (page < totalPages - 1) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`custom_page_${role}_${messageId}_${page + 1}`)
                .setLabel("Next ▶")
                .setStyle(ButtonStyle.Primary)
        );
    }

    const rows = [
        new ActionRowBuilder().addComponents(menu)
    ];

    if (buttons.length) {
        rows.push(
            new ActionRowBuilder().addComponents(buttons)
        );
    }

    return interaction.update({
        components: rows
    });
}

if (interaction.customId.startsWith('join_dps_page2_')) {

    const messageId = interaction.customId.replace('join_dps_page2_', '');

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`select_dps_${messageId}`)
        .setPlaceholder('Select your DPS class (2/2)')
        .addOptions(
            { label: 'Soul Eater', value: 'Soul Eater' },
            { label: 'Spirit Dancer', value: 'Spirit Dancer' },
            { label: 'Tempest', value: 'Tempest' },
            { label: 'Windwalker', value: 'Windwalker' }
        );

    return interaction.update({
        components: [
            new ActionRowBuilder().addComponents(menu)
        ]
    });
}

  const party = parties.get(interaction.message.id);
if (!party) {
  return interaction.reply({
    content: 'This party is no longer active. Please create a new one.',
    ephemeral: true
  });
}

if (interaction.customId.startsWith('custom_join_')) {
  const role = interaction.customId.replace('custom_join_', '');

  if (role === 'tank') {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`custom_select_tank_${interaction.message.id}`)
    .setPlaceholder('Select your Tank class')
    .addOptions(
      { label: 'Crusader', value: 'Crusader' },
      { label: 'Destroyer', value: 'Destroyer' },
      { label: 'Guardian', value: 'Guardian' }
    );

  return interaction.reply({
    content: 'Select your Tank class:',
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true
  });
}

  const classes = customRoleClasses[role];

  if (!classes) {
  return interaction.reply({
    content: 'Role not configured yet.',
    ephemeral: true
  });
}

const page = 0;
const pageSize = 25;

const menu = new StringSelectMenuBuilder()
  .setCustomId(`custom_select_${role}_${interaction.message.id}`)
  .setPlaceholder(`Select your ${roleLabels[role]} class (${page + 1}/${Math.ceil(classes.length / pageSize)})`)
  .addOptions(
    classes.slice(0, pageSize).map(className => ({
      label: className,
      value: className
    }))
  );

const components = [
  new ActionRowBuilder().addComponents(menu)
];

if (classes.length > pageSize) {
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`custom_page_${role}_${interaction.message.id}_1`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Primary)
    )
  );
}

return interaction.reply({
  content: `Select your ${roleLabels[role]} class:`,
  components,
  ephemeral: true
});
}

if (interaction.customId === 'custom_leave') {
  await interaction.deferReply({ ephemeral: true });

  for (const slot of party.slots) {
    if (slot.user && slot.user.includes(interaction.user.id)) {
      slot.user = null;
    }
  }

  await interaction.message.edit({
    embeds: [buildConfiguredPartyEmbed(party)],
    components: buildConfiguredPartyButtons(party)
  });

  return interaction.editReply('You left the party.');
}

if (interaction.customId === 'custom_full') {
  if (interaction.user.id !== party.creatorId) {
    return interaction.reply({
      content: 'Only the party creator can mark or reopen this party.',
      ephemeral: true
    });
  }

party.full = !party.full;

await interaction.message.edit({
  embeds: [buildConfiguredPartyEmbed(party)],
  components: buildConfiguredPartyButtons(party)
});

if (party.full) {
  const members = party.slots
    .filter(slot => slot.user)
    .map(slot => {
      const match = slot.user.match(/<@(\d+)>/);
      return match ? `<@${match[1]}>` : null;
    })
    .filter(Boolean);

  if (members.length) {
    await interaction.channel.send(
      `✅ **${party.title} is now FULL!**\n${members.join(' ')}`
    );
  }
}

return interaction.reply({
  content: party.full ? 'Party marked as full.' : 'Party reopened.',
  ephemeral: true
});
}

if (interaction.customId === 'custom_thread') {
  if (interaction.user.id !== party.creatorId) {
    return interaction.reply({
      content: 'Only the party creator can create a thread.',
      ephemeral: true
    });
  }

  if (!party.full) {
    return interaction.reply({
      content: 'Please mark the party as full first.',
      ephemeral: true
    });
  }

  if (party.threadCreated) {
    return interaction.reply({
      content: 'A thread has already been created for this party.',
      ephemeral: true
    });
  }

  const channels = interaction.guild.channels.cache
    .filter(channel =>
  channel.parentId === LOOT_CATEGORY_ID &&
  channel.isTextBased()
)
    .map(channel => ({
      label: channel.name,
      value: channel.id
    }))
    .slice(0, 25);

  if (!channels.length) {
    return interaction.reply({
      content: 'No text channels found under the Loot Distribution category.',
      ephemeral: true
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`custom_thread_channel_${interaction.message.id}`)
    .setPlaceholder('Select Loot Distribution Channel')
    .addOptions(channels);

  return interaction.reply({
    content: 'Select where to create the thread:',
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true
  });
}

if (interaction.customId === 'custom_delete') {
  if (interaction.user.id !== party.creatorId) {
    return interaction.reply({
      content: 'Only the party creator can delete this party.',
      ephemeral: true
    });
  }

  parties.delete(interaction.message.id);

  await interaction.reply({
    content: 'Party deleted.',
    ephemeral: true
  });

  return interaction.message.delete();
}

  if (interaction.customId === 'join_tank') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`select_tank_${interaction.message.id}`)
      .setPlaceholder('Select your Tank class')
      .addOptions(
        { label: 'Crusader', value: 'Crusader' },
        { label: 'Destroyer', value: 'Destroyer' },
        { label: 'Guardian', value: 'Guardian' }
      );

    return interaction.reply({
      content: 'Select your Tank class:',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.customId === 'join_healer') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`select_healer_${interaction.message.id}`)
      .setPlaceholder('Select your Healer class')
      .addOptions(
        { label: 'Inquisitor', value: 'Inquisitor' },
        { label: 'Physician', value: 'Physician' },
        { label: 'Saint', value: 'Saint' }
      );

    return interaction.reply({
      content: 'Select your Healer class:',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

if (interaction.customId === 'join_dps') {

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`select_dps_${interaction.message.id}`)
        .setPlaceholder('Select your DPS class (1/2)')
        .addOptions(
            { label: 'Abyss Walker', value: 'Abyss Walker' },
            { label: 'Adept', value: 'Adept' },
            { label: 'Artillery', value: 'Artillery' },
            { label: 'Barbarian', value: 'Barbarian' },
            { label: 'Blade Dancer', value: 'Blade Dancer' },
            { label: 'Crusader', value: 'Crusader' },
            { label: 'Dark Avenger', value: 'Dark Avenger' },
            { label: 'Dark Summoner', value: 'Dark Summoner' },
            { label: 'Destroyer', value: 'Destroyer' },
            { label: 'Elestra', value: 'Elestra' },
            { label: 'Gear Master', value: 'Gear Master' },
            { label: 'Gladiator', value: 'Gladiator' },
            { label: 'Guardian', value: 'Guardian' },
            { label: 'Inquisitor', value: 'Inquisitor' },
            { label: 'Light Fury', value: 'Light Fury' },
            { label: 'Majesty', value: 'Majesty' },
            { label: 'Moonlord', value: 'Moonlord' },
            { label: 'Physician', value: 'Physician' },
            { label: 'Raven', value: 'Raven' },
            { label: 'Ripper', value: 'Ripper' },
            { label: 'Saint', value: 'Saint' },
            { label: 'Saleana', value: 'Saleana' },
            { label: 'Shooting Star', value: 'Shooting Star' },
            { label: 'Smasher', value: 'Smasher' },
            { label: 'Sniper', value: 'Sniper' }
        );

    const nextButton = new ButtonBuilder()
        .setCustomId(`join_dps_page2_${interaction.message.id}`)
        .setLabel('More Classes ▶')
        .setStyle(ButtonStyle.Primary);

    return interaction.reply({
        ephemeral: true,
        components: [
            new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(nextButton)
        ]
    });
}
if (interaction.customId === 'leave_party') {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;

  if (party.tank && party.tank.includes(userId)) party.tank = null;
  if (party.healer && party.healer.includes(userId)) party.healer = null;
  party.dps = party.dps.filter(player => !player.includes(userId));

  await interaction.message.edit({
    embeds: [buildPartyEmbed(party)]
  });

  return interaction.editReply('You left the party.');
}

  if (interaction.customId === 'party_full') {
  if (interaction.user.id !== party.creatorId) {
    return interaction.reply({
      content: 'Only the party creator can mark or reopen this party.',
      ephemeral: true
    });
  }

  party.full = !party.full;

  await interaction.message.edit({
    embeds: [buildPartyEmbed(party)],
    components: buildPartyButtons(party)
  });

  return interaction.reply({
    content: party.full ? 'Party marked as full.' : 'Party reopened.',
    ephemeral: true
  });
}

if (interaction.customId === 'party_delete') {
  if (interaction.user.id !== party.creatorId) {
    return interaction.reply({
      content: 'Only the party creator can delete this party.',
      ephemeral: true
    });
  }

  parties.delete(interaction.message.id);

  await interaction.reply({
    content: 'Party deleted.',
    ephemeral: true
  });

  await interaction.message.delete();
}

  } catch (err) {
    console.error('❌ Error in interactionCreate:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '⚠️ Something went wrong. Please try again.' });
      } else {
        await interaction.reply({ content: '⚠️ Something went wrong. Please try again.', ephemeral: true });
      }
    } catch (_) { /* ignore secondary errors */ }
  }
});


// ==============================
// Recruitment DM message handler
// Handles text answers and screenshots sent by applicants in DM.
// ==============================
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.guild) return; // DM only

  const form = dmApplications.get(message.author.id);

  if (form) {
    if (form.step === 'ign') {
      form.ign = message.content.trim();

      if (!form.ign) {
        return message.reply('Please enter a valid Main Character IGN.');
      }

      form.step = 'location';

      const locationMenu = new StringSelectMenuBuilder()
        .setCustomId('dm_app_location')
        .setPlaceholder('Where are you located?')
        .addOptions(
          { label: 'USA', value: 'USA' },
          { label: 'Philippines', value: 'Philippines' },
          { label: 'Singapore', value: 'Singapore' },
          { label: 'Malaysia', value: 'Malaysia' },
          { label: 'Indonesia', value: 'Indonesia' },
          { label: 'Others', value: 'Others' }
        );

      return message.reply({
        content: '**Question 2/6**\nWhere are you located?',
        components: [new ActionRowBuilder().addComponents(locationMenu)]
      });
    }

    if (form.step === 'activeTime') {
      form.activeTime = message.content.trim();

      if (!form.activeTime) {
        return message.reply('Please enter your most active playing time. Example: 10am-6pm');
      }

      form.step = 'antiCheat';

      const antiCheatMenu = new StringSelectMenuBuilder()
        .setCustomId('dm_app_anticheat')
        .setPlaceholder('Do you agree not to use mods/cheats?')
        .addOptions(
          { label: 'Yes', value: 'Yes' },
          { label: 'No', value: 'No' }
        );

      return message.reply({
        content: "**Question 4/6**\nWe don't tolerate modders/cheaters. Do you agree not to use such mods?",
        components: [new ActionRowBuilder().addComponents(antiCheatMenu)]
      });
    }

    if (form.step === 'statsGear') {
      if (!message.attachments.size) {
        return message.reply('Please upload an image of your stats and gears as an attachment.');
      }

      const attachmentLinks = [...message.attachments.values()]
        .map(file => file.url)
        .join('\n');

      const appId = getNextAppId();

    const app = {
  appId,
  userId: form.userId,
  username: form.username,
  guildId: form.guildId,
  ign: form.ign,
  location: form.location,
  activeTime: form.activeTime,
  antiCheatAgreement: form.antiCheatAgreement,
  playStyle: form.playStyle,
  status: '🟠 Under Review',
  threadId: null,
  messageId: null,
  history: [
    `Submitted by <@${form.userId}> via DM application`,
    '📸 Stats and gears screenshot received from applicant'
  ],
  createdAt: new Date()
};

      const tracker = await client.channels.fetch(RECRUITMENT_TRACKER_CHANNEL_ID).catch(() => null);

      if (!tracker) {
        return message.reply('I could not find the recruitment tracker channel. Please contact an officer.');
      }

      const thread = await tracker.threads.create({
        name: `${app.appId} | ${app.ign}`.slice(0, 100),
        autoArchiveDuration: 1440,
        reason: `New completed application from ${form.username}`
      });

      app.threadId = thread.id;

      const appMessage = await thread.send({
  content: `<@&${RECRUITMENT_OFFICER_ROLE_ID}> New guild application submitted.`,
  embeds: [buildApplicationEmbed(app)],
  components: buildApplicationButtons(app),
  allowedMentions: {
    roles: [RECRUITMENT_OFFICER_ROLE_ID]
  }
});

      app.messageId = appMessage.id;
      applications.set(app.appId, app);

      await thread.send(
`📸 **Stats and Gears Screenshot from <@${message.author.id}>**

${attachmentLinks}`
      );

      dmApplications.delete(message.author.id);

      return message.reply(
`✅ Your application has been submitted as **${app.appId}**.

Your stats and gears screenshot was received. Officers will review your application.`
      );
    }

    return;
  }

  const pending = pendingApplicantReplies.get(message.author.id);

  if (pending) {
    const app = applications.get(pending.appId);

    if (!app) {
      pendingApplicantReplies.delete(message.author.id);
      return message.reply('Sorry, I could not find your application. Please contact an officer.');
    }

    const thread = await client.channels.fetch(app.threadId).catch(() => null);

    if (!thread) {
      return message.reply('Sorry, I could not find your application thread. Please contact an officer.');
    }

    const attachmentLinks = message.attachments.size
      ? [...message.attachments.values()].map(file => file.url).join('\n')
      : 'No attachment provided.';

    const textReply = message.content?.trim()
      ? `\n**Message:**\n${message.content.trim()}`
      : '';

    await thread.send(
`💬 **Applicant response from <@${message.author.id}>**

**Request**
${pending.label}
${textReply}

**Attachments**
${attachmentLinks}`
    );

    app.status = '🟠 Under Review';
    app.history.push(`💬 Applicant responded to request: ${pending.label}`);
    await updateApplicationMessage(app);

    pendingApplicantReplies.delete(message.author.id);

    return message.reply('Response received. Officers will review it.');
  }

  return message.reply('I do not have an active application request for you right now. Please click Apply in the server.');
});


client.once('ready', async () => {
  console.log(`${client.user.tag} is online!`);

  // Suggestion panel
  try {
    const channel = await client.channels.fetch(process.env.SUGGESTION_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setTitle("📮 Guild Suggestion Box")
      .setDescription("Click the button below to submit a suggestion anonymously.")
      .setColor("Blue");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_suggestion_modal")
        .setLabel("Send Suggestion")
        .setEmoji("📮")
        .setStyle(ButtonStyle.Primary)
    );

    const PANEL_ID = process.env.SUGGESTION_PANEL_ID;
    let msg = null;

    if (PANEL_ID) {
      try {
        msg = await channel.messages.fetch(PANEL_ID);

        await msg.edit({
          embeds: [embed],
          components: [row]
        });

        console.log("📮 Suggestion panel UPDATED (always visible)");
      } catch (err) {
        console.log("📮 No suggestion panel found → creating new one");
      }
    }

    if (!msg) {
      msg = await channel.send({
        embeds: [embed],
        components: [row]
      });

      console.log("SAVE THIS SUGGESTION_PANEL_ID:", msg.id);
    }

    if (!msg.pinned) {
      await msg.pin().catch(() => {});
    }
  } catch (err) {
    console.error('Suggestion panel setup failed:', err);
  }

  // Recruitment panel
  try {
    await setupRecruitmentPanel();
  } catch (err) {
    console.error('Recruitment panel setup failed:', err);
  }
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




client.once('ready', () => {
  console.log(`✅ West Coast bot is online as ${client.user.tag}`);
});

console.log('🚀 About to login to Discord...');

const loginPromise = client.login(process.env.DISCORD_TOKEN);

loginPromise
  .then(() => {
    console.log('🔑 Discord login successful');
  })
  .catch((error) => {
    console.error('❌ Discord login failed:', error);
  });

setTimeout(() => {
  console.log('⏰ 30 seconds passed — Discord login still has not completed.');
}, 30000);