#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "pa_board.h"
#include "cJSON.h"
#include "esp_err.h"
#include "esp_http_server.h"

typedef enum {
    APP_RUNTIME_EVENT,
    APP_RUNTIME_TICK,
} app_runtime_mode_t;

typedef enum {
    APP_LATE_JOIN_REJECT,
    APP_LATE_JOIN_SPECTATOR,
} app_late_join_t;

#define APP_CAP_PRESENCE_READ (1u << 0)
#define APP_CAP_MATCH_SEATS (1u << 1)
#define APP_CAP_MATCH_RESULTS (1u << 2)
#define APP_CAP_STORAGE_APP_DATA (1u << 3)

typedef struct {
    bool used;
    int manifest_version;
    char id[PA_APP_ID_MAX + 1];
    char name[65];
    char description[161];
    char version[PA_APP_VERSION_MAX + 1];
    char entrypoint[PA_APP_PATH_MAX + 1];
    char stylesheet[PA_APP_PATH_MAX + 1];
    char kind[17];
    char runtime_type[9];
    char runtime_entrypoint[PA_APP_PATH_MAX + 1];
    app_runtime_mode_t runtime_mode;
    uint8_t tick_rate_hz;
    uint8_t min_players;
    uint8_t max_players;
    bool spectators;
    app_late_join_t late_join;
    uint32_t reconnect_grace_ms;
    uint8_t protocol_version;
    uint32_t capabilities;
} app_descriptor_t;

esp_err_t app_catalogue_init(void);
cJSON *app_catalogue_response(void);
bool app_catalogue_get(const char *id, app_descriptor_t *application);
void app_catalogue_invalidate(void);
esp_err_t app_catalogue_register_http(httpd_handle_t server);
