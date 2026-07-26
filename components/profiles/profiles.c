#include "profiles.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "device_identity.h"
#include "esp_log.h"
#include "esp_random.h"
#include "psa/crypto.h"
#include "storage.h"
#include "system_state.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "PROFILE";
#define MAX_SESSIONS_PER_PROFILE 4

typedef struct {
    bool used;
    char fingerprint[PA_FINGERPRINT_HEX_LEN + 1];
    uint64_t created_at;
    uint64_t last_seen_at;
} device_binding_t;

typedef struct {
    bool used;
    char hash[PA_FINGERPRINT_HEX_LEN + 1];
    uint64_t created_at;
    uint64_t last_seen_at;
} session_hash_t;

typedef struct {
    bool used;
    public_profile_t public;
    device_binding_t bindings[CONFIG_PA_MAX_DEVICE_BINDINGS];
    session_hash_t sessions[MAX_SESSIONS_PER_PROFILE];
    uint64_t last_mutation;
} profile_record_t;

static profile_record_t records[CONFIG_PA_MAX_PROFILES];
static SemaphoreHandle_t lock;
static profile_change_callback_t change_callback;
static uint64_t last_profile_creation;
static char session_admin_id[PA_PROFILE_ID_LEN + 1];

static void load_profiles_from_sd(void);

static void random_hex(char *output, size_t random_bytes)
{
    static const char digits[] = "0123456789abcdef";
    uint8_t bytes[32];
    if (random_bytes > sizeof(bytes)) {
        random_bytes = sizeof(bytes);
    }
    esp_fill_random(bytes, random_bytes);
    for (size_t i = 0; i < random_bytes; ++i) {
        output[i * 2] = digits[bytes[i] >> 4];
        output[i * 2 + 1] = digits[bytes[i] & 0x0f];
    }
    output[random_bytes * 2] = '\0';
    memset(bytes, 0, sizeof(bytes));
}

static bool is_hex(const char *value, size_t length)
{
    if (!value || strlen(value) != length) {
        return false;
    }
    for (size_t i = 0; i < length; ++i) {
        char c = value[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
              (c >= 'A' && c <= 'F'))) {
            return false;
        }
    }
    return true;
}

static bool valid_profile_id(const char *value)
{
    return value && strlen(value) == PA_PROFILE_ID_LEN &&
           value[0] == 'p' && value[1] == '_' &&
           is_hex(value + 2, PA_PROFILE_ID_LEN - 2);
}

static void hash_token(const char *token,
                       char output[PA_FINGERPRINT_HEX_LEN + 1])
{
    static const char digits[] = "0123456789abcdef";
    unsigned char digest[32];
    size_t digest_length = 0;
    psa_status_t status =
        psa_hash_compute(PSA_ALG_SHA_256, (const uint8_t *)token,
                         strlen(token), digest, sizeof(digest),
                         &digest_length);
    if (status != PSA_SUCCESS || digest_length != sizeof(digest)) {
        memset(output, 0, PA_FINGERPRINT_HEX_LEN + 1);
        memset(digest, 0, sizeof(digest));
        return;
    }
    for (size_t i = 0; i < PA_FINGERPRINT_BYTES; ++i) {
        output[i * 2] = digits[digest[i] >> 4];
        output[i * 2 + 1] = digits[digest[i] & 0x0f];
    }
    output[PA_FINGERPRINT_HEX_LEN] = '\0';
    memset(digest, 0, sizeof(digest));
}

