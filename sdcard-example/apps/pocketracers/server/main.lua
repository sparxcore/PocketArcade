-- PocketRacers authoritative rules and physics for PocketArcade 0.3.0.
-- The firmware owns identity, seats, controller leases, sequencing, transport,
-- resource limits and validated results. This script owns only race state.

local LAP_COUNT = 5
local COUNTDOWN_MS = 3000
local FINISH_GRACE_MS = 30000
local INPUT_TIMEOUT_MS = 650
local MAX_TICK_MS = 100
local CAR_RADIUS = 24
local TRACK_SEARCH_BEHIND = 2
local TRACK_SEARCH_AHEAD = 3
local TRACK_GEOMETRY_STRIDE = 6
local SHOULDER_DEPTH = 72
local WALL_RESTITUTION = 0.32
local CAR_RESTITUTION = 0.38
local PI = math.pi
local TWO_PI = PI * 2

-- Equal overall stat budgets, with different strengths.
-- Units are tuned for the world coordinates used by the four tracks.
local CAR_MODELS = {
    {
        name = "Falcon GT",
        topSpeed = 326,
        acceleration = 178,
        braking = 292,
        grip = 6.8,
        steering = 0.49,
        steeringResponse = 7.0,
        yawResponse = 5.2,
        mass = 1.18
    },
    {
        name = "Bolt XR",
        topSpeed = 282,
        acceleration = 232,
        braking = 310,
        grip = 7.2,
        steering = 0.53,
        steeringResponse = 8.2,
        yawResponse = 5.8,
        mass = 0.98
    },
    {
        name = "Apex RS",
        topSpeed = 296,
        acceleration = 188,
        braking = 304,
        grip = 9.4,
        steering = 0.65,
        steeringResponse = 9.4,
        yawResponse = 7.0,
        mass = 1.05
    }
}

-- Closed centre lines. The client contains the same public geometry for drawing.
local TRACKS = {
    {
        name = "Sunset Oval",
        width = 184,
        points = {
            {-600,-250},{-350,-450},{0,-500},{350,-450},{600,-250},{650,0},
            {600,250},{350,450},{0,500},{-350,450},{-600,250},{-650,0}
        }
    },
    {
        name = "Switchback Run",
        width = 172,
        points = {
            {-650,-300},{-400,-480},{-80,-520},{220,-430},{520,-260},{650,20},
            {520,300},{220,480},{-100,520},{-380,400},{-560,180},{-300,80},
            {50,150},{260,40},{80,-120},{-260,-60},{-520,-130}
        }
    },
    {
        name = "Clover Valley",
        width = 178,
        points = {
            {0,-560},{300,-500},{520,-300},{480,-40},{650,180},{500,440},
            {180,520},{0,350},{-180,520},{-500,440},{-650,180},{-480,-40},
            {-520,-300},{-300,-500}
        }
    },
    {
        name = "Dockyard Dash",
        width = 154,
        points = {
            {-620,-420},{-100,-420},{-100,-200},{360,-200},{360,-420},{620,-420},
            {620,80},{420,80},{420,420},{-120,420},{-120,220},{-620,220}
        }
    }
}

local function clamp(value, minimum, maximum)
    if value < minimum then return minimum end
    if value > maximum then return maximum end
    return value
end

local function approach(value, target, amount)
    if value < target then
        return math.min(value + amount, target)
    end
    return math.max(value - amount, target)
end

local function wrap_angle(angle)
    while angle > PI do angle = angle - TWO_PI end
    while angle < -PI do angle = angle + TWO_PI end
    return angle
end

local function quantise(value, scale)
    if not value then return 0 end
    if value >= 0 then
        return math.floor(value * scale + 0.5) / scale
    end
    return math.ceil(value * scale - 0.5) / scale
end

