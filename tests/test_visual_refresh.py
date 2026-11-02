"""Speaker identity and UX safe visual invariants."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1] / "custom_components/p2talk_google_cast/frontend"
class VisualRefreshTests(unittest.TestCase):
    def test_2026_speaker_asset_and_header(self):
        js = (ROOT / "panel.js").read_text()
        img = ROOT / "home-speaker-2026.webp"
        self.assertTrue(img.exists())
        self.assertLess(img.stat().st_size, 60_000)
        self.assertIn('class="mark-speaker"', js)
        self.assertIn('class="mark-cast"', js)
        self.assertNotIn('<div class="symbol">${mark}</div>', js)
    def test_live_controls_and_aurora_rendering(self):
        js = (ROOT / "panel.js").read_text()
        for needle in ('id="cancel"', 'id="stop"', 'class="action cancel-action"',
                       'class="action stop-action"', '.panel-body', '.hero-glow',
                       'prefers-reduced-motion', 'stage.recording', 'stage.sending',
                       'id="speaker"', 'id="mic"', 'hass.callWS'):
            self.assertIn(needle, js)

if __name__ == '__main__': unittest.main()
