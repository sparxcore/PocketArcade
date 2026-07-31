# Pocket Inferno 0.1.6

Pocket Inferno is a multiplayer-only 2.5D raycast deathmatch game for PocketArcade firmware 0.3.0.

## 0.1.13 explosion timing and sprite trim pass

- Speeds up the flame-barrel explosion animation.
- Tightens several directional player sprite crops and anchor points to reduce adjacent-sprite bleed and rotation misalignment.

## 0.1.12 barrel explosion visibility fix

- Restores the missing client handler for the authoritative `barrel_explode` event.
- Starts the explosion animation immediately when the event arrives.
- Detects active-to-destroyed barrel changes in snapshots as a fallback if the transient event is missed.
- Extends the eight-frame animation duration so the explosion is clearly visible.
- Refreshes the supplied flame-barrel explosion sprite sheet asset.

## 0.1.11 sprite anchor and splash fit pass

- Reduces remote player sprite size by a further 5%.
- Uses per-frame anchor points so player sprites stay aligned and stop bleeding neighboring art during rotation.
- Keeps the flame-barrel explosion flow in place when explosive barrels are shot.
- Adjusts the splash image fit so the artwork stays within the splash container.

## 0.1.10 scale and torch polish

- Reduces remote player sprite size slightly for improved scene proportion.
- Increases first-person weapon scale slightly.
- Chooses wall torch sprite orientation dynamically based on the viewer perspective relative to the mounted wall.

## 0.1.9 sprite alignment pass

- Increases remote player sprite size slightly for better readability.
- Uses tighter source crops for each player direction frame to avoid neighboring-art bleed.
- Snaps remote player feet cleanly to the floor projection.
- Slightly reduces barrel scale again for improved in-world proportion.

## 0.1.8 directional player sprites

- Publishes each player’s actual world-space movement heading in authoritative snapshots.
- Selects the supplied eight-direction sprite relative to each viewer’s first-person position.
- Uses actual displacement after collision, so a blocked player does not appear to keep walking through a wall.
- Smooths remote movement headings between snapshots to prevent rapid sprite flicker at octant boundaries.

## 0.1.7 visual sprite pass

- Replaces remote player rendering with the supplied 8-direction monochrome player sprite sheet.
- Applies seat tinting using the supplied base, dark, and soft palette values.
- Shrinks world barrels and wall torches for better scale in the arena.
- Uses fixed torch variants by wall placement: front, left-wall, and right-wall.

## 0.1.6 sprite projection update

- Scales first-person weapon sprites to 20% of their previous display size.
- Anchors barrel and barrel-explosion sprites to the projected floor plane.
- Chooses front, left-wall, and right-wall torch sprites from each torch's wall normal and the viewer's relative position.
- Replaces centre-point sprite hiding with per-column wall-depth clipping, allowing sprites to remain partially visible while peeking around wall edges.

## 0.1.5 art and barrel gameplay update

- Replaces the in-game weapon art with the supplied Pocket Inferno weapon sprite sheet.
- Adds weapon walk-bob motion in the first-person view.
- Replaces the torch artwork with the supplied three-angle torch sprite sheet.
- Replaces arena furniture with wood barrels and explosive flame barrels only.
- Flame barrels now explode when shot and instantly kill nearby players.
- Uses the supplied multi-frame flame barrel explosion sprite sheet for the explosion animation.

## 0.1.4 visual update

- Uses the approved Pocket Inferno pixel-art splash screen.
- Adds ten coordinated wall, floor, and ceiling tiles extracted into compact texture atlases.
- Wall columns use true raycast texture coordinates.
- Floors and ceilings use half-resolution perspective texture casting for a crisp pixel-art look without increasing server work.
- Texture assets are preloaded before the Join action is enabled.
- The authoritative Lua simulation and 0.1.2 DDA firing path are unchanged.


## Included

- Two to four player matches, plus spectators.
- Server-authoritative movement, wall collision, shooting, damage, pickups, respawns, scores and results.
- Fifteen tick-per-second Lua simulation with a single adaptive input pump capped below seven packets per second while firing, and lower idle traffic.
- First-to-seven scoring with a three-minute fallback timer.
- Blaster and limited-ammo shotgun.
- One compact arena, health packs and shell crates.
- Touch movement/look/fire controls and desktop keyboard controls.
- Local movement prediction and remote-player interpolation.
- PocketArcade splash, lobby, ready, fullscreen play, results and replay flow.


