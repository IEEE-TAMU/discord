import {
	ChatInputCommandInteraction,
	Client,
	EmbedBuilder,
	Events,
	GuildMember,
	Interaction,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from 'discord.js';
import { DiscordModule } from './index';

const MODULE_NAME = 'music';
const DEFAULT_COOLDOWN_SECONDS = 5;
const COMMAND_NAMES = new Set([
	'play',
	'pause',
	'resume',
	'skip',
	'stop',
	'volume',
	'mute',
	'np',
]);

const commandBuilders = [
	new SlashCommandBuilder()
		.setName('play')
		.setDescription('Queue a song or playlist on the lounge speakers')
		.addStringOption((option) =>
			option
				.setName('input')
				.setDescription('YouTube/SoundCloud/Bandcamp link, or text to search for')
				.setRequired(true),
		),
	new SlashCommandBuilder()
		.setName('pause')
		.setDescription('Pause lounge playback'),
	new SlashCommandBuilder()
		.setName('resume')
		.setDescription('Resume lounge playback'),
	new SlashCommandBuilder()
		.setName('skip')
		.setDescription('Skip the current track'),
	new SlashCommandBuilder()
		.setName('stop')
		.setDescription('Stop playback and clear the queue'),
	new SlashCommandBuilder()
		.setName('volume')
		.setDescription('Set the lounge player volume')
		.addIntegerOption((option) =>
			option
				.setName('level')
				.setDescription('Volume from 0 to 100')
				.setRequired(true)
				.setMinValue(0)
				.setMaxValue(100),
		),
	new SlashCommandBuilder()
		.setName('mute')
		.setDescription('Toggle mute on the lounge player'),
	new SlashCommandBuilder()
		.setName('np')
		.setDescription('Show what is playing on the lounge speakers'),
];

type QueueEntry = {
	title?: string | null;
	current?: boolean;
};

type AgentStatus = {
	ok: boolean;
	idle?: boolean;
	paused?: boolean;
	playing?: boolean;
	title?: string | null;
	volume?: number | null;
	mute?: boolean;
	position?: number | null;
	duration?: number | null;
	queuePosition?: number | null;
	queueCount?: number;
	queue?: QueueEntry[];
	queued?: string;
};

let agentUrl: string;
let agentToken: string | undefined;
let guildId: string | undefined;
let allowedRoleIds = new Set<string>();
let allowedChannelIds = new Set<string>();
let cooldownSeconds = DEFAULT_COOLDOWN_SECONDS;

const lastCommandAt = new Map<string, number>();

function parseIdSet(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? '')
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean),
	);
}

async function callAgent<T>(path: string, init?: RequestInit): Promise<T> {
	const headers: Record<string, string> = {
		accept: 'application/json',
		'content-type': 'application/json',
	};
	if (agentToken) {
		headers.authorization = `Bearer ${agentToken}`;
	}

	const response = await fetch(`${agentUrl}${path}`, {
		...init,
		headers: {
			...headers,
			...(init?.headers as Record<string, string> | undefined),
		},
		signal: AbortSignal.timeout(10_000),
	});
	const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

	if (!response.ok) {
		throw new Error(payload.error || `lounge player returned HTTP ${response.status}`);
	}

	return payload;
}

