"""Optional Chromium smoke test, using navigation mock (no Home Assistant server required)."""
from pathlib import Path
from playwright.sync_api import sync_playwright

SOURCE = (Path(__file__).resolve().parents[1] / 'custom_components/p2talk_google_cast/frontend/panel.js').read_text('utf-8')
TARGET = 'https://ha.example.com/p2talk_google_cast'
HTML = '<html><meta charset="utf-8"><body></body></html>'

def seed(page, target, secure=False):
    page.set_content(HTML)
    page.add_script_tag(content=SOURCE)
    page.evaluate('''(secure) => {
      Object.defineProperty(window, 'isSecureContext', {value: secure, configurable: true});
      const prototype = P2TalkGoogleCastPanel.prototype;
      // Prevent real navigation in the simulated HA origin; unit tests cover
      // safe HTTPS URL validation and window.location.replace independently.
      prototype._openSecurePanel = function () {
        if (window.isSecureContext || this._redirecting || !this._micHttpsUrl) return false;
        this._redirectCapture = this._micHttpsUrl;
        this._redirecting = true;
        return true;
      };
    }''', secure)
    page.evaluate('''(url) => {
      const el = document.createElement('p2talk-google-cast-panel');
      document.body.append(el);
      el.hass = {states:{'media_player.living_room':{state:'idle', attributes:{}}},
        callWS: async message => {
          if(message.type.endsWith('/speakers')) return {mic_https_url:url,
            mic_https_state: url ? 'external' : 'missing',max_seconds:120,
            speakers:[{entity_id:'media_player.living_room',friendly_name:'Loa phòng khách',state:'idle',is_available:true,configured_volume:0.65}]};
          return {};
        }};
    }''', target)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page()
    seed(page, TARGET)
    page.wait_for_function("document.querySelector('p2talk-google-cast-panel')?._redirectCapture === 'https://ha.example.com/p2talk_google_cast'")
    assert page.evaluate("document.querySelector('p2talk-google-cast-panel')._redirecting")
    print('PASS insecure P2Talk: automatic HTTPS target selected without touching microphone')
    page.close()

    page = browser.new_page()
    seed(page, TARGET, secure=True)
    page.wait_for_function("document.querySelector('p2talk-google-cast-panel')?.shadowRoot.querySelector('#statusText')?.textContent.includes('Sẵn sàng')")
    assert page.evaluate("!document.querySelector('p2talk-google-cast-panel')._redirectCapture")
    print('PASS secure P2Talk: no navigation, controls ready')
    page.close()

    page = browser.new_page()
    seed(page, None)
    page.wait_for_function("document.querySelector('p2talk-google-cast-panel')?.shadowRoot.querySelector('#statusText')?.textContent.includes('chưa cấu hình')")
    note = page.evaluate("document.querySelector('p2talk-google-cast-panel').shadowRoot.querySelector('#statusNote').textContent")
    assert 'Settings → System → Network' in note, note
    assert page.evaluate("!document.querySelector('p2talk-google-cast-panel')._redirectCapture")
    print('PASS insecure P2Talk without HA HTTPS: explicit setup guidance')
    page.close()
    browser.close()
