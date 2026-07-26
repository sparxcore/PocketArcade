# Acceptance-test checklist

Record target, ESP-IDF version, board revision, flash size, selected SD
interface, GPIOs, and card model with the result.

For an AI-Thinker ESP32-CAM, build with
`tools/build_esp32_cam_ai_thinker.sh`; the preset uses its onboard card slot in
1-bit SDMMC mode. Confirm the PCB variant before applying that preset.

## Build

- [ ] Clean build succeeds with `sdkconfig.ci.sd-disabled`.
- [ ] Clean build succeeds with `sdkconfig.ci.sdmmc`.
- [ ] Clean build succeeds with `sdkconfig.ci.sdspi`.
- [ ] Firmware flashes and reaches the `SYSTEM ... Ready` log.
- [ ] Host tests and optional Node syntax checks pass.

## Network and portal

- [ ] `PocketArcade` appears as an open network by default.
- [ ] Configuring an 8–63-byte password enables WPA2/WPA3 protection.
- [ ] Client receives `192.168.4.x`; gateway is `192.168.4.1`.
- [ ] Android captive check opens/redirects without a loop.
- [ ] `/captive-portal` returns `application/captive+json` with `captive: true`.
- [ ] Apple captive check opens/redirects without a loop.
- [ ] Windows captive check opens/redirects without a loop.
- [ ] `http://192.168.4.1/` always loads.
- [ ] Association/disassociation does not reboot the ESP32.
- [ ] No full MAC appears at normal log level.

## Embedded UI and no-card mode

- [ ] Remove/disable SD and reboot.
- [ ] Setup, CSS, JS, icon, health, storage, and apps endpoints load.
- [ ] Storage reports unmounted/disabled and UI explains RAM-only persistence.
- [ ] Create/edit a nickname and enter lobby.
- [ ] Restart proves a temporary profile is gone without causing a crash.
- [ ] No app manifest or card content can replace `/` or `/system/*`.

## Profiles and recognition

- [ ] Nickname rejects empty, control, invalid UTF-8 API input, and >24 code points.
- [ ] Nickname HTML-like text displays literally.
- [ ] New profile response returns a token but `/players` never does.
- [ ] Reload restores by saved session token.
- [ ] Remove the token only; matching station restores by device and rotates token.
- [ ] Change/private Wi-Fi address causes safe setup/token fallback, not denial.
- [ ] Same device binding collision requires explicit replacement confirmation.
- [ ] **Switch player** removes current binding and returns to setup.
- [ ] Clearing storage alone may restore (documented); switching does not.
- [ ] **Delete profile** removes profile, bindings, sessions, file, and sockets.
- [ ] Profile files contain HMAC fingerprints but no raw MAC.
- [ ] First profile to authenticate after boot receives `role: admin`.
- [ ] Restart clears the role and assigns it to that session's first login.
- [ ] Non-admin storage mount/eject requests return `403 admin_required`.
- [ ] **Profile → Admin** provides mount/eject only to the administrator.

## Presence and WebSocket

- [ ] Two devices show one another in realtime.
- [ ] Two tabs for one profile produce one player entry.
- [ ] Closing one of two tabs produces no departure.
- [ ] Quick reconnect inside grace produces no duplicate leave/join.
- [ ] Closing all tabs produces `presence.left` after the configured grace.
- [ ] Nickname update produces `presence.updated`.
- [ ] Phone camera/gallery image becomes a cropped avatar for every client.
- [ ] Android camera capture decodes without a CSP/blob error.
- [ ] Avatar survives restart and its JPEG is present in `/data/avatars`.
- [ ] Oversized, malformed-base64, and non-JPEG avatar bodies are rejected.
- [ ] Malformed/oversized/rate-limited frames fail safely.
- [ ] Network loss shows reconnecting and state is preserved.
- [ ] Lobby count/list include the current profile.
- [ ] Chat is realtime, safely escaped, and never exceeds 50 messages.
- [ ] A Tic-Tac-Toe win increments only the winner, exactly once.
- [ ] Win count persists across restart and updates every connected lobby.
- [ ] Profile-pill and lobby roundels change colour/shape at configured tiers.

## SD application: Tic-Tac-Toe

- [ ] Copy `sdcard-example/apps/tic-tac-toe` to `/apps/tic-tac-toe`.
- [ ] Mounting makes its cached launcher entry appear.
- [ ] X/O can join and make only valid alternating moves.
- [ ] A third player sees every update as a spectator.
- [ ] The SD application opens no additional WebSocket.

## SD storage

- [ ] Correctly wired SDMMC 1-bit mount reports type/capacity/free bytes.
- [ ] If wired, SDMMC 4-bit mode mounts.
- [ ] Correctly wired SDSPI mode mounts.
- [ ] Missing directories are created.
- [ ] Blank/unformatted card is formatted once and the full directory tree is
      created automatically.
- [ ] Communication or I/O failure does not trigger formatting.
- [ ] Persistent profile survives reboot.
- [ ] Interrupted/full-card write preserves the previous valid file.
- [ ] Malformed profile file is logged/skipped.
- [ ] With card-detect, insertion/removal broadcasts storage events.
- [ ] **Eject SD card** reports safe-to-remove only after queued writes drain.
- [ ] ESP32-CAM reinsertion plus **Mount SD card** restores storage/apps.
- [ ] SD failure/removal never loses the flash UI or causes a reboot loop.
