#include "http_api.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "app_catalogue.h"
#include "cJSON.h"
#include "esp_log.h"
#include "mbedtls/base64.h"
#include "pa_board.h"
#include "presence.h"
#include "profiles.h"
#include "storage.h"
#include "system_state.h"
#include "websocket.h"
#include "wifi_ap.h"

static const char *TAG = "HTTP";

static void close_socket(httpd_handle_t server, int fd)
{
    (void)server;
    websocket_socket_closed(fd);
    close(fd);
}

static esp_err_t send_json(httpd_req_t *request, const char *status,
                           cJSON *json)
{
    char *text = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!text) return ESP_ERR_NO_MEM;
    httpd_resp_set_status(request, status);
    httpd_resp_set_type(request, "application/json; charset=utf-8");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    esp_err_t err = httpd_resp_send(request, text, HTTPD_RESP_USE_STRLEN);
    cJSON_free(text);
    return err;
}

static esp_err_t send_error(httpd_req_t *request, const char *status,
                            const char *code, const char *message)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", false);
    cJSON *error = cJSON_AddObjectToObject(root, "error");
    cJSON_AddStringToObject(error, "code", code);
    cJSON_AddStringToObject(error, "message", message);
    return send_json(request, status, root);
}

static cJSON *read_body_limit(httpd_req_t *request, size_t maximum)
{
    if (request->content_len <= 0 ||
        (size_t)request->content_len > maximum) {
        return NULL;
    }
    char *buffer = malloc((size_t)request->content_len + 1);
    if (!buffer) return NULL;
    size_t received = 0;
    while (received < (size_t)request->content_len) {
        int result = httpd_req_recv(
            request, buffer + received,
            (size_t)request->content_len - received);
        if (result <= 0) {
            free(buffer);
            return NULL;
        }
        received += (size_t)result;
    }
    buffer[received] = '\0';
    cJSON *json = cJSON_ParseWithLength(buffer, received);
    free(buffer);
    return json;
}

static cJSON *read_body(httpd_req_t *request)
{
    return read_body_limit(request, CONFIG_PA_HTTP_MAX_BODY);
}

static bool request_token(httpd_req_t *request,
                          char token[PA_SESSION_TOKEN_HEX_LEN + 1])
{
    size_t length = httpd_req_get_hdr_value_len(
        request, "X-PocketArcade-Token");
    if (length != PA_SESSION_TOKEN_HEX_LEN) return false;
    return httpd_req_get_hdr_value_str(
               request, "X-PocketArcade-Token", token,
               PA_SESSION_TOKEN_HEX_LEN + 1) == ESP_OK;
}

static bool request_has_admin_session(httpd_req_t *request)
{
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    if (!request_token(request, token)) return false;
    bool admin = profile_token_is_admin(token);
    memset(token, 0, sizeof(token));
    return admin;
}

static const char *status_for_result(profile_result_t result)
{
    switch (result) {
        case PROFILE_RESULT_INVALID_TOKEN: return "401 Unauthorized";
        case PROFILE_RESULT_NOT_FOUND: return "404 Not Found";
        case PROFILE_RESULT_DEVICE_CONFLICT:
        case PROFILE_RESULT_AMBIGUOUS: return "409 Conflict";
        case PROFILE_RESULT_RATE_LIMITED: return "429 Too Many Requests";
        case PROFILE_RESULT_LIMIT: return "507 Insufficient Storage";
        case PROFILE_RESULT_STORAGE_ERROR: return "503 Service Unavailable";
        default: return "400 Bad Request";
    }
}

static esp_err_t send_profile_result_error(httpd_req_t *request,
                                           profile_result_t result)
{
    return send_error(request, status_for_result(result),
                      profile_result_code(result),
                      profile_result_message(result));
}

static cJSON *profile_success(const public_profile_t *profile,
                              const char *token, const char *restored_by)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    if (restored_by) {
        cJSON_AddStringToObject(root, "restoredBy", restored_by);
    }
    cJSON_AddItemToObject(root, "profile", profile_public_json(profile));
    if (token) cJSON_AddStringToObject(root, "sessionToken", token);
    return root;
}

static const char *request_fingerprint(httpd_req_t *request,
                                       char fingerprint[
                                           PA_FINGERPRINT_HEX_LEN + 1])
{
    int fd = httpd_req_to_sockfd(request);
    return wifi_ap_fingerprint_for_socket(fd, fingerprint) == ESP_OK
               ? fingerprint : NULL;
}

