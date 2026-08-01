#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "pa_board.h"

#define PA_WIFI_SSID_MAX_LEN 31
#define PA_WIFI_ACCESS_KEY_MAX_LEN 63

typedef struct {
    char ssid[PA_WIFI_SSID_MAX_LEN + 1];
    bool secured;
} wifi_ap_settings_t;

esp_err_t wifi_ap_start(void);
const char *wifi_ap_ssid(void);
esp_err_t wifi_ap_get_settings(wifi_ap_settings_t *settings);
esp_err_t wifi_ap_set_access_key(const char *access_key, bool *changed);
esp_err_t wifi_ap_fingerprint_for_socket(
    int socket_fd,
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1]);
esp_err_t wifi_ap_fingerprint_for_ipv4(
    uint32_t ipv4_network_order,
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1]);
size_t wifi_ap_station_count(void);
