idf_component_register(SRCS "profiles.c" INCLUDE_DIRS "include"
                       REQUIRES json mbedtls esp_hw_support esp_timer
                                board_config storage device_identity system_state)
