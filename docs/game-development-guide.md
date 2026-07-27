# PocketArcade game development guide

This guide describes the game-package contract implemented by PocketArcade
firmware 0.3.0. Event-driven and fixed-tick multiplayer games can keep their
browser client and authoritative Lua rules entirely on the SD card. They do
not need game-specific firmware code.

The [Tic-Tac-Toe package](../sdcard-example/apps/tic-tac-toe/) is the
reference implementation.

The [PocketBlocks package](../sdcard-example/apps/pocketblocks/) is the
fixed-tick example. It exercises the Phase 3 scheduler, compact snapshots,
sequencing, coalescing, and recovery behavior. Reference packages illustrate
the contract, but new games must also follow the lifecycle, resource, and test
requirements in this guide.

## Package layout

Put one complete game beneath `/apps/<application-id>/`:

```text
/apps/example-game/
├── manifest.json
├── client/
│   ├── app.js
│   └── app.css
├── assets/
│   └── icon.svg
└── server/
    └── main.lua
```

Only `manifest.json`, the client entrypoint, and the Lua entrypoint are
required. The stylesheet and other assets are optional.

The application ID:

- is 1–48 bytes;
- contains only lowercase `a`–`z`, digits, and `-`;
- must match the lowercase-normalised package directory name;
- should remain stable across releases of the game.

Use the exact lowercase ID for both names. Do not accidentally copy an extra
directory level such as `/apps/example-game/example-game/manifest.json`.

Manifest and asset paths are relative to the package. Absolute paths, `.` or
`..` segments, empty segments, backslashes, control characters, and URL
encoding are rejected. Client and runtime paths are at most 96 bytes.

Runtime data does not belong in the package directory. With the appropriate
capability, firmware stores it beneath:

```text
/data/apps/<application-id>/
```

## Manifest version 2

Use this as a starting point for an event-driven game:

```json
{
  "manifestVersion": 2,
  "id": "example-game",
  "name": "Example Game",
  "description": "A short launcher description.",
  "version": "1.0.0",
  "minPlatformVersion": "0.3.0",
  "kind": "game",
  "client": {
    "entrypoint": "client/app.js",
    "stylesheet": "client/app.css"
  },
  "runtime": {
    "type": "lua",
    "entrypoint": "server/main.lua",
    "mode": "event"
  },
  "multiplayer": {
    "minPlayers": 2,
    "maxPlayers": 4,
    "spectators": true,
    "lateJoin": "spectator",
    "reconnectGraceMs": 30000
  },
  "protocol": {
    "version": 1
  },
  "capabilities": [
    "match.seats",
    "match.results"
  ]
}
```

### Manifest fields

| Field | Requirement |
|---|---|
| `manifestVersion` | Integer `2` for a Lua game |
| `id` | Valid application ID matching the package directory |
| `name` | Required string, at most 64 bytes |
| `description` | Optional string or `null`, at most 160 bytes |
| `version` | Required three-part numeric version, for example `1.2.0`; at most 31 bytes |
| `minPlatformVersion` | Required three-part numeric version no newer than the firmware |
| `kind` | Must be `"game"` for the game dispatcher to admit joins |
| `client.entrypoint` | Required readable file inside the package |
| `client.stylesheet` | Optional file inside the package |
| `runtime.type` | Must be `"lua"` |
| `runtime.entrypoint` | Required non-empty Lua source file inside the package |
| `runtime.mode` | `"event"` or `"tick"` |
| `runtime.tickRateHz` | Required positive integer in tick mode |
| `multiplayer.minPlayers` | Positive integer |
| `multiplayer.maxPlayers` | Positive integer, not lower than the effective minimum |
| `multiplayer.spectators` | Boolean |
| `multiplayer.lateJoin` | `"spectator"` or `"reject"` |
| `multiplayer.reconnectGraceMs` | Non-negative integer |
| `protocol.version` | Integer `1` |
| `capabilities` | Required array containing only supported names |

The manifest is limited to 4096 bytes. The catalogue currently holds up to 12
valid applications.

Requested values are never trusted directly. Firmware clamps player counts to
four, tick rate to 30 Hz, and reconnect grace to 60 seconds. A request which is
still inconsistent after clamping, such as an effective minimum greater than
the effective maximum, is rejected. The `/api/v1/apps` catalogue reports
effective values.

The supported capability names are:

| Capability | Lua surface |
|---|---|
| `presence.read` | Accepted and reserved; no additional Lua method is exposed in 0.3.0 |
| `match.seats` | `match.players()` and `match.start_countdown()` |
| `match.results` | `match.finish(result)` |
| `storage.app-data` | `storage.read()` and `storage.write()` |

An unknown capability rejects the package. Transport, clock, random, and
bounded logging do not currently require a manifest capability.

Manifest v1 remains readable for old launcher applications, but it does not
describe an SD-hosted Lua runtime. New authoritative games must use version 2.

### Why a package might not appear

An invalid package is omitted from the launcher without affecting other
applications. The serial log uses the `APPS` tag and reports reasons such as a
directory/ID mismatch, missing entrypoint, unsupported protocol, invalid
runtime metadata, or oversized script.

The required client and runtime files must already exist when the catalogue is
scanned. A missing optional stylesheet is omitted rather than preventing the
application from appearing.

## Browser client

