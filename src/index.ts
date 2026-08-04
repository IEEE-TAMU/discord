import * as http from 'node:http';
import { NodeFileSystem, NodeHttpClient, NodeHttpServer, NodePath, NodeRuntime } from '@effect/platform-node';
import { DiscordConfig, DiscordREST, DiscordRESTLive, MemoryRateLimitStoreLive } from 'dfx';
import { Config, Context, Duration, Effect, Layer, Option, Schedule } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiSwagger } from 'effect/unstable/httpapi';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';
import { AppConfig, AppConfigLive } from './config.ts';
import { CalendarSyncGroup } from './modules/calendarSync.ts';
import { HealthGroup } from './modules/health.ts';
import { MemberManagementGroup } from './modules/memberManagement.ts';

type RoleRecord = Readonly<{ id: string; name: string; color: number }>;
type ScheduledEvent = Readonly<{ id: string; name: string; description: string | null }>;

const api = HttpApi.make('IEEE TAMU Discord Bot API')
	.add(HealthGroup)
	.add(MemberManagementGroup)
	.add(CalendarSyncGroup);

const DiscordLayer = DiscordRESTLive.pipe(
	Layer.provide(DiscordConfig.layerConfig({ token: Config.redacted('DISCORD_BOT_TOKEN') })),
	Layer.provide(NodeHttpClient.layerUndici),
	Layer.provide(MemoryRateLimitStoreLive),
);

const healthLayer = HttpApiBuilder.group(api, 'health', (handlers) =>
	handlers.handle('getHealth',
		() => Effect.succeed(HttpServerResponse.jsonUnsafe({ status: 'ok', timestamp: new Date().toISOString() })),
	),
);

const memberManagementLayer = HttpApiBuilder.group(api, 'memberManagement', (handlers) =>
	Effect.gen(function* () {
		const rest = yield* DiscordREST;

		return handlers
			.handle('getRoles', ({ query }: { query: { userId: string } }) =>
				Effect.gen(function* () {
					const config = yield* AppConfig;
					if (!config.guildId) {
						return HttpServerResponse.jsonUnsafe(
							{ success: false, message: 'GUILD_ID not configured' },
							{ status: 400 },
						);
					}

					const maybeMember = yield* rest.getGuildMember(config.guildId, query.userId).pipe(
						Effect.map(Option.some),
						Effect.catch(() => Effect.succeed(Option.none())),
					);

					if (Option.isNone(maybeMember)) {
						return HttpServerResponse.jsonUnsafe(
							{ success: false, message: 'User not found in guild', userId: query.userId },
							{ status: 404 },
						);
					}

					const member = maybeMember.value;
					const roleIds: readonly string[] = member.roles ?? [];

					const allRoles = yield* rest.listGuildRoles(config.guildId).pipe(
						Effect.catch(() => Effect.succeed([] as ReadonlyArray<RoleRecord>)),
					);

					const userRoles = allRoles
						.filter((r) => roleIds.includes(r.id) && r.name !== '@everyone')
						.map((r) => ({
							id: r.id,
							name: r.name,
							color: `#${r.color.toString(16).padStart(6, '0')}`,
						}));

					return HttpServerResponse.jsonUnsafe({
						success: true,
						userId: query.userId,
						username: member.user?.username ?? query.userId,
						displayName: member.nick ?? member.user?.username ?? query.userId,
						roles: userRoles,
					});
				}),
			)
			.handle('addRole', ({ payload }: { payload: { userId: string; roleName: string } }) =>
				manageRole(payload.userId, payload.roleName, 'add'),
			)
			.handle('removeRole', ({ payload }: { payload: { userId: string; roleName: string } }) =>
				manageRole(payload.userId, payload.roleName, 'remove'),
			);
	}),
);

