import { Config, Context, Effect, Layer } from 'effect';

export class AppConfig extends Context.Service<AppConfig, {
	readonly port: number;
	readonly host: string;
	readonly guildId: string;
	readonly calendarIcsUrl: string;
	readonly calendarSyncIntervalMinutes: number;
}>()('AppConfig') {}

export const AppConfigLive = Layer.effect(
	AppConfig,
	Effect.gen(function* () {
		const port = yield* Config.number('API_PORT').pipe(Config.withDefault(3000));
		const host = yield* Config.string('LISTEN_ADDR').pipe(Config.withDefault('0.0.0.0'));
		const guildId = yield* Config.string('GUILD_ID').pipe(Config.withDefault(''));
		const calendarIcsUrl = yield* Config.string('CALENDAR_ICS_URL').pipe(Config.withDefault(''));
		const calendarSyncInterval = yield* Config.int('CALENDAR_SYNC_INTERVAL_MINUTES').pipe(Config.withDefault(10));
		return { port, host, guildId, calendarIcsUrl, calendarSyncIntervalMinutes: calendarSyncInterval };
	}),
);
