import { Client } from 'discord.js';
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { Express } from 'express';

export type ModuleStatus = {
	enabled: boolean;
	missingRequirements?: string[];
};

export type DiscordModule = {
	name: string;
	commands?: RESTPostAPIChatInputApplicationCommandsJSONBody[];
	start(client: Client, app?: Express): ModuleStatus;
	stop?(): void;
};

export * from './calendarSync';
export * from './health';
export * from './memberManagement';
export * from './music';
export * from './notify';
export * from './print';
