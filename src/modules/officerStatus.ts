import { createHash, timingSafeEqual } from 'node:crypto';
import {
	Client,
	EmbedBuilder,
	type Message,
	type SendableChannels,
	type TextBasedChannel,
} from 'discord.js';
import type { Express, Request } from 'express';
import { DiscordModule } from './index';

const MODULE_NAME = 'officerStatus';
const FOOTER_TEXT = 'ieee-tamu officer status';
const DEFAULT_STALE_SECONDS = 90;
const STALE_CHECK_INTERVAL_MS = 30000;
const MAX_DEVICE_ID_LENGTH = 64;
const MESSAGE_SEARCH_LIMIT = 50;

type DeviceStatus = {
	deviceId: string;
	greenActive: boolean;
	uptimeSec: number;
	rssi: number;
	lastSeen: number;
};

type OfficerStatusPayload = {
	deviceId?: unknown;
	greenActive?: unknown;
	uptimeSec?: unknown;
	rssi?: unknown;
};

function constantTimeEqual(a: string, b: string): boolean {
	const first = createHash('sha256').update(a).digest();
	const second = createHash('sha256').update(b).digest();
	return timingSafeEqual(first, second);
}

function isAuthorized(req: Request, apiKey: string): boolean {
	if (!apiKey) {
		return true;
	}

	const header = req.get('authorization') ?? '';
	const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
	return constantTimeEqual(token, apiKey);
}

function toFiniteNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parsePayload(body: OfficerStatusPayload): DeviceStatus | string {
	if (typeof body.deviceId !== 'string' || body.deviceId.trim().length === 0) {
		return 'deviceId must be a non-empty string';
	}

	if (body.deviceId.length > MAX_DEVICE_ID_LENGTH) {
		return `deviceId must be at most ${MAX_DEVICE_ID_LENGTH} characters`;
	}

	return {
		deviceId: body.deviceId.trim(),
		greenActive: body.greenActive === true,
		uptimeSec: Math.max(0, toFiniteNumber(body.uptimeSec, 0)),
		rssi: toFiniteNumber(body.rssi, 0),
		lastSeen: Date.now(),
	};
}

function buildEmbed(
	devices: DeviceStatus[],
	staleSeconds: number,
): EmbedBuilder {
	const now = Date.now();
	const describe = (device: DeviceStatus) => {
		const stale = now - device.lastSeen > staleSeconds * 1000;
		const value = stale ? '⚪ Offline' : device.greenActive ? '🟢 Light on' : '🔴 Light off';
		return { name: device.deviceId, value, inline: true };
	};

	const healthy = devices.filter((device) => now - device.lastSeen <= staleSeconds * 1000);
	const anyActive = healthy.some((device) => device.greenActive);
	const allOffline = healthy.length === 0;

	const title = allOffline
		? '⚪ Lounge sensor offline'
		: anyActive
			? '🟢 Officer present'
			: '🔴 Lounge empty';

	const description = allOffline
		? `No update from the lounge sensor in the last ${staleSeconds} seconds.`
		: anyActive
			? 'The lounge light is on.'
			: 'The lounge light is off.';

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setDescription(description)
		.setColor(allOffline ? 0x95a5a6 : anyActive ? 0x2ecc71 : 0xe74c3c)
		.setFooter({ text: FOOTER_TEXT });

	if (devices.length > 1) {
		embed.addFields(devices.map(describe));
	}

	return embed;
}

function isSendableTextChannel(channel: unknown): channel is SendableChannels & TextBasedChannel {
	return Boolean(
		channel
		&& typeof channel === 'object'
		&& 'isTextBased' in channel
		&& typeof (channel as TextBasedChannel).isTextBased === 'function'
		&& (channel as TextBasedChannel).isTextBased()
		&& 'isSendable' in channel
		&& typeof (channel as SendableChannels).isSendable === 'function'
		&& (channel as SendableChannels).isSendable()
		&& 'messages' in channel,
	);
}

let stopModule: (() => void) | null = null;

