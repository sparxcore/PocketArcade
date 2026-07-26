#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

esp_err_t system_state_init(void);
uint64_t system_uptime_ms(void);
void system_state_set_storage(bool mounted);
bool system_state_storage_mounted(void);
void system_state_set_wifi_clients(unsigned count);
unsigned system_state_wifi_clients(void);
void system_state_set_connected_players(unsigned count);
unsigned system_state_connected_players(void);
