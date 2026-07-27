idf_component_register(SRCS "game_runtime.c" INCLUDE_DIRS "include"
                       REQUIRES json lua app_catalogue profiles storage
                                system_state esp_timer esp_hw_support
                                board_config heap)
