#include "game_runtime.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "builtin_apps.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"
#include "pa_board.h"
#include "storage.h"
#include "system_state.h"

static const char *TAG = "LUA_RUNTIME";
#define PA_LUA_JSON_DEPTH 16
#define PA_LUA_HOOK_GRANULARITY 100

static lua_State *runtime_state(const game_runtime_t *runtime)
{
    return runtime ? (lua_State *)runtime->lua_state : NULL;
}

static void *quota_allocator(void *ud, void *pointer, size_t old_size,
                             size_t new_size)
{
    game_runtime_t *runtime = ud;
    size_t accounted_old = pointer ? old_size : 0;
    if (new_size == 0) {
        heap_caps_free(pointer);
        runtime->memory_used =
            accounted_old <= runtime->memory_used
                ? runtime->memory_used - accounted_old : 0;
        return NULL;
    }
    if (accounted_old > runtime->memory_used) accounted_old = 0;
    size_t base = runtime->memory_used - accounted_old;
    if (new_size > runtime->memory_quota ||
        base > runtime->memory_quota - new_size) {
        return NULL;
    }
    /*
     * Keep optional external RAM dedicated to sandbox payloads and Lua state.
     * Internal RAM remains the fallback, so packages and firmware behaviour
     * do not depend on PSRAM being fitted.
     */
    void *replacement = heap_caps_realloc_prefer(
        pointer, new_size, 2,
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT,
        MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (!replacement) return NULL;
    runtime->memory_used = base + new_size;
    if (runtime->memory_used > runtime->memory_high_water) {
        runtime->memory_high_water = runtime->memory_used;
    }
    return replacement;
}

static void close_state(game_runtime_t *runtime)
{
    lua_State *state = runtime_state(runtime);
    runtime->lua_state = NULL;
    runtime->loaded = false;
    if (state) lua_close(state);
}

static void runtime_fault(game_runtime_t *runtime, const char *message)
{
    if (!runtime) return;
    runtime->faulted = true;
    strlcpy(runtime->fault_message,
            message && message[0] ? message : "Lua runtime failure",
            sizeof(runtime->fault_message));
    ESP_LOGE(TAG, "%.48s stopped: %.128s", runtime->app_id,
             runtime->fault_message);
    close_state(runtime);
}

static int panic_handler(lua_State *state)
{
    /*
     * Lua invokes this only when an error escapes a protected boundary. The
     * platform never long-jumps out of the panic handler; the owning worker
     * observes the failed protected call and tears down this instance.
     */
    (void)state;
    return 0;
}

static void instruction_hook(lua_State *state, lua_Debug *debug)
{
    (void)debug;
    game_runtime_t *runtime = *(game_runtime_t **)lua_getextraspace(state);
    if (!runtime) luaL_error(state, "runtime context unavailable");
    runtime->instructions_remaining -= PA_LUA_HOOK_GRANULARITY;
    if (runtime->instructions_remaining <= 0) {
        luaL_error(state, "instruction limit exceeded");
    }
    if (esp_timer_get_time() > runtime->callback_deadline_us) {
        luaL_error(state, "execution-time limit exceeded");
    }
}

static int protected_call(game_runtime_t *runtime, int arguments,
                          int results, const char *callback)
{
    lua_State *state = runtime_state(runtime);
    runtime->instructions_remaining = CONFIG_PA_GAME_LUA_INSTRUCTION_LIMIT;
    runtime->callback_deadline_us =
        esp_timer_get_time() +
        (int64_t)CONFIG_PA_GAME_LUA_CALLBACK_TIMEOUT_MS * 1000;
    lua_sethook(state, instruction_hook, LUA_MASKCOUNT,
                PA_LUA_HOOK_GRANULARITY);
    int status = lua_pcall(state, arguments, results, 0);
    lua_sethook(state, NULL, 0, 0);
    if (status == LUA_OK) return LUA_OK;

    const char *detail = lua_tostring(state, -1);
    char message[129];
    snprintf(message, sizeof(message), "%s: %.96s", callback,
             detail ? detail : "unknown Lua error");
    runtime_fault(runtime, message);
    return status;
}

static bool push_json(lua_State *state, const cJSON *json, unsigned depth)
{
    if (depth > PA_LUA_JSON_DEPTH) return false;
    if (!json || cJSON_IsNull(json)) {
        lua_pushnil(state);
    } else if (cJSON_IsBool(json)) {
        lua_pushboolean(state, cJSON_IsTrue(json));
    } else if (cJSON_IsNumber(json)) {
        lua_pushnumber(state, json->valuedouble);
    } else if (cJSON_IsString(json) && json->valuestring) {
        lua_pushstring(state, json->valuestring);
    } else if (cJSON_IsArray(json)) {
        int count = cJSON_GetArraySize(json);
        lua_createtable(state, count, 0);
        for (int i = 0; i < count; ++i) {
            if (!push_json(state, cJSON_GetArrayItem(json, i), depth + 1)) {
                lua_pop(state, 1);
                return false;
            }
            lua_rawseti(state, -2, i + 1);
        }
    } else if (cJSON_IsObject(json)) {
        lua_newtable(state);
        const cJSON *child;
        cJSON_ArrayForEach(child, json) {
            if (!child->string ||
                !push_json(state, child, depth + 1)) {
                lua_pop(state, 1);
                return false;
            }
            lua_setfield(state, -2, child->string);
        }
    } else {
        return false;
    }
    return true;
}

static bool table_is_array(lua_State *state, int index, size_t *length)
{
    index = lua_absindex(state, index);
    size_t raw_length = lua_rawlen(state, index);
    size_t count = 0;
    lua_pushnil(state);
    while (lua_next(state, index) != 0) {
        bool valid = lua_isinteger(state, -2);
        lua_Integer key = valid ? lua_tointeger(state, -2) : 0;
        lua_pop(state, 1);
        if (!valid || key < 1 || (size_t)key > raw_length) {
            lua_pop(state, 1);
            return false;
        }
        ++count;
    }
    *length = raw_length;
    return raw_length > 0 && count == raw_length;
}

static cJSON *lua_to_json(lua_State *state, int index, unsigned depth)
{
    if (depth > PA_LUA_JSON_DEPTH) return NULL;
    index = lua_absindex(state, index);
    switch (lua_type(state, index)) {
        case LUA_TNIL:
            return cJSON_CreateNull();
        case LUA_TBOOLEAN:
            return cJSON_CreateBool(lua_toboolean(state, index));
        case LUA_TNUMBER: {
            lua_Number value = lua_tonumber(state, index);
            return isfinite((double)value)
                       ? cJSON_CreateNumber((double)value) : NULL;
        }
        case LUA_TSTRING: {
            size_t length;
            const char *value = lua_tolstring(state, index, &length);
            return length <= CONFIG_PA_GAME_MAX_SNAPSHOT_BYTES &&
                   strlen(value) == length
                       ? cJSON_CreateStringReference(value) : NULL;
        }
        case LUA_TTABLE: {
            size_t length = 0;
            bool array = table_is_array(state, index, &length);
            cJSON *json = array ? cJSON_CreateArray()
                                : cJSON_CreateObject();
            if (!json) return NULL;
            if (array) {
                for (size_t i = 1; i <= length; ++i) {
                    lua_rawgeti(state, index, (lua_Integer)i);
                    cJSON *value = lua_to_json(state, -1, depth + 1);
                    lua_pop(state, 1);
                    if (!value) {
                        cJSON_Delete(json);
                        return NULL;
                    }
                    cJSON_AddItemToArray(json, value);
                }
            } else {
                lua_pushnil(state);
                while (lua_next(state, index) != 0) {
                    if (lua_type(state, -2) != LUA_TSTRING) {
                        lua_pop(state, 2);
                        cJSON_Delete(json);
                        return NULL;
                    }
                    size_t key_length;
                    const char *key =
                        lua_tolstring(state, -2, &key_length);
                    cJSON *value = lua_to_json(state, -1, depth + 1);
                    lua_pop(state, 1);
                    if (!value || strlen(key) != key_length ||
                        key_length > CONFIG_PA_GAME_MAX_SNAPSHOT_BYTES) {
                        cJSON_Delete(value);
                        lua_pop(state, 1);
                        cJSON_Delete(json);
                        return NULL;
                    }
                    /*
                     * Lua owns both strings until the worker has synchronously
                     * encoded and deleted this temporary cJSON tree. Referencing
                     * them avoids duplicating every snapshot key and value in
                     * the constrained internal heap.
                     */
                    cJSON_AddItemToObjectCS(json, key, value);
                }
            }
            return json;
        }
        default:
            return NULL;
    }
}

typedef struct {
    char *data;
    size_t capacity;
    size_t length;
} json_writer_t;

static bool json_append(json_writer_t *writer, const char *text,
                        size_t length)
{
    if (!writer || !text || writer->length >= writer->capacity ||
        length >= writer->capacity - writer->length) {
        return false;
    }
    memcpy(writer->data + writer->length, text, length);
    writer->length += length;
    writer->data[writer->length] = '\0';
    return true;
}

static bool json_append_char(json_writer_t *writer, char value)
{
    return json_append(writer, &value, 1);
}

static bool json_append_string(json_writer_t *writer, const char *value,
                               size_t length)
{
    static const char hex[] = "0123456789abcdef";
    if (!json_append_char(writer, '"')) return false;
    for (size_t i = 0; i < length; ++i) {
        unsigned char c = (unsigned char)value[i];
        const char *escape = NULL;
        switch (c) {
            case '"': escape = "\\\""; break;
            case '\\': escape = "\\\\"; break;
            case '\b': escape = "\\b"; break;
            case '\f': escape = "\\f"; break;
            case '\n': escape = "\\n"; break;
            case '\r': escape = "\\r"; break;
            case '\t': escape = "\\t"; break;
            default: break;
        }
        if (escape) {
            if (!json_append(writer, escape, 2)) return false;
        } else if (c < 0x20) {
            char unicode[] = {'\\', 'u', '0', '0',
                              hex[c >> 4], hex[c & 0x0f]};
            if (!json_append(writer, unicode, sizeof(unicode))) return false;
        } else if (!json_append_char(writer, (char)c)) {
            return false;
        }
    }
    return json_append_char(writer, '"');
}

static bool lua_to_json_text(lua_State *state, int index, unsigned depth,
                             json_writer_t *writer)
{
    if (depth > PA_LUA_JSON_DEPTH) return false;
    index = lua_absindex(state, index);
    switch (lua_type(state, index)) {
        case LUA_TNIL:
            return json_append(writer, "null", 4);
        case LUA_TBOOLEAN:
            return lua_toboolean(state, index)
                       ? json_append(writer, "true", 4)
                       : json_append(writer, "false", 5);
        case LUA_TNUMBER: {
            char number[32];
            int length;
            if (lua_isinteger(state, index)) {
                length = snprintf(number, sizeof(number), "%lld",
                                  (long long)lua_tointeger(state, index));
            } else {
                lua_Number value = lua_tonumber(state, index);
                if (!isfinite((double)value)) return false;
                length = snprintf(number, sizeof(number), "%.17g",
                                  (double)value);
            }
            return length > 0 && (size_t)length < sizeof(number) &&
                   json_append(writer, number, (size_t)length);
        }
        case LUA_TSTRING: {
            size_t length;
            const char *value = lua_tolstring(state, index, &length);
            return length <= CONFIG_PA_GAME_MAX_SNAPSHOT_BYTES &&
                   json_append_string(writer, value, length);
        }
        case LUA_TTABLE: {
            size_t length = 0;
            bool array = table_is_array(state, index, &length);
            if (!json_append_char(writer, array ? '[' : '{')) return false;
            bool first = true;
            if (array) {
                for (size_t i = 1; i <= length; ++i) {
                    if (!first && !json_append_char(writer, ',')) return false;
                    lua_rawgeti(state, index, (lua_Integer)i);
                    bool valid =
                        lua_to_json_text(state, -1, depth + 1, writer);
                    lua_pop(state, 1);
                    if (!valid) return false;
                    first = false;
                }
            } else {
                lua_pushnil(state);
                while (lua_next(state, index) != 0) {
                    if (lua_type(state, -2) != LUA_TSTRING) {
                        lua_pop(state, 2);
                        return false;
                    }
                    size_t key_length;
                    const char *key =
                        lua_tolstring(state, -2, &key_length);
                    bool valid =
                        (first || json_append_char(writer, ',')) &&
                        json_append_string(writer, key, key_length) &&
                        json_append_char(writer, ':') &&
                        lua_to_json_text(
                            state, -1, depth + 1, writer);
                    lua_pop(state, 1);
                    if (!valid) {
                        lua_pop(state, 1);
                        return false;
                    }
                    first = false;
                }
            }
            return json_append_char(writer, array ? ']' : '}');
        }
        default:
            return false;
    }
}

static game_runtime_t *closure_runtime(lua_State *state)
{
    return lua_touserdata(state, lua_upvalueindex(1));
}

static int capability_error(lua_State *state, esp_err_t result,
                            const char *name)
{
    if (result == ESP_OK) return 0;
    return luaL_error(state, "%s failed (%s)", name,
                      esp_err_to_name(result));
}

static int lua_match_players(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    if (!(runtime->capabilities & APP_CAP_MATCH_SEATS) ||
        !runtime->host.players) {
        return luaL_error(state, "match.players capability denied");
    }
    game_runtime_player_t players[CONFIG_PA_GAME_MAX_PLAYERS] = {0};
    size_t count = runtime->host.players(
        runtime->host.context, players,
        sizeof(players) / sizeof(players[0]));
    if (count > sizeof(players) / sizeof(players[0])) {
        return luaL_error(state, "match.players exceeded platform limit");
    }
    lua_createtable(state, (int)count, 0);
    for (size_t i = 0; i < count; ++i) {
        lua_createtable(state, 0, 5);
        lua_pushstring(state, players[i].profile_id);
        lua_setfield(state, -2, "profileId");
        lua_pushstring(state, players[i].nickname);
        lua_setfield(state, -2, "nickname");
        lua_pushinteger(state, players[i].wins);
        lua_setfield(state, -2, "wins");
        lua_pushinteger(state, players[i].seat);
        lua_setfield(state, -2, "seat");
        lua_pushboolean(state, players[i].connected);
        lua_setfield(state, -2, "connected");
        lua_rawseti(state, -2, (lua_Integer)i + 1);
    }
    return 1;
}

static int lua_match_state(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    const char *value = runtime->host.match_state
                            ? runtime->host.match_state(runtime->host.context)
                            : "closed";
    lua_pushstring(state, value);
    return 1;
}

static int lua_match_start_countdown(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    if (!(runtime->capabilities & APP_CAP_MATCH_SEATS)) {
        return luaL_error(state,
                          "match.start_countdown capability denied");
    }
    esp_err_t result = runtime->host.start_countdown
                           ? runtime->host.start_countdown(
                                 runtime->host.context)
                           : ESP_ERR_NOT_SUPPORTED;
    return capability_error(state, result, "match.start_countdown");
}

static int lua_match_finish(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    if (!(runtime->capabilities & APP_CAP_MATCH_RESULTS)) {
        return luaL_error(state, "match.finish capability denied");
    }
    luaL_checktype(state, 1, LUA_TTABLE);
    cJSON *result_json = lua_to_json(state, 1, 0);
    if (!result_json) return luaL_error(state, "invalid match result");
    esp_err_t result = runtime->host.finish
                           ? runtime->host.finish(runtime->host.context,
                                                  result_json)
                           : ESP_ERR_NOT_SUPPORTED;
    cJSON_Delete(result_json);
    return capability_error(state, result, "match.finish");
}

static int lua_transport_broadcast_snapshot(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    cJSON *payload = lua_to_json(state, 1, 0);
    if (!payload) return luaL_error(state, "invalid snapshot payload");
    esp_err_t result = runtime->host.broadcast_snapshot
                           ? runtime->host.broadcast_snapshot(
                                 runtime->host.context, payload)
                           : ESP_ERR_NOT_SUPPORTED;
    cJSON_Delete(payload);
    return capability_error(state, result,
                            "transport.broadcast_snapshot");
}

static int lua_transport_send_snapshot(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    const char *profile_id = luaL_checkstring(state, 1);
    cJSON *payload = lua_to_json(state, 2, 0);
    if (!payload) return luaL_error(state, "invalid snapshot payload");
    esp_err_t result = runtime->host.send_snapshot
                           ? runtime->host.send_snapshot(
                                 runtime->host.context, profile_id, payload)
                           : ESP_ERR_NOT_SUPPORTED;
    cJSON_Delete(payload);
    return capability_error(state, result, "transport.send_snapshot");
}

static int lua_transport_broadcast_event(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    size_t name_length;
    const char *name = luaL_checklstring(state, 1, &name_length);
    if (!name_length || name_length > PA_GAME_ACTION_MAX) {
        return luaL_error(state, "event name is invalid");
    }
    cJSON *payload = lua_to_json(state, 2, 0);
    if (!payload) return luaL_error(state, "invalid event payload");
    esp_err_t result = runtime->host.broadcast_event
                           ? runtime->host.broadcast_event(
                                 runtime->host.context, name, payload)
                           : ESP_ERR_NOT_SUPPORTED;
    cJSON_Delete(payload);
    return capability_error(state, result,
                            "transport.broadcast_event");
}

static int lua_clock_tick(lua_State *state)
{
    lua_pushinteger(state, (lua_Integer)system_uptime_ms());
    return 1;
}

static int lua_random_next(lua_State *state)
{
    lua_pushinteger(state, (lua_Integer)(esp_random() & 0x7fffffffU));
    return 1;
}

static bool valid_storage_key(const char *key)
{
    size_t length = key ? strlen(key) : 0;
    if (!length || length > CONFIG_PA_GAME_STORAGE_KEY_BYTES) return false;
    for (size_t i = 0; i < length; ++i) {
        char c = key[i];
        if (!((c >= 'a' && c <= 'z') ||
              (c >= 'A' && c <= 'Z') ||
              (c >= '0' && c <= '9') ||
              c == '-' || c == '_' || c == '.')) return false;
    }
    return true;
}

static int lua_storage_read(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    if (!(runtime->capabilities & APP_CAP_STORAGE_APP_DATA)) {
        return luaL_error(state, "storage.read capability denied");
    }
    const char *key = luaL_checkstring(state, 1);
    if (!valid_storage_key(key)) return luaL_error(state, "invalid storage key");
    char path[256];
    snprintf(path, sizeof(path), "%s/data/apps/%s/%s.json",
             PA_SD_MOUNT_POINT, runtime->app_id, key);
    storage_filesystem_lock();
    FILE *file = storage_is_mounted() ? fopen(path, "rb") : NULL;
    if (!file) {
        storage_filesystem_unlock();
        lua_pushnil(state);
        return 1;
    }
    bool valid = fseek(file, 0, SEEK_END) == 0;
    long length = valid ? ftell(file) : -1;
    rewind(file);
    if (length <= 0 || length > CONFIG_PA_GAME_STORAGE_RECORD_BYTES) {
        fclose(file);
        storage_filesystem_unlock();
        return luaL_error(state, "stored record is invalid");
    }
    char *buffer = malloc((size_t)length + 1);
    bool read_ok =
        buffer && fread(buffer, 1, (size_t)length, file) == (size_t)length;
    fclose(file);
    storage_filesystem_unlock();
    if (!read_ok) {
        free(buffer);
        return luaL_error(state, "storage read failed");
    }
    buffer[length] = '\0';
    cJSON *json = cJSON_ParseWithLength(buffer, (size_t)length);
    free(buffer);
    if (!json || !push_json(state, json, 0)) {
        cJSON_Delete(json);
        return luaL_error(state, "stored record is invalid");
    }
    cJSON_Delete(json);
    return 1;
}

static int lua_storage_write(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    if (!(runtime->capabilities & APP_CAP_STORAGE_APP_DATA)) {
        return luaL_error(state, "storage.write capability denied");
    }
    if (runtime->in_tick_callback) {
        return luaL_error(state,
                          "storage.write is not allowed during on_tick");
    }
    const char *key = luaL_checkstring(state, 1);
    if (!valid_storage_key(key)) return luaL_error(state, "invalid storage key");
    cJSON *json = lua_to_json(state, 2, 0);
    if (!json) return luaL_error(state, "invalid storage value");
    char *encoded = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!encoded) return luaL_error(state, "storage encoding failed");
    size_t length = strlen(encoded);
    if (length > CONFIG_PA_GAME_STORAGE_RECORD_BYTES) {
        cJSON_free(encoded);
        return luaL_error(state, "storage record is too large");
    }
    char relative[160];
    snprintf(relative, sizeof(relative), "data/apps/%s/%s.json",
             runtime->app_id, key);
    esp_err_t result =
        storage_enqueue_atomic_write(relative, encoded, length);
    cJSON_free(encoded);
    return capability_error(state, result, "storage.write");
}

