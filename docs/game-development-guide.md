# PocketArcade game development and deployment guide

This document defines how a game integrates with PocketArcade, what an
independently prepared SD-card package can do in firmware 0.1, and the platform
work still required for independently deployable four-player and realtime
games.

The distinction between **implemented** and **proposed** behaviour is
important:

- **0.1 contract** means the repository and flashed firmware support it now.
- **Target contract** means it is the intended Game SDK design, but it must not
  be used by a released game until the corresponding platform work is
  implemented.

Tic-Tac-Toe is the reference 0.1 package. Its browser presentation is
independently copied to the SD card, but its authoritative rules are currently
compiled into firmware. PocketArcade 0.1 does not execute arbitrary server code
from an SD card.

## 1. Capability summary

| Capability | Firmware 0.1 | Work required |
|---|---|---|
| Discover a game copied to the SD card | Yes | — |
| Serve a game's JavaScript, CSS, images, and audio | Yes | — |
| Mount/unmount a game inside the lobby | Yes | — |
| Reuse the authenticated system WebSocket | Yes | — |
| Read public current-profile and presence data | Yes | Formal SDK facade |
| Deploy new authoritative game rules without reflashing | No | Generic runtime or sandboxed server scripts |
| Generic game commands and events | No | App-aware WebSocket dispatcher |
| Two-player Tic-Tac-Toe plus spectators | Yes | It is hard-coded |
| Generic one-to-four-player seats | No | Match/session service |
| One presence entry for multiple tabs | Yes | Game reconnection policy is still needed |
| Full-page game presentation | No | Shell-controlled display modes |
| Per-game wins/losses/draws/history | No | Generic result/statistics service |
| Aggregate profile win count | Yes | Currently awarded only by compiled game logic |
| Targeted/private game messages | No | Per-profile/per-connection sending |
| Realtime simulation tick, clock sync, and snapshots | No | Realtime transport/runtime work |
| Isolation from the system page and session token | No | Sandboxed game host and capability bridge |
| Offline game validator and browser test harness | No | Game SDK tooling |

The default network capacity—eight Wi-Fi stations, ten tracked WebSockets, and
twelve HTTP/WebSocket sockets—is sufficient for a basic four-phone test.
It does not by itself make a game four-player capable. Multiple tabs,
spectators, asset downloads, and reconnecting sockets must also fit those
bounds and require hardware capacity testing.

## 2. Current SD package contract

### 2.1 Directory layout

One game occupies exactly one application namespace:

```text
/apps/
└── example-racer/
    ├── manifest.json
    ├── app.js
    ├── app.css
    ├── images/
    │   ├── track.webp
    │   └── car-blue.svg
    └── audio/
        └── countdown.ogg
```

Runtime data does not belong beside executable assets. Future platform-managed
game data belongs under:

```text
/data/apps/example-racer/
```

Games must never write directly into `/apps`, `/data/profiles`, another game's
data directory, or a system namespace.

### 2.2 Application ID

The directory and manifest `id` must match after the directory name is
normalised to lowercase. Use lowercase directly to avoid ambiguity.

An ID:

- is 1–48 bytes;
- contains only `a`–`z`, `0`–`9`, and `-`;
- is stable for the lifetime of the game;
- must not be reused for an unrelated game.

Examples:

```text
tic-tac-toe
four-karts
maze2
```

The validator rejects absolute paths, empty path segments, `.`, `..`,
backslashes, control characters, percent-encoded asset paths, and paths which
escape the application directory.

### 2.3 Manifest version 1

Firmware 0.1 accepts a manifest no larger than 4096 bytes:

```json
{
  "manifestVersion": 1,
  "id": "example-racer",
  "name": "Example Racer",
  "description": "A four-player top-down race.",
  "entrypoint": "app.js",
  "stylesheet": "app.css",
  "kind": "game"
}
```

