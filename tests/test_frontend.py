"""Lightweight UI/brand packaging invariants (works without browser dependencies)."""
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / 'custom_components' / 'p2talk_google_cast'


class FrontendAssetsTests(unittest.TestCase):
    def test_icons_have_correct_square_dimensions(self):
        for filename, dimension in (('icon.png', 256), ('icon@2x.png', 512)):
            content = (COMPONENT / 'brand' / filename).read_bytes()
            self.assertTrue(content.startswith(b'\x89PNG\r\n\x1a\n'))
            self.assertEqual(struct.unpack('>II', content[16:24]), (dimension, dimension))

    def test_accessibility_and_theme_support(self):
        source = (COMPONENT / 'frontend' / 'panel.js').read_text()
        for text in ('--primary-color', '--card-background-color',
                     '--primary-text-color', 'prefers-reduced-motion',
                     'pointerdown', 'pointerup', 'pointercancel',
                     'aria-live', 'focus-visible', 'localStorage'):
            with self.subTest(needle=text):
                self.assertIn(text, source)
        self.assertIn('background:transparent', source)
        self.assertNotIn('https://fonts.', source)
        self.assertNotIn('http://', source)

    def test_speaker_selection_is_still_configured_from_backend(self):
        source = (COMPONENT / 'frontend' / 'panel.js').read_text()
        self.assertIn('`${DOMAIN}/speakers`', source)
        self.assertIn('`${DOMAIN}/upload_finish`', source)
        self.assertIn('`${DOMAIN}/stop`', source)
        self.assertIn('/config/integrations/integration/p2talk_google_cast', source)

    def test_panel_asset_cache_is_busted_on_update(self):
        source = (COMPONENT / '__init__.py').read_text()
        self.assertIn('stat().st_mtime_ns', source)
        self.assertIn('module_url=f"/{DOMAIN}_assets/panel.js?v={panel_asset_version}"', source)


if __name__ == '__main__':
    unittest.main()
