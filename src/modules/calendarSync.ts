import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

export const CalendarSyncGroup = HttpApiGroup.make('calendarSync').add(
	HttpApiEndpoint.post('triggerSync', '/calendar/sync'),
);
