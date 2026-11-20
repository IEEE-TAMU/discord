import type { Attachment, MessageActionRowComponentBuilder } from 'discord.js';
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	Client,
	EmbedBuilder,
	Events,
	GuildMember,
	Interaction,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { DiscordModule } from './index';

const MODULE_NAME = 'print3d';
const DEFAULT_COOLDOWN_SECONDS = 10;
const DEFAULT_MAX_FILE_MB = 25;
const DEFAULT_NOTIFY_POLL_SECONDS = 20;
const ACTIVE_PRINT_STATES = new Set(['PREPARE', 'RUNNING', 'PAUSE', 'SLICING']);
const TERMINAL_PRINT_STATES = new Set(['FINISH', 'FAILED']);
const COMMAND_NAMES = new Set([
	'3dprint',
	'3dprint-status',
	'3dprint-stop',
]);

const commandBuilders = [
	new SlashCommandBuilder()
		.setName('3dprint')
		.setDescription('Upload a pre-sliced .gcode.3mf to the lounge Bambu Lab X2D')
		.addAttachmentOption((option) =>
			option
				.setName('file')
				.setDescription('Pre-sliced .gcode.3mf file for the X2D')
				.setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName('plate')
				.setDescription('Plate number inside the .3mf (default 1)')
				.setMinValue(1)
				.setMaxValue(16)
				.setRequired(false),
		)
		.addBooleanOption((option) =>
			option
				.setName('bed_leveling')
				.setDescription('Run bed leveling before the print (default true)')
				.setRequired(false),
		)
		.addBooleanOption((option) =>
			option
				.setName('flow_cali')
				.setDescription('Run flow calibration (default false)')
				.setRequired(false),
		)
		.addBooleanOption((option) =>
			option
				.setName('vibration_cali')
				.setDescription('Run vibration calibration (default false)')
				.setRequired(false),
		)
		.addBooleanOption((option) =>
			option
				.setName('timelapse')
				.setDescription('Record a timelapse (default false)')
				.setRequired(false),
		),
	new SlashCommandBuilder()
		.setName('3dprint-status')
		.setDescription('Show the X2D status, bed camera, filament, and nozzle info'),
	new SlashCommandBuilder()
		.setName('3dprint-stop')
		.setDescription('Stop the current X2D print'),
];

type Slot = {
	globalId: number;
	amsId: number;
	slotId: number;
	label: string;
	type?: string | null;
	color?: string | null;
	remain?: number | null;
	nozzleTempMin?: number | null;
	nozzleTempMax?: number | null;
	state?: number | null;
	active?: boolean;
	external?: boolean;
};

type AmsUnit = {
	id: number;
	humidity?: number | null;
	humidityRaw?: number | null;
	temperature?: number | null;
	drying?: number | null;
	trays: Slot[];
};

type PrinterStatus = {
	ok: boolean;
	printer: {
		name?: string;
		serial?: string;
		ip?: string;
		firmware?: string;
		state?: string;
		stateLabel?: string;
		progress?: number | null;
		remainingMinutes?: number | null;
		layer?: number | null;
		totalLayers?: number | null;
		subtask?: string | null;
		gcodeFile?: string | null;
		wifi?: string | null;
		sdcard?: boolean | null;
		developerMode?: boolean | null;
		signedCommandsRequired?: boolean | null;
		errors?: {
			printError?: number;
			mcError?: number;
			failReason?: string;
			hms?: Array<{
				attr: string;
				code: string;
				display?: string;
				timestamp?: string;
			}>;
		};
	};
	temperatures: {
		bed?: { current?: number | null; target?: number | null };
		nozzles?: Array<{
			index: number;
			current?: number | null;
			target?: number | null;
			type?: string | null;
			diameter?: number | null;
		}>;
		chamber?: { current?: number | null; target?: number | null };
	};
	fans?: Record<string, number | null>;
	ams?: {
		units?: AmsUnit[];
		slots?: Slot[];
		activeTray?: number | null;
	};
	camera?: { available?: boolean };
	capabilities?: { startPrint?: boolean };
	connection?: {
		mqtt?: boolean;
		lastUpdate?: number | null;
		lastError?: string | null;
	};
};

type PrintFilament = {
	index: number;
	id?: number | null;
	type?: string | null;
	color?: string | null;
	grams?: number | null;
	slot?: string | null;
	globalTray?: number | null;
};

type PrintResult = {
	ok: boolean;
	dryRun?: boolean;
	uploaded?: boolean;
	started?: boolean;
	uploadId?: string;
	filename?: string;
	plate?: number;
	subtask?: string;
	printer?: string;
	printerState?: string;
	capabilities?: { startPrint?: boolean };
	filaments?: PrintFilament[];
	slots?: Slot[];
	warnings?: string[];
	settings?: {
		useAms?: boolean;
		amsMapping?: number[] | null;
		amsMapping2?: Array<{ ams_id: number; slot_id: number }> | null;
		bedLeveling?: boolean;
		flowCali?: boolean;
		vibrationCali?: boolean;
		layerInspect?: boolean;
		timelapse?: boolean;
	};
	printerResponse?: Record<string, unknown> | null;
	state?: string;
};

type MappingErrorDetails = {
	needsMapping?: boolean;
	error?: string;
	filaments?: Array<{
		id?: number | null;
		type?: string | null;
		color?: string | null;
		used_grams?: number | null;
	}>;
	slots?: Slot[];
};

type MappingSession = {
	uploadId: string;
	userId: string;
	filename: string;
	plate: number;
	subtask: string;
	filaments: PrintFilament[];
	slots: Slot[];
	settings?: PrintResult['settings'];
	capabilities?: { startPrint?: boolean };
	printerState?: string;
	mapping: Map<number, number>;
	createdAt: number;
	submitting: boolean;
};

