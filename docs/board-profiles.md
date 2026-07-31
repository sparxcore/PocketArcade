# Board profiles

PocketArcade release hardware must provide:

- a classic ESP32-family target supported by the firmware;
- working external PSRAM; and
- an onboard or permanently attached FAT-capable microSD slot.

Profiles are declared in `boards/profiles.json`. Each entry selects one
checked-in `sdkconfig.board.*` file, an isolated build directory, a support
status, and whether it is eligible for the public web installer.

## Commands

```sh
python3 tools/board_profiles.py list
python3 tools/board_profiles.py validate
python3 tools/board_profiles.py build PROFILE_ID
python3 tools/board_profiles.py build-all
python3 tools/board_profiles.py package --output dist/pages
```

`package` includes only profiles with `status: verified` and `publish: true`.
`--include-provisional` exists for local installer testing; it must not be used
for a public deployment.

## Current profiles

### AI-Thinker ESP32-CAM

Profile: `esp32-cam-ai-thinker`

| Resource | Configuration |
|---|---|
| ESP-IDF target | `esp32` |
| Flash | 4 MB, DIO, 40 MHz |
| PSRAM | Required, 40 MHz |
| SD interface | SDMMC, 1-bit, 20 MHz |
| SD CLK | GPIO14 |
| SD CMD | GPIO15 |
| SD D0 | GPIO2 |
| Card detect | None |

This is the currently verified profile. One-bit mode avoids using the camera
board's flash LED on GPIO4 and the flash-voltage strapping pin on GPIO12.

### LILYGO TTGO T8 classic ESP32

Profile: `lilygo-ttgo-t8-classic`

| Resource | Configuration |
|---|---|
| ESP-IDF target | `esp32` |
| Flash | 4 MB, QIO, 80 MHz |
| PSRAM | Required, 40 MHz |
| SD interface | SDSPI on SPI2, 20 MHz |
| SD CS | GPIO33 |
| SD MOSI | GPIO14 |
| SD MISO | GPIO12 |
| SD CLK | GPIO27 |
| Card detect | None |

LILYGO's classic T8 repository documents these SD pins alongside the
V1.1/V1.3/V1.7 boards. LILYGO also sold an ESP32-S2 product under the T8 name;
that is a different target and is deliberately not covered by this profile.

References:

- <https://github.com/LilyGO/TTGO-T8-ESP32>
- <https://wiki.lilygo.cc/zh/products/t8-series/t8/>

### AI-Thinker ESP32-A1S Audio Kit v2.2

Profile: `ai-thinker-esp32-a1s-audio-kit-v2-2`

| Resource | Configuration |
|---|---|
| ESP-IDF target | `esp32` |
| Flash | 4 MB, DIO, 40 MHz |
| PSRAM | Required, 40 MHz |
| SD interface | SDMMC, 1-bit, 20 MHz |
| SD CLK | GPIO14 |
| SD CMD | GPIO15 |
| SD D0 | GPIO2 |
| Card detect | GPIO34, active-low, external pull |

The Audio Kit's SD/JTAG DIP switches must route the native SD signals to the
socket. AI-Thinker shipped both AC101 and ES8388 codec populations. PocketArcade
does not initialise the codec, so that difference does not affect this
firmware profile.

References:

- <https://github.com/Ai-Thinker-Open/ESP32-A1S-AudioKit>
- <https://en.ai-thinker.com/pro_view-69.html>

## Promoting a provisional profile

Before changing a profile to `verified` and `publish: true`:

1. Record the exact PCB name and revision printed on the board.
2. Build and flash only that profile.
3. Confirm boot reports the expected flash size and successful PSRAM
   initialisation. Missing PSRAM must stop boot rather than falling back.
4. Confirm the card mounts repeatedly from cold boot.
5. Confirm card capacity and FAT usage are correct in the administrator view.
6. Exercise safe eject, physical removal, reinsertion, and remount behaviour.
7. Run at least one complete two-player game while watching serial logs.
8. Package the installer locally and perform a clean browser flash with desktop
   Chrome or Edge.
9. Verify the post-flash reset returns to PocketArcade and the serial console
   remains usable.

Only then should the public GitHub Pages workflow expose that board's install
button.
