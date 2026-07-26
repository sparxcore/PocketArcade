#pragma once

#include "cJSON.h"
#include "esp_err.h"
#include "profiles.h"

#define PA_CHAT_MAX_MESSAGES 50
#define PA_CHAT_MAX_TEXT_BYTES 320
#define PA_CHAT_MAX_TEXT_CODEPOINTS 160
#define PA_CHAT_MESSAGE_ID_LEN 18

typedef enum {
    CHAT_RESULT_OK,
    CHAT_RESULT_INVALID_TEXT,
    CHAT_RESULT_STORAGE_ERROR
} chat_result_t;

esp_err_t chat_init(void);
chat_result_t chat_send(const public_profile_t *profile, const char *text,
                        cJSON **message);
cJSON *chat_snapshot_json(void);
const char *chat_result_code(chat_result_t result);
const char *chat_result_message(chat_result_t result);