function manageRole(
	userId: string,
	roleName: string,
	action: 'add' | 'remove',
) {
	return Effect.gen(function* () {
		const rest = yield* DiscordREST;
		const config = yield* AppConfig;
		if (!config.guildId) {
			return HttpServerResponse.jsonUnsafe(
				{ success: false, message: 'GUILD_ID not configured' },
				{ status: 400 },
			);
		}

		const roles = yield* rest.listGuildRoles(config.guildId).pipe(
			Effect.catch(() => Effect.succeed([] as ReadonlyArray<RoleRecord>)),
		);

		const role = roles.find((r: RoleRecord) => r.name.toLowerCase() === roleName.toLowerCase());
		if (!role) {
			return HttpServerResponse.jsonUnsafe(
				{ success: false, message: `Role '${roleName}' not found in guild`, userId },
				{ status: 404 },
			);
		}

		if (action === 'add') {
			yield* rest.addGuildMemberRole(config.guildId, userId, role.id).pipe(
				Effect.catch(() => Effect.void),
			);
			return HttpServerResponse.jsonUnsafe({
				success: true,
				message: `Successfully added ${roleName} role`,
				userId,
				roleName,
			});
		}

		yield* rest.deleteGuildMemberRole(config.guildId, userId, role.id).pipe(
			Effect.catch(() => Effect.void),
		);
		return HttpServerResponse.jsonUnsafe({
			success: true,
			message: `Successfully removed ${roleName} role`,
			userId,
			roleName,
		});
	});
}

class CalendarTrigger extends Context.Service<CalendarTrigger, {
	readonly trigger: Effect.Effect<void, never, AppConfig>;
}>()('CalendarTrigger') {}

const calendarLayerLive = Layer.effect(
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
					end: e.end
						? new Date(e.end)
						: new Date(e.start.getTime() + 60 * 60 * 1000),
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
					const needsUpdate = existingEntry.name !== ce.name
						|| (existingEntry.description ?? '') !== ce.description;
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
					yield* rest.deleteGuildScheduledEvent(cfg.guildId, entry.id).pipe(
						Effect.catch(() => Effect.void),
					);
				}
			}

			yield* Effect.logInfo(`calendarSync: sync complete (${calendarEvents.length} events)`);
		});

		return {
			trigger: doSync.pipe(
				Effect.catch((err) => Effect.logError('calendarSync: sync error', err)),
			),
		};
	}),
);

const calendarSyncLive = Layer.effectDiscard(
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

const calendarGroupLayer = HttpApiBuilder.group(api, 'calendarSync', (handlers) =>
	Effect.gen(function* () {
		const trigger = yield* CalendarTrigger;
		return handlers.handle('triggerSync', () =>
			Effect.gen(function* () {
				const config = yield* AppConfig;
				if (!config.calendarIcsUrl || !config.guildId) {
					return HttpServerResponse.jsonUnsafe(
						{ success: false, message: 'Calendar sync not configured' },
						{ status: 404 },
					);
				}
				yield* trigger.trigger;
				return HttpServerResponse.jsonUnsafe({ success: true, message: 'Sync triggered' });
			}).pipe(
				Effect.catch(() =>
					Effect.succeed(HttpServerResponse.jsonUnsafe(
						{ success: false, message: 'Sync failed' },
						{ status: 500 },
					)),
				),
			),
		);
	}),
);

const routerLayer = HttpApiBuilder.layer(api, { openapiPath: '/openapi.json' }).pipe(
	Layer.provide(healthLayer),
	Layer.provide(memberManagementLayer),
	Layer.provide(calendarGroupLayer),
);

const swaggerLayer = HttpApiSwagger.layer(api);

const appLayer = routerLayer.pipe(Layer.provide(swaggerLayer));

const serverLayer = HttpRouter.serve(appLayer).pipe(
	Layer.provide(NodeHttpServer.layerConfig(() => http.createServer(), {
		port: Config.number('API_PORT').pipe(Config.withDefault(3000)),
		host: Config.string('LISTEN_ADDR').pipe(Config.withDefault('0.0.0.0')),
	})),
);

const MainLive = serverLayer.pipe(
	Layer.provide(DiscordLayer),
	Layer.provide(AppConfigLive),
	Layer.provide(calendarLayerLive),
	Layer.provide(calendarSyncLive),
	Layer.provide(NodeFileSystem.layer),
	Layer.provide(NodePath.layer),
);

NodeRuntime.runMain(
	Effect.gen(function* () {
		yield* Layer.launch(MainLive);
	}).pipe(
		Effect.provide(MainLive),
		Effect.catch((err: unknown) => Effect.logError('Fatal error', err)),
	) as Effect.Effect<never>,
);
