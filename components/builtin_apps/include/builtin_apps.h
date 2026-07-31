#pragma once

#include <stddef.h>

typedef struct {
    const char *app_id;
    const char *path;
    const char *mime;
    const char *encoding;
    const unsigned char *data;
    size_t length;
} pa_builtin_app_file_t;

size_t pa_builtin_app_count(void);
const char *pa_builtin_app_id(size_t index);
const pa_builtin_app_file_t *pa_builtin_app_file_find(
    const char *app_id, const char *path);
