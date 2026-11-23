/*
 * IEEE TAMU Lounge Officer Status Button
 *
 * ESP32 firmware for the lounge in/out button. It posts the button state to the
 * Discord bot's /officer-status endpoint, which keeps a live embed updated in a
 * Discord channel.
 *
 * Wiring:
 *   - Button: GPIO 21 to 3V3 (internal pull-down, active HIGH)
 *   - Red LED: GPIO 22 -> 220-330 ohm resistor -> LED -> GND
 *   - Green LED: GPIO 23 -> 220-330 ohm resistor -> LED -> GND
 *
 * Configuration lives in secrets.h (copy secrets.example.h and fill it in).
 * secrets.h is gitignored so Wi-Fi credentials and the API key stay local.
 *
 * Behaviour:
 *   - Press the button to toggle between AWAY (red) and ACTIVE (green).
 *   - Sends immediately on every toggle, then heartbeats every 15 seconds.
 *   - If a request fails, retries every 5 seconds without losing the state.
 *   - Boots in AWAY state so a power blip never shows a false "officer in".
 */

#include "secrets.h"

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------
constexpr uint8_t BUTTON_PIN = 21;
constexpr uint8_t RED_LED_PIN = 22;
constexpr uint8_t GREEN_LED_PIN = 23;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr uint32_t DEBOUNCE_MS = 50;
constexpr uint32_t HEARTBEAT_MS = 15000;
constexpr uint32_t RETRY_MS = 5000;
constexpr uint32_t HTTP_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
bool greenActive = false;

bool lastRawButton = LOW;
bool stableButton = LOW;
uint32_t lastButtonChangeMs = 0;

bool forceSend = false;
bool sendPending = false;
uint32_t lastHeartbeatMs = 0;
uint32_t lastSendAttemptMs = 0;
uint32_t lastWifiAttemptMs = 0;

void applyLedState() {
  digitalWrite(RED_LED_PIN, greenActive ? LOW : HIGH);
  digitalWrite(GREEN_LED_PIN, greenActive ? HIGH : LOW);
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

void pollButton(uint32_t now) {
  const bool reading = digitalRead(BUTTON_PIN);

  // Remember when the raw input last changed, then only accept a new stable
  // level after it has held for DEBOUNCE_MS.
  if (reading != lastRawButton) {
    lastRawButton = reading;
    lastButtonChangeMs = now;
  }

  if (now - lastButtonChangeMs < DEBOUNCE_MS || reading == stableButton) {
    return;
  }

  stableButton = reading;

  // Active-high button with an internal pull-down: HIGH means pressed.
  if (stableButton == HIGH) {
    greenActive = !greenActive;
    applyLedState();
    forceSend = true;

    Serial.printf("[TOGGLE] %s\n", greenActive ? "ACTIVE (green)" : "AWAY (red)");
  }
}

bool sendStatusUpdate(bool buttonPressed) {
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
  payload += F("\",\"buttonPressed\":");
  payload += buttonPressed ? F("true") : F("false");
  payload += F(",\"greenActive\":");
  payload += greenActive ? F("true") : F("false");
  payload += F(",\"status\":\"");
  payload += greenActive ? F("ACTIVE") : F("AWAY");
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
  Serial.println("\nIEEE TAMU lounge officer button");

  pinMode(BUTTON_PIN, INPUT_PULLDOWN);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);

  stableButton = digitalRead(BUTTON_PIN);
  lastRawButton = stableButton;
  applyLedState();

  connectWiFi();
  lastWifiAttemptMs = millis();

  const uint32_t now = millis();
  lastSendAttemptMs = now;
  if (sendStatusUpdate(stableButton == HIGH)) {
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

  pollButton(now);

  if (WiFi.status() == WL_CONNECTED) {
    const bool heartbeatDue = now - lastHeartbeatMs >= HEARTBEAT_MS;
    const bool retryDue = sendPending && now - lastSendAttemptMs >= RETRY_MS;

    if (forceSend || heartbeatDue || retryDue) {
      lastSendAttemptMs = now;
      forceSend = false;

      if (sendStatusUpdate(stableButton == HIGH)) {
        lastHeartbeatMs = now;
        sendPending = false;
      } else {
        sendPending = true;
      }
    }
  }
}
