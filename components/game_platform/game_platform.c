#include "game_platform.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "app_catalogue.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "game_runtime.h"
#include "pa_board.h"
#include "pa_protocol.h"
#include "profiles.h"
#include "system_state.h"

typedef enum {
    MATCH_CLOSED,
    MATCH_WAITING,
    MATCH_COUNTDOWN,
    MATCH_PLAYING,
    MATCH_FINISHED,
} match_state_t;

typedef struct {
    bool occupied;
    bool ready;
    bool connected;
    public_profile_t profile;
    char controller_id[PA_CONNECTION_ID_LEN + 1];
    uint32_t last_input_sequence;
    uint32_t last_processed_sequence;
    uint64_t rate_window_started_ms;
    unsigned rate_count;
    uint64_t disconnect_deadline_ms;
} game_seat_t;

typedef struct {
    bool occupied;
    public_profile_t profile;
} game_spectator_t;

typedef struct {
    bool used;
    char connection_id[PA_CONNECTION_ID_LEN + 1];
    char profile_id[PA_PROFILE_ID_LEN + 1];
} game_connection_t;

typedef struct {
    bool used;
    char id[PA_MATCH_ID_MAX + 1];
    app_descriptor_t application;
    match_state_t state;
    game_seat_t seats[CONFIG_PA_GAME_MAX_PLAYERS];
    game_spectator_t spectators[CONFIG_PA_GAME_MAX_SPECTATORS];
    game_runtime_t runtime;
    uint64_t revision;
    uint64_t created_ms;
    uint64_t next_tick_ms;
    uint64_t next_snapshot_ms;
    uint32_t tick_interval_ms;
    uint32_t snapshot_interval_ms;
    uint32_t dropped_ticks;
    uint32_t tick_overruns;
    uint64_t last_snapshot_broadcast_ms;
    bool result_recorded;
    bool snapshot_available;
    bool snapshot_pending;
    char snapshot_json[CONFIG_PA_GAME_MAX_SNAPSHOT_BYTES + 1];
} game_match_t;

typedef enum {
    WORK_LOAD,
    WORK_PLAYER_JOINED,
    WORK_PLAYER_LEFT,
    WORK_PLAYER_UPDATED,
    WORK_COMMAND,
    WORK_SNAPSHOT,
    WORK_UNLOAD,
} work_kind_t;

typedef struct {
    work_kind_t kind;
    char match_id[PA_MATCH_ID_MAX + 1];
    public_profile_t profile;
    char connection_id[PA_CONNECTION_ID_LEN + 1];
    char action[PA_GAME_ACTION_MAX + 1];
    char data[CONFIG_PA_GAME_MAX_COMMAND_BYTES + 1];
    uint32_t input_sequence;
} game_work_t;

typedef struct {
    bool used;
    game_work_t work;
} game_work_slot_t;

typedef struct {
    uint8_t seat;
    uint8_t place;
    public_profile_t profile;
} result_placement_t;

static SemaphoreHandle_t platform_lock;
static SemaphoreHandle_t work_pool_lock;
static QueueHandle_t work_queue;
static game_work_slot_t *work_pool;
static game_platform_transport_fn send_transport;
static game_platform_binary_transport_fn send_binary_transport;
static game_match_t matches[CONFIG_PA_GAME_MAX_MATCHES];
static game_connection_t connections[CONFIG_PA_WS_MAX_CONNECTIONS];
static const char *TAG = "GAME_PLATFORM";

static uint32_t game_handle(const char *text)
{
    uint32_t hash = UINT32_C(2166136261);
    for (const unsigned char *p = (const unsigned char *)text;
         p && *p; ++p) {
        hash ^= *p;
        hash *= UINT32_C(16777619);
    }
    return hash;
}

static void put_u32_be(uint8_t *output, uint32_t value)
{
    output[0] = (uint8_t)(value >> 24);
    output[1] = (uint8_t)(value >> 16);
    output[2] = (uint8_t)(value >> 8);
    output[3] = (uint8_t)value;
}

static void put_u64_be(uint8_t *output, uint64_t value)
{
    put_u32_be(output, (uint32_t)(value >> 32));
    put_u32_be(output + 4, (uint32_t)value);
}

static const char *state_name(match_state_t state)
{
    switch (state) {
        case MATCH_WAITING: return "waiting";
        case MATCH_COUNTDOWN: return "countdown";
        case MATCH_PLAYING: return "playing";
        case MATCH_FINISHED: return "finished";
        default: return "closed";
    }
}

static void random_match_id(char output[PA_MATCH_ID_MAX + 1])
{
    snprintf(output, PA_MATCH_ID_MAX + 1, "m_%08lx",
             (unsigned long)esp_random());
}

static game_match_t *find_match_locked(const char *match_id)
{
    if (!match_id) return NULL;
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
        if (matches[i].used && strcmp(matches[i].id, match_id) == 0) {
            return &matches[i];
        }
    }
    return NULL;
}

static game_match_t *find_app_match_locked(const char *app_id)
{
    if (!app_id) return NULL;
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
        if (matches[i].used &&
            strcmp(matches[i].application.id, app_id) == 0 &&
            matches[i].state != MATCH_FINISHED) {
            return &matches[i];
        }
    }
    return NULL;
}

static game_seat_t *find_seat_locked(game_match_t *match,
                                     const char *profile_id)
{
    if (!match || !profile_id) return NULL;
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_PLAYERS; ++i) {
        if (match->seats[i].occupied &&
            strcmp(match->seats[i].profile.id, profile_id) == 0) {
            return &match->seats[i];
        }
    }
    return NULL;
}

static game_spectator_t *find_spectator_locked(game_match_t *match,
                                               const char *profile_id)
{
    if (!match || !profile_id) return NULL;
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_SPECTATORS; ++i) {
        if (match->spectators[i].occupied &&
            strcmp(match->spectators[i].profile.id, profile_id) == 0) {
            return &match->spectators[i];
        }
    }
    return NULL;
}

static game_connection_t *find_connection_locked(const char *connection_id)
{
    if (!connection_id) return NULL;
    for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
        if (connections[i].used &&
            strcmp(connections[i].connection_id, connection_id) == 0) {
            return &connections[i];
        }
    }
    return NULL;
}

static bool connection_belongs_to_locked(const char *connection_id,
                                         const char *profile_id)
{
    game_connection_t *connection =
        find_connection_locked(connection_id);
    return connection &&
           strcmp(connection->profile_id, profile_id) == 0;
}

static size_t player_count_locked(const game_match_t *match)
{
    size_t count = 0;
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_PLAYERS; ++i) {
        if (match->seats[i].occupied) ++count;
    }
    return count;
}

static bool all_players_ready_locked(const game_match_t *match)
{
    size_t count = 0;
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_PLAYERS; ++i) {
        if (!match->seats[i].occupied) continue;
        ++count;
        if (!match->seats[i].ready) return false;
    }
    return count >= match->application.min_players;
}

static void configure_schedule_locked(game_match_t *match, uint64_t now)
{
    if (match->state != MATCH_PLAYING ||
        match->application.runtime_mode != APP_RUNTIME_TICK ||
        !match->application.tick_rate_hz) {
        match->next_tick_ms = 0;
        match->next_snapshot_ms = 0;
        match->tick_interval_ms = 0;
        match->snapshot_interval_ms = 0;
        return;
    }
    uint32_t tick_rate = match->application.tick_rate_hz;
    uint32_t snapshot_rate =
        tick_rate < CONFIG_PA_GAME_MAX_SNAPSHOT_RATE_HZ
            ? tick_rate : CONFIG_PA_GAME_MAX_SNAPSHOT_RATE_HZ;
    match->tick_interval_ms = (1000U + tick_rate - 1U) / tick_rate;
    match->snapshot_interval_ms =
        (1000U + snapshot_rate - 1U) / snapshot_rate;
    match->next_tick_ms = now + match->tick_interval_ms;
    match->next_snapshot_ms = now + match->snapshot_interval_ms;
}

static void update_lifecycle_locked(game_match_t *match)
{
    if (match->state == MATCH_FINISHED) return;
    match_state_t previous = match->state;
    if (all_players_ready_locked(match)) {
        match->state = MATCH_PLAYING;
    } else {
        match->state = MATCH_WAITING;
    }
    if (previous != match->state) {
        ++match->revision;
        configure_schedule_locked(match, system_uptime_ms());
    }
}

static cJSON *profile_brief_json(const public_profile_t *profile)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "profileId", profile->id);
    cJSON_AddStringToObject(json, "nickname", profile->nickname);
    cJSON_AddNumberToObject(json, "wins", profile->wins);
    if (profile->avatar_url[0]) {
        cJSON_AddStringToObject(json, "avatarUrl", profile->avatar_url);
    } else {
        cJSON_AddNullToObject(json, "avatarUrl");
    }
    return json;
}

