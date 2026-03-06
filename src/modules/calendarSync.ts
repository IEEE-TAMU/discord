import { Client, GuildScheduledEvent, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel } from 'discord.js';
import ical, { CalendarComponent, ParameterValue } from 'node-ical';
import { Express } from 'express';
import { DiscordModule } from './index';

function unwrapString(val: string | ParameterValue | undefined): string | undefined {
	if (val === undefined) return undefined;
	if (typeof val === 'string') return val;
	return val.val;
}

type CalendarEvent = {
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
	lines.push(`||icsId:${key}||`);
	return lines.filter(Boolean).join('\n\n');
}

function getKey(event: GuildScheduledEvent): string | null {
	const desc = event.description || '';
	const match = desc.match(/\|\|icsId:(.+)\|\|/i);
	if (match) {
		return match[1] || null;
	}
	return null;
}

function toCalendarEvent(event: CalendarComponent): CalendarEvent | null {
	if (event.type !== 'VEVENT' || !event.start) return null;
	const uid = unwrapString(event.uid) || `${unwrapString(event.summary)}-${event.start?.toISOString()}`;
	const name = unwrapString(event.summary) || 'Untitled Event';
	const location = unwrapString(event.location) || 'External';
	const rsvpUrl = unwrapString((event as Record<string, string | ParameterValue>)['RSVP-URL']);

	if (event.rrule) {
		console.log(`calendarSync: skipping recurring event: ${name}`);
		return null;
	}

	const key = `${uid}`;
	const description = buildDescription(unwrapString(event.description), key, rsvpUrl);
	const start = event.start;
	let end = event.end;

	if (!end || start.getTime() === end.getTime()) {
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

const MODULE_NAME = 'calendarSync';

let triggerFn: (() => Promise<void>) | null = null;

export const calendarModule: DiscordModule = {
	name: MODULE_NAME,
	start(client: Client, app: Express) {
		const ICS_URL = process.env.CALENDAR_ICS_URL;
		const GUILD_ID = process.env.GUILD_ID;
		const intervalMinutes = Number(process.env.CALENDAR_SYNC_INTERVAL_MINUTES || 10);

		if (!ICS_URL || !GUILD_ID) {
			return {
				enabled: false,
				missingRequirements: [
					!ICS_URL ? 'CALENDAR_ICS_URL' : '',
					!GUILD_ID ? 'GUILD_ID' : '',
				].filter(Boolean),
			};
		}

		let inProgress = false;
		let stopped = false;

		app.post('/calendar/sync', async (_req, res) => {
			if (!triggerFn) {
				return res.status(404).json({ success: false, message: `${MODULE_NAME}: not configured` });
			}
			try {
				await triggerFn();
				return res.json({ success: true, message: `${MODULE_NAME}: triggered.` });
			}
			catch (error) {
				console.error(`${MODULE_NAME}: trigger error:`, error);
				return res.status(500).json({ success: false, message: `${MODULE_NAME}: trigger failed.` });
			}
		});

		async function runOnce() {
			if (inProgress || stopped) return;
			inProgress = true;
			try {
				const guildId = GUILD_ID as string;
				const icsUrl = ICS_URL as string;
				const guild = await client.guilds.fetch(guildId);
				const parsed = await ical.async.fromURL(icsUrl);
				const calendar_events = Object.values(parsed)
					.filter((e): e is CalendarComponent => e !== undefined)
					.map(toCalendarEvent)
					.filter((e) => e !== null);

				const existing = await guild.scheduledEvents.fetch();

				const descIndex = new Map(
					existing
						.mapValues((e) => ({ key: getKey(e), ev: e }))
						.filter((o): o is typeof o & { key: Exclude<typeof o.key, null> } => o.key !== null)
						.map(({ key, ev }) => [key, ev]),
				);

				console.log(`${MODULE_NAME}: fetched ${existing.size} existing events, ${descIndex.size} matched by description.`);
				console.log(`${MODULE_NAME}: calendar has ${calendar_events.length} events in the sync window.`);

				for (const calendar_event of calendar_events) {
					if (calendar_event.start.getTime() < Date.now()) {
						console.log(`${MODULE_NAME}: skipping past-start event: ${calendar_event.name}`);
						continue;
					}

					const discord_event = descIndex.get(calendar_event.key);

					if (!discord_event) {
						console.log(`${MODULE_NAME}: creating event: ${calendar_event.name}`);
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
							descIndex.set(calendar_event.key, created);
						}
						catch (e) {
							console.error(`${MODULE_NAME}: failed to create scheduled event`, e);
						}
					}
					else if (needsUpdate(discord_event, calendar_event)) {
						console.log(`${MODULE_NAME}: updating event: ${calendar_event.name}`);
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
							console.error(`${MODULE_NAME}: failed to update scheduled event ${discord_event.id}`, e);
						}
					}
					else {
						console.log(`${MODULE_NAME}: no changes for: ${calendar_event.name}`);
					}
				}

				const knownKeys = new Set(calendar_events.map((e) => e.key));
				for (const [key, ev] of descIndex) {
					if (!knownKeys.has(key)) {
						console.log(`${MODULE_NAME}: deleting event no longer in calendar: ${ev.name}`);
						try {
							await ev.delete();
						}
						catch (e) {
							console.error(`${MODULE_NAME}: failed to delete scheduled event ${ev.id}`, e);
						}
					}
				}
				console.log(`${MODULE_NAME}: sync complete: ${calendar_events.length} events in window.`);
			}
			catch (err) {
				console.error(`${MODULE_NAME}: error:`, err);
			}
			finally {
				inProgress = false;
			}
		}

		triggerFn = runOnce;
		runOnce();
		const timer = setInterval(runOnce, Math.max(1, intervalMinutes) * 60 * 1000);

		this.stop = () => {
			stopped = true;
			if (timer) clearInterval(timer);
		};

		return { enabled: true };
	},
};
