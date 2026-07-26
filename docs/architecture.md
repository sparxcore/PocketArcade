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
| `wifi_ap` | SoftAP, DHCP/IP events, bounded server-observed station mapping |
| `captive_portal` | Wildcard DNS, captive API, and OS captive-check redirects |
| `storage` | SDMMC/SDSPI mount, FATFS status, paths, worker queue, safe writes |
| `profiles` | Cached public/internal model, sessions, bindings, validation |
| `presence` | Single owner of per-profile online state and reconnect grace |
| `protocol` | Version and namespaced WebSocket envelope construction |
| `websocket` | One endpoint, authentication handshake, chat/game fan-out and limits |
| `http_api` | Versioned request parsing, validation, and public responses |
| `embedded_web` | Flash-only gzip asset mapping and immutable namespaces |
| `chat` | Bounded 50-message ring and asynchronous history persistence |
| `tic_tac_toe` | Authoritative two-seat board state and spectator snapshots |
| `app_catalogue` | Validated SD manifests, cached metadata, protected app assets |

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
         presence/chat/game      storage queue ──> FATFS
                    │
              WebSocket broadcast
```

## Concurrency model

- Wi-Fi and IP callbacks update only the bounded station cache/counters.
- HTTP callbacks bound and parse one JSON body, mutate RAM state, enqueue
  persistence, and return. Avatar uploads decode one tightly bounded JPEG into
  RAM and transfer ownership to the queue. They never write the SD card.
- The WebSocket callback bounds/rate-limits input and owns only connection
  metadata. It delegates identity, profiles, and presence.
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

## Resource and abuse controls

Kconfig bounds Wi-Fi clients, sockets, URI handlers, HTTP bodies, avatar bytes, WebSocket
frames/connections/messages-per-second, profiles, nickname bytes/code points,
device bindings, mutation frequency, and storage queue depth. Token hashes and
fingerprints use constant-time comparison. Nicknames are UTF-8 validated and
the frontend inserts them only with `textContent`.
