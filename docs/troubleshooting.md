# Troubleshooting

## `idf.py` is not found

Activate the ESP-IDF environment (`export.sh` on Unix/WSL or the Espressif
PowerShell/cmd shortcut on Windows). This repository does not vendor ESP-IDF.

## App partition does not fit

Confirm a 4 MB or larger flash setting. The v0.1 factory-only partition table
does not provide OTA slots. If a board has more flash, it may use a custom
partition layout; keep NVS and the factory app.

## AP does not appear

Monitor `SYSTEM` and `WIFI_AP` logs. Check target selection, regulatory channel,
password length, and client limit. The default is an open network on channel 1
with eight clients. A configured password must contain 8–63 bytes.

## Portal does not open

Remain connected despite the phone's “no internet” notice and open
`http://192.168.4.1/`. Disable mobile-data auto-switching if the OS leaves the
AP. Captive behavior varies by OS and is never the only entry path.

## `play.local` does not open

Use `192.168.4.1`. Some operating systems reserve `.local` exclusively for
multicast DNS, while PocketArcade v0.1 provides the convenience answer through
its AP DNS. Normal operation deliberately does not depend on the name.

## Device restoration misses

Token restoration still works. DHCP mapping may not yet be populated, or the
phone may have changed its private Wi-Fi address. Refresh once, or create/switch
the player. Never send a MAC from browser code.

## Wrong player is restored

Open the account pill and choose **Switch player**. This calls the
authenticated unbind endpoint,
clears local storage/cache, closes the socket, and returns to setup. Merely
clearing browser data can allow device fallback to restore again.

## SD card does not mount

- Confirm the selected interface and exact schematic GPIOs.
- Confirm FAT32 and required pull-ups.
- Reduce clock to 10 MHz.
- For SDMMC, try 1-bit mode.
- Check power-enable/card-detect polarity.
- Ensure an SDSPI host is not already occupied.

The embedded UI, chat, presence, and temporary profiles remain operational.

## Game does not appear

Safely eject the card and verify `/apps/tic-tac-toe/` contains
`manifest.json`, `app.js`, and `app.css`. The directory and manifest ID must
both be `tic-tac-toe`. Reinsert and choose **Mount SD card**. Invalid manifests
are ignored and logged with `APPS`.

## Removing the SD card

Do not pull it while the UI says **SD storage available**. Choose **Eject SD
card** and wait for **Safe to remove SD card**. The ESP32-CAM has no card
detect, so choose **Mount SD card** after reinsertion. If it was pulled while
mounted, check and repair the FAT32 card on a computer before relying on it.

## Profile does not persist

The lobby labels a temporary profile. Check `/api/v1/storage`, mount logs,
free space, and `STORAGE` queue/write errors. Recreate a profile after storage
is available; v0.1 does not silently convert an already-created RAM profile.

## Repeated reconnecting

Check Wi-Fi signal and HTTP socket limits. Multiple tabs share a profile but
still consume sockets. The client backs off to 30 seconds, and presence waits
the configured grace period before broadcasting departure.