## 0.1.2 firing-path fix

- Replaced the 0.08-unit fixed-step wall ray march with grid-based DDA traversal. Each ray now crosses at most the bounded number of arena cells rather than performing dozens of fractional-distance probes.
- Reuses one shared seven-pellet spread table instead of allocating it for every scattergun shot.
- Scans the bounded seat-ordered player list for hits.
- Reuses a per-player pending-damage field instead of allocating a damage map for each shot.
- Preserves server-authoritative wall blocking, pellet spread, hit radius, damage, fire rate and ammunition behaviour.

## 0.1.1 stability fixes

- Replaced the unconditional 100 ms interval with one non-bursting 150 ms input scheduler.
- Suppressed unchanged input packets except for a 600 ms safety heartbeat; held fire still sends at the scheduler rate.
- Added a module-level mount guard so a replacement view cleans up any surviving input pump and listeners.
- Deduplicated targeted snapshot requests so repeated `onMatch` updates cannot create a request loop.
- Reworked Lua snapshots to reuse one bounded payload plus preallocated player and pickup records. `on_snapshot` no longer sorts players or creates fresh output tables.
- Stops retained movement input when a player connection is marked disconnected.

## Controls

### Touch

- Left circular pad: move and strafe.
- Right drag area: turn.
- FIRE: shoot.
- Weapon buttons: switch between blaster and shotgun.

### Keyboard

- W/S or Up/Down: forward and backward.
- A/D: strafe.
- Left/Right: turn.
- Space: fire.
- 1/2: select weapon.

## Installation

Copy the complete `pocket-inferno` directory to:

```text
/apps/pocket-inferno/
```

Reinsert or remount the PocketArcade SD card, then hard-reload the browser before testing an updated client.

## Test priorities

1. Test with two, three and four separate profiles.
2. Ready all occupied players and confirm the private three-second countdown starts only after platform play begins.
3. Hold every touch-control combination and confirm there are no rate-limit errors.
4. Leave during waiting and active play, including a leave that drops the match below two players.
5. Disconnect and reconnect within the 30-second grace period.
6. Transfer control between two tabs using the same profile.
7. Run a full three-minute round and several first-to-seven rounds while watching serial tick and memory logs.
8. Confirm old snapshots and events cannot alter a newly joined match.
9. Confirm the splash art loads before joining and that wall, floor and ceiling textures remain aligned while moving and turning.

## Original assets

This package does not contain DOOM engine code, WAD data, textures, sounds, names or other copyrighted game assets. It is an original PocketArcade raycast arena prototype.

## Retest expectations for 0.1.1

- Hard-reload every client so the old 100 ms interval is not retained by the browser.
- During active held fire, Pocket Inferno emits at most about 6.7 game-input commands per second from the active mounted view.
- With unchanged non-firing input, it emits only a 600 ms safety heartbeat.
- A playing/countdown match may request one targeted snapshot when the match or phase is first accepted; repeated `onMatch` revisions do not repeat that request.
- Reconnect testing should no longer show a fresh set of player/pickup output tables being allocated in `on_snapshot`.
- Hardware acceptance still requires confirming no `WS: WebSocket rate or connection limit exceeded`, no snapshot callback timeout, and no `runtime_failed` during repeated reconnects.

## Retest expectations for 0.1.2

- Sustained scattergun firing must not produce `on_command ... execution-time limit exceeded`.
- Test shots down long corridors and diagonals, where the former fixed-step ray march performed the most iterations.
- Confirm players behind walls cannot be hit and players in unobstructed pellet paths still receive the expected accumulated damage.
- Re-run full matches while checking that the prior WebSocket and snapshot fixes remain stable.

## 0.1.4 startup display fix

- Fixed the splash screen collapsing to zero width after the stylesheet applied.
- The splash now remains absolutely positioned across the complete game body, matching the lobby, game, and results screens.
- This addresses the symptom where the splash image briefly appeared and then the game area became blank without a console error.