The client entrypoint is a classic script. It registers one module under its
application ID:

```javascript
"use strict";

(() => {
  window.PocketArcadeApps = window.PocketArcadeApps || {};

  window.PocketArcadeApps["example-game"] = {
    mount(container, arcade) {
      let activeMatch = null;
      let latestSnapshotRevision = -1;
      let result = null;

      const root = document.createElement("section");
      root.className = "example-game";

      const status = document.createElement("p");
      status.textContent = "Choose Join to play.";

      const join = document.createElement("button");
      join.type = "button";
      join.textContent = "Join game";
      join.addEventListener("click", () => {
        arcade.game.join("example-game");
      });

      const ready = document.createElement("button");
      ready.type = "button";
      ready.textContent = "Ready";
      ready.addEventListener("click", () => {
        if (activeMatch) arcade.game.ready(activeMatch.matchId);
      });

      const leave = document.createElement("button");
      leave.type = "button";
      leave.textContent = "Leave";
      leave.addEventListener("click", () => {
        if (activeMatch) arcade.game.leave(activeMatch.matchId);
      });

      root.append(status, join, ready, leave);
      container.replaceChildren(root);

      function renderGame(payload) {
        // Render only the supplied authoritative payload.
        void payload;
      }

      function clearMatchState() {
        activeMatch = null;
        latestSnapshotRevision = -1;
        result = null;
        renderGame(null);
        status.textContent = "Choose Join to play.";
      }

      function acceptMatch(match) {
        if (match.you?.role === "none") {
          if (!activeMatch || match.matchId === activeMatch.matchId) {
            clearMatchState();
          }
          return;
        }
        if (!activeMatch || match.matchId !== activeMatch.matchId) {
          clearMatchState();
        }
        activeMatch = match;
        status.textContent = `${match.state}: ${match.you.role}`;
      }

      const stopMatch = arcade.game.onMatch((match) => {
        acceptMatch(match);
      });

      const stopSnapshot = arcade.game.onSnapshot((snapshot) => {
        if (!activeMatch || snapshot.matchId !== activeMatch.matchId) return;
        const revision = Number(snapshot.revision);
        if (!Number.isFinite(revision) ||
            revision < latestSnapshotRevision) return;
        latestSnapshotRevision = revision;
        renderGame(snapshot.payload);
      });

      const stopResult = arcade.game.onResult((nextResult) => {
        if (!activeMatch || nextResult.matchId !== activeMatch.matchId) return;
        result = nextResult;
        status.textContent = "Match finished.";
      });

      const stopError = arcade.game.onError((error) => {
        if (error.matchId &&
            (!activeMatch || error.matchId !== activeMatch.matchId)) return;
        if (error.code === "match_not_found") {
          clearMatchState();
        }
        status.textContent = error.message;
      });

      const cachedMatch = arcade.game.currentMatch();
      if (cachedMatch && cachedMatch.you?.role !== "none") {
        acceptMatch(cachedMatch);
        if (cachedMatch.state !== "finished") {
          arcade.game.requestSnapshot(cachedMatch.matchId);
        }
      }

      return () => {
        stopMatch();
        stopSnapshot();
        stopResult();
        stopError();
        activeMatch = null;
        result = null;
        container.replaceChildren();
      };
    },
  };
})();
```

`mount(container, arcade)` may return a cleanup function. Cleanup must
unsubscribe callbacks, remove document-level listeners, stop audio and sensor
access, cancel timers and animation frames, and release large buffers. Closing
the view does not automatically leave a match; call `leave` if that is the
game's intended behaviour.

Insert nicknames and all other user-controlled values with `textContent` or
equivalent safe DOM methods. Prefix every CSS selector with an
application-specific root class so game styles do not alter the lobby.

Capture an asset base while the script is evaluating:

```javascript
const assetBase = new URL(".", document.currentScript.src);
const iconUrl = new URL("../assets/icon.svg", assetBase).href;
```

Do not depend on internet access, CDNs, remote fonts, analytics, or cloud
services. Game assets are served only from `/apps/<application-id>/`.
PocketArcade is a resource-constrained access point, so keep assets modest,
load them before joining realtime play, and avoid HTTP polling or deferred
asset downloads during a match.

### Scoped Game SDK

The `arcade` object contains a sanitised public `profile` getter and a frozen,
application-scoped game facade:

```text
arcade.profile
arcade.connectionStatus
arcade.onConnection(callback)

arcade.display.requestFullscreen()
arcade.display.exitFullscreen()
arcade.display.fullscreen
arcade.display.onFullscreenChange(callback)

arcade.game.join(appId)
arcade.game.leave(matchId)
arcade.game.ready(matchId)
arcade.game.send(matchId, action, data)
arcade.game.claimControl(matchId)
arcade.game.requestSnapshot(matchId)
arcade.game.currentMatch()
arcade.game.currentSnapshot()

arcade.game.onMatch(callback)
arcade.game.onSnapshot(callback)
arcade.game.onEvent(callback)
arcade.game.onResult(callback)
arcade.game.onError(callback)
```

Each subscription returns an unsubscribe function. The callbacks are scoped to
the current application, not to one match. A callback may therefore receive a
delayed message from an earlier match of the same application. Every handler
must compare `matchId` with the active match before changing UI or local state.
Operations on a match owned by another application return `false`.

