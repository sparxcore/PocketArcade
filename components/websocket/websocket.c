#include "websocket.h"

#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "chat.h"
#include "esp_log.h"
#include "esp_random.h"
#include "pa_board.h"
#include "pa_protocol.h"
#include "presence.h"
#include "profiles.h"
#include "storage.h"
#include "system_state.h"
#include "tic_tac_toe.h"
#include "wifi_ap.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "WS";

typedef struct {
    bool used;
    bool authenticated;
    int fd;
    char connection_id[PA_CONNECTION_ID_LEN + 1];
    public_profile_t profile;
    uint64_t rate_window_started;
    unsigned rate_count;
} ws_client_t;

static httpd_handle_t ws_server;
static ws_client_t clients[CONFIG_PA_WS_MAX_CONNECTIONS];
static SemaphoreHandle_t clients_lock;
static uint32_t server_sequence = 100;

static void random_connection_id(char output[PA_CONNECTION_ID_LEN + 1])
{
    static const char digits[] = "0123456789abcdef";
    uint8_t bytes[8];
    esp_fill_random(bytes, sizeof(bytes));
    output[0] = 'c';
    output[1] = '_';
    for (size_t i = 0; i < sizeof(bytes); ++i) {
        output[2 + i * 2] = digits[bytes[i] >> 4];
        output[3 + i * 2] = digits[bytes[i] & 0x0f];
    }
    output[18] = '\0';
}

static ws_client_t *find_fd_locked(int fd)
{
    for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
        if (clients[i].used && clients[i].fd == fd) return &clients[i];
    }
    return NULL;
}

static ws_client_t *reserve_fd_locked(int fd)
{
    ws_client_t *client = find_fd_locked(fd);
    if (client) return client;
    for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
        if (!clients[i].used) {
            memset(&clients[i], 0, sizeof(clients[i]));
            clients[i].used = true;
            clients[i].fd = fd;
            random_connection_id(clients[i].connection_id);
            return &clients[i];
        }
    }
    return NULL;
}

static esp_err_t send_text_fd(int fd, const char *text)
{
    httpd_ws_frame_t frame = {
        .final = true,
        .fragmented = false,
        .type = HTTPD_WS_TYPE_TEXT,
        .payload = (uint8_t *)text,
        .len = strlen(text),
    };
    return httpd_ws_send_frame_async(ws_server, fd, &frame);
}

static esp_err_t send_message_fd(int fd, const char *type, uint32_t id,
                                 cJSON *payload)
{
    char *text = pa_message_print(type, id, payload);
    if (!text) return ESP_ERR_NO_MEM;
    esp_err_t err = send_text_fd(fd, text);
    cJSON_free(text);
    return err;
}

static void broadcast(const char *type, cJSON *payload)
{
    uint32_t id;
    int fds[CONFIG_PA_WS_MAX_CONNECTIONS];
    size_t count = 0;
    xSemaphoreTake(clients_lock, portMAX_DELAY);
    id = ++server_sequence;
    for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
        if (clients[i].used && clients[i].authenticated) {
            fds[count++] = clients[i].fd;
        }
    }
    xSemaphoreGive(clients_lock);
    char *text = pa_message_print(type, id, payload);
    if (!text) return;
    for (size_t i = 0; i < count; ++i) {
        if (send_text_fd(fds[i], text) != ESP_OK) {
            ESP_LOGD(TAG, "Broadcast send failed on fd %d", fds[i]);
        }
    }
    cJSON_free(text);
}

static void broadcast_game_state(void)
{
    broadcast(PA_TYPE_GAME_TTT_UPDATED, tic_tac_toe_snapshot_json());
}

static cJSON *presence_player(const public_profile_t *profile, bool online)
{
    cJSON *player = cJSON_CreateObject();
    cJSON_AddStringToObject(player, "id", profile->id);
    cJSON_AddStringToObject(player, "nickname", profile->nickname);
    if (profile->avatar_url[0]) {
        cJSON_AddStringToObject(player, "avatarUrl", profile->avatar_url);
    } else {
        cJSON_AddNullToObject(player, "avatarUrl");
    }
    if (profile->colour[0]) {
        cJSON_AddStringToObject(player, "colour", profile->colour);
    } else {
        cJSON_AddNullToObject(player, "colour");
    }
    cJSON_AddBoolToObject(player, "online", online);
    cJSON_AddBoolToObject(player, "persistent", profile->persistent);
    cJSON_AddStringToObject(player, "role",
                            profile->admin ? "admin" : "player");
    cJSON_AddNumberToObject(player, "wins", profile->wins);
    return player;
}

