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

            portal_match = re.search(
                r"asset_1\[\] = \{\n(.*?)\n\};", text, re.S
            )
            self.assertIsNotNone(portal_match)
            portal_values = bytes(
                int(value, 16)
                for value in re.findall(
                    r"0x([0-9a-f]{2})", portal_match[1]
                )
            )
            self.assertIn(b"Welcome to PocketArcade", portal_values)
            self.assertIn(
                '{ "/portal", "text/html; charset=utf-8", NULL, asset_1,',
                text,
            )

            css_match = re.search(r"asset_2\[\] = \{\n(.*?)\n\};", text, re.S)
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

    def test_captive_splash_is_responsive_bounded_and_browser_directed(self):
        portal = (ROOT / "web/portal.html").read_text()
        portal_css = (ROOT / "web/css/portal.css").read_text()
        embedded_routes = (ROOT / "tools/prepare_web.py").read_text()
        landscape = ROOT / "web/assets/portal-horizontal.jpg"
        portrait = ROOT / "web/assets/portal-vertical.jpg"

        self.assertIn('media="(orientation: portrait)"', portal)
        self.assertIn('href="http://192.168.4.1/"', portal)
        self.assertIn('target="_blank"', portal)
        self.assertIn(">Start</a>", portal)
        self.assertIn("Open in browser", portal)
        self.assertIn("env(safe-area-inset-top)", portal_css)
        self.assertIn("portal-horizontal.jpg", embedded_routes)
        self.assertIn("portal-vertical.jpg", embedded_routes)
        for image in (landscape, portrait):
            self.assertTrue(image.is_file())
            self.assertLess(image.stat().st_size, 200 * 1024)
            self.assertEqual(image.read_bytes()[:2], b"\xff\xd8")

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
        self.assertIn('PA_GATEWAY_STRING "/portal"', captive)
        self.assertIn('"user-portal-url', captive)
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
        self.assertEqual(manifest["manifestVersion"], 2)
        self.assertEqual(manifest["runtime"]["type"], "lua")
        self.assertTrue(
            (package / manifest["client"]["entrypoint"]).is_file()
        )
        self.assertTrue(
            (package / manifest["runtime"]["entrypoint"]).is_file()
        )
        game_script = (
            package / manifest["client"]["entrypoint"]
        ).read_text()
        self.assertNotIn("new WebSocket", game_script)
        self.assertIn("arcade.game.send", game_script)
        embedded_routes = (ROOT / "tools/prepare_web.py").read_text()
        self.assertNotIn("tic-tac-toe", embedded_routes)
        catalogue = (ROOT / "components/app_catalogue/app_catalogue.c").read_text()
        self.assertIn('PA_SD_MOUNT_POINT "/apps"', catalogue)
        self.assertIn('"/apps/*"', catalogue)
        self.assertNotIn("starter_app", catalogue)
        server_script = (
            package / manifest["runtime"]["entrypoint"]
        ).read_text()
        self.assertIn("winning_lines", server_script)
        self.assertIn('action ~= "move"', server_script)
        self.assertIn("has_won(context.board, mark)", server_script)
        self.assertFalse(
            any((ROOT / "components/tic_tac_toe").glob("*.c"))
        )
        main = (ROOT / "main/main.c").read_text()
        self.assertNotIn("tic_tac_toe", main)

    def test_lua_runtime_is_restricted_quota_enforced_and_fault_contained(self):
        runtime = (
            ROOT / "components/game_runtime/game_runtime.c"
        ).read_text()
        runtime_header = (
            ROOT / "components/game_runtime/include/game_runtime.h"
        ).read_text()
        lua_cmake = (ROOT / "components/lua/CMakeLists.txt").read_text()
        lua_header = (ROOT / "components/lua/src/lua.h").read_text()

        self.assertIn("lua_newstate(quota_allocator, runtime)", runtime)
        self.assertIn("runtime->memory_quota", runtime)
        self.assertIn("cJSON_CreateStringReference(value)", runtime)
        self.assertIn("cJSON_AddItemToObjectCS(json, key, value)", runtime)
        self.assertIn("heap_caps_get_largest_free_block(", runtime)
        self.assertIn("lua_to_json_text(", runtime)
        self.assertIn("runtime->snapshot_json", runtime)
        self.assertIn("cJSON_Raw | cJSON_IsReference", runtime)
        self.assertIn("lua_load(state, read_script_chunk", runtime)
        self.assertIn("char buffer[512]", runtime)
        self.assertNotIn("static esp_err_t read_script(", runtime)
        self.assertIn("FILE *script = NULL", runtime)
        self.assertIn('application->runtime_entrypoint, "t"', runtime)
        self.assertIn("lua_sethook(state, instruction_hook", runtime)
        self.assertIn("CONFIG_PA_GAME_LUA_INSTRUCTION_LIMIT", runtime)
        self.assertIn("CONFIG_PA_GAME_LUA_CALLBACK_TIMEOUT_MS", runtime)
        self.assertIn(
            "CONFIG_PA_GAME_LUA_CALLBACK_TIMEOUT_MS=50",
            (ROOT / "sdkconfig.defaults").read_text(),
        )
        self.assertIn("runtime_fault(runtime", runtime)
        self.assertIn("close_state(runtime)", runtime)
        self.assertIn("in_tick_callback", runtime_header)
        for blocked in (
            "dofile",
            "loadfile",
            "require",
            "collectgarbage",
            "getmetatable",
            "setmetatable",
        ):
            self.assertIn(f'"{blocked}"', runtime)

        defaults = (ROOT / "sdkconfig.defaults").read_text()
        board_defaults = (
            ROOT / "sdkconfig.board.esp32-cam-ai-thinker"
        ).read_text()
        for setting in (
            "CONFIG_ESP_WIFI_DYNAMIC_RX_BUFFER_NUM=16",
            "CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER_NUM=16",
            "CONFIG_ESP_WIFI_MGMT_SBUF_NUM=16",
            "CONFIG_PA_HTTP_MAX_OPEN_SOCKETS=7",
            "CONFIG_PA_WS_MAX_CONNECTIONS=8",
            "CONFIG_PA_WS_OUTBOUND_QUEUE_LENGTH=4",
            "CONFIG_PA_GAME_MAX_SNAPSHOT_RATE_HZ=10",
        ):
            self.assertIn(setting, defaults)
            self.assertIn(setting, board_defaults)
        for setting in (
            "CONFIG_SPIRAM=y",
            "CONFIG_SPIRAM_IGNORE_NOTFOUND=y",
            "CONFIG_SPIRAM_USE_CAPS_ALLOC=y",
        ):
            self.assertIn(setting, board_defaults)
        for excluded_source in (
            "src/liolib.c",
            "src/loslib.c",
            "src/loadlib.c",
            "src/ldblib.c",
            "src/linit.c",
        ):
            self.assertNotIn(excluded_source, lua_cmake)
        self.assertIn("LUAI_MAXCCALLS=64", lua_cmake)
        self.assertIn('#define LUA_VERSION_MAJOR\t"5"', lua_header)
        self.assertIn('#define LUA_VERSION_MINOR\t"4"', lua_header)
        self.assertIn('#define LUA_VERSION_RELEASE\t"8"', lua_header)

    def test_lua_capabilities_are_scoped_and_worker_only(self):
        runtime = (
            ROOT / "components/game_runtime/game_runtime.c"
        ).read_text()
        platform = (
            ROOT / "components/game_platform/game_platform.c"
        ).read_text()
        for namespace in (
            '"match"',
            '"transport"',
            '"clock"',
            '"random"',
            '"storage"',
            '"log"',
        ):
            self.assertIn(namespace, runtime)
        self.assertIn("APP_CAP_MATCH_SEATS", runtime)
        self.assertIn("APP_CAP_MATCH_RESULTS", runtime)
        self.assertIn("APP_CAP_STORAGE_APP_DATA", runtime)
        self.assertIn('"%s/data/apps/%s/%s.json"', runtime)
        self.assertIn("storage_enqueue_atomic_write", runtime)
        self.assertIn(
            "storage.write is not allowed during on_tick", runtime
        )
        join_body = platform[
            platform.index("game_platform_result_t game_platform_join"):
            platform.index("game_platform_result_t game_platform_leave")
        ]
        request_body = platform[
            platform.index(
                "game_platform_result_t game_platform_request_snapshot"
            ):
            platform.index("game_platform_result_t game_platform_command")
        ]
        self.assertNotIn("game_runtime_", join_body)
        self.assertNotIn("game_runtime_", request_body)
        self.assertIn("acquire_work(WORK_SNAPSHOT)", request_body)
        worker_body = platform[
            platform.index("static void process_work"):
            platform.index("static void expire_disconnected_players")
        ]
        for call in (
            "game_runtime_load",
            "game_runtime_player_event",
            "game_runtime_command",
            "game_runtime_snapshot",
            "game_runtime_unload",
        ):
            self.assertIn(call, worker_body)

    def test_game_work_queue_uses_a_bounded_pool_not_task_stacks(self):
        platform = (
            ROOT / "components/game_platform/game_platform.c"
        ).read_text()
        self.assertIn("game_work_slot_t", platform)
        self.assertIn(
            "CONFIG_PA_GAME_COMMAND_QUEUE_LENGTH", platform
        )
        self.assertIn("acquire_work", platform)
        self.assertIn("release_work", platform)
        self.assertIn("sizeof(game_work_t *)", platform)
        producer_and_worker_code = platform[
            platform.index("static void expire_disconnected_players"):
        ]
        self.assertNotIn("game_work_t work =", producer_and_worker_code)
        self.assertNotIn("game_work_t work;", producer_and_worker_code)
        self.assertNotIn("game_work_t expired[", producer_and_worker_code)

    def test_generic_game_dispatcher_never_executes_rules_in_websocket(self):
        websocket = (
            ROOT / "components/websocket/websocket.c"
        ).read_text()
        platform = (
            ROOT / "components/game_platform/game_platform.c"
        ).read_text()
        protocol = (
            ROOT / "components/protocol/include/pa_protocol.h"
        ).read_text()
        for message_type in (
            "game.join",
            "game.leave",
            "game.ready",
            "game.command",
            "game.control.claim",
            "game.snapshot.request",
            "game.match",
            "game.snapshot",
            "game.event",
            "game.result",
            "game.error",
        ):
            self.assertIn(f'"{message_type}"', protocol)
        self.assertNotIn("tic_tac_toe_move", websocket)
        self.assertNotIn("tic_tac_toe_join", websocket)
        self.assertIn("xQueueCreate", platform)
        self.assertIn("xQueueSend", platform)
        self.assertIn("game_worker", platform)

    def test_game_seats_and_browser_facade_are_identity_scoped(self):
        platform = (
            ROOT / "components/game_platform/game_platform.c"
        ).read_text()
        client = (
            ROOT / "web/js/pocket-arcade.js"
        ).read_text()
        shell = (ROOT / "web/js/app.js").read_text()
        profiles = (
            ROOT / "components/profiles/profiles.c"
        ).read_text()
        self.assertIn("public_profile_t profile", platform)
        self.assertIn("controller_id", platform)
        self.assertIn("last_input_sequence", platform)
        self.assertIn("last_processed_sequence", platform)
        self.assertIn("GAME_PLATFORM_STALE_INPUT", platform)
        self.assertIn("CONFIG_PA_GAME_COMMAND_QUEUE_LENGTH", platform)
        self.assertIn(
            'cJSON_AddStringToObject(json, "avatarUrl", '
            "profile->avatar_url)",
            platform,
        )
        self.assertIn('cJSON_AddNullToObject(json, "avatarUrl")', platform)
        self.assertIn("match->spectators[i].profile = *profile", platform)
        self.assertIn("send_match_to_members(changed_id)", platform)
        self.assertIn("createAppFacade", client)
        self.assertIn("Object.freeze", client)
        self.assertIn("sanitizeGameProfile(profile)", client)
        self.assertIn("sanitizeGameMatch(payload)", client)
        self.assertIn("avatarUrl: typeof profile.avatarUrl", client)
        self.assertIn("this.gameMatches.set(payload.matchId, payload)", client)
        self.assertIn('"/api/v1/avatars/%s.jpg"', profiles)
        self.assertIn("arcade.createAppFacade(", shell)
        self.assertIn("app.id, appDisplayCapability(session)", shell)

    def test_phase3_realtime_scheduler_transport_and_pocketblocks_package(self):
        platform = (
            ROOT / "components/game_platform/game_platform.c"
        ).read_text()
        websocket = (
            ROOT / "components/websocket/websocket.c"
        ).read_text()
        protocol = (
            ROOT / "components/protocol/include/pa_protocol.h"
        ).read_text()
        client = (
            ROOT / "web/js/pocket-arcade.js"
        ).read_text()
        kconfig = (
            ROOT / "components/board_config/Kconfig"
        ).read_text()
        guide = (
            ROOT / "docs/game-development-guide.md"
        ).read_text()

        self.assertIn("configure_schedule_locked", platform)
        self.assertIn("run_due_ticks", platform)
        self.assertIn("xQueueReceive(work_queue, &work, 1)", platform)
        self.assertNotIn("pdMS_TO_TICKS(5)", platform)
        self.assertIn("game_runtime_tick(runtime, tick_delta_ms)", platform)
        self.assertIn("dropped_ticks", platform)
        self.assertIn("tick_overruns", platform)
        self.assertIn("CONFIG_PA_GAME_MAX_SNAPSHOT_RATE_HZ", platform)
        self.assertIn("last_snapshot_broadcast_ms", platform)
        self.assertIn("flush_pending_snapshot", platform)
        self.assertIn("PA_GAME_BINARY_HEADER_BYTES", platform)
        self.assertIn("cJSON_IsRaw(payload)", platform)
        self.assertIn("cJSON_CreateRaw(match->snapshot_json)", platform)
        self.assertIn("PA_GAME_BINARY_FLAG_FULL_SNAPSHOT", platform)
        self.assertIn("put_u64_be(frame + 12, revision)", platform)
        self.assertIn("acknowledged_input_sequence", platform)

        self.assertIn("PA_GAME_BINARY_HEADER_BYTES 36", protocol)
        self.assertIn("outbound_message_t critical[", websocket)
        self.assertIn("snapshot_pending", websocket)
        self.assertIn("coalescible_snapshot", websocket)
        self.assertIn("CONFIG_PA_WS_OUTBOUND_QUEUE_LENGTH", websocket)
        self.assertIn("CONFIG_PA_WS_SLOW_CLIENT_STRIKES", websocket)
        self.assertIn("httpd_sess_trigger_close", websocket)
        self.assertIn("config PA_WS_OUTBOUND_QUEUE_LENGTH", kconfig)
        self.assertIn("config PA_WS_SLOW_CLIENT_STRIKES", kconfig)

        self.assertIn('socket.binaryType = "arraybuffer"', client)
        self.assertIn("handleBinaryMessage(buffer)", client)
        self.assertIn("new DataView(buffer)", client)
        self.assertIn("new TextDecoder()", client)
        self.assertIn('type: "game.snapshot"', client)
        self.assertIn("| Snapshot rate | Capped at 10 Hz |", guide)
        self.assertIn('state == "closed"', guide)
        self.assertIn("match_not_found", guide)
        self.assertIn("allocator prefers optional PSRAM", guide)
        self.assertIn("wall-clock fault-containment deadline", guide)
        self.assertIn(
            "Every occupied `seats[].player` and every entry in "
            "`spectators[]`",
            guide,
        )
        self.assertIn("### Realtime hot-path design", guide)
        self.assertIn(
            "do not move an expensive snapshot builder into `on_tick`",
            guide,
        )
        self.assertIn("precompute static geometry", guide)
        self.assertIn("### Diagnosing runtime stops", guide)
        self.assertIn(
            "the reported Lua line is\nwhere the periodic hook noticed",
            guide,
        )

        package = ROOT / "sdcard-example/apps/pocketblocks"
        manifest = json.loads((package / "manifest.json").read_text())
        self.assertEqual(manifest["manifestVersion"], 2)
        self.assertEqual(manifest["minPlatformVersion"], "0.3.0")
        self.assertEqual(manifest["runtime"]["type"], "lua")
        self.assertEqual(manifest["runtime"]["mode"], "tick")
        self.assertLessEqual(manifest["runtime"]["tickRateHz"], 30)
        server = (
            package / manifest["runtime"]["entrypoint"]
        ).read_text()
        browser = (
            package / manifest["client"]["entrypoint"]
        ).read_text()
        self.assertIn("on_tick = function(context, delta_ms)", server)
        self.assertIn("match.finish(", server)
        self.assertIn("transport.broadcast_snapshot(snapshot(context))", server)
        self.assertNotIn("storage.write(", server)
        self.assertIn("arcade.game.send", browser)
        self.assertIn("arcade.game.onSnapshot", browser)
        self.assertNotIn("new WebSocket", browser)

    def test_pocketblocks_bounds_state_and_handles_match_transitions(self):
        package = ROOT / "sdcard-example/apps/pocketblocks"
        manifest = json.loads((package / "manifest.json").read_text())
        browser = (package / "client/app.js").read_text()
        server = (package / "server/main.lua").read_text()

        self.assertRegex(manifest["version"], r"^\d+\.\d+\.\d+$")
        self.assertIn('nextMatch.you && nextMatch.you.role', browser)
        self.assertIn('role === "none"', browser)
        self.assertIn(
            "nextSnapshot.matchId !== matchState.matchId", browser
        )
        self.assertIn("result.matchId !== matchState.matchId", browser)
        command_interval = re.search(
            r"COMMAND_INTERVAL_MS\s*=\s*(\d+)", browser
        )
        self.assertIsNotNone(command_interval)
        self.assertGreaterEqual(int(command_interval.group(1)), 50)
        pending_actions = re.search(
            r"MAX_PENDING_ACTIONS\s*=\s*(\d+)", browser
        )
        self.assertIsNotNone(pending_actions)
        self.assertGreaterEqual(int(pending_actions.group(1)), 1)
        self.assertLessEqual(int(pending_actions.group(1)), 4)
        self.assertIn("MAX_RETIRED_MATCHES = 8", browser)
        self.assertIn("clearInputState()", browser)
        self.assertIn("previousMatchId", browser)
        self.assertEqual(browser.count("arcade.game.requestSnapshot"), 2)
        self.assertNotIn("window.setInterval", browser)

        self.assertIn("local function reset_to_waiting(context)", server)
        self.assertIn(
            'context.phase == "countdown" and match.state() == "waiting"',
            server,
        )
        self.assertIn(
            "context.players[player_info.profileId] = nil", server
        )
        self.assertIn("local function prune_sequence(context)", server)
        self.assertIn("context.sequenceBase", server)
        self.assertIn("context.players = round_players", server)
        self.assertIn("local NIBBLE_DIVISORS", server)
        self.assertIn('local EMPTY_ROW = "0000000000"', server)
        self.assertIn("local function board_get", server)
        self.assertIn(
            'table.concat(player.board, "", HIDDEN_H + 1, BOARD_H)',
            server,
        )
        self.assertNotIn("local BOARD_WORD_COUNT", server)
        self.assertNotIn("local function cell_index", server)
        self.assertNotIn("{{0,1}", server)

    def test_finished_and_empty_matches_release_the_active_slot(self):
        platform = (
            ROOT / "components/game_platform/game_platform.c"
        ).read_text()
        websocket = (
            ROOT / "components/websocket/websocket.c"
        ).read_text()

        self.assertIn(
            "(match->result_recorded || runtime->faulted)", platform
        )
        self.assertIn("empty_after_leave", platform)
        self.assertIn("player_count_locked(match) == 0", platform)
        self.assertIn(
            "An empty waiting match must release its runtime", platform
        )
        self.assertIn("Rejected %s for app", websocket)

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

    def test_games_can_explicitly_control_shell_fullscreen(self):
        html = (ROOT / "web/index.html").read_text()
        app = (ROOT / "web/js/app.js").read_text()
        client = (ROOT / "web/js/pocket-arcade.js").read_text()
        css = (ROOT / "web/css/app.css").read_text()
        guide = (ROOT / "docs/game-development-guide.md").read_text()

        self.assertIn('id="exit-app-fullscreen"', html)
        self.assertIn("appDisplayCapability(session)", app)
        self.assertIn("session !== activeAppSession", app)
        self.assertIn('event.key !== "Escape"', app)
        self.assertIn("requestFullscreen:", client)
        self.assertIn("exitFullscreen:", client)
        self.assertIn("onFullscreenChange:", client)
        self.assertIn("body.app-fullscreen #active-app-panel", css)
        self.assertIn("arcade.display.requestFullscreen()", guide)
        self.assertIn("arcade.display.exitFullscreen()", guide)

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
        self.assertIn("httpd_resp_send_chunk(", embedded)
        self.assertIn("const size_t chunk_size = 1024", embedded)
        websocket = (
            ROOT / "components/websocket/websocket.c"
        ).read_text()
        self.assertIn("static int websocket_send_all", websocket)
        self.assertIn("httpd_sess_set_send_override", websocket)
        api = (ROOT / "components/http_api/http_api.c").read_text()
        self.assertIn("config.send_wait_timeout = 1", api)
        self.assertIn('"Connection", "close"', embedded)
        self.assertIn("clearGameConnectionState()", client)

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

    def test_profile_win_field_persists_and_has_roundels(self):
        profiles = (ROOT / "components/profiles/profiles.c").read_text()
        platform = (
            ROOT / "components/game_platform/game_platform.c"
        ).read_text()
        tic_tac_toe = (
            ROOT / "sdcard-example/apps/tic-tac-toe/server/main.lua"
        ).read_text()
        tic_tac_toe_client = (
            ROOT / "sdcard-example/apps/tic-tac-toe/client/app.js"
        ).read_text()
        html = (ROOT / "web/index.html").read_text()
        app = (ROOT / "web/js/app.js").read_text()
        css = (ROOT / "web/css/app.css").read_text()
        self.assertIn('cJSON_AddNumberToObject(json, "wins"', profiles)
        self.assertIn("profile_record_game_win", profiles)
        self.assertIn("validate_result_locked", platform)
        self.assertIn("profile_record_game_win", platform)
        self.assertIn('"resultId"', platform)
        self.assertIn("match.finish({", tic_tac_toe)
        self.assertLess(
            tic_tac_toe.index("transport.broadcast_snapshot"),
            tic_tac_toe.index("match.finish({"),
        )
        self.assertIn(
            'arcade.game.join("tic-tac-toe")', tic_tac_toe_client
        )
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
