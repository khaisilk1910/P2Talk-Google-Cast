// Browser API diagnostics are pure and must not require a Home Assistant server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'custom_components', 'p2talk_google_cast', 'frontend', 'panel.js'), 'utf8');
const context = {
  navigator: { mediaDevices: undefined },
  window: { isSecureContext: false, MediaRecorder: undefined, location: { protocol: 'http:' } },
  HTMLElement: class {},
  customElements: { get: () => undefined, define: () => {} },
  console, URL,
};
context.window.self = context.window;
context.window.top = context.window;
vm.createContext(context);
vm.runInContext(source, context);
const run = js => vm.runInContext(js, context);

assert.equal(run('microphoneAdvice(null).code'), 'insecure_context');
assert.equal(run('safeHttpsPanelUrl("https://ha.example.com/p2talk_google_cast")'), 'https://ha.example.com/p2talk_google_cast');
assert.equal(run('safeHttpsPanelUrl("http://ha.example.com/p2talk_google_cast")'), null);
assert.equal(run('safeHttpsPanelUrl("https://evil.test/not-p2talk")'), null);
assert.equal(run('safeHttpsPanelUrl("https://ha.example.com@evil.test/p2talk_google_cast")'), null);
const visited = [];
context.window.location.replace = (destination) => visited.push(destination);
const securePanel = run('P2TalkGoogleCastPanel.prototype._openSecurePanel');
const instance = {_micHttpsUrl: 'https://ha.example.com/p2talk_google_cast', _redirecting: false, _status() {}};
assert.equal(securePanel.call(instance), true);
assert.equal(visited[0], 'https://ha.example.com/p2talk_google_cast');
assert.equal(instance._redirecting, true);
instance._redirecting = false;
instance._micHttpsUrl = 'http://ha.example.com/p2talk_google_cast';
assert.equal(securePanel.call(instance), false);
assert.equal(visited.length, 1);
assert.match(run('microphoneAdvice(null).action'), /HTTPS/);
assert.equal(run('microphoneEnvironment().protocol'), 'HTTP');
assert.equal(run('microphoneEnvironment().secure'), false);

context.window.isSecureContext = true;
context.window.location.protocol = 'https:';
assert.equal(run('microphoneAdvice(null).code'), 'capture_api_unavailable');
assert.equal(run('microphoneEnvironment().protocol'), 'HTTPS');

context.navigator.mediaDevices = { getUserMedia() {} };
assert.equal(run('microphoneAdvice(null).code'), 'recorder_unavailable');

context.window.MediaRecorder = class {};
assert.equal(run('microphoneAdvice({name: "NotAllowedError"}).code'), 'permission_denied');
assert.equal(run('microphoneAdvice({name: "NotFoundError"}).code'), 'microphone_missing');
assert.equal(run('microphoneAdvice({name: "NotReadableError"}).code'), 'microphone_busy');
assert.equal(run('microphoneAdvice({name: "SecurityError"}).code'), 'capture_blocked');
assert.equal(run('microphoneAdvice({name: "OverconstrainedError"}).code'), 'unsupported_constraints');
assert.equal(run('microphoneAdvice({name: "AbortError"}).code'), 'capture_failed');

console.log('PASS: microphone capability/error and HTTPS route checks');
