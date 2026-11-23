/*
 * IEEE TAMU Lounge Officer Presence Sensor
 *
 * ESP32 firmware for the lounge light sensor. It reports whether the room light
 * is on to the Discord bot's /officer-status endpoint, which keeps a live embed
 * updated in a Discord channel.
 *
 * Wiring (LM393 photoresistor module):
 *   - VCC -> 3V3  (do not use 5V: DO would be 5V on the ESP32 pin)
 *   - GND -> GND
 *   - DO  -> GPIO 21
 *   - Optional red LED:   GPIO 22 -> 220-330 ohm resistor -> LED -> GND
 *   - Optional green LED: GPIO 23 -> 220-330 ohm resistor -> LED -> GND
 *
 * Adjust the module's potentiometer so its DO LED turns on when the room light
 * is on. Most LM393 modules output LOW for "light detected"; if yours is
 * inverted, set LIGHT_ACTIVE_LOW to false.
 *
 * Configuration lives in secrets.h (copy secrets.example.h and fill it in).
 * secrets.h is gitignored so Wi-Fi credentials and the API key stay local.
 *
 * Behaviour:
 *   - Samples the digital light sensor and requires 1 second of stable state.
 *   - Posts immediately when presence changes, then heartbeats every 15 seconds.
 *   - If a request fails, retries every 5 seconds without losing the state.
 */

#include "secrets.h"

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------
constexpr uint8_t LIGHT_SENSOR_PIN = 21;
constexpr uint8_t RED_LED_PIN = 22;
constexpr uint8_t GREEN_LED_PIN = 23;

// Most LM393 light modules pull DO LOW when light is detected.
constexpr bool LIGHT_ACTIVE_LOW = true;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr uint32_t LIGHT_STABLE_MS = 1000;
constexpr uint32_t HEARTBEAT_MS = 15000;
constexpr uint32_t RETRY_MS = 5000;
constexpr uint32_t HTTP_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
bool officerPresent = false;
bool lastRawLight = false;
uint32_t lastLightChangeMs = 0;

bool forceSend = false;
bool sendPending = false;
uint32_t lastHeartbeatMs = 0;
uint32_t lastSendAttemptMs = 0;
uint32_t lastWifiAttemptMs = 0;

bool readLightOn() {
  const bool raw = digitalRead(LIGHT_SENSOR_PIN);
  return LIGHT_ACTIVE_LOW ? raw == LOW : raw == HIGH;
}

void applyLedState() {
  digitalWrite(RED_LED_PIN, officerPresent ? LOW : HIGH);
  digitalWrite(GREEN_LED_PIN, officerPresent ? HIGH : LOW);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.printf("Connecting to Wi-Fi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi connected: %s (RSSI %d dBm)\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("Wi-Fi connect timed out; will retry.");
  }
}

void pollLight(uint32_t now) {
  const bool reading = readLightOn();

  // Require the new light state to hold before accepting it so flicker and
  // shadows do not spam Discord with presence changes.
  if (reading != lastRawLight) {
    lastRawLight = reading;
    lastLightChangeMs = now;
  }

  if (now - lastLightChangeMs < LIGHT_STABLE_MS || reading == officerPresent) {
    return;
  }

  officerPresent = reading;
  applyLedState();
  forceSend = true;

  Serial.printf("[LIGHT] %s\n", officerPresent ? "ON - officer present" : "OFF - lounge empty");
}

bool sendStatusUpdate() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);

  // Reuse one client per scheme so repeated heartbeats do not fragment the heap.
  static WiFiClient plainClient;
  static WiFiClientSecure secureClient;

  bool started = false;
  if (strncmp(STATUS_URL, "https://", 8) == 0) {
    // Cloudflare's edge certificate is not pinned here. Traffic is still
    // encrypted; for stricter validation replace setInsecure() with setCACert().
    secureClient.setInsecure();
    started = http.begin(secureClient, STATUS_URL);
  } else {
    started = http.begin(plainClient, STATUS_URL);
  }

  if (!started) {
    Serial.println("[HTTP] Could not create connection.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  if (API_KEY[0] != '\0') {
    http.addHeader("Authorization", String("Bearer ") + API_KEY);
  }

  String payload;
  payload.reserve(256);
  payload += F("{\"deviceId\":\"");
  payload += DEVICE_ID;
  payload += F("\",\"greenActive\":");
  payload += officerPresent ? F("true") : F("false");
  payload += F(",\"status\":\"");
  payload += officerPresent ? F("PRESENT") : F("EMPTY");
  payload += F("\",\"uptimeSec\":");
  payload += String(millis() / 1000UL);
  payload += F(",\"rssi\":");
  payload += String(WiFi.RSSI());
  payload += '}';

  const int httpCode = http.POST(payload);
  const bool ok = httpCode >= 200 && httpCode < 300;

  Serial.printf("[HTTP] %s (%d)", ok ? "ok" : "failed", httpCode);
  if (httpCode > 0) {
    Serial.printf(" | %s\n", http.getString().c_str());
  } else {
    Serial.printf(" | %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
  return ok;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nIEEE TAMU lounge light sensor");

  pinMode(LIGHT_SENSOR_PIN, INPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);

  officerPresent = readLightOn();
  lastRawLight = officerPresent;
  lastLightChangeMs = millis();
  applyLedState();
  Serial.printf("[LIGHT] boot state: %s\n", officerPresent ? "ON" : "OFF");

  connectWiFi();
  lastWifiAttemptMs = millis();

  const uint32_t now = millis();
  lastSendAttemptMs = now;
  if (sendStatusUpdate()) {
    lastHeartbeatMs = now;
    sendPending = false;
  } else {
    sendPending = true;
  }
}

void loop() {
  const uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED && now - lastWifiAttemptMs >= WIFI_RETRY_MS) {
    lastWifiAttemptMs = now;
    connectWiFi();
  }

  pollLight(now);

  if (WiFi.status() == WL_CONNECTED) {
    const bool heartbeatDue = now - lastHeartbeatMs >= HEARTBEAT_MS;
    const bool retryDue = sendPending && now - lastSendAttemptMs >= RETRY_MS;

    if (forceSend || heartbeatDue || retryDue) {
      lastSendAttemptMs = now;
      forceSend = false;

      if (sendStatusUpdate()) {
        lastHeartbeatMs = now;
        sendPending = false;
      } else {
        sendPending = true;
      }
    }
  }
}