### Fullscreen presentation

Games can explicitly ask the PocketArcade shell to use the complete browser
viewport:

```javascript
const stopFullscreen = arcade.display.onFullscreenChange((fullscreen) => {
  root.classList.toggle("fullscreen", fullscreen);
});

playButton.addEventListener("click", () => {
  arcade.display.requestFullscreen();
});

menuButton.addEventListener("click", () => {
  arcade.display.exitFullscreen();
});
```

`requestFullscreen()` and `exitFullscreen()` return `true` only while that
application is the active mounted view. `arcade.display.fullscreen` reports
the current shell state. The callback runs when the state changes.
`onFullscreenChange()` returns an unsubscribe function.

This is PocketArcade's reliable, viewport-filling presentation mode; it does
not invoke the browser Fullscreen API and therefore does not depend on browser
permission or a user-gesture policy. The game decides when it is useful. For
example, enter when active play begins and exit when returning to a menu. Do
not request it unconditionally from `mount()` merely because the application
was opened.

PocketArcade always presents a shell-owned **Exit fullscreen** button, and the
Escape key also exits on keyboards. Closing the game, switching applications,
losing the active profile, or a failed mount restores the normal shell
automatically. A facade retained by an unmounted application cannot change the
display mode.

Fullscreen changes the size of the supplied container. Use responsive CSS,
percentage sizing, or `ResizeObserver`; do not cache the viewport dimensions
at mount time. Keep important game controls clear of the top-right safe area,
where the shell exit button is displayed. A game may call
`arcade.display.exitFullscreen()` during cleanup, but shell cleanup does not
depend on it.

`currentMatch()` and `currentSnapshot()` are cache lookups for convenient view
restoration. They are not proof of current membership: a cached match may be
finished or may have `you.role == "none"` after an explicit leave. Validate
`you.role` and `matchId` before using cached state.

When the WebSocket closes, the SDK clears its match, snapshot, and input
sequence caches before reconnecting. It emits one final client-generated
`onMatch` update for each previously cached match with `state == "closed"`,
`you.role == "none"`, and `you.controller == false`. Treat every other field
in that synthetic update, including a retained seat number, as stale. During
the reconnect attempt `currentMatch()` and `currentSnapshot()` return `null`.
Do not preserve the old match ID elsewhere or send Ready, Leave, control, or
game commands until a fresh authoritative `onMatch` update restores
membership.

The command methods return a boolean indicating whether the browser could send
the request. They are not promises and do not mean the firmware accepted the
operation. Handle authoritative state through snapshots and handle rejection
through `onError`.

An error with code `match_not_found` means the referenced match is no longer
authoritative. It may have finished, faulted, closed, or been replaced while a
request was in flight. If the error refers to the active match, clear its local
state and either wait for authoritative reconnect state or offer a fresh
`arcade.game.join()` action. Never retry the request with the old match ID.

The facade does not expose authentication tokens, connection IDs, raw socket
methods, chat, administrative APIs, or direct storage mutation. In 0.3.0 the
classic script still executes in the system document, so installed browser
code must be trusted. A sandboxed-frame capability bridge is planned for
Phase 5.

### Match messages and lifecycle

`onMatch` receives an application-neutral membership snapshot:

```json
{
  "appId": "example-game",
  "appVersion": "1.0.0",
  "matchId": "m_1234abcd",
  "state": "waiting",
  "revision": 4,
  "seats": [
    {
      "seat": 1,
      "ready": true,
      "connected": true,
      "player": {
        "profileId": "p_...",
        "nickname": "Alex",
        "wins": 3,
        "avatarUrl": "/api/v1/avatars/p_....jpg"
      }
    },
    {
      "seat": 2,
      "ready": false,
      "connected": true,
      "player": {
        "profileId": "p_...",
        "nickname": "Sam",
        "wins": 1,
        "avatarUrl": null
      }
    },
    {
      "seat": 3,
      "ready": false,
      "connected": false,
      "player": null
    },
    {
      "seat": 4,
      "ready": false,
      "connected": false,
      "player": null
    }
  ],
  "spectators": [
    {
      "profileId": "p_...",
      "nickname": "Taylor",
      "wins": 0,
      "avatarUrl": "/api/v1/avatars/p_....jpg"
    }
  ],
  "you": {
    "role": "player",
    "seat": 1,
    "controller": true
  }
}
```

Every occupied `seats[].player` and every entry in `spectators[]` uses the same
public match-profile shape: `profileId`, `nickname`, `wins`, and `avatarUrl`.
`avatarUrl` is the system-relative profile-avatar endpoint when a photo exists
and `null` otherwise. The SDK preserves this field in its cached and delivered
`game.match` object. Reconnect/full membership updates use the same shape, and
changing a profile photo while the match is active produces a new
`game.match` revision. Rendering should still provide an initials fallback for
`null` or an image-load failure.

The authoritative firmware states visible in this release are `waiting`,
`countdown`, `playing`, and `finished`. The SDK additionally emits the
client-only state `closed` when a WebSocket connection is lost, as described
above. A match begins in `waiting`. When at least `minPlayers` seats are
occupied and every occupied player is ready, firmware changes it to `playing`.
Readiness cannot currently be withdrawn.

