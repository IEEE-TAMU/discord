import { Client, GuildScheduledEvent, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel } from 'discord.js';
import ical, { ParameterValue } from 'node-ical';

function unwrapString(val: string | ParameterValue | undefined): string | undefined {
	if (val === undefined) return undefined;
	if (typeof val === 'string') return val;
	return val.val;
}

// the meaningful parts extracted from an iCal entry
type CalendarEvent = {
	// UID for single events;
	key: string;
	name: string;
	description: string;
	location: string;
	start: Date;
	end?: Date;
};

function buildDescription(base: string | undefined, key: string, rsvpUrl?: string): string {
	const lines: string[] = [];
	if (rsvpUrl) lines.push(`[RSVP Here](${rsvpUrl})`);
	if (base) lines.push(base);
	// lines.push('Imported from calendar. Changes here may be overwritten.');
	// correlate the event with its source calendar entry (mark as spoiler to avoid display)
	lines.push(`||icsId:${key}||`);
	return lines.filter(Boolean).join('\n\n');
}

// extracts the unique key used to correlate calendar events with Discord scheduled events
function getKey(event: GuildScheduledEvent): string | null {
	const desc = event.description || '';
	const match = desc.match(/\|\|icsId:(.+)\|\|/i);
	if (match) {
		return match[1] || null;
	}
	return null;
}

function toCalendarEvent(event: ical.CalendarComponent): CalendarEvent | null {
	if (event.type !== 'VEVENT' || !event.start) return null;
	const uid = unwrapString(event.uid) || `${unwrapString(event.summary)}-${event.start?.toISOString()}`;
	const name = unwrapString(event.summary) || 'Untitled Event';
	const location = unwrapString(event.location) || 'External';
	const rsvpUrl = unwrapString((event as Record<string, string | ParameterValue>)['RSVP-URL']);

	if (event.rrule) {
		console.log(`Skipping recurring event in toCalendarEvent: ${name}`);
		return null;
	}

	const key = `${uid}`;
	const description = buildDescription(unwrapString(event.description), key, rsvpUrl);
	const start = event.start;
	let end = event.end;

	// external events must have an end time and cannot be the same as start
	if (!end || start.getTime() === end.getTime()) {
		// default to 1 hour
		const endTime = new Date(start.getTime() + 60 * 60 * 1000);
		end = Object.assign(endTime, { tz: start['tz'] });
	}
	return { key, name, description, location, start, end };
}

function needsUpdate(current: GuildScheduledEvent, target: CalendarEvent) {
	const startChanged = current.scheduledStartAt?.getTime() !== target.start.getTime();
	const endChanged = (current.scheduledEndAt?.getTime() || 0) !== (target.end?.getTime() || 0);
	const nameChanged = current.name !== target.name;
	const descChanged = (current.description || '') !== (target.description || '');
	const locChanged = (current.entityMetadata?.location || 'External') !== (target.location || 'External');
	return startChanged || endChanged || nameChanged || descChanged || locChanged;
}

