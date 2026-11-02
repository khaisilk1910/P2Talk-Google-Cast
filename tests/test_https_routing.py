"""Home Assistant configured HTTPS URLs only, without integration overrides."""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / 'custom_components' / 'p2talk_google_cast'
if 'p2talk_google_cast' not in sys.modules:
    pkg = types.ModuleType('p2talk_google_cast')
    pkg.__path__ = [str(COMPONENT)]
    sys.modules['p2talk_google_cast'] = pkg

from p2talk_google_cast.secure_url import (  # noqa: E402
    configured_https_panel, microphone_https_panel_url, secure_origin,
)


class HttpsRouteTests(unittest.TestCase):
    def _hass(self, internal=None, external=None):
        return types.SimpleNamespace(config=types.SimpleNamespace(
            internal_url=internal, external_url=external,
        ))

    def test_external_https_preferred_even_when_internal_is_https(self):
        hass = self._hass('https://lan.example.net', 'https://ha.example.com')
        self.assertEqual(configured_https_panel(hass),
                         ('https://ha.example.com/p2talk_google_cast', 'external'))

    def test_https_external_when_internal_is_http(self):
        hass = self._hass('http://192.168.1.100:8123', 'https://ha.example.com')
        self.assertEqual(microphone_https_panel_url(hass),
                         'https://ha.example.com/p2talk_google_cast')

    def test_https_internal_fallback(self):
        hass = self._hass('https://ha.home.example:8443/', None)
        self.assertEqual(configured_https_panel(hass),
                         ('https://ha.home.example:8443/p2talk_google_cast', 'internal'))

    def test_missing_ha_urls_is_explicit(self):
        self.assertEqual(configured_https_panel(self._hass()), (None, 'missing'))
        self.assertEqual(configured_https_panel(self._hass('http://192.168.1.100:8123')),
                         (None, 'missing'))

    def test_disallow_non_https_even_if_another_url_is_set(self):
        hass = self._hass('http://lan.example.com', 'http://ha.example.com')
        self.assertEqual(configured_https_panel(hass), (None, 'missing'))

    def test_invalid_url_never_built_into_redirect(self):
        for url in (
            'http://ha.example.com', 'https://user:pass@ha.example.com',
            'https://ha.example.com/other', 'https://ha.example.com?q=1',
            'https://ha.example.com#hash', 'https://ha.example.com:bad',
            'https://ha.example.com\\@attacker.example', 'https://foo bar',
            'javascript:alert(1)', 'https://ha.example.com@evil.example',
            'https://ha.example.com\n.evil.example',
        ):
            with self.subTest(url=url):
                self.assertIsNone(secure_origin(url))

    def test_normalization(self):
        self.assertEqual(secure_origin('https://HA.Example.COM/'),
                         'https://ha.example.com')

    def test_config_flow_no_mic_https_option(self):
        src = (COMPONENT / 'config_flow.py').read_text(encoding='utf-8')
        self.assertNotIn('CONF_MIC_HTTPS_URL', src)
        self.assertNotIn('optional_secure_origin', src)
        for lang in ('strings.json', 'translations/en.json', 'translations/vi.json'):
            self.assertNotIn('mic_https_url', (COMPONENT / lang).read_text(encoding='utf-8'))

    def test_ws_resolves_ha_settings_dynamically(self):
        src = (COMPONENT / 'websocket.py').read_text(encoding='utf-8')
        self.assertIn('configured_https_panel(hass)', src)
        self.assertIn('"mic_https_state": https_source', src)
        self.assertNotIn('runtime.entry.options)',
                         src[src.index('https_panel_url, https_source = '):src.index('https_panel_url, https_source = ')+100])


if __name__ == '__main__':
    unittest.main()
