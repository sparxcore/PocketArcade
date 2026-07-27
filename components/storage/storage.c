#include "storage.h"

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>

#include "driver/gpio.h"
#include "driver/spi_common.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "pa_board.h"
#include "sdmmc_cmd.h"
#include "soc/soc_caps.h"
#include "system_state.h"

#if CONFIG_PA_SD_SDMMC
#include "driver/sdmmc_host.h"
#endif

#if CONFIG_PA_SD_SDSPI
#include "driver/sdspi_host.h"
#endif

#if !CONFIG_PA_SD_DISABLED
#include "sd_protocol_defs.h"
#endif

static const char *TAG = "STORAGE";

typedef enum {
    OP_WRITE,
    OP_DELETE,
    OP_EJECT,
    OP_MOUNT
} operation_type_t;

typedef struct {
    operation_type_t type;
    char path[192];
    char *data;
    size_t length;
} operation_t;

static SemaphoreHandle_t state_lock;
static SemaphoreHandle_t filesystem_lock;
static QueueHandle_t queue;
static sdmmc_card_t *card;
static bool mounted;
static bool manual_ejected;
#if CONFIG_PA_SD_SDSPI
static bool spi_bus_started;
#endif
static storage_event_callback_t event_callbacks[4];
static char card_type[12] = "none";

#if CONFIG_PA_SD_SDSPI
#if CONFIG_PA_SDSPI_HOST_SPI3
#define PA_SPI_HOST SPI3_HOST
#else
#define PA_SPI_HOST SPI2_HOST
#endif
#endif

static bool card_present(void)
{
#if CONFIG_PA_SD_DISABLED
    return false;
#else
    if (CONFIG_PA_SD_CARD_DETECT_PIN < 0) {
        return true;
    }
    int level = gpio_get_level(CONFIG_PA_SD_CARD_DETECT_PIN);
#if CONFIG_PA_SD_CARD_DETECT_ACTIVE_LOW
    return level == 0;
#else
    return level != 0;
#endif
#endif
}

#if !CONFIG_PA_SD_DISABLED
static uint64_t gpio_pin_mask(int pin)
{
    return (pin >= 0 && pin < 64) ? (UINT64_C(1) << (unsigned)pin) : 0;
}

static void set_power(bool enabled)
{
    if (CONFIG_PA_SD_POWER_PIN >= 0) {
#if CONFIG_PA_SD_POWER_ACTIVE_HIGH
        gpio_set_level(CONFIG_PA_SD_POWER_PIN, enabled ? 1 : 0);
#else
        gpio_set_level(CONFIG_PA_SD_POWER_PIN, enabled ? 0 : 1);
#endif
    }
}

static bool ensure_directory(const char *path)
{
    if (mkdir(path, 0775) == 0) {
        return true;
    }
    if (errno == EEXIST) {
        struct stat info;
        if (stat(path, &info) == 0 && S_ISDIR(info.st_mode)) {
            return true;
        }
    }
    ESP_LOGE(TAG, "Could not create storage directory %s: errno %d",
             path, errno);
    return false;
}

static esp_err_t ensure_layout(void)
{
    static const char *paths[] = {
        PA_SD_MOUNT_POINT "/apps",
        PA_SD_MOUNT_POINT "/data",
        PA_SD_MOUNT_POINT "/data/profiles",
        PA_SD_MOUNT_POINT "/data/avatars",
        PA_SD_MOUNT_POINT "/data/chat",
        PA_SD_MOUNT_POINT "/data/apps",
        PA_SD_MOUNT_POINT "/logs",
    };
    for (size_t i = 0; i < sizeof(paths) / sizeof(paths[0]); ++i) {
        if (!ensure_directory(paths[i])) {
            return ESP_FAIL;
        }
    }
    ESP_LOGI(TAG, "PocketArcade directory structure is ready");
    return ESP_OK;
}
#endif

