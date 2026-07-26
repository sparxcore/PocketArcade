#pragma once

#include "esp_err.h"
#include "esp_http_server.h"

esp_err_t http_api_start(httpd_handle_t *server);
esp_err_t http_api_register_routes(httpd_handle_t server);
