idf_component_register(SRCS "device_identity.c" INCLUDE_DIRS "include"
                       REQUIRES nvs_flash mbedtls esp_hw_support board_config)
