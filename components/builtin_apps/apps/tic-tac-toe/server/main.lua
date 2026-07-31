local winning_lines = {
    {1, 2, 3}, {4, 5, 6}, {7, 8, 9},
    {1, 4, 7}, {2, 5, 8}, {3, 6, 9},
    {1, 5, 9}, {3, 5, 7}
}

local function empty_board()
    -- False keeps all nine JSON array positions present.
    return {
        false, false, false,
        false, false, false,
        false, false, false
    }
end

local function public_player(player)
    return {
        id = player.profileId,
        nickname = player.nickname,
        wins = player.wins
    }
end

local function reset_round(context)
    context.board = empty_board()
    context.winner = false
    if context.players.X and context.players.O then
        context.status = "playing"
        context.turn = "X"
    else
        context.status = "waiting"
        context.turn = false
    end
end

local function mark_for_profile(context, profile_id)
    if context.players.X and context.players.X.id == profile_id then
        return "X"
    end
    if context.players.O and context.players.O.id == profile_id then
        return "O"
    end
    return nil
end

local function has_won(board, mark)
    for _, line in ipairs(winning_lines) do
        if board[line[1]] == mark and
           board[line[2]] == mark and
           board[line[3]] == mark then
            return true
        end
    end
    return false
end

local function board_is_full(board)
    for index = 1, 9 do
        if not board[index] then
            return false
        end
    end
    return true
end

local function snapshot(context)
    return {
        status = context.status,
        board = context.board,
        turn = context.turn,
        players = context.players,
        winner = context.winner
    }
end

local function finish_round(context, draw)
    local seats = {}
    for _, player in ipairs(match.players()) do
        seats[player.profileId] = player.seat
    end
    local x_seat = seats[context.players.X.id]
    local o_seat = seats[context.players.O.id]
    local placements
    if draw then
        placements = {
            {seat = x_seat, place = 1},
            {seat = o_seat, place = 1}
        }
    else
        placements = {
            {
                seat = context.winner == "X" and x_seat or o_seat,
                place = 1
            },
            {
                seat = context.winner == "X" and o_seat or x_seat,
                place = 2
            }
        }
    end

    -- Deliver the final board before match.finish closes this runtime.
    transport.broadcast_snapshot(snapshot(context))
    match.finish({
        draw = draw,
        placements = placements
    })
end

return {
    init = function(context)
        context.players = {X = false, O = false}
        reset_round(context)
    end,

    on_match_open = function(context)
        log.info("Tic-Tac-Toe match opened")
    end,

    on_player_join = function(context, player)
        local value = public_player(player)
        if not context.players.X then
            context.players.X = value
        elseif not context.players.O then
            context.players.O = value
        end
        reset_round(context)
        if context.players.X and context.players.O then
            match.start_countdown()
        end
    end,

    on_player_leave = function(context, player, reason)
        local mark = mark_for_profile(context, player.profileId)
        if mark then
            context.players[mark] = false
            reset_round(context)
        end
    end,

    on_player_update = function(context, player)
        local mark = mark_for_profile(context, player.profileId)
        if mark then
            context.players[mark] = public_player(player)
        end
    end,

    on_command = function(context, player, action, data, sequence)
        local mark = mark_for_profile(context, player.profileId)
        if not mark then
            return
        end
        if action == "reset" then
            if context.status == "won" or context.status == "draw" then
                reset_round(context)
            end
            return
        end
        if action ~= "move" or context.status ~= "playing" or
           context.turn ~= mark then
            return
        end
        local cell = math.tointeger(data.cell)
        if not cell or cell < 0 or cell > 8 or context.board[cell + 1] then
            return
        end
        context.board[cell + 1] = mark
        if has_won(context.board, mark) then
            context.status = "won"
            context.winner = mark
            context.turn = false
            finish_round(context, false)
        elseif board_is_full(context.board) then
            context.status = "draw"
            context.turn = false
            finish_round(context, true)
        else
            context.turn = mark == "X" and "O" or "X"
        end
    end,

    on_snapshot = function(context, recipient)
        return snapshot(context)
    end,

    on_unload = function(context)
        log.info("Tic-Tac-Toe match unloaded")
    end
}
