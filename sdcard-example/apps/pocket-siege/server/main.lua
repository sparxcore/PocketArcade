local WORLD_W = 1000
local WORLD_H = 560
local GROUND_Y = 500
local GRAVITY = 820
local MAX_SHOTS = 5
local TURN_MS = 20000
local COUNTDOWN_MS = 3000
local RESOLVE_MS = 1100
local MAX_FLIGHT_MS = 9000
local BODY_CELL_SIZE = 100
local BODY_CELL_COUNT = 10

local VALID_PROJECTILES = {
    boulder = true,
    splitter = true,
    bomber = true
}

local VALID_MAPS = {
    canyon = true,
    harbour = true,
    moonbase = true
}

local MATERIAL_DAMAGE = {
    glass = 1.55,
    wood = 1.0,
    stone = 0.58,
    target = 1.0,
    barrel = 1.25
}

local PROJECTILE_DAMAGE = {
    boulder = 1.35,
    splitter = 0.82,
    bomber = 0.92,
    bomb = 1.15
}

local function clamp(value, minimum, maximum)
    if value < minimum then return minimum end
    if value > maximum then return maximum end
    return value
end

local function shallow_copy_array(values)
    local copy = {}
    for i = 1, #values do
        copy[i] = values[i]
    end
    return copy
end

local function reset_setup(context)
    context.phase = "loadout"
    context.phaseMs = 0
    context.mapSelected = nil
    context.mapVotes = {}
    context.battleReady = {}
    context.battle = nil
    context.battleBuild = nil
    context.finished = false
    context.finishRequested = false

    for seat = 1, 2 do
        local player = context.playersBySeat[seat]
        if player then
            player.loadout = nil
            player.loadoutSelected = false
            player.vote = nil
            player.battleReady = false
            player.score = 0
            player.shots = 0
        end
    end
end

local function reconcile_players(context)
    local current = match.players()
    local present = {}

    for i = 1, #current do
        local source = current[i]
        present[source.profileId] = true
        local existing = context.playersById[source.profileId]
        if not existing then
            existing = {
                profileId = source.profileId,
                nickname = source.nickname,
                wins = source.wins,
                seat = source.seat,
                connected = source.connected,
                score = 0,
                shots = 0,
                loadout = nil,
                loadoutSelected = false,
                vote = nil,
                battleReady = false
            }
            context.playersById[source.profileId] = existing
        else
            existing.nickname = source.nickname
            existing.wins = source.wins
            existing.seat = source.seat
            existing.connected = source.connected
        end
        context.playersBySeat[source.seat] = existing
    end

    for profileId, player in pairs(context.playersById) do
        if not present[profileId] then
            context.playersById[profileId] = nil
            if context.playersBySeat[player.seat] == player then
                context.playersBySeat[player.seat] = nil
            end
        end
    end
end

local function both_players(context)
    return context.playersBySeat[1] ~= nil and context.playersBySeat[2] ~= nil
end

local function both_loadouts_selected(context)
    return both_players(context)
        and context.playersBySeat[1].loadoutSelected
        and context.playersBySeat[2].loadoutSelected
end

local function both_votes_cast(context)
    return context.mapVotes[1] ~= nil and context.mapVotes[2] ~= nil
end

local function both_battle_ready(context)
    return context.battleReady[1] == true and context.battleReady[2] == true
end

local function valid_loadout(loadout)
    if type(loadout) ~= "table" or #loadout ~= 3 then return false end
    local seen = {}
    for i = 1, 3 do
        local value = loadout[i]
        if type(value) ~= "string" or not VALID_PROJECTILES[value] or seen[value] then
            return false
        end
        seen[value] = true
    end
    return true
end

