#include "chat.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "pa_board.h"
#include "storage.h"
#include "system_state.h"

static const char *TAG = "CHAT";
#define CHAT_STORE_PATH PA_SD_MOUNT_POINT "/data/chat/recent.json"
#define CHAT_STORE_RELATIVE "data/chat/recent.json"
#define CHAT_STORE_MAX_BYTES (48 * 1024)

typedef struct {
    bool used;
    char id[PA_CHAT_MESSAGE_ID_LEN + 1];
    char player_id[PA_PROFILE_ID_LEN + 1];
    char nickname[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    char text[PA_CHAT_MAX_TEXT_BYTES + 1];
    uint64_t sent_at;
} chat_message_t;

static chat_message_t messages[PA_CHAT_MAX_MESSAGES];
static size_t message_start;
static size_t message_count;
static SemaphoreHandle_t chat_lock;

static bool decode_utf8(const unsigned char **cursor, const unsigned char *end,
                        uint32_t *codepoint)
{
    const unsigned char *p = *cursor;
    if (p >= end) return false;
    if (*p < 0x80) {
        *codepoint = *p;
        *cursor = p + 1;
        return true;
    }
    int continuation;
    uint32_t value;
    if ((*p & 0xe0) == 0xc0) {
        continuation = 1;
        value = *p & 0x1f;
        if (value < 2) return false;
    } else if ((*p & 0xf0) == 0xe0) {
        continuation = 2;
        value = *p & 0x0f;
    } else if ((*p & 0xf8) == 0xf0) {
        continuation = 3;
        value = *p & 0x07;
    } else {
        return false;
    }
    ++p;
    for (int i = 0; i < continuation; ++i, ++p) {
        if (p >= end || (*p & 0xc0) != 0x80) return false;
        value = (value << 6) | (*p & 0x3f);
    }
    if ((continuation == 2 && value < 0x800) ||
        (continuation == 3 && value < 0x10000) ||
        value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
        return false;
    }
    *codepoint = value;
    *cursor = p;
    return true;
}

static bool validate_text(const char *input,
                          char output[PA_CHAT_MAX_TEXT_BYTES + 1])
{
    if (!input) return false;
    const unsigned char *start = (const unsigned char *)input;
    while (*start == ' ' || *start == '\t') ++start;
    const unsigned char *end = start + strlen((const char *)start);
    while (end > start && (end[-1] == ' ' || end[-1] == '\t')) --end;
    size_t bytes = (size_t)(end - start);
    if (bytes == 0 || bytes > PA_CHAT_MAX_TEXT_BYTES) return false;
    const unsigned char *cursor = start;
    size_t codepoints = 0;
    while (cursor < end) {
        uint32_t cp;
        if (!decode_utf8(&cursor, end, &cp) || cp < 0x20 ||
            (cp >= 0x7f && cp <= 0x9f) ||
            ++codepoints > PA_CHAT_MAX_TEXT_CODEPOINTS) {
            return false;
        }
    }
    memcpy(output, start, bytes);
    output[bytes] = '\0';
    return true;
}

static void random_message_id(char output[PA_CHAT_MESSAGE_ID_LEN + 1])
{
    static const char digits[] = "0123456789abcdef";
    uint8_t random[8];
    esp_fill_random(random, sizeof(random));
    output[0] = 'm';
    output[1] = '_';
    for (size_t i = 0; i < sizeof(random); ++i) {
        output[2 + i * 2] = digits[random[i] >> 4];
        output[3 + i * 2] = digits[random[i] & 0x0f];
    }
    output[PA_CHAT_MESSAGE_ID_LEN] = '\0';
}

static cJSON *message_json(const chat_message_t *message)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "id", message->id);
    cJSON_AddStringToObject(json, "playerId", message->player_id);
    cJSON_AddStringToObject(json, "nickname", message->nickname);
    cJSON_AddStringToObject(json, "text", message->text);
    cJSON_AddNumberToObject(json, "sentAt", (double)message->sent_at);
    return json;
}

static cJSON *messages_array_locked(void)
{
    cJSON *array = cJSON_CreateArray();
    for (size_t i = 0; i < message_count; ++i) {
        size_t index = (message_start + i) % PA_CHAT_MAX_MESSAGES;
        cJSON_AddItemToArray(array, message_json(&messages[index]));
    }
    return array;
}

static char *persistence_text_locked(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "v", 1);
    cJSON_AddItemToObject(root, "messages", messages_array_locked());
    char *text = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return text;
}

static void append_locked(const chat_message_t *message)
{
    size_t index;
    if (message_count < PA_CHAT_MAX_MESSAGES) {
        index = (message_start + message_count) % PA_CHAT_MAX_MESSAGES;
        ++message_count;
    } else {
        index = message_start;
        message_start = (message_start + 1) % PA_CHAT_MAX_MESSAGES;
    }
    messages[index] = *message;
}

static bool valid_loaded_id(const char *id)
{
    if (!id || strlen(id) != PA_CHAT_MESSAGE_ID_LEN ||
        id[0] != 'm' || id[1] != '_') return false;
    for (size_t i = 2; i < PA_CHAT_MESSAGE_ID_LEN; ++i) {
        char c = id[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
            return false;
        }
    }
    return true;
}

