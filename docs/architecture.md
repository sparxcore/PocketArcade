# Architecture and concurrency

## Boot order

`app_main` initializes NVS, ESP-NETIF/event loop, central system state, the
device secret, storage, profiles, presence, cached application catalogue,
SoftAP, captive DNS, HTTP routes, and WebSocket event bridges. Storage precedes
profiles so persisted profile files can be loaded once into RAM.

## Components

| Component | Responsibility |
|---|---|
| `board_config` | One Kconfig surface for product, limits, interface, and pins |
| `system_state` | Locked uptime/resource counters used by health responses |
| `device_identity` | NVS secret, HMAC-SHA256, constant-time digest comparison |
| `wifi_ap` | Persistent random SSID suffix, NVS security setting, SoftAP, DHCP/IP events, bounded station mapping |
| `captive_portal` | Wildcard DNS, captive API, and OS captive-check redirects |
| `storage` | SDMMC/SDSPI mount, FATFS status, paths, worker queue, safe writes |
| `profiles` | Cached public/internal model, sessions, bindings, validation |
| `presence` | Single owner of per-profile online state and reconnect grace |
| `protocol` | Version and namespaced WebSocket envelope construction |
| `websocket` | One endpoint, authentication, generic dispatch, bounded/coalesced output |
| `http_api` | Versioned request parsing, validation, and public responses |
| `embedded_web` | Flash-only gzip asset mapping and immutable namespaces |
| `chat` | Bounded 50-message ring and asynchronous history persistence |
| `game_platform` | Matches, seats, leases, scheduler, revisions, input/output routing |
| `game_runtime` | Sandboxed Lua runtime, quotas, capability API, JSON bridge, fault containment |
| `lua` | Vendored restricted Lua 5.4.8 interpreter core |
| `app_catalogue` | Validated v1/v2 manifests, clamped policy, protected app assets |

## Data flow

```text
Wi-Fi/IP events ──> station table
                         │ remote socket IP
HTTP or /ws ─────────────┘
       │
       ├─ token lookup (primary)
       └─ HMAC(station MAC) lookup (fallback)
                         │
                    profile cache
                    │          │
         presence/chat       storage queue ──> FATFS
                    │
       game dispatcher ──> bounded runtime queue ──> sandboxed SD Lua
                    │                    │ monotonic fixed ticks
        match-scoped transport ──> bounded/coalesced WebSocket output
```

## Concurrency model

- Wi-Fi and IP callbacks update only the bounded station cache/counters.
- Administrator Wi-Fi changes are validated and committed to NVS by the HTTP
  task, then applied by a delayed worker so the response reaches the client
  before the access point disconnects stations.
- HTTP callbacks bound and parse one JSON body, mutate RAM state, enqueue
  persistence, and return. Avatar uploads decode one tightly bounded JPEG into
  RAM and transfer ownership to the queue. They never write the SD card.
- The WebSocket callback bounds/rate-limits input, derives the profile and
  connection identity, validates generic game fields, and enqueues accepted
  game commands without executing game rules.
- `game_platform` owns profile-keyed membership and controller leases under one
  mutex. Its bounded worker is the only task that loads/unloads a runtime or
  invokes player, command, tick, and snapshot callbacks. Join and snapshot
  WebSocket handlers enqueue work or route an already cached snapshot.
- Tick-mode matches use monotonic deadlines on the same isolated game worker.
  Only `playing` matches run. The worker executes at most one due simulation
  tick per pass, records overruns, drops accumulated ticks, and advances a
  separate snapshot deadline capped by the configured snapshot rate.
- The WebSocket outbound worker owns one fixed critical-message ring and one
  replaceable snapshot slot per connection. Sequence ordering prevents a final
  snapshot from being overtaken by its result while obsolete realtime
  snapshots can be replaced. Repeated queue pressure or asynchronous send
  failures close that slow connection.
- A disconnected controller transfers to another tab for the same profile or
  retains its seat until the manifest's clamped reconnect grace expires.
- `profiles` owns its fixed-capacity RAM cache under one mutex.
- `presence` owns one entry per profile under one mutex. A single lightweight
  task resolves grace-period expirations.
- `storage` owns mount/unmount and filesystem mutations. One bounded FreeRTOS
  queue feeds one storage task.
- `wifi_ap` owns station MAC/IP associations under one mutex.
- The application catalogue scans only at boot/mount/invalidation, caches
  bounded public metadata, and never scans per request.
- Safe eject rejects new writes, drains the queue, waits for active app asset
  reads through a filesystem mutex, then unmounts FATFS.
- Captive checks and the captive API target the flash-hosted `/portal` welcome
  page. Its Start link requests a new browsing context at `/`, while direct
  navigation to `/` continues to load the complete arcade UI.
- Captive DNS uses one small UDP task. No task is created per client.

Queues and arrays are all bounded by Kconfig. A full queue or table is reported
and the request fails safely; it does not grow memory without limit.

## Namespace and trust boundaries

Flash routes are registered independently of storage. Validated SD applications
are restricted to `/apps/<id>/*`. Unknown `/apps/*`,
`/api/*`, `/system/*`, or `/assets/system/*` paths return 404 rather than
falling back to arbitrary files. `storage_safe_relative_path` rejects absolute
paths, empty/dot segments, backslashes, controls, and traversal. Application
IDs accept only `[a-z0-9-]+`.

Only a server-side socket address can enter station correlation. No identity
header/body value exists. Public serializers are separate from the internal
profile serializer, preventing binding/session leakage. Administrative storage
operations are authorized from the token's cached server-side profile role.

Each Lua state uses a platform allocator and fixed quota. Scripts are loaded in
text-only mode and receive only the supported standard libraries plus
capability closures for `match`, `transport`, `clock`, `random`, `storage`, and
`log`. They do not receive raw filesystem, network, WebSocket, session, device,
GPIO, NVS, administration, or cross-application handles. Every callback is a
protected call with instruction, wall-time, recursion, conversion-depth, and
output bounds. A fault closes only that Lua state and finishes only its match.

The browser launcher gives each mounted application a session-scoped facade.
An application can explicitly request the shell's viewport-filling display
mode, but opening an application does not enter that mode automatically. The
shell owns the visible exit control and Escape-key handling, restores its
normal layout during every unmount or mount failure, and rejects display
requests made through a facade retained by an inactive application.

## Resource and abuse controls

Kconfig bounds Wi-Fi clients, sockets, URI handlers, HTTP bodies, avatar bytes,
WebSocket frames/connections/input rate/outbound rings/slow-client strikes,
profiles, nickname
bytes/code points, device bindings, mutation frequency, storage queue depth,
matches, players, spectators, commands, game queue depth, tick/snapshot rates,
script bytes, Lua instructions/time/recursion, storage keys/records, and
runtime memory. Token hashes and
fingerprints use constant-time comparison. Nicknames are UTF-8 validated and
the frontend inserts them only with `textContent`.
