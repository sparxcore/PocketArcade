#include "app_catalogue.h"

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>

#include "builtin_apps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "pa_board.h"
#include "storage.h"

static const char *TAG = "APPS";
#define MAX_APPS 12
#define MAX_MANIFEST_BYTES 4096

static app_descriptor_t apps[MAX_APPS];
static size_t app_count;
static SemaphoreHandle_t apps_lock;

typedef enum {
    MANIFEST_OK,
    MANIFEST_INVALID_DIRECTORY,
    MANIFEST_NOT_FOUND,
    MANIFEST_IO_ERROR,
    MANIFEST_TOO_LARGE,
    MANIFEST_INVALID_JSON,
    MANIFEST_INVALID_VERSION,
    MANIFEST_INVALID_ID,
    MANIFEST_DIRECTORY_ID_MISMATCH,
    MANIFEST_INVALID_NAME,
    MANIFEST_INVALID_ENTRYPOINT,
    MANIFEST_INVALID_DESCRIPTION,
    MANIFEST_INVALID_STYLESHEET,
    MANIFEST_INVALID_KIND,
    MANIFEST_PLATFORM_TOO_OLD,
    MANIFEST_INVALID_RUNTIME,
    MANIFEST_INVALID_MULTIPLAYER,
    MANIFEST_INVALID_PROTOCOL,
    MANIFEST_INVALID_CAPABILITY,
    MANIFEST_SCRIPT_TOO_LARGE
} manifest_result_t;

static const char *manifest_result_name(manifest_result_t result)
{
    switch (result) {
        case MANIFEST_INVALID_DIRECTORY: return "invalid directory name";
        case MANIFEST_NOT_FOUND: return "manifest.json not found";
        case MANIFEST_IO_ERROR: return "manifest read failed";
        case MANIFEST_TOO_LARGE: return "manifest size is invalid";
        case MANIFEST_INVALID_JSON: return "manifest JSON is invalid";
        case MANIFEST_INVALID_VERSION:
            return "manifestVersion must be 1 or 2";
        case MANIFEST_INVALID_ID: return "application id is invalid";
        case MANIFEST_DIRECTORY_ID_MISMATCH: return "directory and id differ";
        case MANIFEST_INVALID_NAME: return "name must be a bounded string";
        case MANIFEST_INVALID_ENTRYPOINT:
            return "entrypoint must be a safe relative path";
        case MANIFEST_INVALID_DESCRIPTION:
            return "description must be a bounded string or null";
        case MANIFEST_INVALID_STYLESHEET:
            return "stylesheet must be a safe relative path or null";
        case MANIFEST_INVALID_KIND:
            return "kind must be a bounded string or null";
        case MANIFEST_PLATFORM_TOO_OLD:
            return "minPlatformVersion is newer than this firmware";
        case MANIFEST_INVALID_RUNTIME:
            return "runtime metadata is invalid or unsupported";
        case MANIFEST_INVALID_MULTIPLAYER:
            return "multiplayer metadata is invalid";
        case MANIFEST_INVALID_PROTOCOL:
            return "application protocol version is unsupported";
        case MANIFEST_INVALID_CAPABILITY:
            return "a requested capability is unsupported";
        case MANIFEST_SCRIPT_TOO_LARGE:
            return "runtime script exceeds the firmware limit";
        default: return "valid";
    }
}

static bool normalise_directory_id(const char *directory_name,
                                   char output[49])
{
    size_t length = directory_name ? strlen(directory_name) : 0;
    if (length == 0 || length > 48) return false;
    for (size_t i = 0; i < length; ++i) {
        char c = directory_name[i];
        if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
        if (!((c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '-')) {
            return false;
        }
        output[i] = c;
    }
    output[length] = '\0';
    return true;
}

static bool json_string(cJSON *root, const char *key, char *output,
                        size_t output_size, bool required)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if ((!item || cJSON_IsNull(item)) && !required) {
        output[0] = '\0';
        return true;
    }
    if (!cJSON_IsString(item) || !item->valuestring ||
        strlen(item->valuestring) >= output_size) return false;
    strlcpy(output, item->valuestring, output_size);
    return true;
}

