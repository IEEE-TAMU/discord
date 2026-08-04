import { Effect } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
import { HttpServerResponse } from 'effect/unstable/http';

export const HealthGroup = HttpApiGroup.make('health').add(
	HttpApiEndpoint.get('getHealth', '/health'),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers type is inferred by HttpApiBuilder.group
export function buildHealthHandlers(handlers: any) {
	return handlers.handle('getHealth',
		() => Effect.succeed(HttpServerResponse.jsonUnsafe({ status: 'ok', timestamp: new Date().toISOString() })),
	);
}
