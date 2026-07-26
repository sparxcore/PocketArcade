#include "presence.h"

#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "pa_board.h"
#include "system_state.h"

static const char *TAG = "PRESENCE";

typedef struct {
    bool used;
    public_profile_t profile;
    unsigned connections;
    bool online;
    uint64_t leave_deadline;
} presence_entry_t;

static presence_entry_t entries[CONFIG_PA_MAX_PROFILES];
static SemaphoreHandle_t lock;
static presence_event_callback_t event_callback;

static presence_entry_t *find_locked(const char *profile_id)
{
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (entries[i].used &&
            strcmp(entries[i].profile.id, profile_id) == 0) {
            return &entries[i];
        }
    }
    return NULL;
}

static size_t online_count_locked(void)
{
    size_t count = 0;
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        count += entries[i].used && entries[i].online ? 1 : 0;
    }
    return count;
}

static cJSON *presence_player_json(const public_profile_t *profile,
                                   bool online)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "id", profile->id);
    cJSON_AddStringToObject(json, "nickname", profile->nickname);
    if (profile->avatar_url[0]) {
        cJSON_AddStringToObject(json, "avatarUrl", profile->avatar_url);
    } else {
        cJSON_AddNullToObject(json, "avatarUrl");
    }
    if (profile->colour[0]) {
        cJSON_AddStringToObject(json, "colour", profile->colour);
    } else {
        cJSON_AddNullToObject(json, "colour");
    }
    cJSON_AddBoolToObject(json, "online", online);
    cJSON_AddBoolToObject(json, "persistent", profile->persistent);
    cJSON_AddStringToObject(json, "role",
                            profile->admin ? "admin" : "player");
    cJSON_AddNumberToObject(json, "wins", profile->wins);
    return json;
}

void presence_connection_opened(const public_profile_t *profile)
{
    bool joined = false;
    xSemaphoreTake(lock, portMAX_DELAY);
    presence_entry_t *entry = find_locked(profile->id);
    if (!entry) {
        for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
            if (!entries[i].used) {
                entry = &entries[i];
                memset(entry, 0, sizeof(*entry));
                entry->used = true;
                break;
            }
        }
    }
    if (entry) {
        joined = !entry->online;
        entry->profile = *profile;
        ++entry->connections;
        entry->online = true;
        entry->leave_deadline = 0;
    }
    size_t count = online_count_locked();
    xSemaphoreGive(lock);
    system_state_set_connected_players(count);
    if (joined) {
        ESP_LOGI(TAG, "%.18s joined (%u online)", profile->id,
                 (unsigned)count);
        if (event_callback) event_callback(PRESENCE_EVENT_JOINED, profile);
    }
}

void presence_connection_closed(const char *profile_id)
{
    xSemaphoreTake(lock, portMAX_DELAY);
    presence_entry_t *entry = find_locked(profile_id);
    if (entry && entry->connections > 0) {
        --entry->connections;
        if (entry->connections == 0) {
            entry->leave_deadline =
                system_uptime_ms() + CONFIG_PA_PRESENCE_GRACE_MS;
        }
    }
    xSemaphoreGive(lock);
}

void presence_profile_updated(const public_profile_t *profile)
{
    bool broadcast = false;
    xSemaphoreTake(lock, portMAX_DELAY);
    presence_entry_t *entry = find_locked(profile->id);
    if (entry) {
        entry->profile = *profile;
        broadcast = entry->online;
    }
    xSemaphoreGive(lock);
    if (broadcast && event_callback) {
        event_callback(PRESENCE_EVENT_UPDATED, profile);
    }
}

void presence_profile_deleted(const char *profile_id)
{
    public_profile_t removed = {0};
    bool was_online = false;
    xSemaphoreTake(lock, portMAX_DELAY);
    presence_entry_t *entry = find_locked(profile_id);
    if (entry) {
        removed = entry->profile;
        was_online = entry->online;
        memset(entry, 0, sizeof(*entry));
    }
    size_t count = online_count_locked();
    xSemaphoreGive(lock);
    system_state_set_connected_players(count);
    if (was_online && event_callback) {
        event_callback(PRESENCE_EVENT_LEFT, &removed);
    }
}

cJSON *presence_snapshot_json(void)
{
    cJSON *array = cJSON_CreateArray();
    xSemaphoreTake(lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (entries[i].used && entries[i].online) {
            cJSON_AddItemToArray(
                array, presence_player_json(&entries[i].profile, true));
        }
    }
    xSemaphoreGive(lock);
    return array;
}

size_t presence_online_count(void)
{
    xSemaphoreTake(lock, portMAX_DELAY);
    size_t count = online_count_locked();
    xSemaphoreGive(lock);
    return count;
}

void presence_set_event_callback(presence_event_callback_t callback)
{
    event_callback = callback;
}

static void presence_task(void *argument)
{
    (void)argument;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(250));
        for (;;) {
            public_profile_t left = {0};
            bool found = false;
            uint64_t now = system_uptime_ms();
            xSemaphoreTake(lock, portMAX_DELAY);
            for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
                if (entries[i].used && entries[i].online &&
                    entries[i].connections == 0 &&
                    entries[i].leave_deadline <= now) {
                    left = entries[i].profile;
                    entries[i].online = false;
                    entries[i].leave_deadline = 0;
                    found = true;
                    break;
                }
            }
            size_t count = online_count_locked();
            xSemaphoreGive(lock);
            system_state_set_connected_players(count);
            if (!found) break;
            ESP_LOGI(TAG, "%.18s left after reconnect grace", left.id);
            if (event_callback) {
                event_callback(PRESENCE_EVENT_LEFT, &left);
            }
        }
    }
}

esp_err_t presence_init(void)
{
    lock = xSemaphoreCreateMutex();
    if (!lock) return ESP_ERR_NO_MEM;
    profile_set_change_callback(presence_profile_updated);
    if (xTaskCreate(presence_task, "pa_presence", 3072, NULL, 4, NULL) !=
        pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}
