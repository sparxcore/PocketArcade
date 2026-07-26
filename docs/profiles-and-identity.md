# Profiles and returning-device recognition

## Identity priority

1. A cryptographically random browser session token.
2. A server-observed network-device fingerprint.
3. New nickname setup.

The session token is primary. A token is stored in browser `localStorage`; only
its SHA-256 hash is persisted by the device. Player IDs alone never
authenticate.

## Network fallback

SoftAP Wi-Fi events supply the associated station MAC. DHCP/IP state correlates
that station to the remote IPv4 address obtained from the HTTP/WebSocket socket.
The ESP32 calculates:

```text
HMAC-SHA256(NVS device secret, six station-MAC bytes)
```

The in-memory and on-card binding stores use the first 128 bits of that HMAC,
encoded as 32 hexadecimal characters. This remains far beyond the collision
requirements of a store capped at 64 profiles while reducing bounded RAM use
on ESP32-S2. Session tokens remain independent 256-bit random values.

The browser never supplies its MAC, fingerprint, IP address, or device ID. Raw
MACs are not written to profile files, exposed through APIs, or included in
normal logs. A masked form is available only at debug logging. Fingerprints are
internal and local to one PocketArcade.

If mapping is temporarily absent, token login and new setup continue. Device
restoration requires exactly one match; ambiguity never selects silently.

## Limitations

This is convenience recognition, not a security boundary. MAC spoofing can
impersonate a binding. Phones commonly use a private per-network Wi-Fi address;
it is not necessarily the hardware MAC and may change after forgetting a
network, resetting settings, or an OS policy change. A changed address simply
falls back to token or nickname setup.

Clearing browser storage removes the primary token but does **not** guarantee
setup will appear: the current Wi-Fi binding may restore the profile and issue a
new token. Use **Switch player** to explicitly remove that binding.

## Lifecycle

- Creation validates trimmed UTF-8, 1–24 non-control code points, creates a
  non-predictable `p_...` ID/token, and optionally binds the current station.
- The first profile authenticated after each boot is assigned
  `role: "admin"` for that running session. Role metadata is not persisted.
- SD mount/eject endpoints verify the administrator role from the server-side
  token record. Hiding the UI button is not the authorization boundary.
- Switching an administrator away from its last device binding or deleting it
  clears the role; the next profile to authenticate becomes administrator.
- A binding collision requires explicit replacement confirmation.
- Token restoration refreshes last-seen and adds the current binding only if it
  does not steal it from another profile.
- Device restoration updates last-seen and returns a new private token.
- Each profile retains at most three bindings by default; least-recently-used
  bindings are replaced.
- **Switch player** unbinds only the current device, clears local token/cache,
  closes the socket, and preserves the server profile.
- **Delete profile** removes the record, every binding, every session hash,
  active sockets, and its persisted file.

When SD storage is unavailable, identical behavior runs from a fixed RAM cache,
but profiles are marked `persistent: false` and disappear after reboot.

## Internal vs public data

Internal files contain public profile data, persisted win count, device
bindings, and session token hashes. The session-only administrator role is
removed from the internal serializer. The public serializer is separately
constructed and never includes bindings or sessions. Avatar URL and aggregate
game wins are implemented; per-game history, colour, and other statistics
remain reserved for future schema evolution.
