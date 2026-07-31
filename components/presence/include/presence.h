#pragma once

#include <stddef.h>
#include "cJSON.h"
#include "esp_err.h"
#include "profiles.h"

typedef enum {
    PRESENCE_EVENT_JOINED,
    PRESENCE_EVENT_UPDATED,
    PRESENCE_EVENT_ACTIVITY,
    PRESENCE_EVENT_LEFT
} presence_event_t;

typedef void (*presence_event_callback_t)(presence_event_t event,
                                          const public_profile_t *profile,
                                          const char *open_app_id);

esp_err_t presence_init(void);
void presence_connection_opened(const public_profile_t *profile);
void presence_connection_closed(const char *profile_id);
void presence_profile_updated(const public_profile_t *profile);
void presence_profile_deleted(const char *profile_id);
esp_err_t presence_set_open_app(const char *profile_id,
                                const char *open_app_id);
cJSON *presence_snapshot_json(void);
size_t presence_online_count(void);
void presence_set_event_callback(presence_event_callback_t callback);