static void on_presence_event(presence_event_t event,
                              const public_profile_t *profile)
{
    bool game_changed = false;
    if (event == PRESENCE_EVENT_UPDATED) {
        game_changed = tic_tac_toe_profile_updated(profile);
    } else if (event == PRESENCE_EVENT_LEFT) {
        game_changed = tic_tac_toe_profile_left(profile->id);
    }

    const char *type = event == PRESENCE_EVENT_JOINED
                           ? PA_TYPE_PRESENCE_JOINED
                           : event == PRESENCE_EVENT_UPDATED
                                 ? PA_TYPE_PRESENCE_UPDATED
                                 : PA_TYPE_PRESENCE_LEFT;
    cJSON *payload = cJSON_CreateObject();
    cJSON_AddItemToObject(payload, "player",
                          presence_player(profile,
                                          event != PRESENCE_EVENT_LEFT));
    broadcast(type, payload);
    if (game_changed) broadcast_game_state();
}

static void on_storage_event(storage_event_t event,
                             const storage_info_t *info)
{
    const char *type = event == STORAGE_EVENT_MOUNTED
                           ? PA_TYPE_STORAGE_MOUNTED
                           : event == STORAGE_EVENT_UNMOUNTED
                                 ? PA_TYPE_STORAGE_UNMOUNTED
                                 : PA_TYPE_STORAGE_ERROR;
    cJSON *payload = cJSON_CreateObject();
    cJSON_AddBoolToObject(payload, "mounted", info->mounted);
    cJSON_AddBoolToObject(payload, "persistentProfilesAvailable",
                          info->persistent_profiles_available);
    cJSON_AddBoolToObject(payload, "safeToRemove", info->safe_to_remove);
    cJSON_AddStringToObject(payload, "interface", info->interface_name);
    broadcast(type, payload);
}

static bool rate_allowed(ws_client_t *client)
{
    uint64_t now = system_uptime_ms();
    if (now - client->rate_window_started >= 1000) {
        client->rate_window_started = now;
        client->rate_count = 0;
    }
    return ++client->rate_count <= CONFIG_PA_WS_MESSAGES_PER_SECOND;
}

static void send_authentication_error(int fd, uint32_t id,
                                      const char *code,
                                      const char *message)
{
    cJSON *payload = cJSON_CreateObject();
    cJSON_AddStringToObject(payload, "code", code);
    cJSON_AddStringToObject(payload, "message", message);
    send_message_fd(fd, PA_TYPE_ERROR_AUTH, id, payload);
}

static esp_err_t send_feature_error(int fd, uint32_t id, const char *type,
                                    const char *code, const char *message)
{
    cJSON *payload = cJSON_CreateObject();
    cJSON_AddStringToObject(payload, "code", code);
    cJSON_AddStringToObject(payload, "message", message);
    return send_message_fd(fd, type, id, payload);
}

