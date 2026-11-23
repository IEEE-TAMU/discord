#pragma once

// Copy this file to secrets.h and fill in the real values.
// secrets.h is gitignored and must never be committed.

// ---------------------------------------------------------------------------
// Wi-Fi
// ---------------------------------------------------------------------------
constexpr char WIFI_SSID[] = "IEEE TAMU Lounge";
constexpr char WIFI_PASSWORD[] = "";

// ---------------------------------------------------------------------------
// Discord bot API
// ---------------------------------------------------------------------------
// The lounge Wi-Fi is bridged onto the IEEE LAN. `ieee-tamu-5B` runs k3s and
// serves Traefik on port 80, which routes this path to the Discord bot.
constexpr char STATUS_URL[] = "http://192.168.1.10/officer-status";
// Must match OFFICER_STATUS_API_KEY in the bot's .env. Leave empty only if the
// bot has no key configured.
constexpr char API_KEY[] = "";
// Unique per device; shown as the field name in the Discord embed.
constexpr char DEVICE_ID[] = "esp32-lounge-button-1";
