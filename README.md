# IEEE-TAMU Discord Bot

This repo contains the discord bot for IEEE TAMU.


### Discord Tokens

DISCORD_TOKEN: The Discord bot token


## Calendar Sync (Calendar -> Discord Scheduled Events)

This bot can mirror events from a public iCal feed (e.g., Google Calendar) into your Discord server as Guild Scheduled Events. It periodically:

- Creates events that exist in the calendar but not in Discord
- Updates Discord events when the calendar changes (title, time, description, location)
- Deletes Discord events if they’re removed from the calendar

Setup:

1. Make your Calendar’s ICS link public (or otherwise accessible) and copy the URL.
2. In your `.env`, set:
	 - `CALENDAR_ICS_URL` – your ICS URL
	 - `GUILD_ID` – your Discord guild ID
	 - Optional tuning:
		 - `CALENDAR_SYNC_INTERVAL_MINUTES` (default 10)

Notes:

- Events are created as External Guild Scheduled Events with the location set from the calendar’s `LOCATION`.
- Correlation uses only an hidden `icsId:<UID>` marker in the Discord event description (for recurring events: `icsId:<UID>::<occurrenceStartISO>`). No files are written to disk.
- Only future events are synced (past-start events are ignored).