static void notify(storage_event_t event)
{
    storage_info_t info;
    storage_get_info(&info);
    for (size_t i = 0;
         i < sizeof(event_callbacks) / sizeof(event_callbacks[0]); ++i) {
        if (event_callbacks[i]) {
            event_callbacks[i](event, &info);
        }
    }
}

static esp_err_t mount_card_unlocked(void)
{
#if CONFIG_PA_SD_DISABLED
    return ESP_ERR_NOT_SUPPORTED;
#else
    if (mounted) {
        return ESP_OK;
    }
    if (!card_present()) {
        return ESP_ERR_NOT_FOUND;
    }
#if CONFIG_PA_SD_SDMMC && SOC_SDMMC_USE_GPIO_MATRIX
    if (CONFIG_PA_SDMMC_CLK_PIN < 0 || CONFIG_PA_SDMMC_CMD_PIN < 0 ||
        CONFIG_PA_SDMMC_D0_PIN < 0) {
        ESP_LOGE(TAG, "SDMMC GPIO matrix target requires CLK/CMD/D0 pins");
        return ESP_ERR_INVALID_ARG;
    }
#if CONFIG_PA_SDMMC_WIDTH_4
    if (CONFIG_PA_SDMMC_D1_PIN < 0 || CONFIG_PA_SDMMC_D2_PIN < 0 ||
        CONFIG_PA_SDMMC_D3_PIN < 0) {
        ESP_LOGE(TAG, "Four-bit SDMMC requires D1/D2/D3 pins");
        return ESP_ERR_INVALID_ARG;
    }
#endif
#elif CONFIG_PA_SD_SDSPI
    if (CONFIG_PA_SDSPI_MOSI_PIN < 0 || CONFIG_PA_SDSPI_MISO_PIN < 0 ||
        CONFIG_PA_SDSPI_CLK_PIN < 0 || CONFIG_PA_SDSPI_CS_PIN < 0) {
        ESP_LOGE(TAG, "SDSPI requires MOSI/MISO/CLK/CS pins");
        return ESP_ERR_INVALID_ARG;
    }
#endif
    set_power(true);
    vTaskDelay(pdMS_TO_TICKS(20));

    esp_vfs_fat_sdmmc_mount_config_t mount_config = {
#if CONFIG_PA_SD_FORMAT_IF_UNMOUNTABLE
        .format_if_mount_failed = true,
#else
        .format_if_mount_failed = false,
#endif
        .max_files = 6,
        .allocation_unit_size = 16 * 1024,
    };
    esp_err_t err;

#if CONFIG_PA_SD_SDMMC
    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
    host.max_freq_khz = CONFIG_PA_SD_CLOCK_KHZ;
    sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
#if CONFIG_PA_SDMMC_WIDTH_4
    slot.width = 4;
#else
    slot.width = 1;
#endif
#if SOC_SDMMC_USE_GPIO_MATRIX
    slot.clk = CONFIG_PA_SDMMC_CLK_PIN;
    slot.cmd = CONFIG_PA_SDMMC_CMD_PIN;
    slot.d0 = CONFIG_PA_SDMMC_D0_PIN;
#if CONFIG_PA_SDMMC_WIDTH_4
    slot.d1 = CONFIG_PA_SDMMC_D1_PIN;
    slot.d2 = CONFIG_PA_SDMMC_D2_PIN;
    slot.d3 = CONFIG_PA_SDMMC_D3_PIN;
#endif
#endif
    err = esp_vfs_fat_sdmmc_mount(PA_SD_MOUNT_POINT, &host, &slot,
                                  &mount_config, &card);
#elif CONFIG_PA_SD_SDSPI
    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = PA_SPI_HOST;
    host.max_freq_khz = CONFIG_PA_SD_CLOCK_KHZ;
    spi_bus_config_t bus = {
        .mosi_io_num = CONFIG_PA_SDSPI_MOSI_PIN,
        .miso_io_num = CONFIG_PA_SDSPI_MISO_PIN,
        .sclk_io_num = CONFIG_PA_SDSPI_CLK_PIN,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4096,
    };
    err = spi_bus_initialize(host.slot, &bus, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) {
        return err;
    }
    spi_bus_started = true;
    sdspi_device_config_t slot = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot.gpio_cs = CONFIG_PA_SDSPI_CS_PIN;
    slot.host_id = host.slot;
    err = esp_vfs_fat_sdspi_mount(PA_SD_MOUNT_POINT, &host, &slot,
                                  &mount_config, &card);
    if (err != ESP_OK) {
        spi_bus_free(host.slot);
        spi_bus_started = false;
    }
#endif
    if (err != ESP_OK) {
        set_power(false);
        ESP_LOGW(TAG, "SD mount unavailable: %s", esp_err_to_name(err));
        return err;
    }

    err = ensure_layout();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "SD mounted, but its PocketArcade layout could not be created");
        esp_vfs_fat_sdcard_unmount(PA_SD_MOUNT_POINT, card);