static int lua_log_info(lua_State *state)
{
    game_runtime_t *runtime = closure_runtime(state);
    size_t length;
    const char *message = luaL_checklstring(state, 1, &length);
    if (length > 160) return luaL_error(state, "log message is too long");
    ESP_LOGI(TAG, "[%.48s] %.*s", runtime->app_id, (int)length, message);
    return 0;
}

static void register_namespace(lua_State *state, game_runtime_t *runtime,
                               const char *name, const luaL_Reg *functions)
{
    lua_newtable(state);
    for (const luaL_Reg *entry = functions; entry->name; ++entry) {
        lua_pushlightuserdata(state, runtime);
        lua_pushcclosure(state, entry->func, 1);
        lua_setfield(state, -2, entry->name);
    }
    lua_setglobal(state, name);
}

static void open_sandbox(game_runtime_t *runtime)
{
    lua_State *state = runtime_state(runtime);
    static const struct {
        const char *name;
        lua_CFunction open;
    } libraries[] = {
        {LUA_GNAME, luaopen_base},
        {LUA_COLIBNAME, luaopen_coroutine},
        {LUA_TABLIBNAME, luaopen_table},
        {LUA_STRLIBNAME, luaopen_string},
        {LUA_MATHLIBNAME, luaopen_math},
        {LUA_UTF8LIBNAME, luaopen_utf8},
    };
    for (size_t i = 0; i < sizeof(libraries) / sizeof(libraries[0]); ++i) {
        luaL_requiref(state, libraries[i].name, libraries[i].open, 1);
        lua_pop(state, 1);
    }
    static const char *blocked[] = {
        "dofile", "load", "loadfile", "require", "collectgarbage", "print",
        "getmetatable", "setmetatable",
    };
    for (size_t i = 0; i < sizeof(blocked) / sizeof(blocked[0]); ++i) {
        lua_pushnil(state);
        lua_setglobal(state, blocked[i]);
    }
    static const luaL_Reg match_functions[] = {
        {"players", lua_match_players},
        {"state", lua_match_state},
        {"start_countdown", lua_match_start_countdown},
        {"finish", lua_match_finish},
        {NULL, NULL},
    };
    static const luaL_Reg transport_functions[] = {
        {"broadcast_snapshot", lua_transport_broadcast_snapshot},
        {"send_snapshot", lua_transport_send_snapshot},
        {"broadcast_event", lua_transport_broadcast_event},
        {NULL, NULL},
    };
    static const luaL_Reg clock_functions[] = {
        {"tick", lua_clock_tick}, {NULL, NULL},
    };
    static const luaL_Reg random_functions[] = {
        {"next", lua_random_next}, {NULL, NULL},
    };
    static const luaL_Reg storage_functions[] = {
        {"read", lua_storage_read},
        {"write", lua_storage_write},
        {NULL, NULL},
    };
    static const luaL_Reg log_functions[] = {
        {"info", lua_log_info}, {NULL, NULL},
    };
    register_namespace(state, runtime, "match", match_functions);
    register_namespace(state, runtime, "transport", transport_functions);
    register_namespace(state, runtime, "clock", clock_functions);
    register_namespace(state, runtime, "random", random_functions);
    register_namespace(state, runtime, "storage", storage_functions);
    register_namespace(state, runtime, "log", log_functions);
}

