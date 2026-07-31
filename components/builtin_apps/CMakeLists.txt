set(BUILTIN_APPS_GENERATED_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(MAKE_DIRECTORY "${BUILTIN_APPS_GENERATED_DIR}")

set(TIC_TAC_TOE_APP_DIR
    "${CMAKE_CURRENT_LIST_DIR}/apps/tic-tac-toe"
)

set(BUILTIN_APP_DIRS
    "${TIC_TAC_TOE_APP_DIR}"
)

set(BUILTIN_APP_SOURCES
    "${TIC_TAC_TOE_APP_DIR}/manifest.json"
    "${TIC_TAC_TOE_APP_DIR}/client/app.js"
    "${TIC_TAC_TOE_APP_DIR}/client/app.css"
    "${TIC_TAC_TOE_APP_DIR}/server/main.lua"
    "${TIC_TAC_TOE_APP_DIR}/assets/icon.svg"
    "${TIC_TAC_TOE_APP_DIR}/assets/start-screen.jpg"
)

if(NOT CMAKE_BUILD_EARLY_EXPANSION)
    add_custom_command(
        OUTPUT "${BUILTIN_APPS_GENERATED_DIR}/builtin_app_data.c"
        COMMAND "${PYTHON}" "${PROJECT_DIR}/tools/prepare_builtin_apps.py"
                --app "${TIC_TAC_TOE_APP_DIR}"
                --output "${BUILTIN_APPS_GENERATED_DIR}/builtin_app_data.c"
        DEPENDS "${PROJECT_DIR}/tools/prepare_builtin_apps.py"
                ${BUILTIN_APP_SOURCES}
        COMMENT "Preparing firmware-resident PocketArcade applications"
        VERBATIM
    )
endif()

idf_component_register(
    SRCS "${BUILTIN_APPS_GENERATED_DIR}/builtin_app_data.c"
    INCLUDE_DIRS "include"
)