static bool decode_utf8(const unsigned char **cursor, uint32_t *codepoint)
{
    const unsigned char *p = *cursor;
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
        if ((*p & 0xc0) != 0x80) return false;
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

bool profile_validate_nickname(const char *input, char *normalised,
                               size_t normalised_size)
{
    if (!input || !normalised || normalised_size == 0) {
        return false;
    }
    const unsigned char *start = (const unsigned char *)input;
    while (*start == ' ' || *start == '\t' || *start == '\n' || *start == '\r') {
        ++start;
    }
    const unsigned char *end = start + strlen((const char *)start);
    while (end > start &&
           (end[-1] == ' ' || end[-1] == '\t' ||
            end[-1] == '\n' || end[-1] == '\r')) {
        --end;
    }
    size_t bytes = (size_t)(end - start);
    if (bytes == 0 || bytes > CONFIG_PA_MAX_NICKNAME_BYTES ||
        bytes + 1 > normalised_size) {
        return false;
    }
    const unsigned char *cursor = start;
    size_t codepoints = 0;
    while (cursor < end) {
        uint32_t cp;
        const unsigned char *before = cursor;
        if (!decode_utf8(&cursor, &cp) || cursor > end) {
            return false;
        }
        if (cursor == before || cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
            return false;
        }
        if (++codepoints > CONFIG_PA_MAX_NICKNAME_CODEPOINTS) {
            return false;
        }
    }
    memcpy(normalised, start, bytes);
    normalised[bytes] = '\0';
    return true;
}

cJSON *profile_public_json(const public_profile_t *profile)
{
    cJSON *json = cJSON_CreateObject();
    if (!json) return NULL;
    cJSON_AddStringToObject(json, "id", profile->id);
    cJSON_AddStringToObject(json, "nickname", profile->nickname);
    cJSON_AddNumberToObject(json, "createdAt", (double)profile->created_at);
    cJSON_AddNumberToObject(json, "lastSeenAt", (double)profile->last_seen_at);
    if (profile->avatar_url[0]) {
        cJSON_AddStringToObject(json, "avatarUrl", profile->avatar_url);
    } else {
        cJSON_AddNullToObject(json, "avatarUrl");
    }
    if (profile->colour[0]) {
        cJSON_AddStringToObject(json, "colour", profile->colour);
    } else {
        cJSON_AddNullToObject(json, "colour");
    }
    cJSON_AddBoolToObject(json, "persistent", profile->persistent);
    cJSON_AddStringToObject(json, "role",
                            profile->admin ? "admin" : "player");
    cJSON_AddNumberToObject(json, "wins", profile->wins);
    return json;
}

static cJSON *record_internal_json(const profile_record_t *record)
{
    cJSON *json = profile_public_json(&record->public);
    cJSON_DeleteItemFromObjectCaseSensitive(json, "role");
    cJSON *bindings = cJSON_AddArrayToObject(json, "deviceBindings");
    for (size_t i = 0; i < CONFIG_PA_MAX_DEVICE_BINDINGS; ++i) {
        if (!record->bindings[i].used) continue;
        cJSON *binding = cJSON_CreateObject();
        cJSON_AddStringToObject(binding, "type", "wifi-station");
        cJSON_AddStringToObject(binding, "fingerprint",
                                record->bindings[i].fingerprint);
        cJSON_AddNumberToObject(binding, "createdAt",
                                (double)record->bindings[i].created_at);
        cJSON_AddNumberToObject(binding, "lastSeenAt",
                                (double)record->bindings[i].last_seen_at);
        cJSON_AddItemToArray(bindings, binding);
    }
    cJSON *sessions = cJSON_AddArrayToObject(json, "sessionTokenHashes");
    for (size_t i = 0; i < MAX_SESSIONS_PER_PROFILE; ++i) {
        if (!record->sessions[i].used) continue;
        cJSON *session = cJSON_CreateObject();
        cJSON_AddStringToObject(session, "sha256", record->sessions[i].hash);
        cJSON_AddNumberToObject(session, "createdAt",
                                (double)record->sessions[i].created_at);
        cJSON_AddNumberToObject(session, "lastSeenAt",
                                (double)record->sessions[i].last_seen_at);
        cJSON_AddItemToArray(sessions, session);
    }
    return json;
}

static void persist_locked(profile_record_t *record)
{
    if (!record->public.persistent || !storage_is_mounted()) return;
    cJSON *json = record_internal_json(record);
    char *text = json ? cJSON_PrintUnformatted(json) : NULL;
    cJSON_Delete(json);
    if (!text) return;
    char path[96];
    snprintf(path, sizeof(path), "data/profiles/%s.json", record->public.id);
    esp_err_t err =
        storage_enqueue_atomic_write_owned(path, text, strlen(text));
    if (err != ESP_OK) cJSON_free(text);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Profile persistence queue unavailable: %s",
                 esp_err_to_name(err));
    }
}

