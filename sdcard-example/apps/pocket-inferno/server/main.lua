local PI = math.pi
local TWO_PI = PI * 2
local PLAYER_RADIUS = 0.22
local MOVE_SPEED = 2.35
local SCORE_LIMIT = 7
local ROUND_MS = 180000
local COUNTDOWN_MS = 3000
local RESPAWN_MS = 1600
local PICKUP_RESPAWN_MS = 8000
local EMPTY_CELL_BYTE = 48
local RAY_EPSILON = 0.000000000001
local SHOTGUN_SPREAD = {-0.18, -0.12, -0.06, 0, 0.06, 0.12, 0.18}

local MAP = {
    "1111111111111111",
    "1000001000000001",
    "1011101001110101",
    "1000100001000101",
    "1100110101011101",
    "1000000101000001",
    "1011110000011101",
    "1000010111000001",
    "1010010001010101",
    "1000001100010001",
    "1110100001110101",
    "1000101100000101",
    "1011100010111101",
    "1000001000000001",
    "1000000000000001",
    "1111111111111111"
}
local MAP_HEIGHT = #MAP
local MAP_WIDTH = #MAP[1]
local MAX_RAY_STEPS = MAP_HEIGHT + MAP_WIDTH + 2

local SPAWNS = {
    {x = 1.5, y = 1.5, a = 0.20},
    {x = 14.5, y = 1.5, a = 2.90},
    {x = 1.5, y = 14.5, a = -0.35},
    {x = 14.5, y = 14.5, a = -2.75},
    {x = 7.5, y = 3.5, a = 1.55},
    {x = 8.5, y = 12.5, a = -1.55},
    {x = 3.5, y = 8.5, a = 0.05},
    {x = 12.5, y = 7.5, a = 3.10}
}

local PICKUP_DEFS = {
    {id = 1, kind = "health", x = 7.5, y = 7.5},
    {id = 2, kind = "health", x = 8.5, y = 8.5},
    {id = 3, kind = "shells", x = 4.5, y = 4.5},
    {id = 4, kind = "shells", x = 11.5, y = 11.5},
    {id = 5, kind = "shells", x = 3.5, y = 12.5},
    {id = 6, kind = "shells", x = 12.5, y = 3.5}
}

local BARREL_BLAST_RADIUS = 1.6
local BARREL_CHAIN_RADIUS = 1.45
local BARREL_HIT_RADIUS = 0.34
local BARREL_DEFS = {
    {id = 1, kind = "wood", x = 5.5, y = 1.5},
    {id = 2, kind = "wood", x = 10.5, y = 1.5},
    {id = 3, kind = "wood", x = 2.5, y = 14.5},
    {id = 4, kind = "wood", x = 13.5, y = 14.5},
    {id = 5, kind = "flame", x = 7.5, y = 6.5},
    {id = 6, kind = "flame", x = 8.5, y = 9.5},
    {id = 7, kind = "flame", x = 4.5, y = 14.5},
    {id = 8, kind = "flame", x = 11.5, y = 14.5}
}

local function clamp(value, low, high)
    if value < low then return low end
    if value > high then return high end
    return value
end

local function finite_number(value)
    return type(value) == "number" and value == value and value > -math.huge and value < math.huge
end

local function normalise_angle(angle)
    angle = (angle + PI) % TWO_PI
    if angle < 0 then angle = angle + TWO_PI end
    return angle - PI
end

local function quantise(value)
    return math.floor(value * 1000 + 0.5) / 1000
end

local function map_cell(x, y)
    local column = math.floor(x) + 1
    local row = math.floor(y) + 1
    if row < 1 or row > MAP_HEIGHT or column < 1 or column > MAP_WIDTH then
        return "1"
    end
    return string.sub(MAP[row], column, column)
end

local function is_wall(x, y)
    return map_cell(x, y) ~= "0"
end

local function position_clear(x, y)
    local r = PLAYER_RADIUS
    return not is_wall(x - r, y - r)
        and not is_wall(x + r, y - r)
        and not is_wall(x - r, y + r)
        and not is_wall(x + r, y + r)