static cJSON *match_message_locked(const game_match_t *match,
                                   const char *profile_id,
                                   const char *connection_id)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddStringToObject(json, "appId", match->application.id);
    cJSON_AddStringToObject(json, "appVersion", match->application.version);
    cJSON_AddStringToObject(json, "matchId", match->id);
    cJSON_AddNumberToObject(json, "appHandle",
                            (double)game_handle(match->application.id));
    cJSON_AddNumberToObject(json, "matchHandle",
                            (double)game_handle(match->id));
    cJSON_AddStringToObject(json, "state", state_name(match->state));
    cJSON_AddNumberToObject(json, "revision", (double)match->revision);

    cJSON *seats = cJSON_AddArrayToObject(json, "seats");
    int own_seat = 0;
    bool controller = false;
    for (size_t i = 0; i < match->application.max_players; ++i) {
        cJSON *seat_json = cJSON_CreateObject();
        cJSON_AddNumberToObject(seat_json, "seat", i + 1);
        const game_seat_t *seat = &match->seats[i];
        cJSON_AddBoolToObject(seat_json, "ready",
                              seat->occupied && seat->ready);
        cJSON_AddBoolToObject(seat_json, "connected",
                              seat->occupied && seat->connected);
        if (seat->occupied) {
            cJSON_AddItemToObject(
                seat_json, "player", profile_brief_json(&seat->profile));
            if (strcmp(seat->profile.id, profile_id) == 0) {
                own_seat = (int)i + 1;
                controller =
                    strcmp(seat->controller_id, connection_id) == 0;
            }
        } else {
            cJSON_AddNullToObject(seat_json, "player");
        }
        cJSON_AddItemToArray(seats, seat_json);
    }

    cJSON *spectators = cJSON_AddArrayToObject(json, "spectators");
    bool own_spectator = false;
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_SPECTATORS; ++i) {
        if (!match->spectators[i].occupied) continue;
        cJSON_AddItemToArray(
            spectators, profile_brief_json(&match->spectators[i].profile));
        if (strcmp(match->spectators[i].profile.id, profile_id) == 0) {
            own_spectator = true;
        }
    }
    cJSON *you = cJSON_AddObjectToObject(json, "you");
    cJSON_AddStringToObject(you, "role",
                            own_seat ? "player"
                                     : own_spectator ? "spectator" : "none");
    if (own_seat) cJSON_AddNumberToObject(you, "seat", own_seat);
    else cJSON_AddNullToObject(you, "seat");
    cJSON_AddBoolToObject(you, "controller", controller);
    return json;
}

static bool profile_is_member_locked(const game_match_t *match,
                                     const char *profile_id)
{
    return find_seat_locked((game_match_t *)match, profile_id) ||
           find_spectator_locked((game_match_t *)match, profile_id);
}

static void send_match_to_members(const char *match_id)
{
    struct {
        char connection_id[PA_CONNECTION_ID_LEN + 1];
        cJSON *payload;
    } pending[CONFIG_PA_WS_MAX_CONNECTIONS];
    size_t count = 0;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    if (match) {
        for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
            game_connection_t *connection = &connections[i];
            if (!connection->used ||
                !profile_is_member_locked(match, connection->profile_id)) {
                continue;
            }
            strlcpy(pending[count].connection_id,
                    connection->connection_id,
                    sizeof(pending[count].connection_id));
            pending[count].payload =
                match_message_locked(match, connection->profile_id,
                                     connection->connection_id);
            ++count;
        }
    }
    xSemaphoreGive(platform_lock);
    for (size_t i = 0; i < count; ++i) {
        send_transport(pending[i].connection_id, PA_TYPE_GAME_MATCH,
                       pending[i].payload);
    }
}

static void send_match_to_connection(const char *match_id,
                                     const char *profile_id,
                                     const char *connection_id)
{
    cJSON *payload = NULL;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    if (match) {
        payload = match_message_locked(match, profile_id, connection_id);
    }
    xSemaphoreGive(platform_lock);
    if (payload) {
        send_transport(connection_id, PA_TYPE_GAME_MATCH, payload);
    }
}

static void send_error(const char *connection_id,
                       game_platform_result_t result,
                       const char *match_id)
{
    cJSON *payload = cJSON_CreateObject();
    if (match_id) {
        char app_id[PA_APP_ID_MAX + 1] = {0};
        xSemaphoreTake(platform_lock, portMAX_DELAY);
        game_match_t *match = find_match_locked(match_id);
        if (match) {
            strlcpy(app_id, match->application.id, sizeof(app_id));
        }
        xSemaphoreGive(platform_lock);
        if (app_id[0]) cJSON_AddStringToObject(payload, "appId", app_id);
        cJSON_AddStringToObject(payload, "matchId", match_id);
    }
    cJSON_AddStringToObject(payload, "code",
                            game_platform_result_code(result));
    cJSON_AddStringToObject(payload, "message",
                            game_platform_result_message(result));
    send_transport(connection_id, PA_TYPE_GAME_ERROR, payload);
}

typedef struct {
    const char *data;
    char *owned;
    size_t length;
} bounded_payload_t;

static bool encode_bounded_payload(const cJSON *payload,
                                   bounded_payload_t *encoded)
{
    memset(encoded, 0, sizeof(*encoded));
    if (cJSON_IsRaw(payload) && payload->valuestring) {
        encoded->data = payload->valuestring;
    } else {
        encoded->owned =
            payload ? cJSON_PrintUnformatted(payload) : NULL;
        encoded->data = encoded->owned;
    }
    if (!encoded->data) return false;
    encoded->length = strlen(encoded->data);
    if (encoded->length > CONFIG_PA_GAME_MAX_SNAPSHOT_BYTES) {
        cJSON_free(encoded->owned);
        memset(encoded, 0, sizeof(*encoded));
        return false;
    }
    return true;
}

static void release_bounded_payload(bounded_payload_t *encoded)
{
    if (!encoded) return;
    cJSON_free(encoded->owned);
    memset(encoded, 0, sizeof(*encoded));
}

static esp_err_t cache_snapshot(const char *match_id, const cJSON *payload)
{
    bounded_payload_t encoded;
    if (!encode_bounded_payload(payload, &encoded)) {
        return ESP_ERR_INVALID_SIZE;
    }
    esp_err_t result = ESP_ERR_NOT_FOUND;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    if (match) {
        strlcpy(match->snapshot_json, encoded.data,
                sizeof(match->snapshot_json));
        match->snapshot_available = true;
        result = ESP_OK;
    }
    xSemaphoreGive(platform_lock);
    release_bounded_payload(&encoded);
    return result;
}

static void send_snapshot_payload(const char *match_id,
                                  const char *only_connection_id,
                                  const char *only_profile_id,
                                  const cJSON *game_payload)
{
    struct {
        char connection_id[PA_CONNECTION_ID_LEN + 1];
        uint32_t acknowledged_input_sequence;
    } recipients[CONFIG_PA_WS_MAX_CONNECTIONS];
    size_t count = 0;
    char app_id[PA_APP_ID_MAX + 1] = {0};
    uint64_t revision = 0;
    bool compact_binary = false;

    bounded_payload_t encoded;
    if (!encode_bounded_payload(game_payload, &encoded)) return;
    size_t encoded_length = encoded.length;

    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    if (match) {
        strlcpy(app_id, match->application.id, sizeof(app_id));
        revision = match->revision;
        compact_binary =
            match->application.runtime_mode == APP_RUNTIME_TICK &&
            send_binary_transport != NULL;
        for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
            game_connection_t *connection = &connections[i];
            if (!connection->used ||
                (only_connection_id &&
                 strcmp(connection->connection_id,
                        only_connection_id) != 0) ||
                (only_profile_id &&
                 strcmp(connection->profile_id, only_profile_id) != 0) ||
                !profile_is_member_locked(match, connection->profile_id)) {
                continue;
            }
            strlcpy(recipients[count].connection_id,
                    connection->connection_id,
                    sizeof(recipients[count].connection_id));
            game_seat_t *seat =
                find_seat_locked(match, connection->profile_id);
            recipients[count].acknowledged_input_sequence =
                seat ? seat->last_processed_sequence : 0;
            ++count;
        }
    }
    xSemaphoreGive(platform_lock);

    uint64_t server_tick = system_uptime_ms();
    for (size_t i = 0; i < count; ++i) {
        if (compact_binary) {
            size_t frame_length =
                PA_GAME_BINARY_HEADER_BYTES + encoded_length;
            uint8_t *frame = malloc(frame_length);
            if (!frame) continue;
            frame[0] = PA_GAME_BINARY_VERSION;
            frame[1] = PA_GAME_BINARY_KIND_SNAPSHOT;
            frame[2] = PA_GAME_BINARY_FLAG_FULL_SNAPSHOT;
            frame[3] = 0;
            put_u32_be(frame + 4, game_handle(app_id));
            put_u32_be(frame + 8, game_handle(match_id));
            put_u64_be(frame + 12, revision);
            put_u64_be(frame + 20, server_tick);
            put_u32_be(
                frame + 28,
                recipients[i].acknowledged_input_sequence);
            put_u32_be(frame + 32, (uint32_t)encoded_length);
            memcpy(frame + PA_GAME_BINARY_HEADER_BYTES,
                   encoded.data, encoded_length);
            send_binary_transport(recipients[i].connection_id,
                                  frame, frame_length);
            continue;
        }
        cJSON *envelope = cJSON_CreateObject();
        cJSON_AddStringToObject(envelope, "appId", app_id);
        cJSON_AddStringToObject(envelope, "matchId", match_id);
        cJSON_AddNumberToObject(envelope, "revision", (double)revision);
        cJSON_AddNumberToObject(envelope, "serverTick",
                                (double)server_tick);
        cJSON_AddNumberToObject(
            envelope, "ackInputSeq",
            recipients[i].acknowledged_input_sequence);
        cJSON_AddItemToObject(envelope, "payload",
                              cJSON_Duplicate(game_payload, true));
        send_transport(recipients[i].connection_id, PA_TYPE_GAME_SNAPSHOT,
                       envelope);
    }
    release_bounded_payload(&encoded);
}

