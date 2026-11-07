// Pure browser microphone gate regression tests, no Home Assistant required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'custom_components/p2talk_google_cast/frontend/cards.js'), 'utf8');
const context = {
  navigator: {mediaDevices: undefined},
  window: {isSecureContext: false, MediaRecorder: undefined, location: {protocol: 'http:'}},
  HTMLElement: class {},
  customElements: {get: () => undefined, define() {}},
  console, URL,
};
context.window.self = context.window;
context.window.top = context.window;
vm.createContext(context);
vm.runInContext(source, context);
const run = js => vm.runInContext(js, context);

assert.equal(run('microphoneAdvice(null).code'), 'insecure_context');
assert.equal(run('P2TalkGoogleCastCard.prototype._secureMicrophoneOrigin()'), false);
assert.match(run('microphoneAdvice(null).action'), /HTTPS/);
assert.equal(run('microphoneEnvironment().protocol'), 'HTTP');
// localhost is technically a secure context, but explicitly HTTP must stay disabled.
context.window.isSecureContext = true;
assert.equal(run('P2TalkGoogleCastCard.prototype._secureMicrophoneOrigin()'), false);
assert.equal(run('microphoneAdvice(null).code'), 'insecure_context');
context.window.location.protocol = 'https:';
assert.equal(run('P2TalkGoogleCastCard.prototype._secureMicrophoneOrigin()'), true);
assert.equal(run('microphoneAdvice(null).code'), 'capture_api_unavailable');
context.navigator.mediaDevices = {getUserMedia() {}};
assert.equal(run('microphoneAdvice(null).code'), 'recorder_unavailable');
context.window.MediaRecorder = class {};
for (const [name, code] of [
  ['NotAllowedError', 'permission_denied'],
  ['NotFoundError', 'microphone_missing'],
  ['NotReadableError', 'microphone_busy'],
  ['SecurityError', 'capture_blocked'],
  ['OverconstrainedError', 'unsupported_constraints'],
  ['AbortError', 'capture_failed'],
]) assert.equal(run(`microphoneAdvice({name:${JSON.stringify(name)}}).code`), code);
assert.ok(!source.includes('location.replace('));
assert.ok(!source.includes('sessionStorage'));
console.log('PASS HTTP gated; HTTPS allowed; no navigation; browser errors diagnosed');
