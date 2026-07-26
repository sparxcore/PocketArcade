# HTTP API v1

All API paths are under `/api/v1`. Responses are JSON with `Cache-Control:
no-store`. Failures use:

```json
{"ok":false,"error":{"code":"invalid_request","message":"..."}}
```

The server ignores client-supplied identity hints. Authenticated profile
mutations require `X-PocketArcade-Token`; the token is never returned to other
players or logged.

Public profiles include `role` (`admin` or `player`) for the current boot
session and the persisted aggregate `wins` count. Clients cannot submit either
field through profile mutation APIs.

## `GET /health`

Returns product/firmware/protocol versions, monotonic uptime, SD state, online
profile count, and associated Wi-Fi station count.

## `GET /storage`

Returns `mounted`, `interface` (`disabled`, `sdmmc`, or `sdspi`), card type,
capacity/free bytes, `persistentProfilesAvailable`, and `safeToRemove`. An
unmounted response is successful and useful.

## `POST /storage/eject`

Requires an administrator `X-PocketArcade-Token`; ordinary profiles receive
`403 admin_required`. Rejects new writes, places an eject marker after queued
writes, waits for active application reads, and unmounts FATFS.
`storage.unmounted` with `safeToRemove: true` confirms physical removal is safe.

## `POST /storage/mount`

Requires an administrator token. Requests a mount after reinsertion. This is
needed on slots such as the ESP32-CAM's which have no card-detect contact.

## `POST /profile`

Body:

```json
{"nickname":"Gareth"}
```

The server derives an optional binding from the connection. Success returns a
public profile and a new 256-bit hex session token. If the device is already
linked, the server returns `409 device_already_linked`; after explicit user
confirmation the UI retries with:

```json
{"nickname":"Gareth","replaceDeviceBinding":true}
```

This optional v0.1 flag is the only way profile creation replaces a binding.

## `POST /profile/restore`

Body: `{"sessionToken":"..."}`. Validates a token hash and refreshes the current
binding when it is safe. Success identifies `restoredBy: "token"` and does not
rotate the token.

## `POST /profile/device-restore`

Takes no identity body. The server maps remote socket IPv4 to an AP-observed
station and HMAC fingerprint. Exactly one match returns `restoredBy: "device"`
plus a new token. No match, unavailable correlation, and ambiguity are distinct
errors.

## `PATCH /profile`

Requires the token header. Body: `{"nickname":"New nickname"}`. Changes are
rate-limited, broadcast immediately from RAM, and persisted asynchronously.

## `POST /profile/avatar`

Requires the token header and mounted persistent storage. The body contains
`{"imageBase64":"..."}` where the value is the browser-processed JPEG without
a data-URL prefix. The server strictly validates base64, decoded size, and JPEG
markers, queues `/data/avatars/<profile-id>.jpg` through the storage worker,
updates `avatarUrl`, and broadcasts `presence.updated`. Original camera images
are never uploaded; the system UI centre-crops and compresses them to 96×96.

## `GET /avatars/<profile-id>.jpg`

Returns a public profile's small JPEG avatar with `image/jpeg`, `no-store`, and
`nosniff` headers. IDs and suffixes are strictly validated and no arbitrary
filesystem path is accepted.

## `POST /profile/unbind-device`

Requires the token header and no identity body. Removes only the binding
derived from the current request connection. It does not delete the profile.

## `DELETE /profile`

Requires the token header. Deletes the profile, avatar, all device bindings,
all token hashes, the persisted profile file, and active WebSockets for that
profile.

## `GET /players`

Returns one entry per online profile. Only public player fields are present—no
tokens, MACs, fingerprints, IP addresses, or storage paths.

## `GET /apps`

Returns the cached validated SD application catalogue:

```json
{"ok":true,"storageAvailable":true,"apps":[
  {"id":"tic-tac-toe","name":"Tic-Tac-Toe","kind":"game",
   "entrypointUrl":"/apps/tic-tac-toe/app.js",
   "stylesheetUrl":"/apps/tic-tac-toe/app.css"}
]}
```

The result may be empty. Manifests are scanned at mount and cached. IDs and
paths are validated, and malformed manifests are omitted.
