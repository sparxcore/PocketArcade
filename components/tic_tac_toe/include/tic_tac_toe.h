#pragma once

#include <stdbool.h>
#include "cJSON.h"
#include "esp_err.h"
#include "profiles.h"

typedef enum {
    TIC_TAC_TOE_OK,
    TIC_TAC_TOE_FULL,
    TIC_TAC_TOE_NOT_PLAYER,
    TIC_TAC_TOE_NOT_TURN,
    TIC_TAC_TOE_INVALID_MOVE,
    TIC_TAC_TOE_INVALID_STATE
} tic_tac_toe_result_t;

esp_err_t tic_tac_toe_init(void);
tic_tac_toe_result_t tic_tac_toe_join(const public_profile_t *profile);
tic_tac_toe_result_t tic_tac_toe_leave(const char *profile_id);
tic_tac_toe_result_t tic_tac_toe_move(const char *profile_id, int cell);
tic_tac_toe_result_t tic_tac_toe_reset(const char *profile_id);
bool tic_tac_toe_profile_updated(const public_profile_t *profile);
bool tic_tac_toe_profile_left(const char *profile_id);
cJSON *tic_tac_toe_snapshot_json(void);
const char *tic_tac_toe_result_code(tic_tac_toe_result_t result);
const char *tic_tac_toe_result_message(tic_tac_toe_result_t result);
