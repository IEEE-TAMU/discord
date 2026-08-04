import { Effect, Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
import { HttpServerResponse } from 'effect/unstable/http';

const HealthResponse = Schema.Struct({
	status: Schema.String,
	timestamp: Schema.String,
});

const toJson = HttpServerResponse.schemaJson(HealthResponse);

export const HealthGroup = HttpApiGroup.make('health').add(
	HttpApiEndpoint.get('getHealth', '/health', { success: HealthResponse }),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers type is inferred by HttpApiBuilder.group
export function buildHealthHandlers(handlers: any) {
	return handlers.handle('getHealth',
		() => Effect.succeed(toJson({ status: 'ok', timestamp: new Date().toISOString() })),
	);
}
