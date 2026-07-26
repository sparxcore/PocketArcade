idf_component_register(SRCS "http_api.c" INCLUDE_DIRS "include"
                       REQUIRES esp_http_server json mbedtls board_config system_state
                                storage profiles presence app_catalogue
                                wifi_ap websocket)
