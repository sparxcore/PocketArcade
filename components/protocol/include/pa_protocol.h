#pragma once

#include <stdint.h>
#include "cJSON.h"

#define PA_TYPE_SYSTEM_HELLO "system.hello"
#define PA_TYPE_SYSTEM_WELCOME "system.welcome"
#define PA_TYPE_PRESENCE_SNAPSHOT "presence.snapshot"
#define PA_TYPE_PRESENCE_JOINED "presence.joined"
#define PA_TYPE_PRESENCE_UPDATED "presence.updated"
#define PA_TYPE_PRESENCE_LEFT "presence.left"
#define PA_TYPE_STORAGE_MOUNTED "storage.mounted"
#define PA_TYPE_STORAGE_UNMOUNTED "storage.unmounted"
#define PA_TYPE_STORAGE_ERROR "storage.error"
#define PA_TYPE_CHAT_SNAPSHOT "chat.snapshot"
#define PA_TYPE_CHAT_SEND "chat.send"
#define PA_TYPE_CHAT_MESSAGE "chat.message"
#define PA_TYPE_GAME_TTT_SNAPSHOT "game.tictactoe.snapshot"
#define PA_TYPE_GAME_TTT_UPDATED "game.tictactoe.updated"
#define PA_TYPE_GAME_TTT_JOIN "game.tictactoe.join"
#define PA_TYPE_GAME_TTT_MOVE "game.tictactoe.move"
#define PA_TYPE_GAME_TTT_LEAVE "game.tictactoe.leave"
#define PA_TYPE_GAME_TTT_RESET "game.tictactoe.reset"
#define PA_TYPE_ERROR_AUTH "error.authentication"
#define PA_TYPE_ERROR_PROTOCOL "error.protocol"
#define PA_TYPE_ERROR_CHAT "error.chat"
#define PA_TYPE_ERROR_GAME "error.game"

cJSON *pa_message_create(const char *type, uint32_t id, cJSON *payload);
char *pa_message_print(const char *type, uint32_t id, cJSON *payload);