static void send_snapshot_to_members(const char *match_id,
                                     const char *only_connection_id)
{
    cJSON *snapshot = NULL;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    if (match && match->snapshot_available) {
        /*
         * Cached snapshots are already validated JSON. Keep them opaque
         * instead of rebuilding a cJSON node for every nested game field.
         */
        snapshot = cJSON_CreateRaw(match->snapshot_json);
    }
    xSemaphoreGive(platform_lock);
    if (snapshot) {
        send_snapshot_payload(match_id, only_connection_id, NULL, snapshot);
        cJSON_Delete(snapshot);
    }
}

static void broadcast_runtime_message(game_match_t *context,
                                      const char *message_type,
                                      const char *event_name,
                                      const cJSON *payload)
{
    char connection_ids[CONFIG_PA_WS_MAX_CONNECTIONS]
                       [PA_CONNECTION_ID_LEN + 1] = {{0}};
    char app_id[PA_APP_ID_MAX + 1] = {0};
    char match_id[PA_MATCH_ID_MAX + 1] = {0};
    uint64_t revision = 0;
    size_t count = 0;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    if (context->used) {
        strlcpy(app_id, context->application.id, sizeof(app_id));
        strlcpy(match_id, context->id, sizeof(match_id));
        revision = context->revision;
        for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
            if (connections[i].used &&
                profile_is_member_locked(context,
                                         connections[i].profile_id)) {
                strlcpy(connection_ids[count++],
                        connections[i].connection_id,
                        sizeof(connection_ids[0]));
            }
        }
    }
    xSemaphoreGive(platform_lock);
    for (size_t i = 0; i < count; ++i) {
        cJSON *envelope = cJSON_CreateObject();
        cJSON_AddStringToObject(envelope, "appId", app_id);
        cJSON_AddStringToObject(envelope, "matchId", match_id);
        cJSON_AddNumberToObject(envelope, "revision", (double)revision);
        cJSON_AddNumberToObject(envelope, "serverTick",
                                (double)system_uptime_ms());
        if (event_name) {
            cJSON_AddStringToObject(envelope, "name", event_name);
        }
        cJSON_AddItemToObject(envelope, "payload",
                              cJSON_Duplicate(payload, true));
        send_transport(connection_ids[i], message_type, envelope);
    }
}

static size_t runtime_players(void *context, game_runtime_player_t *output,
                              size_t capacity)
{
    game_match_t *match = context;
    size_t count = 0;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    if (match->used && output) {
        for (size_t i = 0; i < match->application.max_players; ++i) {
            if (!match->seats[i].occupied) continue;
            if (count >= capacity) {
                count = capacity + 1;
                break;
            }
            strlcpy(output[count].profile_id,
                    match->seats[i].profile.id,
                    sizeof(output[count].profile_id));
            strlcpy(output[count].nickname,
                    match->seats[i].profile.nickname,
                    sizeof(output[count].nickname));
            output[count].wins = match->seats[i].profile.wins;
            output[count].seat = (uint8_t)(i + 1);
            output[count].connected = match->seats[i].connected;
            ++count;
        }
    }
    xSemaphoreGive(platform_lock);
    return count;
}

static const char *runtime_match_state(void *context)
{
    game_match_t *match = context;
    match_state_t state;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    state = match->used ? match->state : MATCH_CLOSED;
    xSemaphoreGive(platform_lock);
    return state_name(state);
}

static esp_err_t runtime_start_countdown(void *context)
{
    game_match_t *match = context;
    char match_id[PA_MATCH_ID_MAX + 1] = {0};
    esp_err_t result = ESP_ERR_INVALID_STATE;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    if (match->used &&
        (match->state == MATCH_WAITING ||
         match->state == MATCH_COUNTDOWN ||
         match->state == MATCH_PLAYING)) {
        if (match->state != MATCH_COUNTDOWN) {
            if (match->state == MATCH_WAITING) {
                match->state = MATCH_COUNTDOWN;
                ++match->revision;
            }
        }
        strlcpy(match_id, match->id, sizeof(match_id));
        result = ESP_OK;
    }
    xSemaphoreGive(platform_lock);
    if (result == ESP_OK) send_match_to_members(match_id);
    return result;
}

static bool validate_result_locked(
    const game_match_t *match, const cJSON *result_payload,
    result_placement_t *placements, size_t *placement_count, bool *draw)
{
    if (!match || !cJSON_IsObject(result_payload) || !placements ||
        !placement_count || !draw) {
        return false;
    }
    cJSON *draw_json =
        cJSON_GetObjectItemCaseSensitive(result_payload, "draw");
    if (draw_json && !cJSON_IsBool(draw_json)) return false;
    *draw = cJSON_IsTrue(draw_json);

    cJSON *array =
        cJSON_GetObjectItemCaseSensitive(result_payload, "placements");
    size_t players = player_count_locked(match);
    if (!cJSON_IsArray(array) || players == 0 ||
        (size_t)cJSON_GetArraySize(array) != players) {
        return false;
    }

    bool seen[CONFIG_PA_GAME_MAX_PLAYERS] = {false};
    bool first_place = false;
    size_t count = 0;
    cJSON *entry;
    cJSON_ArrayForEach(entry, array) {
        cJSON *seat_json =
            cJSON_GetObjectItemCaseSensitive(entry, "seat");
        cJSON *place_json =
            cJSON_GetObjectItemCaseSensitive(entry, "place");
        if (!cJSON_IsObject(entry) || !cJSON_IsNumber(seat_json) ||
            !cJSON_IsNumber(place_json) ||
            seat_json->valuedouble != seat_json->valueint ||
            place_json->valuedouble != place_json->valueint ||
            seat_json->valueint < 1 ||
            seat_json->valueint > match->application.max_players ||
            place_json->valueint < 1 ||
            (size_t)place_json->valueint > players) {
            return false;
        }
        size_t seat_index = (size_t)seat_json->valueint - 1;
        if (seen[seat_index] || !match->seats[seat_index].occupied) {
            return false;
        }
        seen[seat_index] = true;
        placements[count].seat = (uint8_t)seat_json->valueint;
        placements[count].place = (uint8_t)place_json->valueint;
        placements[count].profile = match->seats[seat_index].profile;
        first_place = first_place || place_json->valueint == 1;
        ++count;
    }
    if (!first_place) return false;
    if (*draw) {
        for (size_t i = 0; i < count; ++i) {
            if (placements[i].place != 1) return false;
        }
    }
    *placement_count = count;
    return true;
}

static cJSON *validated_result_json(
    const char *result_id, bool draw,
    const result_placement_t *placements, size_t placement_count)
{
    cJSON *result = cJSON_CreateObject();
    if (!result) return NULL;
    cJSON_AddStringToObject(result, "resultId", result_id);
    cJSON_AddBoolToObject(result, "draw", draw);
    cJSON *array = cJSON_AddArrayToObject(result, "placements");
    if (!array) {
        cJSON_Delete(result);
        return NULL;
    }
    for (size_t i = 0; i < placement_count; ++i) {
        cJSON *entry = cJSON_CreateObject();
        if (!entry) {
            cJSON_Delete(result);
            return NULL;
        }
        cJSON_AddNumberToObject(entry, "seat", placements[i].seat);
        cJSON_AddNumberToObject(entry, "place", placements[i].place);
        cJSON_AddStringToObject(entry, "profileId",
                                placements[i].profile.id);
        cJSON_AddStringToObject(entry, "nickname",
                                placements[i].profile.nickname);
        cJSON_AddNumberToObject(entry, "wins",
                                placements[i].profile.wins);
        cJSON_AddItemToArray(array, entry);
    }
    return result;
}