static esp_err_t handle_hello(int fd, uint32_t id, cJSON *payload)
{
    cJSON *token_json = cJSON_GetObjectItemCaseSensitive(
        payload, "sessionToken");
    const char *token = cJSON_IsString(token_json) ? token_json->valuestring : NULL;
    if (token && strlen(token) > PA_SESSION_TOKEN_HEX_LEN) token = NULL;

    char fingerprint[PA_FINGERPRINT_HEX_LEN + 1] = {0};
    const char *fingerprint_ptr =
        wifi_ap_fingerprint_for_socket(fd, fingerprint) == ESP_OK
            ? fingerprint : NULL;
    public_profile_t profile = {0};
    char replacement_token[PA_SESSION_TOKEN_HEX_LEN + 1] = {0};
    const char *restored_by = NULL;
    profile_result_t result = PROFILE_RESULT_INVALID_TOKEN;
    if (token) {
        result = profile_restore_token(token, fingerprint_ptr, &profile);
        if (result == PROFILE_RESULT_OK) restored_by = "token";
    }
    if (!restored_by && fingerprint_ptr) {
        result = profile_restore_device(fingerprint_ptr, &profile,
                                        replacement_token);
        if (result == PROFILE_RESULT_OK) restored_by = "device";
    }
    memset(fingerprint, 0, sizeof(fingerprint));
    if (!restored_by) {
        send_authentication_error(
            fd, id, "profile_required",
            "Choose a nickname to create your player profile.");
        return ESP_OK;
    }

    xSemaphoreTake(clients_lock, portMAX_DELAY);
    ws_client_t *client = reserve_fd_locked(fd);
    if (!client) {
        xSemaphoreGive(clients_lock);
        send_authentication_error(fd, id, "connection_limit",
                                  "Too many browser connections are open.");
        return ESP_ERR_NO_MEM;
    }
    bool was_authenticated = client->authenticated;
    client->authenticated = false;
    client->profile = profile;
    char connection_id[PA_CONNECTION_ID_LEN + 1];
    strlcpy(connection_id, client->connection_id, sizeof(connection_id));
    xSemaphoreGive(clients_lock);

    /*
     * Add the profile before constructing the welcome snapshot. Keep this
     * socket unauthenticated until after the presence callback has broadcast,
     * so its first protocol frame is always system.welcome.
     */
    if (!was_authenticated) presence_connection_opened(&profile);
    xSemaphoreTake(clients_lock, portMAX_DELAY);
    client = find_fd_locked(fd);
    if (client) client->authenticated = true;
    xSemaphoreGive(clients_lock);

    cJSON *welcome = cJSON_CreateObject();
    cJSON_AddNumberToObject(welcome, "protocolVersion", PA_PROTOCOL_VERSION);
    cJSON_AddStringToObject(welcome, "connectionId", connection_id);
    cJSON_AddStringToObject(welcome, "restoredBy", restored_by);
    if (replacement_token[0]) {
        cJSON_AddStringToObject(welcome, "sessionToken", replacement_token);
    } else {
        cJSON_AddNullToObject(welcome, "sessionToken");
    }
    cJSON_AddItemToObject(welcome, "profile", profile_public_json(&profile));
    cJSON_AddItemToObject(welcome, "players", presence_snapshot_json());
    cJSON *storage = cJSON_AddObjectToObject(welcome, "storage");
    cJSON_AddBoolToObject(storage, "mounted", storage_is_mounted());
    cJSON_AddNumberToObject(welcome, "serverUptimeMs",
                            (double)system_uptime_ms());
    send_message_fd(fd, PA_TYPE_SYSTEM_WELCOME, id, welcome);

    cJSON *snapshot = cJSON_CreateObject();
    cJSON_AddItemToObject(snapshot, "players", presence_snapshot_json());
    send_message_fd(fd, PA_TYPE_PRESENCE_SNAPSHOT, ++server_sequence, snapshot);
    cJSON *chat_snapshot = cJSON_CreateObject();
    cJSON_AddItemToObject(chat_snapshot, "messages", chat_snapshot_json());
    send_message_fd(fd, PA_TYPE_CHAT_SNAPSHOT, ++server_sequence,
                    chat_snapshot);
    send_message_fd(fd, PA_TYPE_GAME_TTT_SNAPSHOT, ++server_sequence,
                    tic_tac_toe_snapshot_json());
    ESP_LOGI(TAG, "Authenticated %.18s on %.18s by %s",
             profile.id, connection_id, restored_by);
    return ESP_OK;
}

