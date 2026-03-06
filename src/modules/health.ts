import { Client } from 'discord.js';
import type { Express } from 'express';
import { DiscordModule } from './index';

const MODULE_NAME = 'health';

export const healthModule: DiscordModule = {
	name: MODULE_NAME,
	start(_client: Client, app: Express) {
		app.get('/health', (_req, res) => {
			res.json({
				status: 'ok',
				timestamp: new Date().toISOString(),
			});
		});
		return { enabled: true };
	},
};