static bool assign_session_admin_locked(profile_record_t *record)
{
    bool assigned = false;
    if (!session_admin_id[0]) {
        strlcpy(session_admin_id, record->public.id,
                sizeof(session_admin_id));
        assigned = true;
        ESP_LOGI(TAG, "%.18s is administrator for this session",
                 record->public.id);
    }
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (records[i].used) {
            records[i].public.admin =
                strcmp(records[i].public.id, session_admin_id) == 0;
        }
    }
    return assigned;
}

static profile_record_t *find_token_locked(const char *token)
{
    if (!is_hex(token, PA_SESSION_TOKEN_HEX_LEN)) return NULL;
    char hash[PA_FINGERPRINT_HEX_LEN + 1];
    hash_token(token, hash);
    profile_record_t *found = NULL;
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (!records[i].used) continue;
        for (size_t j = 0; j < MAX_SESSIONS_PER_PROFILE; ++j) {
            if (records[i].sessions[j].used &&
                device_identity_constant_time_equal(
                    records[i].sessions[j].hash, hash,
                    PA_FINGERPRINT_HEX_LEN)) {
                records[i].sessions[j].last_seen_at = system_uptime_ms();
                found = &records[i];
            }
        }
    }
    memset(hash, 0, sizeof(hash));
    return found;
}

static profile_record_t *find_binding_locked(const char *fingerprint,
                                             size_t *matches)
{
    *matches = 0;
    profile_record_t *found = NULL;
    if (!is_hex(fingerprint, PA_FINGERPRINT_HEX_LEN)) return NULL;
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (!records[i].used) continue;
        for (size_t j = 0; j < CONFIG_PA_MAX_DEVICE_BINDINGS; ++j) {
            if (records[i].bindings[j].used &&
                device_identity_constant_time_equal(
                    records[i].bindings[j].fingerprint, fingerprint,
                    PA_FINGERPRINT_HEX_LEN)) {
                found = &records[i];
                ++*matches;
                break;
            }
        }
    }
    return found;
}

static void remove_binding_everywhere_locked(const char *fingerprint,
                                             profile_record_t *except)
{
    if (!fingerprint) return;
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (!records[i].used || &records[i] == except) continue;
        bool changed = false;
        for (size_t j = 0; j < CONFIG_PA_MAX_DEVICE_BINDINGS; ++j) {
            if (records[i].bindings[j].used &&
                strcmp(records[i].bindings[j].fingerprint, fingerprint) == 0) {
                memset(&records[i].bindings[j], 0,
                       sizeof(records[i].bindings[j]));
                changed = true;
            }
        }
        if (changed) persist_locked(&records[i]);
    }
}

static void add_binding_locked(profile_record_t *record,
                               const char *fingerprint)
{
    if (!is_hex(fingerprint, PA_FINGERPRINT_HEX_LEN)) return;
    uint64_t now = system_uptime_ms();
    int oldest = 0;
    for (size_t i = 0; i < CONFIG_PA_MAX_DEVICE_BINDINGS; ++i) {
        if (record->bindings[i].used &&
            strcmp(record->bindings[i].fingerprint, fingerprint) == 0) {
            record->bindings[i].last_seen_at = now;
            return;
        }
        if (!record->bindings[i].used) {
            oldest = (int)i;
            goto assign;
        }
        if (record->bindings[i].last_seen_at <
            record->bindings[oldest].last_seen_at) {
            oldest = (int)i;
        }
    }
assign:
    record->bindings[oldest].used = true;
    strlcpy(record->bindings[oldest].fingerprint, fingerprint,
            sizeof(record->bindings[oldest].fingerprint));
    record->bindings[oldest].created_at = now;
    record->bindings[oldest].last_seen_at = now;
}

