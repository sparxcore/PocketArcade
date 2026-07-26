#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef enum {
    STORAGE_EVENT_MOUNTED,
    STORAGE_EVENT_UNMOUNTED,
    STORAGE_EVENT_ERROR
} storage_event_t;

typedef struct {
    bool mounted;
    const char *interface_name;
    const char *card_type;
    uint64_t capacity_bytes;
    uint64_t free_bytes;
    bool persistent_profiles_available;
    bool safe_to_remove;
} storage_info_t;

typedef void (*storage_event_callback_t)(storage_event_t event,
                                         const storage_info_t *info);

esp_err_t storage_init(void);
void storage_get_info(storage_info_t *info);
bool storage_is_mounted(void);
bool storage_safe_relative_path(const char *relative);
bool storage_valid_app_id(const char *app_id);
esp_err_t storage_enqueue_atomic_write(const char *relative_path,
                                       const char *data, size_t length);
/*
 * Queues an existing malloc-compatible buffer without duplicating it.
 * Ownership transfers to storage only when ESP_OK is returned.
 */
esp_err_t storage_enqueue_atomic_write_owned(const char *relative_path,
                                             char *data, size_t length);
esp_err_t storage_enqueue_delete(const char *relative_path);
esp_err_t storage_request_eject(void);
esp_err_t storage_request_mount(void);
void storage_filesystem_lock(void);
void storage_filesystem_unlock(void);
void storage_set_event_callback(storage_event_callback_t callback);
