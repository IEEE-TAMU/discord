import type { Attachment } from 'discord.js';
import {
	AttachmentBuilder,
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

const MODULE_NAME = 'print3d';
const DEFAULT_COOLDOWN_SECONDS = 10;
const DEFAULT_MAX_FILE_MB = 25;
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
		.addStringOption((option) =>
			option
				.setName('filament_map')
				.setDescription('AMS slot per filament, e.g. 1 or 1,3; leave blank to auto-match')
				.setMaxLength(64)
				.setRequired(false),
		)
		.addBooleanOption((option) =>
			option
				.setName('start')
				.setDescription('Start the print after uploading (default true)')
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

type PrintResult = {
	ok: boolean;
	dryRun?: boolean;
	uploaded?: boolean;
	started?: boolean;
	filename?: string;
	plate?: number;
	subtask?: string;
	printer?: string;
	filaments?: Array<{
		index: number;
		type?: string | null;
		color?: string | null;
		grams?: number | null;
		slot?: string | null;
		globalTray?: number | null;
	}>;
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

type MappingErrorPayload = {
	ok: false;
	error: string;
	needsMapping?: boolean;
	filaments?: Array<{
		id?: number;
		type?: string | null;
		color?: string | null;
		used_grams?: number | null;
	}>;
	slots?: Slot[];
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

function slotLabel(slot: Slot): string {
	const parts = [slot.label];
	if (slot.type) {
		parts.push(slot.type);
	}
	if (slot.color) {
		parts.push(slot.color);
	}
	return parts.join(' · ');
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
			return `${slotLabel(slot)}${remain}${active}`;
		});
		embed.addFields({
			name: 'Filament',
			value: [...unitLines, '', ...slotLines].join('\n').slice(0, 1024),
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

function buildMappingEmbed(payload: MappingErrorPayload): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setColor(0xf39c12)
		.setTitle('Filament mapping required')
		.setDescription(payload.error);

	const filaments = payload.filaments ?? [];
	if (filaments.length > 0) {
		const lines = filaments.map((filament, index) => {
			const color = filament.color ? ` ${filament.color}` : '';
			const grams = typeof filament.used_grams === 'number'
				? ` (${filament.used_grams} g)`
				: '';
			return `${index + 1}. ${filament.type ?? 'Filament'}${color}${grams}`;
		});
		embed.addFields({
			name: 'Sliced filaments',
			value: lines.join('\n').slice(0, 1024),
		});
	}

	const slots = payload.slots ?? [];
	if (slots.length > 0) {
		const lines = slots.map((slot, index) => `${index + 1}. ${slotLabel(slot)}`);
		embed.addFields({
			name: 'Available slots',
			value: lines.join('\n').slice(0, 1024),
		});
	}

	embed.addFields({
		name: 'How to continue',
		value: 'Rerun `/3dprint` with `filament_map` set to the slot number for each sliced filament, for example `1` or `1,3`. Use `ext` for the external spool.',
	});

	return embed;
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
		const mapping = filaments.map((filament) => {
			const color = filament.color ? ` ${filament.color}` : '';
			return `${filament.index}. ${filament.type ?? 'Filament'}${color} → ${filament.slot ?? 'unknown'}`;
		});
		embed.addFields({
			name: 'Filament mapping',
			value: mapping.join('\n').slice(0, 1024),
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

async function runPrint(
	interaction: ChatInputCommandInteraction,
): Promise<{ embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }> {
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

	const params = new URLSearchParams({
		filename: attachment.name,
		plate: String(interaction.options.getInteger('plate') ?? 1),
	});
	const filamentMap = interaction.options.getString('filament_map')?.trim();
	if (filamentMap) {
		params.set('filament_map', filamentMap);
	}
	const bedLeveling = interaction.options.getBoolean('bed_leveling');
	const flowCali = interaction.options.getBoolean('flow_cali');
	const vibrationCali = interaction.options.getBoolean('vibration_cali');
	const timelapse = interaction.options.getBoolean('timelapse');
	const start = interaction.options.getBoolean('start') ?? true;
	if (bedLeveling !== null) {
		params.set('bed_leveling', String(bedLeveling));
	}
	if (flowCali !== null) {
		params.set('flow_cali', String(flowCali));
	}
	if (vibrationCali !== null) {
		params.set('vibration_cali', String(vibrationCali));
	}
	if (timelapse !== null) {
		params.set('timelapse', String(timelapse));
	}
	if (!start) {
		params.set('start', 'false');
	}

	try {
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
		return { embeds: [buildPrintEmbed(result)] };
	}
	catch (error) {
		if (error instanceof AgentHttpError && error.payload.needsMapping) {
			return {
				embeds: [buildMappingEmbed(error.payload as unknown as MappingErrorPayload)],
			};
		}
		throw error;
	}
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

async function runCommand(interaction: ChatInputCommandInteraction): Promise<{
	embeds: EmbedBuilder[];
	files?: AttachmentBuilder[];
}> {
	switch (interaction.commandName) {
	case '3dprint':
		return runPrint(interaction);
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
				const result = await runCommand(interaction);
				await interaction.editReply({
					embeds: result.embeds,
					files: result.files,
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
			client.removeListener(Events.InteractionCreate, onInteraction);
			lastCommandAt.clear();
		};

		return { enabled: true };
	},
};
