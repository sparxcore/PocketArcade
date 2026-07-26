#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "nvs_flash.h"

#include "app_catalogue.h"
#include "captive_portal.h"
#include "chat.h"
#include "device_identity.h"
#include "embedded_web.h"
#include "http_api.h"
#include "pa_board.h"
#include "pa_protocol.h"
#include "presence.h"
#include "profiles.h"
#include "storage.h"
#include "system_state.h"
#include "tic_tac_toe.h"
#include "websocket.h"
#include "wifi_ap.h"

static const char *TAG = "SYSTEM";

void app_main(void)
{
    ESP_LOGI(TAG, "%s firmware %s, protocol %d", PA_PRODUCT_NAME,
             PA_FIRMWARE_VERSION, PA_PROTOCOL_VERSION);

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    ESP_ERROR_CHECK(system_state_init());
    ESP_ERROR_CHECK(device_identity_init());
    ESP_ERROR_CHECK(storage_init());
    ESP_ERROR_CHECK(profile_store_init());
    ESP_ERROR_CHECK(presence_init());
    ESP_ERROR_CHECK(chat_init());
    ESP_ERROR_CHECK(tic_tac_toe_init());
    ESP_ERROR_CHECK(app_catalogue_init());
    ESP_ERROR_CHECK(wifi_ap_start());
    ESP_ERROR_CHECK(captive_portal_start());

    httpd_handle_t server = NULL;
    ESP_ERROR_CHECK(http_api_start(&server));
    ESP_ERROR_CHECK(websocket_register(server));
    ESP_ERROR_CHECK(http_api_register_routes(server));
    ESP_ERROR_CHECK(captive_portal_register_http(server));
    ESP_ERROR_CHECK(app_catalogue_register_http(server));
    ESP_ERROR_CHECK(embedded_web_register(server));
    websocket_bind_presence_events();
    websocket_bind_storage_events();

    ESP_LOGI(TAG, "Ready: connect to \"%s\" and open http://192.168.4.1/",
             CONFIG_PA_AP_SSID);
}
