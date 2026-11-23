# Lounge officer status button

ESP32 firmware that reports whether an officer is in the IEEE TAMU lounge. It
posts to the Discord bot's `POST /officer-status` endpoint, and the bot keeps a
single embed in the configured channel updated in place.

## Hardware

| Part        | Connection                                       |
| ----------- | ------------------------------------------------ |
| Push button | GPIO 21 to 3V3 (internal pull-down, active HIGH) |
| Red LED     | GPIO 22 -> 220-330 ohm resistor -> LED -> GND    |
| Green LED   | GPIO 23 -> 220-330 ohm resistor -> LED -> GND    |

Use an ESP32 dev board powered over USB. The LEDs are driven at 3.3 V from the
GPIO pins; do not connect them to 5 V. If you use a different board or wiring,
change the pin constants at the top of the sketch.

The sketch uses `INPUT_PULLDOWN`, so the button must switch to 3V3 when pressed.
If your button is wired to GND instead, switch the pin mode to `INPUT_PULLUP` and
reverse the logic (active LOW).

## Bot configuration

In `discord/.env`:

```sh
OFFICER_STATUS_CHANNEL_ID=123456789012345678
OFFICER_STATUS_API_KEY=<generated-secret>
OFFICER_STATUS_STALE_SECONDS=90
```

Generate a secret with:

```sh
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
```

The bot must be restarted after changing these values. The channel needs
`View Channel`, `Send Messages`, and `Embed Links` permissions for the bot.

## Firmware configuration

Copy the example secrets file and fill in the real values:

```sh
cp secrets.example.h secrets.h
```

Edit `secrets.h`:

```cpp
constexpr char WIFI_SSID[] = "IEEE TAMU Lounge";
constexpr char WIFI_PASSWORD[] = "the-lounge-wifi-password";
constexpr char STATUS_URL[] = "http://192.168.1.10/officer-status";
constexpr char API_KEY[] = "the-value-of-OFFICER_STATUS_API_KEY";
constexpr char DEVICE_ID[] = "esp32-lounge-button-1";
```

`secrets.h` is gitignored, so Wi-Fi credentials and the API key stay out of the
repository. The sketch includes it automatically:

```cpp
#include "secrets.h"
```

- `STATUS_URL` defaults to `ieee-tamu-5B` on the lounge LAN. Traefik on that host
  routes `/officer-status` to the bot, and the route only matches requests made
  to `192.168.1.10`, so it is not reachable through the public tunnel.
- `API_KEY` must exactly match `OFFICER_STATUS_API_KEY` from `discord/.env`.
- `DEVICE_ID` is shown in the Discord embed. Use a unique value per device.

The sketch also supports `https://` URLs, but the default LAN URL is plain HTTP
and never leaves the local network.

## Flash and test

With the ESP32 Arduino core installed (`arduino-cli core install esp32:esp32`):

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 .
arduino-cli upload --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 .
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

Or open the folder in the Arduino IDE and upload normally.

Before flashing, verify the endpoint from a computer on the same network:

```sh
curl -X POST http://192.168.1.10:3000/officer-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer change-me-shared-secret" \
  -d '{"deviceId":"test-device","greenActive":true,"uptimeSec":1,"rssi":-50}'
```

The response is `{"success":true,...}` and the Discord embed should switch to
green. A `401` means the API key does not match. A `404` means
`OFFICER_STATUS_CHANNEL_ID` is missing, so the bot did not register the module.

## Behaviour

- Boots in **AWAY** (red) and reports that state to the bot.
- Each button press toggles **ACTIVE** (green) / **AWAY** (red) and sends
  immediately.
- Heartbeats every 15 seconds; the bot marks the device offline after 90 seconds
  without an update.
- Failed requests are retried every 5 seconds. A toggle made while the network
  is down is still sent once the connection recovers.
- Wi-Fi is retried every 10 seconds without blocking the button for long.
