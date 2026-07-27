#pragma once

#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_err.h"
#include "profiles.h"

typedef enum {
    GAME_PLATFORM_OK,
    GAME_PLATFORM_INVALID_REQUEST,
    GAME_PLATFORM_APP_NOT_FOUND,
    GAME_PLATFORM_RUNTIME_UNAVAILABLE,
    GAME_PLATFORM_MATCH_NOT_FOUND,
    GAME_PLATFORM_MATCH_FULL,
    GAME_PLATFORM_NOT_MEMBER,
    GAME_PLATFORM_NOT_PLAYER,
    GAME_PLATFORM_NOT_CONTROLLER,
    GAME_PLATFORM_STALE_INPUT,
    GAME_PLATFORM_RATE_LIMITED,
    GAME_PLATFORM_QUEUE_FULL,
    GAME_PLATFORM_OUTPUT_TOO_LARGE,
    GAME_PLATFORM_RUNTIME_FAILED,
    GAME_PLATFORM_INVALID_STATE,
} game_platform_result_t;

/*
 * Payload ownership transfers to the transport callback. Connection IDs are
 * internal routing handles and are never included in a protocol payload.
 */
typedef void (*game_platform_transport_fn)(const char *connection_id,
                                           const char *message_type,
                                           cJSON *payload);

/*
 * Binary payload ownership transfers to the transport callback. Phase 3 uses
 * this path for coalescible realtime snapshots.
 */
typedef void (*game_platform_binary_transport_fn)(
    const char *connection_id, uint8_t *payload, size_t payload_length);

esp_err_t game_platform_init(game_platform_transport_fn transport,
                             game_platform_binary_transport_fn binary_transport);

game_platform_result_t game_platform_join(
    const public_profile_t *profile, const char *connection_id,
    const char *app_id, const char *requested_match_id);
game_platform_result_t game_platform_leave(
    const char *profile_id, const char *connection_id, const char *match_id);
game_platform_result_t game_platform_ready(
    const char *profile_id, const char *connection_id, const char *match_id);
game_platform_result_t game_platform_claim_control(
    const char *profile_id, const char *connection_id, const char *match_id);
game_platform_result_t game_platform_request_snapshot(
    const char *profile_id, const char *connection_id, const char *match_id);
game_platform_result_t game_platform_command(
    const char *profile_id, const char *connection_id,
    const char *app_id, const char *match_id, const char *action,
    cJSON *data, uint32_t input_sequence);

void game_platform_connection_opened(const public_profile_t *profile,
                                     const char *connection_id);
void game_platform_connection_closed(const char *connection_id);
void game_platform_profile_updated(const public_profile_t *profile);
void game_platform_profile_deleted(const char *profile_id);
void game_platform_storage_available(void);
void game_platform_storage_unavailable(void);

const char *game_platform_result_code(game_platform_result_t result);
const char *game_platform_result_message(game_platform_result_t result);