Lifecycle is not strictly forward-only. A membership change can make the
readiness/minimum-player condition false and move a non-finished match back to
`waiting`. In particular, a player leaving during a game-specific countdown
can stop the tick scheduler before that countdown completes. Lua and browser
state must both tolerate `playing → waiting → playing`, including replacement
players occupying newly open seats.

Seats are keyed by authenticated profile ID, not browser tab or socket. Joining
again is idempotent. A second tab observes the same seat and receives match
state, but only the tab holding the controller lease may send commands.
`claimControl` transfers that lease and requests a fresh snapshot.

When a controller disconnects, another connected tab for that profile becomes
controller automatically. Otherwise the seat remains reserved for
`reconnectGraceMs`. Reconnection restores the same seat and triggers a targeted
full snapshot. Explicit `leave` releases the seat immediately.

After a successful explicit leave, firmware sends the leaving connection one
last `game.match` update for the old match with `you.role` set to `"none"`,
`you.seat` set to `null`, and `you.controller` set to `false`. This update is
the authoritative leave acknowledgement. Clear that match's snapshots,
revision watermark, result, input state, timers, and controls. Do not keep the
old match truthy merely because a `game.match` object still exists.

Players may join an open seat only while the match is `waiting`. Later joins
follow `lateJoin`: they become bounded spectators when that is enabled, or are
rejected. The default firmware capacity is four spectator profiles. Spectators
receive snapshots and events but never player command authority.

In a game where `minPlayers` is lower than `maxPlayers`, do not automatically
mark the first arrivals ready if the game must wait for every possible seat:
the platform starts as soon as the effective minimum and all currently
occupied readiness conditions are met.

### Commands, snapshots, and events

Send game intent, never claimed authoritative state:

```javascript
arcade.game.send(match.matchId, "move", {
  direction: -1,
});
```

`action` is 1–32 bytes. `data` must be an object and its compact JSON form must
fit the advertised command limit. The SDK supplies a non-zero monotonic
`inputSeq`; games do not supply profile identity or sequence numbers.

Firmware derives identity from the authenticated WebSocket, checks membership
and the controller lease, rejects stale sequences and excess command rate,
then copies accepted work to a bounded queue. Lua never runs in the WebSocket
callback.

The command limit is one aggregate budget per player profile, not a separate
budget for each button or action. Touch repeat, keyboard repeat, multitouch,
initial presses, and one-shot actions all count. Coordinate repeat controls
through one input scheduler and leave headroom below the advertised limit. For
the default 20-command/second limit, do not configure two independently held
controls which can together exceed 20. Stop repeat work on pointer cancellation,
loss of control, view cleanup, connection loss, and `visibilitychange`, and
show `rate_limited` and `queue_full` errors without continuing an input flood.

`onSnapshot` receives:

```json
{
  "appId": "example-game",
  "matchId": "m_1234abcd",
  "revision": 9,
  "serverTick": 523801,
  "ackInputSeq": 17,
  "payload": {
    "gameDefined": "state"
  }
}
```

The firmware validates the size of `payload` but does not interpret it.
`revision` is monotonic only within one `matchId`; a fresh match starts a new
revision sequence. Key local state by `(appId, matchId)`, reset its revision
watermark whenever `matchId` changes, and reject envelopes which do not belong
to the active match before comparing revisions. `serverTick` is current
monotonic uptime in milliseconds, and `ackInputSeq` is the last command
processed for the recipient's seat. The SDK uses acknowledgements to preserve
sequencing across reconnects and controller transfer.

`onEvent` receives the same common envelope plus `name`; its game-defined data
is under `event.payload`. Events are suitable for transient effects. Snapshots
must contain enough authoritative state to recover after a missed event,
reconnect, or page reload.

Apply the same active-`matchId` check to `onEvent`, `onResult`, and `onError`.
Application scoping alone is insufficient because critical messages and a
coalesced snapshot from an earlier match can still be in flight while the
browser joins a fresh match.

Event-mode snapshots and lifecycle/event/result messages use JSON. Tick-mode
snapshots use the compact binary envelope documented in
[the WebSocket protocol](websocket-protocol.md), while the SDK still delivers
the same JavaScript object to `onSnapshot`. Each connection has a bounded
critical-message ring and only one pending snapshot slot. A newer revision
replaces obsolete unsent state, and repeated queue pressure closes only the
slow connection.

## Authoritative Lua server

The server entrypoint must be non-empty Lua source text; precompiled bytecode
is rejected. It returns one callback table without a metatable:

```lua
return {
    init = function(context) end,
    on_match_open = function(context) end,
    on_player_join = function(context, player) end,
    on_player_leave = function(context, player, reason) end,
    on_player_update = function(context, player) end,
    on_command = function(context, player, action, data, sequence) end,
    on_tick = function(context, delta_ms) end,
    on_snapshot = function(context, recipient) return {} end,
    on_unload = function(context) end
}
```

Every callback is optional, but a named field must be a function when present.
`context` is a private table retained for the life of one match. Put all
authoritative game state there or in Lua values reachable from it. One match
has one isolated Lua state.

Callback order for the first player is:

```text
load script → init → on_match_open → on_player_join → on_snapshot
```