static esp_err_t health_handler(httpd_req_t *request)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddStringToObject(root, "device", PA_PRODUCT_NAME);
    cJSON_AddStringToObject(root, "firmwareVersion", PA_FIRMWARE_VERSION);
    cJSON_AddNumberToObject(root, "protocolVersion", PA_PROTOCOL_VERSION);
    cJSON_AddNumberToObject(root, "uptimeMs", (double)system_uptime_ms());
    cJSON_AddBoolToObject(root, "sdMounted", storage_is_mounted());
    cJSON_AddNumberToObject(root, "connectedPlayers",
                            (double)presence_online_count());
    cJSON_AddNumberToObject(root, "wifiClients",
                            (double)wifi_ap_station_count());
    return send_json(request, "200 OK", root);
}

static esp_err_t storage_handler(httpd_req_t *request)
{
    storage_info_t info;
    storage_get_info(&info);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddBoolToObject(root, "mounted", info.mounted);
    cJSON_AddStringToObject(root, "interface", info.interface_name);
    cJSON_AddStringToObject(root, "cardType", info.card_type);
    cJSON_AddNumberToObject(root, "capacityBytes",
                            (double)info.capacity_bytes);
    cJSON_AddNumberToObject(root, "freeBytes", (double)info.free_bytes);
    cJSON_AddBoolToObject(root, "persistentProfilesAvailable",
                          info.persistent_profiles_available);
    cJSON_AddBoolToObject(root, "safeToRemove", info.safe_to_remove);
    return send_json(request, "200 OK", root);
}

static esp_err_t storage_eject_handler(httpd_req_t *request)
{
    if (!request_has_admin_session(request)) {
        return send_error(request, "403 Forbidden", "admin_required",
                          "An administrator profile is required.");
    }
    if (storage_request_eject() != ESP_OK) {
        return send_error(request, "409 Conflict", "storage_not_mounted",
                          "The SD card is not currently mounted.");
    }
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddBoolToObject(root, "ejecting", true);
    return send_json(request, "202 Accepted", root);
}

static esp_err_t storage_mount_handler(httpd_req_t *request)
{
    if (!request_has_admin_session(request)) {
        return send_error(request, "403 Forbidden", "admin_required",
                          "An administrator profile is required.");
    }
    if (storage_request_mount() != ESP_OK) {
        return send_error(request, "409 Conflict", "storage_already_mounted",
                          "The SD card is already mounted.");
    }
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddBoolToObject(root, "mounting", true);
    return send_json(request, "202 Accepted", root);
}