class AgentHttpError extends Error {
	payload: Record<string, unknown>;
	status: number;

	constructor(message: string, status: number, payload: Record<string, unknown>) {
		super(message);
		this.name = 'AgentHttpError';
		this.status = status;
		this.payload = payload;
	}
}

let agentUrl: string;
let agentToken: string | undefined;
let guildId: string | undefined;
let allowedRoleIds = new Set<string>();
let allowedChannelIds = new Set<string>();
let cooldownSeconds = DEFAULT_COOLDOWN_SECONDS;
let maxFileBytes = DEFAULT_MAX_FILE_MB * 1024 * 1024;

const lastCommandAt = new Map<string, number>();

let notifyChannelId: string | undefined;
let notifyPollSeconds = DEFAULT_NOTIFY_POLL_SECONDS;
let notifyInitialized = false;
let notifyPolling = false;
let lastNotifyState: string | null = null;
let lastJobKey = '';
let lastNotifiedJobKey: string | null = null;
let printStartedAt: number | null = null;
let lastActiveSlot: Slot | null = null;

const MAPPING_TTL_MS = 60 * 60 * 1000;
const MAX_MAPPING_FILAMENTS = 20;
const mappingSessions = new Map<string, MappingSession>();

function pruneMappingSessions() {
	const cutoff = Date.now() - MAPPING_TTL_MS;
	for (const [uploadId, session] of mappingSessions) {
		if (session.createdAt < cutoff) {
			mappingSessions.delete(uploadId);
		}
	}
}

function getMappingSession(uploadId: string): MappingSession | undefined {
	pruneMappingSessions();
	return mappingSessions.get(uploadId);
}

function parseIdSet(raw: string | undefined): Set<string> {
	return new Set(
		(raw ?? '')
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean),
	);
}

async function callAgent<T>(
	path: string,
	init?: RequestInit,
	timeoutMs = 15_000,
): Promise<T> {
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
		signal: AbortSignal.timeout(timeoutMs),
	});
	const payload = (await response.json().catch(() => ({}))) as T & {
		error?: string;
	};

	if (!response.ok) {
		throw new AgentHttpError(
			payload.error || `3D printer agent returned HTTP ${response.status}`,
			response.status,
			payload as Record<string, unknown>,
		);
	}

	return payload;
}

async function fetchSnapshot(): Promise<Buffer | null> {
	try {
		const headers: Record<string, string> = {};
		if (agentToken) {
			headers.authorization = `Bearer ${agentToken}`;
		}
		const response = await fetch(`${agentUrl}/snapshot`, {
			headers,
			signal: AbortSignal.timeout(45_000),
		});
		if (!response.ok) {
			return null;
		}
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength === 0) {
			return null;
		}
		return Buffer.from(bytes);
	}
	catch {
		return null;
	}
}

