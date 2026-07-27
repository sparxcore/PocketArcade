-- PocketBlocks authoritative game rules for PocketArcade's sandboxed Lua host.
-- All identity, seats, controller leases, command sequencing and results are
-- validated by the platform. This script owns only game-specific state/rules.

local BOARD_W = 10
local VISIBLE_H = 20
local HIDDEN_H = 4
local BOARD_H = VISIBLE_H + HIDDEN_H
local COUNTDOWN_MS = 3000
local MAX_TICK_DELTA_MS = 250
local MAX_GARBAGE_PER_LOCK = 8
local MAX_PENDING_GARBAGE = 12
local MAX_GARBAGE_BATCHES = 6
local ROTATE_COOLDOWN_MS = 90
local HARD_DROP_COOLDOWN_MS = 220
local HEX = "0123456789abcdef"
local EMPTY_ROW = "0000000000"

-- Each rotation packs four 4x4 cell indexes into one base-16 integer. Keeping
-- shapes compact avoids hundreds of nested Lua tables on the ESP32 heap.
-- Piece IDs: 1=I, 2=O, 3=T, 4=S, 5=Z, 6=J, 7=L.
local SHAPES = {
    {30292, 60002, 47768, 55633},
    {25889, 25889, 25889, 25889},
    {25921, 38481, 38484, 38209},
    {21537, 42577, 39013, 38208},
    {25872, 38482, 43348, 34113},
    {25920, 38177, 42580, 38993},
    {25922, 43345, 34388, 38160}
}
local NIBBLE_DIVISORS = {1, 16, 256, 4096}

local function board_get(board, x, y)
    return string.byte(board[y + 1], x + 1) - 48
end

local function board_set(board, x, y, value)
    local index = y + 1
    local row = board[index]
    board[index] = string.sub(row, 1, x) ..
        string.sub(HEX, value + 1, value + 1) ..
        string.sub(row, x + 2)
end

local function new_board()
    local board = {}
    for i = 1, BOARD_H do
        board[i] = EMPTY_ROW
    end
    return board
end

local function platform_players_by_id()
    local by_id = {}
    local players = match.players()
    for i = 1, #players do
        by_id[players[i].profileId] = players[i]
    end
    return by_id, players
end

local function find_platform_player(profile_id)
    local players = match.players()
    for i = 1, #players do
        if players[i].profileId == profile_id then
            return players[i]
        end
    end
    return nil
end

local function shuffled_bag()
    local bag = {1, 2, 3, 4, 5, 6, 7}
    for i = 7, 2, -1 do
        local j = (random.next() % i) + 1
        bag[i], bag[j] = bag[j], bag[i]
    end
    return bag
end

