#include "system_state.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static SemaphoreHandle_t lock;
static bool sd_mounted;
static unsigned wifi_clients;
static unsigned connected_players;

esp_err_t system_state_init(void)
{
    lock = xSemaphoreCreateMutex();
    return lock ? ESP_OK : ESP_ERR_NO_MEM;
}

uint64_t system_uptime_ms(void)
{
    return (uint64_t)esp_timer_get_time() / 1000ULL;
}

static void set_value(unsigned *target, unsigned value)
{
    if (lock && xSemaphoreTake(lock, portMAX_DELAY)) {
        *target = value;
        xSemaphoreGive(lock);
    }
}

static unsigned get_value(unsigned *target)
{
    unsigned value = 0;
    if (lock && xSemaphoreTake(lock, portMAX_DELAY)) {
        value = *target;
        xSemaphoreGive(lock);
    }
    return value;
}

void system_state_set_storage(bool mounted)
{
    if (lock && xSemaphoreTake(lock, portMAX_DELAY)) {
        sd_mounted = mounted;
        xSemaphoreGive(lock);
    }
}

bool system_state_storage_mounted(void)
{
    bool value = false;
    if (lock && xSemaphoreTake(lock, portMAX_DELAY)) {
        value = sd_mounted;
        xSemaphoreGive(lock);
    }
    return value;
}

void system_state_set_wifi_clients(unsigned count) { set_value(&wifi_clients, count); }
unsigned system_state_wifi_clients(void) { return get_value(&wifi_clients); }
void system_state_set_connected_players(unsigned count) { set_value(&connected_players, count); }
unsigned system_state_connected_players(void) { return get_value(&connected_players); }
