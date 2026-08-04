import { Client, Events, GatewayIntentBits } from 'discord.js';
import type { DiscordModule } from './modules';
import * as modules from './modules';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';

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

	const enabledModules = new Map<string, boolean>();

	for (const mod of moduleList) {
		const status = mod.start(client, app);
		if (status.enabled) {
			console.log(`${mod.name}: enabled`);
		}
		else {
			console.log(`${mod.name}: disabled (missing: ${status.missingRequirements?.join(', ') || 'unknown'})`);
		}
		enabledModules.set(mod.name, status.enabled);
	}

	const spec: {
		openapi: string;
		info: { title: string; version: string; description: string };
		paths: Record<string, unknown>;
		components: { schemas: Record<string, unknown> };
	} = {
		openapi: '3.0.3',
		info: {
			title: 'IEEE TAMU Discord Bot API',
			version: process.env.npm_package_version || '0.0.0',
			description: 'Self-documenting API for the IEEE TAMU Discord bot. Only endpoints from enabled modules are listed.',
		},
		paths: {},
		components: { schemas: {} },
	};

	for (const mod of moduleList) {
		if (!enabledModules.get(mod.name) || !mod.openapi) continue;
		Object.assign(spec.paths, mod.openapi.paths);
		if (mod.openapi.components?.schemas) {
			Object.assign(spec.components.schemas, mod.openapi.components.schemas);
		}
	}

	app.get('/openapi.json', (_req, res) => {
		res.json(spec);
	});
	app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
	console.log('API docs available at /docs (spec: /openapi.json)');

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