static int open_sandbox_entry(lua_State *state)
{
    game_runtime_t *runtime =
        *(game_runtime_t **)lua_getextraspace(state);
    open_sandbox(runtime);
    return 0;
}

typedef struct {
    FILE *file;
    const unsigned char *data;
    size_t offset;
    size_t remaining;
    bool read_failed;
    bool storage_locked;
    char buffer[512];
} script_reader_t;

static const char *read_script_chunk(lua_State *state, void *data,
                                     size_t *size)
{
    (void)state;
    script_reader_t *reader = data;
    if (!reader || reader->read_failed || reader->remaining == 0) {
        *size = 0;
        return NULL;
    }
    size_t requested = reader->remaining < sizeof(reader->buffer)
                           ? reader->remaining : sizeof(reader->buffer);
    if (reader->data) {
        const char *chunk = (const char *)reader->data + reader->offset;
        reader->offset += requested;
        reader->remaining -= requested;
        *size = requested;
        return chunk;
    }
    if (!reader->file) {
        reader->read_failed = true;
        *size = 0;
        return NULL;
    }
    size_t count = fread(reader->buffer, 1, requested, reader->file);
    if (count != requested) reader->read_failed = true;
    reader->remaining -= count;
    *size = count;
    return count ? reader->buffer : NULL;
}