static esp_err_t runtime_finish(void *context, const cJSON *result_payload)
{
    game_match_t *match = context;
    bounded_payload_t encoded;
    if (!encode_bounded_payload(result_payload, &encoded)) {
        return ESP_ERR_INVALID_SIZE;
    }
    release_bounded_payload(&encoded);

    result_placement_t *placements =
        calloc(CONFIG_PA_GAME_MAX_PLAYERS, sizeof(*placements));
    if (!placements) return ESP_ERR_NO_MEM;
    size_t placement_count = 0;
    bool draw = false;
    char app_id[PA_APP_ID_MAX + 1] = {0};
    char match_id[PA_MATCH_ID_MAX + 1] = {0};
    char result_id[PA_MATCH_ID_MAX + 3] = {0};
    bool flush_pending_snapshot = false;
    esp_err_t result = ESP_ERR_INVALID_STATE;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    if (match->used && !match->result_recorded &&
        match->state != MATCH_FINISHED &&
        validate_result_locked(match, result_payload, placements,
                               &placement_count, &draw)) {
        match->result_recorded = true;
        match->state = MATCH_FINISHED;
        ++match->revision;
        strlcpy(app_id, match->application.id, sizeof(app_id));
        strlcpy(match_id, match->id, sizeof(match_id));
        snprintf(result_id, sizeof(result_id), "r_%s",
                 match->id[0] && match->id[1] ? match->id + 2 : match->id);
        flush_pending_snapshot = match->snapshot_pending;
        match->snapshot_pending = false;
        result = ESP_OK;
    }
    xSemaphoreGive(platform_lock);
    if (result == ESP_OK) {
        /*
         * An explicit final snapshot may have arrived inside the tick-mode
         * rate window. Flush the cached state before the critical result so
         * clients never render the result ahead of the final board.
         */
        if (flush_pending_snapshot) {
            send_snapshot_to_members(match_id, NULL);
        }
        if (!draw) {
            for (size_t i = 0; i < placement_count; ++i) {
                if (placements[i].place != 1) continue;
                public_profile_t updated = {0};
                if (profile_record_game_win(
                        placements[i].profile.id, app_id,
                        &updated) == PROFILE_RESULT_OK) {
                    placements[i].profile = updated;
                } else {
                    ESP_LOGW(TAG, "Could not record result %s for %.18s",
                             result_id, placements[i].profile.id);
                }
            }
        }
        cJSON *validated = validated_result_json(
            result_id, draw, placements, placement_count);
        if (validated) {
            broadcast_runtime_message(match, PA_TYPE_GAME_RESULT, NULL,
                                      validated);
            cJSON_Delete(validated);
        }
        send_match_to_members(match_id);
        ESP_LOGI(TAG, "Recorded result %s for match %s",
                 result_id, match_id);
    }
    free(placements);
    return result;
}

static esp_err_t runtime_broadcast_snapshot(void *context,
                                            const cJSON *payload)
{
    game_match_t *match = context;
    char match_id[PA_MATCH_ID_MAX + 1] = {0};
    bool send_now = false;
    uint64_t now = system_uptime_ms();

    bounded_payload_t encoded;
    if (!encode_bounded_payload(payload, &encoded)) {
        return ESP_ERR_INVALID_SIZE;
    }
    release_bounded_payload(&encoded);

    xSemaphoreTake(platform_lock, portMAX_DELAY);
    if (match->used && match->state != MATCH_FINISHED) {
        ++match->revision;
        strlcpy(match_id, match->id, sizeof(match_id));
        send_now =
            match->application.runtime_mode != APP_RUNTIME_TICK ||
            !match->snapshot_interval_ms ||
            !match->last_snapshot_broadcast_ms ||
            now - match->last_snapshot_broadcast_ms >=
                match->snapshot_interval_ms;
        if (send_now) {
            match->last_snapshot_broadcast_ms = now;
            match->snapshot_pending = false;
        } else {
            match->snapshot_pending = true;
        }
    }
    xSemaphoreGive(platform_lock);
    if (!match_id[0]) return ESP_ERR_INVALID_STATE;
    esp_err_t result = cache_snapshot(match_id, payload);
    if (result == ESP_OK && send_now) {
        send_snapshot_payload(match_id, NULL, NULL, payload);
    }
    return result;
}

static esp_err_t runtime_send_snapshot(void *context,
                                       const char *profile_id,
                                       const cJSON *payload)
{
    game_match_t *match = context;
    char match_id[PA_MATCH_ID_MAX + 1] = {0};
    bool member = false;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    if (match->used && profile_is_member_locked(match, profile_id)) {
        strlcpy(match_id, match->id, sizeof(match_id));
        member = true;
    }
    xSemaphoreGive(platform_lock);
    if (!member) return ESP_ERR_NOT_FOUND;
    bounded_payload_t encoded;
    if (!encode_bounded_payload(payload, &encoded)) {
        return ESP_ERR_INVALID_SIZE;
    }
    release_bounded_payload(&encoded);
    send_snapshot_payload(match_id, NULL, profile_id, payload);
    return ESP_OK;
}

static esp_err_t runtime_broadcast_event(void *context, const char *name,
                                         const cJSON *payload)
{
    game_match_t *match = context;
    bounded_payload_t encoded;
    if (!encode_bounded_payload(payload, &encoded)) {
        return ESP_ERR_INVALID_SIZE;
    }
    release_bounded_payload(&encoded);
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    bool active = match->used && match->state != MATCH_FINISHED;
    if (active) ++match->revision;
    xSemaphoreGive(platform_lock);
    if (!active) return ESP_ERR_INVALID_STATE;
    broadcast_runtime_message(match, PA_TYPE_GAME_EVENT, name, payload);
    return ESP_OK;
}

static game_runtime_host_t runtime_host(game_match_t *match)
{
    return (game_runtime_host_t) {
        .context = match,
        .players = runtime_players,
        .match_state = runtime_match_state,
        .start_countdown = runtime_start_countdown,
        .finish = runtime_finish,
        .broadcast_snapshot = runtime_broadcast_snapshot,
        .send_snapshot = runtime_send_snapshot,
        .broadcast_event = runtime_broadcast_event,
    };
}

static game_work_t *acquire_work(work_kind_t kind)
{
    if (!work_pool_lock || !work_pool) return NULL;
    game_work_t *work = NULL;
    xSemaphoreTake(work_pool_lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_GAME_COMMAND_QUEUE_LENGTH; ++i) {
        if (work_pool[i].used) continue;
        work_pool[i].used = true;
        memset(&work_pool[i].work, 0, sizeof(work_pool[i].work));
        work_pool[i].work.kind = kind;
        work = &work_pool[i].work;
        break;
    }
    xSemaphoreGive(work_pool_lock);
    return work;
}

static void release_work(game_work_t *work)
{
    if (!work_pool_lock || !work_pool || !work) return;
    xSemaphoreTake(work_pool_lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_GAME_COMMAND_QUEUE_LENGTH; ++i) {
        if (&work_pool[i].work != work) continue;
        memset(&work_pool[i].work, 0, sizeof(work_pool[i].work));
        work_pool[i].used = false;
        break;
    }
    xSemaphoreGive(work_pool_lock);
}

/*
 * Ownership transfers to the worker on success. On failure the slot is
 * released here, keeping both memory use and outstanding work bounded.
 */
static bool queue_work(game_work_t *work)
{
    if (!work) return false;
    if (xQueueSend(work_queue, &work, 0) == pdTRUE) return true;
    release_work(work);
    return false;
}

static void send_error_to_members(const char *match_id,
                                  game_platform_result_t result)
{
    char connection_ids[CONFIG_PA_WS_MAX_CONNECTIONS]
                       [PA_CONNECTION_ID_LEN + 1] = {{0}};
    size_t count = 0;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    if (match) {
        for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
            if (connections[i].used &&
                profile_is_member_locked(match,
                                         connections[i].profile_id)) {
                strlcpy(connection_ids[count++],
                        connections[i].connection_id,
                        sizeof(connection_ids[0]));
            }
        }
    }
    xSemaphoreGive(platform_lock);
    for (size_t i = 0; i < count; ++i) {
        send_error(connection_ids[i], result, match_id);
    }
}

static void close_recorded_match(const char *match_id,
                                 game_runtime_t *runtime)
{
    bool close = false;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    close = match && &match->runtime == runtime &&
            match->state == MATCH_FINISHED &&
            (match->result_recorded || runtime->faulted);
    xSemaphoreGive(platform_lock);
    if (!close) return;

    game_runtime_unload(runtime);
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    match = find_match_locked(match_id);
    if (match && &match->runtime == runtime &&
        match->state == MATCH_FINISHED &&
        (match->result_recorded || runtime->faulted)) {
        memset(match, 0, sizeof(*match));
    }
    xSemaphoreGive(platform_lock);
}

