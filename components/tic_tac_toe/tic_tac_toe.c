#include "tic_tac_toe.h"

#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "TICTACTOE";

typedef enum {
    GAME_WAITING,
    GAME_PLAYING,
    GAME_WON,
    GAME_DRAW
} game_status_t;

typedef struct {
    bool occupied;
    public_profile_t profile;
} game_player_t;

static SemaphoreHandle_t game_lock;
static game_player_t player_x;
static game_player_t player_o;
static char board[9];
static char turn = 'X';
static char winner;
static game_status_t status = GAME_WAITING;

static void clear_board_locked(void)
{
    memset(board, 0, sizeof(board));
    turn = 'X';
    winner = 0;
    status = player_x.occupied && player_o.occupied
                 ? GAME_PLAYING : GAME_WAITING;
}

static game_player_t *player_for_id_locked(const char *profile_id)
{
    if (player_x.occupied &&
        strcmp(player_x.profile.id, profile_id) == 0) return &player_x;
    if (player_o.occupied &&
        strcmp(player_o.profile.id, profile_id) == 0) return &player_o;
    return NULL;
}

static char mark_for_id_locked(const char *profile_id)
{
    if (player_x.occupied &&
        strcmp(player_x.profile.id, profile_id) == 0) return 'X';
    if (player_o.occupied &&
        strcmp(player_o.profile.id, profile_id) == 0) return 'O';
    return 0;
}

static bool has_won_locked(char mark)
{
    static const uint8_t lines[][3] = {
        {0, 1, 2}, {3, 4, 5}, {6, 7, 8},
        {0, 3, 6}, {1, 4, 7}, {2, 5, 8},
        {0, 4, 8}, {2, 4, 6},
    };
    for (size_t i = 0; i < sizeof(lines) / sizeof(lines[0]); ++i) {
        if (board[lines[i][0]] == mark &&
            board[lines[i][1]] == mark &&
            board[lines[i][2]] == mark) return true;
    }
    return false;
}

static bool board_full_locked(void)
{
    for (size_t i = 0; i < sizeof(board); ++i) {
        if (!board[i]) return false;
    }
    return true;
}

static cJSON *player_json(const game_player_t *player, const char *mark)
{
    if (!player->occupied) return cJSON_CreateNull();
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "id", player->profile.id);
    cJSON_AddStringToObject(json, "nickname", player->profile.nickname);
    cJSON_AddStringToObject(json, "mark", mark);
    cJSON_AddNumberToObject(json, "wins", player->profile.wins);
    return json;
}

static const char *status_name(game_status_t value)
{
    switch (value) {
        case GAME_PLAYING: return "playing";
        case GAME_WON: return "won";
        case GAME_DRAW: return "draw";
        default: return "waiting";
    }
}

esp_err_t tic_tac_toe_init(void)
{
    game_lock = xSemaphoreCreateMutex();
    return game_lock ? ESP_OK : ESP_ERR_NO_MEM;
}

tic_tac_toe_result_t tic_tac_toe_join(const public_profile_t *profile)
{
    if (!profile) return TIC_TAC_TOE_INVALID_STATE;
    xSemaphoreTake(game_lock, portMAX_DELAY);
    if (player_for_id_locked(profile->id)) {
        xSemaphoreGive(game_lock);
        return TIC_TAC_TOE_OK;
    }
    game_player_t *slot = !player_x.occupied ? &player_x
                           : !player_o.occupied ? &player_o : NULL;
    if (!slot) {
        xSemaphoreGive(game_lock);
        return TIC_TAC_TOE_FULL;
    }
    slot->occupied = true;
    slot->profile = *profile;
    clear_board_locked();
    char mark = slot == &player_x ? 'X' : 'O';
    xSemaphoreGive(game_lock);
    ESP_LOGI(TAG, "%.18s joined as %c", profile->id, mark);
    return TIC_TAC_TOE_OK;
}

tic_tac_toe_result_t tic_tac_toe_leave(const char *profile_id)
{
    xSemaphoreTake(game_lock, portMAX_DELAY);
    game_player_t *player = player_for_id_locked(profile_id);
    if (!player) {
        xSemaphoreGive(game_lock);
        return TIC_TAC_TOE_NOT_PLAYER;
    }
    memset(player, 0, sizeof(*player));
    clear_board_locked();
    xSemaphoreGive(game_lock);
    ESP_LOGI(TAG, "%.18s left the table", profile_id);
    return TIC_TAC_TOE_OK;
}