In event mode, subsequent player events and accepted commands are followed by
`on_snapshot` while the match remains active. In tick mode, commands only
change authoritative state; `on_snapshot` runs on the firmware-controlled
snapshot cadence. A targeted snapshot request calls `on_snapshot` with
`{ profileId = "..." }`; automatic broadcast snapshots pass `nil` as the
recipient.

Only player seats produce `on_player_join`, `on_player_leave`, and
`on_player_update`. Spectators are platform members but are not included in
these callbacks or `match.players()`.

Player callbacks run after the platform has committed the membership change.
Consequently, the departing player is already absent from `match.players()`
and `match.state()` may already have returned to `"waiting"` when
`on_player_leave` runs. Reconcile the script's player table against
`match.players()` inside player callbacks. Do not wait for `on_tick`, because
tick-mode callbacks stop whenever the platform is not `"playing"`.

Join, leave, and update player objects contain:

```lua
{
    profileId = "p_...",
    nickname = "Alex",
    wins = 3,
    persistent = true
}
```

For `on_command`, the `player` argument deliberately contains only
`profileId`. Resolve game roles from authoritative state keyed by that ID. The
current leave reason is `"left"`.

The game must choose and implement a departure policy for every game phase. For
example, it may remove a waiting player, cancel and reset a pre-round
countdown, or eliminate a player and finish an active round. Whatever policy is
chosen, remove obsolete per-profile state once it is no longer needed and make
the next `on_snapshot` describe the reconciled membership.

### JSON-compatible Lua data

Command data, snapshots, events, results, and stored values may contain:

- `nil`, booleans, finite numbers, and strings;
- tables with contiguous integer keys starting at 1, encoded as arrays;
- tables with only string keys, encoded as objects.

Functions, userdata, threads, non-finite numbers, sparse arrays, and
mixed-keyed tables cannot cross the firmware boundary. Conversion depth is
limited to 16.

An empty Lua table encodes as an object. Also remember that assigning `nil` to
an array element removes it. Use `false` for fixed empty slots:

```lua
local board = {
    false, false, false,
    false, false, false,
    false, false, false
}
```

### Keep authoritative state bounded

The runtime memory quota applies to the complete Lua state, not just the
current snapshot. Every table retained through `context`, a closure, or another
reachable value counts even when it is never serialized.

The allocator prefers optional PSRAM for Lua state and falls back to internal
RAM when external memory is absent. The same 131,072-byte per-match quota is
enforced in either case; a package must never depend on PSRAM being installed.
Likewise, passing the 65,536-byte source-file check does not guarantee that a
script will load: its compiled functions, constants, tables, and initial state
must all fit the runtime quota.

Set explicit limits for all histories, queues, caches, logs, replay data,
random/piece sequences, and per-player records. Use fixed-size rings or prune
old prefixes, remove departed players when their state is no longer required,
and clear round-only data when a round restarts. Do not rely on an expected
short match to make an otherwise unbounded structure safe.

Keep the authoritative representation compact as well as the serialized
snapshot. Test repeated join/leave cycles and a deliberately long match; a
runtime which eventually reaches the memory quota is faulty even though the
firmware safely contains the failure.

Leave substantial headroom below the quota for temporary command values,
snapshot tables, and serialization work. Serial logs report Lua high-water
usage when a runtime loads and unloads, together with free internal and
external heap at load time. Use those measurements during long-match and
reconnect testing rather than estimating usage only from source size.

### Runtime APIs

The sandbox exposes these globals:

```text
match.players()
match.state()
match.start_countdown()
match.finish(result)

transport.broadcast_snapshot(payload)
transport.send_snapshot(profileId, payload)
transport.broadcast_event(name, payload)

clock.tick()
random.next()

storage.read(key)
storage.write(key, value)

log.info(message)
```

`match.players()` returns occupied player seats in seat order:

```lua
{
    {
        profileId = "p_...",
        nickname = "Alex",
        wins = 3,
        seat = 1,
        connected = true
    }
}
```

`match.state()` returns the platform lifecycle string.
`match.start_countdown()` changes a waiting match to `countdown`; it does not
create a timer. Event-mode game rules remain responsible for deciding what the
countdown means.

In tick mode, `on_tick` runs only while the platform state is `"playing"`.
Therefore, do not use the platform `"countdown"` state as a timer which expects
`on_tick` to advance it. A realtime game should normally let readiness move the
platform to `"playing"`, implement its visible countdown as a private Lua
sub-phase, and reset or resolve that sub-phase immediately if a player callback
reports that the platform has returned to `"waiting"`.

The 50 ms Lua callback limit is a wall-clock fault-containment deadline, not a
performance budget. It applies to every callback, including `on_tick` and
`on_snapshot`, and elapsed time includes task preemption and optional-PSRAM
latency. A tick callback must also finish comfortably inside its configured
tick interval: 30 Hz provides only about 33 ms even though the hard callback
deadline is 50 ms. Choose a rate which the worst-case simulation can sustain,
leave scheduling headroom, and avoid large temporary tables, sorting, full
state reconstruction, or repeated allocation in `on_tick`. The scheduler
reports overruns and drops accumulated ticks instead of running an unbounded
catch-up loop.

### Realtime hot-path design

Treat the tick interval as a deadline and reserve at least half of it for Wi-Fi,
snapshot work, commands, and normal task preemption. A conservative target for
the current ESP32 build is:

| Tick rate | Tick interval | Suggested measured worst-case `on_tick` |
|---:|---:|---:|
| 10 Hz | 100 ms | 25 ms or less |
| 15 Hz | about 67 ms | 25 ms or less |
| 20 Hz | 50 ms | 25 ms or less |
| 30 Hz | about 33 ms | 15 ms or less |

These are engineering targets, not larger platform allowances: every callback
still has the same 50 ms hard limit. Raising `tickRateHz` does not make Lua
execute faster, and choosing 20 Hz because its interval equals the hard limit
leaves no usable headroom.

Keep the simulation and presentation paths separate:

- `on_tick` should mutate compact authoritative state and do only the work
  required for one simulation step;
- `on_snapshot` should copy or quantise that state into the client payload at
  the separately capped snapshot cadence;
- do not move an expensive snapshot builder into `on_tick` merely to make
  `on_snapshot` return a cache, because the combined physics-plus-copy tick can
  still exceed its deadline;
- do not call `transport.broadcast_snapshot()` periodically from `on_tick`;
  automatic snapshots already run independently at up to 10 Hz.

Maintain a bounded player list in `context` and reconcile it from
`on_player_join`, `on_player_leave`, and `on_player_update`. Avoid calling
`match.players()` several times in one callback or once per car/entity. The
returned list is already in seat order; do not sort it again merely to obtain
seat order. Ranking usually needs updating at snapshot cadence, on a material
progress change, or at finish—not necessarily on every physics tick.

For racing, maze, collision, and spatial simulations:

- precompute static geometry such as segment vectors, squared lengths and
  tangents offline or during a bounded initialisation callback;
- retain each entity's last segment, cell, or region and search a small bounded
  neighbourhood before using a rare full-search fallback;
- compare squared distances inside searches and calculate square roots only
  for the selected result;
- calculate repeated trigonometric values once per entity per tick;
- use fixed-size/reused tables in hot loops instead of constructing temporary
  tables, closures, or sorted copies;
- document the maximum entities, segments and collision pairs so the
  worst-case work is visibly bounded.

Profile on the actual ESP32 with the maximum player count and most expensive
track/state. `clock.tick()` can measure a callback section, but logging itself
adds work, so accumulate a maximum and emit it only occasionally:

```lua
local started = clock.tick()
simulate_one_tick(context, delta_ms)
local elapsed = clock.tick() - started
context.maxTickMs = math.max(context.maxTickMs or 0, elapsed)
context.profileTicks = (context.profileTicks or 0) + 1
if context.profileTicks >= 100 then
    log.info("max tick ms: " .. context.maxTickMs)
    context.profileTicks = 0
    context.maxTickMs = 0
end
```

Remove or disable profiling logs for release builds and keep measured
worst-case time well below both the suggested target and the hard limit.

`transport.broadcast_snapshot()` caches and sends a full snapshot to all match
members. `transport.send_snapshot()` sends a profile-specific snapshot to all
of that member's connected tabs. `transport.broadcast_event()` sends a named
event to all members; event names use the same 32-byte limit as actions.

In tick mode, mutate authoritative state in `on_tick` and return the current
full state from `on_snapshot`. Firmware invokes `on_snapshot` at the separately
capped snapshot cadence. Do not call `broadcast_snapshot()` on every tick;
reserve an explicit broadcast for exceptional ordering needs such as the final
visual state immediately before `match.finish()`. Explicit tick-mode
broadcasts are also rate-capped; if a final broadcast falls inside that window,
firmware flushes its cached state ahead of the validated result.

`clock.tick()` returns monotonic system uptime in milliseconds. It is not wall
clock time. `random.next()` returns a non-negative platform random integer.

`log.info()` accepts at most 160 bytes and writes a line tagged with the
application ID. Do not log secrets or unbounded user content.

### Finishing a match and recording wins

Only Lua may request an authoritative finish. The browser cannot submit a
result or update a profile.

Resolve current seat numbers with `match.players()` and submit every occupied
player exactly once:

```lua
match.finish({
    draw = false,
    placements = {
        {seat = 2, place = 1},
        {seat = 1, place = 2}
    }
})
```

Firmware validates all of the following:

- the match has not already finished or recorded a result;
- `placements` has exactly one entry for every occupied player seat;
- every seat is occupied, in range, and appears only once;
- every place is an integer from 1 through the number of players;
- at least one placement is first;
- when `draw` is `true`, every player has place 1;
- the compact result request fits the snapshot-output limit.

`draw` defaults to `false` when omitted. A non-draw may contain tied first
places; every first-place profile receives one aggregate win. Draws do not
increment wins.

Firmware resolves seats back to authenticated profiles, generates one
idempotent result ID, records and asynchronously persists aggregate wins,
marks the match finished once, and broadcasts a validated result:

```json
{
  "appId": "example-game",
  "matchId": "m_1234abcd",
  "revision": 12,
  "serverTick": 527109,
  "payload": {
    "resultId": "r_1234abcd",
    "draw": false,
    "placements": [
      {
        "seat": 2,
        "place": 1,
        "profileId": "p_...",
        "nickname": "Alex",
        "wins": 4
      },
      {
        "seat": 1,
        "place": 2,
        "profileId": "p_...",
        "nickname": "Sam",
        "wins": 1
      }
    ]
  }
}
```