| Field | Required | 0.1 constraint |
|---|---:|---|
| `manifestVersion` | Yes | Number, exactly `1` |
| `id` | Yes | Valid ID, at most 48 bytes, matching directory |
| `name` | Yes | String, at most 64 bytes |
| `description` | No | String or null, at most 160 bytes |
| `entrypoint` | Yes | Safe relative path, at most 96 bytes, file must exist |
| `stylesheet` | No | Safe relative path, at most 96 bytes; omitted if unreadable |
| `kind` | No | String or null, at most 16 bytes; defaults to `application` |

`entrypointUrl` and `stylesheetUrl` are accepted as compatibility aliases, but
new packages should use the relative fields above. The catalogue currently
caches at most 12 valid applications. Unknown manifest fields are ignored.

The catalogue is scanned at boot and after a successful mount, not for every
HTTP request. A malformed package is omitted without preventing the system UI
or other games from loading.

### 2.4 Served assets

A valid package is available only below:

```text
/apps/<application-id>/*
```

Recognised MIME types include JavaScript, CSS, HTML, JSON, SVG, PNG, JPEG,
WebP, MP3, and Ogg. Other extensions are served as
`application/octet-stream`. Assets are streamed from FATFS in 1024-byte chunks
with a 60-second revalidation cache policy.

Do not depend on:

- the internet, a CDN, external fonts, npm packages, or remote APIs;
- direct filesystem paths such as `/sdcard/...`;
- application assets shadowing `/`, `/system/*`, `/api/v1/*`, or `/ws`;
- case-insensitive URLs, even though FAT behaviour may vary;
- an asset remaining readable after the administrator safely ejects the card.

Keep files compact. Pre-compress images and audio on the development computer,
avoid large sprite sheets, and load only what the current view needs.

## 3. Current browser entrypoint pattern

The entrypoint is a classic script loaded into the existing system document.
It registers one module without opening another WebSocket:

```javascript
"use strict";

(() => {
  window.PocketArcadeApps = window.PocketArcadeApps || {};

  window.PocketArcadeApps["example-racer"] = {
    mount(container, arcade) {
      const root = document.createElement("section");
      root.className = "example-racer";
      root.textContent = "Loading race…";
      container.replaceChildren(root);

      const stopPresence = arcade.on("presence.changed", (players) => {
        // Render public player information with textContent.
      });

      const stopState = arcade.on("game.example-racer.state", (state) => {
        // This event requires matching firmware support in 0.1.
      });

      return () => {
        stopPresence();
        stopState();
        container.replaceChildren();
      };
    },
  };
})();
```

The module contract is:

```text
window.PocketArcadeApps[manifest.id].mount(container, arcade)
    -> optional cleanup function
```

`mount` must:

- render only inside the supplied container;
- install bounded listeners and timers;
- tolerate the initial state being absent;
- use `textContent`, attributes, or equivalent safe DOM APIs for user data;
- remain usable on a narrow phone screen;
- return a cleanup function.

The cleanup function must:

- unsubscribe every `arcade.on` listener;
- cancel timers and animation frames;
- stop audio and camera/sensor access;
- remove document-level event listeners;
- release large arrays, images, and canvases;
- not send a game result merely because the view closed.

Closing a game removes its stylesheet and calls cleanup. JavaScript cannot be
unloaded from a browser document, and firmware 0.1 remembers that the script
URL was loaded. Updating a package in place therefore requires a page reload
before a changed `app.js` is guaranteed to execute. This is a platform gap,
not a versioning mechanism games should work around.

### 3.1 CSS and asset pattern

Firmware 0.1 inserts the optional stylesheet into the system document. Prefix
every selector with an application-specific root class:

```css
.example-racer {
  display: grid;
  min-width: 0;
}

.example-racer .race-status {
  color: #f8f6ff;
}
```

Do not style `body`, generic elements, `.primary`, `.card`, system IDs, or
another game's classes. Avoid fixed positioning in the current embedded mode.
Use responsive dimensions, safe contrast, visible focus states, touch targets
of roughly 44 CSS pixels, and `prefers-reduced-motion`.

Capture an asset base URL while the entrypoint is evaluating:

```javascript
(() => {
  const assetBase = new URL(".", document.currentScript.src);

  // Later, inside mount:
  // image.src = new URL("images/track.webp", assetBase).href;
})();
```

This keeps staging paths out of the source. Do not use a Windows path, an SD
mount path, a `file:` URL, or a remote URL. An HTML file may be stored as an
asset, but manifest version 1 loads JavaScript as the entrypoint; it does not
navigate the shell to that HTML file.

### 3.2 Available client state

The object passed as `arcade` currently exposes:

| Surface | Purpose |
|---|---|
| `arcade.profile` | Current public profile; never mutate it directly |
| `arcade.players` | Map of online public profiles keyed by profile ID |
| `arcade.storage` | Current storage state |
| `arcade.on(name, callback)` | Subscribe; returns an unsubscribe function |
| `arcade.send(type, payload)` | Send a version-1 message on the shared socket |
| `arcade.connectionStatus` | Current system connection state |

It also contains Tic-Tac-Toe-specific methods and cached state. Those methods
are reference implementation details, not a generic game SDK.

Games must not:

- instantiate `WebSocket`, duplicate the system handshake, or poll presence;
- read, store, print, or transmit `arcade.token`;
- send player IDs as proof of identity;
- change profile, storage, or system UI state through undocumented internals;
- report their own win as an authoritative fact;
- use `innerHTML` with nicknames, chat, or any other user-controlled value.

Although `arcade.send()` can transmit any string, firmware 0.1 rejects message
types which are not explicitly compiled into `websocket.c`. An SD-only game
cannot add a new server command today.

### 3.3 Connection and error pattern

A game should render its most recent authoritative snapshot while disconnected
but disable state-changing controls:

```javascript
let connected = arcade.connectionStatus === "connected";

const stopConnection = arcade.on("connection.changed", (status) => {
  connected = status === "connected";
  moveButton.disabled = !connected || !isMoveCurrentlyLegal;
  statusNode.textContent = connected
    ? currentGameStatus
    : "Reconnecting…";
});
```

After reconnection, wait for the platform's fresh snapshot. Do not invent a
result from locally cached state and do not create a second player because a
socket changed. Show feature errors in the game view and keep them bounded.
Cleanup must unsubscribe the connection listener too.

## 4. Current shared protocol

Every game continues to use the one authenticated `/ws` connection and the
standard envelope:

```json
{
  "v": 1,
  "type": "game.tictactoe.move",
  "id": 41,
  "payload": {
    "cell": 4
  }
}
```

Authentication, reconnection, sequence IDs, presence, and storage events are
owned by `PocketArcadeClient`. A game subscribes to the high-level events it
needs.

The current Tic-Tac-Toe firmware demonstrates the required authority pattern:

1. The browser requests an action.
2. The WebSocket layer supplies the authenticated profile.
3. The server validates membership, state, turn, and action.
4. The server mutates authoritative RAM state.
5. The server broadcasts a complete snapshot.
6. The server records a win once, after detecting the transition to a won
   state.
7. Profile persistence is queued outside the WebSocket callback.

Seats are keyed by profile ID, not connection ID, so two tabs cannot occupy two
seats. Spectators receive the same public snapshot.

Use this pattern for compiled firmware games, but do not copy its
`game.tictactoe.*` namespace for another game.

## 5. Developing a game against firmware 0.1

There are two supported development levels.

### 5.1 Presentation-only or local game

The game can be entirely on the SD card if its state is local to one browser
and it does not award trusted results. It may use public profile/presence
information for display.

### 5.2 Authoritative multiplayer game

For 0.1, implement:

1. The SD package using the module contract above.
2. A dedicated firmware component which owns game state under a bounded lock.
3. Namespaced constants in `protocol`.
4. Validation and dispatch in the shared WebSocket component.
5. Snapshot/event serialization containing public fields only.
6. Presence-disconnect and profile-update hooks.
7. Server-side result recording and queued persistence.
8. Host tests plus multi-phone hardware acceptance tests.

This requires rebuilding and flashing PocketArcade. It is not yet the desired
fully independent deployment model.

