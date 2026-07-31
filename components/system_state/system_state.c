#include "system_state.h"
#include <string.h>
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/idf_additions.h"
#include "freertos/semphr.h"

static SemaphoreHandle_t lock;
static bool sd_mounted;
static unsigned wifi_clients;
static unsigned connected_players;
static bool cpu_sample_started;
static unsigned cpu_usage_percent;
static uint32_t previous_runtime_us;
static uint32_t previous_idle_runtime[CONFIG_FREERTOS_NUMBER_OF_CORES];

esp_err_t system_state_init(void)
{
    lock = xSemaphoreCreateMutex();
    return lock ? ESP_OK : ESP_ERR_NO_MEM;
}

uint64_t system_uptime_ms(void)
{
    return (uint64_t)esp_timer_get_time() / 1000ULL;
}

void system_metrics_get(system_metrics_t *metrics)
{
    if (!metrics) return;
    memset(metrics, 0, sizeof(*metrics));
    metrics->ram_total_bytes = heap_caps_get_total_size(MALLOC_CAP_8BIT);
    metrics->ram_free_bytes = heap_caps_get_free_size(MALLOC_CAP_8BIT);

#if CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS
    uint32_t runtime_us = (uint32_t)esp_timer_get_time();
    uint32_t idle_runtime[CONFIG_FREERTOS_NUMBER_OF_CORES] = {0};
    for (BaseType_t core = 0;
         core < CONFIG_FREERTOS_NUMBER_OF_CORES; ++core) {
        idle_runtime[core] =
            (uint32_t)ulTaskGetIdleRunTimeCounterForCore(core);
    }

    if (lock && xSemaphoreTake(lock, portMAX_DELAY)) {
        if (cpu_sample_started) {
            uint32_t elapsed = runtime_us - previous_runtime_us;
            uint64_t idle_elapsed = 0;
            for (size_t core = 0;
                 core < CONFIG_FREERTOS_NUMBER_OF_CORES; ++core) {
                idle_elapsed +=
                    (uint32_t)(idle_runtime[core] -
                               previous_idle_runtime[core]);
            }
            uint64_t available =
                (uint64_t)elapsed * CONFIG_FREERTOS_NUMBER_OF_CORES;
            if (available > 0) {
                uint64_t busy =
                    idle_elapsed < available ? available - idle_elapsed : 0;
                cpu_usage_percent =
                    (unsigned)((busy * 100U + available / 2U) / available);
                if (cpu_usage_percent > 100U) cpu_usage_percent = 100U;
            }
            metrics->cpu_sample_ready = true;
        }
        previous_runtime_us = runtime_us;
        memcpy(previous_idle_runtime, idle_runtime,
               sizeof(previous_idle_runtime));
        cpu_sample_started = true;
        metrics->cpu_usage_percent = cpu_usage_percent;
        xSemaphoreGive(lock);
    }
#endif
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
