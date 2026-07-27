#include "captive_portal.h"

#include <errno.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/inet.h"
#include "pa_board.h"

static const char *TAG = "CAPTIVE";

static void dns_task(void *argument)
{
    (void)argument;
    uint8_t request[512];
    uint8_t response[544];
    for (;;) {
        int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (fd < 0) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        int reuse = 1;
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
        struct sockaddr_in address = {
            .sin_family = AF_INET,
            .sin_port = htons(53),
            .sin_addr.s_addr = htonl(INADDR_ANY),
        };
        if (bind(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
            close(fd);
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        ESP_LOGI(TAG, "Wildcard captive DNS listening on UDP 53");
        for (;;) {
            struct sockaddr_storage peer;
            socklen_t peer_length = sizeof(peer);
            int length = recvfrom(fd, request, sizeof(request), 0,
                                  (struct sockaddr *)&peer, &peer_length);
            if (length < 12 || length > (int)sizeof(request)) continue;
            size_t cursor = 12;
            while (cursor < (size_t)length && request[cursor] != 0) {
                size_t label = request[cursor];
                if (label > 63 || cursor + label + 1 >= (size_t)length) {
                    cursor = (size_t)length;
                    break;
                }
                cursor += label + 1;
            }
            if (cursor + 5 > (size_t)length) continue;
            size_t question_end = cursor + 5;
            if (question_end + 16 > sizeof(response)) continue;
            memcpy(response, request, question_end);
            response[2] = 0x84;
            response[3] = 0x00;
            response[4] = 0x00;
            response[5] = 0x01;
            response[6] = 0x00;
            response[7] = 0x01;
            response[8] = response[9] = response[10] = response[11] = 0;
            uint8_t answer[] = {
                0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x04,
                192, 168, 4, 1
            };
            memcpy(response + question_end, answer, sizeof(answer));
            sendto(fd, response, question_end + sizeof(answer), 0,
                   (struct sockaddr *)&peer, peer_length);
        }
    }
}

static esp_err_t captive_redirect(httpd_req_t *request)
{
    httpd_resp_set_status(request, "302 Found");
    httpd_resp_set_hdr(request, "Location",
                       "http://" PA_GATEWAY_STRING "/portal");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    httpd_resp_set_type(request, "text/html; charset=utf-8");
    ESP_LOGI(TAG, "Redirecting captive check %s", request->uri);
    return httpd_resp_send(
        request,
        "<!doctype html><meta charset=utf-8><title>PocketArcade</title>"
        "<p>Opening PocketArcade… "
        "<a href=\"http://" PA_GATEWAY_STRING
        "/portal\">Continue</a></p>",
        HTTPD_RESP_USE_STRLEN);
}

static esp_err_t captive_api(httpd_req_t *request)
{
    static const char response[] =
        "{\"captive\":true,"
        "\"user-portal-url\":\"http://" PA_GATEWAY_STRING "/portal\"}";
    httpd_resp_set_type(request, "application/captive+json");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    ESP_LOGI(TAG, "Serving captive-portal API");
    return httpd_resp_send(request, response, sizeof(response) - 1);
}

esp_err_t captive_portal_start(void)
{
    if (xTaskCreate(dns_task, "pa_dns", 3072, NULL, 3, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "DNS name %s.local resolves while clients use AP DNS",
             CONFIG_PA_HOSTNAME);
    return ESP_OK;
}

esp_err_t captive_portal_register_http(httpd_handle_t server)
{
    httpd_uri_t api = {
        .uri = "/captive-portal",
        .method = HTTP_GET,
        .handler = captive_api,
    };
    esp_err_t api_error = httpd_register_uri_handler(server, &api);
    if (api_error != ESP_OK) return api_error;

    static const char *routes[] = {
        "/generate_204",
        "/gen_204",
        "/hotspot-detect.html",
        "/library/test/success.html",
        "/connecttest.txt",
        "/ncsi.txt",
        "/fwlink",
        "/canonical.html",
        "/success.txt",
        "/success.html",
        "/redirect",
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); ++i) {
        httpd_uri_t uri = {
            .uri = routes[i],
            .method = HTTP_GET,
            .handler = captive_redirect,
        };
        esp_err_t err = httpd_register_uri_handler(server, &uri);
        if (err != ESP_OK) return err;
    }
    return ESP_OK;
}