/*
 * The filesystem lock remains held until close_script() so an SD eject cannot
 * invalidate the FILE while lua_load() pulls bounded source chunks from it.
 * Streaming avoids keeping the whole source and compiled Lua function in heap
 * at the same time.
 */
static esp_err_t open_script(const app_descriptor_t *application,
                             script_reader_t *reader)
{
    if (!application || !reader) return ESP_ERR_INVALID_ARG;
    memset(reader, 0, sizeof(*reader));
    if (application->source == APP_SOURCE_BUILTIN) {
        const pa_builtin_app_file_t *file = pa_builtin_app_file_find(
            application->id, application->runtime_entrypoint);
        if (!file) return ESP_ERR_NOT_FOUND;
        if (file->encoding || file->length == 0 ||
            file->length > CONFIG_PA_GAME_MAX_SCRIPT_BYTES) {
            return ESP_ERR_INVALID_SIZE;
        }
        reader->data = file->data;
        reader->remaining = file->length;
        return ESP_OK;
    }

    char path[256];
    snprintf(path, sizeof(path), "%s/apps/%s/%s", PA_SD_MOUNT_POINT,
             application->id, application->runtime_entrypoint);
    storage_filesystem_lock();
    FILE *file = storage_is_mounted() ? fopen(path, "rb") : NULL;
    if (!file) {
        storage_filesystem_unlock();
        return ESP_ERR_NOT_FOUND;
    }
    bool valid = fseek(file, 0, SEEK_END) == 0;
    long length = valid ? ftell(file) : -1;
    rewind(file);
    if (length <= 0 || length > CONFIG_PA_GAME_MAX_SCRIPT_BYTES) {
        fclose(file);
        storage_filesystem_unlock();
        return ESP_ERR_INVALID_SIZE;
    }
    reader->file = file;
    reader->remaining = (size_t)length;
    reader->storage_locked = true;
    return ESP_OK;
}

