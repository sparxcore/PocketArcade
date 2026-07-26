#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "pa_board.h"

esp_err_t device_identity_init(void);
esp_err_t device_identity_fingerprint_mac(
    const uint8_t mac[6],
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1]);
bool device_identity_constant_time_equal(const char *a, const char *b, size_t len);