static void load_from_sd(void)
{
    if (!storage_is_mounted()) return;
    FILE *file = fopen(CHAT_STORE_PATH, "rb");
    if (!file) {
        ESP_LOGI(TAG, "No saved chat history");
        return;
    }
    fseek(file, 0, SEEK_END);
    long length = ftell(file);
    rewind(file);
    if (length <= 0 || length > CHAT_STORE_MAX_BYTES) {
        fclose(file);
        ESP_LOGW(TAG, "Ignoring invalid chat history size");
        return;
    }
    char *buffer = malloc((size_t)length + 1);
    if (!buffer) {
        fclose(file);
        return;
    }
    bool read_ok = fread(buffer, 1, (size_t)length, file) == (size_t)length;
    fclose(file);
    buffer[length] = '\0';
    cJSON *root = read_ok ? cJSON_ParseWithLength(buffer, (size_t)length) : NULL;
    free(buffer);
    cJSON *array = cJSON_GetObjectItemCaseSensitive(root, "messages");
    if (!root || !cJSON_IsArray(array)) {
        cJSON_Delete(root);
        ESP_LOGW(TAG, "Ignoring malformed chat history");
        return;
    }

    unsigned loaded = 0;
    cJSON *item;
    xSemaphoreTake(chat_lock, portMAX_DELAY);
    cJSON_ArrayForEach(item, array) {
        cJSON *id = cJSON_GetObjectItemCaseSensitive(item, "id");
        cJSON *player_id = cJSON_GetObjectItemCaseSensitive(item, "playerId");
        cJSON *nickname = cJSON_GetObjectItemCaseSensitive(item, "nickname");
        cJSON *text = cJSON_GetObjectItemCaseSensitive(item, "text");
        cJSON *sent_at = cJSON_GetObjectItemCaseSensitive(item, "sentAt");
        chat_message_t message = { .used = true };
        char clean_text[PA_CHAT_MAX_TEXT_BYTES + 1];
        char clean_nickname[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
        bool valid =
            cJSON_IsString(id) && valid_loaded_id(id->valuestring) &&
            cJSON_IsString(player_id) &&
            strlen(player_id->valuestring) == PA_PROFILE_ID_LEN &&
            cJSON_IsString(nickname) &&
            profile_validate_nickname(nickname->valuestring, clean_nickname,
                                      sizeof(clean_nickname)) &&
            cJSON_IsString(text) &&
            validate_text(text->valuestring, clean_text) &&
            cJSON_IsNumber(sent_at);
        if (!valid) continue;
        strlcpy(message.id, id->valuestring, sizeof(message.id));
        strlcpy(message.player_id, player_id->valuestring,
                sizeof(message.player_id));
        strlcpy(message.nickname, clean_nickname, sizeof(message.nickname));
        strlcpy(message.text, clean_text, sizeof(message.text));
        message.sent_at = (uint64_t)sent_at->valuedouble;
        append_locked(&message);
        ++loaded;
    }
    xSemaphoreGive(chat_lock);
    cJSON_Delete(root);
    ESP_LOGI(TAG, "Loaded %u chat messages", loaded);
}

esp_err_t chat_init(void)
{
    chat_lock = xSemaphoreCreateMutex();
    if (!chat_lock) return ESP_ERR_NO_MEM;
    load_from_sd();
    return ESP_OK;
}

chat_result_t chat_send(const public_profile_t *profile, const char *text,
                        cJSON **message_json_out)
{
    if (!profile || !message_json_out) return CHAT_RESULT_INVALID_TEXT;
    chat_message_t message = { .used = true };
    if (!validate_text(text, message.text)) {
        return CHAT_RESULT_INVALID_TEXT;
    }
    random_message_id(message.id);
    strlcpy(message.player_id, profile->id, sizeof(message.player_id));
    strlcpy(message.nickname, profile->nickname, sizeof(message.nickname));
    message.sent_at = system_uptime_ms();

    xSemaphoreTake(chat_lock, portMAX_DELAY);
    append_locked(&message);
    *message_json_out = message_json(&message);
    char *persistence = storage_is_mounted()
                            ? persistence_text_locked() : NULL;
    xSemaphoreGive(chat_lock);

    if (persistence) {
        esp_err_t err = storage_enqueue_atomic_write_owned(
            CHAT_STORE_RELATIVE, persistence, strlen(persistence));
        if (err != ESP_OK) {
            cJSON_free(persistence);
            ESP_LOGW(TAG, "Could not queue chat persistence: %s",
                     esp_err_to_name(err));
        }
    }
    ESP_LOGI(TAG, "Accepted chat message %.18s from %.18s",
             message.id, message.player_id);
    return CHAT_RESULT_OK;
}

cJSON *chat_snapshot_json(void)
{
    xSemaphoreTake(chat_lock, portMAX_DELAY);
    cJSON *array = messages_array_locked();
    xSemaphoreGive(chat_lock);
    return array;
}

const char *chat_result_code(chat_result_t result)
{
    switch (result) {
        case CHAT_RESULT_INVALID_TEXT: return "invalid_chat_message";
        case CHAT_RESULT_STORAGE_ERROR: return "chat_storage_error";
        default: return "ok";
    }
}

const char *chat_result_message(chat_result_t result)
{
    switch (result) {
        case CHAT_RESULT_INVALID_TEXT:
            return "Write a message containing 1 to 160 visible characters.";
        case CHAT_RESULT_STORAGE_ERROR:
            return "The message could not be stored.";
        default:
            return "Chat message accepted.";
    }
}
