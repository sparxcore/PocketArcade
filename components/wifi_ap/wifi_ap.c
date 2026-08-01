#include "wifi_ap.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include "device_identity.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "esp_wifi_ap_get_sta_list.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lwip/inet.h"
#include "nvs.h"
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
static char configured_ssid[PA_WIFI_SSID_MAX_LEN + 1];
static char configured_access_key[PA_WIFI_ACCESS_KEY_MAX_LEN + 1];
static bool settings_ready;

#define PA_WIFI_RECONFIGURE_DELAY_MS 1500

static const char suffix_alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

typedef struct {
    char access_key[PA_WIFI_ACCESS_KEY_MAX_LEN + 1];
} security_change_t;

static bool valid_access_key(const char *access_key)
{
    if (!access_key) return false;
    size_t length = strlen(access_key);
    if (length == 0) return true;
    if (length < 8 || length > PA_WIFI_ACCESS_KEY_MAX_LEN) return false;
    for (size_t i = 0; i < length; ++i) {
        unsigned char value = (unsigned char)access_key[i];
        if (value < 0x20 || value > 0x7e) return false;
    }
    return true;
}

static bool valid_suffix(const char suffix[3])
{
    return suffix[0] != '\0' && suffix[1] != '\0' &&
           suffix[2] == '\0' &&
           strchr(suffix_alphabet, suffix[0]) != NULL &&
           strchr(suffix_alphabet, suffix[1]) != NULL;
}

static void generate_suffix(char suffix[3])
{
    const size_t alphabet_length = sizeof(suffix_alphabet) - 1;
    suffix[0] = suffix_alphabet[esp_random() % alphabet_length];
    suffix[1] = suffix_alphabet[esp_random() % alphabet_length];
    suffix[2] = '\0';
}

static esp_err_t load_wifi_settings(void)
{
    size_t prefix_length = strlen(CONFIG_PA_AP_SSID);
    if (prefix_length == 0 || prefix_length > PA_WIFI_SSID_MAX_LEN - 3 ||
        !valid_access_key(CONFIG_PA_AP_PASSWORD)) {
        ESP_LOGE(TAG,
                 "SSID prefix must be 1-28 bytes; initial access key must be "
                 "empty or 8-63 printable ASCII characters");
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t nvs;
    esp_err_t err = nvs_open("pa_system", NVS_READWRITE, &nvs);
    if (err != ESP_OK) return err;

    char suffix[3] = {0};
    size_t suffix_size = sizeof(suffix);
    err = nvs_get_str(nvs, "wifi_suffix", suffix, &suffix_size);
    if (err == ESP_ERR_NVS_NOT_FOUND || err == ESP_ERR_NVS_INVALID_LENGTH ||
        (err == ESP_OK && !valid_suffix(suffix))) {
        generate_suffix(suffix);
        err = nvs_set_str(nvs, "wifi_suffix", suffix);
        if (err == ESP_OK) err = nvs_commit(nvs);
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "Generated persistent Wi-Fi SSID suffix");
        }
    }
    if (err != ESP_OK) {
        nvs_close(nvs);
        return err;
    }

    size_t key_size = sizeof(configured_access_key);
    err = nvs_get_str(nvs, "wifi_key", configured_access_key, &key_size);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        strlcpy(configured_access_key, CONFIG_PA_AP_PASSWORD,
                sizeof(configured_access_key));
        err = ESP_OK;
    } else if (err == ESP_ERR_NVS_INVALID_LENGTH ||
               (err == ESP_OK && !valid_access_key(configured_access_key))) {
        ESP_LOGW(TAG, "Stored Wi-Fi access key is invalid; using initial setting");
        strlcpy(configured_access_key, CONFIG_PA_AP_PASSWORD,
                sizeof(configured_access_key));
        err = ESP_OK;
    }
    nvs_close(nvs);
    if (err != ESP_OK) return err;

    int written = snprintf(configured_ssid, sizeof(configured_ssid), "%s-%s",
                           CONFIG_PA_AP_SSID, suffix);
    if (written < 0 || (size_t)written >= sizeof(configured_ssid)) {
        return ESP_ERR_INVALID_SIZE;
    }
    settings_ready = true;
    return ESP_OK;
}

