# PocketArcade 0.1

PocketArcade turns an ESP32-family board into a self-contained local multiplayer
browser platform. It creates a Wi-Fi access point, serves a captive-portal-style
mobile interface from internal flash, remembers local players, displays live
presence, and continues in RAM-only mode when its SD card is unavailable.

Version 0.1 includes the platform foundation, compact SD-backed profile photos,
a 50-message shared lobby chat, and an SD-hosted Tic-Tac-Toe browser
application. Tic-Tac-Toe's authoritative rules are compiled into firmware;
version 0.1 does not execute server scripts from removable media.

## What is implemented

- ESP-IDF SoftAP at `192.168.4.1`, DHCP, an open-by-default configurable
  security mode, and a bounded station MAC-to-IP table.
- DHCP captive-portal API advertisement, wildcard DNS, and common Android,
  Apple, and Windows captive-check routes.
- Dependency-free, deterministic gzip preparation and flash embedding of the
  complete system UI.
- NVS-generated 256-bit device secret and HMAC-SHA256 station fingerprints.
- Token-first profile restoration, device-fingerprint fallback, switching,
  deletion, bounded bindings, and RAM-only temporary profiles.
- A per-boot first-login administrator role with server-enforced SD mount/eject
  controls in the profile menu.
- Phone camera/gallery profile photos, cropped and compressed in the browser
  to a 96×96 JPEG before authenticated SD storage.
- FATFS storage through configurable SDMMC or SDSPI, safe directory creation,
  capacity/free-space reporting, a bounded worker queue, and recoverable
  temporary/backup/rename writes.
- Versioned HTTP API and one shared, authenticated WebSocket.
- Presence de-duplication across tabs and a configurable reconnect grace period.
- Realtime chat with the newest 50 messages cached in RAM and asynchronously
  persisted to `/data/chat/recent.json`.
- A validated cached SD application catalogue, protected `/apps/<id>/*`
  serving, and copy-ready Tic-Tac-Toe for two players plus spectators.
- Persistent profile win counts, updated by authoritative game results and
  represented by evolving colour/shape roundels in the lobby.
- Safe queued SD eject/mount controls, accessibility, exponential browser
  reconnection, and strict public/internal profile separation.

## Prerequisites

- ESP-IDF 6.0 or newer (verified with the official ESP-IDF 6.0.2 release)
- A supported target: ESP32, ESP32-S2, or ESP32-S3
- A 4 MB or larger flash device
- Python 3 (already required by ESP-IDF)

No Node.js, package manager, internet connection, CDN, web font, or downloaded
frontend dependency is required.

cJSON v1.7.19 is vendored under `components/json` with its MIT license because
ESP-IDF 6 no longer bundles the former `json` component. This preserves offline
builds. IDF 6's supported PSA Crypto API is used for HMAC-SHA256 fingerprints
and SHA-256 session-token hashes.

ESP-IDF 6 dispatches a WebSocket URI handler only after the HTTP upgrade while
the request method remains `HTTP_GET`. PocketArcade reserves its bounded
connection record on the first WebSocket frame instead of treating
`HTTP_GET` as an upgrade callback.

## Configure and build

Activate ESP-IDF first:

```sh
. /path/to/esp-idf/export.sh
idf.py set-target esp32       # or esp32s2 / esp32s3
idf.py menuconfig
idf.py build
```

The safe default is **PocketArcade → SD-card interface → Disabled**. This lets
the firmware build and boot before the real slot wiring is known. Configure the
slot under the single PocketArcade menu; pin numbers are not duplicated in
source.

The checked-in partition table supports 4 MB flash and gives the factory app
almost 4 MB. OTA is deliberately outside the v0.1 scope.

## Flash and monitor

```sh
idf.py -p /dev/ttyUSB0 flash monitor
```

On Windows the port may look like `COM5`. Exit the monitor with
<kbd>Ctrl</kbd>+<kbd>]</kbd>.

Then:

1. Join Wi-Fi `PocketArcade`.
2. Use Android's **Sign in to network** notification (or the equivalent
   portal prompt), or open `http://192.168.4.1/`.
3. Choose a nickname.

PocketArcade advertises the standard captive-portal API and answers legacy
connectivity checks, but Android/iOS decide whether to open their portal window
automatically. Firmware cannot force an OS browser launch when the device has
disabled captive-portal notifications or remembered a previous choice.

The default network is open so nearby players can join quickly. Set an
8–63-byte password under **PocketArcade → Access-point password** when network
access control is preferred.

`http://play.local/` is a best-effort convenience name while a client uses the
AP-provided DNS. The numeric address is the supported fallback and normal
operation does not rely on mDNS.

## Build presets

`tools/build_matrix.sh` builds SD-disabled, SDMMC, and SDSPI configurations.
The SD pin values in the two CI presets are compile placeholders only—they are
not a claimed board pinout:

```sh
./tools/build_matrix.sh esp32
```