static void process_work(const game_work_t *work)
{
    esp_err_t result = ESP_ERR_INVALID_STATE;
    cJSON *data = NULL;
    cJSON *snapshot = NULL;
    game_runtime_t *runtime = NULL;
    app_descriptor_t application = {0};
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(work->match_id);
    if (!match) {
        xSemaphoreGive(platform_lock);
        return;
    }
    if (work->kind != WORK_UNLOAD && match->state == MATCH_FINISHED) {
        xSemaphoreGive(platform_lock);
        return;
    }
    runtime = &match->runtime;
    application = match->application;
    xSemaphoreGive(platform_lock);

    if (work->kind == WORK_UNLOAD) {
        xSemaphoreTake(platform_lock, portMAX_DELAY);
        match = find_match_locked(work->match_id);
        bool same_runtime = match && &match->runtime == runtime;
        if (same_runtime) match->state = MATCH_FINISHED;
        xSemaphoreGive(platform_lock);
        if (same_runtime) {
            game_runtime_unload(runtime);
            xSemaphoreTake(platform_lock, portMAX_DELAY);
            match = find_match_locked(work->match_id);
            if (match && &match->runtime == runtime) {
                memset(match, 0, sizeof(*match));
            }
            xSemaphoreGive(platform_lock);
        }
        return;
    } else if (work->kind == WORK_LOAD) {
        game_runtime_host_t host = runtime_host(match);
        result = game_runtime_load(runtime, &application, &host);
        if (result == ESP_OK) {
            result = game_runtime_player_event(
                runtime, GAME_RUNTIME_PLAYER_JOINED,
                &work->profile, "joined");
        }
    } else if (work->kind == WORK_PLAYER_JOINED) {
        result = game_runtime_player_event(
            runtime, GAME_RUNTIME_PLAYER_JOINED,
            &work->profile, "joined");
    } else if (work->kind == WORK_PLAYER_LEFT) {
        result = game_runtime_player_event(
            runtime, GAME_RUNTIME_PLAYER_LEFT,
            &work->profile, "left");
    } else if (work->kind == WORK_PLAYER_UPDATED) {
        result = game_runtime_player_event(
            runtime, GAME_RUNTIME_PLAYER_UPDATED,
            &work->profile, "updated");
    } else if (work->kind == WORK_SNAPSHOT) {
        result = game_runtime_snapshot(
            runtime, work->profile.id[0] ? work->profile.id : NULL,
            &snapshot);
    } else {
        data = cJSON_Parse(work->data);
        result = data
                     ? game_runtime_command(
                           runtime, work->profile.id, work->action,
                           data, work->input_sequence)
                     : ESP_ERR_INVALID_ARG;
    }

    bool still_active = false;
    bool empty_after_leave = false;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    match = find_match_locked(work->match_id);
    if (result == ESP_OK && match && &match->runtime == runtime) {
        if (work->kind != WORK_SNAPSHOT &&
            match->state != MATCH_FINISHED) {
            ++match->revision;
        }
        if (work->kind == WORK_COMMAND) {
            game_seat_t *seat =
                find_seat_locked(match, work->profile.id);
            if (seat &&
                work->input_sequence > seat->last_processed_sequence) {
                seat->last_processed_sequence = work->input_sequence;
            }
        }
        if (work->kind == WORK_PLAYER_LEFT &&
            match->state != MATCH_FINISHED &&
            player_count_locked(match) == 0) {
            match->state = MATCH_FINISHED;
            ++match->revision;
            empty_after_leave = true;
        }
        still_active = match->state != MATCH_FINISHED;
    } else if (match && &match->runtime == runtime && runtime->faulted) {
        match->state = MATCH_FINISHED;
        ++match->revision;
    }
    xSemaphoreGive(platform_lock);
    cJSON_Delete(data);

    if (result != ESP_OK) {
        cJSON_Delete(snapshot);
        if (runtime->faulted) {
            ESP_LOGE(TAG, "Match %s stopped after runtime fault: %s",
                     work->match_id, game_runtime_fault_message(runtime));
            send_match_to_members(work->match_id);
            send_error_to_members(work->match_id,
                                  GAME_PLATFORM_RUNTIME_FAILED);
        } else if (work->connection_id[0]) {
            send_error(work->connection_id, GAME_PLATFORM_INVALID_STATE,
                       work->match_id);
        }
        close_recorded_match(work->match_id, runtime);
        return;
    }

    if (empty_after_leave) {
        /*
         * An empty waiting match must release its runtime and active-match
         * slot. Otherwise a departed game permanently blocks another app when
         * CONFIG_PA_GAME_MAX_MATCHES is one.
         */
        send_match_to_members(work->match_id);
        game_runtime_unload(runtime);
        xSemaphoreTake(platform_lock, portMAX_DELAY);
        match = find_match_locked(work->match_id);
        if (match && &match->runtime == runtime &&
            match->state == MATCH_FINISHED &&
            player_count_locked(match) == 0) {
            memset(match, 0, sizeof(*match));
        }
        xSemaphoreGive(platform_lock);
        return;
    }

    bool cadence_owns_snapshot =
        application.runtime_mode == APP_RUNTIME_TICK &&
        work->kind == WORK_COMMAND;
    if (!snapshot && still_active && work->kind != WORK_SNAPSHOT &&
        !cadence_owns_snapshot) {
        result = game_runtime_snapshot(runtime, NULL, &snapshot);
        if (result != ESP_OK) {
            xSemaphoreTake(platform_lock, portMAX_DELAY);
            match = find_match_locked(work->match_id);
            if (match && &match->runtime == runtime) {
                match->state = MATCH_FINISHED;
                ++match->revision;
            }
            xSemaphoreGive(platform_lock);
            send_match_to_members(work->match_id);
            send_error_to_members(work->match_id,
                                  GAME_PLATFORM_RUNTIME_FAILED);
            close_recorded_match(work->match_id, runtime);
            return;
        }
    }

    if (snapshot) {
        if (work->kind == WORK_SNAPSHOT && work->connection_id[0]) {
            send_snapshot_payload(work->match_id, work->connection_id,
                                  NULL, snapshot);
        } else {
            result = cache_snapshot(work->match_id, snapshot);
            if (result == ESP_OK) {
                send_snapshot_payload(work->match_id, NULL, NULL, snapshot);
            } else {
                send_error_to_members(work->match_id,
                                      GAME_PLATFORM_OUTPUT_TOO_LARGE);
            }
        }
        cJSON_Delete(snapshot);
    }
    if (still_active && work->kind != WORK_SNAPSHOT) {
        send_match_to_members(work->match_id);
    }
    close_recorded_match(work->match_id, runtime);
}

static void run_due_ticks(void)
{
    for (size_t index = 0; index < CONFIG_PA_GAME_MAX_MATCHES; ++index) {
        char match_id[PA_MATCH_ID_MAX + 1] = {0};
        game_runtime_t *runtime = NULL;
        uint32_t tick_delta_ms = 0;
        uint32_t dropped_now = 0;
        bool snapshot_due = false;
        uint64_t now = system_uptime_ms();

        xSemaphoreTake(platform_lock, portMAX_DELAY);
        game_match_t *match = &matches[index];
        if (match->used && match->state == MATCH_PLAYING &&
            match->application.runtime_mode == APP_RUNTIME_TICK &&
            match->runtime.loaded && !match->runtime.faulted) {
            if (!match->next_tick_ms || !match->tick_interval_ms) {
                configure_schedule_locked(match, now);
            }
            if (match->next_tick_ms && now >= match->next_tick_ms) {
                uint64_t due =
                    1U + (now - match->next_tick_ms) /
                              match->tick_interval_ms;
                uint64_t dropped = due > 1U ? due - 1U : 0U;
                dropped_now =
                    dropped > UINT32_MAX ? UINT32_MAX : (uint32_t)dropped;
                if (UINT32_MAX - match->dropped_ticks < dropped_now) {
                    match->dropped_ticks = UINT32_MAX;
                } else {
                    match->dropped_ticks += dropped_now;
                }
                match->next_tick_ms += due * match->tick_interval_ms;
                if (match->next_snapshot_ms &&
                    now >= match->next_snapshot_ms) {
                    uint64_t snapshots =
                        1U + (now - match->next_snapshot_ms) /
                                  match->snapshot_interval_ms;
                    match->next_snapshot_ms +=
                        snapshots * match->snapshot_interval_ms;
                    snapshot_due = true;
                }
                strlcpy(match_id, match->id, sizeof(match_id));
                runtime = &match->runtime;
                tick_delta_ms = match->tick_interval_ms;
            }
        }
        xSemaphoreGive(platform_lock);
        if (!runtime) continue;

        uint64_t started_ms = system_uptime_ms();
        esp_err_t result = game_runtime_tick(runtime, tick_delta_ms);
        uint64_t elapsed_ms = system_uptime_ms() - started_ms;
        bool active = false;
        bool report_overrun = false;
        uint32_t total_overruns = 0;

        xSemaphoreTake(platform_lock, portMAX_DELAY);
        match = find_match_locked(match_id);
        if (match && &match->runtime == runtime) {
            if (result == ESP_OK && match->state != MATCH_FINISHED) {
                ++match->revision;
                active = true;
                if (elapsed_ms > tick_delta_ms) {
                    ++match->tick_overruns;
                    total_overruns = match->tick_overruns;
                    report_overrun =
                        total_overruns == 1U ||
                        (total_overruns & (total_overruns - 1U)) == 0U;
                }
            } else if (runtime->faulted) {
                match->state = MATCH_FINISHED;
                ++match->revision;
            }
        }
        xSemaphoreGive(platform_lock);

        if (dropped_now) {
            ESP_LOGW(TAG, "Match %s dropped %u accumulated tick(s)",
                     match_id, (unsigned)dropped_now);
        }
        if (report_overrun) {
            ESP_LOGW(TAG,
                     "Match %s tick overrun: %llu ms budget %u ms "
                     "(total %u)",
                     match_id, (unsigned long long)elapsed_ms,
                     (unsigned)tick_delta_ms, (unsigned)total_overruns);
        }
        if (result != ESP_OK) {
            if (runtime->faulted) {
                ESP_LOGE(TAG, "Match %s stopped after tick fault: %s",
                         match_id, game_runtime_fault_message(runtime));
                send_match_to_members(match_id);
                send_error_to_members(match_id,
                                      GAME_PLATFORM_RUNTIME_FAILED);
            }
            close_recorded_match(match_id, runtime);
            continue;
        }

        cJSON *snapshot = NULL;
        if (active && snapshot_due) {
            result = game_runtime_snapshot(runtime, NULL, &snapshot);
            if (result == ESP_OK && snapshot) {
                result = cache_snapshot(match_id, snapshot);
                if (result == ESP_OK) {
                    xSemaphoreTake(platform_lock, portMAX_DELAY);
                    match = find_match_locked(match_id);
                    if (match && &match->runtime == runtime) {
                        match->last_snapshot_broadcast_ms =
                            system_uptime_ms();
                        match->snapshot_pending = false;
                    }
                    xSemaphoreGive(platform_lock);
                    send_snapshot_payload(match_id, NULL, NULL, snapshot);
                } else {
                    send_error_to_members(
                        match_id, GAME_PLATFORM_OUTPUT_TOO_LARGE);
                }
            }
            cJSON_Delete(snapshot);
        }
        if (result != ESP_OK && runtime->faulted) {
            xSemaphoreTake(platform_lock, portMAX_DELAY);
            match = find_match_locked(match_id);
            if (match && &match->runtime == runtime) {
                match->state = MATCH_FINISHED;
                ++match->revision;
            }
            xSemaphoreGive(platform_lock);
            send_match_to_members(match_id);
            send_error_to_members(match_id,
                                  GAME_PLATFORM_RUNTIME_FAILED);
        }
        close_recorded_match(match_id, runtime);
    }
}