static void close_script(script_reader_t *reader)
{
    if (!reader) return;
    if (reader->file) fclose(reader->file);
    if (reader->storage_locked) storage_filesystem_unlock();
    reader->file = NULL;
    reader->storage_locked = false;
}

static int setup_runtime_entry(lua_State *state)
{
    game_runtime_t *runtime =
        *(game_runtime_t **)lua_getextraspace(state);
    static const char *callbacks[] = {
        "init",
        "on_match_open",
        "on_player_join",
        "on_player_leave",
        "on_player_update",
        "on_command",
        "on_tick",
        "on_snapshot",
        "on_unload",
    };
    luaL_checktype(state, 1, LUA_TTABLE);
    if (lua_getmetatable(state, 1)) {
        return luaL_error(state,
                          "callback table must not have a metatable");
    }
    for (size_t i = 0; i < sizeof(callbacks) / sizeof(callbacks[0]); ++i) {
        lua_pushstring(state, callbacks[i]);
        lua_rawget(state, 1);
        bool valid = lua_isnil(state, -1) || lua_isfunction(state, -1);
        lua_pop(state, 1);
        if (!valid) {
            return luaL_error(state, "%s must be a function",
                              callbacks[i]);
        }
    }
    lua_pushvalue(state, 1);
    runtime->callbacks_ref = luaL_ref(state, LUA_REGISTRYINDEX);
    lua_newtable(state);
    runtime->context_ref = luaL_ref(state, LUA_REGISTRYINDEX);
    return 0;
}