local function prepare_track_geometry(context, track)
    local geometry = context.trackGeometry
    local points = track.points
    local count = #points
    for i = 1, count do
        local a = points[i]
        local b = points[(i % count) + 1]
        local dx = b[1] - a[1]
        local dy = b[2] - a[2]
        local length_sq = dx * dx + dy * dy
        if length_sq < 0.000001 then length_sq = 0.000001 end
        local length = math.sqrt(length_sq)
        local base = (i - 1) * TRACK_GEOMETRY_STRIDE
        geometry[base + 1] = dx
        geometry[base + 2] = dy
        geometry[base + 3] = 1 / length_sq
        geometry[base + 4] = length
        geometry[base + 5] = dx / length
        geometry[base + 6] = dy / length
    end
    for i = count * TRACK_GEOMETRY_STRIDE + 1, #geometry do
        geometry[i] = nil
    end
    context.trackSegmentCount = count
    context.activeTrack = track
    local recovery_distance = track.width * 0.5 + SHOULDER_DEPTH + CAR_RADIUS * 2
    context.trackRecoveryDistanceSq = recovery_distance * recovery_distance
end

local function nearest_track_point(context, player)
    local track = context.activeTrack
    local points = track.points
    local geometry = context.trackGeometry
    local count = context.trackSegmentCount
    local x, y = player.x, player.y
    local hint = clamp(math.floor(player.trackSegment or 1), 1, count)
    local best_distance_sq = false
    local best_x, best_y = 0, 0
    local best_segment, best_t = hint, 0

    -- At racing speeds a car advances only a small fraction of one segment per
    -- tick. Search a bounded window around its previous segment and fall back to
    -- a full scan only when the hint is clearly no longer credible after a crash.
    for offset = -TRACK_SEARCH_BEHIND, TRACK_SEARCH_AHEAD do
        local i = ((hint - 1 + offset) % count) + 1
        local a = points[i]
        local base = (i - 1) * TRACK_GEOMETRY_STRIDE
        local dx = geometry[base + 1]
        local dy = geometry[base + 2]
        local t = ((x - a[1]) * dx + (y - a[2]) * dy) * geometry[base + 3]
        t = clamp(t, 0, 1)
        local qx = a[1] + dx * t
        local qy = a[2] + dy * t
        local ox = x - qx
        local oy = y - qy
        local distance_sq = ox * ox + oy * oy
        if not best_distance_sq or distance_sq < best_distance_sq then
            best_distance_sq = distance_sq
            best_x, best_y = qx, qy
            best_segment, best_t = i, t
        end
    end

    if best_distance_sq and best_distance_sq > context.trackRecoveryDistanceSq then
        best_distance_sq = false
        for i = 1, count do
            local a = points[i]
            local base = (i - 1) * TRACK_GEOMETRY_STRIDE
            local dx = geometry[base + 1]
            local dy = geometry[base + 2]
            local t = ((x - a[1]) * dx + (y - a[2]) * dy) * geometry[base + 3]
            t = clamp(t, 0, 1)
            local qx = a[1] + dx * t
            local qy = a[2] + dy * t
            local ox = x - qx
            local oy = y - qy
            local distance_sq = ox * ox + oy * oy
            if not best_distance_sq or distance_sq < best_distance_sq then
                best_distance_sq = distance_sq
                best_x, best_y = qx, qy
                best_segment, best_t = i, t
            end
        end
    end

    player.trackSegment = best_segment
    local base = (best_segment - 1) * TRACK_GEOMETRY_STRIDE
    local distance = math.sqrt(best_distance_sq or 0)
    return best_x, best_y, distance,
        geometry[base + 5], geometry[base + 6],
        (best_segment - 1) + best_t
end

local function new_player(platform_player)
    local seat = platform_player.seat or 1
    return {
        profileId = platform_player.profileId,
        seat = seat,
        connected = platform_player.connected,
        carId = 0,
        trackVote = 0,
        lobbyReady = false,
        carSelected = false,
        trackVoted = false,
        raceReady = false,
        x = 0,
        y = 0,
        vx = 0,
        vy = 0,
        heading = 0,
        yawRate = 0,
        roll = 0,
        steerAngle = 0,
        steerInput = 0,
        throttleInput = 0,
        brakeInput = 0,
        lastInputAt = 0,
        lastTrackProgress = 0,
        trackSegment = 1,
        totalProgress = 0,
        lap = 1,
        offTrack = false,
        trackDistance = 0,
        skid = 0,
        finished = false,
        finishTimeMs = 0,
        place = 0,
        points = 0
    }
