#pragma once

#include "cJSON.h"
#include "esp_err.h"
#include "esp_http_server.h"

esp_err_t app_catalogue_init(void);
cJSON *app_catalogue_response(void);
void app_catalogue_invalidate(void);
esp_err_t app_catalogue_register_http(httpd_handle_t server);