#if CONFIG_PA_SD_SDSPI
        if (spi_bus_started) {
            spi_bus_free(PA_SPI_HOST);
            spi_bus_started = false;
        }
#endif
        card = NULL;
        set_power(false);
        return err;
    }

    xSemaphoreTake(state_lock, portMAX_DELAY);
    mounted = true;
    if (card->is_mmc) {
        strlcpy(card_type, "MMC", sizeof(card_type));
    } else if (card->ocr & SD_OCR_SDHC_CAP) {
        strlcpy(card_type, "SDHC", sizeof(card_type));
    } else {
        strlcpy(card_type, "SDSC", sizeof(card_type));
    }
    xSemaphoreGive(state_lock);
    system_state_set_storage(true);
    ESP_LOGI(TAG, "Mounted %s card at %s", card_type, PA_SD_MOUNT_POINT);
    return ESP_OK;
#endif
}

static esp_err_t mount_card(void)
{
    bool was_mounted = storage_is_mounted();
    xSemaphoreTake(filesystem_lock, portMAX_DELAY);
    esp_err_t result = mount_card_unlocked();
    xSemaphoreGive(filesystem_lock);
    if (result == ESP_OK && !was_mounted) notify(STORAGE_EVENT_MOUNTED);
    return result;
}

static void unmount_card_unlocked(void)
{
#if !CONFIG_PA_SD_DISABLED
    if (!mounted) {
        return;
    }
    esp_vfs_fat_sdcard_unmount(PA_SD_MOUNT_POINT, card);
#if CONFIG_PA_SD_SDSPI
    if (spi_bus_started) {
        spi_bus_free(PA_SPI_HOST);
        spi_bus_started = false;
    }
#endif
    xSemaphoreTake(state_lock, portMAX_DELAY);
    mounted = false;
    card = NULL;
    strlcpy(card_type, "none", sizeof(card_type));
    xSemaphoreGive(state_lock);
    set_power(false);
    system_state_set_storage(false);
    ESP_LOGW(TAG, "SD card unmounted");
#endif
}

static void unmount_card(void)
{
    bool was_mounted = storage_is_mounted();
    xSemaphoreTake(filesystem_lock, portMAX_DELAY);
    unmount_card_unlocked();
    xSemaphoreGive(filesystem_lock);
    if (was_mounted) notify(STORAGE_EVENT_UNMOUNTED);
}

bool storage_safe_relative_path(const char *relative)
{
    if (!relative || !*relative || relative[0] == '/' ||
        strlen(relative) > 180) {
        return false;
    }
    const char *segment = relative;
    for (const char *p = relative;; ++p) {
        if (*p == '\\' ||
            (*p != '\0' && (unsigned char)*p < 0x20)) {
            return false;
        }
        if (*p == '/' || *p == '\0') {
            size_t length = (size_t)(p - segment);
            if (length == 0 ||
                (length == 1 && segment[0] == '.') ||
                (length == 2 && segment[0] == '.' && segment[1] == '.')) {
                return false;
            }
            if (*p == '\0') {
                break;
            }
            segment = p + 1;
        }
    }
    return true;
}

