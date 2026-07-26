#include "pa_protocol.h"
#include "pa_board.h"

cJSON *pa_message_create(const char *type, uint32_t id, cJSON *payload)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        cJSON_Delete(payload);
        return NULL;
    }
    cJSON_AddNumberToObject(root, "v", PA_PROTOCOL_VERSION);
    cJSON_AddStringToObject(root, "type", type);
    cJSON_AddNumberToObject(root, "id", id);
    cJSON_AddItemToObject(root, "payload", payload ? payload : cJSON_CreateObject());
    return root;
}

char *pa_message_print(const char *type, uint32_t id, cJSON *payload)
{
    cJSON *root = pa_message_create(type, id, payload);
    if (!root) {
        return NULL;
    }
    char *text = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return text;
}