static bool push_pending_callback(lua_State *state,
                                  game_runtime_t *runtime)
{
    lua_rawgeti(state, LUA_REGISTRYINDEX, runtime->callbacks_ref);
    lua_pushstring(state, runtime->pending_callback);
    lua_rawget(state, -2);
    lua_remove(state, -2);
    if (lua_isnil(state, -1)) {
        lua_pop(state, 1);
        return false;
    }
    lua_rawgeti(state, LUA_REGISTRYINDEX, runtime->context_ref);
    return true;
}

static int invoke_simple_entry(lua_State *state)
{
    game_runtime_t *runtime =
        *(game_runtime_t **)lua_getextraspace(state);
    if (!push_pending_callback(state, runtime)) return 0;
    lua_call(state, 1, 0);
    return 0;
}

static esp_err_t call_simple(game_runtime_t *runtime, const char *callback)
{
    if (!runtime->loaded || runtime->faulted) return ESP_ERR_INVALID_STATE;
    lua_State *state = runtime_state(runtime);
    int top = lua_gettop(state);
    runtime->pending_callback = callback;
    lua_pushcfunction(state, invoke_simple_entry);
    int status = protected_call(runtime, 0, 0, callback);
    runtime->pending_callback = NULL;
    if (status != LUA_OK) return ESP_FAIL;
    lua_settop(state, top);
    return ESP_OK;
}