### 5.3 Package author checklist

Before copying a 0.1 package:

- manifest ID and directory match and use only `[a-z0-9-]+`;
- manifest, entrypoint, and optional stylesheet are within their size/path
  limits;
- no external URL, framework, font, analytics, or cloud service is required;
- all selectors are scoped below the game's root class;
- user text is inserted with safe DOM methods;
- one `mount` call creates one view and returns one complete cleanup function;
- no direct WebSocket or session-token access exists;
- buttons are disabled while disconnected or awaiting authority;
- duplicate taps/commands are safe or carry a sequence/idempotency key;
- reconnect starts from a server snapshot;
- a second tab does not create another seat;
- spectators cannot mutate player state;
- SD removal closes or degrades the view without breaking the lobby;
- every image/audio file is compressed and tested on the actual phone browser;
- no browser-generated result is trusted.

### 5.4 Separate game repository pattern

A separately maintained game should keep PocketArcade-ready output in one
copyable directory:

```text
four-karts/
├── README.md
├── package/
│   └── four-karts/
│       ├── manifest.json
│       ├── app.js
│       ├── app.css
│       └── assets/
├── src/
├── tests/
└── tools/
    └── build-package.py
```

Only `package/four-karts/` is copied into the SD card's `/apps/` directory.
Source maps, test fixtures, editor files, original artwork, build caches, and
development credentials must stay outside the package. A build step is
optional; when used, it must work offline and produce deterministic,
self-contained vanilla browser assets. Keep the game repository's platform
compatibility and deployment instructions beside its source.

Once the target server runtime exists, the same package directory will also
contain its declarative or sandboxed server files. Until then, keep the matching
firmware component version documented in the game repository.

## 6. Safe deployment

1. Validate the package on the development computer.
2. In PocketArcade, open **Profile → Admin → Eject SD card**.
3. Wait until the UI says **Safe to remove SD card**.
4. Remove the card and insert it into the computer.
5. Copy the complete directory to `/apps/<application-id>/`.
6. Safely eject the card from the computer.
7. Reinsert it in PocketArcade.
8. Choose **Profile → Admin → Mount SD card** when the board has no card-detect
   pin.
9. Confirm the game appears in `GET /api/v1/apps`.
10. Open it on every participating device and test reconnect and spectator
    behaviour.

To replace a game, copy the complete package rather than partially editing live
files. Never pull a mounted card. PocketArcade's safe-eject path rejects new
writes, drains queued profile/chat operations, waits for active asset reads,
and unmounts FATFS.

Removing a game must not remove its data automatically. A later platform
version should provide an explicit administrator uninstall/data-delete flow.

## 7. Target Game SDK contract

The following design is recommended for the next platform version. It is not
accepted by the current manifest scanner.

### 7.1 Versioned manifest

```json
{
  "manifestVersion": 2,
  "id": "four-karts",
  "name": "Four Karts",
  "version": "1.2.0",
  "minPlatformVersion": "0.2.0",
  "kind": "game",
  "client": {
    "entrypoint": "client/app.js",
    "stylesheet": "client/app.css"
  },
  "display": {
    "mode": "full-page",
    "orientation": "landscape"
  },
  "multiplayer": {
    "minPlayers": 2,
    "maxPlayers": 4,
    "spectators": true,
    "lateJoin": "spectator"
  },
  "runtime": {
    "type": "lua",
    "entrypoint": "server/main.lua",
    "tickRateHz": 20
  },
  "protocol": {
    "version": 1
  },
  "capabilities": [
    "presence.read",
    "match.seats",
    "profile.results.write",
    "storage.app-data"
  ]
}
```

The platform must reject unsupported versions/capabilities before loading any
game code. A catalogue entry should report why a package is incompatible
instead of silently omitting every incompatibility.

### 7.2 Stable, capability-limited client facade

Games should receive a frozen facade rather than the complete system client:

```javascript
const game = {
  app: { id, version },
  profile: { id, nickname, avatarUrl, colour, wins },
  presence: {
    list(),
    subscribe(callback),
  },
  match: {
    join(),
    leave(),
    send(action, data),
    subscribe(callback),
  },
  ui: {
    requestDisplayMode(mode),
    exit(),
    setBackHandler(callback),
  },
  assets: {
    url(relativePath),
  },
};
```

The token, raw WebSocket, administrative API, device identity, filesystem, and
other games' data must not be present.

### 7.3 Generic game messages

The shared socket should retain the system envelope and use a generic,
server-routed game protocol:

Client command:

```json
{
  "v": 1,
  "type": "game.command",
  "id": 73,
  "payload": {
    "appId": "four-karts",
    "matchId": "m_a19f",
    "action": "input",
    "inputSeq": 118,
    "data": {
      "steer": -0.42,
      "throttle": 1
    }
  }
}
```

Authoritative snapshot:

```json
{
  "v": 1,
  "type": "game.snapshot",
  "id": 902,
  "payload": {
    "appId": "four-karts",
    "matchId": "m_a19f",
    "revision": 340,
    "serverTimeMs": 912340,
    "ackInputSeq": 118,
    "state": {}
  }
}
```

Lifecycle and errors:

```text
game.match
game.snapshot
game.event
game.result
game.error
```

The dispatcher derives the sender from the authenticated socket. It must
ignore any client-supplied nickname, role, wins, or claimed identity. Messages
must be routed only to members/spectators of the matching game instance, not
broadcast to every authenticated browser.

### 7.4 Independently deployable authoritative logic

A true SD-only multiplayer game needs a server runtime. Three implementation
tiers are useful:

1. **Declarative engine:** manifests and data describe turns, decks, boards,
   timers, and scoring. Safest and smallest, but unsuitable for arbitrary
   games.
2. **Sandboxed script engine:** a compact runtime such as Lua executes
   `/apps/<id>/server/...` with instruction, memory, tick-time, state-size, and
   storage quotas. It receives only platform capabilities and has no raw
   filesystem, socket, NVS, GPIO, or administrative access.
3. **Native firmware adapter:** C/C++ component for performance-critical games.
   It follows the same match/result interfaces but requires a firmware build.

The recommended platform supports declarative and sandboxed games for
independent deployment, while retaining native adapters for simulations which
cannot meet script budgets. Loading native binaries from SD is not recommended
on ESP32; it greatly expands the security, ABI, crash-isolation, and recovery
surface.

The runtime must:

- bound allocations and execution time per command/tick;
- stop only the faulty game, never reboot the portal;
- expose deterministic/random APIs explicitly;
- namespace data below `/data/apps/<id>/`;
- queue atomic writes through the storage worker;
- prevent writes during safe eject;
- validate every script-produced message and result;
- provide structured errors and bounded logs;
- unload or restart cleanly after a package update.

## 8. One-to-four-player match pattern

A generic match service should own this lifecycle:

```text
closed → waiting → countdown → playing → finished → waiting/closed
```

Required rules:

- `maxPlayers` is validated from 1 to 4.
- Seats are keyed by profile ID, never IP, MAC, token, tab, or socket.
- Join is idempotent: another tab for the same profile observes the same seat.
- A player has at most one seat in a match.
- Spectators are explicit and bounded separately.
- The server chooses or validates seat/team assignment.
- Disconnect starts a game-specific reservation grace period.
- Reconnection with the same profile resumes the seat and receives a snapshot.
- Explicit Leave releases the seat immediately.
- Late join follows the manifest policy: player, spectator, next round, or
  reject.
- The administrator role has no automatic gameplay advantage.
- A profile deletion removes its seat safely.
- Every state carries a monotonic revision so stale events are ignored.
- Private state, such as a hand of cards, uses targeted per-profile messages.

Four-player acceptance must cover:

1. Four different phones join one match.
2. A fifth phone spectates or receives a bounded full response.
3. A second tab for one profile does not consume another seat.
4. One phone disconnects and rejoins inside the grace period.
5. One phone returns after grace expiry.
6. The admin ejects the SD card before, during, and after a match.
7. A player switches or deletes its profile mid-match.
8. All four phones receive the same final revision and result.