static bool json_app_path(cJSON *root, const char *relative_key,
                          const char *url_key, const char *app_id,
                          char *output, size_t output_size, bool required)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, relative_key);
    if ((!item || cJSON_IsNull(item)) && url_key) {
        item = cJSON_GetObjectItemCaseSensitive(root, url_key);
    }
    if ((!item || cJSON_IsNull(item)) && !required) {
        output[0] = '\0';
        return true;
    }
    if (!cJSON_IsString(item) || !item->valuestring) return false;

    const char *relative = item->valuestring;
    char scoped_prefix[64];
    snprintf(scoped_prefix, sizeof(scoped_prefix), "/apps/%s/", app_id);
    size_t prefix_length = strlen(scoped_prefix);
    if (strncmp(relative, scoped_prefix, prefix_length) == 0) {
        relative += prefix_length;
    }
    if (strlen(relative) >= output_size ||
        !storage_safe_relative_path(relative)) {
        return false;
    }
    strlcpy(output, relative, output_size);
    return true;
}

static bool app_file_exists(app_source_t source, const char *directory_name,
                            const char *relative)
{
    if (source == APP_SOURCE_BUILTIN) {
        return pa_builtin_app_file_find(directory_name, relative) != NULL;
    }
    char path[256];
    snprintf(path, sizeof(path), "%s/apps/%s/%s",
             PA_SD_MOUNT_POINT, directory_name, relative);
    return access(path, R_OK) == 0;
}

static bool semantic_version(const char *text, unsigned output[3])
{
    char trailing = '\0';
    return text && sscanf(text, "%u.%u.%u%c",
                          &output[0], &output[1], &output[2],
                          &trailing) == 3;
}

static bool platform_version_supported(const char *minimum)
{
    unsigned requested[3];
    unsigned platform[3];
    if (!semantic_version(minimum, requested) ||
        !semantic_version(PA_FIRMWARE_VERSION, platform)) return false;
    for (size_t i = 0; i < 3; ++i) {
        if (requested[i] < platform[i]) return true;
        if (requested[i] > platform[i]) return false;
    }
    return true;
}

static bool json_integer(cJSON *root, const char *key, int *output)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsNumber(item) || item->valuedouble != item->valueint) {
        return false;
    }
    *output = item->valueint;
    return true;
}

static bool runtime_script_valid(app_source_t source,
                                 const char *directory_name,
                                 const char *relative)
{
    if (source == APP_SOURCE_BUILTIN) {
        const pa_builtin_app_file_t *file =
            pa_builtin_app_file_find(directory_name, relative);
        return file && !file->encoding && file->length > 0 &&
               file->length <= CONFIG_PA_GAME_MAX_SCRIPT_BYTES;
    }
    char path[256];
    snprintf(path, sizeof(path), "%s/apps/%s/%s",
             PA_SD_MOUNT_POINT, directory_name, relative);
    struct stat info;
    return stat(path, &info) == 0 && info.st_size > 0 &&
           info.st_size <= CONFIG_PA_GAME_MAX_SCRIPT_BYTES;
}

static bool parse_capabilities(cJSON *root, uint32_t *capabilities)
{
    cJSON *array = cJSON_GetObjectItemCaseSensitive(root, "capabilities");
    if (!cJSON_IsArray(array) || cJSON_GetArraySize(array) > 8) return false;
    *capabilities = 0;
    cJSON *item;
    cJSON_ArrayForEach(item, array) {
        if (!cJSON_IsString(item) || !item->valuestring) return false;
        if (strcmp(item->valuestring, "presence.read") == 0) {
            *capabilities |= APP_CAP_PRESENCE_READ;
        } else if (strcmp(item->valuestring, "match.seats") == 0) {
            *capabilities |= APP_CAP_MATCH_SEATS;
        } else if (strcmp(item->valuestring, "match.results") == 0) {
            *capabilities |= APP_CAP_MATCH_RESULTS;
        } else if (strcmp(item->valuestring, "storage.app-data") == 0) {
            *capabilities |= APP_CAP_STORAGE_APP_DATA;
        } else {
            return false;
        }
    }
    return true;
}