function formatTime(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(total / 60);
	const remainder = total % 60;
	return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

function buildNowPlaying(
	status: AgentStatus,
	action?: string,
	starting = false,
): EmbedBuilder {
	const embed = new EmbedBuilder().setColor(0x1f8b4c);

	if (action) {
		embed.setDescription(action);
	}

	if (status.idle || (!status.playing && !status.paused)) {
		embed.addFields({
			name: 'Player',
			value: starting ? 'Starting…' : 'Idle — queue something with `/play`.',
		});
		return embed;
	}

	const lines = [status.paused ? 'Paused' : 'Playing'];
	const position = status.queuePosition;
	if (
		typeof status.queueCount === 'number'
		&& typeof position === 'number'
		&& position >= 0
	) {
		lines.push(`Queue position: ${position + 1}/${status.queueCount}`);
	}
	if (
		typeof status.position === 'number'
		&& typeof status.duration === 'number'
		&& status.duration > 0
	) {
		lines.push(`Progress: ${formatTime(status.position)} / ${formatTime(status.duration)}`);
	}
	if (typeof status.volume === 'number') {
		lines.push(`Volume: ${status.volume}%${status.mute ? ' (muted)' : ''}`);
	}

	embed.addFields(
		{ name: 'Track', value: (status.title?.trim() || 'Unknown track').slice(0, 1024) },
		{ name: 'Status', value: lines.join('\n') },
	);

	return embed;
}

function checkAccess(interaction: ChatInputCommandInteraction): string | null {
	if (allowedChannelIds.size > 0 && !allowedChannelIds.has(interaction.channelId)) {
		return 'Music commands are not enabled in this channel.';
	}

	const member = interaction.member instanceof GuildMember ? interaction.member : null;
	if (!member) {
		return 'Music commands can only be used in the server.';
	}

	if (allowedRoleIds.size > 0) {
		const allowed = member.roles.cache.some((role) => allowedRoleIds.has(role.id));
		return allowed ? null : 'You need an officer role to control lounge music.';
	}

	return member.permissions.has(PermissionFlagsBits.ManageGuild)
		? null
		: 'You need the Manage Server permission to control lounge music.';
}

function checkCooldown(interaction: ChatInputCommandInteraction): number {
	if (cooldownSeconds <= 0) {
		return 0;
	}

	const key = interaction.user.id;
	const now = Date.now();
	const last = lastCommandAt.get(key) ?? 0;
	const remaining = Math.ceil((last + cooldownSeconds * 1000 - now) / 1000);

	if (remaining > 0) {
		return remaining;
	}

	lastCommandAt.set(key, now);
	return 0;
}

async function runCommand(interaction: ChatInputCommandInteraction): Promise<EmbedBuilder> {
	switch (interaction.commandName) {
	case 'play': {
		const input = interaction.options.getString('input', true);
		const result = await callAgent<AgentStatus>('/play', {
			method: 'POST',
			body: JSON.stringify({
				input,
				requestedBy: interaction.user.tag,
			}),
		});
		return buildNowPlaying(result, `Queued **${input}**`, true);
	}
	case 'pause':
		return buildNowPlaying(
			await callAgent<AgentStatus>('/pause', { method: 'POST' }),
			'Paused',
		);
	case 'resume':
		return buildNowPlaying(
			await callAgent<AgentStatus>('/resume', { method: 'POST' }),
			'Resumed',
		);
	case 'skip':
		return buildNowPlaying(
			await callAgent<AgentStatus>('/skip', { method: 'POST' }),
			'Skipped',
		);
	case 'stop':
		return buildNowPlaying(
			await callAgent<AgentStatus>('/stop', { method: 'POST' }),
			'Stopped and cleared the queue',
		);
	case 'volume': {
		const level = interaction.options.getInteger('level', true);
		const result = await callAgent<AgentStatus>('/volume', {
			method: 'POST',
			body: JSON.stringify({ volume: level }),
		});
		return buildNowPlaying(result, `Volume set to ${result.volume ?? level}%`);
	}
	case 'mute': {
		const result = await callAgent<AgentStatus>('/mute', { method: 'POST' });
		return buildNowPlaying(result, result.mute ? 'Muted' : 'Unmuted');
	}
	case 'np':
		return buildNowPlaying(await callAgent<AgentStatus>('/status'));
	default:
		throw new Error(`Unsupported command: ${interaction.commandName}`);
	}
}

export const musicModule: DiscordModule = {
	name: MODULE_NAME,
	start(client: Client) {
		const url = process.env.MUSIC_AGENT_URL;
		if (!url) {
			return {
				enabled: false,
				missingRequirements: ['MUSIC_AGENT_URL'],
			};
		}

		agentUrl = url.replace(/\/+$/, '');
		agentToken = process.env.MUSIC_AGENT_TOKEN?.trim() || undefined;
		guildId = process.env.GUILD_ID;
		allowedRoleIds = parseIdSet(process.env.MUSIC_ALLOWED_ROLE_IDS);
		allowedChannelIds = parseIdSet(process.env.MUSIC_ALLOWED_CHANNEL_IDS);

		const configuredCooldown = Number(process.env.MUSIC_COOLDOWN_SECONDS ?? DEFAULT_COOLDOWN_SECONDS);
		cooldownSeconds = Number.isFinite(configuredCooldown) && configuredCooldown >= 0
			? configuredCooldown
			: DEFAULT_COOLDOWN_SECONDS;

		const commands = commandBuilders.map((command) => command.toJSON());

		const registerCommands = async () => {
			try {
				if (guildId) {
					const guild = await client.guilds.fetch(guildId);
					await guild.commands.set(commands);
				}
				else {
					await client.application?.commands.set(commands);
				}
				console.log(`${MODULE_NAME}: slash commands registered`);
			}
			catch (error) {
				console.error(`${MODULE_NAME}: failed to register slash commands:`, error);
			}
		};
		void registerCommands();

		const onInteraction = async (interaction: Interaction) => {
			if (!interaction.isChatInputCommand()) {
				return;
			}
			if (!COMMAND_NAMES.has(interaction.commandName)) {
				return;
			}
			if (guildId && interaction.guildId !== guildId) {
				return;
			}

			const denial = checkAccess(interaction);
			if (denial) {
				await interaction.reply({ content: denial, flags: MessageFlags.Ephemeral });
				return;
			}

			const cooldown = checkCooldown(interaction);
			if (cooldown > 0) {
				await interaction.reply({
					content: `Slow down a bit — try again in ${cooldown}s.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			await interaction.deferReply();
			try {
				const embed = await runCommand(interaction);
				await interaction.editReply({ embeds: [embed] });
			}
			catch (error) {
				console.error(`${MODULE_NAME}: ${interaction.commandName} failed:`, error);
				const message = error instanceof Error ? error.message : 'Unknown error';
				await interaction.editReply({
					content: `Could not reach the lounge player: ${message}`,
				});
			}
		};

		client.on(Events.InteractionCreate, onInteraction);

		this.stop = () => {
			client.removeListener(Events.InteractionCreate, onInteraction);
			lastCommandAt.clear();
		};

		return { enabled: true };
	},
};