static void expire_disconnected_players(void)
{
    uint64_t now = system_uptime_ms();
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
        game_match_t *match = &matches[i];
        if (!match->used) continue;
        bool changed = false;
        for (size_t j = 0; j < match->application.max_players; ++j) {
            game_seat_t *seat = &match->seats[j];
            if (!seat->occupied || seat->connected ||
                !seat->disconnect_deadline_ms ||
                now < seat->disconnect_deadline_ms) {
                continue;
            }
            game_work_t *work = acquire_work(WORK_PLAYER_LEFT);
            if (!work) continue;
            work->profile = seat->profile;
            strlcpy(work->match_id, match->id, sizeof(work->match_id));
            if (!queue_work(work)) continue;
            memset(seat, 0, sizeof(*seat));
            changed = true;
        }
        if (changed) {
            ++match->revision;
            update_lifecycle_locked(match);
        }
    }
    xSemaphoreGive(platform_lock);
}

static void game_worker(void *unused)
{
    (void)unused;
    uint64_t next_expiry_check_ms = 0;
    for (;;) {
        game_work_t *work = NULL;
        /*
         * One RTOS tick is the minimum blocking interval. A millisecond
         * conversion can round down to zero on 100 Hz configurations and
         * turn this worker into a CPU-starving busy loop.
         */
        if (xQueueReceive(work_queue, &work, 1) == pdTRUE) {
            process_work(work);
            release_work(work);
        }
        run_due_ticks();
        uint64_t now = system_uptime_ms();
        if (now >= next_expiry_check_ms) {
            expire_disconnected_players();
            next_expiry_check_ms = now + 100U;
        }
    }
}

esp_err_t game_platform_init(
    game_platform_transport_fn transport,
    game_platform_binary_transport_fn binary_transport)
{
    if (!transport || !binary_transport) return ESP_ERR_INVALID_ARG;
    send_transport = transport;
    send_binary_transport = binary_transport;
    platform_lock = xSemaphoreCreateMutex();
    work_pool_lock = xSemaphoreCreateMutex();
    work_pool = calloc(CONFIG_PA_GAME_COMMAND_QUEUE_LENGTH,
                       sizeof(*work_pool));
    work_queue = xQueueCreate(CONFIG_PA_GAME_COMMAND_QUEUE_LENGTH,
                              sizeof(game_work_t *));
    if (!platform_lock || !work_pool_lock || !work_pool || !work_queue) {
        if (work_queue) vQueueDelete(work_queue);
        if (work_pool_lock) vSemaphoreDelete(work_pool_lock);
        if (platform_lock) vSemaphoreDelete(platform_lock);
        free(work_pool);
        work_queue = NULL;
        work_pool_lock = NULL;
        platform_lock = NULL;
        work_pool = NULL;
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(game_worker, "game_runtime",
                    CONFIG_PA_GAME_TASK_STACK_BYTES, NULL,
                    CONFIG_PA_GAME_TASK_PRIORITY, NULL) != pdPASS) {
        vQueueDelete(work_queue);
        vSemaphoreDelete(work_pool_lock);
        vSemaphoreDelete(platform_lock);
        free(work_pool);
        work_queue = NULL;
        work_pool_lock = NULL;
        platform_lock = NULL;
        work_pool = NULL;
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

void game_platform_connection_opened(const public_profile_t *profile,
                                     const char *connection_id)
{
    if (!profile || !connection_id) return;
    char matched_id[PA_MATCH_ID_MAX + 1] = {0};
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_connection_t *connection = find_connection_locked(connection_id);
    if (!connection) {
        for (size_t i = 0; i < CONFIG_PA_WS_MAX_CONNECTIONS; ++i) {
            if (!connections[i].used) {
                connection = &connections[i];
                break;
            }
        }
    }
    if (connection) {
        memset(connection, 0, sizeof(*connection));
        connection->used = true;
        strlcpy(connection->connection_id, connection_id,
                sizeof(connection->connection_id));
        strlcpy(connection->profile_id, profile->id,
                sizeof(connection->profile_id));
    }
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
        game_seat_t *seat = find_seat_locked(&matches[i], profile->id);
        if (!matches[i].used ||
            (!seat && !find_spectator_locked(&matches[i], profile->id))) {
            continue;
        }
        if (seat) {
            seat->connected = true;
            seat->disconnect_deadline_ms = 0;
            if (!seat->controller_id[0]) {
                strlcpy(seat->controller_id, connection_id,
                        sizeof(seat->controller_id));
                ++matches[i].revision;
            }
        }
        strlcpy(matched_id, matches[i].id, sizeof(matched_id));
        break;
    }
    xSemaphoreGive(platform_lock);
    if (matched_id[0]) {
        send_match_to_members(matched_id);
        game_work_t *work = acquire_work(WORK_SNAPSHOT);
        if (work) {
            work->profile = *profile;
            strlcpy(work->match_id, matched_id, sizeof(work->match_id));
            strlcpy(work->connection_id, connection_id,
                    sizeof(work->connection_id));
        }
        if (!queue_work(work)) {
            send_snapshot_to_members(matched_id, connection_id);
        }
    }
}

void game_platform_connection_closed(const char *connection_id)
{
    if (!connection_id) return;
    char changed_match[PA_MATCH_ID_MAX + 1] = {0};
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_connection_t *connection = find_connection_locked(connection_id);
    char profile_id[PA_PROFILE_ID_LEN + 1] = {0};
    if (connection) {
        strlcpy(profile_id, connection->profile_id, sizeof(profile_id));
        memset(connection, 0, sizeof(*connection));
    }
    if (profile_id[0]) {
        for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
            game_match_t *match = &matches[i];
            game_seat_t *seat = find_seat_locked(match, profile_id);
            if (!match->used || !seat ||
                strcmp(seat->controller_id, connection_id) != 0) {
                continue;
            }
            seat->controller_id[0] = '\0';
            seat->connected = false;
            for (size_t j = 0; j < CONFIG_PA_WS_MAX_CONNECTIONS; ++j) {
                if (connections[j].used &&
                    strcmp(connections[j].profile_id, profile_id) == 0) {
                    strlcpy(seat->controller_id,
                            connections[j].connection_id,
                            sizeof(seat->controller_id));
                    seat->connected = true;
                    seat->disconnect_deadline_ms = 0;
                    break;
                }
            }
            if (!seat->connected) {
                seat->disconnect_deadline_ms =
                    system_uptime_ms() +
                    match->application.reconnect_grace_ms;
            }
            ++match->revision;
            strlcpy(changed_match, match->id, sizeof(changed_match));
            break;
        }
    }
    xSemaphoreGive(platform_lock);
    if (changed_match[0]) send_match_to_members(changed_match);
}

