# IEEE-TAMU Discord Bot

This repo contains the discord bot for IEEE TAMU.
Currently, its only purpose is to bridge together a Discord channel with a GroupMe chat.
This allows for instant and automatic cross posting from a specified discord channel monitored by the bot to a specific GroupMe chat.

## Usage

The bot relies on both Discord and GroupMe tokens to be available when running

### Discord Tokens

DISCORD_TOKEN: The Discord bot token

MONITOR_CHANNEL_ID: The id of the Discord channel to bridge to GroupMe


### GroupMe Tokens

GROUPME_BOT_ID: The bot id of the [GroupMe bot](https://dev.groupme.com/bots) set up to post in the bridged GroupMe chat

GROUPME_TOKEN: The GroupMe token used to upload pictures to the GroupMe image API

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