static void issue_token_locked(profile_record_t *record,
                               char token[PA_SESSION_TOKEN_HEX_LEN + 1])
{
    random_hex(token, 32);
    char hash[PA_FINGERPRINT_HEX_LEN + 1];
    hash_token(token, hash);
    int slot = 0;
    for (int i = 0; i < MAX_SESSIONS_PER_PROFILE; ++i) {
        if (!record->sessions[i].used) {
            slot = i;
            goto assign;
        }
        if (record->sessions[i].last_seen_at <
            record->sessions[slot].last_seen_at) slot = i;
    }
assign:
    record->sessions[slot].used = true;
    strlcpy(record->sessions[slot].hash, hash,
            sizeof(record->sessions[slot].hash));
    record->sessions[slot].created_at = system_uptime_ms();
    record->sessions[slot].last_seen_at = system_uptime_ms();
    memset(hash, 0, sizeof(hash));
}

static bool read_string(cJSON *object, const char *name,
                        char *output, size_t output_size, bool required)
{
    cJSON *value = cJSON_GetObjectItemCaseSensitive(object, name);
    if (cJSON_IsNull(value) && !required) return true;
    if (!cJSON_IsString(value) || !value->valuestring ||
        strlen(value->valuestring) >= output_size) return false;
    strlcpy(output, value->valuestring, output_size);
    return true;
}

static bool load_record_file(const char *path)
{
    FILE *file = fopen(path, "rb");
    if (!file) return false;
    fseek(file, 0, SEEK_END);
    long length = ftell(file);
    rewind(file);
    if (length <= 0 || length > 16384) {
        fclose(file);
        return false;
    }
    char *data = malloc((size_t)length + 1);
    if (!data) {
        fclose(file);
        return false;
    }
    bool ok = fread(data, 1, (size_t)length, file) == (size_t)length;
    fclose(file);
    data[length] = '\0';
    cJSON *json = ok ? cJSON_Parse(data) : NULL;
    free(data);
    if (!json) return false;

    profile_record_t record = { .used = true };
    cJSON *created = cJSON_GetObjectItemCaseSensitive(json, "createdAt");
    cJSON *seen = cJSON_GetObjectItemCaseSensitive(json, "lastSeenAt");
    cJSON *persistent = cJSON_GetObjectItemCaseSensitive(json, "persistent");
    ok = read_string(json, "id", record.public.id,
                     sizeof(record.public.id), true) &&
         read_string(json, "nickname", record.public.nickname,
                     sizeof(record.public.nickname), true) &&
         cJSON_IsNumber(created) && cJSON_IsNumber(seen);
    record.public.created_at = ok ? (uint64_t)created->valuedouble : 0;
    record.public.last_seen_at = ok ? (uint64_t)seen->valuedouble : 0;
    record.public.persistent = !cJSON_IsFalse(persistent);
    record.public.admin = false;
    cJSON *wins = cJSON_GetObjectItemCaseSensitive(json, "wins");
    if (cJSON_IsNumber(wins) && wins->valuedouble >= 0 &&
        wins->valuedouble <= UINT32_MAX) {
        record.public.wins = (uint32_t)wins->valuedouble;
    }
    read_string(json, "avatarUrl", record.public.avatar_url,
                sizeof(record.public.avatar_url), false);
    read_string(json, "colour", record.public.colour,
                sizeof(record.public.colour), false);
    char normalised[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    ok = ok && valid_profile_id(record.public.id) &&
         profile_validate_nickname(record.public.nickname, normalised,
                                   sizeof(normalised));

    cJSON *bindings = cJSON_GetObjectItemCaseSensitive(json, "deviceBindings");
    cJSON *item;
    size_t index = 0;
    cJSON_ArrayForEach(item, bindings) {
        if (index >= CONFIG_PA_MAX_DEVICE_BINDINGS) break;
        cJSON *fingerprint = cJSON_GetObjectItemCaseSensitive(
            item, "fingerprint");
        if (cJSON_IsString(fingerprint) &&
            is_hex(fingerprint->valuestring, PA_FINGERPRINT_HEX_LEN)) {
            record.bindings[index].used = true;
            strlcpy(record.bindings[index].fingerprint,
                    fingerprint->valuestring,
                    sizeof(record.bindings[index].fingerprint));
            cJSON *created_at = cJSON_GetObjectItemCaseSensitive(
                item, "createdAt");
            cJSON *seen_at = cJSON_GetObjectItemCaseSensitive(
                item, "lastSeenAt");
            record.bindings[index].created_at =
                cJSON_IsNumber(created_at) ? (uint64_t)created_at->valuedouble : 0;
            record.bindings[index].last_seen_at =
                cJSON_IsNumber(seen_at) ? (uint64_t)seen_at->valuedouble : 0;
            ++index;
        }
    }
    cJSON *sessions = cJSON_GetObjectItemCaseSensitive(
        json, "sessionTokenHashes");
    index = 0;
    cJSON_ArrayForEach(item, sessions) {
        if (index >= MAX_SESSIONS_PER_PROFILE) break;
        cJSON *hash = cJSON_GetObjectItemCaseSensitive(item, "sha256");
        if (cJSON_IsString(hash) &&
            is_hex(hash->valuestring, PA_FINGERPRINT_HEX_LEN)) {
            record.sessions[index].used = true;
            strlcpy(record.sessions[index].hash, hash->valuestring,
                    sizeof(record.sessions[index].hash));
            ++index;
        }
    }
    cJSON_Delete(json);
    if (!ok) return false;

    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (records[i].used &&
            strcmp(records[i].public.id, record.public.id) == 0) {
            return true;
        }
    }
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (!records[i].used) {
            records[i] = record;
            return true;
        }
    }
    return false;
}