The callback registered with `arcade.game.onResult` receives that envelope, so
the validated result is `result.payload`. Use each placement's validated
`wins` value for an immediate result screen; the accompanying public-profile
update also refreshes the winner's aggregate score in the lobby.

`match.finish()` closes and unloads the runtime after the current callback
returns. No automatic post-command snapshot is generated once the match is
finished. Broadcast the final visual state before finishing:

```lua
context.status = "won"
context.winner = winner

transport.broadcast_snapshot(snapshot(context))
match.finish({
    draw = false,
    placements = placements
})
```

Do not implement a post-finish `"reset"` command. The completed match is
closed, and a later `arcade.game.join("example-game")` creates a fresh match
and fresh runtime. Detailed per-game played/win/loss/draw statistics are not
yet stored; those remain Phase 4 work.

### Namespaced storage

With `storage.app-data`, a game can read and write JSON-compatible records:

```lua
local settings = storage.read("settings")
if not settings then
    settings = {sound = true}
end

storage.write("settings", settings)
```

Keys are 1–48 bytes and may contain letters, digits, `-`, `_`, and `.`.
Firmware maps the example to:

```text
/data/apps/example-game/settings.json
```

`storage.read()` returns `nil` when a record does not exist. Reads are
synchronous on the game worker. Writes are size-checked, queued through the
storage worker, and replace the destination atomically. A record is at most
4096 bytes with the default configuration.

Never use storage as per-frame or per-command state. `storage.write()` is
explicitly rejected from `on_tick`. SD removal stops active runtimes and
prevents further writes. Total per-application quotas and versioned migrations
are Phase 4 features.

### Sandbox and failure behaviour

Available standard libraries are base, coroutine, table, string, math, and
UTF-8. Dynamic loading and `dofile`, `load`, `loadfile`, `require`,
`collectgarbage`, `print`, `getmetatable`, and `setmetatable` are removed. The
filesystem, package loader, operating-system, debug, network, WebSocket, GPIO,
NVS, credential, device-identity, and administrative APIs are not exposed.

Each callback is a protected call with memory, instruction, execution-time,
recursion, JSON-depth, and output-size limits. Loading and every callback run
on the dedicated bounded game worker, never in a WebSocket callback. A Lua
error or limit violation closes that runtime, marks its match `finished`, and
sends `game.error` with code `runtime_failed`. Wi-Fi, profiles, chat, storage,
and the lobby continue running.

Treat platform API errors as fatal to the current callback: the C binding
raises a Lua error when a capability is denied, a payload is invalid, an
output is too large, or a queued operation cannot be accepted.

### Diagnosing runtime stops

The serial log distinguishes a contained game failure from a firmware crash:

```text
LUA_RUNTIME: example-game stopped: on_tick: ... execution-time limit exceeded
GAME_PLATFORM: Match m_... stopped after tick fault
LUA_RUNTIME: Unloaded example-game (...)
```

This sequence means fault containment worked; it is not an ESP32 crash. An
actual firmware reset instead produces a reset reason or boot banner and may
include a panic/backtrace.

For execution-time and instruction-limit errors, the reported Lua line is
where the periodic hook noticed the exceeded limit. It is not necessarily the
single expensive statement. Inspect the entire callback path, including loops
and helper calls executed before that line. A `tick overrun: 51 ms budget
50 ms` warning means the callback completed but already missed its simulation
interval; treat even one repeatable overrun as a release blocker.

Common interpretations are:

| Serial message | Likely game issue |
|---|---|
| `on_tick ... execution-time limit exceeded` | Simulation, spatial search, ranking, or snapshot work is too expensive |
| `on_snapshot ... execution-time limit exceeded` | Reconciliation, sorting, allocation, or payload construction is too expensive |
| `instruction limit exceeded` | Excessive/infinite Lua loop or recursion |
| `not enough memory` or memory-quota failure | Retained or temporary Lua state is too large |
| `runtime_failed` in the browser | The platform contained one of the server-runtime failures above |

The browser should show `runtime_failed` as a game-runtime error, disable input,
and offer a fresh join. Do not silently label it a Wi-Fi failure or continue
sending commands with the failed match ID.

## Current limits and phase status

These are the default firmware 0.3.0 build limits. Some effective values are
also reported by `/api/v1/apps`; package authors must not assume a custom build
uses larger values.

| Resource | Default |
|---|---:|
| Active matches | 1 |
| Player seats per match | 1–4 |
| Spectators per match | 4 |
| Critical outbound messages per connection | 4 |
| Queue-pressure strikes before slow-client close | 24 |
| Command rate per profile | 20/second |
| Game-defined command data | 1024 bytes |
| Game-defined snapshot, event, or result data | 4096 bytes |
| Runtime work queue | 12 entries |
| Lua source | 65,536 bytes |
| Lua memory per match | 131,072 bytes |
| Lua instructions per callback | 100,000 |
| Lua callback time | 50 ms |
| Lua/C and string-pattern recursion | 64 nested calls |
| JSON conversion depth | 16 |
| Storage key | 48 bytes |
| Storage record | 4096 bytes |
| Requested tick rate | Clamped to 30 Hz |
| Snapshot rate | Capped at 10 Hz |
| Requested reconnect grace | Clamped to 60 seconds |

