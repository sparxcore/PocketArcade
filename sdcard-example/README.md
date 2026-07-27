# Example SD card root

Copy the directories in this folder to a FAT32 card, or insert a blank FAT32
card and let PocketArcade create them. The application catalogue serves
validated manifest-v2 packages from `apps/`. Version 0.3 loads each packaged
server entrypoint through the sandboxed Lua backend, schedules fixed-tick
packages, and sends their snapshots through the compact, coalesced
realtime transport. Tic-Tac-Toe and PocketBlocks keep all authoritative rules
inside their respective SD packages. See
[`docs/game-development-guide.md`](../docs/game-development-guide.md).