game_platform_result_t game_platform_join(
    const public_profile_t *profile, const char *connection_id,
    const char *app_id, const char *requested_match_id)
{
    if (!profile || !connection_id || !app_id ||
        !app_id[0] || strlen(app_id) > PA_APP_ID_MAX) {
        return GAME_PLATFORM_INVALID_REQUEST;
    }
    app_descriptor_t application;
    if (!app_catalogue_get(app_id, &application)) {
        return GAME_PLATFORM_APP_NOT_FOUND;
    }
    if (strcmp(application.kind, "game") != 0) {
        return GAME_PLATFORM_INVALID_REQUEST;
    }

    char match_id[PA_MATCH_ID_MAX + 1] = {0};
    game_platform_result_t result = GAME_PLATFORM_OK;
    bool membership_changed = false;
    bool new_match = false;

    xSemaphoreTake(platform_lock, portMAX_DELAY);
    if (!connection_belongs_to_locked(connection_id, profile->id)) {
        result = GAME_PLATFORM_INVALID_REQUEST;
        goto done;
    }
    game_match_t *match = requested_match_id && requested_match_id[0]
                              ? find_match_locked(requested_match_id)
                              : find_app_match_locked(app_id);
    if (requested_match_id && requested_match_id[0] && !match) {
        result = GAME_PLATFORM_MATCH_NOT_FOUND;
        goto done;
    }
    if (match && strcmp(match->application.id, app_id) != 0) {
        result = GAME_PLATFORM_MATCH_NOT_FOUND;
        goto done;
    }
    if (match && match->state == MATCH_FINISHED) {
        result = GAME_PLATFORM_INVALID_STATE;
        goto done;
    }
    if (!match) {
        for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
            if (!matches[i].used) {
                match = &matches[i];
                break;
            }
        }
        if (!match) {
            result = GAME_PLATFORM_MATCH_FULL;
            goto done;
        }
        memset(match, 0, sizeof(*match));
        match->used = true;
        match->application = application;
        random_match_id(match->id);
        match->state = MATCH_WAITING;
        match->revision = 1;
        match->created_ms = system_uptime_ms();
        new_match = true;
    }
    strlcpy(match_id, match->id, sizeof(match_id));
    game_seat_t *seat = find_seat_locked(match, profile->id);
    if (seat) {
        seat->profile = *profile;
        seat->connected = true;
        seat->disconnect_deadline_ms = 0;
        if (!seat->controller_id[0]) {
            strlcpy(seat->controller_id, connection_id,
                    sizeof(seat->controller_id));
            ++match->revision;
        }
        goto done;
    }
    if (find_spectator_locked(match, profile->id)) goto done;

    if (match->state == MATCH_WAITING &&
        player_count_locked(match) < match->application.max_players) {
        for (size_t i = 0; i < match->application.max_players; ++i) {
            if (!match->seats[i].occupied) {
                seat = &match->seats[i];
                memset(seat, 0, sizeof(*seat));
                seat->occupied = true;
                seat->connected = true;
                seat->profile = *profile;
                strlcpy(seat->controller_id, connection_id,
                        sizeof(seat->controller_id));
                membership_changed = true;
                break;
            }
        }
    } else if (match->application.spectators &&
               (match->state == MATCH_WAITING ||
                match->application.late_join ==
                    APP_LATE_JOIN_SPECTATOR)) {
        for (size_t i = 0; i < CONFIG_PA_GAME_MAX_SPECTATORS; ++i) {
            if (!match->spectators[i].occupied) {
                match->spectators[i].occupied = true;
                match->spectators[i].profile = *profile;
                membership_changed = true;
                break;
            }
        }
        if (!find_spectator_locked(match, profile->id)) {
            result = GAME_PLATFORM_MATCH_FULL;
        }
    } else {
        result = GAME_PLATFORM_MATCH_FULL;
    }
    if (membership_changed) {
        ++match->revision;
        update_lifecycle_locked(match);
        game_work_t *work =
            seat ? acquire_work(new_match ? WORK_LOAD : WORK_PLAYER_JOINED)
                 : NULL;
        if (work) {
            work->profile = *profile;
            strlcpy(work->match_id, match->id, sizeof(work->match_id));
            strlcpy(work->connection_id, connection_id,
                    sizeof(work->connection_id));
        }
        if (seat && !queue_work(work)) {
            if (new_match) memset(match, 0, sizeof(*match));
            else {
                memset(seat, 0, sizeof(*seat));
                ++match->revision;
            }
            result = GAME_PLATFORM_QUEUE_FULL;
        }
    }
done:
    xSemaphoreGive(platform_lock);
    if (result == GAME_PLATFORM_OK && match_id[0]) {
        send_match_to_members(match_id);
        send_snapshot_to_members(match_id, connection_id);
    }
    return result;
}

game_platform_result_t game_platform_leave(
    const char *profile_id, const char *connection_id, const char *match_id)
{
    if (!profile_id || !connection_id || !match_id) {
        return GAME_PLATFORM_INVALID_REQUEST;
    }
    char changed_id[PA_MATCH_ID_MAX + 1] = {0};
    game_platform_result_t result = GAME_PLATFORM_OK;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    if (!match) {
        result = GAME_PLATFORM_MATCH_NOT_FOUND;
    } else if (!connection_belongs_to_locked(connection_id, profile_id)) {
        result = GAME_PLATFORM_INVALID_REQUEST;
    } else {
        game_seat_t *seat = find_seat_locked(match, profile_id);
        game_spectator_t *spectator =
            find_spectator_locked(match, profile_id);
        if (!seat && !spectator) {
            result = GAME_PLATFORM_NOT_MEMBER;
        } else {
            strlcpy(changed_id, match->id, sizeof(changed_id));
            if (seat) {
                game_work_t *work = acquire_work(WORK_PLAYER_LEFT);
                if (work) {
                    work->profile = seat->profile;
                    strlcpy(work->match_id, match->id,
                            sizeof(work->match_id));
                    strlcpy(work->connection_id, connection_id,
                            sizeof(work->connection_id));
                }
                if (!queue_work(work)) {
                    result = GAME_PLATFORM_QUEUE_FULL;
                } else {
                    memset(seat, 0, sizeof(*seat));
                }
            } else {
                memset(spectator, 0, sizeof(*spectator));
            }
            if (result == GAME_PLATFORM_OK) {
                ++match->revision;
                update_lifecycle_locked(match);
            }
        }
    }
    xSemaphoreGive(platform_lock);
    if (result == GAME_PLATFORM_OK && changed_id[0]) {
        send_match_to_members(changed_id);
        send_match_to_connection(changed_id, profile_id, connection_id);
    }
    return result;
}

game_platform_result_t game_platform_ready(
    const char *profile_id, const char *connection_id, const char *match_id)
{
    game_platform_result_t result = GAME_PLATFORM_OK;
    char changed_id[PA_MATCH_ID_MAX + 1] = {0};
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    game_seat_t *seat = match ? find_seat_locked(match, profile_id) : NULL;
    if (!match) result = GAME_PLATFORM_MATCH_NOT_FOUND;
    else if (match->state == MATCH_FINISHED) {
        result = GAME_PLATFORM_INVALID_STATE;
    }
    else if (!connection_belongs_to_locked(connection_id, profile_id)) {
        result = GAME_PLATFORM_INVALID_REQUEST;
    } else if (!seat) result = GAME_PLATFORM_NOT_PLAYER;
    else if (!seat->ready) {
        seat->ready = true;
        ++match->revision;
        update_lifecycle_locked(match);
        strlcpy(changed_id, match->id, sizeof(changed_id));
    }
    xSemaphoreGive(platform_lock);
    if (changed_id[0]) send_match_to_members(changed_id);
    return result;
}

game_platform_result_t game_platform_claim_control(
    const char *profile_id, const char *connection_id, const char *match_id)
{
    game_platform_result_t result = GAME_PLATFORM_OK;
    char changed_id[PA_MATCH_ID_MAX + 1] = {0};
    bool snapshot_queued = false;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    game_seat_t *seat = match ? find_seat_locked(match, profile_id) : NULL;
    if (!match) result = GAME_PLATFORM_MATCH_NOT_FOUND;
    else if (!connection_belongs_to_locked(connection_id, profile_id)) {
        result = GAME_PLATFORM_INVALID_REQUEST;
    } else if (!seat) result = GAME_PLATFORM_NOT_PLAYER;
    else if (strcmp(seat->controller_id, connection_id) != 0) {
        strlcpy(seat->controller_id, connection_id,
                sizeof(seat->controller_id));
        seat->connected = true;
        ++match->revision;
        strlcpy(changed_id, match->id, sizeof(changed_id));
    }
    if (result == GAME_PLATFORM_OK) {
        game_work_t *work = acquire_work(WORK_SNAPSHOT);
        if (work) {
            strlcpy(work->profile.id, profile_id,
                    sizeof(work->profile.id));
            strlcpy(work->connection_id, connection_id,
                    sizeof(work->connection_id));
            strlcpy(work->match_id, match_id,
                    sizeof(work->match_id));
        }
        snapshot_queued = queue_work(work);
    }
    xSemaphoreGive(platform_lock);
    if (changed_id[0]) send_match_to_members(changed_id);
    if (result == GAME_PLATFORM_OK && !snapshot_queued) {
        send_snapshot_to_members(match_id, connection_id);
    }
    return result;
}

game_platform_result_t game_platform_request_snapshot(
    const char *profile_id, const char *connection_id, const char *match_id)
{
    if (!profile_id || !connection_id || !match_id) {
        return GAME_PLATFORM_INVALID_REQUEST;
    }
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    game_platform_result_t result =
        !match ? GAME_PLATFORM_MATCH_NOT_FOUND
        : match->state == MATCH_FINISHED
              ? GAME_PLATFORM_INVALID_STATE
        : !connection_belongs_to_locked(connection_id, profile_id)
              ? GAME_PLATFORM_INVALID_REQUEST
        : !profile_is_member_locked(match, profile_id)
              ? GAME_PLATFORM_NOT_MEMBER
              : GAME_PLATFORM_OK;
    if (result == GAME_PLATFORM_OK) {
        game_work_t *work = acquire_work(WORK_SNAPSHOT);
        if (work) {
            strlcpy(work->profile.id, profile_id,
                    sizeof(work->profile.id));
            strlcpy(work->connection_id, connection_id,
                    sizeof(work->connection_id));
            strlcpy(work->match_id, match_id,
                    sizeof(work->match_id));
        }
        if (!queue_work(work)) result = GAME_PLATFORM_QUEUE_FULL;
    }
    xSemaphoreGive(platform_lock);
    return result;
}