bool storage_valid_app_id(const char *app_id)
{
    if (!app_id || !*app_id || strlen(app_id) > 48) {
        return false;
    }
    for (const char *p = app_id; *p; ++p) {
        if (!((*p >= 'a' && *p <= 'z') ||
              (*p >= '0' && *p <= '9') || *p == '-')) {
            return false;
        }
    }
    return true;
}

static bool execute_operation(operation_t *op)
{
    char destination[256];
    snprintf(destination, sizeof(destination), "%s/%s",
             PA_SD_MOUNT_POINT, op->path);
    if (op->type == OP_DELETE) {
        bool ok = unlink(destination) == 0 || errno == ENOENT;
        if (!ok) {
            ESP_LOGW(TAG, "Delete failed for queued file: errno %d", errno);
        }
        return ok;
    }

    /*
     * Application records add one namespace directory beneath data/apps.
     * Create that directory on this worker so runtime callbacks still only
     * enqueue writes and never mutate the filesystem directly.
     */
    if (strncmp(op->path, "data/apps/", strlen("data/apps/")) == 0) {
        char parent[256];
        strlcpy(parent, destination, sizeof(parent));
        char *separator = strrchr(parent, '/');
        if (!separator) return false;
        *separator = '\0';
        if (mkdir(parent, 0775) != 0 && errno != EEXIST) {
            ESP_LOGE(TAG, "Could not create application data directory: %d",
                     errno);
            return false;
        }
    }

    char temporary[264];
    snprintf(temporary, sizeof(temporary), "%s.tmp", destination);
    FILE *file = fopen(temporary, "wb");
    if (!file) {
        ESP_LOGE(TAG, "Could not open profile temporary file: errno %d", errno);
        return false;
    }
    bool ok = fwrite(op->data, 1, op->length, file) == op->length;
    if (ok) {
        ok = fflush(file) == 0 && fsync(fileno(file)) == 0;
    }
    ok = fclose(file) == 0 && ok;
    char backup[264];
    snprintf(backup, sizeof(backup), "%s.bak", destination);
    bool had_previous = access(destination, F_OK) == 0;
    unlink(backup);
    if (ok && had_previous && rename(destination, backup) != 0) {
        ok = false;
    }
    if (ok && rename(temporary, destination) != 0) {
        if (had_previous) rename(backup, destination);
        ok = false;
    }
    if (ok) {
        unlink(backup);
    } else {
        unlink(temporary);
        ESP_LOGE(TAG, "Atomic profile write failed: errno %d", errno);
    }
    return ok;
}

static void storage_task(void *argument)
{
    (void)argument;
    bool last_present = card_present();
    TickType_t last_poll = xTaskGetTickCount();
    for (;;) {
        operation_t op = {0};
        if (xQueueReceive(queue, &op, pdMS_TO_TICKS(500))) {
            if (op.type == OP_EJECT) {
                unmount_card();
                ESP_LOGI(TAG, "SD card safely ejected");
            } else if (op.type == OP_MOUNT) {
                xSemaphoreTake(state_lock, portMAX_DELAY);
                manual_ejected = false;
                xSemaphoreGive(state_lock);
                if (mount_card() != ESP_OK) notify(STORAGE_EVENT_ERROR);
            } else if (storage_is_mounted()) {
                xSemaphoreTake(filesystem_lock, portMAX_DELAY);
                bool operation_ok = execute_operation(&op);
                xSemaphoreGive(filesystem_lock);
                if (!operation_ok) notify(STORAGE_EVENT_ERROR);
                free(op.data);
            } else {
                /* Preserve requested mutations until a removed card returns. */
                if (xQueueSendToFront(queue, &op, 0) != pdTRUE) {
                    free(op.data);
                    ESP_LOGE(TAG, "Could not retain queued storage operation");
                }
                vTaskDelay(pdMS_TO_TICKS(500));
            }
        }
        TickType_t now = xTaskGetTickCount();
        if (now - last_poll >= pdMS_TO_TICKS(1000)) {
            bool present = card_present();
            if (present != last_present) {
                if (present) {
                    xSemaphoreTake(state_lock, portMAX_DELAY);
                    manual_ejected = false;
                    xSemaphoreGive(state_lock);
                    if (mount_card() != ESP_OK) {
                        notify(STORAGE_EVENT_ERROR);
                    }
                } else {
                    unmount_card();
                }
                last_present = present;
            }
            xSemaphoreTake(state_lock, portMAX_DELAY);
            bool may_auto_mount = !manual_ejected;
            xSemaphoreGive(state_lock);
            if (present && may_auto_mount && !storage_is_mounted() &&
                now % pdMS_TO_TICKS(5000) < pdMS_TO_TICKS(1000)) {
                mount_card();
            }
            last_poll = now;
        }
    }
}