static esp_err_t websocket_handler(httpd_req_t *request)
{
    int fd = httpd_req_to_sockfd(request);
    /*
     * ESP-IDF 6 performs the HTTP upgrade internally and invokes this handler
     * only for WebSocket frames. request->method remains HTTP_GET, so using it
     * to identify the upgrade would discard every client frame. Lazily reserve
     * the bounded connection record when the first frame is dispatched.
     */
    xSemaphoreTake(clients_lock, portMAX_DELAY);
    ws_client_t *client = find_fd_locked(fd);
    bool opened = client == NULL;
    if (!client) client = reserve_fd_locked(fd);
    xSemaphoreGive(clients_lock);
    if (!client) {
        ESP_LOGW(TAG, "WebSocket connection limit reached");
        return ESP_ERR_NO_MEM;
    }
    if (opened) ESP_LOGI(TAG, "WebSocket opened on fd %d", fd);

    httpd_ws_frame_t frame = {0};
    esp_err_t err = httpd_ws_recv_frame(request, &frame, 0);
    if (err != ESP_OK) return err;
    if (frame.type == HTTPD_WS_TYPE_CLOSE) {
        websocket_socket_closed(fd);
        return ESP_OK;
    }
    if (frame.type != HTTPD_WS_TYPE_TEXT ||
        frame.len == 0 || frame.len > CONFIG_PA_WS_MAX_MESSAGE) {
        send_message_fd(fd, PA_TYPE_ERROR_PROTOCOL, 0,
                        cJSON_CreateObject());
        return ESP_ERR_INVALID_SIZE;
    }
    char *buffer = malloc(frame.len + 1);
    if (!buffer) return ESP_ERR_NO_MEM;
    frame.payload = (uint8_t *)buffer;
    err = httpd_ws_recv_frame(request, &frame, frame.len);
    if (err != ESP_OK) {
        free(buffer);
        return err;
    }
    buffer[frame.len] = '\0';

    xSemaphoreTake(clients_lock, portMAX_DELAY);
    client = find_fd_locked(fd);
    bool allowed = client && rate_allowed(client);
    xSemaphoreGive(clients_lock);
    if (!allowed) {
        free(buffer);
        ESP_LOGW(TAG, "WebSocket rate or connection limit exceeded");
        return ESP_ERR_INVALID_STATE;
    }

    cJSON *root = cJSON_ParseWithLength(buffer, frame.len);
    free(buffer);
    cJSON *version = cJSON_GetObjectItemCaseSensitive(root, "v");
    cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    cJSON *id_json = cJSON_GetObjectItemCaseSensitive(root, "id");
    cJSON *payload = cJSON_GetObjectItemCaseSensitive(root, "payload");
    uint32_t id = cJSON_IsNumber(id_json) ? (uint32_t)id_json->valuedouble : 0;
    if (!root || !cJSON_IsNumber(version) ||
        version->valueint != PA_PROTOCOL_VERSION ||
        !cJSON_IsString(type) || !cJSON_IsObject(payload)) {
        cJSON_Delete(root);
        cJSON *error = cJSON_CreateObject();
        cJSON_AddStringToObject(error, "code", "invalid_message");
        cJSON_AddStringToObject(error, "message",
                                "A valid version 1 message is required.");
        send_message_fd(fd, PA_TYPE_ERROR_PROTOCOL, id, error);
        return ESP_OK;
    }
    if (strcmp(type->valuestring, PA_TYPE_SYSTEM_HELLO) == 0) {
        xSemaphoreTake(clients_lock, portMAX_DELAY);
        client = find_fd_locked(fd);
        bool already_authenticated = client && client->authenticated;
        xSemaphoreGive(clients_lock);
        if (already_authenticated) {
            cJSON *error = cJSON_CreateObject();
            cJSON_AddStringToObject(error, "code", "already_authenticated");
            cJSON_AddStringToObject(
                error, "message",
                "This connection has already completed its handshake.");
            err = send_message_fd(fd, PA_TYPE_ERROR_PROTOCOL, id, error);
        } else {
            err = handle_hello(fd, id, payload);
        }
    } else {
        public_profile_t profile = {0};
        xSemaphoreTake(clients_lock, portMAX_DELAY);
        client = find_fd_locked(fd);
        bool authenticated = client && client->authenticated;
        if (authenticated) profile = client->profile;
        xSemaphoreGive(clients_lock);
        if (!authenticated) {
            send_authentication_error(
                fd, id, "profile_required",
                "Complete the player handshake before sending messages.");
            err = ESP_OK;
        } else if (strcmp(type->valuestring, PA_TYPE_CHAT_SEND) == 0) {
            cJSON *text = cJSON_GetObjectItemCaseSensitive(payload, "text");
            cJSON *message = NULL;
            chat_result_t result =
                cJSON_IsString(text)
                    ? chat_send(&profile, text->valuestring, &message)
                    : CHAT_RESULT_INVALID_TEXT;
            if (result == CHAT_RESULT_OK) {
                cJSON *event = cJSON_CreateObject();
                cJSON_AddItemToObject(event, "message", message);
                broadcast(PA_TYPE_CHAT_MESSAGE, event);
                err = ESP_OK;
            } else {
                err = send_feature_error(
                    fd, id, PA_TYPE_ERROR_CHAT, chat_result_code(result),
                    chat_result_message(result));
            }
        } else if (strcmp(type->valuestring, PA_TYPE_GAME_TTT_JOIN) == 0) {
            tic_tac_toe_result_t result = tic_tac_toe_join(&profile);
            if (result == TIC_TAC_TOE_OK) {
                broadcast_game_state();
                err = ESP_OK;
            } else {
                err = send_feature_error(
                    fd, id, PA_TYPE_ERROR_GAME,
                    tic_tac_toe_result_code(result),
                    tic_tac_toe_result_message(result));
            }
        } else if (strcmp(type->valuestring, PA_TYPE_GAME_TTT_MOVE) == 0) {
            cJSON *cell = cJSON_GetObjectItemCaseSensitive(payload, "cell");
            tic_tac_toe_result_t result =
                cJSON_IsNumber(cell) && cell->valuedouble == cell->valueint
                    ? tic_tac_toe_move(profile.id, cell->valueint)
                    : TIC_TAC_TOE_INVALID_MOVE;
            if (result == TIC_TAC_TOE_OK) {
                broadcast_game_state();
                err = ESP_OK;
            } else {
                err = send_feature_error(
                    fd, id, PA_TYPE_ERROR_GAME,
                    tic_tac_toe_result_code(result),
                    tic_tac_toe_result_message(result));
            }
        } else if (strcmp(type->valuestring, PA_TYPE_GAME_TTT_LEAVE) == 0) {
            tic_tac_toe_result_t result = tic_tac_toe_leave(profile.id);
            if (result == TIC_TAC_TOE_OK) {
                broadcast_game_state();
                err = ESP_OK;
            } else {
                err = send_feature_error(
                    fd, id, PA_TYPE_ERROR_GAME,
                    tic_tac_toe_result_code(result),
                    tic_tac_toe_result_message(result));
            }
        } else if (strcmp(type->valuestring, PA_TYPE_GAME_TTT_RESET) == 0) {
            tic_tac_toe_result_t result = tic_tac_toe_reset(profile.id);
            if (result == TIC_TAC_TOE_OK) {
                broadcast_game_state();
                err = ESP_OK;
            } else {
                err = send_feature_error(
                    fd, id, PA_TYPE_ERROR_GAME,
                    tic_tac_toe_result_code(result),
                    tic_tac_toe_result_message(result));
            }
        } else {
            err = send_feature_error(
                fd, id, PA_TYPE_ERROR_PROTOCOL, "unsupported_message",
                "This message type is not supported.");
        }
    }
    cJSON_Delete(root);
    return err;
}