esp_err_t game_runtime_load(game_runtime_t *runtime,
                            const app_descriptor_t *application,
                            const game_runtime_host_t *host)
{
    if (!runtime || !application || !host ||
        strcmp(application->runtime_type, "lua") != 0) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(runtime, 0, sizeof(*runtime));
    strlcpy(runtime->app_id, application->id, sizeof(runtime->app_id));
    strlcpy(runtime->runtime_entrypoint, application->runtime_entrypoint,
            sizeof(runtime->runtime_entrypoint));
    runtime->capabilities = application->capabilities;
    runtime->memory_quota = CONFIG_PA_GAME_RUNTIME_MEMORY_BYTES;
    runtime->callbacks_ref = LUA_NOREF;
    runtime->context_ref = LUA_NOREF;
    runtime->host = *host;

    script_reader_t reader;
    esp_err_t result = open_script(application, &reader);
    if (result != ESP_OK) {
        runtime_fault(runtime, "server script could not be read");
        return result;
    }
    lua_State *state = lua_newstate(quota_allocator, runtime);
    runtime->lua_state = state;
    if (!state) {
        close_script(&reader);
        runtime_fault(runtime, "runtime memory quota is too small");
        return ESP_ERR_NO_MEM;
    }
    *(game_runtime_t **)lua_getextraspace(state) = runtime;
    lua_atpanic(state, panic_handler);
    lua_pushcfunction(state, open_sandbox_entry);
    if (protected_call(runtime, 0, 0, "sandbox") != LUA_OK) {
        close_script(&reader);
        return ESP_FAIL;
    }

    int load_status = lua_load(state, read_script_chunk, &reader,
                               application->runtime_entrypoint, "t");
    close_script(&reader);
    if (reader.read_failed || reader.remaining != 0) {
        runtime_fault(runtime, "server script could not be read");
        return ESP_FAIL;
    }
    if (load_status != LUA_OK) {
        const char *message = lua_tostring(state, -1);
        runtime_fault(runtime, message ? message : "script compilation failed");
        return ESP_FAIL;
    }
    if (protected_call(runtime, 0, 1, "load") != LUA_OK) return ESP_FAIL;
    state = runtime_state(runtime);
    if (!state || !lua_istable(state, -1)) {
        runtime_fault(runtime, "server script must return a callback table");
        return ESP_ERR_INVALID_RESPONSE;
    }
    lua_pushcfunction(state, setup_runtime_entry);
    lua_insert(state, -2);
    if (protected_call(runtime, 1, 0, "validate") != LUA_OK) {
        return ESP_ERR_INVALID_RESPONSE;
    }
    runtime->loaded = true;
    if (call_simple(runtime, "init") != ESP_OK ||
        call_simple(runtime, "on_match_open") != ESP_OK) {
        return ESP_FAIL;
    }
    ESP_LOGI(TAG,
             "Loaded %.48s (%u bytes Lua high-water, heap %u internal, "
             "%u external)",
             runtime->app_id, (unsigned)runtime->memory_high_water,
             (unsigned)heap_caps_get_free_size(
                 MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    return ESP_OK;
}

static void push_player(lua_State *state, const public_profile_t *profile)
{
    lua_createtable(state, 0, 5);
    lua_pushstring(state, profile->id);
    lua_setfield(state, -2, "profileId");
    lua_pushstring(state, profile->nickname);
    lua_setfield(state, -2, "nickname");
    lua_pushinteger(state, profile->wins);
    lua_setfield(state, -2, "wins");
    lua_pushboolean(state, profile->persistent);
    lua_setfield(state, -2, "persistent");
}

static int invoke_command_entry(lua_State *state)
{
    game_runtime_t *runtime =
        *(game_runtime_t **)lua_getextraspace(state);
    if (!push_pending_callback(state, runtime)) return 0;
    lua_createtable(state, 0, 1);
    lua_pushstring(state, runtime->pending_profile_id);
    lua_setfield(state, -2, "profileId");
    lua_pushstring(state, runtime->pending_action);
    if (!push_json(state, runtime->pending_data, 0)) {
        return luaL_error(state,
                          "command data exceeds conversion limits");
    }
    lua_pushinteger(state, runtime->pending_number);
    lua_call(state, 5, 0);
    return 0;
}

esp_err_t game_runtime_command(game_runtime_t *runtime,
                               const char *profile_id,
                               const char *action,
                               cJSON *data,
                               uint32_t input_sequence)
{
    if (!runtime || !runtime->loaded || !profile_id || !action || !data) {
        return ESP_ERR_INVALID_ARG;
    }
    lua_State *state = runtime_state(runtime);
    int top = lua_gettop(state);
    runtime->pending_callback = "on_command";
    runtime->pending_profile_id = profile_id;
    runtime->pending_action = action;
    runtime->pending_data = data;
    runtime->pending_number = input_sequence;
    lua_pushcfunction(state, invoke_command_entry);
    int status = protected_call(runtime, 0, 0, "on_command");
    runtime->pending_callback = NULL;
    runtime->pending_profile_id = NULL;
    runtime->pending_action = NULL;
    runtime->pending_data = NULL;
    if (status != LUA_OK) return ESP_FAIL;
    lua_settop(state, top);
    return ESP_OK;
}

static int invoke_player_event_entry(lua_State *state)
{
    game_runtime_t *runtime =
        *(game_runtime_t **)lua_getextraspace(state);
    if (!push_pending_callback(state, runtime)) return 0;
    push_player(state, runtime->pending_profile);
    int arguments = 2;
    if (runtime->pending_reason) {
        lua_pushstring(state, runtime->pending_reason);
        ++arguments;
    }
    lua_call(state, arguments, 0);
    return 0;
}

esp_err_t game_runtime_player_event(game_runtime_t *runtime,
                                    game_runtime_player_event_t event,
                                    const public_profile_t *profile,
                                    const char *reason)
{
    if (!runtime || !runtime->loaded || !profile) {
        return ESP_ERR_INVALID_ARG;
    }
    const char *callback =
        event == GAME_RUNTIME_PLAYER_JOINED ? "on_player_join"
        : event == GAME_RUNTIME_PLAYER_LEFT ? "on_player_leave"
                                             : "on_player_update";
    lua_State *state = runtime_state(runtime);
    int top = lua_gettop(state);
    runtime->pending_callback = callback;
    runtime->pending_profile = profile;
    runtime->pending_reason =
        event == GAME_RUNTIME_PLAYER_LEFT
            ? (reason ? reason : "left") : NULL;
    lua_pushcfunction(state, invoke_player_event_entry);
    int status = protected_call(runtime, 0, 0, callback);
    runtime->pending_callback = NULL;
    runtime->pending_profile = NULL;
    runtime->pending_reason = NULL;
    if (status != LUA_OK) return ESP_FAIL;
    lua_settop(state, top);
    return ESP_OK;
}

static int invoke_tick_entry(lua_State *state)
{
    game_runtime_t *runtime =
        *(game_runtime_t **)lua_getextraspace(state);
    if (!push_pending_callback(state, runtime)) return 0;
    lua_pushinteger(state, runtime->pending_number);
    lua_call(state, 2, 0);
    return 0;
}

esp_err_t game_runtime_tick(game_runtime_t *runtime, uint32_t delta_ms)
{
    if (!runtime || !runtime->loaded) return ESP_ERR_INVALID_STATE;
    lua_State *state = runtime_state(runtime);
    int top = lua_gettop(state);
    runtime->pending_callback = "on_tick";
    runtime->pending_number = delta_ms;
    lua_pushcfunction(state, invoke_tick_entry);
    runtime->in_tick_callback = true;
    int status = protected_call(runtime, 0, 0, "on_tick");
    runtime->in_tick_callback = false;
    runtime->pending_callback = NULL;
    if (status != LUA_OK) return ESP_FAIL;
    lua_settop(state, top);
    return ESP_OK;
}

static int invoke_snapshot_entry(lua_State *state)
{
    game_runtime_t *runtime =
        *(game_runtime_t **)lua_getextraspace(state);
    if (!push_pending_callback(state, runtime)) {
        lua_pushnil(state);
        return 1;
    }
    if (runtime->pending_profile_id) {
        lua_createtable(state, 0, 1);
        lua_pushstring(state, runtime->pending_profile_id);
        lua_setfield(state, -2, "profileId");
    } else {
        lua_pushnil(state);
    }
    lua_call(state, 2, 1);
    return 1;
}

esp_err_t game_runtime_snapshot(game_runtime_t *runtime,
                                const char *recipient_profile_id,
                                cJSON **snapshot)
{
    if (snapshot) *snapshot = NULL;
    if (!runtime || !runtime->loaded || !snapshot) {
        return ESP_ERR_INVALID_ARG;
    }
    lua_State *state = runtime_state(runtime);
    int top = lua_gettop(state);
    runtime->pending_callback = "on_snapshot";
    runtime->pending_profile_id = recipient_profile_id;
    lua_pushcfunction(state, invoke_snapshot_entry);
    int status = protected_call(runtime, 0, 1, "on_snapshot");
    runtime->pending_callback = NULL;
    runtime->pending_profile_id = NULL;
    if (status != LUA_OK) return ESP_FAIL;
    state = runtime_state(runtime);
    if (!lua_isnil(state, -1)) {
        json_writer_t writer = {
            .data = runtime->snapshot_json,
            .capacity = sizeof(runtime->snapshot_json),
        };
        runtime->snapshot_json[0] = '\0';
        bool encoded =
            lua_to_json_text(state, -1, 0, &writer);
        if (encoded) {
            *snapshot =
                cJSON_CreateStringReference(runtime->snapshot_json);
            if (*snapshot) {
                (*snapshot)->type = cJSON_Raw | cJSON_IsReference;
            }
        }
        if (!*snapshot) {
            ESP_LOGE(
                TAG,
                "%.48s snapshot conversion failed "
                "(Lua %u/%u bytes, heap %u, largest block %u)",
                runtime->app_id, (unsigned)runtime->memory_used,
                (unsigned)runtime->memory_high_water,
                (unsigned)esp_get_free_heap_size(),
                (unsigned)heap_caps_get_largest_free_block(
                    MALLOC_CAP_8BIT));
            lua_settop(state, top);
            runtime_fault(runtime, "snapshot is not valid JSON data");
            return ESP_FAIL;
        }
    }
    lua_settop(state, top);
    return ESP_OK;
}

void game_runtime_unload(game_runtime_t *runtime)
{
    if (!runtime) return;
    if (runtime->loaded && !runtime->faulted) {
        (void)call_simple(runtime, "on_unload");
    }
    close_state(runtime);
    ESP_LOGI(TAG, "Unloaded %.48s (Lua high-water %u bytes)",
             runtime->app_id, (unsigned)runtime->memory_high_water);
}

const char *game_runtime_fault_message(const game_runtime_t *runtime)
{
    return runtime && runtime->fault_message[0]
               ? runtime->fault_message : "Lua runtime failed";
}
