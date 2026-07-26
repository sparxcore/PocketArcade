#pragma once

#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "pa_board.h"

esp_err_t wifi_ap_start(void);
esp_err_t wifi_ap_fingerprint_for_socket(
    int socket_fd,
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1]);
esp_err_t wifi_ap_fingerprint_for_ipv4(
    uint32_t ipv4_network_order,
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1]);
size_t wifi_ap_station_count(void);
