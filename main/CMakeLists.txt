idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES
        nvs_flash
        board_config
        system_state
        device_identity
        wifi_ap
        captive_portal
        storage
        profiles
        presence
        chat
        game_runtime
        game_platform
        protocol
        app_catalogue
        embedded_web
        websocket
        http_api
)
