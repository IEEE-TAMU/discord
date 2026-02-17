import { Client, Events, GatewayIntentBits } from 'discord.js';
import GroupMeBot from './groupme';
import { createApiServer } from './api';
import { startCalendarSync } from './calendarSync';

const groupmeBot = GroupMeBot;

const DISCORD_TOKEN =
	process.env.DISCORD_TOKEN ||
	(function() {
		throw new Error('The DISCORD_TOKEN environment variable is required.');
	})();
const MONITOR_CHANNEL_ID =
	process.env.MONITOR_CHANNEL_ID ||
	(function() {
		throw new Error('The MONITOR_CHANNEL_ID environment variable is required.');
	})();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		// Required for role management
		GatewayIntentBits.GuildMembers,
	],
});

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);

	// Start the API server after Discord client is ready
	try {
		const { server } = createApiServer(client);
		console.log('API server started successfully');

		// Start Calendar Sync (if configured)
		const sync = startCalendarSync(client);

		// Graceful shutdown
		process.on('SIGTERM', () => {
			console.log('Received SIGTERM, shutting down gracefully');
			sync?.stop?.();
			server.close(() => {
				client.destroy();
				process.exit(0);
			});
		});

		process.on('SIGINT', () => {
			console.log('Received SIGINT, shutting down gracefully');
			sync?.stop?.();
			server.close(() => {
				client.destroy();
				process.exit(0);
			});
		});
	}
	catch (error) {
		console.error('Failed to start API server:', error);
	}
});

client.on(Events.MessageCreate, async (msg) => {
	if (msg.author.bot) return;
	if (msg.channelId !== MONITOR_CHANNEL_ID) return;
	if (msg.content === '' && msg.attachments.size === 0) return;
	console.log(`Received message from ${msg.author.tag}`);
	const message = msg.content;
	const attatchment = msg.attachments.first();
	const image_url = attatchment ? attatchment.url : undefined;
	console.log(`Forwarding message: ${message} with image: ${image_url}`);
	await groupmeBot.postMessage(message, image_url);
});

client.login(DISCORD_TOKEN);
