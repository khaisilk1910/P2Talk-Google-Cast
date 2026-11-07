"""Prevent config_flow import failures that surface as 'Invalid handler specified'.

This uses isolated fake Home Assistant API modules rather than syntax-only checks.
An actual Home Assistant instance remains required for end-to-end testing.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import unittest

COMPONENTS = Path(__file__).resolve().parents[1] / "custom_components"

# Run in a separate interpreter: other unit tests intentionally inject their
# own Home Assistant stubs into sys.modules.
RUNTIME_PROBE = r'''
import asyncio
import importlib
from pathlib import Path
import sys
import types

root = Path(sys.argv[1])
sys.path.insert(0, str(root))

# Load the flow independently of the backend entrypoint: the latter requires
# the whole HA runtime and is tested via integration smoke tests separately.
package = types.ModuleType("custom_components")
package.__path__ = [str(root)]
integration_package = types.ModuleType("custom_components.p2talk_google_cast")
integration_package.__path__ = [str(root / "p2talk_google_cast")]
sys.modules["custom_components"] = package
sys.modules["custom_components.p2talk_google_cast"] = integration_package

ha = types.ModuleType("homeassistant")
ha.__path__ = []
entries = types.ModuleType("homeassistant.config_entries")

class ConfigFlow:
    def __init_subclass__(cls, *, domain=None, **kwargs):
        super().__init_subclass__(**kwargs)
        cls.registered_domain = domain

    async def async_set_unique_id(self, value):
        self.unique_id = value

    def _abort_if_unique_id_configured(self):
        return None

    def async_show_form(self, **kwargs):
        return {"type": "form", **kwargs}

    def async_create_entry(self, **kwargs):
        return {"type": "create_entry", **kwargs}

class OptionsFlow:
    def async_show_menu(self, **kwargs):
        return {"type": "menu", **kwargs}

    def async_show_form(self, **kwargs):
        return {"type": "form", **kwargs}

    def async_create_entry(self, **kwargs):
        return {"type": "create_entry", **kwargs}

entries.ConfigFlow = ConfigFlow
entries.OptionsFlow = OptionsFlow
ha.config_entries = entries
sys.modules["homeassistant"] = ha
sys.modules["homeassistant.config_entries"] = entries
core = types.ModuleType("homeassistant.core")
core.callback = lambda function: function
sys.modules["homeassistant.core"] = core

helpers = types.ModuleType("homeassistant.helpers")
helpers.__path__ = []
selector = types.ModuleType("homeassistant.helpers.selector")
selector.EntitySelector = lambda config: config
selector.EntitySelectorConfig = lambda **kwargs: kwargs
helpers.selector = selector
sys.modules["homeassistant.helpers"] = helpers
sys.modules["homeassistant.helpers.selector"] = selector

vol = types.ModuleType("voluptuous")
vol.UNDEFINED = object()
vol.Schema = lambda schema: schema
vol.Required = lambda name, **kwargs: name
vol.Optional = lambda name, **kwargs: name
vol.In = lambda choices: choices
vol.All = lambda *validators: validators
vol.Coerce = lambda kind: kind
vol.Range = lambda **kwargs: kwargs
vol.Length = lambda **kwargs: kwargs
sys.modules["voluptuous"] = vol

module = importlib.import_module("custom_components.p2talk_google_cast.config_flow")
flow_class = module.P2TalkGoogleCastConfigFlow
assert flow_class.registered_domain == "p2talk_google_cast"
flow = flow_class()
form = asyncio.run(flow.async_step_user())
assert form["step_id"] == "user", form
created = asyncio.run(flow.async_step_user({"speakers": ["media_player.living_room"]}))
assert created["title"] == "P2Talk Google Cast", created
assert created["options"]["speakers"][0]["entity_id"] == "media_player.living_room"
assert flow.unique_id == "p2talk_google_cast"
options = flow_class.async_get_options_flow(None)
options.config_entry = types.SimpleNamespace(options={})
menu = asyncio.run(options.async_step_init())
assert menu["menu_options"] == ["add", "settings"]
assert "audio_bitrate" in module.options_schema({})
print("config_flow import, UI install step, and options menu: OK")
'''


class ConfigFlowLoadTests(unittest.TestCase):
    def test_config_flow_import_and_ui_install(self):
        result = subprocess.run(
            [sys.executable, "-c", RUNTIME_PROBE, str(COMPONENTS)],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("config_flow import", result.stdout)


if __name__ == "__main__":
    unittest.main()
