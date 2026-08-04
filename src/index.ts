import * as http from 'node:http';
import { NodeHttpClient, NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { DiscordConfig, DiscordRESTLive, MemoryRateLimitStoreLive } from 'dfx';
import { Config, ConfigProvider, Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiSwagger } from 'effect/unstable/httpapi';
import { HttpRouter } from 'effect/unstable/http';
import { CalendarSyncGroup, CalendarSyncLive, CalendarTriggerLive, buildHandlers as buildCalendarHandlers } from './modules/calendarSync.ts';
import { HealthGroup, buildHandlers as buildHealthHandlers } from './modules/health.ts';
import { MemberManagementGroup, buildHandlers as buildMemberHandlers } from './modules/memberManagement.ts';

const api = HttpApi.make('IEEE TAMU Discord Bot API')
	.add(HealthGroup)
	.add(MemberManagementGroup)
	.add(CalendarSyncGroup);

const DiscordLayer = DiscordRESTLive.pipe(
	Layer.provide(DiscordConfig.layerConfig({ token: Config.redacted('DISCORD_BOT_TOKEN') })),
	Layer.provide(NodeHttpClient.layerUndici),
	Layer.provide(MemoryRateLimitStoreLive),
);

const routerLayer = HttpApiBuilder.layer(api, { openapiPath: '/openapi.json' }).pipe(
	Layer.provide(HttpApiBuilder.group(api, 'health', buildHealthHandlers)),
	Layer.provide(HttpApiBuilder.group(api, 'memberManagement', buildMemberHandlers)),
	Layer.provide(HttpApiBuilder.group(api, 'calendarSync', buildCalendarHandlers)),
);

const appLayer = routerLayer.pipe(Layer.provide(HttpApiSwagger.layer(api)));

const serverLayer = HttpRouter.serve(appLayer).pipe(
	Layer.provide(NodeHttpServer.layerConfig(() => http.createServer(), {
		port: Config.number('API_PORT').pipe(Config.withDefault(3000)),
		host: Config.string('LISTEN_ADDR').pipe(Config.withDefault('0.0.0.0')),
	})),
);

const CalendarLive = CalendarSyncLive.pipe(
	Layer.provide(CalendarTriggerLive.pipe(Layer.provide(DiscordLayer))),
);

const MainLive = serverLayer.pipe(
	Layer.provide(DiscordLayer),
	Layer.provide(CalendarLive),
	Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
);

NodeRuntime.runMain(
	Effect.gen(function* () {
		yield* Layer.launch(MainLive);
	}).pipe(
		Effect.provide(MainLive),
		Effect.catch((err: unknown) => Effect.logError('Fatal error', err)),
	) as Effect.Effect<never>,
);