static void load_profiles_from_sd(void)
{
    storage_filesystem_lock();
    if (!storage_is_mounted()) {
        storage_filesystem_unlock();
        return;
    }
    DIR *directory = opendir(PA_SD_MOUNT_POINT "/data/profiles");
    if (!directory) {
        storage_filesystem_unlock();
        return;
    }
    xSemaphoreTake(lock, portMAX_DELAY);
    struct dirent *entry;
    unsigned loaded = 0;
    while ((entry = readdir(directory)) != NULL &&
           loaded < CONFIG_PA_MAX_PROFILES) {
        size_t length = strlen(entry->d_name);
        bool valid_name =
            length == 23 && entry->d_name[0] == 'p' &&
            entry->d_name[1] == '_' &&
            strcmp(entry->d_name + 18, ".json") == 0;
        for (size_t i = 2; valid_name && i < 18; ++i) {
            char c = entry->d_name[i];
            valid_name = (c >= '0' && c <= '9') ||
                         (c >= 'a' && c <= 'f');
        }
        if (!valid_name) {
            continue;
        }
        char path[256];
        snprintf(path, sizeof(path), PA_SD_MOUNT_POINT "/data/profiles/%.23s",
                 entry->d_name);
        if (load_record_file(path)) {
            ++loaded;
        } else {
            ESP_LOGW(TAG, "Ignoring malformed profile file %.64s",
                     entry->d_name);
        }
    }
    closedir(directory);
    xSemaphoreGive(lock);
    storage_filesystem_unlock();
    ESP_LOGI(TAG, "Loaded %u persistent profiles", loaded);
}

static void profile_storage_event(storage_event_t event,
                                  const storage_info_t *info)
{
    (void)info;
    if (event == STORAGE_EVENT_MOUNTED) {
        load_profiles_from_sd();
    }
}

esp_err_t profile_store_init(void)
{
    lock = xSemaphoreCreateMutex();
    if (!lock) return ESP_ERR_NO_MEM;
    storage_set_event_callback(profile_storage_event);
    if (!storage_is_mounted()) {
        ESP_LOGI(TAG, "Profile store is RAM-only");
        return ESP_OK;
    }
    load_profiles_from_sd();
    return ESP_OK;
}

