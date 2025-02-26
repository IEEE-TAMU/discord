import { Client, Events, GatewayIntentBits } from 'discord.js';
import GroupMeBot from './groupme';

const groupmeBot = GroupMeBot;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || (function() {
	throw new Error('The DISCORD_TOKEN environment variable is required.');
})();
const MONITOR_CHANNEL_ID = process.env.MONITOR_CHANNEL_ID || (function() {
	throw new Error('The MONITOR_CHANNEL_ID environment variable is required.');
})();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async msg => {
	if (msg.author.bot) return;
	if (msg.channelId !== MONITOR_CHANNEL_ID) return;
	if (msg.content === '' && msg.attachments.size === 0) return;
	const message = msg.content;
	const attatchment = msg.attachments.first();
	const image_url = attatchment ? attatchment.url : undefined;
	await groupmeBot.postMessage(message, image_url);
});

client.login(DISCORD_TOKEN);