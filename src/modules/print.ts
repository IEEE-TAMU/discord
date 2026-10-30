import type { Attachment } from 'discord.js';
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

const MODULE_NAME = 'print';
const DEFAULT_COOLDOWN_SECONDS = 5;
const DEFAULT_MAX_FILE_MB = 10;
const COMMAND_NAMES = new Set([
	'print',
	'print-status',
	'print-cancel',
]);
const SUPPORTED_TYPES = new Set([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'text/plain',
]);

const commandBuilders = [
	new SlashCommandBuilder()
		.setName('print')
		.setDescription('Print a PDF or image on the IEEE lounge printer')
		.addAttachmentOption((option) =>
			option
				.setName('file')
				.setDescription('PDF, PNG, JPEG, or plain-text file')
				.setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName('copies')
				.setDescription('Number of copies (default 1)')
				.setMinValue(1)
				.setMaxValue(20)
				.setRequired(false),
		)
		.addStringOption((option) =>
			option
				.setName('pages')
				.setDescription('Page range, for example 1-3,5')
				.setMaxLength(64)
				.setRequired(false),
		),
	new SlashCommandBuilder()
		.setName('print-status')
		.setDescription('Show the lounge printer status and queued jobs'),
	new SlashCommandBuilder()
		.setName('print-cancel')
		.setDescription('Cancel a queued print job')
		.addStringOption((option) =>
			option
				.setName('job')
				.setDescription('Job ID from /print-status')
				.setMaxLength(128)
				.setRequired(true),
		),
];

type PrintJob = {
	id?: string | null;
	owner?: string | null;
	size?: string | null;
};

type PrinterInfo = {
	name?: string;
	state?: string;
	message?: string;
};

type PrintStatus = {
	ok: boolean;
	printer?: string | PrinterInfo;
	jobs?: PrintJob[];
	jobId?: string | null;
	filename?: string;
	copies?: number;
	pages?: string | null;
	error?: string;
};

let agentUrl: string;
let agentToken: string | undefined;
let guildId: string | undefined;
let allowedRoleIds = new Set<string>();
let allowedChannelIds = new Set<string>();
let cooldownSeconds = DEFAULT_COOLDOWN_SECONDS;
let maxFileBytes = DEFAULT_MAX_FILE_MB * 1024 * 1024;

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
	};
	if (agentToken) {
		headers.authorization = `Bearer ${agentToken}`;
	}
	if (!init?.body || typeof init.body === 'string') {
		headers['content-type'] = 'application/json';
	}

	const response = await fetch(`${agentUrl}${path}`, {
		...init,
		headers: {
			...headers,
			...(init?.headers as Record<string, string> | undefined),
		},
		signal: AbortSignal.timeout(60_000),
	});
	const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

	if (!response.ok) {
		throw new Error(payload.error || `print agent returned HTTP ${response.status}`);
	}

	return payload;
}

function isSupportedAttachment(attachment: Attachment): boolean {
	const type = attachment.contentType?.split(';', 1)[0]?.trim().toLowerCase();
	if (type && SUPPORTED_TYPES.has(type)) {
		return true;
	}
	return /\.(?:pdf|png|jpe?g|txt)$/i.test(attachment.name);
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function buildPrintResult(result: PrintStatus, attachmentName: string): EmbedBuilder {
	const embed = new EmbedBuilder().setColor(0x1f8b4c).setTitle('Print job queued');
	const printer = typeof result.printer === 'string'
		? result.printer
		: result.printer?.name ?? 'the lounge printer';
	const lines = [
		`Queued **${result.filename ?? attachmentName}** on **${printer}**.`,
	];
	if (result.jobId) {
		lines.push(`Job: \`${result.jobId}\``);
	}
	if (typeof result.copies === 'number') {
		lines.push(`Copies: ${result.copies}`);
	}
	if (result.pages) {
		lines.push(`Pages: ${result.pages}`);
	}
	embed.setDescription(lines.join('\n').slice(0, 4096));
	return embed;
}

function buildStatus(status: PrintStatus): EmbedBuilder {
	const embed = new EmbedBuilder().setColor(0x1f8b4c).setTitle('IEEE lounge printer');
	const printer = typeof status.printer === 'object' ? status.printer : undefined;
	const state = printer?.state ?? 'unknown';
	const lines = [`State: **${state}**`];
	if (printer?.name) {
		lines.push(`Queue: \`${printer.name}\``);
	}
	if (printer?.message) {
		const message = printer.message.replace(/```/g, '\'\'\'').slice(0, 1000);
		lines.push('```', message, '```');
	}
	embed.addFields({ name: 'Printer', value: lines.join('\n').slice(0, 1024) });

	const jobs = status.jobs ?? [];
	if (jobs.length === 0) {
		embed.addFields({ name: 'Queue', value: 'No queued jobs.' });
	}
	else {
		const list = jobs.slice(0, 15).map((job, index) => {
			const owner = job.owner ? ` — ${job.owner}` : '';
			return `${index + 1}. \`${job.id ?? 'unknown'}\`${owner}`;
		});
		embed.addFields({ name: 'Queue', value: list.join('\n').slice(0, 1024) });
	}

	return embed;
}