profile_result_t profile_create(const char *nickname, const char *fingerprint,
                                bool replace_binding,
                                public_profile_t *profile,
                                char token[PA_SESSION_TOKEN_HEX_LEN + 1])
{
    char clean[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    if (!profile_validate_nickname(nickname, clean, sizeof(clean))) {
        return PROFILE_RESULT_INVALID_NICKNAME;
    }
    xSemaphoreTake(lock, portMAX_DELAY);
    uint64_t now = system_uptime_ms();
    if (last_profile_creation &&
        now - last_profile_creation < CONFIG_PA_PROFILE_MUTATION_INTERVAL_MS) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_RATE_LIMITED;
    }
    size_t matches;
    profile_record_t *bound = find_binding_locked(fingerprint, &matches);
    if (matches && !replace_binding) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_DEVICE_CONFLICT;
    }
    profile_record_t *record = NULL;
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (!records[i].used) {
            record = &records[i];
            break;
        }
    }
    if (!record) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_LIMIT;
    }
    (void)bound;
    memset(record, 0, sizeof(*record));
    record->used = true;
    strlcpy(record->public.id, "p_", sizeof(record->public.id));
    random_hex(record->public.id + 2, 8);
    strlcpy(record->public.nickname, clean, sizeof(record->public.nickname));
    record->public.created_at = system_uptime_ms();
    record->public.last_seen_at = record->public.created_at;
    record->public.persistent = storage_is_mounted();
    if (replace_binding) remove_binding_everywhere_locked(fingerprint, record);
    add_binding_locked(record, fingerprint);
    issue_token_locked(record, token);
    bool assigned_admin = assign_session_admin_locked(record);
    last_profile_creation = now;
    *profile = record->public;
    persist_locked(record);
    xSemaphoreGive(lock);
    if (assigned_admin && change_callback) change_callback(profile);
    ESP_LOGI(TAG, "Created %.18s (%s)", profile->id,
             profile->persistent ? "persistent" : "temporary");
    return PROFILE_RESULT_OK;
}

profile_result_t profile_restore_token(const char *token,
                                       const char *fingerprint,
                                       public_profile_t *profile)
{
    xSemaphoreTake(lock, portMAX_DELAY);
    profile_record_t *record = find_token_locked(token);
    if (!record) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_INVALID_TOKEN;
    }
    size_t matches;
    profile_record_t *bound = find_binding_locked(fingerprint, &matches);
    if (!matches || bound == record) add_binding_locked(record, fingerprint);
    bool assigned_admin = assign_session_admin_locked(record);
    record->public.last_seen_at = system_uptime_ms();
    *profile = record->public;
    persist_locked(record);
    xSemaphoreGive(lock);
    if (assigned_admin && change_callback) change_callback(profile);
    ESP_LOGI(TAG, "Restored %.18s by session token", profile->id);
    return PROFILE_RESULT_OK;
}

profile_result_t profile_restore_device(
    const char *fingerprint, public_profile_t *profile,
    char new_token[PA_SESSION_TOKEN_HEX_LEN + 1])
{
    xSemaphoreTake(lock, portMAX_DELAY);
    size_t matches;
    profile_record_t *record = find_binding_locked(fingerprint, &matches);
    if (matches == 0) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_NOT_FOUND;
    }
    if (matches != 1) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_AMBIGUOUS;
    }
    record->public.last_seen_at = system_uptime_ms();
    add_binding_locked(record, fingerprint);
    issue_token_locked(record, new_token);
    bool assigned_admin = assign_session_admin_locked(record);
    *profile = record->public;
    persist_locked(record);
    xSemaphoreGive(lock);
    if (assigned_admin && change_callback) change_callback(profile);
    ESP_LOGI(TAG, "Restored %.18s by network-device fingerprint", profile->id);
    return PROFILE_RESULT_OK;
}

profile_result_t profile_update_nickname(
    const char *token, const char *nickname, public_profile_t *profile)
{
    char clean[CONFIG_PA_MAX_NICKNAME_BYTES + 1];
    if (!profile_validate_nickname(nickname, clean, sizeof(clean))) {
        return PROFILE_RESULT_INVALID_NICKNAME;
    }
    xSemaphoreTake(lock, portMAX_DELAY);
    profile_record_t *record = find_token_locked(token);
    if (!record) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_INVALID_TOKEN;
    }
    uint64_t now = system_uptime_ms();
    if (record->last_mutation &&
        now - record->last_mutation <
        CONFIG_PA_PROFILE_MUTATION_INTERVAL_MS) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_RATE_LIMITED;
    }
    strlcpy(record->public.nickname, clean, sizeof(record->public.nickname));
    record->public.last_seen_at = now;
    record->last_mutation = now;
    *profile = record->public;
    persist_locked(record);
    xSemaphoreGive(lock);
    if (change_callback) change_callback(profile);
    ESP_LOGI(TAG, "Updated nickname for %.18s", profile->id);
    return PROFILE_RESULT_OK;
}

