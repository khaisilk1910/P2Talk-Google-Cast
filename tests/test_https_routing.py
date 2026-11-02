"""Regression tests for selecting the HTTPS Home Assistant panel origin."""

from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "p2talk_google_cast"

try:
    import voluptuous as vol
except ImportError:
    # The portable test runner does not install Home Assistant dependencies.
    vol = types.ModuleType("voluptuous")
    vol.Invalid = type("Invalid", (ValueError,), {})
    sys.modules["voluptuous"] = vol

if "p2talk_google_cast" not in sys.modules:
    pkg = types.ModuleType("p2talk_google_cast")
    pkg.__path__ = [str(COMPONENT)]
    sys.modules["p2talk_google_cast"] = pkg

from p2talk_google_cast.secure_url import (  # noqa: E402
    secure_origin, optional_secure_origin, microphone_https_panel_url,
)


class HttpsRouteTests(unittest.TestCase):
    def _hass(self, internal=None, external=None):
        return types.SimpleNamespace(config=types.SimpleNamespace(
            internal_url=internal, external_url=external,
        ))

    def test_reuses_external_https_when_internal_is_http(self):
        url = microphone_https_panel_url(self._hass(
            "http://192.168.1.100:8123", "https://ha.example.com"
        ), {})
        self.assertEqual(url, "https://ha.example.com/p2talk_google_cast")

    def test_user_supplied_https_takes_priority(self):
        self.assertEqual(microphone_https_panel_url(
            self._hass(external="https://cloud.example.com"),
            {"mic_https_url": "https://ha.home.example:8443/"}),
            "https://ha.home.example:8443/p2talk_google_cast")

    def test_internal_https_takes_priority_over_external_when_unset(self):
        self.assertEqual(microphone_https_panel_url(
            self._hass(internal="https://lan.example.com", external="https://cloud.example.com"),
            {}), "https://lan.example.com/p2talk_google_cast")

    def test_no_https_no_link(self):
        self.assertIsNone(microphone_https_panel_url(
            self._hass(internal="http://192.168.1.100:8123"), {}))

    def test_invalid_url_never_built_into_redirect(self):
        for origin in (
            "http://ha.example.com", "https://user:pass@ha.example.com",
            "https://ha.example.com/other", "https://ha.example.com?q=1",
            "https://ha.example.com#hash", "https://ha.example.com:bad",
            "https://ha.example.com\\@attacker.example", "https://foo bar",
            "javascript:alert(1)", "https://ha.example.com@evil.example",
            "https://ha.example.com\n.evil.example",
        ):
            with self.subTest(origin=origin), self.assertRaises(vol.Invalid):
                secure_origin(origin)

    def test_https_origin_normalized_and_optional_empty(self):
        self.assertEqual(optional_secure_origin(""), "")
        self.assertEqual(secure_origin("https://HA.Example.COM/"), "https://ha.example.com")


if __name__ == "__main__":
    unittest.main()
