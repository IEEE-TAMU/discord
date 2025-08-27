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
```