profile_result_t profile_set_avatar(const char *token,
                                    public_profile_t *profile)
{
    xSemaphoreTake(lock, portMAX_DELAY);
    profile_record_t *record = find_token_locked(token);
    if (!record) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_INVALID_TOKEN;
    }
    if (!record->public.persistent || !storage_is_mounted()) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_STORAGE_ERROR;
    }
    uint64_t now = system_uptime_ms();
    snprintf(record->public.avatar_url, sizeof(record->public.avatar_url),
             "/api/v1/avatars/%s.jpg", record->public.id);
    record->public.last_seen_at = now;
    record->last_mutation = now;
    *profile = record->public;
    persist_locked(record);
    xSemaphoreGive(lock);
    if (change_callback) change_callback(profile);
    ESP_LOGI(TAG, "Updated profile photo for %.18s", profile->id);
    return PROFILE_RESULT_OK;
}

profile_result_t profile_unbind_device(const char *token,
                                       const char *fingerprint)
{
    if (!is_hex(fingerprint, PA_FINGERPRINT_HEX_LEN)) {
        return PROFILE_RESULT_NOT_FOUND;
    }
    xSemaphoreTake(lock, portMAX_DELAY);
    profile_record_t *record = find_token_locked(token);
    if (!record) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_INVALID_TOKEN;
    }
    if (record->public.persistent && !storage_is_mounted()) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_STORAGE_ERROR;
    }
    bool removed = false;
    for (size_t i = 0; i < CONFIG_PA_MAX_DEVICE_BINDINGS; ++i) {
        if (record->bindings[i].used &&
            strcmp(record->bindings[i].fingerprint, fingerprint) == 0) {
            memset(&record->bindings[i], 0, sizeof(record->bindings[i]));
            removed = true;
        }
    }
    bool has_binding = false;
    for (size_t i = 0; i < CONFIG_PA_MAX_DEVICE_BINDINGS; ++i) {
        has_binding = has_binding || record->bindings[i].used;
    }
    public_profile_t demoted = {0};
    if (record->public.admin && !has_binding) {
        record->public.admin = false;
        session_admin_id[0] = '\0';
        demoted = record->public;
    }
    char profile_id[PA_PROFILE_ID_LEN + 1];
    strlcpy(profile_id, record->public.id, sizeof(profile_id));
    persist_locked(record);
    xSemaphoreGive(lock);
    if (demoted.id[0] && change_callback) change_callback(&demoted);
    ESP_LOGI(TAG, "Current-device binding %s for %.18s",
             removed ? "removed" : "was not present", profile_id);
    return PROFILE_RESULT_OK;
}

profile_result_t profile_delete(const char *token, public_profile_t *deleted)
{
    xSemaphoreTake(lock, portMAX_DELAY);
    profile_record_t *record = find_token_locked(token);
    if (!record) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_INVALID_TOKEN;
    }
    if (record->public.persistent && !storage_is_mounted()) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_STORAGE_ERROR;
    }
    *deleted = record->public;
    bool persistent = record->public.persistent;
    char id[PA_PROFILE_ID_LEN + 1];
    strlcpy(id, record->public.id, sizeof(id));
    if (persistent) {
        char avatar_path[96];
        snprintf(avatar_path, sizeof(avatar_path),
                 "data/avatars/%s.jpg", id);
        if (record->public.avatar_url[0] &&
            storage_enqueue_delete(avatar_path) != ESP_OK) {
            xSemaphoreGive(lock);
            return PROFILE_RESULT_STORAGE_ERROR;
        }
        char profile_path[96];
        snprintf(profile_path, sizeof(profile_path),
                 "data/profiles/%s.json", id);
        if (storage_enqueue_delete(profile_path) != ESP_OK) {
            xSemaphoreGive(lock);
            return PROFILE_RESULT_STORAGE_ERROR;
        }
    }
    bool was_admin =
        session_admin_id[0] &&
        strcmp(session_admin_id, record->public.id) == 0;
    memset(record, 0, sizeof(*record));
    if (was_admin) session_admin_id[0] = '\0';
    xSemaphoreGive(lock);
    ESP_LOGI(TAG, "Deleted %.18s and all bindings/sessions", id);
    return PROFILE_RESULT_OK;
}

