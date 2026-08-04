import { DiscordREST } from 'dfx';
import { Context, Duration, Effect, Layer, Schedule, Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
import { HttpServerResponse } from 'effect/unstable/http';
import { AppConfig } from '../config.ts';

type ScheduledEvent = Readonly<{ id: string; name: string; description: string | null }>;

const SyncResponse = Schema.Struct({
	success: Schema.Boolean,
	message: Schema.String,
});

const toJson = HttpServerResponse.schemaJson(SyncResponse);

export class CalendarTrigger extends Context.Service<CalendarTrigger, {
	readonly trigger: Effect.Effect<void, never, AppConfig>;
}>()('CalendarTrigger') {}

export const CalendarTriggerLive = Layer.effect(
	CalendarTrigger,
	Effect.gen(function* () {
		const rest = yield* DiscordREST;

		const doSync = Effect.gen(function* () {
			const cfg = yield* AppConfig;

			if (!cfg.calendarIcsUrl || !cfg.guildId) {
				yield* Effect.logInfo('calendarSync: disabled (missing config)');
				return;
			}

			const { default: ical } = yield* Effect.tryPromise(() => import('node-ical'));

			const parsed = yield* Effect.tryPromise(() => ical.async.fromURL(cfg.calendarIcsUrl));

			const calendarEvents = Object.values(parsed)
				.filter((e) => e !== undefined)
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- node-ical types don't have VEvent-specific fields
				.filter((e: any) => e.type === 'VEVENT' && !!e.start && !e.rrule)
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- node-ical types don't have VEvent-specific fields
				.map((e: any) => ({
					key: String(e.uid || `${e.summary}-${e.start?.toISOString()}`),
					name: String(e.summary || 'Untitled Event'),
					description: `${e.description ?? ''}\n\n||icsId:${String(e.uid || `${e.summary}-${e.start?.toISOString()}`)}||`,
					location: String(e.location || 'External'),
					start: new Date(e.start),
					end: e.end ? new Date(e.end) : new Date(e.start.getTime() + 60 * 60 * 1000),
				}))
				.filter((e) => e.start.getTime() > Date.now());

			const existing = yield* rest.listGuildScheduledEvents(cfg.guildId).pipe(
				Effect.catch(() => Effect.succeed([] as ReadonlyArray<ScheduledEvent>)),
			);

			yield* Effect.logInfo(`calendarSync: ${calendarEvents.length} upcoming, ${existing.length} existing`);

			const descIndex = new Map<string, ScheduledEvent>();
			for (const ev of existing) {
				const match = (ev.description ?? '').match(/\|\|icsId:([^|]+)\|\|/i);
				if (match?.[1]) {
					descIndex.set(match[1], ev);
				}
			}

			for (const ce of calendarEvents) {
				const existingEntry = descIndex.get(ce.key);

				if (!existingEntry) {
					yield* Effect.logInfo(`calendarSync: creating event: ${ce.name}`);
					yield* rest.createGuildScheduledEvent(cfg.guildId, {
						name: ce.name,
						description: ce.description,
						scheduled_start_time: ce.start.toISOString(),
						scheduled_end_time: ce.end.toISOString(),
						privacy_level: 2 as const,
						entity_type: 3 as const,
						entity_metadata: { location: ce.location },
					}).pipe(Effect.catch(() => Effect.void));
				}
				else {
					const needsUpdate = existingEntry.name !== ce.name || (existingEntry.description ?? '') !== ce.description;
					if (needsUpdate) {
						yield* Effect.logInfo(`calendarSync: updating event: ${ce.name}`);
						yield* rest.updateGuildScheduledEvent(cfg.guildId, existingEntry.id, {
							name: ce.name,
							description: ce.description,
							scheduled_start_time: ce.start.toISOString(),
							scheduled_end_time: ce.end.toISOString(),
							entity_metadata: { location: ce.location },
						}).pipe(Effect.catch(() => Effect.void));
					}
				}
			}

			const knownKeys = new Set(calendarEvents.map((e) => e.key));
			for (const [key, entry] of descIndex) {
				if (!knownKeys.has(key)) {
					yield* Effect.logInfo(`calendarSync: deleting event: ${entry.name}`);
					yield* rest.deleteGuildScheduledEvent(cfg.guildId, entry.id).pipe(Effect.catch(() => Effect.void));
				}
			}

			yield* Effect.logInfo(`calendarSync: sync complete (${calendarEvents.length} events)`);
		});

		return {
			trigger: doSync.pipe(Effect.catch((err) => Effect.logError('calendarSync: sync error', err))),
		};
	}),
);

export const CalendarSyncLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const trigger = yield* CalendarTrigger;
		const config = yield* AppConfig;

		if (!config.calendarIcsUrl || !config.guildId) {
			yield* Effect.logInfo('calendarSync: disabled (missing CALENDAR_ICS_URL or GUILD_ID)');
			return;
		}

		yield* trigger.trigger;

		yield* Effect.forkDetach(
			trigger.trigger.pipe(
				Effect.repeat(Schedule.fixed(Duration.minutes(config.calendarSyncIntervalMinutes))),
			),
		);
	}),
);

export const CalendarSyncGroup = HttpApiGroup.make('calendarSync').add(
	HttpApiEndpoint.post('triggerSync', '/calendar/sync', { success: SyncResponse }),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers type is inferred by HttpApiBuilder.group
export function buildCalendarSyncHandlers(handlers: any) {
	return Effect.gen(function* () {
		const trigger = yield* CalendarTrigger;
		return handlers.handle('triggerSync', () =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				if (!config.calendarIcsUrl || !config.guildId) {
					return toJson({ success: false, message: 'Calendar sync not configured' }, { status: 404 });
				}
				yield* trigger.trigger;
				return toJson({ success: true, message: 'Sync triggered' });
			}).pipe(
				Effect.catch(() =>
					Effect.succeed(toJson({ success: false, message: 'Sync failed' }, { status: 500 })),
				),
			),
		);
	});
}