esp_err_t storage_init(void)
{
    state_lock = xSemaphoreCreateMutex();
    filesystem_lock = xSemaphoreCreateMutex();
    queue = xQueueCreate(CONFIG_PA_STORAGE_QUEUE_LENGTH, sizeof(operation_t));
    if (!state_lock || !filesystem_lock || !queue) {
        return ESP_ERR_NO_MEM;
    }
#if !CONFIG_PA_SD_DISABLED
    if (CONFIG_PA_SD_CARD_DETECT_PIN >= 0) {
        gpio_config_t detect = {
            .pin_bit_mask = gpio_pin_mask(CONFIG_PA_SD_CARD_DETECT_PIN),
            .mode = GPIO_MODE_INPUT,
#if CONFIG_PA_SD_CARD_DETECT_ACTIVE_LOW
            .pull_up_en = GPIO_PULLUP_ENABLE,
#else
            .pull_down_en = GPIO_PULLDOWN_ENABLE,
#endif
        };
        ESP_ERROR_CHECK(gpio_config(&detect));
    }
    if (CONFIG_PA_SD_POWER_PIN >= 0) {
        gpio_config_t power = {
            .pin_bit_mask = gpio_pin_mask(CONFIG_PA_SD_POWER_PIN),
            .mode = GPIO_MODE_OUTPUT,
        };
        ESP_ERROR_CHECK(gpio_config(&power));
        set_power(false);
    }
    esp_err_t mount_result = mount_card();
    if (mount_result != ESP_OK && mount_result != ESP_ERR_NOT_FOUND) {
        ESP_LOGW(TAG, "Continuing in RAM-only mode");
    }
#else
    ESP_LOGI(TAG, "SD support disabled; using RAM-only profiles");
#endif
    if (xTaskCreate(storage_task, "pa_storage", 4096, NULL, 4, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

bool storage_is_mounted(void)
{
    bool value = false;
    if (state_lock && xSemaphoreTake(state_lock, portMAX_DELAY)) {
        value = mounted;
        xSemaphoreGive(state_lock);
    }
    return value;
}

void storage_get_info(storage_info_t *info)
{
    memset(info, 0, sizeof(*info));
#if CONFIG_PA_SD_SDMMC
    info->interface_name = "sdmmc";
#elif CONFIG_PA_SD_SDSPI
    info->interface_name = "sdspi";
#else
    info->interface_name = "disabled";
#endif
    info->card_type = card_type;
    storage_filesystem_lock();
    xSemaphoreTake(state_lock, portMAX_DELAY);
    info->mounted = mounted;
    info->persistent_profiles_available = info->mounted;
    info->safe_to_remove = manual_ejected && !mounted;
    if (info->mounted && card) {
        info->capacity_bytes = (uint64_t)card->csd.capacity *
                               card->csd.sector_size;
    }
    xSemaphoreGive(state_lock);
    if (info->mounted) {
        struct statvfs fs;
        if (statvfs(PA_SD_MOUNT_POINT, &fs) == 0) {
            info->free_bytes = (uint64_t)fs.f_bavail * fs.f_frsize;
        }
    }
    storage_filesystem_unlock();
}

static esp_err_t enqueue_owned(operation_type_t type, const char *relative,
                               char *data, size_t length)
{
    if ((type == OP_WRITE || type == OP_DELETE) &&
        !storage_safe_relative_path(relative)) {
        return ESP_ERR_INVALID_ARG;
    }
    xSemaphoreTake(state_lock, portMAX_DELAY);
    bool writes_allowed = !manual_ejected;
    xSemaphoreGive(state_lock);
    if ((type == OP_WRITE || type == OP_DELETE) && !writes_allowed) {
        return ESP_ERR_INVALID_STATE;
    }
    operation_t op = {
        .type = type,
        .data = data,
        .length = length,
    };
    if (relative) strlcpy(op.path, relative, sizeof(op.path));
    if (xQueueSend(queue, &op, 0) != pdTRUE) {
        ESP_LOGW(TAG, "Storage queue full");
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

esp_err_t storage_enqueue_atomic_write(const char *relative_path,
                                       const char *data, size_t length)
{
    char *copy = malloc(length + 1);
    if (!copy) return ESP_ERR_NO_MEM;
    memcpy(copy, data, length);
    copy[length] = '\0';
    esp_err_t result =
        storage_enqueue_atomic_write_owned(relative_path, copy, length);
    if (result != ESP_OK) free(copy);
    return result;
}

esp_err_t storage_enqueue_atomic_write_owned(const char *relative_path,
                                             char *data, size_t length)
{
    if (!data || length == 0) return ESP_ERR_INVALID_ARG;
    if (!storage_is_mounted()) {
        ESP_LOGW(TAG, "Write rejected while storage is not mounted");
        return ESP_ERR_INVALID_STATE;
    }
    esp_err_t result = enqueue_owned(OP_WRITE, relative_path, data, length);
    if (result != ESP_OK) {
        ESP_LOGW(TAG, "Could not queue write (%s, free heap %u)",
                 esp_err_to_name(result),
                 (unsigned)esp_get_free_heap_size());
    }
    return result;
}

esp_err_t storage_enqueue_delete(const char *relative_path)
{
    return enqueue_owned(OP_DELETE, relative_path, NULL, 0);
}

esp_err_t storage_request_eject(void)
{
    xSemaphoreTake(state_lock, portMAX_DELAY);
    if (!mounted || manual_ejected) {
        xSemaphoreGive(state_lock);
        return ESP_ERR_INVALID_STATE;
    }
    /*
     * Reject new writes immediately. The eject marker is queued after every
     * already-accepted write, so FATFS is unmounted only once they are done.
     */
    manual_ejected = true;
    xSemaphoreGive(state_lock);
    esp_err_t err = enqueue_owned(OP_EJECT, NULL, NULL, 0);
    if (err != ESP_OK) {
        xSemaphoreTake(state_lock, portMAX_DELAY);
        manual_ejected = false;
        xSemaphoreGive(state_lock);
    }
    return err;
}

esp_err_t storage_request_mount(void)
{
    xSemaphoreTake(state_lock, portMAX_DELAY);
    bool allowed = !mounted;
    xSemaphoreGive(state_lock);
    return allowed ? enqueue_owned(OP_MOUNT, NULL, NULL, 0)
                   : ESP_ERR_INVALID_STATE;
}

void storage_filesystem_lock(void)
{
    xSemaphoreTake(filesystem_lock, portMAX_DELAY);
}

void storage_filesystem_unlock(void)
{
    xSemaphoreGive(filesystem_lock);
}

void storage_set_event_callback(storage_event_callback_t callback)
{
    if (!callback) return;
    for (size_t i = 0;
         i < sizeof(event_callbacks) / sizeof(event_callbacks[0]); ++i) {
        if (event_callbacks[i] == callback) return;
        if (!event_callbacks[i]) {
            event_callbacks[i] = callback;
            return;
        }
    }
    ESP_LOGW(TAG, "Storage event callback table full");
}
