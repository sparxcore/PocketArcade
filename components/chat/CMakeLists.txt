idf_component_register(SRCS "chat.c" INCLUDE_DIRS "include"
                       REQUIRES json freertos esp_hw_support profiles storage
                                system_state)
