Copyright © 2026 AIGENUITY LTD

PocketArcade is available under the PolyForm Noncommercial License 1.0.0 for personal, educational, hobbyist and other non-commercial purposes.

Any commercial use, commercial distribution, incorporation into a commercial product or service, or use intended for commercial advantage requires a separate commercial licence from AIGENUITY LTD.

See the LICENSE file for the full public licence terms.

Commercial licensing enquiries: aigenuityltduk@gmail.com

PocketArcade names, logos and branding are not licensed for reuse.

# PocketArcade 1.0 (realtime multiplayer platform Phase 3)

PocketArcade turns an ESP32-family board into a self-contained local multiplayer
browser platform. It creates a Wi-Fi access point, serves a captive-portal-style
mobile interface from internal flash, remembers local players, displays live
presence, and continues in RAM-only mode when its SD card is unavailable.

Version 0.3 adds bounded realtime execution to the generic multiplayer
foundation: monotonic fixed-rate Lua ticks, a separately capped snapshot
cadence, compact binary snapshot envelopes, latest-snapshot coalescing,
per-connection critical output rings, and consistent slow-client closure.
Tic-Tac-Toe and PocketBlocks are authoritative entirely from their SD
packages; firmware contains no rules for either game.

## What is implemented

- ESP-IDF SoftAP at `192.168.4.1`, DHCP, an open-by-default configurable
  security mode, and a bounded station MAC-to-IP table.
- DHCP captive-portal API advertisement, wildcard DNS, and common Android,
  Apple, and Windows captive-check routes.
- A responsive flash-hosted welcome screen with compressed portrait/landscape
  artwork and an explicit handoff to the full browser UI.
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
- Manifest-v2 runtime/multiplayer validation with firmware-clamped player,
  reconnect, tick, script, command, snapshot, and memory policies.
- Generic match membership keyed by profile, one controller lease per seat,
  input sequencing, reconnection snapshots, and a bounded runtime queue.
- Sandboxed Lua server scripts loaded from SD on the dedicated game worker,
  with restricted libraries, capability-gated host APIs, per-instance memory
  accounting, callback instruction/time/recursion limits, bounded JSON output,
  protected calls, and match-local fault termination.
- Fixed-tick Lua matches scheduled from monotonic time on that worker, with
  overrun detection, accumulated-tick dropping, and simulation rates clamped
  to 30 Hz independently from a maximum 15 Hz snapshot cadence.
- Compact binary realtime snapshots carry stable application/match handles,
  revision, server time, input acknowledgement, and a bounded opaque payload.
  Each connection retains only its newest unsent snapshot while critical
  lifecycle/error/result traffic uses a fixed ring; consistently slow clients
  are closed before they can grow memory without bound.
- Firmware-validated match results update persistent aggregate profile wins and
  the lobby's evolving colour/shape roundels. Detailed per-game statistics are
  reserved for Phase 4.
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

Lua 5.4.8 is vendored under `components/lua` from the official Lua source
release. Only the base, coroutine, table, string, math, and UTF-8 libraries are
compiled; filesystem, operating-system, package-loader, and debug libraries
are excluded.

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
almost 4 MB. OTA is deliberately outside the current scope.

## Flash and monitor

```sh
idf.py -p /dev/ttyUSB0 flash monitor
```

On Windows the port may look like `COM5`. Exit the monitor with
<kbd>Ctrl</kbd>+<kbd>]</kbd>.

Then:

1. Join Wi-Fi `PocketArcade`.
2. Use Android's **Sign in to network** notification (or the equivalent
   portal prompt). The flash-hosted welcome screen opens first.
3. Choose **Start** to request the full PocketArcade UI in the device browser.
4. Choose a nickname.

PocketArcade advertises the standard captive-portal API and answers legacy
connectivity checks, but Android/iOS decide whether to open their portal window
automatically. Firmware cannot force an OS browser launch when the device has
disabled captive-portal notifications or remembered a previous choice.
Captive browsers also decide whether a new HTTP browsing context can leave
their sign-in window; the welcome screen includes an **Open in browser**
fallback instruction. `http://192.168.4.1/` always opens the full UI directly.

The default network is open so nearby players can join quickly. Set an
8–63-byte password under **PocketArcade → Access-point password** when network
access control is preferred.

`http://play.local/` is a best-effort convenience name while a client uses the
AP-provided DNS. The numeric address is the supported fallback and normal
operation does not rely on mDNS.

## Board profiles and build presets

PocketArcade requires both PSRAM and an SD-card slot. Named board profiles
contain the target, flash settings, SD interface, and pin mapping used for
release builds:

```sh
python3 tools/board_profiles.py list
python3 tools/board_profiles.py validate
python3 tools/board_profiles.py build esp32-cam-ai-thinker
```

The current profiles are:

| Profile | Hardware status | Web installer |
|---|---|---|
| `esp32-cam-ai-thinker` | Verified | Published |
| `lilygo-ttgo-t8-classic` | Provisional until hardware bring-up | Withheld |
| `ai-thinker-esp32-a1s-audio-kit-v2-2` | Provisional until hardware bring-up | Withheld |

Provisional profiles compile as part of `build-all`, but the GitHub Pages
packager excludes them until their SD and PSRAM configuration has been checked
on the exact PCB revision. See [`docs/board-profiles.md`](docs/board-profiles.md)
for the pin maps and promotion checklist.

`tools/build_matrix.sh` still builds SD-disabled, SDMMC, and SDSPI configurations
as compile coverage. The SD pin values in the two CI presets are placeholders
only—they are not a claimed board pinout:

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

To assemble the static browser installer from completed builds:

```sh
python3 tools/board_profiles.py package --output dist/pages
```

The manual **Build firmware installer** GitHub Actions workflow builds every
profile, packages verified profiles with ESP Web Tools manifests, and deploys
the static result to GitHub Pages. Enable **GitHub Actions** as the Pages source
in the repository settings before its first run.

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

Roundels start as a neutral circle, change colour through early wins, then
change shape as totals rise. Validated first-place results update the aggregate
score immediately; Phase 4 adds played/loss/draw and other per-game statistics.

The flash-hosted `/`, `/system/*`, `/assets/system/*`, `/api/v1/*`, and `/ws`
namespaces can never be shadowed by the SD card.

## Install the SD game packages

The complete browser and authoritative server package can be copied
independently. Choose
**Profile → Admin → Eject SD card** and wait for **Safe to remove SD card**.
Put the card in this computer and copy:

```text
sdcard-example/apps/tic-tac-toe → <SD card>/apps/tic-tac-toe
sdcard-example/apps/pocketblocks → <SD card>/apps/pocketblocks
```

Preserve `manifest.json` and the complete `client/` and `server/` directories.
Eject the card from the computer, reinsert it in the ESP32-CAM, and choose
**Profile → Admin → Mount SD card**. The launcher rescans once per mount. The
Each client is served from its own `/apps/<id>/*` namespace and uses the scoped
shared-socket facade. Its `server/main.lua` rules execute through the same
generic sandbox and match protocol. PocketBlocks is the Phase 3 fixed-tick,
binary-snapshot validation game; it does not add falling-block rules to the
firmware.

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
- [Game development and deployment guide](docs/PocketArcade-game-development-guide.md)
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
