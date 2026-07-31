# Pocket Siege

Pocket Siege is an original two-player slingshot fortress battle for PocketArcade firmware 0.3.0.

## Install

Copy the complete `pocket-siege` directory to:

```text
/apps/pocket-siege/
```

Then remount or restart PocketArcade so the application catalogue is rescanned. Hard-reload each phone browser after updating the client files.

## Package contents

```text
pocket-siege/
├── manifest.json
├── client/
│   ├── app.js
│   └── app.css
├── assets/
│   ├── icon.svg
│   └── splash.jpg
└── server/
    └── main.lua
```

## Match flow

1. The app opens on a PocketArcade-style splash page with game details and a **Join game** button.
2. Two players join the lobby and use the platform Ready button.
3. Each player privately orders Boulder, Splitter, and Bomber projectiles.
4. Both players vote for Dust Canyon, Storm Harbour, or Moonbase Nine.
5. Both players confirm the second Ready step.
6. The game enters fullscreen and alternates five shots per player.
7. Destroying the enemy commander wins immediately. Otherwise, score and remaining commander health decide the result.

Spectators can join after play begins. A player leaving during active battle forfeits to the remaining player.

## Controls

- Drag backwards from your launcher and release to fire.
- Tap **Activate ability** while a Splitter or Bomber is in flight.
- Boulder has no activated ability and deals heavier direct impact damage.

## Version 1.2.0 changes

- Aligned the interface with the current PocketArcade visual style guide and system UI tokens.
- Adopted the platform's deep violet background, purple and teal accent gradient, muted text, focus yellow, glass panels, and subtle 32 px grid texture.
- Replaced heavy raised-button effects with softer 44 px touch controls, clearer hover and pressed states, and consistent keyboard focus rings.
- Restyled lobby, setup, status, selection, battle-control, and result surfaces to match the PocketArcade hierarchy while preserving Coral and Emerald player identities.
- Kept yellow for focus, turn urgency, and winner emphasis rather than using it as the general selection colour.
- Improved disabled controls by retaining their original colour identity and reducing opacity instead of greying or desaturating them.
- Added safe-area-aware top-bar spacing and retained reduced-motion behaviour.
- Updated the visible package version to 1.2.0. Gameplay and authoritative Lua rules are unchanged in this visual-only release.

## Technical profile

- Authoritative Lua simulation at 15 Hz with automatic PocketArcade snapshots.
- Responsive HTML canvas presentation, including PocketArcade fullscreen mode.
- Twenty-four bounded fortress bodies and at most three simultaneous projectiles.
- Local package assets only; no remote fonts, libraries, analytics, network requests, or additional WebSocket.
- Scoped styles and complete listener, animation, fullscreen, and subscription cleanup.
- Active-match ID and snapshot-revision checks on all incoming envelopes.
- Reconnect and controller-transfer recovery through requested authoritative snapshots.

## Checks performed

- Manifest JSON parsed successfully and referenced package paths exist.
- Browser client passed `node --check`.
- Lua source passed a Lua 5.3 bytecode-parser syntax check.
- A Lua harness verified that the second battle-ready command only arms the build, that four bounded tick steps create all 24 bodies, and that every direct support link resolves to a valid body.
- A 240-tick stress run forced all 24 fortress bodies into motion at once and completed without an error in the revised bounded physics path.

The final acceptance test still needs to run on the target ESP32 with separate profiles, spectators, reconnect grace, controller transfer, weak connections, long play, and serial Lua timing/memory logs. A repeatable tick-overrun warning remains a release blocker.
