local COLOURS = {"coral", "emerald", "gold", "violet"}
local START_OFFSET = {0, 13, 26, 39}
local SAFE = {
    [0] = true, [8] = true,
    [13] = true, [21] = true,
    [26] = true, [34] = true,
    [39] = true, [47] = true
}

local build_snapshot
local finish_match
local handle_move

local function new_pawns()
    return {-1, -1, -1, -1}
end

local function copy_array(source)
    local result = {}
    for i = 1, #source do
        result[i] = source[i]
    end
    return result
end

local function contains(array, value)
    for i = 1, #array do
        if array[i] == value then
            return true
        end
    end
    return false
end

local function global_square(seat, progress)
    if progress < 0 or progress > 51 then
        return nil
    end
    return (START_OFFSET[seat] + progress) % 52
end

local function home_count(player)
    local count = 0
    for i = 1, 4 do
        if player.pawns[i] == 57 then
            count = count + 1
        end
    end
    return count
end

local function progress_score(player)
    local score = home_count(player) * 1000
    for i = 1, 4 do
        local progress = player.pawns[i]
        if progress > 0 then
            score = score + progress
        end
    end
    return score
end

local function emit(context, name, payload)
    context.eventSeq = context.eventSeq + 1
    payload.seq = context.eventSeq
    transport.broadcast_event(name, payload)
end

