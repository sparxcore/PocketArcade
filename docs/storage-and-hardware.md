# Storage and board configuration

## Two tiers

The complete shell, CSS, JavaScript client, setup/lobby/recovery UI, protocol
constants, captive welcome page, and its compressed portrait/landscape artwork
are embedded in firmware. They never read from SD and cannot be replaced by
card content.

NVS stores only the local device secret and is reserved for small system
configuration/migration values. It is not the user database.

FATFS mounts removable storage at `/sdcard`. On success, the storage worker
creates the required apps/data/profile/avatar/chat/log directories. Profiles
use one JSON file each. The worker writes a temporary file, flushes and syncs
it, moves an existing file to a backup, renames the temporary file, restores
the backup if replacement fails, and removes the backup on success.

## SDMMC

In `idf.py menuconfig → PocketArcade`:

1. Select **Native SDMMC**.
2. Select 1-bit mode unless the slot wiring definitely exposes D1–D3.
3. Set the clock (20 MHz default; lower it for signal-integrity diagnosis).
4. Enter CLK, CMD, D0, and—for 4-bit—D1, D2, D3 from the board schematic.
5. Configure card-detect and power-control if present.

Classic ESP32 has fixed native-slot routing represented by `-1` defaults.
ESP32-S2/S3 matrix-routed targets require explicit CLK/CMD/D0. Required SD pull
ups are a hardware responsibility; consult the board schematic.

## SDSPI

1. Select **SDSPI**.
2. Select SPI2 or SPI3, ensuring the host is not used by another peripheral.
3. Enter MOSI, MISO, CLK, and CS from the board schematic.
4. Configure optional card-detect/power.

The checked-in `sdkconfig.ci.sdspi` pins exist only to exercise compilation.
They are not safe wiring advice.

## Disabled mode

Select **Disabled** to compile without SDMMC/SDSPI calls. Health/storage APIs
report `interface: "disabled"` and setup clearly marks profiles temporary.

## AI-Thinker ESP32-CAM preset

The common AI-Thinker ESP32-CAM onboard slot follows the classic ESP32 fixed
SDMMC assignment:

| SD signal | GPIO |
|---|---:|
| CLK | 14 |
| CMD | 15 |
| D0 | 2 |
| D1 | 4 |
| D2 | 12 |
| D3 | 13 |

Use `sdkconfig.board.esp32-cam-ai-thinker` through:

```sh
./tools/build_esp32_cam_ai_thinker.sh
```

The preset uses **1-bit SDMMC**, so active signals are only GPIO14, GPIO15, and
GPIO2. This avoids GPIO4, which also drives the onboard flash LED, and GPIO12,
which is a flash-voltage strapping pin. The card socket still supplies the
required pull-ups on its unused data lines.

PocketArcade v0.1 does not initialise or use the ESP32-CAM's OV2640 camera.
Profile photos are taken or selected on each player's phone, resized there, and
stored as compact JPEGs under `/data/avatars`.

Most bare ESP32-CAM modules have no USB-to-UART bridge. To flash one manually,
connect a 3.3 V logic USB-UART adapter with TX→U0R/GPIO3, RX→U0T/GPIO1, and a
common ground. Hold GPIO0 low while resetting/powering up, flash, then release
GPIO0 and reset again for normal boot. Power the module from a stable supply;
do not assume a USB-UART adapter's 3.3 V regulator can supply Wi-Fi current.

## Card preparation and live changes

Use FAT16/FAT32, or insert a blank card for automatic first-use provisioning.
With **Format cards without a mountable FAT filesystem** enabled (the default),
ESP-IDF partitions and formats a card only after FatFs reports that no
mountable FAT volume exists. This includes blank media, unsupported filesystems
such as exFAT, and damaged FAT metadata, so disable the option when preserving
or recovering existing data matters. Timeouts, communication failures,
write-protection, and I/O errors never trigger formatting.

After mounting, PocketArcade verifies or creates every required apps, profile,
avatar, chat, app-data, and log directory before declaring persistent storage
available. A dedicated card-detect input provides reliable live mount/unmount
events. Without it, initial mounting and periodic retry are available, but
physical removal cannot be detected reliably by software; power down before
removal unless it has first been unmounted.

Choose **Eject SD card** and wait for **Safe to remove SD card** before removal.
PocketArcade rejects new writes, drains queued writes, waits for active
`/apps/*` reads, and unmounts FATFS. After copying applications on a computer
and reinserting the card, choose **Mount SD card**. Boards configured with a
card-detect pin also remount automatically. Pulling a mounted card can damage
FAT metadata.

Games are prepared independently and copied to `/apps/<application-id>/`. The
reference package is `sdcard-example/apps/tic-tac-toe/` and contains
`manifest.json` plus `client/` and `server/` directories. Firmware validates
and caches manifests; card content cannot shadow the flash-hosted shell.

Mount failure, corruption, full-card writes, queue exhaustion, and removal are
logged and reported without taking down Wi-Fi, HTTP, embedded UI, RAM profiles,
or presence.

## Exact real-board bring-up

For an AI-Thinker-layout ESP32-CAM, the checked-in preset supplies the SD
wiring. The remaining board-specific work is:

1. Confirm the PCB is the classic AI-Thinker ESP32-CAM layout, not a lookalike.
2. Format a microSD card as FAT32 and insert it before boot.
3. Build with `tools/build_esp32_cam_ai_thinker.sh`.
4. Flash over UART, release GPIO0, reset, and verify the mount/capacity log.
5. Run the hardware acceptance checklist.

If the module is another ESP32-CAM variant, read its schematic and instead set
the interface, GPIOs, bus width, and optional detect/power pins in
`menuconfig`.
