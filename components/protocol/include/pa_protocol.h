#pragma once

#include <stdint.h>
#include "cJSON.h"

#define PA_TYPE_SYSTEM_HELLO "system.hello"
#define PA_TYPE_SYSTEM_WELCOME "system.welcome"
#define PA_TYPE_PRESENCE_SNAPSHOT "presence.snapshot"
#define PA_TYPE_PRESENCE_JOINED "presence.joined"
#define PA_TYPE_PRESENCE_UPDATED "presence.updated"
#define PA_TYPE_PRESENCE_LEFT "presence.left"
#define PA_TYPE_PRESENCE_APP "presence.app"
#define PA_TYPE_STORAGE_MOUNTED "storage.mounted"
#define PA_TYPE_STORAGE_UNMOUNTED "storage.unmounted"
#define PA_TYPE_STORAGE_ERROR "storage.error"
#define PA_TYPE_CHAT_SNAPSHOT "chat.snapshot"
#define PA_TYPE_CHAT_SEND "chat.send"
#define PA_TYPE_CHAT_MESSAGE "chat.message"
#define PA_TYPE_GAME_JOIN "game.join"
#define PA_TYPE_GAME_LEAVE "game.leave"
#define PA_TYPE_GAME_READY "game.ready"
#define PA_TYPE_GAME_COMMAND "game.command"
#define PA_TYPE_GAME_CONTROL_CLAIM "game.control.claim"
#define PA_TYPE_GAME_SNAPSHOT_REQUEST "game.snapshot.request"
#define PA_TYPE_GAME_MATCH "game.match"
#define PA_TYPE_GAME_SNAPSHOT "game.snapshot"
#define PA_TYPE_GAME_EVENT "game.event"
#define PA_TYPE_GAME_RESULT "game.result"
#define PA_TYPE_GAME_ERROR "game.error"
#define PA_TYPE_ERROR_AUTH "error.authentication"
#define PA_TYPE_ERROR_PROTOCOL "error.protocol"
#define PA_TYPE_ERROR_CHAT "error.chat"
#define PA_TYPE_ERROR_GAME "error.game"

#define PA_GAME_BINARY_VERSION 1
#define PA_GAME_BINARY_KIND_SNAPSHOT 1
#define PA_GAME_BINARY_FLAG_FULL_SNAPSHOT (1u << 0)
#define PA_GAME_BINARY_HEADER_BYTES 36

cJSON *pa_message_create(const char *type, uint32_t id, cJSON *payload);
char *pa_message_print(const char *type, uint32_t id, cJSON *payload);
