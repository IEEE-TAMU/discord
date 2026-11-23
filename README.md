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
- `/move <from> <to>` — move an upcoming track to a new position in the queue
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

## Lounge officer presence sensor

An ESP32 with an LM393 photoresistor module in the officer lounge reports whether
the room light is on. The bot exposes an HTTP endpoint for the device and keeps a
single, minimal embed in a channel updated in place.

- `POST /officer-status` — the device sends a JSON status update
- `GET /officer-status` — inspect the last known state of every device

Environment:

- `OFFICER_STATUS_CHANNEL_ID` — channel that holds the live status embed (required)
- `OFFICER_STATUS_API_KEY` — shared secret the device sends as `Authorization: Bearer <key>`. If empty, unauthenticated posts are allowed
- `OFFICER_STATUS_STALE_SECONDS` — mark a device offline after this many seconds without an update, default `90`

The embed shows **Officer present** when any device reports `greenActive: true`
(the light is on) and **Lounge empty** when every device reports the light off. A
device that stops sending heartbeats is shown as offline. The message is recreated
automatically if it was deleted, so the device does not need to know the message
ID.

Firmware for the ESP32 light sensor is in
[`firmware/lounge-light-sensor`](firmware/lounge-light-sensor). It includes
wiring, potentiometer calibration, flashing, and configuration instructions.

## Printing

The bot can print to the Brother MFC-7360N in the officer lounge through the print host on `ieee-tamu-5B`.

Slash commands (guild-scoped, registered on startup):

- `/print <file> [copies] [pages]` — print a PDF, PNG, JPEG, or plain-text attachment
- `/print-status` — show printer state and queued jobs
- `/print-cancel <job>` — cancel a queued job

Environment:

- `PRINT_AGENT_URL` — base URL of the print control API (required, e.g. `http://192.168.1.10:8788`)
- `PRINT_AGENT_TOKEN` — optional bearer token, matching the print agent's `tokenFile`
- `PRINT_ALLOWED_ROLE_IDS` — comma-separated officer role IDs
- `PRINT_ALLOWED_CHANNEL_IDS` — comma-separated channel IDs where commands are allowed
- `PRINT_COOLDOWN_SECONDS` — per-user cooldown, default `5`
- `PRINT_MAX_FILE_MB` — upload limit, default `10`

If `PRINT_ALLOWED_ROLE_IDS` is empty, only members with **Manage Server** can print. Replies are ephemeral because print jobs may contain sensitive documents. See `nix-cluster/README.md` for the CUPS/print-agent setup.

## 3D printing

The bot can drive the Bambu Lab X2D in the officer lounge through the Bambu control API on `ieee-tamu-5B`.

Slash commands (guild-scoped, registered on startup):

- `/3dprint <file> [plate] [bed_leveling] [flow_cali] [vibration_cali] [timelapse]` — upload a pre-sliced `.gcode.3mf` and show the mapping UI. The reply lists the sliced materials and the live AMS/external filaments, with one select menu per sliced material. Choose a filament for every material, then press **Start print**. There is no automatic matching.
- `/3dprint-status` — show printer state, progress, bed/nozzle/chamber temperatures, AMS filament, errors, and a chamber camera snapshot of the bed.
- `/3dprint-stop` — stop the current print.

The upload and mapping reply is ephemeral and expires after one hour. Cancelling the mapping leaves the uploaded file on the printer but does not start it. The bot uses the agent’s `POST /print?start=false` (upload + token) and `POST /start` (selected tray IDs) endpoints.

Environment:

- `BAMBU_AGENT_URL` — base URL of the Bambu control API (required, e.g. `http://192.168.1.10:8789`)
- `BAMBU_AGENT_TOKEN` — optional bearer token, matching the agent's `tokenFile`
- `BAMBU_ALLOWED_ROLE_IDS` — comma-separated officer role IDs
- `BAMBU_ALLOWED_CHANNEL_IDS` — comma-separated channel IDs where commands are allowed
- `BAMBU_COOLDOWN_SECONDS` — per-user cooldown, default `10`
- `BAMBU_MAX_FILE_MB` — upload limit, default `25`
- `BAMBU_NOTIFY_CHANNEL_ID` — channel that receives a print-finished/failed embed with a camera snapshot. Leave empty to disable.
- `BAMBU_NOTIFY_POLL_SECONDS` — how often to check the printer for a completed job, default `20`

If `BAMBU_ALLOWED_ROLE_IDS` is empty, only members with **Manage Server** can use the 3D printer. The printer must have LAN-only mode and Developer Mode enabled for `/3dprint` to start jobs; status and camera work without Developer Mode. See `nix-cluster/README.md` for the Bambu agent setup.

When a job transitions from an active state (`PREPARE`, `RUNNING`, `PAUSE`, or `SLICING`) to `FINISH` or `FAILED`, the bot posts to `BAMBU_NOTIFY_CHANNEL_ID` with the job name, file, result, progress, temperatures, active filament, and a camera snapshot. It intentionally does not post for a printer that is already finished when the bot starts, so restarts do not spam the channel.
