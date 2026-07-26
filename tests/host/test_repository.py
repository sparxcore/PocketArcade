import gzip
import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RepositoryTests(unittest.TestCase):
    def test_web_asset_generation_is_deterministic_and_portal_compatible(self):
        spec = importlib.util.spec_from_file_location(
            "prepare_web", ROOT / "tools" / "prepare_web.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.c"
            second = Path(directory) / "second.c"
            module.generate(ROOT / "web", first)
            module.generate(ROOT / "web", second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            text = first.read_text()
            match = re.search(r"asset_0\[\] = \{\n(.*?)\n\};", text, re.S)
            self.assertIsNotNone(match)
            values = bytes(
                int(value, 16) for value in re.findall(r"0x([0-9a-f]{2})", match[1])
            )
            self.assertIn(b"PocketArcade", values)
            self.assertIn(
                '{ "/", "text/html; charset=utf-8", NULL, asset_0,',
                text,
            )

            css_match = re.search(r"asset_1\[\] = \{\n(.*?)\n\};", text, re.S)
            self.assertIsNotNone(css_match)
            css_values = bytes(
                int(value, 16)
                for value in re.findall(r"0x([0-9a-f]{2})", css_match[1])
            )
            self.assertIn(b":root", gzip.decompress(css_values))
            self.assertIn(
                '{ "/system/app.css", "text/css; charset=utf-8", "gzip",',
                text,
            )
        cmake = (
            ROOT / "components/embedded_web/CMakeLists.txt"
        ).read_text()
        self.assertIn("add_custom_command", cmake)
        self.assertIn("WEB_ASSET_SOURCES", cmake)
        self.assertIn("DEPENDS", cmake)

    def test_open_ap_and_dhcp_captive_portal_are_defaults(self):
        kconfig = (ROOT / "components/board_config/Kconfig").read_text()
        password_block = re.search(
            r"config PA_AP_PASSWORD\n(.*?)(?=\nconfig )", kconfig, re.S
        )
        self.assertIsNotNone(password_block)
        self.assertIn('default ""', password_block.group(1))
        wifi_source = (ROOT / "components/wifi_ap/wifi_ap.c").read_text()
        self.assertIn("ESP_NETIF_CAPTIVEPORTAL_URI", wifi_source)
        self.assertIn("/captive-portal", wifi_source)
        captive = (
            ROOT / "components/captive_portal/captive_portal.c"
        ).read_text()
        self.assertIn("application/captive+json", captive)
        self.assertIn('"captive\\":true', captive)
        self.assertIn("WIFI_AUTH_OPEN", wifi_source)

    def test_storage_first_use_provisioning_is_enabled(self):
        kconfig = (ROOT / "components/board_config/Kconfig").read_text()
        self.assertIn("config PA_SD_FORMAT_IF_UNMOUNTABLE", kconfig)
        self.assertRegex(
            kconfig,
            r"(?s)config PA_SD_FORMAT_IF_UNMOUNTABLE.*?default y",
        )
        storage = (ROOT / "components/storage/storage.c").read_text()
        self.assertIn("#if CONFIG_PA_SD_FORMAT_IF_UNMOUNTABLE", storage)
        self.assertIn(".format_if_mount_failed = true", storage)
        for relative in (
            "/apps",
            "/data/profiles",
            "/data/avatars",
            "/data/chat",
            "/data/apps",
            "/logs",
        ):
            self.assertIn(f'PA_SD_MOUNT_POINT "{relative}"', storage)

    def test_relative_storage_paths_accept_their_string_terminator(self):
        storage = (ROOT / "components/storage/storage.c").read_text()
        self.assertIn(
            "(*p != '\\0' && (unsigned char)*p < 0x20)",
            storage,
        )

    def test_frontend_never_uses_inner_html(self):
        scripts = "\n".join(
            path.read_text(encoding="utf-8") for path in (ROOT / "web/js").glob("*.js")
        )
        self.assertNotIn("innerHTML", scripts)
        self.assertIn("textContent", scripts)

    def test_browser_sends_no_mac_or_fingerprint_identity(self):
        client = (ROOT / "web/js/pocket-arcade.js").read_text(encoding="utf-8")
        self.assertNotRegex(client, r"\b(deviceFingerprint|stationMac|clientMac)\b")
        self.assertIn("/api/v1/profile/device-restore", client)

    def test_internal_namespaces_are_guarded(self):
        source = (ROOT / "components/embedded_web/embedded_web.c").read_text()
        for prefix in ("/api/", "/apps/", "/system/", "/assets/system/"):
            self.assertIn(prefix, source)

    def test_chat_is_bounded_and_uses_shared_websocket(self):
        chat_header = (ROOT / "components/chat/include/chat.h").read_text()
        chat_source = (ROOT / "components/chat/chat.c").read_text()
        protocol = (ROOT / "components/protocol/include/pa_protocol.h").read_text()
        client = (ROOT / "web/js/pocket-arcade.js").read_text()
        self.assertIn("#define PA_CHAT_MAX_MESSAGES 50", chat_header)
        self.assertIn("data/chat/recent.json", chat_source)
        self.assertIn("storage_enqueue_atomic_write", chat_source)
        self.assertIn('"chat.send"', protocol)
        self.assertIn('this.send("chat.send"', client)

    def test_tic_tac_toe_is_an_independent_sd_application(self):
        package = ROOT / "sdcard-example/apps/tic-tac-toe"
        manifest = json.loads((package / "manifest.json").read_text())
        self.assertEqual(manifest["id"], "tic-tac-toe")
        self.assertEqual(manifest["entrypoint"], "app.js")
        self.assertTrue((package / manifest["entrypoint"]).is_file())
        game_script = (package / "app.js").read_text()
        self.assertNotIn("new WebSocket", game_script)
        self.assertIn("playTicTacToe", game_script)
        embedded_routes = (ROOT / "tools/prepare_web.py").read_text()
        self.assertNotIn("tic-tac-toe", embedded_routes)
        catalogue = (ROOT / "components/app_catalogue/app_catalogue.c").read_text()
        self.assertIn('PA_SD_MOUNT_POINT "/apps"', catalogue)
        self.assertIn('"/apps/*"', catalogue)
        self.assertNotIn("starter_app", catalogue)

    def test_safe_sd_eject_is_queued_and_exposed_in_ui(self):
        storage = (ROOT / "components/storage/storage.c").read_text()
        api = (ROOT / "components/http_api/http_api.c").read_text()
        client = (ROOT / "web/js/pocket-arcade.js").read_text()
        html = (ROOT / "web/index.html").read_text()
        self.assertIn("OP_EJECT", storage)
        self.assertIn("Reject new writes immediately", storage)
        self.assertIn("/api/v1/storage/eject", api)
        self.assertIn("/api/v1/storage/mount", api)
        self.assertIn("waitForStorage", client)
        self.assertIn("safeToRemove", client)
        self.assertIn('id="storage-action"', html)

    def test_esp_idf_6_websocket_frames_are_not_mistaken_for_upgrade(self):
        source = (ROOT / "components/websocket/websocket.c").read_text()
        handler = source[
            source.index("static esp_err_t websocket_handler"):
            source.index("esp_err_t websocket_register")
        ]
        self.assertNotIn("request->method == HTTP_GET", handler)
        self.assertIn("reserve_fd_locked(fd)", handler)
        self.assertIn("ESP-IDF 6", handler)

    def test_account_pill_and_chat_ui_are_present(self):
        html = (ROOT / "web/index.html").read_text()
        app = (ROOT / "web/js/app.js").read_text()
        self.assertIn('id="account-pill"', html)
        self.assertIn('id="chat-messages"', html)
        self.assertIn('id="chat-form"', html)
        self.assertIn("Welcome back ${profile.nickname}", app)

    def test_profile_photo_is_processed_and_stored_as_a_bounded_jpeg(self):
        html = (ROOT / "web/index.html").read_text()
        app = (ROOT / "web/js/app.js").read_text()
        client = (ROOT / "web/js/pocket-arcade.js").read_text()
        api = (ROOT / "components/http_api/http_api.c").read_text()
        self.assertIn('id="photo-button"', html)
        self.assertIn('capture="user"', html)
        self.assertIn("canvas.width = 96", app)
        self.assertIn('"image/jpeg"', app)
        self.assertIn("/api/v1/profile/avatar", client)
        self.assertIn("CONFIG_PA_AVATAR_MAX_BYTES", api)
        self.assertIn("mbedtls_base64_decode", api)
        self.assertIn("data/avatars/%s.jpg", api)
        embedded = (
            ROOT / "components/embedded_web/embedded_web.c"
        ).read_text()
        self.assertIn("img-src 'self' data: blob:", embedded)

    def test_first_session_login_admin_controls_are_server_enforced(self):
        profiles = (ROOT / "components/profiles/profiles.c").read_text()
        profile_header = (
            ROOT / "components/profiles/include/profiles.h"
        ).read_text()
        api = (ROOT / "components/http_api/http_api.c").read_text()
        html = (ROOT / "web/index.html").read_text()
        app = (ROOT / "web/js/app.js").read_text()
        self.assertIn("bool admin;", profile_header)
        self.assertIn("session_admin_id", profiles)
        self.assertIn("assign_session_admin_locked", profiles)
        self.assertIn(
            'cJSON_DeleteItemFromObjectCaseSensitive(json, "role")',
            profiles,
        )
        self.assertIn('profile->admin ? "admin" : "player"', profiles)
        self.assertIn("profile_token_is_admin", api)
        self.assertIn('"admin_required"', api)
        self.assertIn('id="admin-button"', html)
        self.assertIn('id="admin-dialog"', html)
        self.assertIn('profile.role === "admin"', app)

    def test_game_wins_persist_and_have_roundels(self):
        profiles = (ROOT / "components/profiles/profiles.c").read_text()
        game = (
            ROOT / "components/tic_tac_toe/tic_tac_toe.c"
        ).read_text()
        html = (ROOT / "web/index.html").read_text()
        app = (ROOT / "web/js/app.js").read_text()
        css = (ROOT / "web/css/app.css").read_text()
        self.assertIn('cJSON_AddNumberToObject(json, "wins"', profiles)
        self.assertIn("profile_record_game_win", profiles)
        self.assertIn('"tic-tac-toe", &updated', game)
        self.assertIn('id="account-wins"', html)
        self.assertIn("renderWinRoundel", app)
        self.assertIn('.win-roundel[data-tier="5"]', css)

    def test_all_documentation_deliverables_exist(self):
        required = [
            "README.md",
            "docs/architecture.md",
            "docs/http-api.md",
            "docs/websocket-protocol.md",
            "docs/profiles-and-identity.md",
            "docs/storage-and-hardware.md",
            "docs/troubleshooting.md",
            "docs/acceptance-test.md",
        ]
        for relative in required:
            self.assertTrue((ROOT / relative).is_file(), relative)


if __name__ == "__main__":
    unittest.main()
