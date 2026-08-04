import { Client } from 'discord.js';
import type { Express } from 'express';

export type ModuleStatus = {
	enabled: boolean;
	missingRequirements?: string[];
};

export type OpenApiFragment = {
	paths: Record<string, unknown>;
	components?: {
		schemas?: Record<string, unknown>;
		[key: string]: unknown;
	};
};

export type DiscordModule = {
	name: string;
	start(client: Client, app?: Express): ModuleStatus;
	stop?(): void;
	openapi?: OpenApiFragment;
};

export * from './calendarSync';
export * from './health';
export * from './memberManagement';
