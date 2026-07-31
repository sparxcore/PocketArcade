import gzip
import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
APP_DIR = (
    ROOT
    / "components"
    / "builtin_apps"
    / "apps"
    / "tic-tac-toe"
)


def load_module():
    spec = importlib.util.spec_from_file_location(
        "prepare_builtin_apps", ROOT / "tools" / "prepare_builtin_apps.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BuiltinAppTests(unittest.TestCase):
    def test_tic_tac_toe_bundle_contains_only_runtime_assets(self):
        module = load_module()
        app_id, entries = module.load_app(APP_DIR)
        files = {path: (mime, encoding, data) for path, mime, encoding, data in entries}

        self.assertEqual(app_id, "tic-tac-toe")
        self.assertEqual(
            set(files),
            {
                "assets/icon.svg",
                "assets/start-screen.jpg",
                "client/app.css",
                "client/app.js",
                "manifest.json",
                "server/main.lua",
            },
        )
        self.assertEqual(files["client/app.js"][1], "gzip")
        self.assertEqual(
            gzip.decompress(files["client/app.js"][2]),
            (APP_DIR / "client/app.js").read_bytes(),
        )
        self.assertIsNone(files["server/main.lua"][1])
        self.assertEqual(
            files["server/main.lua"][2],
            (APP_DIR / "server/main.lua").read_bytes(),
        )
        self.assertLess(sum(len(entry[3]) for entry in entries), 180 * 1024)

    def test_generation_is_deterministic(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.c"
            second = Path(directory) / "second.c"
            module.generate([APP_DIR], first)
            module.generate([APP_DIR], second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            generated = first.read_text(encoding="utf-8")
            self.assertIn('"tic-tac-toe", "client/app.js"', generated)
            self.assertIn('"tic-tac-toe", "server/main.lua"', generated)
            self.assertNotIn("assets.zip", generated)


if __name__ == "__main__":
    unittest.main()
