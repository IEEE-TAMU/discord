import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { DiscordModule } from './modules';
import * as modules from './modules';
import express from 'express';
import cors from 'cors';

const DISCORD_TOKEN =
	process.env.DISCORD_TOKEN ||
	(function() {
		throw new Error('The DISCORD_TOKEN environment variable is required.');
	})();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
	],
});

const moduleList: DiscordModule[] = Object.values(modules).filter(
	(m): m is DiscordModule => typeof m === 'object' && 'name' in m && 'start' in m,
);

const names = moduleList.map((m) => m.name);
const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
if (duplicates.length > 0) {
	throw new Error(`Duplicate module names found: ${duplicates.join(', ')}`);
}

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);

	const app = express();
	const PORT = process.env.API_PORT || 3000;

	app.use(cors());
	app.use(express.json());

	const server = app.listen(PORT, () => {
		console.log(`API server running on port ${PORT}`);
	});

	for (const mod of moduleList) {
		const status = mod.start(client, app);
		if (status.enabled) {
			console.log(`${mod.name}: enabled`);
		}
		else {
			console.log(`${mod.name}: disabled (missing: ${status.missingRequirements?.join(', ') || 'unknown'})`);
		}
	}

	process.on('SIGTERM', () => {
		console.log('Received SIGTERM, shutting down gracefully');
		for (const mod of moduleList) {
			mod.stop?.();
		}
		server.close(() => {
			client.destroy();
			process.exit(0);
		});
		console.log('Shutdown complete');
	});

	process.on('SIGINT', () => {
		console.log('Received SIGINT, shutting down gracefully');
		for (const mod of moduleList) {
			mod.stop?.();
		}
		server.close(() => {
			client.destroy();
			process.exit(0);
		});
		console.log('Shutdown complete');
	});
});

client.login(DISCORD_TOKEN);
