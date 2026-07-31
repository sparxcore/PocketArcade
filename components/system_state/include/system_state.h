#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    unsigned cpu_usage_percent;
    bool cpu_sample_ready;
    size_t ram_total_bytes;
    size_t ram_free_bytes;
} system_metrics_t;

esp_err_t system_state_init(void);
uint64_t system_uptime_ms(void);
void system_metrics_get(system_metrics_t *metrics);
void system_state_set_storage(bool mounted);
bool system_state_storage_mounted(void);
void system_state_set_wifi_clients(unsigned count);
unsigned system_state_wifi_clients(void);
void system_state_set_connected_players(unsigned count);
unsigned system_state_connected_players(void);