tic_tac_toe_result_t tic_tac_toe_move(const char *profile_id, int cell)
{
    xSemaphoreTake(game_lock, portMAX_DELAY);
    char mark = mark_for_id_locked(profile_id);
    tic_tac_toe_result_t result = TIC_TAC_TOE_OK;
    bool won_round = false;
    if (!mark) {
        result = TIC_TAC_TOE_NOT_PLAYER;
    } else if (status != GAME_PLAYING) {
        result = TIC_TAC_TOE_INVALID_STATE;
    } else if (mark != turn) {
        result = TIC_TAC_TOE_NOT_TURN;
    } else if (cell < 0 || cell >= 9 || board[cell]) {
        result = TIC_TAC_TOE_INVALID_MOVE;
    } else {
        board[cell] = mark;
        if (has_won_locked(mark)) {
            status = GAME_WON;
            winner = mark;
            won_round = true;
        } else if (board_full_locked()) {
            status = GAME_DRAW;
        } else {
            turn = mark == 'X' ? 'O' : 'X';
        }
    }
    xSemaphoreGive(game_lock);
    if (won_round) {
        public_profile_t updated;
        profile_result_t profile_result = profile_record_game_win(
            profile_id, "tic-tac-toe", &updated);
        if (profile_result != PROFILE_RESULT_OK) {
            ESP_LOGW(TAG, "Could not record win for %.18s: %s",
                     profile_id, profile_result_code(profile_result));
        }
    }
    if (result == TIC_TAC_TOE_OK) {
        ESP_LOGI(TAG, "%.18s played cell %d", profile_id, cell);
    }
    return result;
}

tic_tac_toe_result_t tic_tac_toe_reset(const char *profile_id)
{
    xSemaphoreTake(game_lock, portMAX_DELAY);
    tic_tac_toe_result_t result;
    if (!player_for_id_locked(profile_id)) {
        result = TIC_TAC_TOE_NOT_PLAYER;
    } else if (status != GAME_WON && status != GAME_DRAW) {
        result = TIC_TAC_TOE_INVALID_STATE;
    } else {
        clear_board_locked();
        result = TIC_TAC_TOE_OK;
    }
    xSemaphoreGive(game_lock);
    return result;
}

bool tic_tac_toe_profile_updated(const public_profile_t *profile)
{
    bool changed = false;
    xSemaphoreTake(game_lock, portMAX_DELAY);
    game_player_t *player = player_for_id_locked(profile->id);
    if (player) {
        player->profile = *profile;
        changed = true;
    }
    xSemaphoreGive(game_lock);
    return changed;
}

bool tic_tac_toe_profile_left(const char *profile_id)
{
    return tic_tac_toe_leave(profile_id) == TIC_TAC_TOE_OK;
}

cJSON *tic_tac_toe_snapshot_json(void)
{
    xSemaphoreTake(game_lock, portMAX_DELAY);
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "status", status_name(status));
    cJSON *cells = cJSON_AddArrayToObject(json, "board");
    for (size_t i = 0; i < sizeof(board); ++i) {
        if (board[i]) {
            char value[2] = { board[i], '\0' };
            cJSON_AddItemToArray(cells, cJSON_CreateString(value));
        } else {
            cJSON_AddItemToArray(cells, cJSON_CreateNull());
        }
    }
    char turn_text[2] = { turn, '\0' };
    if (status == GAME_PLAYING) {
        cJSON_AddStringToObject(json, "turn", turn_text);
    } else {
        cJSON_AddNullToObject(json, "turn");
    }
    cJSON *players = cJSON_AddObjectToObject(json, "players");
    cJSON_AddItemToObject(players, "X", player_json(&player_x, "X"));
    cJSON_AddItemToObject(players, "O", player_json(&player_o, "O"));
    if (winner) {
        char winner_text[2] = { winner, '\0' };
        cJSON_AddStringToObject(json, "winner", winner_text);
    } else {
        cJSON_AddNullToObject(json, "winner");
    }
    xSemaphoreGive(game_lock);
    return json;
}

const char *tic_tac_toe_result_code(tic_tac_toe_result_t result)
{
    switch (result) {
        case TIC_TAC_TOE_FULL: return "game_full";
        case TIC_TAC_TOE_NOT_PLAYER: return "not_a_player";
        case TIC_TAC_TOE_NOT_TURN: return "not_your_turn";
        case TIC_TAC_TOE_INVALID_MOVE: return "invalid_move";
        case TIC_TAC_TOE_INVALID_STATE: return "invalid_game_state";
        default: return "ok";
    }
}

const char *tic_tac_toe_result_message(tic_tac_toe_result_t result)
{
    switch (result) {
        case TIC_TAC_TOE_FULL:
            return "Two players are already seated; you are spectating.";
        case TIC_TAC_TOE_NOT_PLAYER:
            return "Join the game before playing.";
        case TIC_TAC_TOE_NOT_TURN:
            return "Wait for your turn.";
        case TIC_TAC_TOE_INVALID_MOVE:
            return "Choose an empty square.";
        case TIC_TAC_TOE_INVALID_STATE:
            return "That action is not available in the current round.";
        default:
            return "Game updated.";
    }
}
