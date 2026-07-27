#pragma once

#include <stddef.h>
#include <stdint.h>

#include "app_catalogue.h"
#include "cJSON.h"
#include "esp_err.h"
#include "profiles.h"

typedef struct {
    char profile_id[PA_PROFILE_ID_LEN + 1];
    char nickname[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    uint32_t wins;
    uint8_t seat;
    bool connected;
} game_runtime_player_t;

typedef struct {
    void *context;
    size_t (*players)(void *context, game_runtime_player_t *output,
                      size_t capacity);
    const char *(*match_state)(void *context);
    esp_err_t (*start_countdown)(void *context);
    esp_err_t (*finish)(void *context, const cJSON *result);
    esp_err_t (*broadcast_snapshot)(void *context, const cJSON *payload);
    esp_err_t (*send_snapshot)(void *context, const char *profile_id,
                               const cJSON *payload);
    esp_err_t (*broadcast_event)(void *context, const char *name,
                                 const cJSON *payload);
} game_runtime_host_t;

typedef struct {
    bool loaded;
    bool faulted;
    char app_id[PA_APP_ID_MAX + 1];
    char runtime_entrypoint[PA_APP_PATH_MAX + 1];
    uint32_t capabilities;
    void *lua_state;
    int callbacks_ref;
    int context_ref;
    size_t memory_used;
    size_t memory_high_water;
    size_t memory_quota;
    int instructions_remaining;
    int64_t callback_deadline_us;
    bool in_tick_callback;
    const char *pending_callback;
    const char *pending_profile_id;
    const char *pending_action;
    const char *pending_reason;
    const public_profile_t *pending_profile;
    const cJSON *pending_data;
    uint32_t pending_number;
    char fault_message[129];
    char snapshot_json[CONFIG_PA_GAME_MAX_SNAPSHOT_BYTES + 1];
    game_runtime_host_t host;
} game_runtime_t;

typedef enum {
    GAME_RUNTIME_PLAYER_JOINED,
    GAME_RUNTIME_PLAYER_LEFT,
    GAME_RUNTIME_PLAYER_UPDATED,
} game_runtime_player_event_t;

esp_err_t game_runtime_load(game_runtime_t *runtime,
                            const app_descriptor_t *application,
                            const game_runtime_host_t *host);
esp_err_t game_runtime_command(game_runtime_t *runtime,
                               const char *profile_id,
                               const char *action,
                               cJSON *data,
                               uint32_t input_sequence);
esp_err_t game_runtime_player_event(game_runtime_t *runtime,
                                    game_runtime_player_event_t event,
                                    const public_profile_t *profile,
                                    const char *reason);
esp_err_t game_runtime_tick(game_runtime_t *runtime, uint32_t delta_ms);
esp_err_t game_runtime_snapshot(game_runtime_t *runtime,
                                const char *recipient_profile_id,
                                cJSON **snapshot);
void game_runtime_unload(game_runtime_t *runtime);
const char *game_runtime_fault_message(const game_runtime_t *runtime);