function isGcode3mf(attachment: Attachment): boolean {
	return /\.gcode\.3mf$/i.test(attachment.name);
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function formatTemp(current?: number | null, target?: number | null): string {
	const currentText = typeof current === 'number' ? `${current.toFixed(0)}°C` : '—';
	if (typeof target === 'number' && target > 0) {
		return `${currentText} → ${target.toFixed(0)}°C`;
	}
	return currentText;
}

function formatMinutes(minutes?: number | null): string {
	if (typeof minutes !== 'number' || minutes <= 0) {
		return '—';
	}
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatDuration(milliseconds: number): string {
	const minutes = Math.max(1, Math.round(milliseconds / 60_000));
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function buildFinishedEmbed(
	status: PrinterStatus,
	failed: boolean,
	startedAt: number | null,
	activeSlot: Slot | null,
): EmbedBuilder {
	const printer = status.printer;
	const jobName = printer.subtask ?? 'Unknown job';
	const embed = new EmbedBuilder()
		.setColor(failed ? 0xe74c3c : 0x2ecc71)
		.setTitle(
			failed
				? `❌ Print failed: ${jobName}`
				: `✅ Print finished: ${jobName}`,
		);

	const lines = [
		`File: **${printer.gcodeFile ?? 'unknown'}**`,
		`Result: **${printer.stateLabel ?? printer.state ?? 'Unknown'}**`,
		`Progress: ${typeof printer.progress === 'number' ? `${printer.progress}%` : '—'}`,
	];
	if (typeof printer.layer === 'number' && typeof printer.totalLayers === 'number') {
		lines.push(`Layers: ${printer.layer}/${printer.totalLayers}`);
	}
	if (startedAt) {
		lines.push(`Elapsed: ~${formatDuration(Date.now() - startedAt)}`);
	}
	embed.setDescription(lines.join('\n').slice(0, 4096));

	const bed = status.temperatures?.bed;
	const chamber = status.temperatures?.chamber;
	const tempLines = [`Bed: ${formatTemp(bed?.current, bed?.target)}`];
	for (const nozzle of status.temperatures?.nozzles ?? []) {
		const details = [
			nozzle.type,
			typeof nozzle.diameter === 'number' ? `${nozzle.diameter} mm` : null,
		].filter(Boolean).join(', ');
		tempLines.push(
			`Nozzle ${nozzle.index + 1}: ${formatTemp(nozzle.current, nozzle.target)}${details ? ` (${details})` : ''}`,
		);
	}
	if (chamber && typeof chamber.current === 'number') {
		tempLines.push(`Chamber: ${formatTemp(chamber.current, chamber.target)}`);
	}
	embed.addFields({ name: 'Temperatures', value: tempLines.join('\n').slice(0, 1024) });

	const slot = activeSlot ?? status.ams?.slots?.find((candidate) => candidate.active);
	if (slot) {
		embed.addFields({
			name: 'Filament',
			value: ansiBlock([
				`${ansiSwatch(slot.color)} ${slot.label} · ${slot.type ?? 'Unknown'} · ${colorName(slot.color)}`,
			]),
		});
	}

	if (failed) {
		const errors = printer.errors;
		const errorLines: string[] = [];
		if (errors?.printError) {
			errorLines.push(`print_error: ${errors.printError}`);
		}
		if (errors?.mcError) {
			errorLines.push(`mc_err: ${errors.mcError}`);
		}
		for (const code of errors?.hms ?? []) {
			errorLines.push(`HMS ${code.display ?? `${code.attr}_${code.code}`}`);
		}
		if (errorLines.length > 0) {
			embed.addFields({ name: 'Errors', value: errorLines.join('\n').slice(0, 1024) });
		}
	}

	embed.setFooter({
		text: [
			'Bambu Lab X2D',
			printer.serial ? `Serial ${printer.serial}` : null,
		].filter(Boolean).join(' • '),
	});

	return embed;
}

async function sendPrintFinished(
	client: Client,
	channelId: string,
	status: PrinterStatus,
	failed: boolean,
	startedAt: number | null,
	activeSlot: Slot | null,
): Promise<void> {
	const channel = await client.channels.fetch(channelId);
	if (!channel || !channel.isTextBased() || !channel.isSendable()) {
		console.error(`${MODULE_NAME}: notification channel ${channelId} is not sendable`);
		return;
	}

	const embed = buildFinishedEmbed(status, failed, startedAt, activeSlot);
	const files: AttachmentBuilder[] = [];
	const snapshot = await fetchSnapshot();
	if (snapshot) {
		files.push(
			new AttachmentBuilder(snapshot, {
				name: 'print.jpg',
				description: 'X2D camera snapshot after the print',
			}),
		);
		embed.setImage('attachment://print.jpg');
	}
	else {
		embed.addFields({
			name: 'Camera',
			value: 'Snapshot unavailable.',
		});
	}

	await channel.send({ embeds: [embed], files });
	console.log(
		`${MODULE_NAME}: posted ${failed ? 'failure' : 'completion'} notification for ${status.printer.subtask ?? 'unknown job'}`,
	);
}

async function pollPrintNotifications(client: Client, channelId: string): Promise<void> {
	if (notifyPolling) {
		return;
	}
	notifyPolling = true;
	try {
		const status = await callAgent<PrinterStatus>('/status', undefined, 15_000);
		const state = (status.printer.state ?? 'UNKNOWN').toUpperCase();
		const jobKey = `${status.printer.subtask ?? ''}|${status.printer.gcodeFile ?? ''}`;
		const active = ACTIVE_PRINT_STATES.has(state);
		const terminal = TERMINAL_PRINT_STATES.has(state);

		if (!notifyInitialized) {
			notifyInitialized = true;
			lastNotifyState = state;
			lastJobKey = jobKey;
			if (active) {
				printStartedAt = Date.now();
				lastNotifiedJobKey = null;
			}
			else if (terminal) {
				lastNotifiedJobKey = jobKey;
			}
			const slot = status.ams?.slots?.find((candidate) => candidate.active);
			if (slot) {
				lastActiveSlot = slot;
			}
			return;
		}

		if (active) {
			if (!ACTIVE_PRINT_STATES.has(lastNotifyState ?? '')) {
				printStartedAt = Date.now();
				lastNotifiedJobKey = null;
			}
			const slot = status.ams?.slots?.find((candidate) => candidate.active);
			if (slot) {
				lastActiveSlot = slot;
			}
		}

		if (terminal && lastNotifiedJobKey !== jobKey) {
			const wasActive = ACTIVE_PRINT_STATES.has(lastNotifyState ?? '');
			const isNewJob = jobKey !== lastJobKey;
			if (wasActive || isNewJob) {
				await sendPrintFinished(
					client,
					channelId,
					status,
					state === 'FAILED',
					printStartedAt,
					lastActiveSlot,
				);
				lastNotifiedJobKey = jobKey;
			}
		}

		lastNotifyState = state;
		lastJobKey = jobKey;
	}
	catch (error) {
		console.error(`${MODULE_NAME}: notification poll failed:`, error);
	}
	finally {
		notifyPolling = false;
	}
}

function stateColor(state?: string): number {
	switch (state) {
	case 'RUNNING':
		return 0x3498db;
	case 'PREPARE':
	case 'SLICING':
		return 0x9b59b6;
	case 'PAUSE':
		return 0xf39c12;
	case 'FAILED':
		return 0xe74c3c;
	case 'FINISH':
		return 0x2ecc71;
	default:
		return 0x95a5a6;
	}
}

type ColorSwatch = {
	name: string;
	emoji: string;
	rgb: [number, number, number];
};

const COLOR_SWATCHES: ColorSwatch[] = [
	{ name: 'Red', emoji: '🟥', rgb: [231, 76, 60] },
	{ name: 'Crimson', emoji: '🟥', rgb: [180, 20, 50] },
	{ name: 'Orange', emoji: '🟧', rgb: [243, 156, 18] },
	{ name: 'Gold', emoji: '🟨', rgb: [212, 175, 55] },
	{ name: 'Yellow', emoji: '🟨', rgb: [241, 196, 15] },
	{ name: 'Lime', emoji: '🟩', rgb: [120, 220, 40] },
	{ name: 'Green', emoji: '🟩', rgb: [46, 204, 113] },
	{ name: 'Dark Green', emoji: '🟩', rgb: [20, 110, 60] },
	{ name: 'Cyan', emoji: '🟦', rgb: [26, 188, 156] },
	{ name: 'Teal', emoji: '🟦', rgb: [0, 128, 128] },
	{ name: 'Blue', emoji: '🟦', rgb: [52, 152, 219] },
	{ name: 'Navy', emoji: '🟦', rgb: [44, 62, 120] },
	{ name: 'Purple', emoji: '🟪', rgb: [155, 89, 182] },
	{ name: 'Violet', emoji: '🟪', rgb: [90, 60, 150] },
	{ name: 'Indigo', emoji: '🟪', rgb: [75, 0, 130] },
	{ name: 'Magenta', emoji: '🟪', rgb: [220, 60, 180] },
	{ name: 'Pink', emoji: '🟪', rgb: [245, 150, 190] },
	{ name: 'Brown', emoji: '🟫', rgb: [139, 69, 19] },
	{ name: 'Olive', emoji: '🟫', rgb: [128, 128, 0] },
	{ name: 'Black', emoji: '⬛', rgb: [20, 20, 20] },
	{ name: 'Gray', emoji: '⬜', rgb: [128, 128, 128] },
	{ name: 'Silver', emoji: '⬜', rgb: [192, 192, 192] },
	{ name: 'White', emoji: '⬜', rgb: [255, 255, 255] },
];

function parseHexColor(hex: string): [number, number, number] | null {
	const value = hex.replace(/^#/, '').trim();
	if (!/^[0-9a-fA-F]{6}/.test(value)) {
		return null;
	}
	return [
		Number.parseInt(value.slice(0, 2), 16),
		Number.parseInt(value.slice(2, 4), 16),
		Number.parseInt(value.slice(4, 6), 16),
	];
}

function colorDistance(
	left: [number, number, number],
	right: [number, number, number],
): number {
	const redMean = (left[0] + right[0]) / 2;
	const red = left[0] - right[0];
	const green = left[1] - right[1];
	const blue = left[2] - right[2];
	return (((512 + redMean) * red * red) >> 8)
		+ 4 * green * green
		+ (((767 - redMean) * blue * blue) >> 8);
}

function nearestSwatch(hex?: string | null): ColorSwatch | null {
	if (!hex) {
		return null;
	}
	const rgb = parseHexColor(hex);
	if (!rgb) {
		return null;
	}

	let best: ColorSwatch | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const swatch of COLOR_SWATCHES) {
		const distance = colorDistance(rgb, swatch.rgb);
		if (distance < bestDistance) {
			best = swatch;
			bestDistance = distance;
		}
	}
	return best;
}

function colorName(hex?: string | null): string {
	const swatch = nearestSwatch(hex);
	return swatch?.name ?? 'Unknown';
}

function ansiSwatch(hex?: string | null, width = 4): string {
	const rgb = hex ? parseHexColor(hex) : null;
	if (!rgb) {
		return `\u001b[48;2;80;80;80m${' '.repeat(width)}\u001b[0m`;
	}
	return `\u001b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m${' '.repeat(width)}\u001b[0m`;
}

function ansiBlock(lines: string[], maxLength = 1024): string {
	const prefix = '```ansi\n';
	const suffix = '\n```';
	const available = Math.max(0, maxLength - prefix.length - suffix.length);
	let body = '';
	for (const line of lines) {
		const next = body ? `${body}\n${line}` : line;
		if (next.length > available) {
			break;
		}
		body = next;
	}
	return `${prefix}${body}${suffix}`;
}

function buildStatusEmbed(status: PrinterStatus): EmbedBuilder {
	const printer = status.printer;
	const embed = new EmbedBuilder()
		.setColor(stateColor(printer.state))
		.setTitle(`${printer.name ?? 'Bambu Lab X2D'} — ${printer.stateLabel ?? printer.state ?? 'Unknown'}`);

	const stateLines = [
		`State: **${printer.stateLabel ?? printer.state ?? 'Unknown'}**`,
		`Progress: ${typeof printer.progress === 'number' ? `${printer.progress}%` : '—'}`,
		`Remaining: ${formatMinutes(printer.remainingMinutes)}`,
	];
	if (typeof printer.layer === 'number') {
		stateLines.push(
			`Layer: ${printer.layer}${typeof printer.totalLayers === 'number' ? ` / ${printer.totalLayers}` : ''}`,
		);
	}
	if (printer.wifi) {
		stateLines.push(`Wi-Fi: ${printer.wifi}`);
	}
	if (printer.firmware) {
		stateLines.push(`Firmware: ${printer.firmware}`);
	}
	embed.addFields({ name: 'Printer', value: stateLines.join('\n').slice(0, 1024) });

	if (printer.subtask) {
		embed.addFields({
			name: 'Job',
			value: printer.subtask.slice(0, 1024),
			inline: false,
		});
	}

	const bed = status.temperatures?.bed;
	const chamber = status.temperatures?.chamber;
	const tempLines = [`Bed: ${formatTemp(bed?.current, bed?.target)}`];
	for (const nozzle of status.temperatures?.nozzles ?? []) {
		const label = `Nozzle ${nozzle.index + 1}`;
		const details = [
			nozzle.type,
			typeof nozzle.diameter === 'number' ? `${nozzle.diameter} mm` : null,
		].filter(Boolean).join(', ');
		tempLines.push(
			`${label}: ${formatTemp(nozzle.current, nozzle.target)}${details ? ` (${details})` : ''}`,
		);
	}
	if (chamber && typeof chamber.current === 'number') {
		tempLines.push(`Chamber: ${formatTemp(chamber.current, chamber.target)}`);
	}
	embed.addFields({ name: 'Temperatures', value: tempLines.join('\n').slice(0, 1024) });

	const units = status.ams?.units ?? [];
	const slots = status.ams?.slots ?? [];
	if (units.length === 0 && slots.length === 0) {
		embed.addFields({ name: 'Filament', value: 'No AMS slots are reporting.' });
	}
	else {
		const unitLines = units.map((unit) => {
			const humidity = typeof unit.humidityRaw === 'number'
				? `${unit.humidityRaw}% RH`
				: '—';
			const temp = typeof unit.temperature === 'number'
				? `${unit.temperature.toFixed(1)}°C`
				: '—';
			return `AMS ${unit.id + 1}: ${temp}, ${humidity}`;
		});
		const slotLines = slots.map((slot) => {
			const remain = typeof slot.remain === 'number' && slot.remain >= 0
				? ` (${slot.remain} g left)`
				: '';
			const active = slot.active ? ' ← active' : '';
			return `${ansiSwatch(slot.color)} ${slot.label} · ${slot.type ?? 'Unknown'} · ${colorName(slot.color)}${remain}${active}`;
		});
		let filamentValue = unitLines.join('\n');
		if (slotLines.length > 0) {
			const block = ansiBlock(
				slotLines,
				Math.max(64, 1024 - filamentValue.length - 2),
			);
			filamentValue = filamentValue ? `${filamentValue}\n\n${block}` : block;
		}
		embed.addFields({
			name: 'Filament',
			value: filamentValue.slice(0, 1024),
		});
	}

	const errors = printer.errors;
	const hms = errors?.hms ?? [];
	const errorLines: string[] = [];
	if (errors?.printError) {
		errorLines.push(`print_error: ${errors.printError}`);
	}
	if (errors?.mcError) {
		errorLines.push(`mc_err: ${errors.mcError}`);
	}
	for (const code of hms) {
		const display = code.display ?? `${code.attr}_${code.code}`;
		// Expected while Developer Mode is off and a print command was rejected.
		if (printer.developerMode === false && display === '0500_0500_0001_0007') {
			continue;
		}
		errorLines.push(`HMS ${display}`);
	}
	if (errorLines.length > 0) {
		embed.addFields({ name: 'Errors', value: errorLines.join('\n').slice(0, 1024) });
	}

	if (printer.developerMode === false) {
		embed.addFields({
			name: 'Printing disabled',
			value: 'Developer Mode is off on the printer. Enable **Settings → LAN Only → Developer Mode** to allow `/3dprint` to start jobs.',
		});
	}

	embed.setFooter({
		text: [
			printer.serial ? `Serial ${printer.serial}` : null,
			printer.ip ? `IP ${printer.ip}` : null,
			status.connection?.mqtt === false ? 'MQTT disconnected' : null,
		].filter(Boolean).join(' • ') || 'Bambu Lab X2D',
	});

	return embed;
}

function mappingComplete(session: MappingSession): boolean {
	return session.filaments.every((_, index) => session.mapping.has(index));
}

function buildMappingSessionEmbed(
	session: MappingSession,
	errorMessage?: string,
): EmbedBuilder {
	const complete = mappingComplete(session);
	const embed = new EmbedBuilder()
		.setColor(errorMessage ? 0xe74c3c : complete ? 0x2ecc71 : 0x3498db)
		.setTitle(`Map filament for ${session.subtask}`)
		.setDescription(
			`Uploaded **${session.filename}** (plate ${session.plate}). Choose a filament for every sliced material, then start the print.`,
		);

	const filamentLines = session.filaments.map((filament, index) => {
		const grams = typeof filament.grams === 'number' ? ` (${filament.grams} g)` : '';
		return `${ansiSwatch(filament.color)} ${index + 1}. ${filament.type ?? 'Filament'} · ${colorName(filament.color)}${grams}`;
	});
	embed.addFields({ name: 'Sliced filaments', value: ansiBlock(filamentLines) });

	const slotLines = session.slots.map((slot) => {
		const remain = typeof slot.remain === 'number' && slot.remain >= 0
			? ` · ${slot.remain} g left`
			: '';
		return `${ansiSwatch(slot.color)} ${slot.label} · ${slot.type ?? 'Unknown'} · ${colorName(slot.color)}${remain}`;
	});
	embed.addFields({
		name: 'Available filaments',
		value: slotLines.length > 0
			? ansiBlock(slotLines)
			: 'No AMS slots or external spool are reporting filament.',
	});

	const mappingLines = session.filaments.map((filament, index) => {
		const tray = session.mapping.get(index);
		const slot = tray === undefined
			? undefined
			: session.slots.find((candidate) => candidate.globalId === tray);
		return `${index + 1}. ${filament.type ?? 'Filament'} · ${colorName(filament.color)} → ${
			slot ? `${slot.label} · ${colorName(slot.color)}` : 'not selected'
		}`;
	});
	embed.addFields({ name: 'Mapping', value: mappingLines.join('\n').slice(0, 1024) });

	if (session.settings) {
		const settings = session.settings;
		embed.addFields({
			name: 'Options',
			value: [
				`Bed leveling: ${settings.bedLeveling ? 'yes' : 'no'}`,
				`Flow calibration: ${settings.flowCali ? 'yes' : 'no'}`,
				`Vibration calibration: ${settings.vibrationCali ? 'yes' : 'no'}`,
				`AI layer inspection: ${settings.layerInspect ? 'yes' : 'no'}`,
				`Timelapse: ${settings.timelapse ? 'yes' : 'no'}`,
			].join('\n'),
		});
	}

	if (session.capabilities?.startPrint === false) {
		embed.addFields({
			name: 'Printing disabled',
			value: 'Developer Mode is off on the printer. Enable **Settings → LAN Only → Developer Mode** before starting.',
		});
	}
	if (
		session.printerState === 'PREPARE'
		|| session.printerState === 'RUNNING'
		|| session.printerState === 'PAUSE'
		|| session.printerState === 'SLICING'
	) {
		embed.addFields({
			name: 'Printer busy',
			value: `The printer is currently **${session.printerState}**. You can map now and start after it is free.`,
		});
	}
	if (errorMessage) {
		embed.addFields({ name: 'Could not start', value: errorMessage.slice(0, 1024) });
	}

	embed.setFooter({
		text: 'This upload expires after 1 hour. Cancel discards the mapping; the file stays on the printer.',
	});
	return embed;
}

function buildMappingRows(
	session: MappingSession,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
	const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
	for (let start = 0; start < session.filaments.length; start += 5) {
		const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
		for (let index = start; index < Math.min(start + 5, session.filaments.length); index++) {
			const filament = session.filaments[index];
			const selected = session.mapping.get(index);
			const select = new StringSelectMenuBuilder()
				.setCustomId(`3dmap:${session.uploadId}:${index}`)
				.setPlaceholder(
					`Filament ${index + 1}: ${filament.type ?? 'Filament'} · ${colorName(filament.color)}`,
				)
				.addOptions(
					session.slots.slice(0, 25).map((slot) => {
						const remain = typeof slot.remain === 'number' && slot.remain >= 0
							? ` · ${slot.remain} g left`
							: '';
						const option = new StringSelectMenuOptionBuilder()
							.setLabel(
								`${slot.label} · ${slot.type ?? 'Unknown'} · ${colorName(slot.color)}`.slice(0, 100),
							)
							.setValue(String(slot.globalId))
							.setDefault(selected === slot.globalId);
						const description = `${slot.color ?? 'No color'}${remain}`.slice(0, 100);
						option.setDescription(description);
						const swatch = nearestSwatch(slot.color);
						if (swatch) {
							option.setEmoji(swatch.emoji);
						}
						return option;
					}),
				);
			row.addComponents(select);
		}
		rows.push(row);
	}

	rows.push(
		new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`3dsubmit:${session.uploadId}`)
				.setLabel('Start print')
				.setStyle(ButtonStyle.Success)
				.setDisabled(!mappingComplete(session) || session.submitting),
			new ButtonBuilder()
				.setCustomId(`3dcancel:${session.uploadId}`)
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(session.submitting),
		),
	);
	return rows;
}

function buildPrintEmbed(result: PrintResult): EmbedBuilder {
	const embed = new EmbedBuilder().setColor(result.uploaded ? 0x3498db : 0x2ecc71);
	embed.setTitle(result.uploaded ? 'File uploaded' : 'Print queued');

	const lines = [
		`File: **${result.filename ?? 'unknown'}**`,
		`Plate: ${result.plate ?? 1}`,
		`Printer: ${result.printer ?? 'Bambu Lab X2D'}`,
	];
	if (result.uploaded) {
		lines.push('The file is on the printer; start it from the touchscreen.');
	}
	else if (result.state) {
		lines.push(`Printer state: **${result.state}**`);
	}
	embed.setDescription(lines.join('\n').slice(0, 4096));

	const filaments = result.filaments ?? [];
	if (filaments.length > 0) {
		const mapping = filaments.map(
			(filament) =>
				`${ansiSwatch(filament.color)} ${filament.index}. ${filament.type ?? 'Filament'} · ${colorName(filament.color)} → ${filament.slot ?? 'unknown'}`,
		);
		embed.addFields({
			name: 'Filament mapping',
			value: ansiBlock(mapping),
		});
	}

	if (result.settings) {
		const settings = result.settings;
		const optionLines = [
			`Bed leveling: ${settings.bedLeveling ? 'yes' : 'no'}`,
			`Flow calibration: ${settings.flowCali ? 'yes' : 'no'}`,
			`Vibration calibration: ${settings.vibrationCali ? 'yes' : 'no'}`,
			`AI layer inspection: ${settings.layerInspect ? 'yes' : 'no'}`,
			`Timelapse: ${settings.timelapse ? 'yes' : 'no'}`,
		];
		embed.addFields({ name: 'Options', value: optionLines.join('\n') });
	}

	if (result.warnings && result.warnings.length > 0) {
		embed.addFields({
			name: 'Warnings',
			value: result.warnings.join('\n').slice(0, 1024),
		});
	}

	const response = result.printerResponse;
	if (response && typeof response.reason === 'string' && response.reason) {
		embed.setFooter({ text: `Printer: ${response.reason}`.slice(0, 2048) });
	}

	return embed;
}

function checkAccess(interaction: ChatInputCommandInteraction): string | null {
	if (allowedChannelIds.size > 0 && !allowedChannelIds.has(interaction.channelId)) {
		return '3D printer commands are not enabled in this channel.';
	}

	const member = interaction.member instanceof GuildMember ? interaction.member : null;
	if (!member) {
		return '3D printer commands can only be used in the server.';
	}

	if (allowedRoleIds.size > 0) {
		const allowed = member.roles.cache.some((role) => allowedRoleIds.has(role.id));
		return allowed ? null : 'You need an officer role to use the 3D printer.';
	}

	return member.permissions.has(PermissionFlagsBits.ManageGuild)
		? null
		: 'You need the Manage Server permission to use the 3D printer.';
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

type CommandResult = {
	embeds: EmbedBuilder[];
	files?: AttachmentBuilder[];
	components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
};

async function uploadPrint(
	interaction: ChatInputCommandInteraction,
): Promise<CommandResult> {
	const attachment = interaction.options.getAttachment('file', true);
	if (!isGcode3mf(attachment)) {
		throw new Error('Only pre-sliced `.gcode.3mf` files are supported.');
	}
	if (attachment.size > maxFileBytes) {
		throw new Error(
			`That file is too large (${formatBytes(attachment.size)}); the limit is ${formatBytes(maxFileBytes)}.`,
		);
	}

	const response = await fetch(attachment.url, {
		signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) {
		throw new Error(`Could not download the attachment (HTTP ${response.status}).`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > maxFileBytes) {
		throw new Error(`That file is too large; the limit is ${formatBytes(maxFileBytes)}.`);
	}

	const plate = interaction.options.getInteger('plate') ?? 1;
	const params = new URLSearchParams({
		filename: attachment.name,
		plate: String(plate),
		start: 'false',
	});
	for (const option of ['bed_leveling', 'flow_cali', 'vibration_cali', 'timelapse']) {
		const value = interaction.options.getBoolean(option);
		if (value !== null) {
			params.set(option, String(value));
		}
	}

	const result = await callAgent<PrintResult>(
		`/print?${params.toString()}`,
		{
			method: 'POST',
			headers: {
				'content-type': 'application/octet-stream',
			},
			body: bytes,
		},
		300_000,
	);
	if (!result.uploadId) {
		throw new Error('The printer agent did not return an upload id.');
	}
	if (!result.filaments || result.filaments.length === 0) {
		throw new Error('The sliced file does not declare any filaments.');
	}
	if (result.filaments.length > MAX_MAPPING_FILAMENTS) {
		throw new Error(
			`This file has ${result.filaments.length} filaments; the mapping UI supports up to ${MAX_MAPPING_FILAMENTS}.`,
		);
	}

	const slots = result.slots ?? [];
	if (slots.length === 0) {
		return {
			embeds: [
				new EmbedBuilder()
					.setColor(0xe74c3c)
					.setTitle('No filament slots reporting')
					.setDescription(
						`Uploaded **${result.filename ?? attachment.name}**, but the printer is not reporting any AMS slots or external spool. Load filament and run \`/3dprint\` again.`,
					),
			],
		};
	}

	const session: MappingSession = {
		uploadId: result.uploadId,
		userId: interaction.user.id,
		filename: result.filename ?? attachment.name,
		plate: result.plate ?? plate,
		subtask: result.subtask ?? attachment.name,
		filaments: result.filaments,
		slots,
		settings: result.settings,
		capabilities: result.capabilities,
		printerState: result.printerState,
		mapping: new Map(),
		createdAt: Date.now(),
		submitting: false,
	};
	pruneMappingSessions();
	mappingSessions.set(session.uploadId, session);

	return {
		embeds: [buildMappingSessionEmbed(session)],
		components: buildMappingRows(session),
	};
}

function mappingExpiredEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setColor(0x95a5a6)
		.setTitle('Mapping session expired')
		.setDescription('Run `/3dprint` again to upload the file and choose a new mapping.');
}

async function handleMappingSelect(
	interaction: StringSelectMenuInteraction,
): Promise<void> {
	const [, uploadId, indexRaw] = interaction.customId.split(':');
	const session = uploadId ? getMappingSession(uploadId) : undefined;
	if (!session) {
		await interaction.update({ embeds: [mappingExpiredEmbed()], components: [] });
		return;
	}
	if (session.userId !== interaction.user.id) {
		await interaction.reply({
			content: 'Only the person who uploaded this file can map it.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const index = Number(indexRaw);
	if (!Number.isInteger(index) || index < 0 || index >= session.filaments.length) {
		await interaction.reply({
			content: 'That filament is no longer part of this upload.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const value = Number(interaction.values[0]);
	const slot = session.slots.find((candidate) => candidate.globalId === value);
	if (!slot) {
		await interaction.reply({
			content: 'That filament slot is no longer available. Rerun `/3dprint` to refresh.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	session.mapping.set(index, value);
	await interaction.update({
		embeds: [buildMappingSessionEmbed(session)],
		components: buildMappingRows(session),
	});
}

async function handleMappingSubmit(interaction: ButtonInteraction): Promise<void> {
	const uploadId = interaction.customId.split(':')[1];
	const session = uploadId ? getMappingSession(uploadId) : undefined;
	if (!session) {
		await interaction.update({ embeds: [mappingExpiredEmbed()], components: [] });
		return;
	}
	if (session.userId !== interaction.user.id) {
		await interaction.reply({
			content: 'Only the person who uploaded this file can start it.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	if (!mappingComplete(session)) {
		await interaction.reply({
			content: 'Choose a filament for every sliced material first.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	if (session.submitting) {
		await interaction.reply({
			content: 'This print is already being submitted.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	session.submitting = true;
	await interaction.deferUpdate();
	try {
		const filamentMap = session.filaments.map(
			(_, index) => session.mapping.get(index) as number,
		);
		const result = await callAgent<PrintResult>(
			'/start',
			{
				method: 'POST',
				body: JSON.stringify({
					uploadId: session.uploadId,
					filament_map: filamentMap,
				}),
			},
			180_000,
		);
		mappingSessions.delete(session.uploadId);
		await interaction.editReply({
			embeds: [buildPrintEmbed(result)],
			components: [],
		});
	}
	catch (error) {
		session.submitting = false;
		if (error instanceof AgentHttpError && error.payload.needsMapping) {
			const payload = error.payload as unknown as MappingErrorDetails;
			if (Array.isArray(payload.filaments) && Array.isArray(payload.slots)) {
				session.filaments = payload.filaments.map((filament, index) => ({
					index: index + 1,
					id: filament.id,
					type: filament.type,
					color: filament.color,
					grams: filament.used_grams,
				}));
				session.slots = payload.slots;
				session.mapping.clear();
				await interaction.editReply({
					embeds: [buildMappingSessionEmbed(session, error.message)],
					components: buildMappingRows(session),
				});
				return;
			}
		}
		if (error instanceof AgentHttpError && error.status === 400) {
			mappingSessions.delete(session.uploadId);
			await interaction.editReply({
				embeds: [mappingExpiredEmbed()],
				components: [],
			});
			return;
		}
		const message = error instanceof Error ? error.message : 'Unknown error';
		await interaction.editReply({
			embeds: [buildMappingSessionEmbed(session, message)],
			components: buildMappingRows(session),
		});
	}
}

async function handleMappingCancel(interaction: ButtonInteraction): Promise<void> {
	const uploadId = interaction.customId.split(':')[1];
	const session = uploadId ? getMappingSession(uploadId) : undefined;
	if (!session) {
		await interaction.update({ embeds: [mappingExpiredEmbed()], components: [] });
		return;
	}
	if (session.userId !== interaction.user.id) {
		await interaction.reply({
			content: 'Only the person who uploaded this file can cancel it.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}
	if (uploadId) {
		mappingSessions.delete(uploadId);
	}
	await interaction.update({
		embeds: [
			new EmbedBuilder()
				.setColor(0x95a5a6)
				.setTitle('Mapping cancelled')
				.setDescription('The uploaded file stays on the printer and can still be started from the touchscreen.'),
		],
		components: [],
	});
}

async function runStatus(): Promise<{
	embeds: EmbedBuilder[];
	files?: AttachmentBuilder[];
}> {
	const status = await callAgent<PrinterStatus>('/status');
	const embed = buildStatusEmbed(status);
	const files: AttachmentBuilder[] = [];

	if (status.camera?.available) {
		const snapshot = await fetchSnapshot();
		if (snapshot) {
			files.push(
				new AttachmentBuilder(snapshot, {
					name: 'bed.jpg',
					description: 'X2D chamber camera snapshot',
				}),
			);
			embed.setImage('attachment://bed.jpg');
		}
		else {
			embed.addFields({
				name: 'Camera',
				value: 'Camera is enabled but the snapshot failed.',
			});
		}
	}

	return { embeds: [embed], files };
}

async function runCommand(interaction: ChatInputCommandInteraction): Promise<CommandResult> {
	switch (interaction.commandName) {
	case '3dprint':
		return uploadPrint(interaction);
	case '3dprint-status':
		return runStatus();
	case '3dprint-stop': {
		const result = await callAgent<{ ok: boolean }>('/stop', {
			method: 'POST',
		});
		return {
			embeds: [
				new EmbedBuilder()
					.setColor(0xe74c3c)
					.setTitle('Print stopped')
					.setDescription(result.ok ? 'The current print was stopped.' : 'The printer did not confirm the stop.'),
			],
		};
	}
	default:
		throw new Error(`Unsupported command: ${interaction.commandName}`);
	}
}

export const print3dModule: DiscordModule = {
	name: MODULE_NAME,
	commands: commandBuilders.map((command) => command.toJSON()),
	start(client: Client) {
		const url = process.env.BAMBU_AGENT_URL;
		if (!url) {
			return {
				enabled: false,
				missingRequirements: ['BAMBU_AGENT_URL'],
			};
		}

		agentUrl = url.replace(/\/+$/, '');
		agentToken = process.env.BAMBU_AGENT_TOKEN?.trim() || undefined;
		guildId = process.env.GUILD_ID;
		allowedRoleIds = parseIdSet(process.env.BAMBU_ALLOWED_ROLE_IDS);
		allowedChannelIds = parseIdSet(process.env.BAMBU_ALLOWED_CHANNEL_IDS);

		const configuredCooldown = Number(
			process.env.BAMBU_COOLDOWN_SECONDS ?? DEFAULT_COOLDOWN_SECONDS,
		);
		cooldownSeconds = Number.isFinite(configuredCooldown) && configuredCooldown >= 0
			? configuredCooldown
			: DEFAULT_COOLDOWN_SECONDS;

		const configuredMaxMb = Number(
			process.env.BAMBU_MAX_FILE_MB ?? DEFAULT_MAX_FILE_MB,
		);
		maxFileBytes = Number.isFinite(configuredMaxMb) && configuredMaxMb > 0
			? Math.floor(configuredMaxMb * 1024 * 1024)
			: DEFAULT_MAX_FILE_MB * 1024 * 1024;

		notifyChannelId = process.env.BAMBU_NOTIFY_CHANNEL_ID?.trim() || undefined;
		const configuredPoll = Number(
			process.env.BAMBU_NOTIFY_POLL_SECONDS ?? DEFAULT_NOTIFY_POLL_SECONDS,
		);
		notifyPollSeconds = Number.isFinite(configuredPoll) && configuredPoll >= 5
			? configuredPoll
			: DEFAULT_NOTIFY_POLL_SECONDS;

		let notifyTimer: ReturnType<typeof setInterval> | undefined;
		if (notifyChannelId) {
			const channelId = notifyChannelId;
			const poll = () => {
				void pollPrintNotifications(client, channelId);
			};
			notifyTimer = setInterval(poll, notifyPollSeconds * 1000);
			void poll();
			console.log(
				`${MODULE_NAME}: print notifications -> channel ${channelId} every ${notifyPollSeconds}s`,
			);
		}
		else {
			console.log(
				`${MODULE_NAME}: print notifications disabled (missing BAMBU_NOTIFY_CHANNEL_ID)`,
			);
		}

		const onInteraction = async (interaction: Interaction) => {
			if (
				interaction.isStringSelectMenu()
				&& interaction.customId.startsWith('3dmap:')
			) {
				await handleMappingSelect(interaction);
				return;
			}
			if (
				interaction.isButton()
				&& interaction.customId.startsWith('3dsubmit:')
			) {
				await handleMappingSubmit(interaction);
				return;
			}
			if (
				interaction.isButton()
				&& interaction.customId.startsWith('3dcancel:')
			) {
				await handleMappingCancel(interaction);
				return;
			}
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

			if (interaction.commandName === '3dprint') {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			}
			else {
				await interaction.deferReply();
			}
			try {
				const result = await runCommand(interaction);
				await interaction.editReply({
					embeds: result.embeds,
					files: result.files,
					components: result.components,
				});
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
			if (notifyTimer) {
				clearInterval(notifyTimer);
			}
			client.removeListener(Events.InteractionCreate, onInteraction);
			lastCommandAt.clear();
			mappingSessions.clear();
		};

		return { enabled: true };
	},
};
