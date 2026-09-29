import { Client } from 'discord.js';
import type { APIEmbed } from 'discord.js';
import type { Express } from 'express';
import { DiscordModule } from './index';

interface NotifyRequest {
	source?: string;
	channel?: string;
	content?: string;
	embeds?: APIEmbed[];
}

const MODULE_NAME = 'notify';
const MAX_CONTENT_LENGTH = 2000;
const CHANNEL_ID_PATTERN = /^\d{17,20}$/;

let discordClient: Client;

function parseRoutes(raw: string | undefined): Map<string, string> {
	const routes = new Map<string, string>();
	for (const pair of (raw ?? '').split(',')) {
		const [alias, channelId] = pair.split(':').map((part) => part.trim());
		if (alias && channelId) {
			routes.set(alias, channelId);
		}
	}
	return routes;
}

function resolveChannel(
	routes: Map<string, string>,
	channelRef: string | undefined,
	source: string | undefined,
): string | undefined {
	if (channelRef) {
		return routes.get(channelRef) ?? (CHANNEL_ID_PATTERN.test(channelRef) ? channelRef : undefined);
	}
	if (source) {
		return routes.get(source) ?? routes.get('default');
	}
	return routes.get('default');
}

export const notifyModule: DiscordModule = {
	name: MODULE_NAME,
	start(client: Client, app: Express) {
		discordClient = client;

		const routes = parseRoutes(process.env.NOTIFY_ROUTES);

		if (routes.size === 0) {
			return {
				enabled: false,
				missingRequirements: ['NOTIFY_ROUTES'],
			};
		}

		app.post('/notify', async (req, res) => {
			const { source, channel: channelRef, content, embeds } = (req.body ?? {}) as NotifyRequest;

			if (content !== undefined && typeof content !== 'string') {
				return res.status(400).json({ success: false, message: 'content must be a string' });
			}

			if (embeds !== undefined && !Array.isArray(embeds)) {
				return res.status(400).json({ success: false, message: 'embeds must be an array' });
			}

			if (!content && !embeds?.length) {
				return res.status(400).json({ success: false, message: 'content or embeds is required' });
			}

			if (content && content.length > MAX_CONTENT_LENGTH) {
				return res.status(400).json({
					success: false,
					message: `content must be at most ${MAX_CONTENT_LENGTH} characters`,
				});
			}

			const channelId = resolveChannel(routes, channelRef, source);
			if (!channelId) {
				return res.status(400).json({
					success: false,
					message: `No channel configured for '${source ?? channelRef ?? 'default'}'`,
				});
			}

			try {
				const channel = await discordClient.channels.fetch(channelId);
				if (!channel || !channel.isTextBased() || !channel.isSendable()) {
					return res.status(400).json({
						success: false,
						message: `Channel ${channelId} is not a sendable text channel`,
					});
				}

				const message = await channel.send({ content, embeds });
				console.log(`${MODULE_NAME}: posted to channel ${channelId} (message ${message.id})`);
				return res.json({
					success: true,
					channelId,
					messageId: message.id,
				});
			}
			catch (error) {
				console.error(`${MODULE_NAME}: failed to send message:`, error);
				return res.status(500).json({ success: false, message: 'Failed to send message' });
			}
		});

		return { enabled: true };
	},
};