static esp_err_t create_profile_handler(httpd_req_t *request)
{
    cJSON *body = read_body(request);
    cJSON *nickname = cJSON_GetObjectItemCaseSensitive(body, "nickname");
    cJSON *replace = cJSON_GetObjectItemCaseSensitive(
        body, "replaceDeviceBinding");
    if (!body || !cJSON_IsString(nickname) || !nickname->valuestring ||
        strlen(nickname->valuestring) > CONFIG_PA_MAX_NICKNAME_BYTES) {
        cJSON_Delete(body);
        return send_error(request, "400 Bad Request", "invalid_request",
                          "A bounded string nickname is required.");
    }
    char nickname_copy[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    strlcpy(nickname_copy, nickname->valuestring, sizeof(nickname_copy));
    bool replace_binding = cJSON_IsTrue(replace);
    cJSON_Delete(body);
    char fingerprint[PA_FINGERPRINT_HEX_LEN + 1] = {0};
    const char *fingerprint_ptr = request_fingerprint(request, fingerprint);
    public_profile_t profile;
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    profile_result_t result = profile_create(
        nickname_copy, fingerprint_ptr, replace_binding, &profile, token);
    memset(fingerprint, 0, sizeof(fingerprint));
    if (result != PROFILE_RESULT_OK) {
        return send_profile_result_error(request, result);
    }
    return send_json(request, "201 Created",
                     profile_success(&profile, token, NULL));
}

static esp_err_t restore_profile_handler(httpd_req_t *request)
{
    cJSON *body = read_body(request);
    cJSON *token_json = cJSON_GetObjectItemCaseSensitive(
        body, "sessionToken");
    if (!body || !cJSON_IsString(token_json) ||
        strlen(token_json->valuestring) != PA_SESSION_TOKEN_HEX_LEN) {
        cJSON_Delete(body);
        return send_error(request, "400 Bad Request", "invalid_request",
                          "A valid sessionToken string is required.");
    }
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    strlcpy(token, token_json->valuestring, sizeof(token));
    cJSON_Delete(body);
    char fingerprint[PA_FINGERPRINT_HEX_LEN + 1] = {0};
    const char *fingerprint_ptr = request_fingerprint(request, fingerprint);
    public_profile_t profile;
    profile_result_t result = profile_restore_token(
        token, fingerprint_ptr, &profile);
    memset(token, 0, sizeof(token));
    memset(fingerprint, 0, sizeof(fingerprint));
    if (result != PROFILE_RESULT_OK) {
        return send_profile_result_error(request, result);
    }
    return send_json(request, "200 OK",
                     profile_success(&profile, NULL, "token"));
}

static esp_err_t device_restore_handler(httpd_req_t *request)
{
    char fingerprint[PA_FINGERPRINT_HEX_LEN + 1] = {0};
    if (!request_fingerprint(request, fingerprint)) {
        return send_error(
            request, "404 Not Found", "device_identity_unavailable",
            "The access point cannot currently correlate this request with a station.");
    }
    public_profile_t profile;
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    profile_result_t result = profile_restore_device(
        fingerprint, &profile, token);
    memset(fingerprint, 0, sizeof(fingerprint));
    if (result != PROFILE_RESULT_OK) {
        return send_profile_result_error(request, result);
    }
    return send_json(request, "200 OK",
                     profile_success(&profile, token, "device"));
}

static esp_err_t update_profile_handler(httpd_req_t *request)
{
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    if (!request_token(request, token)) {
        return send_error(request, "401 Unauthorized", "token_required",
                          "X-PocketArcade-Token is required.");
    }
    cJSON *body = read_body(request);
    cJSON *nickname = cJSON_GetObjectItemCaseSensitive(body, "nickname");
    if (!body || !cJSON_IsString(nickname) ||
        strlen(nickname->valuestring) > CONFIG_PA_MAX_NICKNAME_BYTES) {
        cJSON_Delete(body);
        memset(token, 0, sizeof(token));
        return send_error(request, "400 Bad Request", "invalid_request",
                          "A bounded string nickname is required.");
    }
    char nickname_copy[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    strlcpy(nickname_copy, nickname->valuestring, sizeof(nickname_copy));
    cJSON_Delete(body);
    public_profile_t profile;
    profile_result_t result = profile_update_nickname(
        token, nickname_copy, &profile);
    memset(token, 0, sizeof(token));
    if (result != PROFILE_RESULT_OK) {
        return send_profile_result_error(request, result);
    }
    return send_json(request, "200 OK",
                     profile_success(&profile, NULL, NULL));
}

static bool valid_base64(const char *value, size_t length)
{
    if (!value || length == 0 || (length % 4) != 0) return false;
    size_t padding = 0;
    if (length && value[length - 1] == '=') ++padding;
    if (length > 1 && value[length - 2] == '=') ++padding;
    for (size_t i = 0; i < length; ++i) {
        char c = value[i];
        bool alpha_numeric =
            (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9');
        if (alpha_numeric || c == '+' || c == '/') continue;
        if (c == '=' && i >= length - padding) continue;
        return false;
    }
    return true;
}

static esp_err_t avatar_upload_handler(httpd_req_t *request)
{
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    if (!request_token(request, token)) {
        return send_error(request, "401 Unauthorized", "token_required",
                          "X-PocketArcade-Token is required.");
    }
    if (!storage_is_mounted()) {
        memset(token, 0, sizeof(token));
        return send_error(
            request, "503 Service Unavailable", "storage_unavailable",
            "An SD card is required to save a profile photo.");
    }

    const size_t encoded_limit =
        ((CONFIG_PA_AVATAR_MAX_BYTES + 2U) / 3U) * 4U;
    cJSON *body = read_body_limit(request, encoded_limit + 96U);
    cJSON *image = body
        ? cJSON_GetObjectItemCaseSensitive(body, "imageBase64") : NULL;
    size_t encoded_length =
        cJSON_IsString(image) && image->valuestring
            ? strlen(image->valuestring) : 0;
    if (!body || !cJSON_IsString(image) ||
        encoded_length > encoded_limit ||
        !valid_base64(image->valuestring, encoded_length)) {
        cJSON_Delete(body);
        memset(token, 0, sizeof(token));
        return send_error(
            request, "400 Bad Request", "invalid_avatar",
            "A bounded base64-encoded JPEG is required.");
    }

    public_profile_t current;
    profile_result_t auth_result =
        profile_restore_token(token, NULL, &current);
    if (auth_result != PROFILE_RESULT_OK) {
        cJSON_Delete(body);
        memset(token, 0, sizeof(token));
        return send_profile_result_error(request, auth_result);
    }

    unsigned char *decoded = malloc(CONFIG_PA_AVATAR_MAX_BYTES);
    if (!decoded) {
        cJSON_Delete(body);
        memset(token, 0, sizeof(token));
        return send_error(request, "503 Service Unavailable",
                          "resource_unavailable",
                          "Not enough memory to process the profile photo.");
    }
    size_t decoded_length = 0;
    int decode_result = mbedtls_base64_decode(
        decoded, CONFIG_PA_AVATAR_MAX_BYTES, &decoded_length,
        (const unsigned char *)image->valuestring, encoded_length);
    cJSON_Delete(body);
    bool jpeg = decode_result == 0 && decoded_length >= 8 &&
                decoded[0] == 0xff && decoded[1] == 0xd8 &&
                decoded[2] == 0xff &&
                decoded[decoded_length - 2] == 0xff &&
                decoded[decoded_length - 1] == 0xd9;
    if (!jpeg) {
        free(decoded);
        memset(token, 0, sizeof(token));
        return send_error(request, "400 Bad Request", "invalid_avatar",
                          "The processed profile photo is not a valid JPEG.");
    }

    char path[96];
    snprintf(path, sizeof(path), "data/avatars/%s.jpg", current.id);
    esp_err_t storage_result = storage_enqueue_atomic_write_owned(
        path, (char *)decoded, decoded_length);
    if (storage_result != ESP_OK) {
        free(decoded);
        memset(token, 0, sizeof(token));
        return send_error(request, "503 Service Unavailable",
                          "storage_unavailable",
                          "The profile photo could not be queued for storage.");
    }

    public_profile_t updated;
    profile_result_t update_result = profile_set_avatar(token, &updated);
    memset(token, 0, sizeof(token));
    if (update_result != PROFILE_RESULT_OK) {
        return send_profile_result_error(request, update_result);
    }
    ESP_LOGI(TAG, "Accepted %u-byte profile photo for %.18s",
             (unsigned)decoded_length, updated.id);
    return send_json(request, "200 OK",
                     profile_success(&updated, NULL, NULL));
}

static bool valid_avatar_profile_id(const char *value, size_t length)
{
    if (length != PA_PROFILE_ID_LEN || value[0] != 'p' ||
        value[1] != '_') {
        return false;
    }
    for (size_t i = 2; i < length; ++i) {
        char c = value[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
            return false;
        }
    }
    return true;
}

static esp_err_t avatar_get_handler(httpd_req_t *request)
{
    static const char prefix[] = "/api/v1/avatars/";
    const char *name = request->uri + strlen(prefix);
    size_t name_length = strcspn(name, "?");
    if (name_length != PA_PROFILE_ID_LEN + 4 ||
        memcmp(name + PA_PROFILE_ID_LEN, ".jpg", 4) != 0 ||
        !valid_avatar_profile_id(name, PA_PROFILE_ID_LEN)) {
        return httpd_resp_send_404(request);
    }

    char path[128];
    snprintf(path, sizeof(path), PA_SD_MOUNT_POINT
             "/data/avatars/%.*s.jpg", PA_PROFILE_ID_LEN, name);
    storage_filesystem_lock();
    FILE *file = storage_is_mounted() ? fopen(path, "rb") : NULL;
    if (!file || fseek(file, 0, SEEK_END) != 0) {
        if (file) fclose(file);
        storage_filesystem_unlock();
        return httpd_resp_send_404(request);
    }
    long file_size = ftell(file);
    if (file_size <= 0 || file_size > CONFIG_PA_AVATAR_MAX_BYTES ||
        fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        storage_filesystem_unlock();
        return httpd_resp_send_404(request);
    }
    unsigned char *data = malloc((size_t)file_size);
    bool read_ok = data &&
        fread(data, 1, (size_t)file_size, file) == (size_t)file_size;
    fclose(file);
    storage_filesystem_unlock();
    if (!read_ok) {
        free(data);
        return httpd_resp_send_500(request);
    }
    httpd_resp_set_type(request, "image/jpeg");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    esp_err_t result =
        httpd_resp_send(request, (const char *)data, file_size);
    free(data);
    return result;
}

static esp_err_t unbind_handler(httpd_req_t *request)
{
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    if (!request_token(request, token)) {
        return send_error(request, "401 Unauthorized", "token_required",
                          "X-PocketArcade-Token is required.");
    }
    char fingerprint[PA_FINGERPRINT_HEX_LEN + 1] = {0};
    if (!request_fingerprint(request, fingerprint)) {
        memset(token, 0, sizeof(token));
        return send_error(request, "409 Conflict",
                          "device_identity_unavailable",
                          "The current Wi-Fi device binding cannot be identified.");
    }
    profile_result_t result = profile_unbind_device(token, fingerprint);
    memset(token, 0, sizeof(token));
    memset(fingerprint, 0, sizeof(fingerprint));
    if (result != PROFILE_RESULT_OK) {
        return send_profile_result_error(request, result);
    }
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    return send_json(request, "200 OK", root);
}

static esp_err_t delete_profile_handler(httpd_req_t *request)
{
    char token[PA_SESSION_TOKEN_HEX_LEN + 1];
    if (!request_token(request, token)) {
        return send_error(request, "401 Unauthorized", "token_required",
                          "X-PocketArcade-Token is required.");
    }
    public_profile_t deleted;
    profile_result_t result = profile_delete(token, &deleted);
    memset(token, 0, sizeof(token));
    if (result != PROFILE_RESULT_OK) {
        return send_profile_result_error(request, result);
    }
    websocket_revoke_profile(deleted.id);
    presence_profile_deleted(deleted.id);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    return send_json(request, "200 OK", root);
}

static esp_err_t players_handler(httpd_req_t *request)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddItemToObject(root, "players", presence_snapshot_json());
    return send_json(request, "200 OK", root);
}

static esp_err_t apps_handler(httpd_req_t *request)
{
    return send_json(request, "200 OK", app_catalogue_response());
}

esp_err_t http_api_start(httpd_handle_t *server)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_open_sockets = CONFIG_PA_HTTP_MAX_OPEN_SOCKETS;
    config.max_uri_handlers = CONFIG_PA_HTTP_MAX_URI_HANDLERS;
    config.lru_purge_enable = true;
    config.uri_match_fn = httpd_uri_match_wildcard;
    config.close_fn = close_socket;
    esp_err_t err = httpd_start(server, &config);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "HTTP server started on port %u",
                 (unsigned)config.server_port);
    }
    return err;
}

