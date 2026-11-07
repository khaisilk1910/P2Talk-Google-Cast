"""Visual layout and assets retained for Full, independent Compact markup."""
from pathlib import Path
import unittest

FRONTEND = Path(__file__).resolve().parents[1] / 'custom_components/p2talk_google_cast/frontend'

class VisualTests(unittest.TestCase):
    def test_full_artwork_and_controls(self):
        js = (FRONTEND / 'cards.js').read_text()
        self.assertLess((FRONTEND / 'home-speaker-2026.webp').stat().st_size, 60_000)
        for token in ('class="mark-speaker"', 'class="mark-cast"',
                      'class="action cancel-action"', 'class="action stop-action"',
                      '.panel-body', 'class="hero-glow"', 'waveMarkup()',
                      'stage.recording', 'stage.sending'):
            self.assertIn(token, js)
    def test_compact_contains_only_three_primary_controls(self):
        js = (FRONTEND / 'cards.js').read_text()
        small = js.split('(this._compact ? `', 1)[1].split('` : `', 1)[0]
        for token in ('id="speaker"', 'id="volume"', 'id="mic"', 'https-notice'):
            self.assertIn(token, small)
        for excluded in ('id="stop"', 'id="cancel"', 'hero-speaker', 'waveMarkup()'):
            self.assertNotIn(excluded, small)

if __name__ == '__main__': unittest.main()