end

local function reconcile_players(context)
    local current = context.seenProfiles
    for profile_id, _ in pairs(current) do current[profile_id] = nil end

    local platform = match.players()
    local player_list = context.playerList
    for i = 1, #platform do
        local platform_player = platform[i]
        current[platform_player.profileId] = true
        local player = context.players[platform_player.profileId]
        if not player then
            player = new_player(platform_player)
            context.players[platform_player.profileId] = player
        end
        player.seat = platform_player.seat
        player.connected = platform_player.connected
        if not player.connected then
            player.steerInput = 0
            player.throttleInput = 0
            player.brakeInput = 0
        end
        player_list[i] = player
    end

    for i = #platform + 1, #player_list do player_list[i] = nil end

    for profile_id, _ in pairs(context.players) do
        if not current[profile_id] then
            context.players[profile_id] = nil
        end
    end
    context.playerCount = #platform
    return context.playerCount
end

local function choose_track(context)
    local votes = {0, 0, 0, 0}
    for i = 1, context.playerCount do
        local track_id = clamp(math.floor(context.playerList[i].trackVote or 1), 1, #TRACKS)
        votes[track_id] = votes[track_id] + 1
    end
    local winner = 1
    for i = 2, #votes do
        if votes[i] > votes[winner] then winner = i end
    end
    return winner
end

local function reset_car_for_grid(context, player, grid_index)
    local track = context.activeTrack
    local points = track.points
    local geometry = context.trackGeometry
    local a = points[1]
    local dx = geometry[1]
    local dy = geometry[2]
    local length = geometry[4]
    local tx = geometry[5]
    local ty = geometry[6]
    local row = math.floor((grid_index - 1) / 2)
    local side = ((grid_index - 1) % 2 == 0) and -1 or 1
    local along = 34 + row * 66
    local across = side * 30
    local nx, ny = -ty, tx
    local t = clamp(along / length, 0.02, 0.78)

    player.x = a[1] + dx * t + nx * across
    player.y = a[2] + dy * t + ny * across
    player.vx = 0
    player.vy = 0
    player.heading = math.atan(ty, tx)
    player.yawRate = 0
    player.roll = 0
    player.steerAngle = 0
    player.steerInput = 0
    player.throttleInput = 0
    player.brakeInput = 0
    player.lastInputAt = clock.tick()
    player.trackSegment = 1
    player.lastTrackProgress = t
    player.totalProgress = 0
    player.lap = 1
    player.offTrack = false
    player.trackDistance = 0
    player.skid = 0
    player.finished = false
    player.finishTimeMs = 0
    player.place = 0
    player.points = 0
end

local function reset_to_lobby(context)
    context.phase = "join"
    context.countdownMs = COUNTDOWN_MS
    context.trackId = 0
    context.raceStartedAt = 0
    context.finishDeadline = 0
    context.finishedRequested = false
    for i = 1, context.playerCount do
        local player = context.playerList[i]
        player.lobbyReady = false
        player.carSelected = false
        player.trackVoted = false
        player.raceReady = false
        player.carId = 0
        player.trackVote = 0
        player.vx = 0
        player.vy = 0
        player.steerInput = 0
        player.throttleInput = 0
        player.brakeInput = 0
        player.finished = false
        player.place = 0
        player.points = 0
    end
end

local function all_players_flag(context, field)
    if context.playerCount < 2 then return false end
    for i = 1, context.playerCount do
        if context.playerList[i][field] ~= true then return false end
    end
    return true
end

local function advance_lobby(context)
    if context.phase == "join" and all_players_flag(context, "lobbyReady") then
        context.phase = "car-select"
    elseif context.phase == "car-select" and all_players_flag(context, "carSelected") then
        context.phase = "track-vote"
    elseif context.phase == "track-vote" and all_players_flag(context, "trackVoted") then
        context.trackId = choose_track(context)
        context.phase = "confirm"
    end
end

local function start_race(context)
    if context.playerCount < 2 or context.phase ~= "arming" then
        reset_to_lobby(context)
        return
    end

    context.trackId = choose_track(context)
    local track = TRACKS[context.trackId]
    prepare_track_geometry(context, track)
    context.phase = "countdown"
    context.countdownMs = COUNTDOWN_MS
    context.raceStartedAt = 0
    context.finishDeadline = 0
    context.finishedRequested = false
    context.startingPlayers = context.playerCount
    for i = 1, context.playerCount do
        reset_car_for_grid(context, context.playerList[i], i)
    end
end

local function update_progress(player, track, distance, progress)
    local half_width = track.width * 0.5
    player.trackDistance = distance
    player.offTrack = distance > half_width

    if distance <= half_width + SHOULDER_DEPTH * 0.55 then
        local count = #track.points
        local delta = progress - player.lastTrackProgress
        if delta > count * 0.5 then delta = delta - count end
        if delta < -count * 0.5 then delta = delta + count end
        if math.abs(delta) <= 2.0 then
            player.totalProgress = player.totalProgress + delta
        end
        player.lastTrackProgress = progress
    end

    player.lap = clamp(math.floor(math.max(0, player.totalProgress) / #track.points) + 1, 1, LAP_COUNT)
end

local function apply_track_boundary(player, track, nearest_x, nearest_y, distance, tangent_x, tangent_y)
    local half_width = track.width * 0.5
    if distance <= half_width + SHOULDER_DEPTH then return end

    local nx = player.x - nearest_x
    local ny = player.y - nearest_y
    if distance < 0.001 then
        nx, ny = -tangent_y, tangent_x
        distance = 1
    else
        nx, ny = nx / distance, ny / distance
    end

    local limit = half_width + SHOULDER_DEPTH
    player.x = nearest_x + nx * limit
    player.y = nearest_y + ny * limit
    local outward_speed = player.vx * nx + player.vy * ny
    if outward_speed > 0 then
        player.vx = player.vx - (1 + WALL_RESTITUTION) * outward_speed * nx
        player.vy = player.vy - (1 + WALL_RESTITUTION) * outward_speed * ny
        local tangent_speed = player.vx * (-ny) + player.vy * nx
        player.yawRate = player.yawRate + clamp(tangent_speed * 0.006, -2.4, 2.4)
        player.skid = math.max(player.skid, 0.95)
    end
end

local function update_car(context, player, delta_seconds, now_ms)
    local track = context.activeTrack
    local model = CAR_MODELS[player.carId] or CAR_MODELS[1]
    if now_ms - (player.lastInputAt or 0) > INPUT_TIMEOUT_MS then
        player.steerInput = 0
        player.throttleInput = 0
        player.brakeInput = 0
    end
    if player.finished then
        player.steerInput = 0
        player.throttleInput = 0
        player.brakeInput = 0
    end

    local half_width = track.width * 0.5
    local shoulder_factor = clamp(((player.trackDistance or 0) - half_width) / SHOULDER_DEPTH, 0, 1)
    local on_track_factor = 1 - shoulder_factor

    local cos_h = math.cos(player.heading)
    local sin_h = math.sin(player.heading)
    local right_x, right_y = -sin_h, cos_h
    local forward_speed = player.vx * cos_h + player.vy * sin_h
    local lateral_speed = player.vx * right_x + player.vy * right_y
    local speed_abs = math.sqrt(player.vx * player.vx + player.vy * player.vy)

    local throttle = clamp(player.throttleInput or 0, 0, 1)
    local brake = clamp(player.brakeInput or 0, 0, 1)
    -- Grass and gravel still reduce speed, but low-speed traction must remain
    -- strong enough for a stranded player to drive or reverse back to the road.
    local recovery_factor = player.offTrack and
        (1 - clamp(math.abs(forward_speed) / 110, 0, 1)) or 0
    local engine_factor = player.offTrack and (0.68 + recovery_factor * 0.18) or 1
    if throttle > 0 then
        local speed_ratio = clamp(math.abs(forward_speed) / model.topSpeed, 0, 1.25)
        local engine = model.acceleration * (1 - speed_ratio * speed_ratio * 0.78) * engine_factor
        forward_speed = forward_speed + engine * throttle * delta_seconds
    end

    if brake > 0 then
        if forward_speed > 6 then
            forward_speed = approach(forward_speed, 0, model.braking * brake * delta_seconds)
        else
            local reverse_factor = player.offTrack and (0.74 + recovery_factor * 0.12) or 0.58
            local reverse_limit = player.offTrack and -104 or -82
            forward_speed = approach(forward_speed, reverse_limit,
                model.acceleration * reverse_factor * brake * delta_seconds)
        end
    end

    -- This resistance is intentionally lower than available low-speed drive.
    -- The separate top-speed clamp and grip penalties still make leaving the
    -- circuit costly without making recovery impossible.
    local rolling = (player.offTrack and 1.15 or 0.72) +
        speed_abs * (player.offTrack and 0.0028 or 0.0019)
    forward_speed = approach(forward_speed, 0, rolling * delta_seconds * 60)
    if throttle == 0 and brake == 0 and math.abs(forward_speed) < 1.25 then
        forward_speed = 0
    end
    if math.abs(lateral_speed) < 0.8 then lateral_speed = 0 end
    forward_speed = clamp(forward_speed, player.offTrack and -106 or -86,
        model.topSpeed * (player.offTrack and 0.67 or 1.03))

    local target_steer = clamp(player.steerInput or 0, -1, 1) * model.steering
    local steer_response = model.steeringResponse * (player.offTrack and 0.74 or 1)
    player.steerAngle = approach(player.steerAngle, target_steer, steer_response * delta_seconds)

    local speed_turn_factor = clamp(math.abs(forward_speed) / 55, 0, 1)
    local reverse_sign = forward_speed < 0 and -1 or 1
    local target_yaw = player.steerAngle * speed_turn_factor *
        (1.35 + math.min(math.abs(forward_speed), model.topSpeed) / 210) * reverse_sign
    target_yaw = target_yaw * (player.offTrack and 0.70 or 1)
    player.yawRate = approach(player.yawRate, target_yaw, model.yawResponse * delta_seconds)
    player.yawRate = player.yawRate * math.max(0, 1 - 0.55 * delta_seconds)
    player.heading = wrap_angle(player.heading + player.yawRate * delta_seconds)

    local grip = model.grip * (player.offTrack and 0.56 or 1)
    local grip_decay = 1 / (1 + grip * delta_seconds)
    local before_lateral = lateral_speed
    lateral_speed = lateral_speed * grip_decay
    local slip = math.abs(before_lateral) / math.max(36, math.abs(forward_speed))
    local steering_load = math.abs(player.steerAngle) * clamp(speed_abs / 180, 0, 1.4)
    player.skid = clamp(math.max(slip * 1.7, steering_load - 0.42), 0, 1)

    cos_h = math.cos(player.heading)
    sin_h = math.sin(player.heading)
    right_x, right_y = -sin_h, cos_h
    player.vx = cos_h * forward_speed + right_x * lateral_speed
    player.vy = sin_h * forward_speed + right_y * lateral_speed
    player.x = player.x + player.vx * delta_seconds
    player.y = player.y + player.vy * delta_seconds

    local roll_target = -player.steerAngle * clamp(speed_abs / model.topSpeed, 0, 1) * 0.95
    roll_target = roll_target - clamp(lateral_speed / 170, -0.35, 0.35)
    player.roll = approach(player.roll, roll_target, 3.8 * delta_seconds)

    local nearest_x, nearest_y, nearest_distance, tangent_x, tangent_y, progress =
        nearest_track_point(context, player)
    update_progress(player, track, nearest_distance, progress)
    apply_track_boundary(player, track, nearest_x, nearest_y, nearest_distance, tangent_x, tangent_y)
end

local function collide_cars(a, b)
    local dx = b.x - a.x
    local dy = b.y - a.y
    local distance_sq = dx * dx + dy * dy
    local minimum = CAR_RADIUS * 2
    if distance_sq >= minimum * minimum then return end

    local distance = math.sqrt(distance_sq)
    local nx, ny
    if distance < 0.001 then
        nx, ny = 1, 0
        distance = 0.001
    else
        nx, ny = dx / distance, dy / distance
    end

    local model_a = CAR_MODELS[a.carId] or CAR_MODELS[1]
    local model_b = CAR_MODELS[b.carId] or CAR_MODELS[1]
    local inv_a = 1 / model_a.mass
    local inv_b = 1 / model_b.mass
    local inv_sum = inv_a + inv_b
    local penetration = minimum - distance
    a.x = a.x - nx * penetration * (inv_a / inv_sum)
    a.y = a.y - ny * penetration * (inv_a / inv_sum)
    b.x = b.x + nx * penetration * (inv_b / inv_sum)
    b.y = b.y + ny * penetration * (inv_b / inv_sum)

    local relative_x = b.vx - a.vx
    local relative_y = b.vy - a.vy
    local normal_speed = relative_x * nx + relative_y * ny
    if normal_speed < 0 then
        local impulse = -(1 + CAR_RESTITUTION) * normal_speed / inv_sum
        a.vx = a.vx - impulse * inv_a * nx
        a.vy = a.vy - impulse * inv_a * ny
        b.vx = b.vx + impulse * inv_b * nx
        b.vy = b.vy + impulse * inv_b * ny

        local tx, ty = -ny, nx
        local tangent_speed = relative_x * tx + relative_y * ty
        local friction_impulse = clamp(-tangent_speed / inv_sum, -impulse * 0.32, impulse * 0.32)
        a.vx = a.vx - friction_impulse * inv_a * tx
        a.vy = a.vy - friction_impulse * inv_a * ty
        b.vx = b.vx + friction_impulse * inv_b * tx
        b.vy = b.vy + friction_impulse * inv_b * ty

        local spin = clamp(tangent_speed * 0.014 + impulse * 0.0018, -3.4, 3.4)
        a.yawRate = a.yawRate - spin * inv_a
        b.yawRate = b.yawRate + spin * inv_b
        a.skid = math.max(a.skid, 0.88)
        b.skid = math.max(b.skid, 0.88)
    end
end

local function ranking_before(a, b)
    if a.finished ~= b.finished then return a.finished end
    if a.finished and b.finished then return a.finishTimeMs < b.finishTimeMs end
    if a.totalProgress ~= b.totalProgress then return a.totalProgress > b.totalProgress end
    return a.seat < b.seat
end

local function update_ranking(context)
    local ranked = context.rankedPlayers
    for i = 1, context.playerCount do
        ranked[i] = context.playerList[i]
    end
    for i = context.playerCount + 1, #ranked do ranked[i] = nil end
    if context.playerCount > 1 then table.sort(ranked, ranking_before) end
    for i = 1, context.playerCount do ranked[i].place = i end
    return ranked
end

local function finish_points(player_count, place)
    if place > 3 then return 0 end
    return math.max(0, player_count - (place - 1))
end

local function build_snapshot(context, now)
    -- Snapshot work runs on the firmware's separately capped snapshot cadence,
    -- never in the physics tick. Reuse all retained tables and allocate nothing
    -- proportional to match duration.
    update_ranking(context)
    local cars = context.snapshotCars
    for i = 1, context.playerCount do
        local player = context.playerList[i]
        local car = cars[i]
        if not car then
            car = {}
            cars[i] = car
        end
        car.seat = player.seat
        car.car = player.carId
        car.trackVote = player.trackVote
        car.lobbyReady = player.lobbyReady
        car.carSelected = player.carSelected
        car.trackVoted = player.trackVoted
        car.raceReady = player.raceReady
        car.connected = player.connected
        car.x = quantise(player.x, 10)
        car.y = quantise(player.y, 10)
        car.vx = quantise(player.vx, 10)
        car.vy = quantise(player.vy, 10)
        car.heading = quantise(player.heading, 1000)
        car.yaw = quantise(player.yawRate, 1000)
        car.roll = quantise(player.roll, 1000)
        car.lap = player.lap
        car.progress = quantise(player.totalProgress, 100)
        car.place = player.place
        car.offTrack = player.offTrack
        car.skid = quantise(player.skid, 100)
        car.finished = player.finished
        car.finishTimeMs = player.finishTimeMs
        car.points = player.points
    end
    for i = context.playerCount + 1, #cars do cars[i] = nil end

    local payload = context.snapshot
    payload.phase = context.phase
    payload.countdownMs = math.max(0, context.countdownMs or 0)
    payload.trackId = context.trackId or 0
    payload.raceTimeMs = context.raceStartedAt > 0 and math.max(0, now - context.raceStartedAt) or 0
    payload.finishRemainingMs = context.finishDeadline > 0 and math.max(0, context.finishDeadline - now) or 0
    return payload
end

local function finish_match(context, reason)
    if context.finishedRequested then return end
    local ranked = update_ranking(context)
    if context.playerCount == 0 then return end

    local player_count = context.playerCount
    for i = 1, player_count do
        ranked[i].place = i
        ranked[i].points = finish_points(player_count, i)
    end
    context.phase = "finished"
    context.finishReason = reason or "complete"
    context.finishedRequested = true
    build_snapshot(context, clock.tick())
    transport.broadcast_snapshot(context.snapshot)

    local placements = {}
    for i = 1, player_count do
        placements[#placements + 1] = {seat = ranked[i].seat, place = i}
    end
    match.finish({draw = false, placements = placements})
end

local function update_race(context, delta_ms, now)
    if context.playerCount < 2 then
        finish_match(context, "last-player")
        return
    end

    local delta_seconds = clamp(delta_ms, 0, MAX_TICK_MS) / 1000
    local track = TRACKS[context.trackId]
    local cars = context.playerList

    for i = 1, context.playerCount do
        update_car(context, cars[i], delta_seconds, now)
    end
    for i = 1, context.playerCount - 1 do
        for j = i + 1, context.playerCount do
            collide_cars(cars[i], cars[j])
        end
    end

    local newly_finished = false
    local track_length = #track.points
    for i = 1, context.playerCount do
        local player = cars[i]
        if not player.finished and player.totalProgress >= LAP_COUNT * track_length then
            player.finished = true
            player.finishTimeMs = math.max(1, now - context.raceStartedAt)
            player.throttleInput = 0
            player.brakeInput = 1
            newly_finished = true
        end
    end

    if newly_finished and context.finishDeadline == 0 then
        context.finishDeadline = now + FINISH_GRACE_MS
    end

    local finished_count = 0
    for i = 1, context.playerCount do
        if cars[i].finished then finished_count = finished_count + 1 end
    end
    if finished_count == context.playerCount or (context.finishDeadline > 0 and now >= context.finishDeadline) then
        finish_match(context, finished_count == context.playerCount and "all-finished" or "finish-timeout")
        return
    end
end

local function set_player_input(player, data)
    local steer = tonumber(data.steer) or 0
    player.steerInput = clamp(steer, -1, 1)
    player.throttleInput = data.throttle == true and 1 or clamp(tonumber(data.throttle) or 0, 0, 1)
    player.brakeInput = data.brake == true and 1 or clamp(tonumber(data.brake) or 0, 0, 1)
    player.lastInputAt = clock.tick()
end

return {
    init = function(context)
        context.players = {}
        context.playerList = {}
        context.rankedPlayers = {}
        context.seenProfiles = {}
        context.playerCount = 0
        context.snapshotCars = {}
        context.snapshot = {
            phase = "join",
            countdownMs = COUNTDOWN_MS,
            trackId = 0,
            laps = LAP_COUNT,
            raceTimeMs = 0,
            finishRemainingMs = 0,
            cars = context.snapshotCars
        }
        context.phase = "join"
        context.countdownMs = COUNTDOWN_MS
        context.trackId = 0
        context.raceStartedAt = 0
        context.finishDeadline = 0
        context.finishedRequested = false
        context.startingPlayers = 0
        context.trackGeometry = {}
        context.trackSegmentCount = 0
        context.trackRecoveryDistanceSq = 0
        context.activeTrack = false
    end,

    on_match_open = function(context)
        reconcile_players(context)
    end,

    on_player_join = function(context, player)
        reconcile_players(context)
        if match.state() == "waiting" then
            reset_to_lobby(context)
        end
    end,

    on_player_leave = function(context, player, reason)
        local previous_phase = context.phase
        local remaining = reconcile_players(context)
        if previous_phase == "racing" then
            if remaining < 2 then
                finish_match(context, "player-left")
            end
        elseif previous_phase == "countdown" then
            reset_to_lobby(context)
        else
            reset_to_lobby(context)
        end
    end,

    on_player_update = function(context, player)
        reconcile_players(context)
    end,

    on_command = function(context, player_identity, action, data, sequence)
        local player = context.players[player_identity.profileId]
        if not player then return end
        data = type(data) == "table" and data or {}

        if action == "lobby-ready" and match.state() == "waiting" and context.phase == "join" then
            player.lobbyReady = true
            advance_lobby(context)
            build_snapshot(context, clock.tick())
            transport.broadcast_snapshot(context.snapshot)
            return
        end
        if action == "select-car" and match.state() == "waiting" and context.phase == "car-select" then
            local car_id = math.floor(tonumber(data.car) or 0)
            if car_id >= 1 and car_id <= #CAR_MODELS then
                player.carId = car_id
                player.carSelected = true
                advance_lobby(context)
                build_snapshot(context, clock.tick())
                transport.broadcast_snapshot(context.snapshot)
            end
            return
        end
        if action == "select-track" and match.state() == "waiting" and context.phase == "track-vote" then
            local track_id = math.floor(tonumber(data.track) or 0)
            if track_id >= 1 and track_id <= #TRACKS then
                player.trackVote = track_id
                player.trackVoted = true
                advance_lobby(context)
                build_snapshot(context, clock.tick())
                transport.broadcast_snapshot(context.snapshot)
            end
            return
        end
        if action == "race-ready" and match.state() == "waiting" and context.phase == "confirm" then
            player.raceReady = true
            if all_players_flag(context, "raceReady") then
                context.phase = "arming"
            end
            build_snapshot(context, clock.tick())
            transport.broadcast_snapshot(context.snapshot)
            return
        end
        if action == "input" and match.state() == "playing" and
           (context.phase == "countdown" or context.phase == "racing") then
            set_player_input(player, data)
            return
        end
        if action == "release-input" then
            player.steerInput = 0
            player.throttleInput = 0
            player.brakeInput = 0
            player.lastInputAt = clock.tick()
        end
    end,

    on_tick = function(context, delta_ms)
        if match.state() ~= "playing" or context.finishedRequested then return end
        local now = clock.tick()
        if context.phase == "arming" then
            start_race(context)
            return
        end
        if context.phase == "countdown" then
            context.countdownMs = context.countdownMs - clamp(delta_ms, 0, MAX_TICK_MS)
            if context.countdownMs <= 0 then
                context.countdownMs = 0
                context.phase = "racing"
                context.raceStartedAt = now
                transport.broadcast_event("go", {})
            end
            return
        end
        if context.phase == "racing" then
            update_race(context, delta_ms, now)
        end
    end,

    on_snapshot = function(context, recipient)
        return build_snapshot(context, clock.tick())
    end,

    on_unload = function(context)
        context.players = {}
        context.playerList = {}
        context.rankedPlayers = {}
        context.snapshotCars = {}
        context.snapshot = {}
        context.trackGeometry = {}
        context.activeTrack = false
    end
}
