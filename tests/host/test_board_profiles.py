import importlib.util
import json
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