game_platform_result_t game_platform_command(
    const char *profile_id, const char *connection_id,
    const char *app_id, const char *match_id, const char *action,
    cJSON *data, uint32_t input_sequence)
{
    if (!profile_id || !connection_id || !app_id || !match_id || !action ||
        !data || !cJSON_IsObject(data) || !input_sequence ||
        strlen(action) == 0 || strlen(action) > PA_GAME_ACTION_MAX) {
        return GAME_PLATFORM_INVALID_REQUEST;
    }
    char *encoded = cJSON_PrintUnformatted(data);
    if (!encoded) return GAME_PLATFORM_INVALID_REQUEST;
    size_t encoded_length = strlen(encoded);
    if (encoded_length > CONFIG_PA_GAME_MAX_COMMAND_BYTES) {
        cJSON_free(encoded);
        return GAME_PLATFORM_INVALID_REQUEST;
    }

    game_platform_result_t result = GAME_PLATFORM_OK;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    game_match_t *match = find_match_locked(match_id);
    game_seat_t *seat = match ? find_seat_locked(match, profile_id) : NULL;
    if (!match || strcmp(match->application.id, app_id) != 0) {
        result = GAME_PLATFORM_MATCH_NOT_FOUND;
    } else if (match->state == MATCH_FINISHED) {
        result = GAME_PLATFORM_INVALID_STATE;
    } else if (!seat) {
        result = GAME_PLATFORM_NOT_PLAYER;
    } else if (strcmp(seat->controller_id, connection_id) != 0) {
        result = GAME_PLATFORM_NOT_CONTROLLER;
    } else if (input_sequence <= seat->last_input_sequence) {
        result = GAME_PLATFORM_STALE_INPUT;
    } else {
        uint64_t now = system_uptime_ms();
        if (now - seat->rate_window_started_ms >= 1000) {
            seat->rate_window_started_ms = now;
            seat->rate_count = 0;
        }
        if (++seat->rate_count > CONFIG_PA_GAME_COMMANDS_PER_SECOND) {
            result = GAME_PLATFORM_RATE_LIMITED;
        } else {
            game_work_t *work = acquire_work(WORK_COMMAND);
            if (work) {
                work->input_sequence = input_sequence;
                strlcpy(work->profile.id, profile_id,
                        sizeof(work->profile.id));
                strlcpy(work->connection_id, connection_id,
                        sizeof(work->connection_id));
                strlcpy(work->match_id, match_id,
                        sizeof(work->match_id));
                strlcpy(work->action, action, sizeof(work->action));
                strlcpy(work->data, encoded, sizeof(work->data));
            }
            if (!queue_work(work)) {
                result = GAME_PLATFORM_QUEUE_FULL;
            } else {
                seat->last_input_sequence = input_sequence;
            }
        }
    }
    xSemaphoreGive(platform_lock);
    cJSON_free(encoded);
    return result;
}

void game_platform_profile_updated(const public_profile_t *profile)
{
    if (!profile) return;
    char changed_id[PA_MATCH_ID_MAX + 1] = {0};
    bool update_runtime = false;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
        game_match_t *match = &matches[i];
        game_seat_t *seat = find_seat_locked(match, profile->id);
        game_spectator_t *spectator =
            find_spectator_locked(match, profile->id);
        if (seat) {
            seat->profile = *profile;
            update_runtime = true;
        }
        if (spectator) spectator->profile = *profile;
        if (seat || spectator) {
            ++match->revision;
            strlcpy(changed_id, match->id, sizeof(changed_id));
            break;
        }
    }
    xSemaphoreGive(platform_lock);
    if (update_runtime) {
        game_work_t *work = acquire_work(WORK_PLAYER_UPDATED);
        if (work) {
            work->profile = *profile;
            strlcpy(work->match_id, changed_id, sizeof(work->match_id));
        }
        (void)queue_work(work);
    }
    if (changed_id[0]) send_match_to_members(changed_id);
}

void game_platform_profile_deleted(const char *profile_id)
{
    if (!profile_id) return;
    char match_id[PA_MATCH_ID_MAX + 1] = {0};
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
        game_match_t *match = &matches[i];
        game_seat_t *seat = find_seat_locked(match, profile_id);
        game_spectator_t *spectator =
            find_spectator_locked(match, profile_id);
        if (!seat && !spectator) continue;
        strlcpy(match_id, match->id, sizeof(match_id));
        if (seat) {
            game_work_t *work = acquire_work(WORK_PLAYER_LEFT);
            if (work) {
                work->profile = seat->profile;
                strlcpy(work->match_id, match->id,
                        sizeof(work->match_id));
            }
            (void)queue_work(work);
            memset(seat, 0, sizeof(*seat));
        } else {
            memset(spectator, 0, sizeof(*spectator));
        }
        ++match->revision;
        update_lifecycle_locked(match);
        break;
    }
    xSemaphoreGive(platform_lock);
    if (match_id[0]) send_match_to_members(match_id);
}

void game_platform_storage_available(void)
{
    /* Finished runtimes close themselves on the dedicated worker. */
}

void game_platform_storage_unavailable(void)
{
    char ids[CONFIG_PA_GAME_MAX_MATCHES][PA_MATCH_ID_MAX + 1] = {{0}};
    size_t count = 0;
    xSemaphoreTake(platform_lock, portMAX_DELAY);
    for (size_t i = 0; i < CONFIG_PA_GAME_MAX_MATCHES; ++i) {
        if (!matches[i].used ||
            matches[i].application.source != APP_SOURCE_SD) {
            continue;
        }
        matches[i].state = MATCH_FINISHED;
        ++matches[i].revision;
        strlcpy(ids[count++], matches[i].id, sizeof(ids[0]));
    }
    xSemaphoreGive(platform_lock);
    for (size_t i = 0; i < count; ++i) send_match_to_members(ids[i]);
    for (size_t i = 0; i < count; ++i) {
        game_work_t *work = acquire_work(WORK_UNLOAD);
        if (work) {
            strlcpy(work->match_id, ids[i], sizeof(work->match_id));
        }
        (void)queue_work(work);
    }
}

const char *game_platform_result_code(game_platform_result_t result)
{
    switch (result) {
        case GAME_PLATFORM_APP_NOT_FOUND: return "app_not_found";
        case GAME_PLATFORM_RUNTIME_UNAVAILABLE: return "runtime_unavailable";
        case GAME_PLATFORM_MATCH_NOT_FOUND: return "match_not_found";
        case GAME_PLATFORM_MATCH_FULL: return "match_full";
        case GAME_PLATFORM_NOT_MEMBER: return "not_a_member";
        case GAME_PLATFORM_NOT_PLAYER: return "not_a_player";
        case GAME_PLATFORM_NOT_CONTROLLER: return "not_controller";
        case GAME_PLATFORM_STALE_INPUT: return "stale_input";
        case GAME_PLATFORM_RATE_LIMITED: return "rate_limited";
        case GAME_PLATFORM_QUEUE_FULL: return "game_busy";
        case GAME_PLATFORM_OUTPUT_TOO_LARGE: return "snapshot_too_large";
        case GAME_PLATFORM_RUNTIME_FAILED: return "runtime_failed";
        case GAME_PLATFORM_INVALID_STATE: return "invalid_state";
        case GAME_PLATFORM_INVALID_REQUEST: return "invalid_request";
        default: return "ok";
    }
}

const char *game_platform_result_message(game_platform_result_t result)
{
    switch (result) {
        case GAME_PLATFORM_APP_NOT_FOUND:
            return "The requested application is not installed.";
        case GAME_PLATFORM_RUNTIME_UNAVAILABLE:
            return "The application runtime is not available.";
        case GAME_PLATFORM_MATCH_NOT_FOUND:
            return "The requested match does not exist.";
        case GAME_PLATFORM_MATCH_FULL:
            return "The match has no available player or spectator place.";
        case GAME_PLATFORM_NOT_MEMBER:
            return "Join this match before requesting game state.";
        case GAME_PLATFORM_NOT_PLAYER:
            return "Only a seated player can perform this action.";
        case GAME_PLATFORM_NOT_CONTROLLER:
            return "This browser connection does not control the seat.";
        case GAME_PLATFORM_STALE_INPUT:
            return "The input sequence is stale or duplicated.";
        case GAME_PLATFORM_RATE_LIMITED:
            return "Game commands are arriving too quickly.";
        case GAME_PLATFORM_QUEUE_FULL:
            return "The game command queue is full; try again shortly.";
        case GAME_PLATFORM_OUTPUT_TOO_LARGE:
            return "The game produced a snapshot above the platform limit.";
        case GAME_PLATFORM_RUNTIME_FAILED:
            return "The application runtime stopped safely after a fault.";
        case GAME_PLATFORM_INVALID_STATE:
            return "The game rejected this action in its current state.";
        default:
            return "The game request is invalid.";
    }
}
