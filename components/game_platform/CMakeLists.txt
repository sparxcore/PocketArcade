idf_component_register(SRCS "game_platform.c" INCLUDE_DIRS "include"
                       REQUIRES json freertos esp_hw_support board_config
                                system_state app_catalogue game_runtime profiles
                                protocol)