## 9. Full-page game views

“Full page” should be a system-shell display mode, not a direct navigation to
an SD HTML file. Direct navigation would lose the established client,
authentication, reconnect logic, and safe exit path.

The target shell should support:

```text
embedded   game card remains inside the lobby
full-page  game stage occupies the viewport; a system overlay remains
```

A full-page stage needs:

- `100dvh` sizing plus safe-area insets;
- a persistent Exit/Back control owned by the flash-hosted shell;
- connection/reconnecting indication;
- controlled portrait/landscape preference with a usable fallback;
- no body scrolling or browser zoom traps;
- explicit keyboard, pointer, touch, and gamepad lifecycle;
- cleanup on Exit, profile switch, storage loss, and authentication failure;
- optional use of the browser Fullscreen API only after a user gesture;
- restoration of lobby scroll/focus when closed;
- `visibilitychange` handling so hidden clients stop rendering/sending input.

For CSS isolation, Shadow DOM is useful but does not protect tokens or system
APIs. The stronger target is a sandboxed iframe with a narrow `postMessage`
bridge. The frame should never receive the session token and should not be
able to navigate or modify the parent shell. This also prevents one game's CSS
and globals from corrupting another game or the account UI.

## 10. Realtime top-down racing pattern

A racing game is feasible only if the ESP32 owns a compact simulation and
clients render smoothly between lower-rate network updates.

Recommended flow:

```text
phone input samples
      ↓
shared WebSocket: latest input + sequence
      ↓
authoritative ESP32 simulation tick
      ↓
bounded state snapshots/deltas
      ↓
client interpolation/prediction at display refresh rate
```

Do not send a player's claimed position, lap win, or collision outcome as
truth. Send controls such as steer, throttle, brake, and an input sequence.
The server applies physics, checkpoints, laps, collisions, and finish order.

Initial practical budgets for four players should be measured rather than
treated as guarantees:

- 20–30 Hz authoritative simulation tick;
- 10–15 Hz snapshots to each client;
- at most 20 input messages per second from each client;
- compact integer/fixed-point state where practical;
- client rendering at 60 Hz using interpolation;
- a full snapshot on join/reconnect and bounded deltas thereafter;
- no SD writes during a race; queue only the validated final result.

Each snapshot needs:

- match and revision IDs;
- monotonic server time or tick;
- the recipient's last acknowledged input sequence;
- position, heading, velocity, race progress, and status for each entity;
- a way to detect a missing delta and request a full snapshot.

The client should:

- keep two or more snapshots for interpolation;
- predict only its own vehicle;
- reconcile gradually unless error is unsafe;
- discard snapshots older than its rendered revision;
- replace stale unsent inputs instead of building an unbounded queue;
- pause input/render work while hidden;
- preload track-critical assets before signalling Ready.

Firmware 0.1 is not ready for this load. Its JSON WebSocket frames are limited
to 2048 bytes by default, input is limited to 20 messages/second per
connection, every game update is globally broadcast, and there is no
backpressure, targeted delivery, tick scheduler, clock synchronisation,
delta protocol, or binary frame support. JSON can remain the control protocol;
compact binary snapshots may be added later without creating a second
WebSocket.

Do not assume PSRAM exists or is enabled merely because some ESP32-CAM modules
include it. The simulation and minimum client service must have explicit
internal-RAM budgets and degrade safely when optional PSRAM is unavailable.

## 11. Results and profile statistics

Only authoritative server/runtime code may submit a result. The browser may
display a finish animation but cannot increment wins.

The target result record should distinguish game-specific statistics from the
public aggregate:

```json
{
  "resultId": "r_f30a",
  "appId": "four-karts",
  "appVersion": "1.2.0",
  "matchId": "m_a19f",
  "finishedAt": 912340,
  "participants": [
    {"profileId": "p_...", "place": 1, "outcome": "win"},
    {"profileId": "p_...", "place": 2, "outcome": "loss"}
  ]
}
```