Implemented in the current Phase 3 firmware:

- generic matches, one-to-four profile seats, and bounded spectators;
- controller leases, reconnect grace, sequence checks, and command limits;
- scoped browser SDK and match/targeted JSON transport;
- SD-hosted Lua loading, capability APIs, quotas, and fault containment;
- automatic and requested full snapshots;
- monotonic fixed-rate ticks, overrun detection, and accumulated-tick dropping;
- separately capped snapshot cadence and compact binary tick snapshots;
- latest-snapshot coalescing, bounded critical output, and slow-client closure;
- validated, idempotent results with aggregate win persistence;
- namespaced asynchronous record writes;
- Tic-Tac-Toe and PocketBlocks with no game-specific firmware rules.

Not implemented yet:

- detailed per-game statistics, storage quotas, and migrations;
- sandboxed browser frames, package validator, mock runtime, and resource
  telemetry.

Use `"mode": "event"` when a game needs no idle work. For `"mode": "tick"`,
firmware calls `on_tick` only while the platform match is `playing`, at the
manifest rate clamped to 30 Hz. The scheduler executes at most one due tick per
pass and drops excess accumulated ticks. Automatic snapshots run independently
at no more than 10 Hz; clients may render more frequently by interpolating
between authoritative snapshots.

## Test and deploy

Before copying a package, check:

- directory and manifest IDs are identical lowercase names;
- manifest JSON is under 4096 bytes and all referenced files exist;
- the Lua file is source text and under the advertised script limit;
- capabilities cover every gated API the script calls;
- command, snapshot, event, result, and storage values are JSON-compatible;
- every CSS selector is scoped below the game's root;
- the client uses the supplied facade and does not create another WebSocket;
- every listener, timer, animation frame, and resource is released on cleanup;
- every callback rejects envelopes for a different active `matchId`;
- `you.role == "none"` clears the local match, snapshot, result, input, timer,
  and revision state;
- the client-only `closed` update and connection loss clear every cached match
  ID and prevent commands until authoritative membership returns;
- changing `matchId` resets all per-match state before accepting new snapshots;
- controls use authoritative match/snapshot state and show `game.error`;
- simultaneous held controls stay below the aggregate command-rate limit;
- reconnect and controller claim recover through a full snapshot;
- a second tab does not create another player seat;
- spectators cannot send commands;
- player callbacks reconcile membership immediately without depending on a
  future tick;
- leaving during waiting, countdown, and playing follows an explicit game rule;
- every retained Lua history, queue, cache, and per-player table is bounded;
- worst-case callbacks stay below both the callback deadline and tick interval;
- simulation, membership, ranking, and snapshot construction do not perform
  repeated full scans or sorts in the same hot callback;
- static geometry is precomputed and spatial searches have a documented bound;
- serial high-water and tick-overrun logs retain safe headroom during long play;
- final state is broadcast before `match.finish`;
- results include every occupied seat exactly once;
- storage and runtime failures affect only the game.

Exercise the lifecycle rather than testing only the happy path:

1. Join, explicitly leave, and join again without reloading the browser.
2. Replace a player during waiting and during any game-specific countdown.
3. Leave during active play with both the minimum and more than the minimum
   player count present.
4. Finish a match, start another, and inject or delay an old snapshot/event in
   the browser harness; it must not alter the new match.
5. Hold every valid multitouch/control combination for several rate windows
   and confirm it neither floods `game.error` nor fills the runtime queue.
6. Run repeated join/leave cycles and a long simulated match while observing
   that Lua memory and retained table sizes remain bounded.
7. Disconnect and reconnect inside and outside the grace period, including a
   controller transfer between two tabs of the same profile. Force a WebSocket
   drop during active play and verify that the SDK emits `closed`, clears
   `currentMatch()` and input sequencing, sends no request with the stale match
   ID, then accepts a full authoritative snapshot after reconnect.
8. Load all client assets before a realtime match, then play through a weak or
   deliberately slow connection and confirm that asset traffic or a coalesced
   snapshot cannot create an unbounded browser or firmware queue.
9. Profile the maximum player/entity count on the largest or most complex
   track/state. Exercise collision pile-ups, the transition from countdown to
   active simulation, and ticks on which a snapshot becomes due. Confirm that
   neither an individual phase nor their combination approaches the callback
   deadline, and treat any repeatable tick-overrun warning as a failed test.

To install or update:

1. Use the PocketArcade storage control to eject the SD card safely.
2. Copy the complete package to `/apps/<application-id>/`.
3. Reinsert and mount the card, or restart PocketArcade so the catalogue
   rescans it.
4. Hard-reload each phone's browser before testing an updated client script.
5. Test with separate profiles, then repeat with two tabs using one profile.

Application assets use a short browser revalidation cache, and the lobby keeps
an already loaded script URL for the current page. Changing the manifest
version alone does not unload old JavaScript, which is why a browser reload is
required during package development.

For an in-repository game, run the host checks from the firmware repository:

```bash
python3 -m unittest tests.host.test_repository -v
node --check sdcard-example/apps/tic-tac-toe/client/app.js
node --check sdcard-example/apps/pocketblocks/client/app.js
```

Then test on the ESP32 with serial logging attached. The authoritative platform
roadmap and final acceptance criteria are in the
[firmware development brief](V2dev.md).