static manifest_result_t load_manifest(const char *directory_name,
                                       app_source_t source,
                                       app_descriptor_t *app)
{
    char normalised_id[49];
    if (!normalise_directory_id(directory_name, normalised_id)) {
        return MANIFEST_INVALID_DIRECTORY;
    }
    char bounded_directory[49];
    strlcpy(bounded_directory, directory_name, sizeof(bounded_directory));
    app->source = source;

    const pa_builtin_app_file_t *builtin_manifest = NULL;
    FILE *file = NULL;
    long length = -1;
    if (source == APP_SOURCE_BUILTIN) {
        builtin_manifest =
            pa_builtin_app_file_find(bounded_directory, "manifest.json");
        if (!builtin_manifest || builtin_manifest->encoding) {
            return MANIFEST_NOT_FOUND;
        }
        length = (long)builtin_manifest->length;
    } else {
        char path[256];
        snprintf(path, sizeof(path), "%s/apps/%s/manifest.json",
                 PA_SD_MOUNT_POINT, bounded_directory);
        file = fopen(path, "rb");
        if (!file) return errno == ENOENT ? MANIFEST_NOT_FOUND
                                         : MANIFEST_IO_ERROR;
        if (fseek(file, 0, SEEK_END) != 0) {
            fclose(file);
            return MANIFEST_IO_ERROR;
        }
        length = ftell(file);
        rewind(file);
    }
    if (length <= 0 || length > MAX_MANIFEST_BYTES) {
        if (file) fclose(file);
        return MANIFEST_TOO_LARGE;
    }
    char *buffer = malloc((size_t)length + 1);
    if (!buffer) {
        if (file) fclose(file);
        return MANIFEST_IO_ERROR;
    }
    bool read_ok = true;
    if (builtin_manifest) {
        memcpy(buffer, builtin_manifest->data, (size_t)length);
    } else {
        read_ok =
            fread(buffer, 1, (size_t)length, file) == (size_t)length;
        fclose(file);
    }
    buffer[length] = '\0';
    cJSON *root = read_ok ? cJSON_ParseWithLength(buffer, (size_t)length) : NULL;
    free(buffer);
    if (!read_ok) {
        cJSON_Delete(root);
        return MANIFEST_IO_ERROR;
    }
    if (!cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_JSON;
    }
    cJSON *version = cJSON_GetObjectItemCaseSensitive(root, "manifestVersion");
    if (!cJSON_IsNumber(version) ||
        (version->valueint != 1 && version->valueint != 2)) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_VERSION;
    }
    app->manifest_version = version->valueint;
    if (!json_string(root, "id", app->id, sizeof(app->id), true) ||
        !storage_valid_app_id(app->id)) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_ID;
    }
    if (strcmp(app->id, normalised_id) != 0) {
        cJSON_Delete(root);
        return MANIFEST_DIRECTORY_ID_MISMATCH;
    }
    if (!json_string(root, "name", app->name, sizeof(app->name), true)) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_NAME;
    }
    cJSON *client = app->manifest_version == 2
                        ? cJSON_GetObjectItemCaseSensitive(root, "client")
                        : root;
    if (!cJSON_IsObject(client) ||
        !json_app_path(client, "entrypoint",
                       app->manifest_version == 1 ? "entrypointUrl" : NULL,
                       app->id, app->entrypoint,
                       sizeof(app->entrypoint), true) ||
        !app_file_exists(source, bounded_directory, app->entrypoint)) {
        /*
         * Compatibility for the v0.1 development package that briefly used
         * a different entrypoint field. The fixed fallback is accepted only
         * when the file exists inside this already-validated app directory.
         */
        if (app->manifest_version == 1 &&
            app_file_exists(source, bounded_directory, "app.js")) {
            strlcpy(app->entrypoint, "app.js", sizeof(app->entrypoint));
            ESP_LOGW(TAG, "App %.48s uses legacy entrypoint metadata",
                     normalised_id);
        } else {
            cJSON_Delete(root);
            return MANIFEST_INVALID_ENTRYPOINT;
        }
    }
    if (!json_string(root, "description", app->description,
                     sizeof(app->description), false)) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_DESCRIPTION;
    }
    if (!json_app_path(client, "stylesheet",
                       app->manifest_version == 1 ? "stylesheetUrl" : NULL,
                       app->id,
                       app->stylesheet, sizeof(app->stylesheet), false) ||
        (app->stylesheet[0] &&
         !app_file_exists(source, bounded_directory, app->stylesheet))) {
        app->stylesheet[0] = '\0';
    }
    if (!json_string(root, "kind", app->kind, sizeof(app->kind), false)) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_KIND;
    }

    if (app->manifest_version == 1) {
        strlcpy(app->version, "0.1.0", sizeof(app->version));
        strlcpy(app->runtime_type, "native", sizeof(app->runtime_type));
        app->runtime_mode = APP_RUNTIME_EVENT;
        app->min_players = 2;
        app->max_players = 2;
        app->spectators = true;
        app->late_join = APP_LATE_JOIN_SPECTATOR;
        app->reconnect_grace_ms = CONFIG_PA_PRESENCE_GRACE_MS;
        app->protocol_version = PA_PROTOCOL_VERSION;
    } else {
        char minimum_version[PA_APP_VERSION_MAX + 1];
        if (!json_string(root, "version", app->version,
                         sizeof(app->version), true) ||
            !semantic_version(app->version, (unsigned[3]){0}) ||
            !json_string(root, "minPlatformVersion", minimum_version,
                         sizeof(minimum_version), true) ||
            !platform_version_supported(minimum_version)) {
            cJSON_Delete(root);
            return MANIFEST_PLATFORM_TOO_OLD;
        }
        cJSON *runtime =
            cJSON_GetObjectItemCaseSensitive(root, "runtime");
        char mode[9];
        int tick_rate = 0;
        if (!cJSON_IsObject(runtime) ||
            !json_string(runtime, "type", app->runtime_type,
                         sizeof(app->runtime_type), true) ||
            strcmp(app->runtime_type, "lua") != 0 ||
            !json_app_path(runtime, "entrypoint", NULL, app->id,
                           app->runtime_entrypoint,
                           sizeof(app->runtime_entrypoint), true) ||
            !runtime_script_valid(source, bounded_directory,
                                  app->runtime_entrypoint) ||
            !json_string(runtime, "mode", mode, sizeof(mode), true)) {
            cJSON_Delete(root);
            return runtime_script_valid(source, bounded_directory,
                                        app->runtime_entrypoint)
                       ? MANIFEST_INVALID_RUNTIME
                       : MANIFEST_SCRIPT_TOO_LARGE;
        }
        if (strcmp(mode, "event") == 0) {
            app->runtime_mode = APP_RUNTIME_EVENT;
            app->tick_rate_hz = 0;
        } else if (strcmp(mode, "tick") == 0 &&
                   json_integer(runtime, "tickRateHz", &tick_rate) &&
                   tick_rate > 0) {
            app->runtime_mode = APP_RUNTIME_TICK;
            app->tick_rate_hz =
                tick_rate > CONFIG_PA_GAME_MAX_TICK_RATE_HZ
                    ? CONFIG_PA_GAME_MAX_TICK_RATE_HZ
                    : (uint8_t)tick_rate;
        } else {
            cJSON_Delete(root);
            return MANIFEST_INVALID_RUNTIME;
        }

        cJSON *multiplayer =
            cJSON_GetObjectItemCaseSensitive(root, "multiplayer");
        int min_players;
        int max_players;
        int reconnect_grace;
        char late_join[17];
        cJSON *spectators =
            cJSON_GetObjectItemCaseSensitive(multiplayer, "spectators");
        if (!cJSON_IsObject(multiplayer) ||
            !json_integer(multiplayer, "minPlayers", &min_players) ||
            !json_integer(multiplayer, "maxPlayers", &max_players) ||
            !cJSON_IsBool(spectators) ||
            !json_string(multiplayer, "lateJoin", late_join,
                         sizeof(late_join), true) ||
            !json_integer(multiplayer, "reconnectGraceMs",
                          &reconnect_grace) ||
            min_players < 1 || max_players < 1 ||
            reconnect_grace < 0) {
            cJSON_Delete(root);
            return MANIFEST_INVALID_MULTIPLAYER;
        }
        app->min_players =
            min_players > CONFIG_PA_GAME_MAX_PLAYERS
                ? CONFIG_PA_GAME_MAX_PLAYERS : (uint8_t)min_players;
        app->max_players =
            max_players > CONFIG_PA_GAME_MAX_PLAYERS
                ? CONFIG_PA_GAME_MAX_PLAYERS : (uint8_t)max_players;
        if (app->min_players > app->max_players) {
            cJSON_Delete(root);
            return MANIFEST_INVALID_MULTIPLAYER;
        }
        app->spectators = cJSON_IsTrue(spectators);
        if (strcmp(late_join, "spectator") == 0) {
            app->late_join = APP_LATE_JOIN_SPECTATOR;
        } else if (strcmp(late_join, "reject") == 0) {
            app->late_join = APP_LATE_JOIN_REJECT;
        } else {
            cJSON_Delete(root);
            return MANIFEST_INVALID_MULTIPLAYER;
        }
        app->reconnect_grace_ms =
            reconnect_grace > 60000 ? 60000 : (uint32_t)reconnect_grace;

        cJSON *protocol =
            cJSON_GetObjectItemCaseSensitive(root, "protocol");
        int protocol_version;
        if (!cJSON_IsObject(protocol) ||
            !json_integer(protocol, "version", &protocol_version) ||
            protocol_version != PA_PROTOCOL_VERSION) {
            cJSON_Delete(root);
            return MANIFEST_INVALID_PROTOCOL;
        }
        app->protocol_version = (uint8_t)protocol_version;
        if (!parse_capabilities(root, &app->capabilities)) {
            cJSON_Delete(root);
            return MANIFEST_INVALID_CAPABILITY;
        }
    }
    cJSON_Delete(root);
    app->used = true;
    return MANIFEST_OK;
}