The server must make `resultId` idempotent, validate participants against the
finished match, update every affected cached profile, broadcast public changes,
and queue one atomic persistence operation. Recommended stored counters are:

```text
aggregate: wins
per game: played, wins, losses, draws, best result, last played
```

Detailed history belongs below `/data/apps/<id>/` and should have retention and
size limits. Public lobby profiles should stay small. A game must not receive
another profile's private history unless that data is deliberately public.

## 12. Security and robustness rules

Current SD JavaScript executes in the same origin and document as the system
shell. Therefore any installed 0.1 package is fully trusted code and can reach
browser internals which were not intended as a public SDK. Install only code
you control until sandboxing is implemented.

Every future game boundary must enforce:

- bounded manifest, message, state, asset, memory, timer, and storage sizes;
- no client-supplied identity or results;
- server validation of state transitions and numeric ranges;
- capability-scoped APIs;
- per-game and per-connection rate limits;
- targeted messages for secrets;
- no raw token, MAC, fingerprint, IP, filesystem, or NVS access;
- path validation and application data isolation;
- safe text rendering and a restrictive content policy;
- clean cancellation when storage unmounts;
- fault containment so one game cannot stop Wi-Fi, lobby, chat, or profiles.

## 13. Required platform backlog

### P0 — required for independently deployed multiplayer games

1. Introduce a versioned Game SDK facade and generic `game.*` dispatcher.
2. Add a bounded match/session service with 1–4 seats, spectators, explicit
   lifecycle, reconnection reservations, and profile-based membership.
3. Choose and implement the independent authoritative runtime:
   declarative engine, sandboxed Lua, or both.
4. Add broadcast-to-match, targeted-to-profile, and reply-to-connection sends
   with bounded queues and slow-client handling.
5. Add server-authoritative generic results and per-game statistics.
6. Add shell-managed embedded/full-page display modes and reliable cleanup.
7. Isolate game code from the system token and DOM, preferably with a
   sandboxed frame and message bridge.

### P1 — required for a supportable third-party SDK

1. Manifest v2 with game version, platform compatibility, display,
   multiplayer, runtime, protocol, and capability declarations.
2. Package validation which reports precise errors in the admin UI.
3. Cache/version invalidation and an explicit update/uninstall lifecycle.
4. Asset preloading/progress APIs and package size guidance.
5. Per-app storage quotas and atomic game-data APIs.
6. A desktop package validator, mock PocketArcade client, browser preview
   harness, schema files, and example tests.
7. Defined compatibility/deprecation policy for manifests, client APIs,
   messages, and stored data migrations.

### P2 — required before claiming realtime racing support

1. Fixed-rate simulation scheduler with execution budgets.
2. Server tick/time synchronisation, input sequences, acknowledgements, full
   snapshots, and deltas.
3. Per-client output queues, coalescing, backpressure, and slow-client
   disconnection.
4. Compact/binary snapshot support on the existing WebSocket where JSON cannot
   meet measured budgets.
5. Load tests for four players plus spectators, reconnect storms, SD activity,
   and weak phones.
6. CPU, heap, internal RAM, optional PSRAM, Wi-Fi airtime, frame-size, and
   latency telemetry.

## 14. Definition of done for the Game SDK

PocketArcade can claim independently developed games when a developer can:

1. create a package using only published schemas and SDK files;
2. validate and preview it without the ESP-IDF repository;
3. copy it to a card and mount it without reflashing firmware;
4. run its authoritative rules without access to system secrets;
5. admit one to four profiles plus bounded spectators;
6. survive duplicate tabs, reconnects, profile changes, and storage loss;
7. use embedded or full-page presentation through the same system client;
8. record an idempotent authoritative result and persistent per-game stats;
9. fail or exceed a resource limit without crashing the PocketArcade shell;
10. pass the published multi-device and realtime acceptance suites.

Until those conditions are met, describe SD packages as independently
deployable **browser presentations**, with their multiplayer server logic
provided by the matching firmware.
