# Lounge officer presence sensor

ESP32 firmware that reports whether the lounge light is on. It posts to the
Discord bot's `POST /officer-status` endpoint, and the bot keeps a single embed in
the configured channel updated in place.

## Hardware

| Part                         | Connection                                    |
| ---------------------------- | --------------------------------------------- |
| Photoresistor module (LM393) | VCC -> 3V3, GND -> GND, DO -> GPIO 21         |
| Red LED (optional)           | GPIO 22 -> 220-330 ohm resistor -> LED -> GND |
| Green LED (optional)         | GPIO 23 -> 220-330 ohm resistor -> LED -> GND |

Power the module from **3.3 V**, not 5 V, so its DO output stays within the
ESP32's voltage range. The module has its own potentiometer: adjust it until the
module's DO indicator LED turns on when the room light is on and turns off when
the room is dark.

Most LM393 light modules output **LOW** when light is detected. If yours does the
opposite, change `LIGHT_ACTIVE_LOW` to `false` near the top of the sketch.

The LEDs are optional local indicators; leave the pins unconnected if you do not
use them.

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
constexpr char DEVICE_ID[] = "esp32-lounge-light-1";
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
- `DEVICE_ID` is used in API responses and when multiple sensors report. One
  sensor produces a single uncluttered Discord embed.

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

The serial monitor prints the boot state and each detected change, for example:

```text
[LIGHT] ON - officer present
```

Before flashing, verify the endpoint from a computer on the same network:

```sh
curl -X POST http://192.168.1.10/officer-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <OFFICER_STATUS_API_KEY>" \
  -d '{"deviceId":"test-device","greenActive":true}'
```

The response is `{"success":true,...}` and the Discord embed should switch to
green. A `401` means the API key does not match. A `404` means the request did
not reach the LAN host or the module is not registered.

## Behaviour

- Reads the light sensor and requires one second of stable state before reporting
  a change.
- Sends immediately when the light turns on or off, then heartbeats every 15
  seconds.
- The bot marks the sensor offline after 90 seconds without an update.
- Failed requests are retried every 5 seconds. A change made while the network is
  down is still sent once the connection recovers.
- Wi-Fi is retried every 10 seconds without blocking the loop for long.