bool profile_token_is_admin(const char *token)
{
    xSemaphoreTake(lock, portMAX_DELAY);
    profile_record_t *record = find_token_locked(token);
    bool admin = record && record->public.admin;
    xSemaphoreGive(lock);
    return admin;
}

profile_result_t profile_record_game_win(
    const char *profile_id, const char *application_id,
    public_profile_t *profile)
{
    if (!valid_profile_id(profile_id) || !application_id ||
        !storage_valid_app_id(application_id)) {
        return PROFILE_RESULT_NOT_FOUND;
    }
    xSemaphoreTake(lock, portMAX_DELAY);
    profile_record_t *record = NULL;
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (records[i].used &&
            strcmp(records[i].public.id, profile_id) == 0) {
            record = &records[i];
            break;
        }
    }
    if (!record) {
        xSemaphoreGive(lock);
        return PROFILE_RESULT_NOT_FOUND;
    }
    if (record->public.wins < UINT32_MAX) ++record->public.wins;
    record->public.last_seen_at = system_uptime_ms();
    *profile = record->public;
    persist_locked(record);
    xSemaphoreGive(lock);
    if (change_callback) change_callback(profile);
    ESP_LOGI(TAG, "Recorded %s win %u for %.18s", application_id,
             (unsigned)profile->wins, profile->id);
    return PROFILE_RESULT_OK;
}

cJSON *profile_all_public_json(void)
{
    cJSON *array = cJSON_CreateArray();
    xSemaphoreTake(lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        if (records[i].used) {
            cJSON_AddItemToArray(array, profile_public_json(&records[i].public));
        }
    }
    xSemaphoreGive(lock);
    return array;
}

size_t profile_count(void)
{
    size_t count = 0;
    xSemaphoreTake(lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_MAX_PROFILES; ++i) {
        count += records[i].used ? 1 : 0;
    }
    xSemaphoreGive(lock);
    return count;
}

void profile_set_change_callback(profile_change_callback_t callback)
{
    change_callback = callback;
}

const char *profile_result_code(profile_result_t result)
{
    switch (result) {
        case PROFILE_RESULT_OK: return "ok";
        case PROFILE_RESULT_NOT_FOUND: return "device_not_recognised";
        case PROFILE_RESULT_INVALID_TOKEN: return "invalid_session";
        case PROFILE_RESULT_INVALID_NICKNAME: return "invalid_nickname";
        case PROFILE_RESULT_LIMIT: return "profile_limit_reached";
        case PROFILE_RESULT_DEVICE_CONFLICT: return "device_already_linked";
        case PROFILE_RESULT_AMBIGUOUS: return "device_identity_ambiguous";
        case PROFILE_RESULT_RATE_LIMITED: return "rate_limited";
        case PROFILE_RESULT_STORAGE_ERROR: return "storage_unavailable";
        default: return "storage_error";
    }
}

const char *profile_result_message(profile_result_t result)
{
    switch (result) {
        case PROFILE_RESULT_NOT_FOUND:
            return "No existing player profile is linked to this device.";
        case PROFILE_RESULT_INVALID_TOKEN:
            return "The session token is invalid or expired.";
        case PROFILE_RESULT_INVALID_NICKNAME:
            return "Choose a valid nickname containing 1 to 24 visible characters.";
        case PROFILE_RESULT_LIMIT:
            return "This PocketArcade has reached its profile limit.";
        case PROFILE_RESULT_DEVICE_CONFLICT:
            return "This device is already linked to a profile. Confirm switching first.";
        case PROFILE_RESULT_AMBIGUOUS:
            return "More than one profile matches this device; choose a profile manually.";
        case PROFILE_RESULT_RATE_LIMITED:
            return "Please wait briefly before changing the profile again.";
        case PROFILE_RESULT_STORAGE_ERROR:
            return "Reconnect the SD card before completing this persistent profile operation.";
        default:
            return "The profile operation could not be completed.";
    }
}
