local WIDTH = 19
local HEIGHT = 19
local TUNNEL_ROW = 9
local ROUND_MS = 120000
local COUNTDOWN_MS = 3000
local CHOMPER_SPEED = 4.55
local GHOST_SPEED = 4.25
local FRIGHTENED_SPEED = 3.45
local COLLISION_RADIUS_SQ = 0.34

local MAP = {
    "###################",
    "#o.....#...#.....o#",
    "#.###.#.#.#.#.###.#",
    "#.....#.....#.....#",
    "###.#.###.###.#.###",
    "#...#...#.#...#...#",
    "#.#####.#.#.#####.#",
    "#.......#.#.......#",
    "#.###.###.###.###.#",
    "......... .........",
    "#.###.#.#####.#.###",
    "#.....#..   ..#...#",
    "###.#.##   ##.#.###",
    "#...#..     ..#...#",
    "#.#####.###.#####.#",
    "#.......#.#.......#",
    "#.###.#.#.#.#.###.#",
    "#o..#.........#..o#",
    "###################"
}

local DX = {0, 1, 0, -1}
local DY = {-1, 0, 1, 0}
local POW2 = {}
for i = 0, WIDTH - 1 do
    POW2[i + 1] = 2 ^ i
end

local CHOMPER_SPAWNS = {
    {x = 9, y = 17, dir = 3},
    {x = 9, y = 1, dir = 1}
}

local GHOST_SPAWNS = {
    {x = 9, y = 12, dir = 0},
    {x = 10, y = 12, dir = 0}
}

local function round(value)
    return math.floor(value + 0.5)
end

local function clamp(value, low, high)
    if value < low then return low end
    if value > high then return high end
    return value
end

local function quantise(value)
    return math.floor(value * 100 + 0.5) / 100
end

local function has_bit(mask, x)
    local bit = POW2[x + 1]
    return math.floor(mask / bit) % 2 == 1
end

local function clear_bit(mask, x)
    if has_bit(mask, x) then
        return mask - POW2[x + 1], true
    end
    return mask, false
end

local function tile_at(x, y)
    if y < 0 or y >= HEIGHT then return "#" end
    if x < 0 or x >= WIDTH then
        if y == TUNNEL_ROW then return "." end
        return "#"
    end
    return string.sub(MAP[y + 1], x + 1, x + 1)
end

local function is_open(x, y)
    return tile_at(x, y) ~= "#"
end

local function can_move_from(x, y, direction)
    if direction < 0 or direction > 3 then return false end
    return is_open(x + DX[direction + 1], y + DY[direction + 1])
end

local function build_pellets(context)
    context.pelletRows = {}
    context.powerRows = {}
    context.pelletsRemaining = 0

    for y = 0, HEIGHT - 1 do
        local pelletMask = 0
        local powerMask = 0
        local row = MAP[y + 1]
        for x = 0, WIDTH - 1 do
            local tile = string.sub(row, x + 1, x + 1)
            if tile == "." then
                pelletMask = pelletMask + POW2[x + 1]
                context.pelletsRemaining = context.pelletsRemaining + 1
            elseif tile == "o" then
                powerMask = powerMask + POW2[x + 1]
                context.pelletsRemaining = context.pelletsRemaining + 1
            end
        end
        context.pelletRows[y + 1] = pelletMask
        context.powerRows[y + 1] = powerMask
    end
end

