import { Client } from 'discord.js';
import type { Express } from 'express';

export type ModuleStatus = {
	enabled: boolean;
	missingRequirements?: string[];
};

export type DiscordModule = {
	name: string;
	start(client: Client, app?: Express): ModuleStatus;
	stop?(): void;
};

export * from './calendarSync';
export * from './groupme';
export * from './health';
export * from './memberManagement';