static void apply_security_change(void *argument)
{
    security_change_t *change = argument;
    vTaskDelay(pdMS_TO_TICKS(PA_WIFI_RECONFIGURE_DELAY_MS));

    wifi_config_t config = {0};
    esp_err_t err = esp_wifi_get_config(WIFI_IF_AP, &config);
    if (err == ESP_OK) {
        memset(config.ap.password, 0, sizeof(config.ap.password));
        strlcpy((char *)config.ap.password, change->access_key,
                sizeof(config.ap.password));
        config.ap.authmode = change->access_key[0] != '\0'
                                 ? WIFI_AUTH_WPA2_WPA3_PSK
                                 : WIFI_AUTH_OPEN;
        config.ap.pmf_cfg.required = false;
        err = esp_wifi_set_config(WIFI_IF_AP, &config);
        if (err == ESP_OK) {
            esp_err_t deauth_err = esp_wifi_deauth_sta(0);
            if (deauth_err != ESP_OK) {
                ESP_LOGW(TAG, "Could not deauthenticate existing stations: %s",
                         esp_err_to_name(deauth_err));
            }
        }
    }
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Applied Wi-Fi security change; clients must reconnect");
    } else {
        ESP_LOGE(TAG, "Could not apply Wi-Fi security change: %s",
                 esp_err_to_name(err));
    }
    memset(change, 0, sizeof(*change));
    free(change);
    vTaskDelete(NULL);
}

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
    esp_err_t err = load_wifi_settings();
    if (err != ESP_OK) return err;
    size_t password_length = strlen(configured_access_key);
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
    strlcpy((char *)config.ap.ssid, configured_ssid,
            sizeof(config.ap.ssid));
    strlcpy((char *)config.ap.password, configured_access_key,
            sizeof(config.ap.password));
    config.ap.ssid_len = (uint8_t)strlen(configured_ssid);
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
             configured_ssid, PA_GATEWAY_STRING, CONFIG_PA_AP_CHANNEL,
             CONFIG_PA_AP_MAX_CLIENTS,
             config.ap.authmode == WIFI_AUTH_OPEN ? "open" : "WPA2/WPA3");
    ESP_LOGI(TAG, "DHCP captive portal URI: %s", captive_portal_uri);
    return ESP_OK;
}

const char *wifi_ap_ssid(void)
{
    return settings_ready ? configured_ssid : CONFIG_PA_AP_SSID;
}

esp_err_t wifi_ap_get_settings(wifi_ap_settings_t *settings)
{
    if (!settings) return ESP_ERR_INVALID_ARG;
    if (!settings_ready) return ESP_ERR_INVALID_STATE;
    strlcpy(settings->ssid, configured_ssid, sizeof(settings->ssid));
    settings->secured = configured_access_key[0] != '\0';
    return ESP_OK;
}

esp_err_t wifi_ap_set_access_key(const char *access_key, bool *changed)
{
    if (!access_key || !changed || !valid_access_key(access_key)) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!settings_ready) return ESP_ERR_INVALID_STATE;
    *changed = strcmp(access_key, configured_access_key) != 0;
    if (!*changed) return ESP_OK;

    security_change_t *change = calloc(1, sizeof(*change));
    if (!change) return ESP_ERR_NO_MEM;
    strlcpy(change->access_key, access_key, sizeof(change->access_key));

    nvs_handle_t nvs;
    esp_err_t err = nvs_open("pa_system", NVS_READWRITE, &nvs);
    if (err != ESP_OK) {
        memset(change, 0, sizeof(*change));
        free(change);
        return err;
    }
    err = nvs_set_str(nvs, "wifi_key", access_key);
    if (err == ESP_OK) err = nvs_commit(nvs);
    if (err == ESP_OK) {
        strlcpy(configured_access_key, access_key,
                sizeof(configured_access_key));
    }
    nvs_close(nvs);
    if (err != ESP_OK) {
        memset(change, 0, sizeof(*change));
        free(change);
        return err;
    }

    if (xTaskCreate(apply_security_change, "wifi_security", 3072, change, 4,
                    NULL) != pdPASS) {
        memset(change, 0, sizeof(*change));
        free(change);
        return ESP_ERR_NO_MEM;
    }
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
