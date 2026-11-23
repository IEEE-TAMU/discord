# Discord Bot API

This Discord bot includes a web-based API for managing user roles and triggering calendar syncs. The API runs on port 3000 by default.

Since this app runs behind the IEEE TAMU firewall colocated with apps that use it, no authentication is used to ease simplicity of implementation. If this changes at any point then securing the bot should be considered.

## API Endpoints

### Health Check
```
GET /health
```
Returns the bot status and current timestamp.

**Response:**
```json
{
  "status": "ok",
  "bot": "BotName#1234",
  "timestamp": "2025-07-25T10:30:00.000Z"
}
```

### Get User Roles
```
GET /roles?userId=USER_ID
```
Retrieves all roles for a specific user.

**Query Parameters:**
- `userId` (required): Discord user ID

**Response:**
```json
{
  "success": true,
  "userId": "123456789012345678",
  "username": "example_user",
  "displayName": "Example User",
  "roles": [
    {
      "id": "987654321098765432",
      "name": "Member",
      "color": "#99aab5"
    },
    {
      "id": "876543210987654321",
      "name": "Verified",
      "color": "#3498db"
    }
  ]
}
```

### Add Role (PUT)
```
PUT /roles/manage
```
Adds a role to a user.

**Request Body:**
```json
{
  "userId": "123456789012345678",
  "roleName": "Member"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully added Member role",
  "userId": "123456789012345678",
  "roleName": "Member"
}
```

### Remove Role (DELETE)
```
DELETE /roles/manage
```
Removes a role from a user.

**Request Body:**
```json
{
  "userId": "123456789012345678",
  "roleName": "Member"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully removed Member role",
  "userId": "123456789012345678",
  "roleName": "Member"
}
```

### Trigger Calendar Sync (POST)
```
POST /calendar/sync
```
Forces a one-off calendar sync (if calendar sync is configured via env vars).

**Response:**
```json
{ "success": true, "message": "Calendar sync triggered." }
```
or
```json
{ "success": false, "message": "Calendar sync not configured. Set CALENDAR_ICS_URL and GUILD_ID." }
```

### Send a Notification (POST)
```
POST /notify
```
Posts a message to a channel resolved from a logical route. Routes are configured with the `NOTIFY_ROUTES` environment variable as a comma-separated list of `alias:channelId` pairs. A `default` alias is used as a fallback when the requested source is not mapped.

This endpoint is disabled when `NOTIFY_ROUTES` is empty.

**Request Body:**
- `source` (optional): a route alias, e.g. `portal-alerts`.
- `channel` (optional): a route alias or a raw channel ID. Takes precedence over `source`.
- `content` (optional): message text, max 2000 characters.
- `embeds` (optional): array of Discord embed objects.

At least one of `content` or `embeds` is required.

**Response:**
```json
{
  "success": true,
  "channelId": "123456789012345678",
  "messageId": "987654321098765432"
}
```

## Error Responses

All endpoints return error responses in this format:
```json
{
  "success": false,
  "message": "Error description",
  "userId": "123456789012345678"
}
```

## Usage Examples

```bash
# Check bot health
curl http://localhost:3000/health

# Get user roles
curl "http://localhost:3000/roles?userId=123456789012345678"

# Add a role to user
curl -X PUT http://localhost:3000/roles/manage \
  -H "Content-Type: application/json" \
  -d '{"userId": "123456789012345678", "roleName": "Member"}'

# Remove a role from user
curl -X DELETE http://localhost:3000/roles/manage \
  -H "Content-Type: application/json" \
  -d '{"userId": "123456789012345678", "roleName": "Member"}'

# Trigger a calendar sync
curl -X POST http://localhost:3000/calendar/sync

# Send a notification to the route named "portal-alerts"
curl -X POST http://localhost:3000/notify \
  -H "Content-Type: application/json" \
  -d '{"source": "portal-alerts", "content": "Event still open after 8h"}'
```

## Officer status button (POST)

```
POST /officer-status
```

Accepts a heartbeat/status update from the ESP32 officer lounge button and
updates a single embed in `OFFICER_STATUS_CHANNEL_ID`. When
`OFFICER_STATUS_API_KEY` is set, the request must include
`Authorization: Bearer <key>`.

**Request Body:**

- `deviceId` (required): stable device identifier, max 64 characters.
- `buttonPressed` (optional): boolean.
- `greenActive` (optional): boolean. `true` means an officer is in the lounge.
- `status` (optional): device-supplied label, max 32 characters.
- `uptimeSec` (optional): device uptime in seconds.
- `rssi` (optional): Wi-Fi signal strength in dBm.

**Response:**

```json
{
  "success": true,
  "deviceId": "esp32-lounge-button-1",
  "status": "ACTIVE",
  "updatedAt": "2026-11-23T12:00:00.000Z"
}
```

### Get officer status (GET)

```
GET /officer-status
```

Returns the last known state of every device, including a `stale` flag when the
device has not posted within `OFFICER_STATUS_STALE_SECONDS`.

```bash
curl -X POST http://localhost:3000/officer-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer change-me-shared-secret" \
  -d '{"deviceId":"esp32-lounge-button-1","buttonPressed":true,"greenActive":true,"status":"ACTIVE","uptimeSec":42,"rssi":-55}'
```

## Printer control API

Printing is exposed through Discord slash commands (`/print`, `/print-status`, `/print-cancel`). The bot talks to a separate print-agent HTTP API on the print host; it is not part of the bot's own port-3000 API. See `nix-cluster/README.md` for the agent endpoints and configuration.
