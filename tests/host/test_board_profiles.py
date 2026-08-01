import importlib.util
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def load_profile_tool():
    spec = importlib.util.spec_from_file_location(
        "board_profiles", ROOT / "tools" / "board_profiles.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BoardProfileTests(unittest.TestCase):
    def setUp(self):
        self.tool = load_profile_tool()
        self.catalogue = self.tool.load_catalogue()
        self.profiles = self.tool.validate_catalogue(self.catalogue)

    def test_release_profiles_require_sd_and_psram(self):
        self.assertEqual(
            set(self.profiles),
            {
                "esp32-cam-ai-thinker",
                "lilygo-ttgo-t8-classic",
                "ai-thinker-esp32-a1s-audio-kit-v2-2",
            },
        )
        for profile in self.profiles.values():
            config = self.tool.config_text(profile)
            self.assertIn("CONFIG_SPIRAM=y", config)
            self.assertNotIn("CONFIG_SPIRAM_IGNORE_NOTFOUND=y", config)
            self.assertEqual(
                sum(
                    value in config
                    for value in (
                        "CONFIG_PA_SD_SDMMC=y",
                        "CONFIG_PA_SD_SDSPI=y",
                    )
                ),
                1,
            )

    def test_only_verified_profiles_are_publishable(self):
        published = [
            profile
            for profile in self.profiles.values()
            if profile["publish"]
        ]
        self.assertEqual(
            [profile["id"] for profile in published],
            ["esp32-cam-ai-thinker"],
        )
        self.assertTrue(
            all(profile["status"] == "verified" for profile in published)
        )

    def test_existing_verified_build_generates_web_tools_manifest(self):
        profile = self.profiles["esp32-cam-ai-thinker"]
        build_directory = ROOT / profile["buildDirectory"]
        if not (build_directory / "flasher_args.json").exists():
            self.skipTest("verified firmware has not been built")

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            packaged = self.tool.package_profile(
                profile, output, self.tool.project_version()
            )
            manifest = json.loads(
                (
                    output
                    / "firmware"
                    / profile["id"]
                    / "manifest.json"
                ).read_text()
            )
            self.assertEqual(packaged["status"], "verified")
            self.assertEqual(
                manifest["builds"][0]["chipFamily"], "ESP32"
            )
            self.assertEqual(
                {
                    part["offset"]
                    for part in manifest["builds"][0]["parts"]
                },
                {0x1000, 0x8000, 0x10000},
            )

    def test_pages_package_can_offer_every_board_and_includes_branding(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)

            def fake_package(profile, destination, version):
                return {
                    "id": profile["id"],
                    "name": profile["name"],
                    "status": profile["status"],
                    "manifest": f"firmware/{profile['id']}/manifest.json",
                }

            with mock.patch.object(
                self.tool, "package_profile", side_effect=fake_package
            ):
                self.tool.package_installer(
                    self.profiles,
                    output,
                    self.tool.project_version(),
                    include_provisional=True,
                )

            boards = json.loads((output / "boards.json").read_text())
            self.assertEqual(
                {board["id"] for board in boards["boards"]},
                set(self.profiles),
            )
            self.assertEqual(
                (output / "assets" / "logo-horizontal.webp").read_bytes(),
                self.tool.BRAND_ASSET.read_bytes(),
            )
            page = (output / "index.html").read_text()
            self.assertIn('src="assets/logo-horizontal.webp"', page)
            self.assertIn('class="hero-beta"', page)
            installer_script = (output / "app.js").read_text()
            self.assertIn(
                'definition("microSD", "Required")', installer_script
            )

    def test_pages_workflow_publishes_provisional_board_choices(self):
        workflow = (
            ROOT / ".github" / "workflows" / "firmware-pages.yml"
        ).read_text()
        self.assertGreaterEqual(workflow.count("--include-provisional"), 2)


if __name__ == "__main__":
    unittest.main()
