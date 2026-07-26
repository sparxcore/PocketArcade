idf_component_register(SRCS "wifi_ap.c" INCLUDE_DIRS "include"
                       REQUIRES esp_wifi esp_netif esp_event lwip
                                board_config device_identity system_state)
