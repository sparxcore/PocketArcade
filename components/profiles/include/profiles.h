#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "cJSON.h"
#include "esp_err.h"
#include "pa_board.h"

typedef struct {
    char id[PA_PROFILE_ID_LEN + 1];
    char nickname[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    uint64_t created_at;
    uint64_t last_seen_at;
    char avatar_url[PA_AVATAR_URL_LEN + 1];
    char colour[16];
    bool persistent;
    bool admin;
    uint32_t wins;
} public_profile_t;

typedef enum {
    PROFILE_RESULT_OK,
    PROFILE_RESULT_NOT_FOUND,
    PROFILE_RESULT_INVALID_TOKEN,
    PROFILE_RESULT_INVALID_NICKNAME,
    PROFILE_RESULT_LIMIT,
    PROFILE_RESULT_DEVICE_CONFLICT,
    PROFILE_RESULT_AMBIGUOUS,
    PROFILE_RESULT_RATE_LIMITED,
    PROFILE_RESULT_STORAGE_ERROR
} profile_result_t;

typedef void (*profile_change_callback_t)(const public_profile_t *profile);

esp_err_t profile_store_init(void);
profile_result_t profile_create(const char *nickname, const char *fingerprint,
                                bool replace_binding,
                                public_profile_t *profile,
                                char token[PA_SESSION_TOKEN_HEX_LEN + 1]);
profile_result_t profile_restore_token(const char *token,
                                       const char *fingerprint,
                                       public_profile_t *profile);
profile_result_t profile_restore_device(
    const char *fingerprint, public_profile_t *profile,
    char new_token[PA_SESSION_TOKEN_HEX_LEN + 1]);
profile_result_t profile_update_nickname(
    const char *token, const char *nickname, public_profile_t *profile);
profile_result_t profile_set_avatar(const char *token,
                                    public_profile_t *profile);
profile_result_t profile_unbind_device(const char *token,
                                       const char *fingerprint);
profile_result_t profile_delete(const char *token, public_profile_t *deleted);
bool profile_token_is_admin(const char *token);
profile_result_t profile_record_game_win(
    const char *profile_id, const char *application_id,
    public_profile_t *profile);
bool profile_validate_nickname(const char *input, char *normalised,
                               size_t normalised_size);
cJSON *profile_public_json(const public_profile_t *profile);
cJSON *profile_all_public_json(void);
size_t profile_count(void);
void profile_set_change_callback(profile_change_callback_t callback);
const char *profile_result_code(profile_result_t result);
const char *profile_result_message(profile_result_t result);
