#pragma once

#include "esp_err.h"
#include "esp_http_server.h"

esp_err_t websocket_register(httpd_handle_t server);
void websocket_socket_closed(int socket_fd);
void websocket_revoke_profile(const char *profile_id);
void websocket_bind_presence_events(void);
void websocket_bind_storage_events(void);
