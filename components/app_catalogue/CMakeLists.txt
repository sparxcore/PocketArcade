idf_component_register(SRCS "app_catalogue.c" INCLUDE_DIRS "include"
                       REQUIRES json storage esp_http_server freertos
                                board_config)
