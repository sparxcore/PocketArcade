#include "device_identity.h"

#include <stdbool.h>
#include <string.h>
#include "esp_log.h"
#include "esp_random.h"
#include "nvs.h"
#include "psa/crypto.h"

static const char *TAG = "DEVICE_ID";
static uint8_t device_secret[PA_DEVICE_SECRET_BYTES];
static mbedtls_svc_key_id_t hmac_key;
static bool ready;

static void hex_encode(const uint8_t *input, size_t len, char *output)
{
    static const char digits[] = "0123456789abcdef";
    for (size_t i = 0; i < len; ++i) {
        output[i * 2] = digits[input[i] >> 4];
        output[i * 2 + 1] = digits[input[i] & 0x0f];
    }
    output[len * 2] = '\0';
}

esp_err_t device_identity_init(void)
{
    nvs_handle_t nvs;
    esp_err_t err = nvs_open("pa_system", NVS_READWRITE, &nvs);
    if (err != ESP_OK) {
        return err;
    }

    size_t size = sizeof(device_secret);
    err = nvs_get_blob(nvs, "identity_secret", device_secret, &size);
    if (err == ESP_ERR_NVS_NOT_FOUND || size != sizeof(device_secret)) {
        esp_fill_random(device_secret, sizeof(device_secret));
        err = nvs_set_blob(nvs, "identity_secret", device_secret,
                           sizeof(device_secret));
        if (err == ESP_OK) {
            err = nvs_commit(nvs);
        }
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "Generated local device-recognition secret");
        }
    }
    nvs_close(nvs);

    if (err == ESP_OK) {
        psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
        psa_set_key_type(&attributes, PSA_KEY_TYPE_HMAC);
        psa_set_key_bits(&attributes, PA_DEVICE_SECRET_BYTES * 8);
        psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_SIGN_MESSAGE);
        psa_set_key_algorithm(&attributes, PSA_ALG_HMAC(PSA_ALG_SHA_256));

        psa_status_t status = psa_crypto_init();
        if (status == PSA_SUCCESS) {
            status = psa_import_key(&attributes, device_secret,
                                    sizeof(device_secret), &hmac_key);
        }
        psa_reset_key_attributes(&attributes);
        memset(device_secret, 0, sizeof(device_secret));
        if (status != PSA_SUCCESS) {
            ESP_LOGE(TAG, "Unable to initialise HMAC key (%ld)", (long)status);
            err = ESP_FAIL;
        }
    }

    ready = err == ESP_OK;
    return err;
}

esp_err_t device_identity_fingerprint_mac(
    const uint8_t mac[6],
    char output_hex[PA_FINGERPRINT_HEX_LEN + 1])
{
    if (!ready || !mac || !output_hex) {
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t digest[32];
    size_t digest_length = 0;
    psa_status_t status =
        psa_mac_compute(hmac_key, PSA_ALG_HMAC(PSA_ALG_SHA_256), mac, 6,
                        digest, sizeof(digest), &digest_length);
    if (status != PSA_SUCCESS || digest_length != sizeof(digest)) {
        return ESP_FAIL;
    }
    /* A 128-bit HMAC prefix is ample for a bounded, device-local lookup and
       avoids retaining full digest strings for every cached binding. */
    hex_encode(digest, PA_FINGERPRINT_BYTES, output_hex);
    memset(digest, 0, sizeof(digest));
    return ESP_OK;
}

bool device_identity_constant_time_equal(const char *a, const char *b, size_t len)
{
    if (!a || !b) {
        return false;
    }
    unsigned char difference = 0;
    for (size_t i = 0; i < len; ++i) {
        difference |= (unsigned char)a[i] ^ (unsigned char)b[i];
    }
    return difference == 0;
}
