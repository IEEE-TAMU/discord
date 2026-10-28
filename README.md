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

## Lounge music

The bot can control the speakers in the officer lounge through the `lounge-music` player on `ieee-tamu-5B`.

Slash commands (guild-scoped, registered on startup):

- `/play <link or search>` — queue a YouTube/SoundCloud/Bandcamp link or search text
- `/skip [count]` — skip one or more tracks
- `/pause`, `/resume`, `/stop`, `/np`
- `/queue [page]` — show the current track and up to 10 upcoming tracks per page
- `/remove <position>` — remove an upcoming track by its `/queue` number
- `/clear` — clear upcoming tracks but keep the current song playing
- `/volume <0-100>` — set software volume
- `/mute` — toggle mute

Environment:

- `MUSIC_AGENT_URL` — base URL of the player API (required, e.g. `http://192.168.1.10:8787`)
- `MUSIC_AGENT_TOKEN` — optional bearer token, matching the player's `tokenFile`
- `MUSIC_ALLOWED_ROLE_IDS` — comma-separated officer role IDs
- `MUSIC_ALLOWED_CHANNEL_IDS` — comma-separated channel IDs where commands are allowed
- `MUSIC_COOLDOWN_SECONDS` — per-user cooldown, default `5`

If `MUSIC_ALLOWED_ROLE_IDS` is empty, only members with **Manage Server** can control playback. If both role and channel allowlists are empty, the commands are still restricted to **Manage Server**.

The player outputs at 100%; loudness is controlled by the physical knob on the speakers. Spotify links are rejected for now — see `nix-cluster/README.md` for the player setup.
