import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

export const HealthGroup = HttpApiGroup.make('health').add(
	HttpApiEndpoint.get('getHealth', '/health'),
);
