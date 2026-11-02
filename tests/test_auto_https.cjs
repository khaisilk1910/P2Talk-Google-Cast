// Guard against regressions: HTTP panel must redirect before the first press,
// while keeping the existing single Home Assistant WebSocket request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'custom_components/p2talk_google_cast/frontend/panel.js'), 'utf8');

async function scenario(secure, configured) {
  const navigated = [];
  const env = {
    window: {
      isSecureContext: secure,
      location: {protocol: secure ? 'https:' : 'http:', replace: url => navigated.push(url)},
      MediaRecorder: class {},
    },
    navigator: {mediaDevices: {getUserMedia() {}}},
    HTMLElement: class {},
    customElements: {get() {}, define() {}},
    localStorage: {getItem() {return null;}},
    URL, console,
    document: {createElement: tag => ({tag, value: '', textContent: ''})},
  };
  env.window.self = env.window;
  env.window.top = env.window;
  vm.createContext(env);
  vm.runInContext(src, env);
  const Panel = vm.runInContext('P2TalkGoogleCastPanel', env);
  const el = Object.create(Panel.prototype);
  let wsCalls = 0;
  let controlsTouched = 0;
  let status = '';
  el._hass = {callWS: async msg => {
    wsCalls++;
    assert.equal(msg.type, 'p2talk_google_cast/speakers');
    return {mic_https_url: configured ? 'https://ha.example.com/p2talk_google_cast' : null,
      mic_https_state: configured ? 'external' : 'missing',
      max_seconds: 120, speakers: [{entity_id: 'media_player.test', friendly_name: 'Test', is_available: true, configured_volume: 0.65}]};
  }, states: {'media_player.test': {state: 'idle'}}};
  el.isConnected = true;
  el._loaded = false;
  el._loadingSpeakers = false;
  el._redirecting = false;
  el._maxBytes = 1024;
  el._configuredSpeakers = [];
  el._recording = false;
  el._sending = false;
  el._status = s => {status = s;};
  el._refreshControls = () => {controlsTouched++;};
  // HTTP target must navigate BEFORE any attempt to manipulate speaker DOM.
  if (!secure && configured) el.$ = () => {throw new Error('panel rendered speaker controls before redirect');};
  else {
    const select = {
      value: '',
      replaceChildren() {this.value = '';},
      append() {},
    };
    const elements = {
      speaker: select,
      micHttps: {hidden: true},
      volume: {value: '65', style: {setProperty() {}}},
      volumeText: {textContent: ''},
      speakerMeta: {className: ''}, speakerState: {textContent: ''},
      inlineState: {className: ''}, inlineStateText: {textContent: ''},
    };
    el.$ = id => {if (!(id in elements)) throw new Error('Unknown mock element: ' + id); return elements[id];};
    el._syncSpeakerState = () => {};
  }
  await el._loadSpeakers();
  return {navigated, wsCalls, controlsTouched, status, redirecting: el._redirecting, loaded: el._loaded};
}

(async () => {
  let outcome = await scenario(false, true);
  assert.deepEqual(outcome.navigated, ['https://ha.example.com/p2talk_google_cast']);
  assert.equal(outcome.wsCalls, 1, 'must reuse the existing speaker command');
  assert.equal(outcome.redirecting, true);
  assert.equal(outcome.loaded, false, 'no need to render speaker controls on insecure page');

  outcome = await scenario(true, true);
  assert.equal(outcome.navigated.length, 0, 'already HTTPS; no reload');
  assert.equal(outcome.wsCalls, 1);
  assert.equal(outcome.loaded, true);

  outcome = await scenario(false, false);
  assert.equal(outcome.navigated.length, 0, 'missing HTTPS URL must not guess');
  assert.match(outcome.status, /chưa cấu hình/i);
  assert.equal(outcome.wsCalls, 1);
  console.log('PASS automatic redirect only on P2Talk HTTP, no HTTPS reload, explicit missing URL, one WS call');
})().catch(err => { console.error(err); process.exitCode=1; });