end

local function reset_pickups(context)
    context.pickups = context.pickups or {}
    for index, definition in ipairs(PICKUP_DEFS) do
        local pickup = context.pickups[index]
        if not pickup then
            pickup = {
                id = definition.id,
                kind = definition.kind,
                x = definition.x,
                y = definition.y,
                active = true,
                readyAt = 0,
                snapshot = {id = definition.id, active = true}
            }
            context.pickups[index] = pickup
        else
            pickup.active = true
            pickup.readyAt = 0
            pickup.snapshot.active = true
        end
        if context.snapshotPayload then
            context.snapshotPayload.pickups[index] = pickup.snapshot
        end
    end
end

local function reset_barrels(context)
    context.barrels = context.barrels or {}
    for index, definition in ipairs(BARREL_DEFS) do
        local barrel = context.barrels[index]
        if not barrel then
            barrel = {
                id = definition.id,
                kind = definition.kind,
                x = definition.x,
                y = definition.y,
                active = true,
                snapshot = {
                    id = definition.id,
                    kind = definition.kind,
                    x = definition.x,
                    y = definition.y,
                    active = true
                }
            }
            context.barrels[index] = barrel
        else
            barrel.kind = definition.kind
            barrel.x = definition.x
            barrel.y = definition.y
            barrel.active = true
            barrel.snapshot.kind = definition.kind
            barrel.snapshot.x = definition.x
            barrel.snapshot.y = definition.y
            barrel.snapshot.active = true
        end
        if context.snapshotPayload then
            context.snapshotPayload.barrels[index] = barrel.snapshot
        end
    end
end

local function occupied_players(context)
    local list = {}
    for index, player in ipairs(context.orderedPlayers or {}) do
        list[index] = player
    end
    return list
end

