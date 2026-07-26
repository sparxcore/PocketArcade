#include "app_catalogue.h"

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "pa_board.h"
#include "storage.h"

static const char *TAG = "APPS";
#define MAX_APPS 12
#define MAX_MANIFEST_BYTES 4096

typedef struct {
    bool used;
    char id[49];
    char name[65];
    char description[161];
    char entrypoint[97];
    char stylesheet[97];
    char kind[17];
} cached_app_t;

static cached_app_t apps[MAX_APPS];
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
    MANIFEST_INVALID_KIND
} manifest_result_t;

static const char *manifest_result_name(manifest_result_t result)
{
    switch (result) {
        case MANIFEST_INVALID_DIRECTORY: return "invalid directory name";
        case MANIFEST_NOT_FOUND: return "manifest.json not found";
        case MANIFEST_IO_ERROR: return "manifest read failed";
        case MANIFEST_TOO_LARGE: return "manifest size is invalid";
        case MANIFEST_INVALID_JSON: return "manifest JSON is invalid";
        case MANIFEST_INVALID_VERSION: return "manifestVersion must be 1";
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

static bool app_file_exists(const char *directory_name, const char *relative)
{
    char path[256];
    snprintf(path, sizeof(path), "%s/apps/%s/%s",
             PA_SD_MOUNT_POINT, directory_name, relative);
    return access(path, R_OK) == 0;
}

static manifest_result_t load_manifest(const char *directory_name,
                                       cached_app_t *app)
{
    char normalised_id[49];
    if (!normalise_directory_id(directory_name, normalised_id)) {
        return MANIFEST_INVALID_DIRECTORY;
    }
    char bounded_directory[49];
    strlcpy(bounded_directory, directory_name, sizeof(bounded_directory));
    char path[256];
    snprintf(path, sizeof(path), "%s/apps/%s/manifest.json",
             PA_SD_MOUNT_POINT, bounded_directory);
    FILE *file = fopen(path, "rb");
    if (!file) return errno == ENOENT ? MANIFEST_NOT_FOUND
                                     : MANIFEST_IO_ERROR;
    if (fseek(file, 0, SEEK_END) != 0) {
        fclose(file);
        return MANIFEST_IO_ERROR;
    }
    long length = ftell(file);
    rewind(file);
    if (length <= 0 || length > MAX_MANIFEST_BYTES) {
        fclose(file);
        return MANIFEST_TOO_LARGE;
    }
    char *buffer = malloc((size_t)length + 1);
    if (!buffer) {
        fclose(file);
        return MANIFEST_IO_ERROR;
    }
    bool read_ok = fread(buffer, 1, (size_t)length, file) == (size_t)length;
    fclose(file);
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
    if (!cJSON_IsNumber(version) || version->valueint != 1) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_VERSION;
    }
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
    if (!json_app_path(root, "entrypoint", "entrypointUrl", app->id,
                       app->entrypoint, sizeof(app->entrypoint), true) ||
        !app_file_exists(bounded_directory, app->entrypoint)) {
        /*
         * Compatibility for the v0.1 development package that briefly used
         * a different entrypoint field. The fixed fallback is accepted only
         * when the file exists inside this already-validated app directory.
         */
        if (app_file_exists(bounded_directory, "app.js")) {
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
    if (!json_app_path(root, "stylesheet", "stylesheetUrl", app->id,
                       app->stylesheet, sizeof(app->stylesheet), false) ||
        (app->stylesheet[0] &&
         !app_file_exists(bounded_directory, app->stylesheet))) {
        app->stylesheet[0] = '\0';
    }
    if (!json_string(root, "kind", app->kind, sizeof(app->kind), false)) {
        cJSON_Delete(root);
        return MANIFEST_INVALID_KIND;
    }
    cJSON_Delete(root);
    app->used = true;
    return MANIFEST_OK;
}

static void scan_catalogue(void)
{
    cached_app_t *found = calloc(MAX_APPS, sizeof(*found));
    if (!found) {
        ESP_LOGE(TAG, "No memory for application catalogue scan");
        return;
    }
    size_t found_count = 0;
    storage_filesystem_lock();
    if (storage_is_mounted()) {
        DIR *directory = opendir(PA_SD_MOUNT_POINT "/apps");
        if (directory) {
            struct dirent *entry;
            while (found_count < MAX_APPS &&
                   (entry = readdir(directory)) != NULL) {
                if (entry->d_name[0] == '.') continue;
                manifest_result_t result =
                    load_manifest(entry->d_name, &found[found_count]);
                if (result == MANIFEST_OK) {
                    ++found_count;
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
        const cached_app_t *app = &apps[i];
        cJSON *json = cJSON_CreateObject();
        cJSON_AddStringToObject(json, "id", app->id);
        cJSON_AddStringToObject(json, "name", app->name);
        cJSON_AddStringToObject(json, "description", app->description);
        cJSON_AddStringToObject(json, "kind",
                                app->kind[0] ? app->kind : "application");
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
        cJSON_AddItemToArray(array, json);
    }
    xSemaphoreGive(apps_lock);
    return root;
}

void app_catalogue_invalidate(void)
{
    scan_catalogue();
}

static bool cached_app_exists(const char *id)
{
    bool found = false;
    xSemaphoreTake(apps_lock, portMAX_DELAY);
    for (size_t i = 0; i < app_count; ++i) {
        if (strcmp(apps[i].id, id) == 0) {
            found = true;
            break;
        }
    }
    xSemaphoreGive(apps_lock);
    return found;
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
    if (!storage_valid_app_id(app_id) ||
        !storage_safe_relative_path(relative) ||
        !cached_app_exists(app_id)) return httpd_resp_send_404(request);

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