static bool descriptor_id_exists(const app_descriptor_t *descriptors,
                                 size_t count, const char *id)
{
    for (size_t i = 0; i < count; ++i) {
        if (strcmp(descriptors[i].id, id) == 0) return true;
    }
    return false;
}

static void scan_catalogue(void)
{
    app_descriptor_t *found = calloc(MAX_APPS, sizeof(*found));
    if (!found) {
        ESP_LOGE(TAG, "No memory for application catalogue scan");
        return;
    }
    size_t found_count = 0;
    for (size_t i = 0;
         i < pa_builtin_app_count() && found_count < MAX_APPS; ++i) {
        const char *id = pa_builtin_app_id(i);
        app_descriptor_t candidate = {0};
        manifest_result_t result =
            load_manifest(id, APP_SOURCE_BUILTIN, &candidate);
        if (result == MANIFEST_OK) {
            found[found_count++] = candidate;
        } else {
            ESP_LOGE(TAG, "Ignored built-in app %.48s: %s", id,
                     manifest_result_name(result));
        }
    }

    storage_filesystem_lock();
    if (storage_is_mounted()) {
        DIR *directory = opendir(PA_SD_MOUNT_POINT "/apps");
        if (directory) {
            struct dirent *entry;
            while (found_count < MAX_APPS &&
                   (entry = readdir(directory)) != NULL) {
                if (entry->d_name[0] == '.') continue;
                app_descriptor_t candidate = {0};
                manifest_result_t result =
                    load_manifest(entry->d_name, APP_SOURCE_SD, &candidate);
                if (result == MANIFEST_OK &&
                    !descriptor_id_exists(found, found_count, candidate.id)) {
                    found[found_count++] = candidate;
                } else if (result == MANIFEST_OK) {
                    ESP_LOGW(TAG,
                             "Ignored SD app %.48s: built-in app takes precedence",
                             entry->d_name);
                } else {
                    ESP_LOGW(TAG, "Ignored app entry %.48s: %s",
                             entry->d_name, manifest_result_name(result));
                }
            }
            closedir(directory);
        }
    }
    storage_filesystem_unlock();
    xSemaphoreTake(apps_lock, portMAX_DELAY);
    memset(apps, 0, sizeof(apps));
    memcpy(apps, found, found_count * sizeof(*found));
    app_count = found_count;
    xSemaphoreGive(apps_lock);
    free(found);
    ESP_LOGI(TAG, "Application catalogue cached (%u installed)",
             (unsigned)found_count);
}