local function ensure_piece(context, index)
    local local_index = index - context.sequenceBase + 1
    while #context.sequence < local_index do
        if context.bagIndex > 7 then
            context.bag = shuffled_bag()
            context.bagIndex = 1
        end
        context.sequence[#context.sequence + 1] = context.bag[context.bagIndex]
        context.bagIndex = context.bagIndex + 1
    end
    return context.sequence[local_index]
end

local function next_piece(context, player)
    local piece = ensure_piece(context, player.pieceIndex)
    player.pieceIndex = player.pieceIndex + 1
    return piece
end

local function prune_sequence(context)
    local minimum_index = false
    local platform_players = match.players()
    for i = 1, #platform_players do
        local player = context.players[platform_players[i].profileId]
        if player and player.alive and player.pieceIndex and
           (not minimum_index or player.pieceIndex < minimum_index) then
            minimum_index = player.pieceIndex
        end
    end
    if not minimum_index then
        context.sequence = {}
        context.sequenceBase = 1
        return
    end

    local remove_count = minimum_index - context.sequenceBase
    if remove_count <= 0 then
        return
    end
    local retained = #context.sequence - remove_count
    for i = 1, retained do
        context.sequence[i] = context.sequence[i + remove_count]
    end
    for i = #context.sequence, retained + 1, -1 do
        context.sequence[i] = nil
    end
    context.sequenceBase = minimum_index
end

local function shape_cell(piece, index)
    local packed = SHAPES[piece.type][piece.rotation + 1]
    local cell = math.floor(packed / NIBBLE_DIVISORS[index]) % 16
    return cell % 4, math.floor(cell / 4)
end

local function collides(player, piece)
    for i = 1, 4 do
        local shape_x, shape_y = shape_cell(piece, i)
        local x = piece.x + shape_x
        local y = piece.y + shape_y
        if x < 0 or x >= BOARD_W or y < 0 or y >= BOARD_H then
            return true
        end
        if board_get(player.board, x, y) ~= 0 then
            return true
        end
    end
    return false
end

local function refill_preview(context, player)
    while #player.next < 3 do
        player.next[#player.next + 1] = next_piece(context, player)
    end
end

local function spawn_piece(context, player)
    refill_preview(context, player)
    local piece_type = player.next[1]
    table.remove(player.next, 1)
    refill_preview(context, player)
    player.active = {
        type = piece_type,
        rotation = 0,
        x = 3,
        y = 0
    }
    if collides(player, player.active) then
        player.alive = false
        player.active = nil
        context.eliminationCounter = context.eliminationCounter + 1
        player.eliminatedAt = context.eliminationCounter
        return false
    end
    return true
end

local function reset_player(context, platform_player)
    local player = context.players[platform_player.profileId]
    if not player then
        player = {profileId = platform_player.profileId}
        context.players[platform_player.profileId] = player
    end
    player.seat = platform_player.seat
    player.nickname = platform_player.nickname
    player.connected = platform_player.connected
    player.board = new_board()
    player.active = nil
    player.next = {}
    player.pieceIndex = 1
    player.score = 0
    player.lines = 0
    player.pendingGarbage = 0
    player.garbageBatches = {}
    player.gravityMs = 0
    player.lastRotateMs = -ROTATE_COOLDOWN_MS
    player.lastHardDropMs = -HARD_DROP_COOLDOWN_MS
    player.alive = true
    player.eliminatedAt = 0
    refill_preview(context, player)
    spawn_piece(context, player)
    return player
end

local function alive_players(context)
    local result = {}
    local platform_players = match.players()
    for i = 1, #platform_players do
        local player = context.players[platform_players[i].profileId]
        if player and player.alive then
            result[#result + 1] = player
        end
    end
    return result
end

local function move_piece(player, dx, dy)
    if not player.active then
        return false
    end
    local candidate = {
        type = player.active.type,
        rotation = player.active.rotation,
        x = player.active.x + dx,
        y = player.active.y + dy
    }
    if collides(player, candidate) then
        return false
    end
    player.active = candidate
    return true
end

local function rotate_piece(player, direction)
    if not player.active then
        return false
    end
    local rotation = (player.active.rotation + (direction > 0 and 1 or 3)) % 4
    local kicks = {0, -1, 1, -2, 2}
    for i = 1, #kicks do
        local candidate = {
            type = player.active.type,
            rotation = rotation,
            x = player.active.x + kicks[i],
            y = player.active.y
        }
        if not collides(player, candidate) then
            player.active = candidate
            return true
        end
    end
    return false
end

local function clear_lines(player)
    local cleared = 0
    local y = BOARD_H - 1
    while y >= 0 do
        local full = not string.find(player.board[y + 1], "0", 1, true)
        if full then
            cleared = cleared + 1
            for row = y, 1, -1 do
                player.board[row + 1] = player.board[row]
            end
            player.board[1] = EMPTY_ROW
        else
            y = y - 1
        end
    end
    return cleared
end

local function eliminate(context, player)
    if player.alive then
        player.alive = false
        player.active = nil
        context.eliminationCounter = context.eliminationCounter + 1
        player.eliminatedAt = context.eliminationCounter
    end
end

local function add_garbage(context, player, count, hole)
    local fixed_hole = hole
    if type(fixed_hole) ~= "number" or fixed_hole < 0 or fixed_hole >= BOARD_W then
        fixed_hole = random.next() % BOARD_W
    end
    for _ = 1, count do
        if not player.alive then
            return
        end
        local overflow = player.board[1] ~= EMPTY_ROW
        for y = 0, BOARD_H - 2 do
            player.board[y + 1] = player.board[y + 2]
        end
        player.board[BOARD_H] = string.rep("8", fixed_hole) .. "0" ..
            string.rep("8", BOARD_W - fixed_hole - 1)
        if overflow or (player.active and collides(player, player.active)) then
            eliminate(context, player)
        end
    end
end

local function enqueue_garbage(player, count, hole)
    local available = MAX_PENDING_GARBAGE - player.pendingGarbage
    local accepted = math.max(0, math.min(count, available))
    if accepted <= 0 then
        return
    end

    local batches = player.garbageBatches
    local last = batches[#batches]
    if last and last.hole == hole then
        last.count = last.count + accepted
    elseif #batches < MAX_GARBAGE_BATCHES then
        batches[#batches + 1] = {count = accepted, hole = hole}
    elseif last then
        -- Preserve bounded state. Extra pressure joins the final batch and uses
        -- that batch's existing fixed hole rather than allocating another entry.
        last.count = last.count + accepted
    end
    player.pendingGarbage = player.pendingGarbage + accepted
end

local function send_attack_to_others(context, attacker, count)
    if count <= 0 then
        return
    end
    local hole = random.next() % BOARD_W
    local players = alive_players(context)
    for i = 1, #players do
        local target = players[i]
        if target.profileId ~= attacker.profileId then
            enqueue_garbage(target, count, hole)
        end
    end
end

local function apply_pending_garbage(context, player)
    local remaining = math.min(MAX_GARBAGE_PER_LOCK, player.pendingGarbage)
    while remaining > 0 and #player.garbageBatches > 0 and player.alive do
        local batch = player.garbageBatches[1]
        local applied = math.min(remaining, batch.count)
        add_garbage(context, player, applied, batch.hole)
        batch.count = batch.count - applied
        player.pendingGarbage = player.pendingGarbage - applied
        remaining = remaining - applied
        if batch.count <= 0 then
            table.remove(player.garbageBatches, 1)
        end
    end
end

local function lock_piece(context, player)
    if not player.active or not player.alive then
        return
    end
    for i = 1, 4 do
        local shape_x, shape_y = shape_cell(player.active, i)
        local x = player.active.x + shape_x
        local y = player.active.y + shape_y
        if x >= 0 and x < BOARD_W and y >= 0 and y < BOARD_H then
            board_set(player.board, x, y, player.active.type)
        end
    end
    player.active = nil

    local cleared = clear_lines(player)
    if cleared > 0 then
        player.score = player.score + cleared * cleared * 100
        player.lines = player.lines + cleared
    end

    -- A clear attacks only when it removes more than two rows. Every other
    -- surviving player receives cleared-minus-one garbage rows.
    if cleared > 2 then
        send_attack_to_others(context, player, cleared - 1)
    end

    if player.pendingGarbage > 0 then
        apply_pending_garbage(context, player)
    end

    if player.alive then
        spawn_piece(context, player)
    end
    prune_sequence(context)
    context.dirty = true
end

local function hard_drop(context, player)
    local distance = 0
    while move_piece(player, 0, 1) do
        distance = distance + 1
    end
    player.score = player.score + distance * 2
    lock_piece(context, player)
end

local function gravity_interval(player)
    local level = math.floor(player.lines / 10)
    return 800 - math.min(650, level * 65)
end

local function pack_board(player)
    return table.concat(player.board, "", HIDDEN_H + 1, BOARD_H)
end

local function player_snapshot(player, platform_player)
    local active = false
    if player.active and player.alive then
        active = {
            type = player.active.type,
            rotation = player.active.rotation,
            x = player.active.x,
            y = player.active.y - HIDDEN_H
        }
    end
    return {
        profileId = player.profileId,
        nickname = platform_player.nickname,
        seat = platform_player.seat,
        connected = platform_player.connected,
        alive = player.alive,
        score = player.score,
        lines = player.lines,
        pendingGarbage = player.pendingGarbage,
        cells = pack_board(player),
        active = active,
        next = {player.next[1], player.next[2], player.next[3]}
    }
end

local function snapshot(context)
    local players = {}
    local platform_players = match.players()
    for i = 1, #platform_players do
        local player = context.players[platform_players[i].profileId]
        if player then
            player.seat = platform_players[i].seat
            player.nickname = platform_players[i].nickname
            player.connected = platform_players[i].connected
            players[#players + 1] = player_snapshot(player, platform_players[i])
        end
    end
    return {
        phase = context.phase,
        countdownMs = math.max(0, math.floor(context.countdownMs)),
        players = players
    }
end

local function start_round(context)
    context.sequence = {}
    context.sequenceBase = 1
    context.bag = {}
    context.bagIndex = 8
    context.eliminationCounter = 0
    local round_players = {}
    local platform_players = match.players()
    for i = 1, #platform_players do
        local player = reset_player(context, platform_players[i])
        round_players[platform_players[i].profileId] = player
    end
    context.players = round_players
    context.phase = "countdown"
    context.countdownMs = COUNTDOWN_MS
    context.dirty = true
end

local function sorted_finish_players(context)
    local entries = {}
    local platform_players = match.players()
    for i = 1, #platform_players do
        local game_player = context.players[platform_players[i].profileId]
        if game_player then
            entries[#entries + 1] = game_player
        end
    end
    table.sort(entries, function(a, b)
        if a.alive ~= b.alive then
            return a.alive
        end
        if a.eliminatedAt ~= b.eliminatedAt then
            return a.eliminatedAt > b.eliminatedAt
        end
        if a.lines ~= b.lines then
            return a.lines > b.lines
        end
        if a.score ~= b.score then
            return a.score > b.score
        end
        return a.seat < b.seat
    end)
    return entries
end

local function finish_match(context)
    if context.finishing then
        return
    end
    context.finishing = true
    context.phase = "finished"
    context.countdownMs = 0
    context.dirty = true
    transport.broadcast_snapshot(snapshot(context))

    local ranked = sorted_finish_players(context)
    local placements = {}
    for i = 1, #ranked do
        placements[i] = {seat = ranked[i].seat, place = i}
    end
    match.finish({draw = false, placements = placements})
end

local function check_finished(context)
    if context.phase ~= "playing" then
        return false
    end
    local occupied = match.players()
    local alive = alive_players(context)
    if #occupied > 0 and #alive <= 1 then
        finish_match(context)
        return true
    end
    return false
end

local function ensure_player(context, player_info)
    local platform_player = find_platform_player(player_info.profileId)
    if not platform_player then
        return nil
    end
    local player = context.players[player_info.profileId]
    if not player then
        player = {
            profileId = player_info.profileId,
            seat = platform_player.seat,
            nickname = platform_player.nickname,
            connected = platform_player.connected,
            board = new_board(),
            active = nil,
            next = {1, 2, 3},
            pieceIndex = 1,
            score = 0,
            lines = 0,
            pendingGarbage = 0,
            garbageBatches = {},
            gravityMs = 0,
            lastRotateMs = -ROTATE_COOLDOWN_MS,
            lastHardDropMs = -HARD_DROP_COOLDOWN_MS,
            alive = false,
            eliminatedAt = 0
        }
        context.players[player_info.profileId] = player
    end
    player.seat = platform_player.seat
    player.nickname = platform_player.nickname
    player.connected = platform_player.connected
    return player
end

local function reset_to_waiting(context)
    local retained = {}
    local platform_players = match.players()
    for i = 1, #platform_players do
        local platform_player = platform_players[i]
        local player = ensure_player(context, platform_player)
        for row = 1, BOARD_H do
            player.board[row] = EMPTY_ROW
        end
        player.active = nil
        player.next = {}
        player.pieceIndex = 1
        player.score = 0
        player.lines = 0
        player.pendingGarbage = 0
        player.garbageBatches = {}
        player.gravityMs = 0
        player.lastRotateMs = -ROTATE_COOLDOWN_MS
        player.lastHardDropMs = -HARD_DROP_COOLDOWN_MS
        player.alive = false
        player.eliminatedAt = 0
        retained[platform_player.profileId] = player
    end
    context.players = retained
    context.sequence = {}
    context.sequenceBase = 1
    context.bag = {}
    context.bagIndex = 8
    context.eliminationCounter = 0
    context.phase = "waiting"
    context.countdownMs = 0
    context.finishing = false
    context.dirty = true
end

return {
    init = function(context)
        context.phase = "waiting"
        context.countdownMs = 0
        context.players = {}
        context.sequence = {}
        context.sequenceBase = 1
        context.bag = {}
        context.bagIndex = 8
        context.eliminationCounter = 0
        context.dirty = true
        context.finishing = false
    end,

    on_match_open = function(context)
        context.phase = "waiting"
        context.dirty = true
    end,

    on_player_join = function(context, player_info)
        ensure_player(context, player_info)
        context.dirty = true
    end,

    on_player_update = function(context, player_info)
        ensure_player(context, player_info)
        context.dirty = true
    end,

    on_player_leave = function(context, player_info, reason)
        local player = context.players[player_info.profileId]
        if player then
            context.players[player_info.profileId] = nil
        end
        if context.phase == "countdown" and match.state() == "waiting" then
            reset_to_waiting(context)
        elseif player then
            context.dirty = true
            prune_sequence(context)
            check_finished(context)
        end
        log.info("player left: " .. reason)
    end,

    on_command = function(context, player_info, action, data, sequence)
        local player = context.players[player_info.profileId]
        if not player or not player.alive or context.phase ~= "playing" then
            return
        end

        local now = clock.tick()
        if action == "rotate-cw" or action == "rotate-ccw" then
            if now - player.lastRotateMs < ROTATE_COOLDOWN_MS then
                return
            end
            player.lastRotateMs = now
        elseif action == "hard-drop" then
            if now - player.lastHardDropMs < HARD_DROP_COOLDOWN_MS then
                return
            end
            player.lastHardDropMs = now
        end

        local changed = false
        if action == "left" then
            changed = move_piece(player, -1, 0)
        elseif action == "right" then
            changed = move_piece(player, 1, 0)
        elseif action == "rotate-cw" then
            changed = rotate_piece(player, 1)
        elseif action == "rotate-ccw" then
            changed = rotate_piece(player, -1)
        elseif action == "soft-drop" then
            if move_piece(player, 0, 1) then
                player.score = player.score + 1
                changed = true
            else
                lock_piece(context, player)
                changed = true
            end
        elseif action == "hard-drop" then
            hard_drop(context, player)
            changed = true
        end

        if changed then
            context.dirty = true
            check_finished(context)
        end
    end,

    on_tick = function(context, delta_ms)
        if context.finishing then
            return
        end
        local elapsed = math.max(0, math.min(MAX_TICK_DELTA_MS, delta_ms))
        local platform_state = match.state()

        if platform_state == "playing" and context.phase == "waiting" then
            start_round(context)
            return
        end

        if context.phase == "countdown" then
            context.countdownMs = context.countdownMs - elapsed
            context.dirty = true
            if context.countdownMs <= 0 then
                context.countdownMs = 0
                context.phase = "playing"
            end
            return
        end

        if context.phase == "playing" then
            local platform_by_id = platform_players_by_id()
            local players = alive_players(context)
            for i = 1, #players do
                local player = players[i]
                local current = platform_by_id[player.profileId]
                player.connected = current and current.connected or false
                player.gravityMs = player.gravityMs + elapsed
                local interval = gravity_interval(player)
                while player.gravityMs >= interval and player.alive do
                    player.gravityMs = player.gravityMs - interval
                    if not move_piece(player, 0, 1) then
                        lock_piece(context, player)
                    else
                        context.dirty = true
                    end
                    interval = gravity_interval(player)
                end
            end
            if check_finished(context) then
                return
            end
        end
    end,

    on_snapshot = function(context, recipient)
        return snapshot(context)
    end,

    on_unload = function(context)
        context.players = {}
        context.sequence = {}
        context.sequenceBase = 1
        context.bag = {}
    end
}