local function add_body(battle, body)
    battle.nextBodyId = battle.nextBodyId + 1
    body.id = battle.nextBodyId
    body.alive = true
    body.dynamic = false
    body.vx = 0
    body.vy = 0
    body.last = 0
    body.exploded = false
    body.supporters = body.supporters or {}
    body.supportCandidate = 0
    body.scanSerial = 0
    battle.bodies[#battle.bodies + 1] = body
    battle.byId[body.id] = body
    return body
end

local function add_fort(battle, owner, center, mirror, mapId)
    local softMaterial = "wood"
    local roofMaterial = "glass"
    local baseMaterial = "stone"

    if mapId == "harbour" then
        softMaterial = "wood"
        roofMaterial = "wood"
    elseif mapId == "moonbase" then
        softMaterial = "glass"
        roofMaterial = "stone"
    end

    -- The fortress layout is fixed, so its support graph is known while the
    -- bodies are created. This avoids an all-body scan during battle_ready.
    local leftBase = add_body(battle, {k = "block", m = baseMaterial, owner = owner, x = center - 47, y = 482, w = 82, h = 22, hp = 130, max = 130})
    local rightBase = add_body(battle, {k = "block", m = baseMaterial, owner = owner, x = center + 47, y = 482, w = 82, h = 22, hp = 130, max = 130})
    local leftPillar = add_body(battle, {k = "block", m = softMaterial, owner = owner, x = center - 60, y = 426, w = 20, h = 90, hp = 92, max = 92, supporters = {leftBase.id}})
    local rightPillar = add_body(battle, {k = "block", m = softMaterial, owner = owner, x = center + 60, y = 426, w = 20, h = 90, hp = 92, max = 92, supporters = {rightBase.id}})
    local middleDeck = add_body(battle, {k = "block", m = baseMaterial, owner = owner, x = center, y = 374, w = 154, h = 20, hp = 145, max = 145, supporters = {leftPillar.id, rightPillar.id}})
    local leftRoofPost = add_body(battle, {k = "block", m = roofMaterial, owner = owner, x = center - 50, y = 328, w = 18, h = 72, hp = roofMaterial == "glass" and 48 or 85, max = roofMaterial == "glass" and 48 or 85, supporters = {middleDeck.id}})
    local rightRoofPost = add_body(battle, {k = "block", m = roofMaterial, owner = owner, x = center + 50, y = 328, w = 18, h = 72, hp = roofMaterial == "glass" and 48 or 85, max = roofMaterial == "glass" and 48 or 85, supporters = {middleDeck.id}})
    add_body(battle, {k = "block", m = softMaterial, owner = owner, x = center, y = 286, w = 124, h = 18, hp = 88, max = 88, supporters = {leftRoofPost.id, rightRoofPost.id}})

    add_body(battle, {k = "commander", m = "target", owner = owner, x = center, y = 446, w = 38, h = 46, hp = 170, max = 170, supporters = {leftBase.id, rightBase.id}})
    add_body(battle, {k = "support", m = "target", owner = owner, x = center - 38, y = 350, w = 27, h = 30, hp = 78, max = 78, supporters = {middleDeck.id}})
    add_body(battle, {k = "support", m = "target", owner = owner, x = center + 38, y = 350, w = 27, h = 30, hp = 78, max = 78, supporters = {middleDeck.id}})

    local barrelX = center + (mirror * 96)
    add_body(battle, {k = "barrel", m = "barrel", owner = owner, x = barrelX, y = 472, w = 25, h = 42, hp = 46, max = 46})
end

local function horizontal_overlap(a, b)
    return math.min(a.x + a.w * 0.5, b.x + b.w * 0.5)
        - math.max(a.x - a.w * 0.5, b.x - b.w * 0.5)
end

local projectile_for_turn

local function create_battle_shell(context)
    local selected = context.mapSelected or "canyon"
    local gravity = GRAVITY
    if selected == "moonbase" then gravity = 650 end
    if selected == "harbour" then gravity = 870 end

    local battle = {
        map = selected,
        gravity = gravity,
        groundY = GROUND_Y,
        bodies = {},
        byId = {},
        bodyCells = {},
        bodyCellCounts = {},
        scanSerial = 0,
        projectiles = {},
        nextBodyId = 0,
        nextProjectileId = 0,
        activeSeat = (random.next() % 2) + 1,
        turnNumber = 1,
        turnMs = TURN_MS,
        flightMs = 0,
        settleMs = 0,
        abilityUsed = false,
        currentKind = "boulder",
        winner = 0,
        draw = false,
        reason = ""
    }

    for cell = 1, BODY_CELL_COUNT do
        battle.bodyCells[cell] = {}
        battle.bodyCellCounts[cell] = 0
    end

    return battle
end

local function begin_battle_build(context)
    if context.battleBuild then return end
    context.battleBuild = {stage = 0, battle = false}
    context.phaseMs = 0
end

local function advance_battle_build(context)
    local build = context.battleBuild
    if not build then return false end

    if build.stage == 0 then
        build.battle = create_battle_shell(context)
        build.stage = 1
        return true
    end

    if build.stage == 1 then
        add_fort(build.battle, 1, 270, -1, build.battle.map)
        build.stage = 2
        return true
    end

    if build.stage == 2 then
        add_fort(build.battle, 2, 730, 1, build.battle.map)
        build.stage = 3
        return true
    end

    local battle = build.battle
    context.battleBuild = nil
    context.battle = battle

    for seat = 1, 2 do
        local player = context.playersBySeat[seat]
        if player then
            player.score = 0
            player.shots = 0
        end
    end

    context.phase = "countdown"
    context.phaseMs = 0
    battle.currentKind = projectile_for_turn(context, battle.activeSeat)
    transport.broadcast_event("battle_start", {
        map = battle.map,
        activeSeat = battle.activeSeat
    })
    return true
end

projectile_for_turn = function(context, seat)
    local player = context.playersBySeat[seat]
    if not player or not player.loadout then return "boulder" end
    local shotIndex = player.shots + 1
    local index = ((shotIndex - 1) % 3) + 1
    return player.loadout[index] or "boulder"
end

local function choose_map(context)
    local first = context.mapVotes[1]
    local second = context.mapVotes[2]
    if first == second then
        context.mapSelected = first
    elseif random.next() % 2 == 0 then
        context.mapSelected = first
    else
        context.mapSelected = second
    end
end

local function body_snapshot(body)
    return {
        id = body.id,
        k = body.k,
        m = body.m,
        o = body.owner,
        x = math.floor(body.x * 10 + 0.5) / 10,
        y = math.floor(body.y * 10 + 0.5) / 10,
        w = body.w,
        h = body.h,
        hp = math.max(0, math.floor(body.hp + 0.5)),
        mx = body.max,
        a = body.alive,
        d = body.dynamic
    }
end

local function projectile_snapshot(projectile)
    return {
        id = projectile.id,
        k = projectile.kind,
        x = math.floor(projectile.x * 10 + 0.5) / 10,
        y = math.floor(projectile.y * 10 + 0.5) / 10,
        r = projectile.r,
        a = projectile.active,
        o = projectile.owner,
        p = projectile.primary
    }
end

local function build_snapshot(context, recipient)
    local players = {}
    for seat = 1, 2 do
        local player = context.playersBySeat[seat]
        if player then
            players[#players + 1] = {
                seat = seat,
                nickname = player.nickname,
                wins = player.wins,
                score = player.score or 0,
                shots = player.shots or 0,
                loadoutSelected = player.loadoutSelected == true,
                vote = player.vote or false,
                battleReady = player.battleReady == true
            }
        end
    end

    local payload = {
        phase = context.phase,
        players = players,
        setup = {
            mapSelected = context.mapSelected or false,
            votesComplete = both_votes_cast(context)
        }
    }

    if recipient and recipient.profileId then
        local own = context.playersById[recipient.profileId]
        if own and own.loadout then
            payload.you = {loadout = shallow_copy_array(own.loadout)}
        end
    end

    if context.battle then
        local battle = context.battle
        local bodies = {}
        for i = 1, #battle.bodies do
            bodies[#bodies + 1] = body_snapshot(battle.bodies[i])
        end
        local projectiles = {}
        for i = 1, #battle.projectiles do
            projectiles[#projectiles + 1] = projectile_snapshot(battle.projectiles[i])
        end

        local timerMs = 0
        if context.phase == "countdown" then
            timerMs = math.max(0, COUNTDOWN_MS - context.phaseMs)
        elseif context.phase == "aiming" then
            timerMs = math.max(0, TURN_MS - context.phaseMs)
        elseif context.phase == "resolve" then
            timerMs = math.max(0, RESOLVE_MS - context.phaseMs)
        end

        payload.battle = {
            map = battle.map,
            groundY = battle.groundY,
            gravity = battle.gravity,
            activeSeat = battle.activeSeat,
            turnNumber = battle.turnNumber,
            timerMs = math.floor(timerMs),
            currentKind = battle.currentKind,
            abilityUsed = battle.abilityUsed,
            bodies = bodies,
            projectiles = projectiles,
            winner = battle.winner,
            draw = battle.draw,
            reason = battle.reason
        }
    end

    return payload
end

local function score_damage(context, seat, amount)
    if seat ~= 1 and seat ~= 2 then return end
    local player = context.playersBySeat[seat]
    if not player then return end
    player.score = player.score + math.max(0, math.floor(amount + 0.5))
end

local explode_at

local function damage_body(context, body, amount, attacker, source, depth)
    if not body.alive or amount <= 0 then return 0 end
    local before = body.hp
    body.hp = body.hp - amount
    body.last = attacker or body.last
    local actual = math.min(before, amount)
    score_damage(context, attacker, actual)

    if body.hp <= 0 then
        body.hp = 0
        body.alive = false
        body.dynamic = false
        body.vx = 0
        body.vy = 0

        if body.k == "support" then
            score_damage(context, attacker, 300)
        elseif body.k == "commander" then
            score_damage(context, attacker, 1000)
        elseif body.k == "barrel" and not body.exploded then
            body.exploded = true
            explode_at(context, body.x, body.y, 105, 105, attacker, (depth or 0) + 1)
        end

        transport.broadcast_event("body_destroyed", {
            id = body.id,
            kind = body.k,
            x = body.x,
            y = body.y,
            source = source or "impact"
        })
    end

    return actual
end

explode_at = function(context, x, y, radius, damage, attacker, depth)
    if not context.battle or depth > 3 then return end
    transport.broadcast_event("explosion", {x = x, y = y, radius = radius})

    local radiusSquared = radius * radius
    for i = 1, #context.battle.bodies do
        local body = context.battle.bodies[i]
        if body.alive then
            local dx = body.x - x
            local dy = body.y - y
            local distanceSquared = dx * dx + dy * dy
            if distanceSquared < radiusSquared then
                local distance = math.sqrt(math.max(distanceSquared, 1))
                local strength = 1 - (distance / radius)
                local dealt = damage * strength * (MATERIAL_DAMAGE[body.m] or 1)
                body.dynamic = true
                body.vx = body.vx + (dx / distance) * 230 * strength
                body.vy = body.vy + (dy / distance) * 190 * strength - 80 * strength
                damage_body(context, body, dealt, attacker, "explosion", depth)
            end
        end
    end
end

local function has_live_support(battle, body)
    local bottom = body.y + body.h * 0.5
    if bottom >= battle.groundY - 8 then return true end

    local supporters = body.supporters
    for i = 1, #supporters do
        local other = battle.byId[supporters[i]]
        if other and other.alive then
            local otherTop = other.y - other.h * 0.5
            if body.y < other.y
                and math.abs(bottom - otherTop) <= 9
                and horizontal_overlap(body, other) > math.min(body.w, other.w) * 0.18 then
                return true
            end
        end
    end

    return false
end

local function rebuild_body_cells(battle)
    local cells = battle.bodyCells
    local counts = battle.bodyCellCounts
    for cell = 1, BODY_CELL_COUNT do
        counts[cell] = 0
    end

    for i = 1, #battle.bodies do
        local body = battle.bodies[i]
        if body.alive then
            local first = clamp(math.floor((body.x - body.w * 0.5) / BODY_CELL_SIZE) + 1, 1, BODY_CELL_COUNT)
            local last = clamp(math.floor((body.x + body.w * 0.5) / BODY_CELL_SIZE) + 1, 1, BODY_CELL_COUNT)
            for cell = first, last do
                local nextIndex = counts[cell] + 1
                counts[cell] = nextIndex
                cells[cell][nextIndex] = body.id
            end
        end
    end
end

local function resolve_body_pair(context, a, b)
    local dx = b.x - a.x
    local px = (a.w + b.w) * 0.5 - math.abs(dx)
    if px <= 0 then return end

    local dy = b.y - a.y
    local py = (a.h + b.h) * 0.5 - math.abs(dy)
    if py <= 0 then return end

    if py <= px then
        local impact = math.abs((a.vy or 0) - (b.vy or 0))
        local direction = dy >= 0 and 1 or -1
        if a.dynamic and b.dynamic then
            a.y = a.y - direction * py * 0.5
            b.y = b.y + direction * py * 0.5
        elseif a.dynamic then
            a.y = a.y - direction * py
        elseif b.dynamic then
            b.y = b.y + direction * py
        end

        local average = ((a.vy or 0) + (b.vy or 0)) * 0.5
        if a.dynamic then a.vy = average * 0.28 end
        if b.dynamic then b.vy = average * 0.28 end

        local upper = a.y < b.y and a or b
        local lower = upper == a and b or a
        if upper.dynamic then
            upper.supportCandidate = lower.id
        end

        if impact > 155 then
            local attacker = a.last ~= 0 and a.last or b.last
            damage_body(context, a, (impact - 150) * 0.07, attacker, "collapse", 0)
            damage_body(context, b, (impact - 150) * 0.07, attacker, "collapse", 0)
        end
    else
        local direction = dx >= 0 and 1 or -1
        if a.dynamic and b.dynamic then
            a.x = a.x - direction * px * 0.5
            b.x = b.x + direction * px * 0.5
        elseif a.dynamic then
            a.x = a.x - direction * px
        elseif b.dynamic then
            b.x = b.x + direction * px
        end
        if a.dynamic then a.vx = -(a.vx or 0) * 0.22 end
        if b.dynamic then b.vx = -(b.vx or 0) * 0.22 end
    end
end

local function resolve_dynamic_pairs(context)
    local battle = context.battle
    local bodies = battle.bodies

    for i = 1, #bodies do
        local body = bodies[i]
        if body.alive and body.dynamic then
            body.supportCandidate = 0
        end
    end

    rebuild_body_cells(battle)

    -- Each moving body visits only spatial cells touched by its AABB. Static
    -- pairs are never considered, and a scan stamp removes duplicate entries
    -- when a wide body spans more than one cell.
    for i = 1, #bodies do
        local a = bodies[i]
        if a.alive and a.dynamic then
            battle.scanSerial = battle.scanSerial + 1
            local serial = battle.scanSerial
            local first = clamp(math.floor((a.x - a.w * 0.5) / BODY_CELL_SIZE) + 1, 1, BODY_CELL_COUNT)
            local last = clamp(math.floor((a.x + a.w * 0.5) / BODY_CELL_SIZE) + 1, 1, BODY_CELL_COUNT)

            for cell = first, last do
                local entries = battle.bodyCells[cell]
                local count = battle.bodyCellCounts[cell]
                for entry = 1, count do
                    local b = battle.byId[entries[entry]]
                    if b and b ~= a and b.alive and b.scanSerial ~= serial then
                        b.scanSerial = serial
                        if not b.dynamic or a.id < b.id then
                            resolve_body_pair(context, a, b)
                        end
                    end
                end
            end
        end
    end
end

local function simulate_bodies(context, dt)
    local battle = context.battle
    local bodies = battle.bodies

    -- Support invalidation is now O(number of bodies * small supporter list),
    -- rather than scanning every body for every body on every tick.
    for i = 1, #bodies do
        local body = bodies[i]
        if body.alive and not body.dynamic and not has_live_support(battle, body) then
            body.dynamic = true
            body.supporters = {}
            body.supportCandidate = 0
        end
    end

    for i = 1, #bodies do
        local body = bodies[i]
        if body.alive and body.dynamic then
            body.vy = body.vy + battle.gravity * dt
            body.x = body.x + body.vx * dt
            body.y = body.y + body.vy * dt
            body.vx = body.vx * 0.992

            local bottom = body.y + body.h * 0.5
            if bottom > battle.groundY then
                local impact = math.abs(body.vy)
                body.y = battle.groundY - body.h * 0.5
                body.vy = -body.vy * 0.18
                body.vx = body.vx * 0.72
                body.supportCandidate = 0
                if impact > 190 then
                    damage_body(context, body, (impact - 180) * 0.055, body.last, "fall", 0)
                end
            end

            if body.x < -120 or body.x > WORLD_W + 120 or body.y > WORLD_H + 160 then
                body.alive = false
                body.dynamic = false
            end
        end
    end

    resolve_dynamic_pairs(context)

    for i = 1, #bodies do
        local body = bodies[i]
        if body.alive and body.dynamic and math.abs(body.vx) < 9 and math.abs(body.vy) < 9 then
            local bottom = body.y + body.h * 0.5
            if bottom >= battle.groundY - 8 then
                body.vx = 0
                body.vy = 0
                body.dynamic = false
                body.supporters = {}
                body.supportCandidate = 0
            elseif body.supportCandidate ~= 0 then
                local support = battle.byId[body.supportCandidate]
                if support and support.alive and not support.dynamic then
                    body.vx = 0
                    body.vy = 0
                    body.dynamic = false
                    body.supporters = {support.id}
                    body.supportCandidate = 0
                end
            end
        end
    end
end

local function new_projectile(battle, kind, owner, x, y, vx, vy, radius, primary)
    battle.nextProjectileId = battle.nextProjectileId + 1
    local projectile = {
        id = battle.nextProjectileId,
        kind = kind,
        owner = owner,
        x = x,
        y = y,
        vx = vx,
        vy = vy,
        r = radius,
        active = true,
        primary = primary == true,
        age = 0,
        cooldown = 0,
        fuse = kind == "bomb" and 1500 or 0
    }
    battle.projectiles[#battle.projectiles + 1] = projectile
    return projectile
end

local function collide_projectile_body(context, projectile, body)
    local left = body.x - body.w * 0.5
    local right = body.x + body.w * 0.5
    local top = body.y - body.h * 0.5
    local bottom = body.y + body.h * 0.5
    local nearestX = clamp(projectile.x, left, right)
    local nearestY = clamp(projectile.y, top, bottom)
    local dx = projectile.x - nearestX
    local dy = projectile.y - nearestY
    local distanceSquared = dx * dx + dy * dy

    if distanceSquared > projectile.r * projectile.r then return false end

    if projectile.kind == "bomb" then
        explode_at(context, projectile.x, projectile.y, 118, 125, projectile.owner, 0)
        projectile.active = false
        return true
    end

    local speed = math.sqrt(projectile.vx * projectile.vx + projectile.vy * projectile.vy)
    local damage = math.max(0, speed - 105)
        * 0.19
        * (PROJECTILE_DAMAGE[projectile.kind] or 1)
        * (MATERIAL_DAMAGE[body.m] or 1)

    if projectile.cooldown <= 0 then
        damage_body(context, body, damage, projectile.owner, "projectile", 0)
        projectile.cooldown = 135
        body.dynamic = true
        body.last = projectile.owner
        body.vx = body.vx + projectile.vx * 0.075
        body.vy = body.vy + projectile.vy * 0.045
        transport.broadcast_event("impact", {
            x = nearestX,
            y = nearestY,
            strength = math.min(1, speed / 900)
        })
    end

    local length = math.sqrt(math.max(distanceSquared, 1))
    local nx = dx / length
    local ny = dy / length
    if distanceSquared < 0.001 then
        if math.abs(projectile.vx) > math.abs(projectile.vy) then
            nx = projectile.vx > 0 and -1 or 1
            ny = 0
        else
            nx = 0
            ny = projectile.vy > 0 and -1 or 1
        end
    end

    local dot = projectile.vx * nx + projectile.vy * ny
    projectile.vx = (projectile.vx - 2 * dot * nx) * 0.42
    projectile.vy = (projectile.vy - 2 * dot * ny) * 0.42
    projectile.x = projectile.x + nx * (projectile.r + 2)
    projectile.y = projectile.y + ny * (projectile.r + 2)
    return true
end

local function simulate_projectiles(context, dt, deltaMs)
    local battle = context.battle
    for i = 1, #battle.projectiles do
        local projectile = battle.projectiles[i]
        if projectile.active then
            projectile.age = projectile.age + deltaMs
            projectile.cooldown = math.max(0, projectile.cooldown - deltaMs)
            if projectile.kind == "bomb" then
                projectile.fuse = projectile.fuse - deltaMs
                if projectile.fuse <= 0 then
                    explode_at(context, projectile.x, projectile.y, 118, 125, projectile.owner, 0)
                    projectile.active = false
                end
            end

            if projectile.active then
                projectile.vy = projectile.vy + battle.gravity * dt
                projectile.x = projectile.x + projectile.vx * dt
                projectile.y = projectile.y + projectile.vy * dt

                if projectile.y + projectile.r >= battle.groundY then
                    projectile.y = battle.groundY - projectile.r
                    if projectile.kind == "bomb" then
                        explode_at(context, projectile.x, projectile.y, 118, 125, projectile.owner, 0)
                        projectile.active = false
                    else
                        projectile.vy = -math.abs(projectile.vy) * 0.32
                        projectile.vx = projectile.vx * 0.66
                        if math.abs(projectile.vx) + math.abs(projectile.vy) < 65 then
                            projectile.active = false
                        end
                    end
                end
            end

            if projectile.active then
                for j = 1, #battle.bodies do
                    local body = battle.bodies[j]
                    if body.alive and collide_projectile_body(context, projectile, body) then
                        break
                    end
                end
            end

            if projectile.active and (projectile.x < -80 or projectile.x > WORLD_W + 80 or projectile.y > WORLD_H + 100) then
                projectile.active = false
            end
        end
    end
end

local function active_projectiles(battle)
    for i = 1, #battle.projectiles do
        if battle.projectiles[i].active then return true end
    end
    return false
end

local function bodies_moving(battle)
    for i = 1, #battle.bodies do
        local body = battle.bodies[i]
        if body.alive and body.dynamic and (math.abs(body.vx) > 12 or math.abs(body.vy) > 12) then
            return true
        end
    end
    return false
end

local function commander_alive(battle, owner)
    for i = 1, #battle.bodies do
        local body = battle.bodies[i]
        if body.k == "commander" and body.owner == owner then
            return body.alive
        end
    end
    return false
end

local function commander_health(battle, owner)
    for i = 1, #battle.bodies do
        local body = battle.bodies[i]
        if body.k == "commander" and body.owner == owner then
            return math.max(0, body.hp)
        end
    end
    return 0
end

local function request_finish(context, winner, draw, reason)
    if context.finishRequested then return end
    context.finishRequested = true
    context.phase = "finished"
    context.phaseMs = 0

    if context.battle then
        context.battle.winner = winner or 0
        context.battle.draw = draw == true
        context.battle.reason = reason or ""
    end

    transport.broadcast_snapshot(build_snapshot(context, nil))

    local current = match.players()
    local placements = {}
    if draw then
        for i = 1, #current do
            placements[#placements + 1] = {seat = current[i].seat, place = 1}
        end
    else
        for i = 1, #current do
            local place = current[i].seat == winner and 1 or 2
            placements[#placements + 1] = {seat = current[i].seat, place = place}
        end
    end

    if #placements > 0 then
        match.finish({draw = draw == true, placements = placements})
    end
end

local function evaluate_end(context)
    local battle = context.battle
    local seat1Alive = commander_alive(battle, 1)
    local seat2Alive = commander_alive(battle, 2)

    if not seat1Alive or not seat2Alive then
        if not seat1Alive and not seat2Alive then
            local p1 = context.playersBySeat[1]
            local p2 = context.playersBySeat[2]
            if p1.score == p2.score then
                request_finish(context, 0, true, "Both commanders fell")
            else
                request_finish(context, p1.score > p2.score and 1 or 2, false, "Both commanders fell")
            end
        else
            request_finish(context, seat1Alive and 1 or 2, false, "Commander destroyed")
        end
        return true
    end

    local p1 = context.playersBySeat[1]
    local p2 = context.playersBySeat[2]
    if p1.shots >= MAX_SHOTS and p2.shots >= MAX_SHOTS then
        local total1 = p1.score + math.floor(commander_health(battle, 1) * 8)
        local total2 = p2.score + math.floor(commander_health(battle, 2) * 8)
        if total1 == total2 then
            request_finish(context, 0, true, "Equal score")
        else
            request_finish(context, total1 > total2 and 1 or 2, false, "Highest score")
        end
        return true
    end

    return false
end

local function start_next_turn(context)
    local battle = context.battle
    if evaluate_end(context) then return end

    battle.activeSeat = battle.activeSeat == 1 and 2 or 1
    battle.turnNumber = battle.turnNumber + 1
    battle.projectiles = {}
    battle.flightMs = 0
    battle.settleMs = 0
    battle.abilityUsed = false
    battle.currentKind = projectile_for_turn(context, battle.activeSeat)
    context.phase = "aiming"
    context.phaseMs = 0
    transport.broadcast_event("turn", {
        seat = battle.activeSeat,
        turnNumber = battle.turnNumber,
        projectile = battle.currentKind
    })
end

local function launch_projectile(context, seat, angleDegrees, power)
    local battle = context.battle
    local player = context.playersBySeat[seat]
    if not battle or not player then return end

    angleDegrees = clamp(angleDegrees, 10, 80)
    power = clamp(power, 0.20, 1.0)
    local direction = seat == 1 and 1 or -1
    local angle = math.rad(angleDegrees)
    local speed = 540 + 430 * power
    local startX = seat == 1 and 130 or 870
    local startY = 425
    local kind = battle.currentKind

    battle.projectiles = {}
    battle.abilityUsed = false
    new_projectile(
        battle,
        kind,
        seat,
        startX,
        startY,
        math.cos(angle) * speed * direction,
        -math.sin(angle) * speed,
        kind == "boulder" and 16 or 14,
        true
    )

    player.shots = player.shots + 1
    context.phase = "flight"
    context.phaseMs = 0
    battle.flightMs = 0
    battle.settleMs = 0

    transport.broadcast_event("launch", {
        seat = seat,
        projectile = kind,
        angle = angleDegrees,
        power = power
    })
end

local function activate_ability(context, seat)
    local battle = context.battle
    if context.phase ~= "flight" or not battle or battle.activeSeat ~= seat or battle.abilityUsed then return end

    local primary = nil
    for i = 1, #battle.projectiles do
        local projectile = battle.projectiles[i]
        if projectile.active and projectile.primary then
            primary = projectile
            break
        end
    end
    if not primary then return end

    if primary.kind == "splitter" then
        primary.primary = true
        new_projectile(battle, "splitter", seat, primary.x, primary.y - 4, primary.vx * 0.94, primary.vy - 135, 11, false)
        new_projectile(battle, "splitter", seat, primary.x, primary.y + 4, primary.vx * 0.94, primary.vy + 135, 11, false)
        battle.abilityUsed = true
    elseif primary.kind == "bomber" then
        new_projectile(battle, "bomb", seat, primary.x, primary.y + 18, primary.vx * 0.18, primary.vy + 80, 10, false)
        battle.abilityUsed = true
    else
        return
    end

    transport.broadcast_event("ability", {
        seat = seat,
        projectile = primary.kind,
        x = primary.x,
        y = primary.y
    })
end

local function handle_setup_command(context, player, action, data)
    if action == "set_loadout" and context.phase == "loadout" then
        if player.loadoutSelected then return end
        if not valid_loadout(data.loadout) then return end
        player.loadout = shallow_copy_array(data.loadout)
        player.loadoutSelected = true
        transport.send_snapshot(player.profileId, build_snapshot(context, {profileId = player.profileId}))
        transport.broadcast_event("loadout_locked", {seat = player.seat})
        if both_loadouts_selected(context) then
            context.phase = "vote"
            context.phaseMs = 0
            transport.broadcast_event("phase", {phase = "vote"})
        end
        return
    end

    if action == "vote_map" and context.phase == "vote" then
        local mapId = data.map
        if type(mapId) ~= "string" or not VALID_MAPS[mapId] then return end
        if context.mapVotes[player.seat] ~= nil then return end
        context.mapVotes[player.seat] = mapId
        player.vote = mapId
        transport.broadcast_event("map_vote", {seat = player.seat, map = mapId})
        if both_votes_cast(context) then
            choose_map(context)
            context.phase = "ready"
            context.phaseMs = 0
            transport.broadcast_event("map_selected", {map = context.mapSelected})
        end
        return
    end

    if action == "battle_ready" and context.phase == "ready" then
        if context.battleReady[player.seat] then return end
        context.battleReady[player.seat] = true
        player.battleReady = true
        transport.broadcast_event("battle_ready", {seat = player.seat})
        if both_battle_ready(context) then
            begin_battle_build(context)
        end
    end
end

return {
    init = function(context)
        context.playersById = {}
        context.playersBySeat = {}
        context.mapVotes = {}
        context.battleReady = {}
        context.phase = "loadout"
        context.phaseMs = 0
        context.mapSelected = nil
        context.battle = nil
        context.battleBuild = nil
        context.finished = false
        context.finishRequested = false
    end,

    on_match_open = function(context)
        reconcile_players(context)
    end,

    on_player_join = function(context, player)
        reconcile_players(context)
        local current = context.playersById[player.profileId]
        if current then
            current.nickname = player.nickname
            current.wins = player.wins
        end
    end,

    on_player_update = function(context, player)
        reconcile_players(context)
        local current = context.playersById[player.profileId]
        if current then
            current.nickname = player.nickname
            current.wins = player.wins
        end
    end,

    on_player_leave = function(context, player, reason)
        local previousPhase = context.phase
        reconcile_players(context)

        if previousPhase == "countdown" or previousPhase == "aiming"
            or previousPhase == "flight" or previousPhase == "resolve" then
            local current = match.players()
            if #current == 1 then
                request_finish(context, current[1].seat, false, "Opponent left")
            else
                reset_setup(context)
            end
        else
            reset_setup(context)
        end
    end,

    on_command = function(context, playerRef, action, data, sequence)
        if context.finishRequested or match.state() ~= "playing" then return end
        if type(data) ~= "table" then return end
        local player = context.playersById[playerRef.profileId]
        if not player then return end

        if context.phase == "loadout" or context.phase == "vote" or context.phase == "ready" then
            handle_setup_command(context, player, action, data)
            return
        end

        if action == "launch" and context.phase == "aiming" and context.battle.activeSeat == player.seat then
            local angle = tonumber(data.angle)
            local power = tonumber(data.power)
            if not angle or not power then return end
            launch_projectile(context, player.seat, angle, power)
        elseif action == "activate" then
            activate_ability(context, player.seat)
        end
    end,

    on_tick = function(context, deltaMs)
        if context.finishRequested or match.state() ~= "playing" then return end
        if not both_players(context) then return end

        deltaMs = clamp(deltaMs, 1, 100)

        -- Battlefield creation is deliberately staged. The second battle_ready
        -- command only arms this build; each tick performs one bounded step.
        if context.battleBuild then
            advance_battle_build(context)
            return
        end

        local dt = deltaMs / 1000
        context.phaseMs = context.phaseMs + deltaMs

        if context.phase == "countdown" then
            if context.phaseMs >= COUNTDOWN_MS then
                context.phase = "aiming"
                context.phaseMs = 0
                transport.broadcast_event("turn", {
                    seat = context.battle.activeSeat,
                    turnNumber = context.battle.turnNumber,
                    projectile = context.battle.currentKind
                })
            end
            return
        end

        if context.phase == "aiming" then
            if context.phaseMs >= TURN_MS then
                launch_projectile(context, context.battle.activeSeat, 45, 0.55)
            end
            return
        end

        if context.phase == "flight" then
            context.battle.flightMs = context.battle.flightMs + deltaMs
            simulate_projectiles(context, dt, deltaMs)
            simulate_bodies(context, dt)

            if not active_projectiles(context.battle) and not bodies_moving(context.battle) then
                context.battle.settleMs = context.battle.settleMs + deltaMs
            else
                context.battle.settleMs = 0
            end

            if context.battle.settleMs >= 500 or context.battle.flightMs >= MAX_FLIGHT_MS then
                for i = 1, #context.battle.projectiles do
                    context.battle.projectiles[i].active = false
                end
                context.phase = "resolve"
                context.phaseMs = 0
            end
            return
        end

        if context.phase == "resolve" then
            simulate_bodies(context, dt)
            if context.phaseMs >= RESOLVE_MS then
                start_next_turn(context)
            end
        end
    end,

    on_snapshot = function(context, recipient)
        return build_snapshot(context, recipient)
    end,

    on_unload = function(context)
        context.playersById = nil
        context.playersBySeat = nil
        context.battleBuild = nil
        context.battle = nil
    end
}