For a classic **AI-Thinker ESP32-CAM** with its onboard microSD slot:

```sh
./tools/build_esp32_cam_ai_thinker.sh
idf.py -B build/esp32-cam-ai-thinker -p PORT flash monitor
```

This preset selects classic ESP32, 4 MB DIO flash, and the onboard SDMMC slot
in 1-bit mode (CLK GPIO14, CMD GPIO15, D0 GPIO2). It deliberately leaves D1
GPIO4 and D2 GPIO12 unused. Confirm the board is actually the AI-Thinker layout
before using it; other products sold as “ESP32-CAM” can differ.

To prepare embedded assets manually:

```sh
python3 tools/prepare_web.py --input web --output /tmp/web_assets.c
```

CMake performs this deterministic gzip step automatically.

## SD setup summary

Select exactly one interface in `menuconfig`.

- **SDMMC:** choose 1-bit or 4-bit mode, clock, and GPIOs. On classic ESP32,
  leaving GPIOs at `-1` requests the target's fixed-slot defaults. Matrix-routed
  S2/S3 targets require CLK, CMD, and D0; 4-bit mode also requires D1–D3.
- **SDSPI:** choose SPI2 or SPI3 and set MOSI, MISO, CLK, and CS.
- Set card-detect/power pins to `-1` when absent. A card-detect input is strongly
  recommended for live removal/insertion events.

Insert a FAT16/FAT32 card, or a blank card. By default, PocketArcade
automatically partitions and formats cards which have no mountable FAT
filesystem, then creates:

```text
/apps
/data/profiles
/data/avatars
/data/chat
/data/apps
/logs
```

Automatic formatting is controlled by **PocketArcade → Format cards without a
mountable FAT filesystem**. Disable it when recovery of a card matters. When
enabled, it also erases unsupported filesystems such as exFAT and cards with
corrupt FAT metadata; communication and I/O failures are never formatted.

Profile photos are written to `/data/avatars/<profile-id>.jpg`; originals never
leave the phone because resizing and JPEG compression happen before upload.
Photos require mounted persistent storage. The browser keeps a 96×96 result,
bounded by **PocketArcade → Maximum processed avatar JPEG size**.

The first profile authenticated after each PocketArcade boot becomes the
administrator for that running session. The role is deliberately not persisted
to the SD card. Only its token can mount or safely eject storage; the controls
are under **Profile → Admin**. If the administrator switches away from its last
device binding or deletes the profile, the next profile to authenticate becomes
administrator. This is local operational convenience, not strong security on
an open Wi-Fi network.

Authoritative game results increment the winner's persisted `wins` value.
Roundels start as a neutral circle, change colour through early wins, then
change shape as totals rise.

The flash-hosted `/`, `/system/*`, `/assets/system/*`, `/api/v1/*`, and `/ws`
namespaces can never be shadowed by the SD card.

## Install the Tic-Tac-Toe test application

The game's browser package can be prepared and copied independently. Its
matching authoritative game component is included in this firmware. Choose
**Profile → Admin → Eject SD card** and wait for **Safe to remove SD card**.
Put the card in this computer and copy:

```text
sdcard-example/apps/tic-tac-toe
        → <SD card>/apps/tic-tac-toe
```

Preserve `manifest.json`, `app.js`, and `app.css`. Eject the card from the
computer, reinsert it in the ESP32-CAM, and choose **Profile → Admin → Mount
SD card**. The launcher rescans once per mount. The game browser package is served from
`/apps/tic-tac-toe/*`, reuses the system page's shared WebSocket, and is not
compiled into the immutable system web interface.

## Tests

Dependency-free host checks:

```sh
python3 -m unittest discover -s tests/host -v
node --check web/js/pocket-arcade.js   # optional
node --check web/js/app.js             # optional
```

ESP-IDF Unity test sources for nickname and path validation live beside their
components. The manual hardware acceptance sequence is in
[docs/acceptance-test.md](docs/acceptance-test.md).

## Documentation

- [Architecture and concurrency](docs/architecture.md)
- [Game development and deployment guide](docs/game-development-guide.md)
- [HTTP API](docs/http-api.md)
- [WebSocket protocol](docs/websocket-protocol.md)
- [Profile lifecycle and device recognition](docs/profiles-and-identity.md)
- [Storage and board wiring](docs/storage-and-hardware.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Acceptance checklist](docs/acceptance-test.md)

## Identity and security boundary

The browser session token is the primary identity. A server-observed station
MAC is HMACed with a secret local to this PocketArcade and used only as a
fallback convenience. The browser never supplies the MAC. Raw MAC addresses are
not stored in profile files or returned by any API, and normal logs omit them.

This is not strong authentication. MAC spoofing can defeat device recognition,
and private Wi-Fi addresses can change. Clearing browser storage removes the
primary token but may still allow fallback restoration until **Switch player**
removes the current binding. **Delete profile** removes the profile, all
bindings, and all active sessions.
