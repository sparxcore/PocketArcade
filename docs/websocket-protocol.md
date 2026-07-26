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
    "clientVersion": "0.1.0"
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

## Tic-Tac-Toe messages

The SD package owns presentation but reuses this authenticated socket:

- Server sends `game.tictactoe.snapshot` after login.
- Client sends `game.tictactoe.join`, `.leave`, `.reset`, or `.move` with
  `{ "cell": 0..8 }`.
- Server broadcasts `game.tictactoe.updated` to players and spectators.
- Invalid actions use `error.game`.

The first two profiles take X/O. Others spectate. Multiple tabs share one seat
because seats are keyed by profile ID.

## Errors and reconnects

Protocol errors use `error.protocol`; identity failures use
`error.authentication`. The browser preserves state, reconnects with jittered
exponential backoff (up to 30 seconds), and re-sends `system.hello`. It returns
to setup only after authentication genuinely fails.