export function startCalendarSync(client: Client) {
	const ICS_URL = process.env.CALENDAR_ICS_URL;
	const GUILD_ID = process.env.GUILD_ID;
	const intervalMinutes = Number(process.env.CALENDAR_SYNC_INTERVAL_MINUTES || 10);

	let inProgress = false;
	let stopped = false;

	if (!ICS_URL || !GUILD_ID) {
		console.warn('Calendar sync disabled: set CALENDAR_ICS_URL and GUILD_ID.');
		// no-op when not configured
		return {
			stop: () => {
				stopped = true;
				return;
			},
		};
	}

	// make a module-scoped trigger available to API callers
	trigger = async () => {
		await runOnce();
	};

	async function runOnce() {
		if (inProgress || stopped) return;
		inProgress = true;
		try {
			const guildId = GUILD_ID as string;
			const icsUrl = ICS_URL as string;
			const guild = await client.guilds.fetch(guildId);
			const parsed = await ical.async.fromURL(icsUrl);
			const calendar_events = Object.values(parsed)
				.map(toCalendarEvent)
				.filter((e) => e !== null);

			// Fetch current scheduled events
			const existing = await guild.scheduledEvents.fetch();

			// Index existing by extracted key
			const descIndex = new Map(
				existing
					.mapValues((e) => ({ key: getKey(e), ev: e }))
					.filter((o): o is typeof o & { key: Exclude<typeof o.key, null> } => o.key !== null)
					.map(({ key, ev }) => [key, ev]),
			);

			console.log(`Fetched ${existing.size} existing events, ${descIndex.size} matched by description.`);
			console.log(`Calendar has ${calendar_events.length} events in the sync window.`);

			// Create or update
			for (const calendar_event of calendar_events) {
				if (calendar_event.start.getTime() < Date.now()) {
					console.log(`Skipping past-start event: ${calendar_event.name} at ${calendar_event.start.toISOString()}`);
					continue;
				}

				const discord_event = descIndex.get(calendar_event.key);

				if (!discord_event) {
					console.log(`Creating event: ${calendar_event.name}`);
					try {
						const created = await guild.scheduledEvents.create({
							name: calendar_event.name,
							description: calendar_event.description,
							scheduledStartTime: calendar_event.start,
							scheduledEndTime: calendar_event.end,
							privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
							entityType: GuildScheduledEventEntityType.External,
							entityMetadata: { location: calendar_event.location || 'External' },
						});
						// Add to index so subsequent operations see it
						descIndex.set(calendar_event.key, created);
					}
					catch (e) {
						console.error('Failed to create scheduled event', e);
					}
				}
				else if (needsUpdate(discord_event, calendar_event)) {
					console.log(`Updating event: ${calendar_event.name}`);
					try {
						await discord_event.edit({
							name: calendar_event.name,
							description: calendar_event.description,
							scheduledStartTime: calendar_event.start,
							scheduledEndTime: calendar_event.end,
							entityMetadata: { location: calendar_event.location || 'External' },
						});
					}
					catch (e) {
						console.error(`Failed to update scheduled event ${discord_event.id}`, e);
					}
				}
				else {
					console.log(`No changes for: ${calendar_event.name}`);
				}
			}

			// Delete events that no longer exist in calendar (only those we manage, with icsId marker)
			const knownKeys = new Set(calendar_events.map((e) => e.key));
			for (const [key, ev] of descIndex) {
				if (!knownKeys.has(key)) {
					console.log(`Deleting event no longer in calendar: ${ev.name} (${ev.id})`);
					try {
						await ev.delete();
					}
					catch (e) {
						console.error(`Failed to delete scheduled event ${ev.id}`, e);
					}
				}
			}
			console.log(`Calendar sync complete: ${calendar_events.length} events in window.`);
		}
		catch (err) {
			console.error('Calendar sync error:', err);
		}
		finally {
			inProgress = false;
		}
	}

	// Kick off immediately and then on interval
	runOnce();
	const timer = setInterval(runOnce, Math.max(1, intervalMinutes) * 60 * 1000);

	return {
		stop: () => {
			stopped = true;
			if (timer) clearInterval(timer);
		},
		// Expose trigger for callers who keep a handle
		trigger: async () => {
			await runOnce();
		},
	};
}

let trigger: null | (() => Promise<void>) = null;

export async function triggerCalendarSync(): Promise<{ started: boolean; message: string }> {
	if (!trigger) {
		return { started: false, message: 'Calendar sync not configured. Set CALENDAR_ICS_URL and GUILD_ID.' };
	}
	try {
		await trigger();
		return { started: true, message: 'Calendar sync triggered.' };
	}
	catch (e) {
		console.error('Manual calendar sync failed:', e);
		return { started: false, message: 'Manual calendar sync failed.' };
	}
}
