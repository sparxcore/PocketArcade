# PocketArcade Generic Multiplayer Game Platform

## Firmware Development Brief

## 1. Objective

Upgrade PocketArcade firmware so independently developed games can be installed on the SD card and provide authoritative multiplayer or realtime gameplay without adding game-specific code to the firmware.

PocketBlocks will be the first realtime test game, but the firmware must contain no knowledge of:

* Tetrominoes or board dimensions
* Piece movement or rotation
* Scoring or garbage attacks
* Game-specific win conditions
* Racing physics
* Card, quiz, maze or strategy-game rules

The firmware should only provide reusable platform services:

* Applications
* Matches
* Players and spectators
* Authenticated commands
* Runtime scheduling
* Snapshots and events
* Results
* Storage
* Resource limits

A new game should be installable by copying its complete package to the SD card without rebuilding or reflashing the firmware.

---

## 2. Target package structure

A multiplayer game package should contain both browser presentation and authoritative server logic:

```text
/apps/pocketblocks/
├── manifest.json
├── client/
│   ├── app.js
│   └── app.css
└── server/
    └── main.lua
```

The browser client remains responsible for rendering and input collection.

The SD-hosted server script owns game rules and authoritative state.

The firmware owns authentication, match membership, execution limits, communication, persistence and result validation.

---

## 3. Manifest version 2

Add a versioned manifest describing client, runtime and multiplayer requirements:

```json
{
  "manifestVersion": 2,
  "id": "pocketblocks",
  "name": "PocketBlocks",
  "version": "1.0.0",
  "minPlatformVersion": "0.2.0",
  "kind": "game",
  "client": {
    "entrypoint": "client/app.js",
    "stylesheet": "client/app.css"
  },
  "runtime": {
    "type": "lua",
    "entrypoint": "server/main.lua",
    "mode": "tick",
    "tickRateHz": 10
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
    "presence.read",
    "match.seats",
    "match.results",
    "storage.app-data"
  ]
}
```

The firmware must validate:

* Manifest and platform versions
* Application paths
* Runtime type
* Player and spectator limits
* Tick-rate limits
* Requested capabilities
* Script size
* Runtime memory allowance
* Command and snapshot sizes

Requested values must always be clamped to firmware-defined limits.

---

## 4. Generic WebSocket game protocol

Replace compiled game-specific messages with a generic dispatcher.

Client commands:

```text
game.join
game.leave
game.ready
game.command
game.control.claim
game.snapshot.request
```

Server messages:

```text
game.match
game.snapshot
game.event
game.result
game.error
```

Example:

```json
{
  "v": 1,
  "type": "game.command",
  "id": 73,
  "payload": {
    "appId": "pocketblocks",
    "matchId": "m_17",
    "action": "move",
    "inputSeq": 118,
    "data": {
      "direction": -1
    }
  }
}
```

The dispatcher must:

1. Derive identity from the authenticated WebSocket.
2. Ignore client-supplied profile identity.
3. Validate match membership and controller status.
4. Validate payload size, rate and input sequence.
5. enqueue the command into a bounded game queue.
6. Return without executing game code.

Game scripts must never execute directly inside WebSocket callbacks.

---

## 5. Generic match service

The firmware should own match creation, membership and lifecycle.

Each match should store:

```text
application ID and version
match ID
lifecycle state
player seats
spectators
controller connections
runtime instance
revision
creation time
result status
```

Lifecycle:

```text
closed → waiting → countdown → playing → finished → closed
```

Required behaviour:

* One to four profile-based seats
* Bounded spectators
* One seat per profile
* Idempotent join
* Explicit leave
* Reconnection grace period
* Late-join policy
* Profile switch and deletion handling
* Monotonic match revision
* Full snapshot on join or reconnect

Seats must be keyed by profile ID, not by socket, IP address, MAC address or browser tab.

### Controller lease

One profile may have several browser connections, but only one connection should control its seat.

The platform must support:

* One active controller connection per seat
* Other tabs receiving snapshots as observers
* Automatic controller transfer after disconnect
* Explicit `game.control.claim`
* Rejection of stale or duplicate input sequences

---

## 6. Sandboxed server runtime

