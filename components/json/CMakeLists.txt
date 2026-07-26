# Vendored cJSON v1.7.19 keeps ESP-IDF 6 builds offline and uses the historical
# ESP-IDF component name expected by PocketArcade.
idf_component_register(SRCS "cJSON.c" INCLUDE_DIRS "include")
target_compile_definitions(${COMPONENT_LIB} PRIVATE CJSON_NESTING_LIMIT=32)
