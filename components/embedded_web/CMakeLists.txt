set(WEB_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${WEB_GENERATED_DIR}")

set(WEB_ASSET_SOURCES
    "${PROJECT_DIR}/web/index.html"
    "${PROJECT_DIR}/web/portal.html"
    "${PROJECT_DIR}/web/css/app.css"
    "${PROJECT_DIR}/web/css/portal.css"
    "${PROJECT_DIR}/web/js/pocket-arcade.js"
    "${PROJECT_DIR}/web/js/app.js"
    "${PROJECT_DIR}/web/assets/icon.svg"
    "${PROJECT_DIR}/web/assets/logo-horizontal.webp"
    "${PROJECT_DIR}/web/assets/portal-horizontal.jpg"
    "${PROJECT_DIR}/web/assets/portal-vertical.jpg"
)

if(NOT CMAKE_BUILD_EARLY_EXPANSION)
    add_custom_command(
        OUTPUT "${WEB_GENERATED_DIR}/web_assets.c"
        COMMAND "${PYTHON}" "${PROJECT_DIR}/tools/prepare_web.py"
                --input "${PROJECT_DIR}/web"
                --output "${WEB_GENERATED_DIR}/web_assets.c"
        DEPENDS "${PROJECT_DIR}/tools/prepare_web.py" ${WEB_ASSET_SOURCES}
        COMMENT "Preparing embedded PocketArcade web assets"
        VERBATIM
    )
endif()

idf_component_register(SRCS "embedded_web.c"
                            "${WEB_GENERATED_DIR}/web_assets.c"
                       INCLUDE_DIRS "include"
                       REQUIRES esp_http_server)