Use a generic runtime abstraction with sandboxed Lua as the first implementation.

Lua provides sufficient flexibility for turn-based games, board games, realtime games, AI, timers and lightweight simulations without requiring firmware changes for each game.

The runtime interface should support:

```c
load
command
tick
player_event
unload
```

A Lua game may expose:

```lua
return {
    init = function(context) end,
    on_match_open = function(context) end,
    on_player_join = function(context, player) end,
    on_player_leave = function(context, player, reason) end,
    on_command = function(context, player, action, data, sequence) end,
    on_tick = function(context, delta_ms) end,
    on_snapshot = function(context, recipient) end,
    on_unload = function(context) end
}
```

Available runtime capabilities should include:

```text
match.players()
match.state()
match.start_countdown()
match.finish(result)
transport.broadcast_snapshot(payload)
transport.send_snapshot(profile, payload)
transport.broadcast_event(name, payload)
clock.tick()
random.next()
storage.read(key)
storage.write(key, value)
log.info(message)
```

The runtime must not expose:

* Raw filesystem access
* Wi-Fi or network sockets
* Raw WebSockets
* Session tokens
* MAC or IP addresses
* GPIO
* NVS
* Administrative APIs
* Other applications’ state

---

## 7. Runtime safety limits

Each runtime instance must have hard limits enforced by the firmware.

Required controls:

* Platform-supplied Lua allocator
* Per-instance memory quota
* Instruction limit per callback
* Execution-time limit
* Recursion limit
* Maximum output size
* Maximum timers
* Bounded command and event queues
* Protected calls around all script callbacks
* Clean runtime termination on failure

A faulty game must stop only its own runtime. It must not reset the ESP32 or disrupt Wi-Fi, chat, profiles, storage or the lobby.

---

## 8. Generic scheduler

Support two runtime modes.

### Event-driven mode

For games such as Tic-Tac-Toe, cards, chess and quizzes:

```json
{
  "mode": "event"
}
```

No periodic tick runs while the game is idle.

### Fixed-tick mode

For PocketBlocks, racing and realtime simulations:

```json
{
  "mode": "tick",
  "tickRateHz": 10
}
```

The scheduler must:

* Use monotonic time
* Run only active matches
* Enforce a maximum tick rate
* Execute on a dedicated bounded task
* Detect overruns
* Drop excessive accumulated ticks
* Separate simulation rate from snapshot rate

Clients may render at 60 Hz even when authoritative simulation runs at 10–30 Hz.

---

## 9. Snapshot and event transport

The transport layer must support:

* Broadcast to one match
* Send to one profile
* Reply to one connection
* Separate player and spectator routing
* Full snapshot requests
* Monotonic revisions
* Server tick or timestamp
* Input acknowledgements
* Per-connection output queues
* Snapshot coalescing
* Slow-client handling

Lifecycle and control messages can remain JSON.

Realtime snapshots should support a compact binary envelope:

```text
protocol version
message kind
application handle
match handle
revision
server tick
acknowledged input sequence
payload length
game-defined payload
```

The firmware does not interpret the game payload. It only validates its size and routes it.

---

## 10. Backpressure and rate limits

Every connection must have a bounded outbound queue.

For realtime state:

* Keep only the newest unsent snapshot.
* Replace obsolete snapshots with newer revisions.
* Preserve critical lifecycle, error and result messages.
* Reject oversized commands.
* Rate-limit commands by profile and connection.
* Reject stale or duplicate input sequences.
* Disconnect consistently slow clients.

The platform must not build an unbounded queue of outdated game states.

---

## 11. Authoritative result service

Game scripts may request that a match finishes, but they must not directly modify profiles.

Example:

```lua
match.finish({
    placements = {
        { seat = 2, place = 1 },
        { seat = 1, place = 2 },
        { seat = 3, place = 3 }
    }
})
```

The firmware must then:

1. Confirm the match is active.
2. Resolve seats to authenticated profiles.
3. Validate all participants.
4. Generate an idempotent result ID.
5. Mark the match finished once.
6. Update aggregate and per-game statistics.
7. Queue persistence through the storage worker.
8. Broadcast the validated result.

Suggested statistics:

```text
aggregate:
  wins

per game:
  played
  wins
  losses
  draws
  best result
  last played
```

---

## 12. Application storage

Expose namespaced storage only beneath:

```text
/data/apps/<application-id>/
```

Games should access keys or records through a firmware API rather than raw paths.

Required behaviour:

* Per-application quota
* Maximum record size
* Atomic replacement
* Queued writes
* No writes from realtime tick callbacks
* Read-only state during SD eject
* Versioned data migrations
* No access to profiles or another application’s data

---

## 13. Browser SDK facade

Provide games with a stable client API:

```javascript
arcade.game.join(appId)
arcade.game.leave(matchId)
arcade.game.ready(matchId)
arcade.game.send(matchId, action, data)
arcade.game.claimControl(matchId)
arcade.game.requestSnapshot(matchId)

arcade.game.onMatch(callback)
arcade.game.onSnapshot(callback)
arcade.game.onEvent(callback)
arcade.game.onResult(callback)
```

The facade must hide:

* Authentication tokens
* Raw WebSocket access
* Connection IDs
* Administrative methods
* Messages belonging to other applications

---

## 14. Resource policy

Begin with conservative limits:

```text
Active matches:            1
Players per match:         1–4
Spectators:                small fixed limit
Runtime instances:         one per active match
Tick rate:                 maximum 30 Hz
Snapshot rate:             maximum 15 Hz
Input rate:                maximum 20 commands/sec/profile
Runtime memory:            fixed quota
Command queue:             fixed ring buffer
Snapshot queue:            latest snapshot only
Persistent writes:         asynchronous only
PSRAM:                     optional, never required
```

The protocol should support multiple match IDs even when the first firmware release allows only one active match.

Final limits must be selected using measurements from:

* Firmware map-file growth
* Internal heap after Wi-Fi startup
* Four-phone gameplay
* SD operations
* Runtime high-water marks
* Snapshot serialization
* Reconnect storms
* Weak or slow clients

---

## 15. Implementation sequence

### Phase 1 — Generic matches and transport

Implement:

* Generic `game.*` dispatcher
* Match and seat service
* Controller leases
* Reconnection handling
* Per-match and targeted sending
* Browser SDK facade

The existing compiled Tic-Tac-Toe game may temporarily use a native runtime adapter through the same interface.

### Phase 2 — Sandboxed Lua runtime

Implement:

* Lua loading from SD
* Restricted libraries
* Runtime capability API
* Memory and instruction quotas
* Fault containment
* Script validation

Move Tic-Tac-Toe rules from firmware to an SD-hosted Lua package as the first proof of generic deployment.

### Phase 3 — Realtime support

Implement:

* Fixed-rate scheduler
* Input sequencing
* Snapshot revisions
* Compact snapshot transport
* Coalescing and backpressure
* Slow-client handling
* Full snapshot recovery

PocketBlocks must then run without firmware modification.

### Phase 4 — Results and storage

Implement:

* Generic authoritative results
* Per-game statistics
* Idempotent persistence
* Namespaced application storage
* Quotas and migrations

### Phase 5 — Isolation and tooling

Implement:

* Sandboxed browser frame or capability bridge
* Desktop package validator
* Mock runtime and match test harness
* Resource telemetry
* Package update and cache invalidation

---

## 16. Definition of done

The platform is complete when the same unchanged firmware can run:

1. Tic-Tac-Toe entirely from an SD package.
2. PocketBlocks entirely from an SD package.
3. A newly developed third game installed without rebuilding or flashing.

Acceptance must also confirm:

* Four different phones can join one match.
* A fifth device is handled as a spectator or rejected cleanly.
* Multiple tabs cannot consume multiple seats.
* Only one tab controls each player.
* Disconnect and reconnect restore the same seat.
* Clients receive a full authoritative snapshot after reconnect.
* Slow clients cannot exhaust queues or memory.
* A faulty script stops without affecting the PocketArcade system.
* SD removal safely stops or suspends active games.
* Results are recorded once and only by the firmware.
* No game can access system secrets or another game’s data.

PocketBlocks must be treated as a validation game for this platform, not as a firmware feature. (v1:codex resume 019f9b1c-833d-7c91-a239-db5cbb1cf4c0)