static void on_storage_event(storage_event_t event,
                             const storage_info_t *info)
{
    (void)info;
    (void)event;
    scan_catalogue();
}

esp_err_t app_catalogue_init(void)
{
    apps_lock = xSemaphoreCreateMutex();
    if (!apps_lock) return ESP_ERR_NO_MEM;
    storage_set_event_callback(on_storage_event);
    scan_catalogue();
    return ESP_OK;
}

cJSON *app_catalogue_response(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "ok", true);
    cJSON_AddBoolToObject(root, "storageAvailable", storage_is_mounted());
    cJSON *array = cJSON_AddArrayToObject(root, "apps");
    xSemaphoreTake(apps_lock, portMAX_DELAY);
    for (size_t i = 0; i < app_count; ++i) {
        const app_descriptor_t *app = &apps[i];
        cJSON *json = cJSON_CreateObject();
        cJSON_AddStringToObject(json, "id", app->id);
        cJSON_AddStringToObject(json, "name", app->name);
        cJSON_AddStringToObject(json, "description", app->description);
        cJSON_AddStringToObject(json, "kind",
                                app->kind[0] ? app->kind : "application");
        cJSON_AddBoolToObject(json, "builtIn",
                              app->source == APP_SOURCE_BUILTIN);
        cJSON_AddNumberToObject(json, "manifestVersion",
                                app->manifest_version);
        cJSON_AddStringToObject(json, "version", app->version);
        char url[180];
        snprintf(url, sizeof(url), "/apps/%s/%s", app->id, app->entrypoint);
        cJSON_AddStringToObject(json, "entrypointUrl", url);
        if (app->stylesheet[0]) {
            snprintf(url, sizeof(url), "/apps/%s/%s",
                     app->id, app->stylesheet);
            cJSON_AddStringToObject(json, "stylesheetUrl", url);
        } else {
            cJSON_AddNullToObject(json, "stylesheetUrl");
        }
        snprintf(url, sizeof(url), "/apps/%s/assets/icon.svg", app->id);
        cJSON_AddStringToObject(json, "iconUrl", url);
        if (app->manifest_version == 2) {
            cJSON *runtime = cJSON_AddObjectToObject(json, "runtime");
            cJSON_AddStringToObject(runtime, "type", app->runtime_type);
            cJSON_AddStringToObject(
                runtime, "mode",
                app->runtime_mode == APP_RUNTIME_TICK ? "tick" : "event");
            cJSON_AddNumberToObject(runtime, "tickRateHz",
                                    app->tick_rate_hz);
            cJSON_AddNumberToObject(
                runtime, "snapshotRateHz",
                app->runtime_mode == APP_RUNTIME_TICK
                    ? (app->tick_rate_hz <
                               CONFIG_PA_GAME_MAX_SNAPSHOT_RATE_HZ
                           ? app->tick_rate_hz
                           : CONFIG_PA_GAME_MAX_SNAPSHOT_RATE_HZ)
                    : 0);
            cJSON *multiplayer =
                cJSON_AddObjectToObject(json, "multiplayer");
            cJSON_AddNumberToObject(multiplayer, "minPlayers",
                                    app->min_players);
            cJSON_AddNumberToObject(multiplayer, "maxPlayers",
                                    app->max_players);
            cJSON_AddBoolToObject(multiplayer, "spectators",
                                  app->spectators);
            cJSON_AddStringToObject(
                multiplayer, "lateJoin",
                app->late_join == APP_LATE_JOIN_SPECTATOR
                    ? "spectator" : "reject");
            cJSON *limits =
                cJSON_AddObjectToObject(json, "resourceLimits");
            cJSON_AddNumberToObject(limits, "runtimeMemoryBytes",
                                    CONFIG_PA_GAME_RUNTIME_MEMORY_BYTES);
            cJSON_AddNumberToObject(limits, "commandBytes",
                                    CONFIG_PA_GAME_MAX_COMMAND_BYTES);
            cJSON_AddNumberToObject(limits, "snapshotBytes",
                                    CONFIG_PA_GAME_MAX_SNAPSHOT_BYTES);
            cJSON_AddNumberToObject(
                limits, "commandsPerSecond",
                CONFIG_PA_GAME_COMMANDS_PER_SECOND);
            cJSON_AddNumberToObject(
                limits, "snapshotRateHz",
                CONFIG_PA_GAME_MAX_SNAPSHOT_RATE_HZ);
            cJSON_AddNumberToObject(
                limits, "outboundCriticalMessages",
                CONFIG_PA_WS_OUTBOUND_QUEUE_LENGTH);
        }
        cJSON_AddItemToArray(array, json);
    }
    xSemaphoreGive(apps_lock);
    return root;
}