local function reconcile_players(context)
    local current = match.players()
    local seen = {}
    local by_seat = {}
    local active = {}

    for i = 1, #current do
        local source = current[i]
        local player = context.playersById[source.profileId]
        if not player then
            player = {
                profileId = source.profileId,
                nickname = source.nickname,
                wins = source.wins,
                seat = source.seat,
                colour = COLOURS[source.seat],
                pawns = new_pawns()
            }
            context.playersById[source.profileId] = player
        end

        player.nickname = source.nickname
        player.wins = source.wins
        player.seat = source.seat
        player.connected = source.connected
        player.colour = COLOURS[source.seat]

        seen[source.profileId] = true
        by_seat[source.seat] = player
        active[#active + 1] = source.seat
    end

    local remove = {}
    for profile_id, _ in pairs(context.playersById) do
        if not seen[profile_id] then
            remove[#remove + 1] = profile_id
        end
    end
    for i = 1, #remove do
        context.playersById[remove[i]] = nil
    end

    context.playersBySeat = by_seat
    context.activeSeats = active
end

local function reset_turn_state(context)
    context.phase = "roll"
    context.dice = 0
    context.legalMoves = {}
end

local function find_turn_index(context, seat)
    for i = 1, #context.activeSeats do
        if context.activeSeats[i] == seat then
            return i
        end
    end
    return nil
end

local function advance_after_departure(context, departed_seat)
    if #context.activeSeats == 0 then
        context.turnSeat = nil
        reset_turn_state(context)
        return
    end

    local next_seat = context.activeSeats[1]
    for i = 1, #context.activeSeats do
        if context.activeSeats[i] > departed_seat then
            next_seat = context.activeSeats[i]
            break
        end
    end

    context.turnSeat = next_seat
    reset_turn_state(context)
    context.turnNumber = context.turnNumber + 1
end

local function advance_turn(context, keep_turn)
    if #context.activeSeats == 0 then
        context.turnSeat = nil
        reset_turn_state(context)
        return
    end

    if keep_turn and context.playersBySeat[context.turnSeat] then
        reset_turn_state(context)
        context.turnNumber = context.turnNumber + 1
        return
    end

    local index = find_turn_index(context, context.turnSeat) or 0
    index = (index % #context.activeSeats) + 1
    context.turnSeat = context.activeSeats[index]
    reset_turn_state(context)
    context.turnNumber = context.turnNumber + 1
end

local function start_if_ready(context)
    if context.started then
        return
    end

    reconcile_players(context)
    if match.state() ~= "playing" or #context.activeSeats < 2 then
        context.status = "waiting"
        return
    end

    context.started = true
    context.status = "playing"
    context.turnNumber = 1
    context.turnSeat = context.activeSeats[(random.next() % #context.activeSeats) + 1]
    reset_turn_state(context)
end

local function legal_moves_for(context, player, roll)
    local moves = {}
    for pawn = 1, 4 do
        local progress = player.pawns[pawn]
        if progress == -1 then
            if roll == 6 then
                moves[#moves + 1] = pawn
            end
        elseif progress < 57 and progress + roll <= 57 then
            moves[#moves + 1] = pawn
        end
    end
    return moves
end

local function all_home(player)
    return home_count(player) == 4
end

local function placements_for(context, winner_seat)
    local players = match.players()
    local ranked = {}

    for i = 1, #players do
        local seat = players[i].seat
        local game_player = context.playersBySeat[seat]
        ranked[#ranked + 1] = {
            seat = seat,
            winner = seat == winner_seat,
            score = game_player and progress_score(game_player) or 0
        }
    end

    table.sort(ranked, function(a, b)
        if a.winner ~= b.winner then
            return a.winner
        end
        if a.score ~= b.score then
            return a.score > b.score
        end
        return a.seat < b.seat
    end)

    local placements = {}
    for i = 1, #ranked do
        placements[i] = {seat = ranked[i].seat, place = i}
    end
    return placements
end

finish_match = function(context, winner_seat, reason)
    if context.finished then
        return
    end

    context.finished = true
    context.status = "won"
    context.winnerSeat = winner_seat
    context.phase = "finished"
    context.legalMoves = {}

    emit(context, "victory", {
        seat = winner_seat,
        reason = reason or "home"
    })

    transport.broadcast_snapshot(build_snapshot(context))
    match.finish({
        draw = false,
        placements = placements_for(context, winner_seat)
    })
end

build_snapshot = function(context)
    local players = {}
    for i = 1, #context.activeSeats do
        local seat = context.activeSeats[i]
        local player = context.playersBySeat[seat]
        if player then
            players[#players + 1] = {
                seat = seat,
                nickname = player.nickname,
                colour = player.colour,
                connected = player.connected,
                pawns = copy_array(player.pawns),
                homeCount = home_count(player)
            }
        end
    end

    return {
        version = 1,
        status = context.status,
        turnSeat = context.turnSeat,
        turnNumber = context.turnNumber,
        phase = context.phase,
        dice = context.dice,
        legalMoves = copy_array(context.legalMoves),
        winnerSeat = context.winnerSeat,
        eventSeq = context.eventSeq,
        players = players,
        rules = {
            exactHome = true,
            extraOnSix = true,
            extraOnCapture = true,
            extraOnHome = true
        }
    }
end

local function only_board_pawn_move(player, legal_moves, roll)
    local board_pawn = nil
    local board_count = 0
    local yard_choice = false

    for pawn = 1, 4 do
        local progress = player.pawns[pawn]
        if progress >= 0 and progress < 57 then
            board_count = board_count + 1
            board_pawn = pawn
        elseif progress == -1 and contains(legal_moves, pawn) then
            yard_choice = true
        end
    end

    if board_count ~= 1 or not contains(legal_moves, board_pawn) then
        return nil
    end

    if roll == 6 and yard_choice then
        return nil
    end

    return board_pawn
end

local function handle_roll(context, player)
    if context.phase ~= "roll" then
        return
    end

    local roll = (random.next() % 6) + 1
    context.dice = roll
    context.legalMoves = legal_moves_for(context, player, roll)
    context.phase = "move"

    emit(context, "dice", {
        seat = player.seat,
        value = roll
    })

    if #context.legalMoves == 0 then
        emit(context, "no_move", {
            seat = player.seat,
            value = roll
        })

        local keep_turn = roll == 6
        advance_turn(context, keep_turn)
        emit(context, "turn", {
            seat = context.turnSeat,
            extra = keep_turn
        })
        return
    end

    local automatic_pawn = only_board_pawn_move(player, context.legalMoves, roll)
    if automatic_pawn then
        handle_move(context, player, {pawn = automatic_pawn})
    end
end

handle_move = function(context, player, data)
    if context.phase ~= "move" then
        return
    end

    local pawn = data and tonumber(data.pawn) or nil
    if not pawn or pawn ~= math.floor(pawn) or pawn < 1 or pawn > 4 then
        return
    end
    if not contains(context.legalMoves, pawn) then
        return
    end

    local from = player.pawns[pawn]
    local to
    local path = {}

    if from == -1 then
        to = 0
        path[1] = 0
    else
        to = from + context.dice
        for progress = from + 1, to do
            path[#path + 1] = progress
        end
    end

    player.pawns[pawn] = to
    emit(context, "move", {
        seat = player.seat,
        pawn = pawn,
        from = from,
        to = to,
        path = path
    })

    local captured = false
    local landing = global_square(player.seat, to)
    if landing and SAFE[landing] then
        emit(context, "safe", {
            seat = player.seat,
            pawn = pawn,
            square = landing
        })
    end
    if landing and not SAFE[landing] then
        for i = 1, #context.activeSeats do
            local other_seat = context.activeSeats[i]
            if other_seat ~= player.seat then
                local other = context.playersBySeat[other_seat]
                for other_pawn = 1, 4 do
                    local other_progress = other.pawns[other_pawn]
                    if global_square(other_seat, other_progress) == landing then
                        other.pawns[other_pawn] = -1
                        captured = true
                        emit(context, "capture", {
                            attackerSeat = player.seat,
                            attackerPawn = pawn,
                            victimSeat = other_seat,
                            victimPawn = other_pawn,
                            victimFrom = other_progress,
                            square = landing
                        })
                    end
                end
            end
        end
    end

    local reached_home = to == 57
    if reached_home then
        emit(context, "home", {
            seat = player.seat,
            pawn = pawn,
            homeCount = home_count(player)
        })
    end

    if all_home(player) then
        finish_match(context, player.seat, "home")
        return
    end

    local keep_turn = context.dice == 6 or captured or reached_home
    advance_turn(context, keep_turn)
    emit(context, "turn", {
        seat = context.turnSeat,
        extra = keep_turn
    })
end

return {
    init = function(context)
        context.playersById = {}
        context.playersBySeat = {}
        context.activeSeats = {}
        context.started = false
        context.finished = false
        context.status = "waiting"
        context.phase = "waiting"
        context.dice = 0
        context.legalMoves = {}
        context.turnSeat = nil
        context.turnNumber = 0
        context.winnerSeat = nil
        context.eventSeq = 0
    end,

    on_match_open = function(context)
        reconcile_players(context)
    end,

    on_player_join = function(context, player)
        reconcile_players(context)
        if not context.started then
            context.status = "waiting"
        end
    end,

    on_player_leave = function(context, player, reason)
        local previous = context.playersById[player.profileId]
        local departed_seat = previous and previous.seat or nil
        local was_current = departed_seat and context.turnSeat == departed_seat

        reconcile_players(context)

        if not context.started or context.finished then
            context.status = "waiting"
            return
        end

        emit(context, "player_left", {
            seat = departed_seat or 0,
            reason = reason or "left"
        })

        if #context.activeSeats == 1 then
            finish_match(context, context.activeSeats[1], "forfeit")
            return
        end

        if #context.activeSeats == 0 then
            context.status = "waiting"
            context.turnSeat = nil
            reset_turn_state(context)
            return
        end

        if was_current or not context.playersBySeat[context.turnSeat] then
            advance_after_departure(context, departed_seat or 0)
            emit(context, "turn", {
                seat = context.turnSeat,
                extra = false
            })
        end
    end,

    on_player_update = function(context, player)
        reconcile_players(context)
    end,

    on_command = function(context, player, action, data, sequence)
        if context.finished or match.state() ~= "playing" then
            return
        end

        start_if_ready(context)
        local game_player = context.playersById[player.profileId]
        if not game_player or game_player.seat ~= context.turnSeat then
            return
        end

        if action == "roll" then
            handle_roll(context, game_player)
        elseif action == "move" then
            handle_move(context, game_player, data)
        end
    end,

    on_snapshot = function(context, recipient)
        reconcile_players(context)
        start_if_ready(context)
        return build_snapshot(context)
    end,

    on_unload = function(context)
        context.playersById = {}
        context.playersBySeat = {}
        context.activeSeats = {}
        context.legalMoves = {}
    end
}
