"""Local smoke tests for the GitHub release manifest updater."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare_release.py"
spec = importlib.util.spec_from_file_location("p2talk_prepare_release", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class ReleasePreparationTests(unittest.TestCase):
    def test_hacs_uses_tagged_source_not_release_asset(self):
        repo = SCRIPT.parents[1]
        hacs = json.loads((repo / "hacs.json").read_text(encoding="utf-8"))
        self.assertFalse(hacs["zip_release"])
        self.assertTrue(hacs["hide_default_branch"])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.manifest = Path(self.temp.name) / "manifest.json"
        self.manifest.write_text(
            json.dumps({"domain": "p2talk_google_cast", "name": "P2Talk Google Cast", "version": "1.1.0"}) + "\n",
            encoding="utf-8",
        )

    def test_newer_version_is_written(self):
        self.assertTrue(module.prepare_manifest(self.manifest, "1.2.0"))
        self.assertEqual(json.loads(self.manifest.read_text())["version"], "1.2.0")

    def test_equal_version_can_publish_initial_tag(self):
        before = self.manifest.read_bytes()
        self.assertFalse(module.prepare_manifest(self.manifest, "1.1.0"))
        self.assertEqual(self.manifest.read_bytes(), before)

    def test_downgrade_rejected(self):
        with self.assertRaisesRegex(ValueError, "downgrade"):
            module.prepare_manifest(self.manifest, "1.0.9")
        self.assertEqual(json.loads(self.manifest.read_text())["version"], "1.1.0")

    def test_versions_without_strict_x_y_z_rejected(self):
        for bad in ("v1.2.0", "1.2", "1.2.0-beta", "1.2.0+1", "01.2.0", "1.2.0/../../bad"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                module.prepare_manifest(self.manifest, bad)

    def test_wrong_domain_rejected(self):
        self.manifest.write_text('{"domain":"wrong","version":"1.1.0"}')
        with self.assertRaisesRegex(ValueError, "domain"):
            module.prepare_manifest(self.manifest, "1.2.0")


if __name__ == "__main__":
    unittest.main()