esp_err_t websocket_register(httpd_handle_t server)
{
    ws_server = server;
    clients_lock = xSemaphoreCreateMutex();
    if (!clients_lock) return ESP_ERR_NO_MEM;
    httpd_uri_t uri = {
        .uri = "/ws",
        .method = HTTP_GET,
        .handler = websocket_handler,
        .is_websocket = true,
        .handle_ws_control_frames = true,
    };
    return httpd_register_uri_handler(server, &uri);
}

void websocket_socket_closed(int socket_fd)
{
    if (!clients_lock) return;
    char profile_id[PA_PROFILE_ID_LEN + 1] = {0};
    char connection_id[PA_CONNECTION_ID_LEN + 1] = {0};
    xSemaphoreTake(clients_lock, portMAX_DELAY);
    ws_client_t *client = find_fd_locked(socket_fd);
    if (client) {
        if (client->authenticated) {
            strlcpy(profile_id, client->profile.id, sizeof(profile_id));
        }
        strlcpy(connection_id, client->connection_id, sizeof(connection_id));
        memset(client, 0, sizeof(*client));
    }
    xSemaphoreGive(clients_lock);
    if (profile_id[0]) presence_connection_closed(profile_id);
    if (connection_id[0]) {
        ESP_LOGI(TAG, "WebSocket %.18s closed", connection_id);
    }
}

void websocket_revoke_profile(const char *profile_id)
{
    int fds[CONFIG_PA_WS_MAX_CONNECTIONS];
    size_t count = 0;
    xSemaphoreTake(clients_lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
        if (clients[i].used && clients[i].authenticated &&
            strcmp(clients[i].profile.id, profile_id) == 0) {
            fds[count++] = clients[i].fd;
        }
    }
    xSemaphoreGive(clients_lock);
    for (size_t i = 0; i < count; ++i) {
        httpd_sess_trigger_close(ws_server, fds[i]);
    }
}

void websocket_bind_presence_events(void)
{
    presence_set_event_callback(on_presence_event);
}

void websocket_bind_storage_events(void)
{
    storage_set_event_callback(on_storage_event);
}
