# Shared WebSocket protocol v1

The only endpoint is `/ws`. Future system, profile, presence, lobby, chat, and
application traffic shares this connection.

Every text frame is bounded JSON:

```json
{"v":1,"type":"system.hello","id":1,"payload":{}}
```

`v` is the protocol version, `type` is namespaced, `id` is the sender's sequence
identifier, and `payload` is an object. Binary, oversized, malformed,
rate-limited, wrong-version, and unsupported messages are rejected.

## Handshake

The browser first sends:

```json
{
  "v": 1,
  "type": "system.hello",
  "id": 1,
  "payload": {
    "sessionToken": "stored-token",
    "clientVersion": "0.3.0"
  }
}
```

The server tries the token, then derives a device fingerprint from the socket
when necessary. A socket is not counted online before authentication.

`system.welcome` contains the connection ID, restoration method, public profile
(including session role and persisted win count),
online snapshot, storage state, and uptime. `sessionToken` is null for token
restoration and contains a newly issued token only for device restoration. That
token is sent only to the matching connection.

If neither method works:

```json
{
  "v":1,
  "type":"error.authentication",
  "id":1,
  "payload":{
    "code":"profile_required",
    "message":"Choose a nickname to create your player profile."
  }
}
```

## Presence messages

- `presence.snapshot` — `{ "players": [...] }`, sent after login.
- `presence.joined` — `{ "player": {...} }`.
- `presence.updated` — nickname/public profile changed.
- `presence.left` — sent only after every profile connection closes and the
  configured grace period expires.

Multiple tabs increment an internal connection count but create one player
entry. A quick reconnect cancels pending departure, avoiding duplicate
join/leave events.

## Storage messages

- `storage.mounted`
- `storage.unmounted`
- `storage.error`

Payloads include current mount/persistent-profile availability. The UI updates
without reload.

## Chat messages

- Server sends `chat.snapshot` with `{ "messages": [...] }` after login.
- Client sends `chat.send` with `{ "text": "Hello" }`.
- Server broadcasts `chat.message` with `{ "message": {...} }`.
- Validation failures use `error.chat`.

The server accepts 1–160 visible Unicode characters (320 UTF-8 bytes), rejects
controls, and retains only the newest 50. The ring is cached in RAM and queued
to `/data/chat/recent.json`; missing SD does not disable live chat.

## Generic game messages

SD packages use one application-neutral dispatcher. Client messages are:

- `game.join` — `{ "appId": "...", "matchId": "optional" }`
- `game.leave` — `{ "matchId": "..." }`
- `game.ready` — `{ "matchId": "..." }`
- `game.command` — `{ "appId", "matchId", "action", "inputSeq", "data" }`
- `game.control.claim` — `{ "matchId": "..." }`
- `game.snapshot.request` — `{ "matchId": "..." }`

Server messages are `game.match`, `game.snapshot`, `game.event`,
`game.result`, and `game.error`. `game.snapshot.payload` is opaque to the
platform; its envelope includes the application and match IDs, monotonic match
revision, monotonic server tick, and the recipient's acknowledged input
sequence.

`game.match` also supplies numeric `appHandle` and `matchHandle` values.
Occupied `seats[].player` objects and entries in `spectators[]` contain the
same public fields:

```json
{
  "profileId": "p_...",
  "nickname": "Alex",
  "wins": 3,
  "avatarUrl": "/api/v1/avatars/p_....jpg"
}
```

`avatarUrl` is `null` when that profile has no photo. The same shape is used
for join, reconnect, controller-transfer, and profile-update match messages.
An event-mode snapshot remains a JSON `game.snapshot`. A tick-mode snapshot
uses this network-byte-order binary frame:

| Offset | Bytes | Value |
|---:|---:|---|
| 0 | 1 | Binary protocol version (`1`) |
| 1 | 1 | Message kind (`1` = snapshot) |
| 2 | 1 | Flags (`bit 0` = full snapshot) |
| 3 | 1 | Reserved (`0`) |
| 4 | 4 | Application handle |
| 8 | 4 | Match handle |
| 12 | 8 | Match revision |
| 20 | 8 | Monotonic server uptime in milliseconds |
| 28 | 4 | Acknowledged input sequence |
| 32 | 4 | Payload byte length |
| 36 | N | Compact UTF-8 JSON produced from the game-defined Lua payload |

The flash-hosted SDK resolves the handles through the preceding `game.match`,
validates the frame length, decodes the opaque payload, and emits the same
`arcade.game.onSnapshot` envelope used for JSON snapshots. All current
snapshots are full snapshots, including join, reconnect, controller-claim, and
explicit recovery responses.

Identity always comes from the authenticated socket. Seats are keyed by
profile ID, and one connection ID is retained internally as that seat's
controller lease. Other tabs for the same profile observe the same seat.
Accepted commands are copied into a bounded FreeRTOS queue and executed on the
game worker, never from the WebSocket callback. Runtime loading, player
callbacks, and full-snapshot callbacks use that same worker boundary.
Duplicate/stale sequences,
non-controller input, oversized data, per-profile rate excess, and a full
queue are rejected with `game.error`.

Firmware 0.3 has one active match and loads authoritative Lua scripts from
validated SD packages. A protected callback fault closes only that match's Lua
state, changes the match to `finished`, and emits `game.error` with
`runtime_failed`. `match.finish` validates seat placements, generates an
idempotent result ID, broadcasts `game.result`, and queues aggregate winner
persistence through the profile store.

Tick-mode matches run only while `playing`. Their clamped simulation cadence is
scheduled from monotonic deadlines on the game worker; accumulated ticks are
dropped and overruns recorded. Snapshot production has its own cadence capped
at 15 Hz. Every connection has a fixed critical-message ring and one
replaceable pending snapshot. Newer snapshots replace obsolete unsent state,
while lifecycle, error, event, and result messages retain ordering. Repeated
queue pressure or asynchronous send failures close only the slow connection.
Detailed per-game statistics remain a later phase.

## Errors and reconnects

Protocol errors use `error.protocol`; identity failures use
`error.authentication`. The browser preserves state, reconnects with jittered
exponential backoff (up to 30 seconds), and re-sends `system.hello`. It returns
to setup only after authentication genuinely fails.
