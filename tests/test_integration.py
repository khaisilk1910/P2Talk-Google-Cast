"""Portable smoke tests; no running Home Assistant instance required."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import types
import unittest
import wave

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "p2talk_google_cast"

# Import the standalone audio helpers without downloading all Home Assistant
# dependencies. Full integration testing must run against a real HA Core.
ha = types.ModuleType("homeassistant")
ha.__path__ = []
ha_core = types.ModuleType("homeassistant.core")
ha_core.HomeAssistant = type("HomeAssistant", (), {})
sys.modules.setdefault("homeassistant", ha)
sys.modules.setdefault("homeassistant.core", ha_core)
pkg = types.ModuleType("p2talk_google_cast")
pkg.__path__ = [str(COMPONENT)]
sys.modules.setdefault("p2talk_google_cast", pkg)
from p2talk_google_cast import audio  # noqa: E402


class FakeHass:
    def __init__(self, path):
        self.config = types.SimpleNamespace(media_dirs={"local": str(path)})

    async def async_add_executor_job(self, func, *args):
        return await asyncio.to_thread(func, *args)


def make_wav() -> bytes:
    with io.BytesIO() as buffer:
        with wave.open(buffer, "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(16000)
            file.writeframes(struct.pack("<" + "h" * 4000, *([0] * 4000)))
        return buffer.getvalue()


class IntegrationStructureTests(unittest.TestCase):
    def test_hacs_structure_and_metadata(self):
        manifest = json.loads((COMPONENT / "manifest.json").read_text())
        hacs = json.loads((ROOT / "hacs.json").read_text())
        self.assertEqual(manifest["domain"], COMPONENT.name)
        self.assertEqual(manifest["name"], hacs["name"])
        self.assertTrue(manifest["config_flow"])
        self.assertTrue(manifest["single_config_entry"])
        for key in ("version", "documentation", "issue_tracker", "codeowners"):
            self.assertIn(key, manifest)
        self.assertTrue((COMPONENT / "frontend" / "panel.js").is_file())
        self.assertTrue((ROOT / "README.md").is_file())
        self.assertTrue((ROOT / ".gitignore").is_file())
        self.assertTrue((ROOT / "LICENSE").is_file())
        self.assertFalse((ROOT / "Dockerfile").exists())

    def test_all_translations_are_valid_json(self):
        for path in (COMPONENT / "strings.json", *COMPONENT.glob("translations/*.json")):
            with self.subTest(path=path.name):
                data = json.loads(path.read_text())
                self.assertEqual(data["title"], "P2Talk Google Cast")


class AudioTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="p2talk-unit-")
        self.hass = FakeHass(self.temp.name)

    async def asyncTearDown(self):
        self.temp.cleanup()

    async def test_reject_unknown_browser_container(self):
        with self.assertRaises(audio.AudioError):
            await audio.async_convert(self.hass, b"bad", {}, "application/x-danger")

    async def test_cleanup_only_our_expired_mp3(self):
        media = Path(self.temp.name) / "p2talk_google_cast"
        media.mkdir()
        old = media / "old.mp3"
        recent = media / "new.mp3"
        other = media / "do-not-delete.txt"
        for path in (old, recent, other):
            path.write_bytes(b"test")
        old_time = (datetime.now(timezone.utc) - timedelta(hours=6)).timestamp()
        old.touch()
        import os
        os.utime(old, (old_time, old_time))
        await audio.async_cleanup(self.hass, {"retention_hours": 2})
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(other.exists())

    async def test_ffmpeg_missing_shows_clear_error(self):
        with self.assertRaisesRegex(audio.AudioError, "FFmpeg"):
            await audio.async_convert(
                self.hass, make_wav(), {"ffmpeg_path": "/no/such/ffmpeg"}, "audio/wav"
            )
        self.assertEqual(list((Path(self.temp.name) / "p2talk_google_cast").glob("*.mp3")), [])

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    async def test_real_webm_opus_to_mp3(self):
        # Browser MediaRecorder commonly produces WebM/Opus.
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
            "-t", "0.3", "-c:a", "libopus", "-b:a", "24k",
            "-f", "webm", "pipe:1",
        ]
        result = subprocess.run(command, capture_output=True, check=True)
        media_id = await audio.async_convert(self.hass, result.stdout, {}, "audio/webm")
        output = Path(self.temp.name) / "p2talk_google_cast" / media_id.rsplit("/", 1)[-1]
        self.assertGreater(output.stat().st_size, 100)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    async def test_real_wav_to_mp3(self):
        media_id = await audio.async_convert(self.hass, make_wav(), {}, "audio/wav")
        self.assertTrue(media_id.startswith("media-source://media_source/local/p2talk_google_cast/"))
        media_file = Path(self.temp.name) / "p2talk_google_cast" / media_id.rsplit("/", 1)[-1]
        self.assertGreater(media_file.stat().st_size, 100)
        self.assertEqual(media_file.suffix, ".mp3")


if __name__ == "__main__":
    unittest.main()
