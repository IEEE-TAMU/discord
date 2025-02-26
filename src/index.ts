import { Client, Events, GatewayIntentBits } from 'discord.js';
import GroupMeBot from './groupme';
import config from './config.json';

const groupmeBot = GroupMeBot;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || (function () {
	throw new Error('The DISCORD_TOKEN environment variable is required.');
})();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	]
});

client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async msg => {
	if (msg.author.bot) return;
	if (msg.channelId !== config['bot-test-channel'].id) return;
	if (msg.content !== '') {
		await groupmeBot.send(msg.content);
	}
});

client.login(DISCORD_TOKEN);