local function choose_spawn(context, player)
    local best = SPAWNS[1]
    local best_score = -1
    local start_index = (random.next() % #SPAWNS) + 1
    for offset = 0, #SPAWNS - 1 do
        local candidate = SPAWNS[((start_index + offset - 1) % #SPAWNS) + 1]
        local nearest = 999
        for _, other in pairs(context.players) do
            if other.profileId ~= player.profileId and not other.dead then
                local dx = candidate.x - other.x
                local dy = candidate.y - other.y
                local distance_sq = dx * dx + dy * dy
                if distance_sq < nearest then nearest = distance_sq end
            end
        end
        if nearest > best_score then
            best_score = nearest
            best = candidate
        end
    end
    player.x = best.x
    player.y = best.y
    player.a = best.a
    player.moveAngle = best.a
end

local function reset_player_for_round(context, player)
    player.health = 100
    player.kills = 0
    player.deaths = 0
    player.dead = false
    player.respawnAt = 0
    player.weapon = 1
    player.ammo = 4
    player.forward = 0
    player.strafe = 0
    player.nextShotAt = 0
    player.pendingDamage = 0
    choose_spawn(context, player)
end

local function new_player(context, source)
    local player = {
        profileId = source.profileId,
        nickname = source.nickname,
        seat = source.seat,
        connected = source.connected,
        x = 1.5,
        y = 1.5,
        a = 0,
        moveAngle = 0,
        health = 100,
        kills = 0,
        deaths = 0,
        dead = false,
        respawnAt = 0,
        weapon = 1,
        ammo = 4,
        forward = 0,
        strafe = 0,
        nextShotAt = 0,
        pendingDamage = 0,
        snapshot = {
            seat = source.seat,
            x = 1.5,
            y = 1.5,
            a = 0,
            ma = 0,
            h = 100,
            k = 0,
            d = 0,
            dead = false,
            respawn = 0,
            w = 1,
            ammo = 4
        }
    }
    context.players[source.profileId] = player
    choose_spawn(context, player)
    return player
end

local function reconcile_players(context)
    local current = match.players()
    for _, player in pairs(context.players) do
        player.present = false
    end

    for _, source in ipairs(current) do
        local player = context.players[source.profileId]
        if not player then
            player = new_player(context, source)
        end
        player.present = true
        player.nickname = source.nickname
        player.seat = source.seat
        player.connected = source.connected
        player.snapshot.seat = source.seat
        if not source.connected then
            player.forward = 0
            player.strafe = 0
        end
    end

    for profile_id, player in pairs(context.players) do
        if not player.present then
            context.players[profile_id] = nil
        end
    end

    local ordered = context.orderedPlayers
    local payload_players = context.snapshotPayload.players
    for index = #ordered, 1, -1 do ordered[index] = nil end
    for index = #payload_players, 1, -1 do payload_players[index] = nil end
    for index, source in ipairs(current) do
        local player = context.players[source.profileId]
        ordered[index] = player
        payload_players[index] = player.snapshot
    end
    return #current
end

local function reset_waiting_round(context)
    context.phase = "waiting"
    context.now = 0
    context.countdownLeft = COUNTDOWN_MS
    context.timeLeft = ROUND_MS
    reset_pickups(context)
    reset_barrels(context)
    for _, player in pairs(context.players) do
        reset_player_for_round(context, player)
    end
end

local function begin_countdown(context)
    context.phase = "countdown"
    context.countdownLeft = COUNTDOWN_MS
    context.timeLeft = ROUND_MS
    reset_pickups(context)
    reset_barrels(context)
    for _, player in pairs(context.players) do
        reset_player_for_round(context, player)
    end
    transport.broadcast_event("countdown", {seconds = 3})
end

local function ray_wall_distance(x, y, cosine, sine, maximum)
    local map_x = math.floor(x)
    local map_y = math.floor(y)
    local delta_x
    local delta_y
    local step_x
    local step_y
    local side_x
    local side_y

    if cosine < -RAY_EPSILON then
        step_x = -1
        delta_x = math.abs(1 / cosine)
        side_x = (x - map_x) * delta_x
    elseif cosine > RAY_EPSILON then
        step_x = 1
        delta_x = math.abs(1 / cosine)
        side_x = (map_x + 1 - x) * delta_x
    else
        step_x = 0
        delta_x = math.huge
        side_x = math.huge
    end

    if sine < -RAY_EPSILON then
        step_y = -1
        delta_y = math.abs(1 / sine)
        side_y = (y - map_y) * delta_y
    elseif sine > RAY_EPSILON then
        step_y = 1
        delta_y = math.abs(1 / sine)
        side_y = (map_y + 1 - y) * delta_y
    else
        step_y = 0
        delta_y = math.huge
        side_y = math.huge
    end

    for _ = 1, MAX_RAY_STEPS do
        local distance
        if side_x < side_y then
            map_x = map_x + step_x
            distance = side_x
            side_x = side_x + delta_x
        else
            map_y = map_y + step_y
            distance = side_y
            side_y = side_y + delta_y
        end

        if distance > maximum then return maximum end

        local row = map_y + 1
        local column = map_x + 1
        if row < 1 or row > MAP_HEIGHT or column < 1 or column > MAP_WIDTH then
            return distance
        end
        if string.byte(MAP[row], column) ~= EMPTY_CELL_BYTE then
            return distance
        end
    end
    return maximum
end

local function trace_shot(context, shooter, angle, maximum)
    local cosine = math.cos(angle)
    local sine = math.sin(angle)
    local wall_distance = ray_wall_distance(shooter.x, shooter.y, cosine, sine, maximum)
    local best = nil
    local best_distance = wall_distance
    local hit_radius_sq = 0.29 * 0.29
    local barrel_radius_sq = BARREL_HIT_RADIUS * BARREL_HIT_RADIUS

    for _, target in ipairs(context.orderedPlayers) do
        if target.profileId ~= shooter.profileId and not target.dead then
            local dx = target.x - shooter.x
            local dy = target.y - shooter.y
            local along = dx * cosine + dy * sine
            if along > 0 and along < best_distance then
                local perpendicular_x = dx - along * cosine
                local perpendicular_y = dy - along * sine
                local perpendicular_sq = perpendicular_x * perpendicular_x + perpendicular_y * perpendicular_y
                if perpendicular_sq <= hit_radius_sq then
                    best = {kind = "player", ref = target}
                    best_distance = along
                end
            end
        end
    end

    for _, barrel in ipairs(context.barrels or {}) do
        if barrel.active and barrel.kind == "flame" then
            local dx = barrel.x - shooter.x
            local dy = barrel.y - shooter.y
            local along = dx * cosine + dy * sine
            if along > 0 and along < best_distance then
                local perpendicular_x = dx - along * cosine
                local perpendicular_y = dy - along * sine
                local perpendicular_sq = perpendicular_x * perpendicular_x + perpendicular_y * perpendicular_y
                if perpendicular_sq <= barrel_radius_sq then
                    best = {kind = "barrel", ref = barrel}
                    best_distance = along
                end
            end
        end
    end

    return best
end

local function apply_damage(context, shooter, target, amount)
    if target.dead or amount <= 0 then return end
    target.health = math.max(0, target.health - amount)
    transport.broadcast_event("hit", {
        attacker = shooter and shooter.seat or 0,
        target = target.seat,
        damage = amount,
        health = target.health
    })
    if target.health <= 0 then
        target.dead = true
        target.deaths = target.deaths + 1
        target.respawnAt = context.now + RESPAWN_MS
        target.forward = 0
        target.strafe = 0
        local self_frag = shooter ~= nil and shooter.profileId == target.profileId
        local score = shooter and shooter.kills or 0
        if shooter and not self_frag then
            shooter.kills = shooter.kills + 1
            score = shooter.kills
        end
        transport.broadcast_event("frag", {
            killer = shooter and shooter.seat or 0,
            victim = target.seat,
            score = score,
            self = self_frag
        })
    end
end

local function explode_barrel(context, shooter, barrel)
    if not barrel or not barrel.active then return end
    barrel.active = false
    barrel.snapshot.active = false
    transport.broadcast_event("barrel_explode", {
        id = barrel.id,
        x = barrel.x,
        y = barrel.y,
        seat = shooter and shooter.seat or 0
    })

    local blast_radius_sq = BARREL_BLAST_RADIUS * BARREL_BLAST_RADIUS
    for _, target in ipairs(context.orderedPlayers) do
        if not target.dead then
            local dx = target.x - barrel.x
            local dy = target.y - barrel.y
            if dx * dx + dy * dy <= blast_radius_sq then
                apply_damage(context, shooter or target, target, 999)
            end
        end
    end

    local chain_radius_sq = BARREL_CHAIN_RADIUS * BARREL_CHAIN_RADIUS
    for _, other in ipairs(context.barrels or {}) do
        if other.active and other.kind == "flame" and other.id ~= barrel.id then
            local dx = other.x - barrel.x
            local dy = other.y - barrel.y
            if dx * dx + dy * dy <= chain_radius_sq then
                explode_barrel(context, shooter, other)
            end
        end
    end
end

local build_snapshot

local function finish_match(context)
    if context.phase == "finished" then return end
    context.phase = "finished"
    local players = occupied_players(context)
    table.sort(players, function(left, right)
        if left.kills ~= right.kills then return left.kills > right.kills end
        if left.deaths ~= right.deaths then return left.deaths < right.deaths end
        return left.seat < right.seat
    end)

    local draw = #players > 1 and players[1].kills == players[#players].kills
    local placements = {}
    local previous_kills = nil
    local previous_place = 1
    for index, player in ipairs(players) do
        local place = draw and 1 or index
        if not draw and previous_kills ~= nil and player.kills == previous_kills then
            place = previous_place
        end
        placements[#placements + 1] = {seat = player.seat, place = place}
        previous_kills = player.kills
        previous_place = place
    end

    transport.broadcast_snapshot(build_snapshot(context))

    match.finish({draw = draw, placements = placements})
end

local function try_fire(context, shooter)
    if context.phase ~= "playing" or shooter.dead then return end
    if context.now < shooter.nextShotAt then return end

    local weapon = shooter.weapon
    if weapon == 2 and shooter.ammo <= 0 then
        shooter.weapon = 1
        weapon = 1
    end

    for _, target in ipairs(context.orderedPlayers) do
        target.pendingDamage = 0
    end

    if weapon == 2 then
        shooter.nextShotAt = context.now + 760
        shooter.ammo = shooter.ammo - 1
        for _, offset in ipairs(SHOTGUN_SPREAD) do
            local hit = trace_shot(context, shooter, shooter.a + offset, 7.2)
            if hit then
                if hit.kind == "player" then
                    hit.ref.pendingDamage = hit.ref.pendingDamage + 8
                elseif hit.kind == "barrel" then
                    explode_barrel(context, shooter, hit.ref)
                end
            end
        end
    else
        shooter.nextShotAt = context.now + 260
        local hit = trace_shot(context, shooter, shooter.a, 9.5)
        if hit then
            if hit.kind == "player" then
                hit.ref.pendingDamage = 22
            elseif hit.kind == "barrel" then
                explode_barrel(context, shooter, hit.ref)
            end
        end
    end

    transport.broadcast_event("shot", {seat = shooter.seat, weapon = weapon})
    for _, target in ipairs(context.orderedPlayers) do
        local damage = target.pendingDamage
        target.pendingDamage = 0
        if damage > 0 then apply_damage(context, shooter, target, damage) end
    end

    if shooter.kills >= SCORE_LIMIT then
        finish_match(context)
    end
end

local function move_player(player, delta_seconds)
    if player.dead then return end
    local cosine = math.cos(player.a)
    local sine = math.sin(player.a)
    local right_x = -sine
    local right_y = cosine
    local velocity_x = (cosine * player.forward + right_x * player.strafe) * MOVE_SPEED
    local velocity_y = (sine * player.forward + right_y * player.strafe) * MOVE_SPEED
    if player.forward ~= 0 and player.strafe ~= 0 then
        velocity_x = velocity_x * 0.707106
        velocity_y = velocity_y * 0.707106
    end

    local previous_x = player.x
    local previous_y = player.y
    local next_x = player.x + velocity_x * delta_seconds
    local next_y = player.y + velocity_y * delta_seconds
    if position_clear(next_x, player.y) then player.x = next_x end
    if position_clear(player.x, next_y) then player.y = next_y end

    local moved_x = player.x - previous_x
    local moved_y = player.y - previous_y
    if moved_x * moved_x + moved_y * moved_y > 0.0000001 then
        player.moveAngle = math.atan(moved_y, moved_x)
    else
        player.moveAngle = player.a
    end
end

local function update_pickups(context)
    for _, pickup in ipairs(context.pickups) do
        if not pickup.active and context.now >= pickup.readyAt then
            pickup.active = true
        end
        if pickup.active then
            for _, player in pairs(context.players) do
                if not player.dead then
                    local dx = player.x - pickup.x
                    local dy = player.y - pickup.y
                    if dx * dx + dy * dy <= 0.42 * 0.42 then
                        local collected = false
                        if pickup.kind == "health" and player.health < 100 then
                            player.health = math.min(100, player.health + 30)
                            collected = true
                        elseif pickup.kind == "shells" and player.ammo < 12 then
                            player.ammo = math.min(12, player.ammo + 4)
                            collected = true
                        end
                        if collected then
                            pickup.active = false
                            pickup.readyAt = context.now + PICKUP_RESPAWN_MS
                            transport.broadcast_event("pickup", {
                                seat = player.seat,
                                kind = pickup.kind
                            })
                            break
                        end
                    end
                end
            end
        end
    end
end

build_snapshot = function(context)
    local payload = context.snapshotPayload
    payload.phase = context.phase
    payload.countdown = context.countdownLeft > 0 and context.countdownLeft or 0
    payload.time = context.timeLeft > 0 and context.timeLeft or 0

    for _, player in ipairs(context.orderedPlayers) do
        local output = player.snapshot
        output.x = quantise(player.x)
        output.y = quantise(player.y)
        output.a = quantise(player.a)
        output.ma = quantise(player.moveAngle or player.a)
        output.h = player.health
        output.k = player.kills
        output.d = player.deaths
        output.dead = player.dead
        output.respawn = player.respawnAt > context.now and player.respawnAt - context.now or 0
        output.w = player.weapon
        output.ammo = player.ammo
    end

    for _, pickup in ipairs(context.pickups) do
        local output = pickup.snapshot
        output.active = pickup.active
    end
    for _, barrel in ipairs(context.barrels or {}) do
        local output = barrel.snapshot
        output.active = barrel.active
    end
    return payload
end

return {
    init = function(context)
        context.players = {}
        context.orderedPlayers = {}
        context.snapshotPayload = {
            v = 1,
            phase = "waiting",
            countdown = COUNTDOWN_MS,
            time = ROUND_MS,
            limit = SCORE_LIMIT,
            players = {},
            pickups = {},
            barrels = {}
        }
        context.now = 0
        context.phase = "waiting"
        context.countdownLeft = COUNTDOWN_MS
        context.timeLeft = ROUND_MS
        reset_pickups(context)
        reset_barrels(context)
    end,

    on_match_open = function(context)
        reconcile_players(context)
    end,

    on_player_join = function(context, player)
        reconcile_players(context)
        if match.state() == "waiting" then
            context.phase = "waiting"
        end
    end,

    on_player_leave = function(context, player, reason)
        reconcile_players(context)
        if match.state() == "waiting" then
            reset_waiting_round(context)
        end
    end,

    on_player_update = function(context, player)
        reconcile_players(context)
    end,

    on_command = function(context, source, action, data, sequence)
        if action ~= "input" or type(data) ~= "table" then return end
        local player = context.players[source.profileId]
        if not player then return end

        local forward = finite_number(data.f) and data.f or 0
        local strafe = finite_number(data.s) and data.s or 0
        player.forward = clamp(forward, -1, 1)
        player.strafe = clamp(strafe, -1, 1)

        if finite_number(data.a) then
            local desired = normalise_angle(data.a)
            local difference = normalise_angle(desired - player.a)
            difference = clamp(difference, -0.75, 0.75)
            player.a = normalise_angle(player.a + difference)
        end

        if data.w == 1 or data.w == 2 then
            if data.w == 1 or player.ammo > 0 then player.weapon = data.w end
        end

        if data.fire == true then
            try_fire(context, player)
        end
    end,

    on_tick = function(context, delta_ms)
        if match.state() ~= "playing" then return end
        context.now = context.now + delta_ms

        if context.phase == "waiting" then
            begin_countdown(context)
        end

        if context.phase == "countdown" then
            context.countdownLeft = context.countdownLeft - delta_ms
            if context.countdownLeft <= 0 then
                context.countdownLeft = 0
                context.phase = "playing"
                transport.broadcast_event("start", {})
            end
            return
        end

        if context.phase ~= "playing" then return end

        local delta_seconds = math.min(delta_ms, 100) / 1000
        for _, player in pairs(context.players) do
            if player.dead then
                if context.now >= player.respawnAt then
                    player.health = 100
                    player.dead = false
                    player.weapon = 1
                    player.ammo = math.max(player.ammo, 2)
                    choose_spawn(context, player)
                    transport.broadcast_event("respawn", {seat = player.seat})
                end
            else
                move_player(player, delta_seconds)
            end
        end

        update_pickups(context)
        context.timeLeft = context.timeLeft - delta_ms
        if context.timeLeft <= 0 then
            context.timeLeft = 0
            finish_match(context)
        end
    end,

    on_snapshot = function(context, recipient)
        return build_snapshot(context)
    end,

    on_unload = function(context)
        context.players = {}
        context.orderedPlayers = {}
        context.pickups = {}
        context.barrels = {}
        context.snapshotPayload = nil
    end
}