local function players_in_seat_order(context)
    local ordered = {}
    local current = match.players()
    for _, platformPlayer in ipairs(current) do
        local player = context.players[platformPlayer.profileId]
        if player then
            player.seat = platformPlayer.seat
            player.nickname = platformPlayer.nickname
            player.connected = platformPlayer.connected
            ordered[#ordered + 1] = player
        end
    end
    return ordered
end

local function reconcile_players(context)
    local present = {}
    local current = match.players()

    for _, platformPlayer in ipairs(current) do
        present[platformPlayer.profileId] = true
        local player = context.players[platformPlayer.profileId]
        if not player then
            player = {
                profileId = platformPlayer.profileId,
                nickname = platformPlayer.nickname,
                seat = platformPlayer.seat,
                connected = platformPlayer.connected,
                preference = "flex",
                role = false,
                roleIndex = 0,
                score = 0,
                lives = 0,
                x = 0,
                y = 0,
                direction = -1,
                desiredDirection = -1,
                active = false,
                respawnMs = 0,
                invulnerableMs = 0
            }
            context.players[platformPlayer.profileId] = player
        else
            player.nickname = platformPlayer.nickname
            player.seat = platformPlayer.seat
            player.connected = platformPlayer.connected
        end
    end

    for profileId, _ in pairs(context.players) do
        if not present[profileId] then
            context.players[profileId] = nil
        end
    end
end

local function assign_roles(context)
    local ordered = players_in_seat_order(context)
    local total = #ordered
    local chomperTarget = 1

    if total >= 4 then
        chomperTarget = 2
    elseif total == 3 then
        local chomperPrefs = 0
        local ghostPrefs = 0
        for _, player in ipairs(ordered) do
            if player.preference == "chomper" then chomperPrefs = chomperPrefs + 1 end
            if player.preference == "ghost" then ghostPrefs = ghostPrefs + 1 end
        end
        if chomperPrefs >= 2 and ghostPrefs < 2 then
            chomperTarget = 2
        else
            chomperTarget = 1
        end
    end

    local ghostTarget = total - chomperTarget
    local assigned = {}
    local chompers = 0
    local ghosts = 0

    for _, player in ipairs(ordered) do
        if player.preference == "chomper" and chompers < chomperTarget then
            player.role = "chomper"
            assigned[player.profileId] = true
            chompers = chompers + 1
        end
    end

    for _, player in ipairs(ordered) do
        if not assigned[player.profileId] and player.preference == "ghost" and ghosts < ghostTarget then
            player.role = "ghost"
            assigned[player.profileId] = true
            ghosts = ghosts + 1
        end
    end

    for _, player in ipairs(ordered) do
        if not assigned[player.profileId] then
            if chompers < chomperTarget then
                player.role = "chomper"
                chompers = chompers + 1
            else
                player.role = "ghost"
                ghosts = ghosts + 1
            end
            assigned[player.profileId] = true
        end
    end

    local chomperIndex = 0
    local ghostIndex = 0
    for _, player in ipairs(ordered) do
        player.score = 0
        player.direction = -1
        player.desiredDirection = -1
        player.respawnMs = 0
        player.invulnerableMs = 1800
        player.active = true

        if player.role == "chomper" then
            chomperIndex = chomperIndex + 1
            local spawn = CHOMPER_SPAWNS[chomperIndex]
            player.roleIndex = chomperIndex
            player.lives = 3
            player.x = spawn.x
            player.y = spawn.y
            player.direction = spawn.dir
            player.desiredDirection = spawn.dir
        else
            ghostIndex = ghostIndex + 1
            local spawn = GHOST_SPAWNS[ghostIndex]
            player.roleIndex = ghostIndex
            player.lives = 1
            player.x = spawn.x
            player.y = spawn.y
            player.direction = spawn.dir
            player.desiredDirection = spawn.dir
        end
    end
end

local function snapshot(context)
    local payload = {
        phase = context.phase,
        mazeId = "neon-grid",
        countdownMs = math.max(0, math.floor(context.countdownMs or 0)),
        roundTimeMs = math.max(0, math.floor(context.roundTimeMs or ROUND_MS)),
        pelletsRemaining = context.pelletsRemaining or 0,
        powerMs = math.max(0, math.floor(context.powerMs or 0)),
        winnerTeam = context.winnerTeam or false,
        finishReason = context.finishReason or false,
        players = {}
    }

    if context.pelletRows then
        payload.pelletRows = {}
        payload.powerRows = {}
        for i = 1, HEIGHT do
            payload.pelletRows[i] = context.pelletRows[i]
            payload.powerRows[i] = context.powerRows[i]
        end
    end

    local ordered = players_in_seat_order(context)
    for _, player in ipairs(ordered) do
        payload.players[#payload.players + 1] = {
            seat = player.seat,
            nickname = player.nickname,
            preference = player.preference,
            role = player.role,
            roleIndex = player.roleIndex,
            score = player.score,
            lives = player.lives,
            x = quantise(player.x),
            y = quantise(player.y),
            direction = player.direction,
            active = player.active,
            respawnMs = math.max(0, math.floor(player.respawnMs)),
            invulnerable = player.invulnerableMs > 0
        }
    end

    return payload
end

local function broadcast_state(context)
    transport.broadcast_snapshot(snapshot(context))
end

local function finish_round(context, winnerTeam, reason)
    if context.finished then return end

    local ordered = players_in_seat_order(context)
    if #ordered == 0 then
        context.phase = "lobby"
        context.finished = false
        context.winnerTeam = false
        context.finishReason = false
        return
    end

    context.finished = true
    context.phase = "finished"
    context.winnerTeam = winnerTeam
    context.finishReason = reason
    context.roundTimeMs = math.max(0, context.roundTimeMs or 0)

    broadcast_state(context)

    local placements = {}
    local isDraw = winnerTeam == "draw"
    for _, player in ipairs(ordered) do
        local place = 1
        if not isDraw and player.role ~= winnerTeam then
            place = 2
        end
        placements[#placements + 1] = {
            seat = player.seat,
            place = place
        }
    end

    match.finish({
        draw = isDraw,
        placements = placements
    })
end

local function start_round(context)
    reconcile_players(context)
    local ordered = players_in_seat_order(context)
    if #ordered < 2 then return end

    assign_roles(context)
    build_pellets(context)
    context.phase = "countdown"
    context.countdownMs = COUNTDOWN_MS
    context.roundTimeMs = ROUND_MS
    context.elapsedMs = 0
    context.powerMs = 0
    context.powerCombo = 0
    context.winnerTeam = false
    context.finishReason = false
    context.finished = false
    transport.broadcast_event("round_start", {})
    broadcast_state(context)
end

local function try_turn(player)
    local tileX = round(player.x)
    local tileY = round(player.y)
    if can_move_from(tileX, tileY, player.desiredDirection) then
        player.direction = player.desiredDirection
    end
    if not can_move_from(tileX, tileY, player.direction) then
        player.direction = -1
    end
end

local function move_player(player, deltaMs, frightened)
    if not player.active then return end

    local speed = CHOMPER_SPEED
    if player.role == "ghost" then
        speed = frightened and FRIGHTENED_SPEED or GHOST_SPEED
    end
    local step = speed * deltaMs / 1000

    local nearestX = round(player.x)
    local nearestY = round(player.y)

    -- Only snap after crossing or closely approaching a tile centre.  The old
    -- threshold used the full movement step, so every tick snapped a player
    -- back to the centre they had just left and movement never accumulated.
    local centreTolerance = math.max(0.035, step * 0.55)
    if math.abs(player.x - nearestX) <= centreTolerance and
       math.abs(player.y - nearestY) <= centreTolerance then
        player.x = nearestX
        player.y = nearestY
        try_turn(player)
    end

    if player.direction >= 0 then
        player.x = player.x + DX[player.direction + 1] * step
        player.y = player.y + DY[player.direction + 1] * step
    end

    if round(player.y) == TUNNEL_ROW then
        if player.x < -0.15 then player.x = WIDTH - 0.85 end
        if player.x > WIDTH - 0.85 then player.x = -0.15 end
    end
end

local function consume_pellet(context, player)
    if player.role ~= "chomper" or not player.active then return end

    local tileX = round(player.x)
    local tileY = round(player.y)
    if tileX < 0 or tileX >= WIDTH or tileY < 0 or tileY >= HEIGHT then return end
    if math.abs(player.x - tileX) > 0.28 or math.abs(player.y - tileY) > 0.28 then return end

    local changed = false
    local rowIndex = tileY + 1
    context.pelletRows[rowIndex], changed = clear_bit(context.pelletRows[rowIndex], tileX)
    if changed then
        player.score = player.score + 10
        context.pelletsRemaining = context.pelletsRemaining - 1
        return
    end

    context.powerRows[rowIndex], changed = clear_bit(context.powerRows[rowIndex], tileX)
    if changed then
        player.score = player.score + 50
        context.pelletsRemaining = context.pelletsRemaining - 1
        context.powerMs = 7000
        context.powerCombo = 0
        transport.broadcast_event("power", {seat = player.seat})
    end
end

local function respawn_player(player, deltaMs)
    if player.invulnerableMs > 0 then
        player.invulnerableMs = math.max(0, player.invulnerableMs - deltaMs)
    end
    if player.active or player.respawnMs <= 0 then return end

    player.respawnMs = math.max(0, player.respawnMs - deltaMs)
    if player.respawnMs > 0 then return end

    if player.role == "chomper" and player.lives <= 0 then return end

    local spawn
    if player.role == "chomper" then
        spawn = CHOMPER_SPAWNS[player.roleIndex]
    else
        spawn = GHOST_SPAWNS[player.roleIndex]
    end
    player.x = spawn.x
    player.y = spawn.y
    player.direction = spawn.dir
    player.desiredDirection = spawn.dir
    player.active = true
    player.invulnerableMs = 1800
end

local function tunnel_distance_x(a, b)
    local direct = math.abs(a - b)
    return math.min(direct, WIDTH - direct)
end

local function resolve_collisions(context, ordered)
    for _, chomper in ipairs(ordered) do
        if chomper.role == "chomper" and chomper.active then
            for _, ghost in ipairs(ordered) do
                if ghost.role == "ghost" and ghost.active then
                    local dx = tunnel_distance_x(chomper.x, ghost.x)
                    local dy = chomper.y - ghost.y
                    if dx * dx + dy * dy <= COLLISION_RADIUS_SQ then
                        if context.powerMs > 0 then
                            ghost.active = false
                            ghost.respawnMs = 1800
                            context.powerCombo = context.powerCombo + 1
                            local bonus = 200 * context.powerCombo
                            chomper.score = chomper.score + bonus
                            transport.broadcast_event("ghost_eaten", {
                                chomperSeat = chomper.seat,
                                ghostSeat = ghost.seat,
                                bonus = bonus
                            })
                        elseif chomper.invulnerableMs <= 0 then
                            chomper.lives = chomper.lives - 1
                            chomper.active = false
                            if chomper.lives > 0 then
                                chomper.respawnMs = 1600
                            else
                                chomper.respawnMs = 0
                            end
                            ghost.score = ghost.score + 250
                            transport.broadcast_event("chomper_hit", {
                                chomperSeat = chomper.seat,
                                ghostSeat = ghost.seat
                            })
                            break
                        end
                    end
                end
            end
        end
    end
end

local function count_active_chompers(ordered)
    local count = 0
    for _, player in ipairs(ordered) do
        if player.role == "chomper" and (player.active or player.lives > 0) then
            count = count + 1
        end
    end
    return count
end

local function evaluate_departure(context)
    local ordered = players_in_seat_order(context)
    if #ordered == 0 then
        context.phase = "lobby"
        context.finished = false
        return
    end

    if context.phase ~= "countdown" and context.phase ~= "playing" then
        broadcast_state(context)
        return
    end

    local chompers = 0
    local ghosts = 0
    for _, player in ipairs(ordered) do
        if player.role == "chomper" then chompers = chompers + 1 end
        if player.role == "ghost" then ghosts = ghosts + 1 end
    end

    if #ordered == 1 then
        finish_round(context, ordered[1].role, "opponents_left")
    elseif chompers == 0 then
        finish_round(context, "ghost", "chompers_left")
    elseif ghosts == 0 then
        finish_round(context, "chomper", "ghosts_left")
    else
        broadcast_state(context)
    end
end

return {
    init = function(context)
        context.players = {}
        context.phase = "lobby"
        context.countdownMs = 0
        context.roundTimeMs = ROUND_MS
        context.elapsedMs = 0
        context.powerMs = 0
        context.powerCombo = 0
        context.pelletsRemaining = 0
        context.finished = false
        context.winnerTeam = false
        context.finishReason = false
    end,

    on_match_open = function(context)
        reconcile_players(context)
    end,

    on_player_join = function(context, player)
        reconcile_players(context)
        broadcast_state(context)
    end,

    on_player_leave = function(context, player, reason)
        reconcile_players(context)
        evaluate_departure(context)
    end,

    on_player_update = function(context, player)
        reconcile_players(context)
        broadcast_state(context)
    end,

    on_command = function(context, player, action, data, sequence)
        local current = context.players[player.profileId]
        if not current then return end

        if action == "role" and context.phase == "lobby" then
            local preference = data.preference
            if preference == "chomper" or preference == "ghost" or preference == "flex" then
                current.preference = preference
                broadcast_state(context)
            end
            return
        end

        if action == "turn" and context.phase == "playing" then
            local direction = data.direction
            if type(direction) == "number" and direction == math.floor(direction) and direction >= 0 and direction <= 3 then
                current.desiredDirection = direction
            end
        end
    end,

    on_tick = function(context, deltaMs)
        if context.finished then return end
        deltaMs = clamp(deltaMs, 0, 100)

        if context.phase == "lobby" then
            start_round(context)
            return
        end

        if context.phase == "countdown" then
            context.countdownMs = math.max(0, context.countdownMs - deltaMs)
            if context.countdownMs <= 0 then
                context.phase = "playing"
                transport.broadcast_event("go", {})
            end
            return
        end

        if context.phase ~= "playing" then return end

        context.elapsedMs = context.elapsedMs + deltaMs
        context.roundTimeMs = math.max(0, ROUND_MS - context.elapsedMs)

        if context.powerMs > 0 then
            context.powerMs = math.max(0, context.powerMs - deltaMs)
            if context.powerMs <= 0 then
                context.powerCombo = 0
            end
        end

        local frightened = context.powerMs > 0
        local ordered = players_in_seat_order(context)
        for _, current in ipairs(ordered) do
            respawn_player(current, deltaMs)
            move_player(current, deltaMs, frightened)
            consume_pellet(context, current)
        end

        resolve_collisions(context, ordered)

        if context.pelletsRemaining <= 0 then
            finish_round(context, "chomper", "maze_cleared")
        elseif count_active_chompers(ordered) <= 0 then
            finish_round(context, "ghost", "all_chompers_caught")
        elseif context.roundTimeMs <= 0 then
            finish_round(context, "ghost", "time_expired")
        end
    end,

    on_snapshot = function(context, recipient)
        return snapshot(context)
    end,

    on_unload = function(context)
        context.players = {}
        context.pelletRows = nil
        context.powerRows = nil
    end
}
