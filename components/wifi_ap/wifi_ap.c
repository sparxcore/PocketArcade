#include "wifi_ap.h"

#include <string.h>
#include <sys/socket.h>
#include "device_identity.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_wifi_ap_get_sta_list.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "lwip/inet.h"
#include "system_state.h"

static const char *TAG = "WIFI_AP";
/*
 * DHCP option 114 points modern clients at the RFC 8908 captive-portal API.
 * The API then identifies the human-facing portal URL. Legacy probes are
 * still handled by captive_portal.
 */
static char captive_portal_uri[] =
    "http://" PA_GATEWAY_STRING "/captive-portal";

typedef struct {
    bool associated;
    bool has_ip;
    uint8_t mac[6];
    uint32_t ip;
    uint64_t generation;
} station_entry_t;

static station_entry_t stations[CONFIG_PA_AP_MAX_CLIENTS];
static SemaphoreHandle_t stations_lock;
static esp_netif_t *ap_netif;
static uint64_t generation;

static void masked_mac(const uint8_t mac[6], char output[18])
{
    snprintf(output, 18, "%02X:%02X:%02X:xx:xx:xx", mac[0], mac[1], mac[2]);
}

static int find_mac_locked(const uint8_t mac[6])
{
    for (size_t i = 0; i < CONFIG_PA_AP_MAX_CLIENTS; ++i) {
        if (stations[i].associated &&
            memcmp(stations[i].mac, mac, 6) == 0) {
            return (int)i;
        }
    }
    return -1;
}

static int reserve_locked(const uint8_t mac[6])
{
    int existing = find_mac_locked(mac);
    if (existing >= 0) {
        return existing;
    }
    for (size_t i = 0; i < CONFIG_PA_AP_MAX_CLIENTS; ++i) {
        if (!stations[i].associated) {
            memset(&stations[i], 0, sizeof(stations[i]));
            stations[i].associated = true;
            memcpy(stations[i].mac, mac, 6);
            stations[i].generation = ++generation;
            return (int)i;
        }
    }
    return -1;
}

static size_t count_locked(void)
{
    size_t count = 0;
    for (size_t i = 0; i < CONFIG_PA_AP_MAX_CLIENTS; ++i) {
        count += stations[i].associated ? 1 : 0;
    }
    return count;
}

static void refresh_ip_mappings(void)
{
    wifi_sta_list_t wifi_list = {0};
    wifi_sta_mac_ip_list_t netif_list = {0};
    if (esp_wifi_ap_get_sta_list(&wifi_list) != ESP_OK ||
        esp_wifi_ap_get_sta_list_with_ip(&wifi_list, &netif_list) != ESP_OK) {
        return;
    }
    if (!xSemaphoreTake(stations_lock, pdMS_TO_TICKS(100))) {
        return;
    }
    for (size_t i = 0; i < CONFIG_PA_AP_MAX_CLIENTS; ++i) {
        stations[i].has_ip = false;
    }
    for (int i = 0; i < netif_list.num; ++i) {
        int slot = reserve_locked(netif_list.sta[i].mac);
        if (slot >= 0) {
            stations[slot].ip = netif_list.sta[i].ip.addr;
            stations[slot].has_ip = true;
        }
    }
    xSemaphoreGive(stations_lock);
}

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    if (id == WIFI_EVENT_AP_STACONNECTED) {
        const wifi_event_ap_staconnected_t *event = data;
        if (xSemaphoreTake(stations_lock, 0)) {
            int slot = reserve_locked(event->mac);
            size_t count = count_locked();
            xSemaphoreGive(stations_lock);
            system_state_set_wifi_clients(count);
            if (slot < 0) {
                ESP_LOGW(TAG, "Station table full");
            }
        }
        char masked[18];
        masked_mac(event->mac, masked);
        ESP_LOGI(TAG, "Station associated (AID %d)", event->aid);
        ESP_LOGD(TAG, "Associated station %s", masked);
    } else if (id == WIFI_EVENT_AP_STADISCONNECTED) {
        const wifi_event_ap_stadisconnected_t *event = data;
        if (xSemaphoreTake(stations_lock, 0)) {
            int slot = find_mac_locked(event->mac);
            if (slot >= 0) {
                memset(&stations[slot], 0, sizeof(stations[slot]));
            }
            size_t count = count_locked();
            xSemaphoreGive(stations_lock);
            system_state_set_wifi_clients(count);
        }
        ESP_LOGI(TAG, "Station disconnected (AID %d)", event->aid);
    }
}

static void ip_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    (void)data;
    if (id == IP_EVENT_ASSIGNED_IP_TO_CLIENT) {
        refresh_ip_mappings();
        ESP_LOGI(TAG, "DHCP assigned a station address");
    }
}