function checkAccess(interaction: ChatInputCommandInteraction): string | null {
	if (allowedChannelIds.size > 0 && !allowedChannelIds.has(interaction.channelId)) {
		return 'Print commands are not enabled in this channel.';
	}

	const member = interaction.member instanceof GuildMember ? interaction.member : null;
	if (!member) {
		return 'Print commands can only be used in the server.';
	}

	if (allowedRoleIds.size > 0) {
		const allowed = member.roles.cache.some((role) => allowedRoleIds.has(role.id));
		return allowed ? null : 'You need an officer role to use the printer.';
	}

	return member.permissions.has(PermissionFlagsBits.ManageGuild)
		? null
		: 'You need the Manage Server permission to use the printer.';
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
	case 'print': {
		const attachment = interaction.options.getAttachment('file', true);
		if (attachment.size > maxFileBytes) {
			throw new Error(
				`That file is too large (${formatBytes(attachment.size)}); the limit is ${formatBytes(maxFileBytes)}.`,
			);
		}
		if (!isSupportedAttachment(attachment)) {
			throw new Error('Only PDF, PNG, JPEG, and plain-text files are supported.');
		}

		const response = await fetch(attachment.url, {
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			throw new Error(`Could not download the attachment (HTTP ${response.status}).`);
		}

		const contentLength = Number(response.headers.get('content-length') ?? '0');
		if (contentLength > maxFileBytes) {
			throw new Error(`That file is too large; the limit is ${formatBytes(maxFileBytes)}.`);
		}

		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxFileBytes) {
			throw new Error(`That file is too large; the limit is ${formatBytes(maxFileBytes)}.`);
		}

		const copies = interaction.options.getInteger('copies') ?? 1;
		const pages = interaction.options.getString('pages')?.trim();
		const params = new URLSearchParams({
			filename: attachment.name,
			copies: String(copies),
		});
		if (pages) {
			params.set('pages', pages);
		}

		const result = await callAgent<PrintStatus>(`/print?${params.toString()}`, {
			method: 'POST',
			headers: {
				'content-type': attachment.contentType || 'application/octet-stream',
			},
			body: bytes,
		});
		return buildPrintResult(result, attachment.name);
	}
	case 'print-status':
		return buildStatus(await callAgent<PrintStatus>('/status'));
	case 'print-cancel': {
		const job = interaction.options.getString('job', true).trim();
		if (!job) {
			throw new Error('A job ID is required.');
		}
		const result = await callAgent<PrintStatus>('/cancel', {
			method: 'POST',
			body: JSON.stringify({ jobId: job }),
		});
		return new EmbedBuilder()
			.setColor(0x1f8b4c)
			.setTitle('Print job cancelled')
			.setDescription(`Cancelled job \`${result.jobId ?? job}\`.`);
	}
	default:
		throw new Error(`Unsupported command: ${interaction.commandName}`);
	}
}

export const printModule: DiscordModule = {
	name: MODULE_NAME,
	commands: commandBuilders.map((command) => command.toJSON()),
	start(client: Client) {
		const url = process.env.PRINT_AGENT_URL;
		if (!url) {
			return {
				enabled: false,
				missingRequirements: ['PRINT_AGENT_URL'],
			};
		}

		agentUrl = url.replace(/\/+$/, '');
		agentToken = process.env.PRINT_AGENT_TOKEN?.trim() || undefined;
		guildId = process.env.GUILD_ID;
		allowedRoleIds = parseIdSet(process.env.PRINT_ALLOWED_ROLE_IDS);
		allowedChannelIds = parseIdSet(process.env.PRINT_ALLOWED_CHANNEL_IDS);

		const configuredCooldown = Number(process.env.PRINT_COOLDOWN_SECONDS ?? DEFAULT_COOLDOWN_SECONDS);
		cooldownSeconds = Number.isFinite(configuredCooldown) && configuredCooldown >= 0
			? configuredCooldown
			: DEFAULT_COOLDOWN_SECONDS;

		const configuredMaxMb = Number(process.env.PRINT_MAX_FILE_MB ?? DEFAULT_MAX_FILE_MB);
		maxFileBytes = Number.isFinite(configuredMaxMb) && configuredMaxMb > 0
			? Math.floor(configuredMaxMb * 1024 * 1024)
			: DEFAULT_MAX_FILE_MB * 1024 * 1024;

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

			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			try {
				const embed = await runCommand(interaction);
				await interaction.editReply({ embeds: [embed] });
			}
			catch (error) {
				console.error(`${MODULE_NAME}: ${interaction.commandName} failed:`, error);
				const message = error instanceof Error ? error.message : 'Unknown error';
				await interaction.editReply({
					content: `Could not complete that request: ${message}`,
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
