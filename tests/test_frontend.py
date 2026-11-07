"""Lovelace card packaging and zero-dashboard-mutation invariants."""
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "p2talk_google_cast"


class LovelaceCardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = (COMPONENT / "frontend" / "cards.js").read_text(encoding="utf-8")
        cls.setup = (COMPONENT / "__init__.py").read_text(encoding="utf-8")
        cls.backend = (COMPONENT / "websocket.py").read_text(encoding="utf-8")

    def test_resources_not_panels(self):
        self.assertTrue((COMPONENT / "frontend" / "cards.js").is_file())
        self.assertFalse((COMPONENT / "frontend" / "panel.js").exists())
        self.assertNotIn("panel_custom", self.setup)
        self.assertNotIn("async_register_panel", self.setup)
        self.assertIn("async_register_card_resource", self.setup)
        self.assertIn('cache_headers=True', self.setup)
        self.assertIn('StaticPathConfig', self.setup)

    def test_automatic_resource_is_safe_and_async(self):
        registrar = (COMPONENT / "lovelace_resources.py").read_text(encoding="utf-8")
        self.assertIn('resource_mode != "storage"', registrar)
        self.assertIn('await resources.async_get_info()', registrar)
        self.assertIn('if not getattr(resources, "loaded", False)', registrar)
        self.assertIn('async_create_item', registrar)
        self.assertIn('async_update_item', registrar)
        self.assertIn('CARD_RESOURCE_PATH', registrar)
        self.assertIn('async_get_integration(hass, DOMAIN)', registrar)
        self.assertNotIn('read_text(', registrar)
        self.assertNotIn('Path(', registrar)
        self.assertIn('EVENT_HOMEASSISTANT_STARTED', self.setup)
        self.assertIn('entry.async_create_background_task', self.setup)
        self.assertNotIn('async_register_panel', self.setup)
        self.assertNotIn('frontend.add_extra_js_url', self.setup)

    def test_two_cards_and_new_ha_editor_interfaces(self):
        for token in ('p2talk-google-cast-card', 'p2talk-google-cast-compact-card',
                      'window.customCards', 'getConfigElement()', 'getStubConfig()',
                      'documentationURL',
                      'getGridOptions()', 'getCardSize()', 'setConfig(config)',
                      'this.setAttribute("data-compact", "true")',
                      'config-changed', '<ha-card class="surface">'):
            with self.subTest(token=token): self.assertIn(token, self.js)

    def test_http_is_disabled_inline_without_navigating(self):
        self.assertIn('window.location.protocol === "https:"', self.js)
        self.assertIn('data-insecure', self.js)
        self.assertIn('!this._secureMicrophoneOrigin() ||', self.js)
        self.assertIn('P2Talk không tự chuyển', self.js)
        self.assertNotIn('window.location.replace', self.js)
        self.assertNotIn('sessionStorage', self.js)
        self.assertNotIn('mic_https_panel_url', self.backend)
        self.assertNotIn('secure_url', self.backend)

    def test_isolated_and_inexpensive_lovelace_runtime(self):
        for token in ('attachShadow', 'CSSStyleSheet', 'adoptedStyleSheets',
                      '_speakerSignature()', 'if (signature !== this._speakerStateSignature)',
                      'loading="lazy"', 'document.removeEventListener',
                      'getSharedSheet()', 'function getSharedSheet()',
                      'prefers-reduced-motion', 'localStorage'):
            with self.subTest(token=token): self.assertIn(token, self.js)
        self.assertNotIn('customElements.define("p2talk-google-cast-panel"', self.js)
        self.assertNotIn('https://fonts.', self.js)

    def test_live_controls_and_recording_api(self):
        for token in ('id="speaker"', 'id="volume"', 'id="mic"',
                      'id="stop"', 'id="cancel"', 'id="micHelp"',
                      '`${DOMAIN}/speakers`', '`${DOMAIN}/upload_finish`',
                      '`${DOMAIN}/stop`', 'pointerdown', 'pointerup',
                      'pointercancel', 'aria-live'):
            with self.subTest(token=token): self.assertIn(token, self.js)

    def test_icons(self):
        for filename, dimension in (("icon.png", 256), ("icon@2x.png", 512)):
            raw = (COMPONENT / "brand" / filename).read_bytes()
            self.assertTrue(raw.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertEqual(struct.unpack(">II", raw[16:24]), (dimension, dimension))

if __name__ == "__main__": unittest.main()