esp_err_t wifi_ap_start(void)
{
    size_t password_length = strlen(CONFIG_PA_AP_PASSWORD);
    if (strlen(CONFIG_PA_AP_SSID) == 0 ||
        strlen(CONFIG_PA_AP_SSID) > sizeof(((wifi_config_t *)0)->ap.ssid) ||
        password_length > sizeof(((wifi_config_t *)0)->ap.password) - 1 ||
        (password_length > 0 && password_length < 8)) {
        ESP_LOGE(TAG,
                 "SSID must be 1-32 bytes; password must be empty or 8-63 bytes");
        return ESP_ERR_INVALID_ARG;
    }
    stations_lock = xSemaphoreCreateMutex();
    if (!stations_lock) {
        return ESP_ERR_NO_MEM;
    }

    ap_netif = esp_netif_create_default_wifi_ap();
    if (!ap_netif) {
        return ESP_FAIL;
    }
    esp_netif_set_hostname(ap_netif, CONFIG_PA_HOSTNAME);

    esp_netif_ip_info_t ip = {0};
    ESP_ERROR_CHECK(esp_netif_str_to_ip4(PA_GATEWAY_STRING, &ip.ip));
    ESP_ERROR_CHECK(esp_netif_str_to_ip4(PA_GATEWAY_STRING, &ip.gw));
    ESP_ERROR_CHECK(esp_netif_str_to_ip4("255.255.255.0", &ip.netmask));
    /*
     * A newly-created ESP-NETIF DHCP server can be in the INIT state before
     * Wi-Fi is started. esp_netif_set_ip_info() requires STOPPED, not merely
     * "not STARTED", so stop it unconditionally to transition INIT -> STOPPED.
     */
    esp_err_t dhcp_stop_err = esp_netif_dhcps_stop(ap_netif);
    if (dhcp_stop_err != ESP_OK &&
        dhcp_stop_err != ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED) {
        ESP_LOGE(TAG, "Could not stop DHCP server: %s",
                 esp_err_to_name(dhcp_stop_err));
        return dhcp_stop_err;
    }
    ESP_ERROR_CHECK(esp_netif_set_ip_info(ap_netif, &ip));
    ESP_ERROR_CHECK(esp_netif_dhcps_option(
        ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_CAPTIVEPORTAL_URI,
        captive_portal_uri, strlen(captive_portal_uri)));
    ESP_ERROR_CHECK(esp_netif_dhcps_start(ap_netif));

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(
        IP_EVENT, IP_EVENT_ASSIGNED_IP_TO_CLIENT, ip_event, NULL));

    wifi_config_t config = {0};
    strlcpy((char *)config.ap.ssid, CONFIG_PA_AP_SSID,
            sizeof(config.ap.ssid));
    strlcpy((char *)config.ap.password, CONFIG_PA_AP_PASSWORD,
            sizeof(config.ap.password));
    config.ap.ssid_len = (uint8_t)strlen(CONFIG_PA_AP_SSID);
    config.ap.channel = CONFIG_PA_AP_CHANNEL;
    config.ap.max_connection = CONFIG_PA_AP_MAX_CLIENTS;
    config.ap.authmode = password_length >= 8
                             ? WIFI_AUTH_WPA2_WPA3_PSK
                             : WIFI_AUTH_OPEN;
    config.ap.pmf_cfg.required = false;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG,
             "SoftAP \"%s\" on %s, channel %d, max clients %d, security %s",
             CONFIG_PA_AP_SSID, PA_GATEWAY_STRING, CONFIG_PA_AP_CHANNEL,
             CONFIG_PA_AP_MAX_CLIENTS,
             config.ap.authmode == WIFI_AUTH_OPEN ? "open" : "WPA2/WPA3");
    ESP_LOGI(TAG, "DHCP captive portal URI: %s", captive_portal_uri);
    return ESP_OK;
}

esp_err_t wifi_ap_fingerprint_for_ipv4(
    uint32_t ipv4_network_order,
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1])
{
    refresh_ip_mappings();
    if (!xSemaphoreTake(stations_lock, pdMS_TO_TICKS(100))) {
        return ESP_ERR_TIMEOUT;
    }
    uint8_t mac[6];
    bool found = false;
    uint64_t newest = 0;
    for (size_t i = 0; i < CONFIG_PA_AP_MAX_CLIENTS; ++i) {
        if (stations[i].associated && stations[i].has_ip &&
            stations[i].ip == ipv4_network_order &&
            stations[i].generation >= newest) {
            memcpy(mac, stations[i].mac, sizeof(mac));
            newest = stations[i].generation;
            found = true;
        }
    }
    xSemaphoreGive(stations_lock);
    return found ? device_identity_fingerprint_mac(mac, output_hex)
                 : ESP_ERR_NOT_FOUND;
}

esp_err_t wifi_ap_fingerprint_for_socket(
    int socket_fd,
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1])
{
    struct sockaddr_storage peer = {0};
    socklen_t length = sizeof(peer);
    if (getpeername(socket_fd, (struct sockaddr *)&peer, &length) != 0 ||
        peer.ss_family != AF_INET) {
        return ESP_ERR_NOT_FOUND;
    }
    const struct sockaddr_in *ipv4 = (const struct sockaddr_in *)&peer;
    return wifi_ap_fingerprint_for_ipv4(ipv4->sin_addr.s_addr, output_hex);
}

size_t wifi_ap_station_count(void)
{
    size_t count = 0;
    if (stations_lock && xSemaphoreTake(stations_lock, pdMS_TO_TICKS(100))) {
        count = count_locked();
        xSemaphoreGive(stations_lock);
    }
    return count;
}