bool app_catalogue_get(const char *id, app_descriptor_t *application)
{
    if (!id || !application) return false;
    bool found = false;
    xSemaphoreTake(apps_lock, portMAX_DELAY);
    for (size_t i = 0; i < app_count; ++i) {
        if (strcmp(apps[i].id, id) == 0) {
            *application = apps[i];
            found = true;
            break;
        }
    }
    xSemaphoreGive(apps_lock);
    return found;
}

void app_catalogue_invalidate(void)
{
    scan_catalogue();
}

static const char *mime_for_path(const char *path)
{
    const char *extension = strrchr(path, '.');
    if (!extension) return "application/octet-stream";
    if (strcmp(extension, ".js") == 0) return "text/javascript; charset=utf-8";
    if (strcmp(extension, ".css") == 0) return "text/css; charset=utf-8";
    if (strcmp(extension, ".html") == 0) return "text/html; charset=utf-8";
    if (strcmp(extension, ".json") == 0) return "application/json";
    if (strcmp(extension, ".svg") == 0) return "image/svg+xml";
    if (strcmp(extension, ".png") == 0) return "image/png";
    if (strcmp(extension, ".jpg") == 0 ||
        strcmp(extension, ".jpeg") == 0) return "image/jpeg";
    if (strcmp(extension, ".webp") == 0) return "image/webp";
    if (strcmp(extension, ".mp3") == 0) return "audio/mpeg";
    if (strcmp(extension, ".ogg") == 0) return "audio/ogg";
    return "application/octet-stream";
}

