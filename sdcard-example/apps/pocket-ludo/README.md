# Pocket Ludo 1.0.8

An event-driven multiplayer Ludo package for PocketArcade firmware 0.3.0.

## 1.0.8 changes

- Removed the centre-board turn information box and its text.
- Added an authoritative `safe` event whenever a pawn lands on a protected track square.
- Safe landings now animate the tile, bounce the pawn, and display a rising shield-and-star graphic.
- The existing bottom control panel remains the primary turn indicator.

## Install

Copy this folder to:

`/apps/pocket-ludo/`

Then remount/restart PocketArcade and hard-refresh each browser.

## Rules

- 2–4 players, four pawns each.
- Roll a six to bring a pawn out of the yard.
- Move clockwise around the 52-square track and then along your home lane.
- An exact roll is required to reach home.
- Landing on opponents on a non-safe square sends all of those pawns home.
- Safe squares are the four starts and four starred squares.
- A six, capture, or pawn reaching home grants another turn.
- The first player to bring all four pawns home wins.
- If players leave during active play, their pawns are removed. The final remaining player wins by forfeit.

## Test focus

Test safe-square effects on all four coloured start squares and all four starred
squares, including releasing a pawn with a six, landing safely after a normal
move, reconnecting after an effect, and landing on a safe square while earning
an extra turn.