esp_err_t http_api_register_routes(httpd_handle_t server)
{
    static const httpd_uri_t routes[] = {
        { .uri = "/api/v1/health", .method = HTTP_GET,
          .handler = health_handler },
        { .uri = "/api/v1/storage", .method = HTTP_GET,
          .handler = storage_handler },
        { .uri = "/api/v1/storage/eject", .method = HTTP_POST,
          .handler = storage_eject_handler },
        { .uri = "/api/v1/storage/mount", .method = HTTP_POST,
          .handler = storage_mount_handler },
        { .uri = "/api/v1/profile", .method = HTTP_POST,
          .handler = create_profile_handler },
        { .uri = "/api/v1/profile/restore", .method = HTTP_POST,
          .handler = restore_profile_handler },
        { .uri = "/api/v1/profile/device-restore", .method = HTTP_POST,
          .handler = device_restore_handler },
        { .uri = "/api/v1/profile", .method = HTTP_PATCH,
          .handler = update_profile_handler },
        { .uri = "/api/v1/profile/avatar", .method = HTTP_POST,
          .handler = avatar_upload_handler },
        { .uri = "/api/v1/avatars/*", .method = HTTP_GET,
          .handler = avatar_get_handler },
        { .uri = "/api/v1/profile/unbind-device", .method = HTTP_POST,
          .handler = unbind_handler },
        { .uri = "/api/v1/profile", .method = HTTP_DELETE,
          .handler = delete_profile_handler },
        { .uri = "/api/v1/players", .method = HTTP_GET,
          .handler = players_handler },
        { .uri = "/api/v1/apps", .method = HTTP_GET,
          .handler = apps_handler },
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); ++i) {
        esp_err_t err = httpd_register_uri_handler(server, &routes[i]);
        if (err != ESP_OK) return err;
    }
    return ESP_OK;
}
