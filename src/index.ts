import * as http from 'node:http';
import { NodeFileSystem, NodeHttpClient, NodeHttpServer, NodePath, NodeRuntime } from '@effect/platform-node';
import { DiscordConfig, DiscordRESTLive, MemoryRateLimitStoreLive } from 'dfx';
import { Config, Effect, Layer } from 'effect';
import { HttpApi, HttpApiBuilder, HttpApiSwagger } from 'effect/unstable/httpapi';
import { HttpRouter } from 'effect/unstable/http';
import { AppConfigLive } from './config.ts';
import {
	CalendarSyncGroup,
	CalendarSyncLive,
	CalendarTriggerLive,
	buildCalendarSyncHandlers,
} from './modules/calendarSync.ts';
import { HealthGroup, buildHealthHandlers } from './modules/health.ts';
import { MemberManagementGroup, buildMemberManagementHandlers } from './modules/memberManagement.ts';

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
	Layer.provide(HttpApiBuilder.group(api, 'memberManagement', buildMemberManagementHandlers)),
	Layer.provide(HttpApiBuilder.group(api, 'calendarSync', buildCalendarSyncHandlers)),
);

const appLayer = routerLayer.pipe(Layer.provide(HttpApiSwagger.layer(api)));

const serverLayer = HttpRouter.serve(appLayer).pipe(
	Layer.provide(NodeHttpServer.layerConfig(() => http.createServer(), {
		port: Config.number('API_PORT').pipe(Config.withDefault(3000)),
		host: Config.string('LISTEN_ADDR').pipe(Config.withDefault('0.0.0.0')),
	})),
);

const MainLive = serverLayer.pipe(
	Layer.provide(DiscordLayer),
	Layer.provide(AppConfigLive),
	Layer.provide(CalendarTriggerLive),
	Layer.provide(CalendarSyncLive),
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