export const officerStatusModule: DiscordModule = {
	name: MODULE_NAME,
	start(client: Client, app: Express) {
		const channelId = process.env.OFFICER_STATUS_CHANNEL_ID?.trim();
		const apiKey = process.env.OFFICER_STATUS_API_KEY ?? '';
		const staleSeconds = Math.max(
			15,
			Number(process.env.OFFICER_STATUS_STALE_SECONDS) || DEFAULT_STALE_SECONDS,
		);

		if (!channelId) {
			return {
				enabled: false,
				missingRequirements: ['OFFICER_STATUS_CHANNEL_ID'],
			};
		}

		const devices = new Map<string, DeviceStatus>();
		let statusMessage: Message | null = null;
		let statusChannel: (SendableChannels & TextBasedChannel) | null = null;
		let stopped = false;
		let updateInFlight = false;
		let renderPending = false;

		async function resolveChannel() {
			if (statusChannel) {
				return statusChannel;
			}

			const channel = await client.channels.fetch(channelId as string);
			if (!isSendableTextChannel(channel)) {
				throw new Error(`channel ${channelId} is not a sendable text channel`);
			}

			statusChannel = channel;
			return channel;
		}

		async function findExistingMessage(channel: SendableChannels & TextBasedChannel) {
			const messages = await channel.messages.fetch({ limit: MESSAGE_SEARCH_LIMIT });
			return messages.find(
				(message) =>
					message.author.id === client.user?.id
					&& message.embeds.some((embed) => embed.footer?.text === FOOTER_TEXT),
			) ?? null;
		}

		async function renderStatus() {
			if (stopped || devices.size === 0) {
				return;
			}

			if (updateInFlight) {
				renderPending = true;
				return;
			}

			updateInFlight = true;
			try {
				const channel = await resolveChannel();

				if (!statusMessage) {
					statusMessage = await findExistingMessage(channel);
				}

				const embed = buildEmbed([...devices.values()], staleSeconds);

				if (statusMessage) {
					try {
						statusMessage = await statusMessage.edit({ embeds: [embed] });
						return;
					}
					catch (error) {
						console.warn(`${MODULE_NAME}: could not edit status message, recreating:`, error);
						statusMessage = null;
					}
				}

				statusMessage = await channel.send({ embeds: [embed] });
				console.log(`${MODULE_NAME}: created status message ${statusMessage.id} in ${channelId}`);
			}
			catch (error) {
				if (statusChannel) {
					statusChannel = null;
				}
				console.error(`${MODULE_NAME}: failed to update status message:`, error);
			}
			finally {
				updateInFlight = false;
				if (renderPending) {
					renderPending = false;
					void renderStatus();
				}
			}
		}

		app.post('/officer-status', async (req, res) => {
			if (!isAuthorized(req, apiKey)) {
				return res.status(401).json({ success: false, message: 'invalid API key' });
			}

			const parsed = parsePayload((req.body ?? {}) as OfficerStatusPayload);
			if (typeof parsed === 'string') {
				return res.status(400).json({ success: false, message: parsed });
			}

			devices.set(parsed.deviceId, parsed);
			console.log(
				`${MODULE_NAME}: ${parsed.deviceId} -> ${parsed.greenActive ? 'PRESENT' : 'EMPTY'}`,
			);

			void renderStatus();

			return res.json({
				success: true,
				deviceId: parsed.deviceId,
				status: parsed.greenActive ? 'PRESENT' : 'EMPTY',
				updatedAt: new Date(parsed.lastSeen).toISOString(),
			});
		});

		app.get('/officer-status', (req, res) => {
			if (!isAuthorized(req, apiKey)) {
				return res.status(401).json({ success: false, message: 'invalid API key' });
			}

			const now = Date.now();
			return res.json({
				success: true,
				staleSeconds,
				devices: [...devices.values()].map((device) => ({
					...device,
					stale: now - device.lastSeen > staleSeconds * 1000,
				})),
			});
		});

		const staleTimer = setInterval(() => {
			if (devices.size === 0) {
				return;
			}
			void renderStatus();
		}, STALE_CHECK_INTERVAL_MS);
		staleTimer.unref?.();

		stopModule = () => {
			stopped = true;
			clearInterval(staleTimer);
		};

		return { enabled: true };
	},
	stop() {
		stopModule?.();
		stopModule = null;
	},
};
