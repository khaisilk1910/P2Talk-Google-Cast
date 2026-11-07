"""Optional Chromium visual/functional smoke test; no HA instance required."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from threading import Thread
import ssl
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'custom_components/p2talk_google_cast/frontend/cards.js').read_text(encoding='utf-8')
SPEAKERS = [
    {'entity_id': 'media_player.living', 'friendly_name': 'Loa phòng khách', 'state':'playing',
     'is_available':True,'configured_volume':.65,'supports_stop':True},
    {'entity_id': 'media_player.bedroom', 'friendly_name': 'Loa phòng ngủ', 'state':'paused',
     'is_available':True,'configured_volume':.5,'supports_stop':True},
]
SETUP = '''(speakers) => {
  window.__wsCalls = [];
  window.__speakers = speakers;
  window.__hass = {
    themes:{darkMode:false},
    states:Object.fromEntries(speakers.map(s => [s.entity_id,{state:s.state,attributes:{supported_features:4609}}])),
    callWS:async (msg) => {
      window.__wsCalls.push(msg);
      if (msg.type.endsWith('/speakers')) return {max_seconds:120,max_bytes:8388608,speakers:window.__speakers};
      if (msg.type.endsWith('/stop')) return {speakers:msg.speakers, failed_speakers:[],paused_speakers:[]};
      throw new Error('Unexpected WebSocket type: ' + msg.type);
    }
  };
  for (const type of ['p2talk-google-cast-card','p2talk-google-cast-compact-card']) {
    const card = document.createElement(type);
    card.setConfig({name:type.includes('compact') ? 'Micro nhanh' : 'P2Talk Google Cast'});
    document.querySelector('#cards').append(card);
    card.hass = window.__hass;
  }
}'''
HTML = '''<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#e9eef5;color:#17243a;font:14px system-ui}
#cards{display:grid;grid-template-columns:minmax(0,640px) minmax(0,390px);align-items:start;gap:20px}
ha-card{display:block}
@media(max-width:820px){#cards{display:block}#cards>*{margin-bottom:16px}}
</style></head><body><main id="cards"></main></body></html>'''

# Browser networking is not required. Secure-origin behavior is separately
# verified by tests/test_microphone.cjs; this preview exercises DOM rendering.
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for protocol in ('https', 'http'):
        page = browser.new_page(viewport={'width':1280,'height':900}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(HTML)
        page.add_script_tag(content=SOURCE)
        assert page.evaluate('sharedSheet === undefined'), 'Stylesheet must not be parsed before a P2Talk card is mounted'
        if protocol == 'https':
            page.evaluate('P2TalkGoogleCastCard.prototype._secureMicrophoneOrigin = () => true')
        page.evaluate(SETUP, SPEAKERS)
        page.wait_for_function('document.querySelector("p2talk-google-cast-card")?._loaded && document.querySelector("p2talk-google-cast-compact-card")?._loaded')
        result = page.evaluate('''() => {
          const full=document.querySelector('p2talk-google-cast-card');
          const small=document.querySelector('p2talk-google-cast-compact-card');
          return {
            fullStop:!!full.shadowRoot.getElementById('stop'),
            compactStop:!!small.shadowRoot.getElementById('stop'),
            fullMicDisabled:full.shadowRoot.getElementById('mic').disabled,
            compactMicDisabled:small.shadowRoot.getElementById('mic').disabled,
            fullNotice:getComputedStyle(full.shadowRoot.getElementById('httpsNotice')).display,
            compactNotice:getComputedStyle(small.shadowRoot.getElementById('httpsNotice')).display,
            resourceCount:window.__wsCalls.filter(x=>x.type.endsWith('/speakers')).length,
            customCards:window.customCards.map(x=>x.type),
            width:small.getBoundingClientRect().width,
          };
        }''')
        assert not errors, errors
        assert result['fullStop'] and not result['compactStop'], result
        assert result['resourceCount'] == 2, result
        assert result['fullMicDisabled'] == (protocol == 'http'), result
        assert result['compactMicDisabled'] == (protocol == 'http'), result
        assert (result['fullNotice'] != 'none') == (protocol == 'http'), result
        assert (result['compactNotice'] != 'none') == (protocol == 'http'), result
        assert len(result['customCards']) == 2, result
        assert page.evaluate('sharedSheet instanceof CSSStyleSheet'), 'Mounted cards should reuse shared styles'
        # Live state updates must refresh a renamed speaker without reloading cards.
        live_name = page.evaluate('''() => {
          const card = document.querySelector('p2talk-google-cast-compact-card');
          const hass = window.__hass;
          const states = {...hass.states, 'media_player.living': {
            ...hass.states['media_player.living'],
            attributes: {...hass.states['media_player.living'].attributes,
              friendly_name:'Loa mới trong nhà'},
          }};
          card.hass = {...hass, states};
          return card.shadowRoot.querySelector('.speaker-option-name')?.textContent;
        }''')
        assert live_name == 'Loa mới trong nhà', live_name
        # Both options must be discoverable through Lovelace's card picker,
        # and each must provide a working no-YAML visual editor.
        editors = page.evaluate('''async () => {
          const types=['p2talk-google-cast-card','p2talk-google-cast-compact-card'];
          const output=[];
          for (const type of types) {
            const C = customElements.get(type);
            const editor = C.getConfigElement();
            editor.setConfig({});
            document.body.append(editor);
            editor.hass = window.__hass;
            await new Promise(resolve => setTimeout(resolve, 20));
            const choices = editor.shadowRoot.querySelectorAll('input[type=checkbox]');
            const name = editor.shadowRoot.querySelector('#name');
            let changed = null;
            editor.addEventListener('config-changed', e => changed = e.detail.config);
            name.value = 'Loa trong nhà';
            name.dispatchEvent(new Event('change', {bubbles:true}));
            const named = changed?.name === 'Loa trong nhà';
            choices[0].checked = true;
            choices[0].dispatchEvent(new Event('change', {bubbles:true}));
            output.push({type, visible:!!name, speakers:choices.length,
                         named, selected:changed?.speakers?.includes('media_player.living')});
            editor.remove();
          }
          return output;
        }''')
        assert len(editors) == 2 and all(e['visible'] and e['speakers'] == 2 and e['named'] and e['selected'] for e in editors), editors
        if protocol == 'https':
            page.locator('p2talk-google-cast-card').evaluate('(el) => el.shadowRoot.getElementById("stop").click()')
            page.wait_for_function('window.__wsCalls.some(x=>x.type.endsWith("/stop"))')
            page.wait_for_function('document.querySelector("p2talk-google-cast-card").shadowRoot.getElementById("statusText").textContent.includes("Đã gửi lệnh dừng")')
        # Dashboard editor/Sections views may detach and remount an existing card.
        # Verify no stale recorder state survives and available speakers return.
        remount = page.evaluate('''async () => {
          const card=document.querySelector('p2talk-google-cast-compact-card');
          const oldCount=window.__wsCalls.filter(x=>x.type.endsWith('/speakers')).length;
          card._recording=true;
          card.remove();
          document.querySelector('#cards').append(card);
          for (let i=0;i<30 && !card._loaded;i++) await new Promise(r=>setTimeout(r,10));
          return {
            loaded:card._loaded,
            recording:card._recording,
            count:window.__wsCalls.filter(x=>x.type.endsWith('/speakers')).length-oldCount,
            hasSpeaker:card.shadowRoot.querySelectorAll('.speaker-option').length,
          };
        }''')
        assert remount == {'loaded':True,'recording':False,'count':1,'hasSpeaker':2}, remount
        page.screenshot(path=str(Path(tempfile.gettempdir()) / f'p2talk_preview_{protocol}.png'), full_page=True)
        print(f'PASS simulated {protocol.upper()} cards rendered; state={result}; JS errors={len(errors)}')
        page.close()
    browser.close()
