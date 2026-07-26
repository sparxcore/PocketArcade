idf_component_register(SRCS "presence.c" INCLUDE_DIRS "include"
                       REQUIRES json freertos board_config profiles
                                protocol system_state)
