"""Exercise setup/unload timing without importing the full Home Assistant Core.

These tests verify that Lovelace enrollment is never awaited by async_setup_entry
and that callbacks and tasks belong to the entry's lifecycle. They are not a
substitute for testing on Home Assistant 2026.11.
"""

from __future__ import annotations

import ast
from datetime import timedelta
from pathlib import Path
import types
import unittest

MODULE = Path(__file__).resolve().parents[1] / "custom_components/p2talk_google_cast/__init__.py"
TREE = ast.parse(MODULE.read_text(encoding="utf-8"))
SETUP = next(n for n in TREE.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "async_setup_entry")
UNLOAD = next(n for n in TREE.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "async_unload_entry")


class FakeEntry:
    def __init__(self):
        self.options = {"speakers": [{"entity_id": "media_player.one"}]}
        self.listeners = []
        self.background = []

    def async_on_unload(self, callback):
        self.listeners.append(callback)

    def add_update_listener(self, callback):
        return lambda: None

    def async_create_background_task(self, hass, coroutine, name):
        self.background.append((hass, coroutine, name))

    def async_unload(self):
        for fn in self.listeners:
            fn()
        self.listeners.clear()
        for _hass, coroutine, _name in self.background:
            coroutine.close()
        self.background.clear()


class FakeBus:
    callback = None

    def async_listen_once(self, event, callback):
        self.callback = callback
        def unsubscribe():
            self.callback = None
        return unsubscribe

    async def fire_start(self):
        if self.callback is not None:
            listener = self.callback
            self.callback = None
            await listener(None)


class FakeHttp:
    def __init__(self):
        self.registered = []

    async def async_register_static_paths(self, paths):
        self.registered.extend(paths)


class FakeRuntime:
    def __init__(self, entry):
        self.entry = entry
        self.active = True

    def clear_uploads(self):
        self.active = False


class StartupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.resource_attempts = 0
        self.service_registrations = 0
        self.cleanup_runs = 0
        self.hass = types.SimpleNamespace(
            data={}, state="starting", http=FakeHttp(), bus=FakeBus(),
            config_entries=types.SimpleNamespace(async_update_entry=lambda *_args, **_kw: None),
        )
        self.entry = FakeEntry()

        async def register(_hass):
            self.resource_attempts += 1

        def register_ws(_hass):
            self.service_registrations += 1

        async def cleanup(_hass, _options):
            self.cleanup_runs += 1

        class StaticPathConfig:
            def __init__(self, url_path, path, cache_headers):
                self.url_path = url_path
                self.path = path
                self.cache_headers = cache_headers

        def track_interval(_hass, _callback, period):
            assert period == timedelta(hours=1)
            return lambda: None

        namespace = {
            "DOMAIN": "p2talk_google_cast",
            "_ASSETS_REGISTERED": "p2talk_google_cast_static_assets_registered",
            "CoreState": types.SimpleNamespace(running="running"),
            "EVENT_HOMEASSISTANT_STARTED": "homeassistant_started",
            "Runtime": FakeRuntime,
            "StaticPathConfig": StaticPathConfig,
            "HomeAssistant": object,
            "Path": Path,
            "__file__": str(MODULE),
            "timedelta": timedelta,
            "async_register_card_resource": register,
            "async_cleanup": cleanup,
            "register_commands": register_ws,
            "configured_speakers": lambda opts: opts.get("speakers", []),
            "async_track_time_interval": track_interval,
            "_async_options_updated": lambda *_: None,
            "_LOGGER": types.SimpleNamespace(info=lambda *_args: None),
        }
        exec(compile(ast.Module(body=[SETUP, UNLOAD], type_ignores=[]), str(MODULE), "exec"), namespace)
        self.setup_entry = namespace["async_setup_entry"]
        self.unload_entry = namespace["async_unload_entry"]

    async def test_startup_does_not_register_resources_or_audio_workers(self):
        self.assertTrue(await self.setup_entry(self.hass, self.entry))
        self.assertEqual(self.resource_attempts, 0)
        self.assertEqual(self.cleanup_runs, 0)
        self.assertEqual(len(self.hass.http.registered), 1)
        self.assertTrue(self.hass.http.registered[0].cache_headers)
        self.assertEqual(self.service_registrations, 1)
        self.assertEqual(self.hass.data["p2talk_google_cast_lovelace_resource_status"], {"result": "pending"})
        await self.hass.bus.fire_start()
        self.assertEqual(self.resource_attempts, 1)

    async def test_marketplace_install_while_running_enqueues_background_enrollment(self):
        self.hass.state = "running"
        await self.setup_entry(self.hass, self.entry)
        self.assertEqual(self.resource_attempts, 0)
        self.assertEqual(len(self.entry.background), 1)
        await self.entry.background.pop()[1]
        self.assertEqual(self.resource_attempts, 1)

    async def test_unload_cancels_unfired_start_callback(self):
        await self.setup_entry(self.hass, self.entry)
        runtime = self.hass.data["p2talk_google_cast"]
        self.assertTrue(await self.unload_entry(self.hass, self.entry))
        self.assertFalse(runtime.active)
        await self.hass.bus.fire_start()
        self.assertEqual(self.resource_attempts, 0)

    async def test_reload_keeps_only_one_static_asset_path(self):
        self.hass.state = "running"
        await self.setup_entry(self.hass, self.entry)
        await self.unload_entry(self.hass, self.entry)
        replacement = FakeEntry()
        await self.setup_entry(self.hass, replacement)
        self.assertEqual(len(self.hass.http.registered), 1)
        self.assertEqual(len(replacement.background), 1)
        await self.unload_entry(self.hass, replacement)


if __name__ == "__main__":
    unittest.main()
