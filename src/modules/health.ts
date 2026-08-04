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
	openapi: {
		paths: {
			'/health': {
				get: {
					tags: ['health'],
					summary: 'Health check',
					description: 'Returns the bot status and current timestamp.',
					responses: {
						200: {
							description: 'Service is healthy',
							content: {
								'application/json': {
									schema: {
										type: 'object',
										properties: {
											status: { type: 'string', example: 'ok' },
											timestamp: { type: 'string', format: 'date-time' },
										},
									},
								},
							},
						},
					},
				},
			},
		},
	},
};