static esp_err_t serve_builtin_asset(
    httpd_req_t *request, const pa_builtin_app_file_t *file)
{
    if (!file) return httpd_resp_send_404(request);
    httpd_resp_set_type(request, file->mime);
    if (file->encoding) {
        httpd_resp_set_hdr(request, "Content-Encoding", file->encoding);
        httpd_resp_set_hdr(request, "Vary", "Accept-Encoding");
    }
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    httpd_resp_set_hdr(request, "Connection", "close");
    httpd_resp_set_hdr(request, "Cache-Control", "no-cache");
    const size_t chunk_size = 1024;
    for (size_t offset = 0; offset < file->length; offset += chunk_size) {
        size_t remaining = file->length - offset;
        size_t length = remaining < chunk_size ? remaining : chunk_size;
        esp_err_t result = httpd_resp_send_chunk(
            request, (const char *)file->data + offset, length);
        if (result != ESP_OK) return result;
    }
    return httpd_resp_send_chunk(request, NULL, 0);
}

static esp_err_t serve_app_asset(httpd_req_t *request)
{
    const char *prefix = "/apps/";
    const char *start = request->uri + strlen(prefix);
    const char *slash = strchr(start, '/');
    if (!slash || slash == start) return httpd_resp_send_404(request);
    size_t id_length = (size_t)(slash - start);
    if (id_length > 48) return httpd_resp_send_404(request);
    char app_id[49];
    memcpy(app_id, start, id_length);
    app_id[id_length] = '\0';
    const char *relative_start = slash + 1;
    size_t relative_length = strcspn(relative_start, "?#");
    if (relative_length == 0 || relative_length > 96 ||
        strchr(relative_start, '%')) return httpd_resp_send_404(request);
    char relative[97];
    memcpy(relative, relative_start, relative_length);
    relative[relative_length] = '\0';
    app_descriptor_t application;
    if (!storage_valid_app_id(app_id) ||
        !storage_safe_relative_path(relative) ||
        !app_catalogue_get(app_id, &application)) {
        return httpd_resp_send_404(request);
    }

    if (application.source == APP_SOURCE_BUILTIN) {
        return serve_builtin_asset(
            request, pa_builtin_app_file_find(app_id, relative));
    }

    storage_filesystem_lock();
    if (!storage_is_mounted()) {
        storage_filesystem_unlock();
        return httpd_resp_send_404(request);
    }
    char path[256];
    snprintf(path, sizeof(path), "%s/apps/%s/%s",
             PA_SD_MOUNT_POINT, app_id, relative);
    FILE *file = fopen(path, "rb");
    if (!file) {
        storage_filesystem_unlock();
        return httpd_resp_send_404(request);
    }
    httpd_resp_set_type(request, mime_for_path(relative));
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    httpd_resp_set_hdr(request, "Connection", "close");
    httpd_resp_set_hdr(request, "Cache-Control",
                       "public, max-age=60, must-revalidate");
    char buffer[1024];
    esp_err_t result = ESP_OK;
    size_t read;
    while ((read = fread(buffer, 1, sizeof(buffer), file)) > 0) {
        result = httpd_resp_send_chunk(request, buffer, read);
        if (result != ESP_OK) break;
    }
    if (ferror(file)) result = ESP_FAIL;
    fclose(file);
    storage_filesystem_unlock();
    if (result == ESP_OK) result = httpd_resp_send_chunk(request, NULL, 0);
    return result;
}

esp_err_t app_catalogue_register_http(httpd_handle_t server)
{
    httpd_uri_t route = {
        .uri = "/apps/*",
        .method = HTTP_GET,
        .handler = serve_app_asset,
    };
    return httpd_register_uri_handler(server, &route);
}
