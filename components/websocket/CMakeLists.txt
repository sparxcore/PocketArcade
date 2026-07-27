idf_component_register(SRCS "websocket.c" INCLUDE_DIRS "include"
                       REQUIRES esp_http_server json esp_hw_support
                                board_config protocol profiles presence
                                storage wifi_ap system_state chat game_platform)
