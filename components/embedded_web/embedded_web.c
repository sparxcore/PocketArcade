#include "embedded_web.h"

#include <string.h>
#include "esp_log.h"

static const char *TAG = "HTTP";

typedef struct {
    const char *path;
    const char *mime;
    const char *encoding;
    const unsigned char *data;
    size_t length;
} pa_web_asset_t;

extern const pa_web_asset_t *pa_web_asset_find(const char *path);

static esp_err_t serve_asset(httpd_req_t *request)
{
    const pa_web_asset_t *asset = pa_web_asset_find(request->uri);
    if (!asset && strcmp(request->uri, "/") != 0) {
        if (strncmp(request->uri, "/api/", 5) == 0 ||
            strncmp(request->uri, "/apps/", 6) == 0 ||
            strncmp(request->uri, "/system/", 8) == 0 ||
            strncmp(request->uri, "/assets/system/", 15) == 0) {
            httpd_resp_set_status(request, "404 Not Found");
            httpd_resp_set_type(request, "text/plain; charset=utf-8");
            return httpd_resp_sendstr(request, "Not found");
        }
        asset = pa_web_asset_find("/");
    }
    if (!asset) {
        return httpd_resp_send_404(request);
    }
    httpd_resp_set_type(request, asset->mime);
    if (asset->encoding) {
        httpd_resp_set_hdr(request, "Content-Encoding", asset->encoding);
        httpd_resp_set_hdr(request, "Vary", "Accept-Encoding");
    }
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    httpd_resp_set_hdr(request, "Connection", "close");
    httpd_resp_set_hdr(request, "Content-Security-Policy",
                       "default-src 'self'; connect-src 'self' ws:; "
                       "img-src 'self' data: blob:; style-src 'self'; "
                       "script-src 'self'; object-src 'none'; base-uri 'none'");
    /*
     * Core assets change with firmware and captive-portal WebViews are
     * particularly aggressive caches. Revalidate every load so a newly
     * flashed UI cannot keep an older client protocol implementation.
     */
    httpd_resp_set_hdr(request, "Cache-Control", "no-cache");
    ESP_LOGI(TAG, "Serving %s (%u bytes%s)", request->uri,
             (unsigned)asset->length,
             asset->encoding ? ", gzip" : "");
    /*
     * Keep each socket write below the TCP window. This lets the lobby remain
     * loadable while an authoritative runtime is active without allocating or
     * attempting one multi-kilobyte send for the navigation document.
     */
    const size_t chunk_size = 1024;
    for (size_t offset = 0; offset < asset->length; offset += chunk_size) {
        size_t remaining = asset->length - offset;
        size_t length = remaining < chunk_size ? remaining : chunk_size;
        esp_err_t result = httpd_resp_send_chunk(
            request, (const char *)asset->data + offset, length);
        if (result != ESP_OK) return result;
    }
    return httpd_resp_send_chunk(request, NULL, 0);
}

esp_err_t embedded_web_register(httpd_handle_t server)
{
    static const char *uris[] = {
        "/", "/index.html", "/system/*", "/assets/system/*", "/*"
    };
    for (size_t i = 0; i < sizeof(uris) / sizeof(uris[0]); ++i) {
        httpd_uri_t route = {
            .uri = uris[i],
            .method = HTTP_GET,
            .handler = serve_asset,
        };
        esp_err_t err = httpd_register_uri_handler(server, &route);
        if (err != ESP_OK) return err;
    }
    ESP_LOGI(TAG, "Embedded gzip web interface registered");
    return ESP_OK;
}
