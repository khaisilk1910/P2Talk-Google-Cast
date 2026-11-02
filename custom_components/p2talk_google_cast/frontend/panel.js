/**
 * P2Talk Google Cast — Home Assistant custom sidebar panel.
 * Home Assistant supplies the authenticated `hass.callWS` API; this panel
 * never stores credentials, makes direct Supervisor requests or opens ports.
 */

const DOMAIN = "p2talk_google_cast";
const CHUNK_BYTES = 48 * 1024;
const UPLOAD_WINDOW = 6; // amortize Wi-Fi/WebSocket RTT while keeping ordering
const STORAGE_PREFIX = "p2talk_google_cast_";
function readSpeakerPreference() {
  try { return localStorage.getItem(`${STORAGE_PREFIX}speaker`); }
  catch (_) { return null; } // Private browsing / embedded WebViews may block storage.
}
function saveSpeakerPreference(value) {
  try { localStorage.setItem(`${STORAGE_PREFIX}speaker`, value); }
  catch (_) { /* Device selection still works without persistence. */ }
}

// Inline, dependency-free SVG icons. No external fonts, icon CDN or runtime package.
const glyphs = {
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
  cast: '<path d="M3 15a6 6 0 0 1 6 6M3 10a11 11 0 0 1 11 11M3 21h.01M9 3h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/>',
  speaker: '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="7.5" r=".65" fill="currentColor" stroke="none"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.07.08-1.84 1.84-.08-.07A1.7 1.7 0 0 0 16 18.4l-1 .4V21h-6v-2.2l-1-.4a1.7 1.7 0 0 0-1.88.34l-.08.07-1.84-1.84.07-.08A1.7 1.7 0 0 0 4.6 15l-.4-1H2v-4h2.2l.4-1a1.7 1.7 0 0 0-.34-1.88l-.07-.08L6.03 5.2l.08.07A1.7 1.7 0 0 0 8 5.6l1-.4V3h6v2.2l1 .4a1.7 1.7 0 0 0 1.88-.34l.08-.07 1.84 1.84-.07.08A1.7 1.7 0 0 0 19.4 9l.4 1H22v4h-2.2l-.4 1Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12a10.5 10.5 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19.5h.01"/>',
};
function icon(name, className = "") {
  return `<svg class="svg-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;
}
const mark = `<svg class="mark-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M13 25c-5 5-5 15 0 20m38-20c5 5 5 15 0 20" stroke="white" stroke-width="3" stroke-linecap="round" opacity=".65"/><rect x="27" y="14" width="10" height="29" rx="5" fill="white"/><path d="M21 34a11 11 0 0 0 22 0M32 46v8m-8 0h16" stroke="white" stroke-width="3.5" stroke-linecap="round"/><path d="M43 44h10v11H43" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M44 49a5 5 0 0 1 5 5" stroke="white" stroke-width="2.3" stroke-linecap="round"/></svg>`;

const styles = `
:host { display:block; min-height:100%; color:var(--primary-text-color,#17243a); font-family:var(--paper-font-body1_-_font-family,system-ui,-apple-system,'Segoe UI',sans-serif); --pt-primary:var(--primary-color,#2782ee); --pt-accent:var(--accent-color,#7965e9); --pt-ink:var(--primary-text-color,#17243a); --pt-muted:var(--secondary-text-color,#63738a); --pt-card:var(--card-background-color,#fff); --pt-border:var(--divider-color,#d7e0ed); --pt-tint:color-mix(in srgb,var(--pt-card) 93%,var(--pt-primary) 7%); }
* { box-sizing:border-box; }
button,select,input { font:inherit; }
button:focus-visible,select:focus-visible,a:focus-visible,input:focus-visible { outline:3px solid var(--pt-primary); outline-offset:3px; }
.svg-icon { width:20px; height:20px; flex:none; }
.wrap { min-height:100%; display:flex; justify-content:center; align-items:flex-start; padding:clamp(16px,3.3vw,34px) 14px max(28px,env(safe-area-inset-bottom)); /* HA 2026.11 paints the panel background; do not cover it */ background:transparent; }
.surface { position:relative; isolation:isolate; width:min(100%,640px); border:1px solid var(--pt-border); border-radius:30px; padding:clamp(19px,4vw,32px); background:var(--pt-card); box-shadow:0 18px 55px color-mix(in srgb,var(--pt-ink) 12%,transparent),0 2px 8px color-mix(in srgb,var(--pt-ink) 5%,transparent); overflow:hidden; }
.surface::before { content:""; position:absolute; inset:0 0 auto; height:230px; z-index:-1; pointer-events:none; background:radial-gradient(ellipse at 80% 0%,color-mix(in srgb,var(--pt-primary) 16%,transparent),transparent 66%),radial-gradient(ellipse at 10% 0%,color-mix(in srgb,var(--pt-accent) 10%,transparent),transparent 55%); }
.head { display:flex; align-items:center; gap:14px; padding-bottom:22px; margin-bottom:23px; border-bottom:1px solid var(--pt-border); }
.symbol { width:60px; height:60px; flex:none; border-radius:19px; background:linear-gradient(138deg,#1269e8 0%,#0bbce8 55%,#8456ec 100%); display:grid; place-items:center; box-shadow:0 9px 22px rgba(24,119,240,.22),inset 0 1px 1px rgba(255,255,255,.4); }
.mark-icon { width:43px; height:43px; }
.heading { min-width:0; flex:1; }
.heading .eyebrow { margin:0 0 4px; color:var(--pt-primary); letter-spacing:.13em; font-size:10px; font-weight:800; text-transform:uppercase; }
h1 { font-size:clamp(18px,3vw,23px); letter-spacing:-.75px; line-height:1.2; margin:0; font-weight:790; }
.subtitle { margin:5px 0 0; font-size:12px; line-height:1.5; color:var(--pt-muted); }
.lan-pill { flex:none; display:inline-flex; align-items:center; gap:6px; padding:7px 9px; border-radius:100px; border:1px solid color-mix(in srgb,#16a56b 24%,var(--pt-border)); color:var(--success-color,#118759); background:color-mix(in srgb,var(--pt-card) 88%,#38d39e 12%); font-size:11px; font-weight:750; }
.lan-pill .dot { width:6px; height:6px; border-radius:50%; background:currentColor; }
.section { margin-bottom:22px; }
.section-top { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:11px; }
.section-title { display:inline-flex; align-items:center; gap:9px; color:var(--pt-ink); font-size:14px; font-weight:750; }
.section-title .svg-icon { color:var(--pt-primary); }
.small-link { display:inline-flex; align-items:center; gap:6px; border:0; padding:7px 5px; border-radius:8px; background:transparent; color:var(--pt-primary); cursor:pointer; font-size:12px; font-weight:730; text-decoration:none; white-space:nowrap; }
.small-link:hover { background:var(--pt-tint); }
.small-link .svg-icon { width:15px; height:15px; }
.small-link:disabled { opacity:.5; cursor:default; }
.select-wrap { position:relative; display:flex; align-items:center; border:1px solid var(--pt-border); border-radius:16px; background:var(--pt-tint); transition:border-color .2s,box-shadow .2s; }
.select-wrap:focus-within { border-color:var(--pt-primary); box-shadow:0 0 0 3px color-mix(in srgb,var(--pt-primary) 14%,transparent); }
.select-wrap .device-icon { width:44px; height:44px; margin-inline-start:10px; display:grid; flex:none; place-items:center; border-radius:13px; background:linear-gradient(145deg,color-mix(in srgb,var(--pt-primary) 12%,var(--pt-card)),color-mix(in srgb,var(--pt-accent) 12%,var(--pt-card))); color:var(--pt-primary); }
.select-wrap select { position:relative; z-index:1; appearance:none; background:transparent; color:var(--pt-ink); width:100%; border:0; outline:0; min-width:0; padding:16px 36px 16px 12px; cursor:pointer; font-size:14px; font-weight:720; }
.select-wrap select:disabled { cursor:default; opacity:.55; }
.select-wrap select option { background:var(--pt-card); color:var(--pt-ink); }
.select-chevron { position:absolute; pointer-events:none; right:15px; width:18px; height:18px; color:var(--pt-muted); }
.speaker-meta { padding:9px 2px 0; display:flex; align-items:center; gap:7px; font-size:11px; color:var(--pt-muted); }
.speaker-meta .state-dot { width:7px; height:7px; border-radius:100%; background:var(--pt-muted); }
.speaker-meta.online .state-dot { background:var(--success-color,#16a66b); box-shadow:0 0 0 3px color-mix(in srgb,var(--success-color,#16a66b) 14%,transparent); }
.speaker-meta.offline .state-dot { background:var(--error-color,#ee5665); }
.volume-box { border:1px solid var(--pt-border); padding:11px 14px; border-radius:16px; background:var(--pt-tint); display:flex; align-items:center; gap:13px; }
.volume-box .svg-icon { color:var(--pt-primary); width:21px; height:21px; }
.volume-box input { width:100%; min-width:0; appearance:none; height:7px; border-radius:10px; cursor:pointer; background:linear-gradient(90deg,var(--pt-primary) 0,var(--pt-primary) var(--progress,65%),color-mix(in srgb,var(--pt-border) 80%,transparent) var(--progress,65%),color-mix(in srgb,var(--pt-border) 80%,transparent) 100%); }
.volume-box input::-webkit-slider-thumb { appearance:none; width:18px; height:18px; border-radius:50%; border:3px solid var(--pt-card); background:var(--pt-primary); box-shadow:0 1px 5px rgba(0,0,0,.2); }
.volume-box input::-moz-range-thumb { width:13px; height:13px; border-radius:50%; border:3px solid var(--pt-card); background:var(--pt-primary); box-shadow:0 1px 5px rgba(0,0,0,.2); }
.volume-box output { padding:5px 8px; min-width:48px; border-radius:9px; font-weight:800; font-size:13px; text-align:center; font-variant-numeric:tabular-nums; color:var(--pt-primary); background:color-mix(in srgb,var(--pt-primary) 10%,var(--pt-card)); }
.stage { position:relative; padding:8px 0 14px; margin:0 0 8px; text-align:center; overflow:hidden; }
.stage::before { content:""; position:absolute; top:43px; left:50%; width:410px; height:270px; transform:translateX(-50%); z-index:-1; pointer-events:none; background:radial-gradient(ellipse,color-mix(in srgb,var(--pt-primary) 11%,transparent) 0,transparent 66%); }
.stage-kicker { display:flex; justify-content:center; gap:7px; align-items:center; font-size:11px; font-weight:750; letter-spacing:.07em; color:var(--pt-muted); text-transform:uppercase; }
.stage-kicker .svg-icon { width:14px; height:14px; color:var(--pt-primary); }
.mic-layout { display:flex; align-items:center; justify-content:center; gap:13px; padding:15px 0 1px; }
.wave { display:flex; align-items:center; justify-content:center; gap:5px; width:92px; height:96px; opacity:.56; pointer-events:none; }
.wave span { display:block; flex:none; width:4px; height:var(--h); border-radius:10px; background:linear-gradient(180deg,#12bff0,var(--pt-primary),var(--pt-accent)); transform:scaleY(.7); transition:transform .3s; }
.mic-orbit { display:grid; place-items:center; position:relative; width:202px; height:202px; flex:none; }
.mic-orbit::before,.mic-orbit::after { content:""; pointer-events:none; position:absolute; inset:7px; border:1px solid color-mix(in srgb,var(--pt-primary) 30%,transparent); border-radius:50%; transition:border-color .2s; }
.mic-orbit::after { inset:0; border-color:color-mix(in srgb,var(--pt-accent) 20%,transparent); }
.mic { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; width:164px; height:164px; border:1px solid rgba(255,255,255,.28); border-radius:50%; cursor:pointer; color:white; background:linear-gradient(145deg,#1458d9,#169def 53%,#7d5be8); box-shadow:0 18px 38px rgba(30,110,236,.26),inset 0 3px 5px rgba(255,255,255,.2),inset 0 -8px 18px rgba(32,31,141,.2); touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; transition:transform .18s,box-shadow .18s,filter .2s; }
.mic .svg-icon { width:55px; height:55px; stroke-width:1.4; filter:drop-shadow(0 3px 8px rgba(0,0,0,.12)); }
.mic span { font-size:11px; letter-spacing:.08em; font-weight:830; }
.mic-orbit:hover::after { animation:slow-orbit 4s ease-in-out infinite; }
.mic:hover:not(:disabled) { transform:scale(1.035); box-shadow:0 21px 44px rgba(30,110,236,.34); }
.mic:active:not(:disabled) { transform:scale(.97); }
.mic:disabled { cursor:not-allowed; opacity:.46; filter:grayscale(.28); box-shadow:none; }
.stage.recording .mic { background:linear-gradient(145deg,#f43f5e,#ef4444 45%,#fb923c); box-shadow:0 18px 40px rgba(239,68,68,.27); transform:scale(1.03); }
.stage.recording .mic-orbit::before { border-color:rgba(248,113,113,.7); }
.stage.recording .mic-orbit::after { border-color:rgba(248,113,113,.4); animation:record-pulse 1.3s ease-out infinite; }
.stage.recording .wave span { animation:equalize .7s ease-in-out infinite alternate; animation-delay:var(--delay); }
.stage.sending .mic-orbit::after { border-width:3px; border-top-color:var(--pt-primary); border-right-color:transparent; animation:spin 1s linear infinite; }
.stage.sending .mic { filter:saturate(.6); }
.stage.sending .wave span { animation:equalize 1.3s ease-in-out infinite alternate; animation-delay:var(--delay); opacity:.55; }
.hint { font-size:17px; font-weight:800; letter-spacing:-.2px; margin:7px 0 4px; }
.counter { font-size:12px; min-height:20px; font-variant-numeric:tabular-nums; color:var(--pt-muted); }
.actions { display:grid; grid-template-columns:1fr 1fr; gap:11px; margin-top:4px; }
.action { display:flex; justify-content:center; align-items:center; gap:9px; padding:13px 12px; border:1px solid var(--pt-border); border-radius:13px; background:var(--pt-tint); color:var(--pt-ink); font-size:13px; font-weight:730; cursor:pointer; transition:transform .15s,background .15s; }
.action:hover:not(:disabled) { transform:translateY(-1px); background:color-mix(in srgb,var(--pt-primary) 9%,var(--pt-card)); }
.action .svg-icon { width:17px; height:17px; }
.action.stop-action { border-color:color-mix(in srgb,var(--pt-primary) 35%,var(--pt-border)); color:var(--pt-primary); background:color-mix(in srgb,var(--pt-primary) 8%,var(--pt-card)); }
.action:disabled { cursor:not-allowed; opacity:.45; }
.status { display:flex; text-align:start; align-items:flex-start; gap:11px; min-height:62px; margin-top:18px; padding:14px 15px; border-radius:15px; background:var(--pt-tint); border:1px solid var(--pt-border); color:var(--pt-muted); font-size:12px; line-height:1.55; overflow-wrap:anywhere; }
.status .status-symbol { display:grid; place-items:center; width:30px; height:30px; flex:none; border-radius:10px; color:var(--pt-primary); background:color-mix(in srgb,var(--pt-primary) 12%,var(--pt-card)); }
.status .status-symbol .svg-icon { width:17px; height:17px; }
.status .status-content { align-self:center; }
.status.success { border-color:color-mix(in srgb,var(--success-color,#10a678) 35%,var(--pt-border)); background:color-mix(in srgb,var(--success-color,#10a678) 7%,var(--pt-card)); color:var(--primary-text-color,#1b2c3c); }
.status.success .status-symbol { color:var(--success-color,#0c9963); background:color-mix(in srgb,var(--success-color,#10a678) 12%,var(--pt-card)); }
.status.error { border-color:color-mix(in srgb,var(--error-color,#eb4354) 45%,var(--pt-border)); background:color-mix(in srgb,var(--error-color,#eb4354) 8%,var(--pt-card)); color:var(--error-color,#dc3447); }
.status.error .status-symbol { color:var(--error-color,#dc3447); background:color-mix(in srgb,var(--error-color,#eb4354) 12%,var(--pt-card)); }
.status.loading .status-symbol .svg-icon { animation:spin 1.3s linear infinite; }
.metrics { display:none; margin-top:10px; padding:11px 13px; border-radius:12px; background:var(--pt-tint); color:var(--pt-muted); font-size:11px; line-height:1.5; }
.metrics:not(:empty) { display:block; }
.foot { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-top:19px; padding-top:16px; border-top:1px solid var(--pt-border); color:var(--pt-muted); font-size:11px; }
.foot .privacy { display:flex; align-items:center; gap:8px; }
.foot .svg-icon { width:15px; height:15px; color:var(--success-color,#10a678); }
.foot .foot-brand { font-weight:730; color:var(--pt-primary); }
@keyframes record-pulse { 0% { transform:scale(.92); opacity:.95; } 100% { transform:scale(1.22); opacity:0; } }
@keyframes slow-orbit { 50% { transform:scale(1.035); opacity:.55; } }
@keyframes equalize { from { transform:scaleY(.4); } to { transform:scaleY(1.15); } }
@keyframes spin { to { transform:rotate(360deg); } }
@media (max-width:520px) { .surface { border-radius:23px; padding:19px 16px; } .symbol { width:52px; height:52px; border-radius:16px; } .mark-icon { width:38px; height:38px; } .lan-pill { padding:6px 8px; font-size:10px; } .wave { width:42px; gap:3px; } .wave span { width:3px; } .wave span:nth-child(n+6) { display:none; } .mic-orbit { width:187px; height:187px; } .mic { width:156px; height:156px; } .mic-layout { gap:0; } }
@media (max-width:350px) { .lan-pill { display:none; } .wave { display:none; } .mic-layout { margin-inline:auto; } .head { gap:9px; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }
/* P2Talk Studio UI: functional recreation of the approved visual design.
   No runtime image/CDN/font requests; decorative media comes from local HA assets. */
:host {
  --pt-brand:#1275f7; --pt-cyan:#00c5f9; --pt-violet:#8c6aff;
  --pt-primary:var(--primary-color,#167dfa);
  --pt-border:color-mix(in srgb,var(--divider-color,#d6e0ef) 74%,#b1c5e7 26%);
  --pt-hero-ink:#123363;
}
.wrap { padding:clamp(12px,2.8vw,28px) 12px max(22px,env(safe-area-inset-bottom)); }
.surface { width:min(100%,620px); padding:0; border-radius:28px;
  background:linear-gradient(162deg,color-mix(in srgb,var(--pt-card) 91%,#c7d9ff 9%),var(--pt-card) 72%);
  border:1px solid color-mix(in srgb,var(--pt-border) 75%,#91c3fd 25%);
  box-shadow:0 22px 56px rgba(38,69,124,.18),0 5px 13px rgba(29,80,136,.10);
}
.surface::before { display:none; }
.head { position:relative; display:flex; align-items:center; gap:14px; height:174px; padding:22px 23px 31px; margin:0; overflow:hidden;
  border:0; color:var(--pt-hero-ink);
  background:linear-gradient(115deg,#a9d9ff 0%,#d4e9ff 42%,#7ebdfd 78%,#247ad8 100%);
}
.hero-glow { position:absolute; pointer-events:none; inset:0; background:
  radial-gradient(circle at 10% 20%,rgba(255,255,255,.85),transparent 30%),
  radial-gradient(ellipse at 56% 112%,rgba(255,255,255,.8),transparent 54%),
  radial-gradient(circle at 100% 2%,rgba(4,86,204,.26),transparent 38%); }
.hero-waves { position:absolute; pointer-events:none; width:100%; height:115px; left:0; bottom:-1px; opacity:.95; }
.hero-speaker { position:absolute; width:190px; height:auto; right:-9px; bottom:0px; pointer-events:none;
  filter:drop-shadow(0 5px 8px rgba(16,55,109,.25)); opacity:.98; }
.head .symbol { z-index:1; width:96px; height:96px; border:2px solid rgba(255,255,255,.74); border-radius:50%; flex:none;
 background:radial-gradient(circle at 30% 16%,#34e3ff 0%,#087cf1 55%,#0757ed 77%,#7d5ff1 100%);
 box-shadow:0 0 0 5px rgba(255,255,255,.2),0 8px 19px rgba(6,75,178,.38),inset 0 2px 7px rgba(255,255,255,.66); }
.head .symbol .mark-icon { width:72px; height:72px; filter:drop-shadow(0 3px 2px rgba(4,44,137,.27)); }
.heading { position:relative; z-index:1; align-self:center; min-width:0; flex:1; margin-right:70px; }
.heading h1 { font-size:clamp(19px,3.6vw,25px); letter-spacing:-.75px; line-height:1.2; font-weight:850; white-space:nowrap; color:#173159; text-shadow:0 1px 0 rgba(255,255,255,.25); }
.heading h1 em { font-style:normal; color:#0057cc; }
.heading .subtitle { font-size:12px; color:#244977; margin:9px 0 0; line-height:1.45; font-weight:530; max-width:330px; }
.lan-pill { position:absolute; top:13px; right:13px; z-index:3; padding:5px 10px;
 color:#087042; background:linear-gradient(135deg,#d9ffe8,#8cecb5); border:1px solid #6ddfaf;
 box-shadow:0 2px 8px rgba(17,98,76,.12); font-size:11px; }
.lan-pill .dot { width:7px; height:7px; box-shadow:0 0 0 2px rgba(0,143,84,.1); }
.lan-pill.unavailable { background:#fff3db; color:#a34b13; border-color:#f6bd63; }
.lan-pill.busy { background:#eff6ff; color:#0e68c8; border-color:#92c6f8; }
.panel-body { position:relative; margin-top:-14px; border-radius:26px 26px 0 0;
  padding:25px 25px 16px; background:linear-gradient(180deg,
  color-mix(in srgb,var(--pt-card) 81%,#d1dcff 19%) 0%,
  color-mix(in srgb,var(--pt-card) 92%,#e3ebff 8%) 52%,var(--pt-card) 100%);
  box-shadow:0 -4px 10px rgba(107,157,217,.08); }
.section { margin-bottom:17px; }
.section-top { margin-bottom:9px; }
.section-title { font-size:14px; font-weight:820; gap:10px; }
.section-title .svg-icon { width:24px; height:24px; color:#0864e9; fill:#0864e9; stroke-width:1.7; }
.section-tools { display:flex; align-items:center; gap:5px; }
.refresh-icon { display:grid; place-items:center; width:31px; height:31px; border:0; border-radius:50%; background:transparent; color:#1173df; cursor:pointer; }
.refresh-icon:hover:not(:disabled) { background:color-mix(in srgb,var(--pt-primary) 12%,transparent); }
.refresh-icon:disabled { opacity:.4; cursor:wait; }
.refresh-icon .svg-icon { width:17px; height:17px; }
.configure-link { padding:7px 11px; border:1px solid #66a7fa; border-radius:999px;
  background:color-mix(in srgb,var(--pt-card) 86%,#d8ebff 14%); color:#095fd0;
  box-shadow:0 2px 7px rgba(28,104,226,.08); font-size:12px; }
.configure-link:hover { border-color:#1982fb; background:color-mix(in srgb,var(--pt-card) 76%,#c6e6ff 24%); }
.select-wrap { min-height:58px; border:1px solid color-mix(in srgb,var(--pt-border) 80%,white 20%); border-radius:17px;
  background:color-mix(in srgb,var(--pt-card) 92%,#ecf4ff 8%);
  box-shadow:0 3px 9px rgba(35,60,103,.11),inset 0 1px 0 rgba(255,255,255,.55); }
.select-wrap .device-icon { width:54px; height:48px; margin-inline-start:5px; background:transparent; }
.nest-mini { display:block; position:relative; width:39px; height:23px; border-radius:50% 50% 42% 42%; transform:perspective(100px) rotateX(6deg);
  background:radial-gradient(ellipse at 30% 10%,#e8e9ea 0%,#9da5b0 40%,#606b7a 73%,#27344a 100%);
  box-shadow:0 5px 5px rgba(20,45,76,.21),inset 0 -4px 3px rgba(0,0,0,.19); }
.nest-mini::after { content:""; position:absolute; inset:auto 3px 1px; height:2px; border-radius:50%; background:linear-gradient(90deg,transparent,#4ecaff,transparent); }
.select-wrap select { height:58px; padding:12px 148px 12px 4px; font-size:14px; font-weight:800; }
.select-chevron { width:20px; height:20px; right:12px; color:#244870; }
.speaker-availability { position:absolute; right:41px; top:50%; display:flex; gap:7px; align-items:center;
 transform:translateY(-50%); font-size:11px; color:var(--pt-muted); pointer-events:none; white-space:nowrap; }
.speaker-availability .state-dot { width:8px; height:8px; border-radius:50%; background:#9cabc1; }
.speaker-availability.online .state-dot { background:#00c65d; box-shadow:0 0 0 3px rgba(7,210,109,.09); }
.speaker-availability.offline .state-dot { background:#f45d63; }
.speaker-meta { height:0; opacity:0; padding:0; overflow:hidden; }
.volume-section { margin-top:10px; margin-bottom:8px; }
.volume-box { border-radius:15px; border:1px solid color-mix(in srgb,var(--pt-border) 73%,#cad6f1 27%);
  background:color-mix(in srgb,var(--pt-card) 87%,#d5e5ff 13%); min-height:51px; padding:7px 10px 7px 14px; gap:12px; }
.volume-box .svg-icon { color:#1268c9; width:21px; height:21px; }
.volume-box .volume-max { width:22px; height:22px; }
.volume-box input { height:8px; background:linear-gradient(90deg,#1172fa 0%,#00b8f8 var(--progress,65%),color-mix(in srgb,var(--pt-border) 76%,#b8c6e5 24%) var(--progress,65%)); }
.volume-box input::-webkit-slider-thumb { width:21px; height:21px; background:linear-gradient(135deg,#008bff,#0873e2); border:1px solid #5bcaff; box-shadow:0 2px 5px rgba(29,85,199,.22); }
.volume-box input::-moz-range-thumb { width:21px; height:21px; background:linear-gradient(135deg,#008bff,#0873e2); border:1px solid #5bcaff; }
.volume-box output { min-width:51px; padding:8px 10px; border-radius:14px; font-size:14px; color:#064cb7; background:linear-gradient(135deg,#dbecff,#b5d7ff); }
.stage { margin:0 -25px 1px; padding:8px 12px 5px; isolation:isolate; overflow:visible;
  background:radial-gradient(ellipse at 50% 48%,rgba(49,169,255,.19),transparent 63%),
             radial-gradient(ellipse at 87% 55%,rgba(151,109,255,.14),transparent 46%); }
.stage::before { z-index:-1; top:13px; width:min(100%,550px); height:275px;
  background:radial-gradient(ellipse at 50% 54%,rgba(3,145,253,.24),transparent 64%); }
.stage-kicker { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.mic-layout { padding:6px 0 0; gap:0; min-height:238px; }
.wave { z-index:1; flex:1 1 0; min-width:0; width:auto; height:124px; gap:4px; opacity:.78; overflow:visible; }
.wave span { width:4px; height:var(--h); max-height:100%; flex:1 1 3px;
  background:linear-gradient(180deg,#8ceaff 0%,#1baafa 46%,#a070f9 100%); transform:scaleY(.7);
  box-shadow:0 0 7px rgba(46,183,252,.13); }
.mic-orbit { width:230px; height:230px; }
.mic-orbit::before { inset:6px; border:3px solid rgba(128,244,255,.55); box-shadow:0 0 24px rgba(57,202,255,.21),inset 0 0 19px rgba(68,176,255,.12); }
.mic-orbit::after { inset:0; border:2px solid rgba(135,164,255,.35); }
.mic { width:195px; height:195px; padding:15px; border:4px solid rgba(238,255,255,.96);
  background:radial-gradient(circle at 65% 24%,#1cccf6 0%,#087bfb 48%,#0860ee 79%,#4d49e6 100%);
  box-shadow:0 10px 28px rgba(10,93,233,.31),0 0 23px rgba(76,191,255,.42),inset 0 3px 7px rgba(255,255,255,.38),inset 0 -12px 24px rgba(20,50,192,.26); }
.mic .svg-icon { width:68px; height:68px; stroke-width:1.6; }
.mic span { font-size:18px; line-height:1.22; font-weight:790; letter-spacing:-.3px; text-shadow:0 1px 4px rgba(2,57,149,.2); }
.mic:hover:not(:disabled) { transform:scale(1.025); box-shadow:0 13px 37px rgba(10,93,233,.37),0 0 26px rgba(76,191,255,.52); }
.stage.recording .mic { background:radial-gradient(circle at 20% 18%,#ffb18b,#fc575e 52%,#ce2d86); }
.stage.sending .mic { filter:grayscale(.22); }
.hint { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.counter { min-height:0; font-weight:700; color:var(--pt-muted); font-size:12px; margin:-2px 0 5px; }
.stage:not(.recording):not(.sending) .counter { visibility:hidden; height:0; margin:0; }
.actions { gap:11px; margin:7px 0 0; }
.action { border-radius:999px; min-height:48px; padding:12px 10px; font-size:14px;
  background:linear-gradient(150deg,color-mix(in srgb,var(--pt-card) 72%,#dbe1f6 28%),color-mix(in srgb,var(--pt-card) 80%,#d8dbed 20%));
  border:1px solid color-mix(in srgb,var(--pt-border) 65%,#d2d9e9 35%); }
.action.stop-action { background:linear-gradient(110deg,#0677ef,#3988e9); border:1px solid #61c8ff; color:#fff; box-shadow:inset 0 1px 1px rgba(255,255,255,.25); }
.action.stop-action:hover:not(:disabled) { background:linear-gradient(110deg,#006bda,#2584f7); }
.action .svg-icon { width:17px; height:17px; }
.action:disabled { opacity:.57; }
.action.stop-action:disabled { opacity:.9; }
.status { position:relative; min-height:69px; margin-top:14px; border:1px solid #a0e0b4; border-radius:15px;
  padding:13px 15px; background:linear-gradient(100deg,#c8f8da,#c5f1e8 68%,#b9eddb);
  color:#174f33; align-items:center; gap:12px; }
.status .status-symbol { width:37px; height:37px; border-radius:50%; background:linear-gradient(140deg,#07935d,#00794b); color:white; flex:none; }
.status .status-symbol .svg-icon { width:23px; height:23px; stroke-width:2.8; }
.status-copy { display:flex; flex:1; flex-direction:column; gap:3px; min-width:0; }
.status .status-content { font-size:13px; font-weight:800; line-height:1.32; color:#124b2f; }
.status small { font-size:11px; line-height:1.35; color:#376957; }
.status-equalizer { display:flex; align-items:end; height:32px; gap:4px; flex:none; margin-right:2px; opacity:.52; }
.status-equalizer i { display:block; width:5px; height:6px; border-radius:4px; background:#25bd82; }
.status-equalizer i:nth-child(2),.status-equalizer i:nth-child(6) { height:12px; }
.status-equalizer i:nth-child(3),.status-equalizer i:nth-child(5) { height:20px; }
.status-equalizer i:nth-child(4) { height:28px; }
.status.success { color:#134f34; border-color:#95deb1; background:linear-gradient(110deg,#c8f8da,#baf0da); }
.status.success .status-symbol { background:linear-gradient(140deg,#009e62,#006b49); color:#fff; }
.status.loading { background:linear-gradient(110deg,#dcf0ff,#dcf6ff); border-color:#a5d6ff; }
.status.loading .status-symbol { background:linear-gradient(140deg,#1471e7,#00b0f3); color:#fff; }
.status.loading .status-content { color:#184f88; }
.status.loading small { color:#54718e; }
.status.error { background:linear-gradient(115deg,#ffebec,#fff3f4); color:#a32140; border-color:#f7b8c6; }
.status.error .status-symbol { color:#fff; background:linear-gradient(140deg,#eb4568,#b82752); }
.status.error .status-content { color:#9a2445; }
.status.error small { color:#9e5064; }
.status.recording .status-equalizer i,.stage.recording ~ .status .status-equalizer i { animation:equalize .7s ease-in-out infinite alternate; }
.metrics { margin-top:10px; border-radius:10px; }
.foot { margin-top:13px; border-top:0; justify-content:center; font-size:10px; gap:6px; padding:0 0 2px; }
.foot .foot-brand { display:none; }
:host([data-dark="true"]) .surface { box-shadow:0 22px 56px rgba(0,0,0,.3); }
:host([data-dark="true"]) .head { background:linear-gradient(115deg,#173e76,#225da0 47%,#172e62 100%); }
:host([data-dark="true"]) .hero-glow { opacity:.4; }
:host([data-dark="true"]) .heading h1 { color:#f1f7ff; text-shadow:0 1px 2px rgba(0,0,0,.25); }
:host([data-dark="true"]) .heading h1 em { color:#79cbff; }
:host([data-dark="true"]) .heading .subtitle { color:#e0efff; }
:host([data-dark="true"]) .hero-speaker { opacity:.77; }
:host([data-dark="true"]) .hero-waves { opacity:.42; }
:host([data-dark="true"]) .panel-body { background:linear-gradient(180deg,color-mix(in srgb,var(--pt-card) 80%,#1b3d70 20%) 0%,var(--pt-card) 100%); }
:host([data-dark="true"]) .select-wrap { background:color-mix(in srgb,var(--pt-card) 95%,#254b7f 5%); box-shadow:0 3px 9px rgba(0,0,0,.19); }
:host([data-dark="true"]) .section-title .svg-icon { color:#63b9ff; fill:#5daffa; }
:host([data-dark="true"]) .configure-link { color:#8bceff; border-color:#458cd3; }
:host([data-dark="true"]) .volume-box { background:color-mix(in srgb,var(--pt-card) 89%,#254b7f 11%); }
:host([data-dark="true"]) .volume-box .svg-icon { color:#8bcfff; }
:host([data-dark="true"]) .volume-box output { color:#a3d2ff; background:color-mix(in srgb,var(--pt-card) 72%,#3b79cc 28%); }
:host([data-dark="true"]) .select-chevron { color:var(--pt-muted); }
:host([data-dark="true"]) .status.success { background:linear-gradient(110deg,#154b40,#1d5b52); border-color:#238f72; }
:host([data-dark="true"]) .status.success .status-content { color:#d4ffe7; }
:host([data-dark="true"]) .status.success small { color:#a2e2ca; }
:host([data-dark="true"]) .status.loading { background:#163b56; border-color:#265e91; }
:host([data-dark="true"]) .status.loading .status-content { color:#d5edff; }
:host([data-dark="true"]) .status.loading small { color:#a1cce9; }
:host([data-dark="true"]) .status.error { background:#512737; border-color:#9b4b5a; }
:host([data-dark="true"]) .status.error .status-content { color:#ffe0e5; }
:host([data-dark="true"]) .status.error small { color:#ffd1dc; }
@media (max-width:620px) {
 .head { height:148px; padding:24px 16px 28px; gap:12px; }
 .head .symbol { width:78px; height:78px; }
 .head .symbol .mark-icon { width:60px; height:60px; }
 .heading { margin-right:48px; }
 .heading h1 { font-size:clamp(15px,3.8vw,22px); }
 .heading .subtitle { font-size:11px; }
 .hero-speaker { width:151px; right:-15px; bottom:0; }
 .panel-body { padding:20px 18px 15px; }
 .stage { margin-left:-18px; margin-right:-18px; }
 .mic-layout { min-height:219px; }
 .mic-orbit { width:215px; height:215px; }
 .mic { width:183px; height:183px; }
 .wave { gap:3px; width:auto; }
 .wave span { width:3px; }
}
@media (max-width:430px) {
 .surface { border-radius:22px; }
 .head { height:137px; padding:21px 13px 22px; gap:9px; }
 .head .symbol { width:65px; height:65px; }
 .head .symbol .mark-icon { width:50px; height:50px; }
 .heading { margin-right:38px; }
 .heading h1 { font-size:clamp(14px,3.85vw,17px); white-space:normal; }
 .heading .subtitle { font-size:10px; line-height:1.33; max-width:205px; }
 .hero-desktop-break { display:none; }
 .hero-speaker { width:116px; opacity:.82; right:-29px; }
 .lan-pill { top:7px; right:7px; padding:4px 7px; font-size:9px; }
 .panel-body { padding:18px 12px 13px; border-radius:20px 20px 0 0; }
 .section-title { font-size:12px; gap:6px; }
 .section-title .svg-icon { width:20px; height:20px; }
 .configure-link { font-size:10px; padding:5px 7px; }
 .refresh-icon { width:27px; }
 .section { margin-bottom:15px; }
 .select-wrap { min-height:52px; }
 .select-wrap select { height:52px; font-size:12px; padding:10px 105px 10px 0; }
 .select-wrap .device-icon { width:44px; }
 .nest-mini { width:33px; height:19px; }
 .speaker-availability { right:33px; font-size:9px; }
 .select-chevron { right:9px; width:15px; }
 .volume-box { gap:7px; padding:7px 8px; }
 .volume-box output { min-width:43px; font-size:12px; padding:7px; }
 .volume-box .svg-icon { width:17px; }
 .volume-box .volume-max { width:17px; }
 .stage { margin-left:-12px; margin-right:-12px; }
 .mic-layout { min-height:205px; }
 .mic-orbit { width:205px; height:205px; }
 .mic { width:171px; height:171px; }
 .mic .svg-icon { width:59px; height:59px; }
 .mic span { font-size:16px; }
 .wave { gap:2px; height:112px; }
 .wave span { width:2px; flex:0 0 3px; }
 .wave span:nth-child(even) { display:none; }
 .action { min-height:44px; font-size:12px; padding:10px 6px; }
 .status { padding:11px 10px; gap:8px; }
 .status .status-content { font-size:11px; }
 .status small { font-size:10px; }
 .status-symbol { width:31px; height:31px; }
 .status-equalizer { gap:2px; }
 .status-equalizer i { width:3px; }
 .foot { display:none; }
}
@media (max-width:350px) {
 .heading .subtitle { display:none; }
 .head .symbol { width:59px; height:59px; }
 .heading { margin-right:0; }
 .hero-speaker { width:105px; opacity:.5; }
 .wave { display:flex; }
 .mic-orbit { width:185px; height:185px; }
 .mic { width:159px; height:159px; }
 .mic-layout { min-height:190px; }
 .status-equalizer { display:none; }
 .speaker-availability { display:none; }
 .select-wrap select { padding-right:24px; }
}
@media (prefers-reduced-motion:reduce) {
 .wave span,.mic,.mic-orbit::before,.mic-orbit::after { animation:none!important; transition:none!important; }
}

`;

const waveMarkup = () => `<div class="wave" aria-hidden="true">${[14,27,44,67,35,57,84,48,62,37,75,102,65,46,58,31,18].map((n,i)=>`<span style="--h:${n}px;--delay:${(i*.07).toFixed(2)}s"></span>`).join("")}</div>`;

class P2TalkGoogleCastPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._loaded = false;
    this._loadingSpeakers = false;
    this._recording = false;
    this._pressed = false;
    this._sending = false;
    this._discard = false;
    this._recorder = null;
    this._stream = null;
    this._chunks = [];
    this._maxSeconds = 120;
    this._maxBytes = 8 * 1024 * 1024;
    this._configuredSpeakers = [];
    this._timer = null;
    this._started = 0;
  }

  set hass(hass) {
    this._hass = hass;
    if (typeof hass?.themes?.darkMode === "boolean") {
      this.setAttribute("data-dark", hass.themes.darkMode ? "true" : "false");
    }
    if (this.isConnected && !this._loaded) this._loadSpeakers();
    else if (this.isConnected && this._loaded) this._syncSpeakerState();
  }
  get hass() { return this._hass; }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="wrap"><main class="surface">
        <header class="head">
          <div class="hero-glow" aria-hidden="true"></div>
          <svg class="hero-waves" viewBox="0 0 680 170" preserveAspectRatio="none" aria-hidden="true"><path d="M0 110C116 190 214 92 333 139S522 104 680 149V170H0Z" fill="#e8f6ff" opacity=".37"/><path d="M0 128C158 200 237 103 364 154S554 83 680 132V170H0Z" fill="#38baf5" opacity=".27"/><path d="M0 155C158 112 234 163 327 143S531 179 680 118V170H0Z" fill="#0797ea" opacity=".36"/></svg>
          <img class="hero-speaker" src="/${DOMAIN}_assets/nest-speaker.webp" alt="" aria-hidden="true" loading="eager" decoding="async" />
          <div class="symbol">${mark}</div>
          <div class="heading"><h1>P2Talk <em>Google Cast</em></h1><p class="subtitle">Nhấn giữ để nói, thả để phát giọng nói<br class="hero-desktop-break"/> lên loa Google Cast ngay trong Home Assistant</p></div>
          <span class="lan-pill" id="connectionPill"><span class="dot"></span><span id="connectionLabel">Đang kết nối</span></span>
        </header>
        <div class="panel-body">
        <section class="section speaker-section" aria-label="Thiết bị phát">
          <div class="section-top"><label class="section-title" for="speaker">${icon("volume")} Chọn loa Google Cast</label>
          <span class="section-tools"><button type="button" class="refresh-icon" id="refresh" title="Làm mới danh sách loa" aria-label="Làm mới danh sách loa">${icon("refresh")}</button><a class="small-link configure-link" id="configure" href="/config/integrations/integration/p2talk_google_cast" title="Cấu hình, thêm, sửa hoặc xóa loa">${icon("settings")} Quản lý loa</a></span></div>
          <div class="select-wrap"><span class="device-icon" aria-hidden="true"><span class="nest-mini"></span></span><select id="speaker" aria-label="Chọn loa đã thêm trong cấu hình"><option value="">Đang tải loa...</option></select><span class="speaker-availability" id="inlineState" aria-hidden="true"><i class="state-dot"></i><span id="inlineStateText">Đang tải</span></span>${icon("chevron","select-chevron")}</div>
          <div class="speaker-meta" id="speakerMeta"><span class="state-dot"></span><span id="speakerState">Đang kiểm tra thiết bị...</span></div>
        </section>
        <section class="section volume-section" aria-label="Âm lượng phát"><div class="section-top"><label for="volume" class="section-title">${icon("volume")} Âm lượng phát</label></div>
          <div class="volume-box">${icon("volume")}<input id="volume" type="range" min="5" max="100" value="65" aria-label="Âm lượng phát" style="--progress:65%"/>${icon("volume", "volume-max")}<output id="volumeText" for="volume">65%</output></div>
        </section>
        <section class="stage" id="stage" aria-label="Nhấn giữ để nói">
          <div class="stage-kicker">${icon("wifi")} Kết nối nội bộ qua Home Assistant</div>
          <div class="mic-layout">${waveMarkup()}<div class="mic-orbit"><button id="mic" class="mic" type="button" disabled aria-label="Nhấn giữ để ghi âm, thả để gửi đến loa" title="Nhấn giữ để nói">${icon("mic")}<span id="micText">Nhấn giữ<br/>để nói</span></button></div>${waveMarkup()}</div>
          <p id="hint" class="hint">Nhấn giữ để nói</p><div id="counter" class="counter">Thả nút để phát đến loa đã chọn</div>
        </section>
        <div class="actions"><button type="button" class="action" id="cancel" disabled>${icon("close")} Hủy</button>
        <button type="button" class="action stop-action" id="stop" disabled>${icon("stop")} Dừng loa</button></div>
        <div id="status" class="status loading" role="status" aria-live="polite"><div id="statusIcon" class="status-symbol">${icon("refresh")}</div><div class="status-copy"><strong id="statusText" class="status-content">Đang kết nối Home Assistant...</strong><small id="statusNote">Đang kiểm tra quyền truy cập và thiết bị.</small></div><span class="status-equalizer" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></div>
        <div id="metrics" class="metrics" aria-live="polite"></div>
        <footer class="foot"><span class="privacy">${icon("lock")} Âm thanh qua phiên Home Assistant đã đăng nhập · Không cần token</span><span class="foot-brand">P2Talk · Google Cast</span></footer>
        </div>
      </main></div>`;
    this.$ = (id) => this.shadowRoot.getElementById(id);
    this.$("refresh").addEventListener("click", () => this._loadSpeakers());
    this.$("speaker").addEventListener("change", (e) => {
      saveSpeakerPreference(e.target.value);
      this._applySpeakerVolume();
      this._syncSpeakerState();
      this._refreshControls();
    });
    this.$("volume").addEventListener("input", (e) => {
      this.$("volumeText").textContent = `${e.target.value}%`;
      this.$("volume").style.setProperty("--progress", `${e.target.value}%`);
      // Volume overrides configuration only for this selected playback; not stored.
    });
    this.$("cancel").addEventListener("click", () => this._stopRecording(true));
    this.$("stop").addEventListener("click", () => this._stopSpeaker());
    const mic = this.$("mic");
    mic.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || mic.disabled) return;
      event.preventDefault();
      mic.setPointerCapture(event.pointerId);
      this._startRecording();
    });
    mic.addEventListener("pointerup", (event) => {
      event.preventDefault();
      this._stopRecording(false);
    });
    mic.addEventListener("pointercancel", () => this._stopRecording(true));
    mic.addEventListener("lostpointercapture", () => {
      if (this._pressed) this._stopRecording(false);
    });
    mic.addEventListener("keydown", (event) => {
      if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
        event.preventDefault();
        this._startRecording();
      }
    });
    mic.addEventListener("keyup", (event) => {
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        this._stopRecording(false);
      }
    });
    this._visibilityHandler = () => {
      if (document.visibilityState === "visible") this._loadSpeakers(true);
      else if (this._recording) this._stopRecording(true);
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);
    if (this._hass) this._loadSpeakers();
  }

  disconnectedCallback() {
    if (this._visibilityHandler) document.removeEventListener("visibilitychange", this._visibilityHandler);
    if (this._timer) clearInterval(this._timer);
    this._pressed = false;
    if (this._recorder && this._recorder.state !== "inactive") {
      this._discard = true;
      this._recorder.stop();
    }
    this._stopTracks();
  }

  _status(message, type = "") {
    const el = this.$("status");
    if (!el) return;
    this.$("statusText").textContent = message;
    this.$("statusIcon").innerHTML = icon(type === "success" ? "check" : type === "error" ? "alert" : type === "loading" ? "refresh" : "info");
    const secondary = this.$("statusNote");
    secondary.textContent = type === "success" ? "Âm thanh được gửi qua phiên Home Assistant đã đăng nhập." : type === "error" ? "Kiểm tra kết nối thiết bị và Settings → System → Logs." : type === "loading" ? "Đang xử lý yêu cầu của bạn..." : "Chọn loa và nhấn giữ nút micro để nói.";
    const pill = this.$("connectionPill");
    if (pill) {
      pill.className = `lan-pill ${type === "error" ? "unavailable" : type === "loading" ? "busy" : ""}`;
      this.$("connectionLabel").textContent = type === "error" ? "Cần kiểm tra" : type === "loading" ? "Đang xử lý" : "Đã sẵn sàng";
    }
    el.className = `status ${type}`;
  }

  _refreshControls() {
    if (!this.$) return;
    const entityId = this.$("speaker").value;
    const speaker = this._configuredSpeakers.find((entry) => entry.entity_id === entityId);
    const state = this._hass?.states?.[entityId]?.state || speaker?.state;
    const selected = !!speaker?.is_available && state !== "unknown" && state !== "unavailable";
    this.$("mic").disabled = this._recording || this._sending || !selected;
    // While recording, keep the same pressed button operable for pointerup.
    if (this._recording) this.$("mic").disabled = false;
    this.$("speaker").disabled = this._recording || this._sending;
    this.$("stop").disabled = this._sending || !selected;
    this.$("cancel").disabled = !this._recording;
    this.$("refresh").disabled = this._recording || this._sending;
    this.$("configure").style.pointerEvents = this._recording || this._sending ? "none" : "";
  }

  async _loadSpeakers(silent = false) {
    if (!this._hass || this._loadingSpeakers || !this.isConnected) return;
    this._loadingSpeakers = true;
    if (!silent) this._status("Đang đọc thiết bị từ Home Assistant...", "loading");
    try {
      const response = await this._hass.callWS({ type: `${DOMAIN}/speakers` });
      this._loaded = true;
      this._maxSeconds = response.max_seconds || 120;
      this._maxBytes = response.max_bytes || this._maxBytes;
      const select = this.$("speaker");
      const previous = select.value || readSpeakerPreference();
      select.replaceChildren();
      const speakers = response.speakers || [];
      this._configuredSpeakers = speakers;
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = speakers.length ? "Chọn loa đã cấu hình..." : "Chưa thêm loa trong cấu hình tích hợp";
      select.append(empty);
      for (const speaker of speakers) {
        const option = document.createElement("option");
        option.value = speaker.entity_id;
        option.textContent = speaker.friendly_name;
        option.disabled = !speaker.is_available;
        select.append(option);
      }
      if (previous && speakers.some((s) => s.entity_id === previous && s.is_available)) select.value = previous;
      if (!select.value) {
        const firstOnline = speakers.find((s) => s.is_available);
        if (firstOnline) select.value = firstOnline.entity_id;
      }
      if (!this._recording && !this._sending) this._applySpeakerVolume();
      this._syncSpeakerState();
      if (!this._recording && !this._sending) {
        const available = speakers.some((s) => s.is_available);
        this._status(available ? "Sẵn sàng. Nhấn giữ micro để nói." :
          (speakers.length ? "Các loa đã thêm đều offline/không hỗ trợ phát. Kiểm tra Google Cast." :
          "Chưa có loa. Vào Settings → Devices & services → P2Talk Google Cast → Configure → Add speaker."),
          available ? "success" : "error");
      }
    } catch (error) {
      if (!silent) this._status(`Không đọc được danh sách loa: ${error.message || error}`, "error");
    } finally {
      this._loadingSpeakers = false;
      this._refreshControls();
    }
  }

  _applySpeakerVolume() {
    const current = this._configuredSpeakers.find((s) => s.entity_id === this.$("speaker").value);
    const volume = current?.configured_volume ?? 0.65;
    const percentage = Math.min(100, Math.max(5, Math.round(volume * 100)));
    this.$("volume").value = String(percentage);
    this.$("volumeText").textContent = `${percentage}%`;
    this.$("volume").style.setProperty("--progress", `${percentage}%`);
  }

  _syncSpeakerState() {
    if (!this.$ || !this.$("speaker")) return;
    const selected = this.$("speaker").value;
    const speaker = this._configuredSpeakers.find(s => s.entity_id === selected);
    const state = this._hass?.states?.[selected]?.state || speaker?.state;
    const online = !!speaker?.is_available && state !== "unavailable" && state !== "unknown";
    const meta = this.$("speakerMeta");
    const text = !selected ? "Chọn loa đã cấu hình trong Home Assistant" : !online ? "Thiết bị không khả dụng · Kiểm tra kết nối" : state === "playing" ? "Loa đang phát · Sẵn sàng nhận giọng nói" : "Loa đã kết nối · Sẵn sàng nhận giọng nói";
    const cls = !selected ? "speaker-meta" : `speaker-meta ${online ? "online" : "offline"}`;
    if (meta.className !== cls) meta.className = cls;
    if (this.$("speakerState").textContent !== text) this.$("speakerState").textContent = text;
    const inline = this.$("inlineState");
    if (inline) {
      inline.className = `speaker-availability ${selected ? (online ? "online" : "offline") : ""}`;
      this.$("inlineStateText").textContent = !selected ? "Chọn loa" : online ? "Đang online" : "Offline";
    }
    this._refreshControls();
  }

  _stopTracks() {
    if (this._stream) this._stream.getTracks().forEach((track) => track.stop());
    this._stream = null;
  }

  async _startRecording() {
    if (this._recording || this._sending || !this.$("speaker").value || this._pressed) return;
    this._pressed = true;
    this._discard = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        throw new Error("Trình duyệt hoặc WebView không hỗ trợ ghi âm. Hãy dùng HTTPS và trình duyệt hiện đại.");
      }
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
      });
      if (!this._pressed) { this._stopTracks(); return; }
      const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
      const mime = candidates.find((type) => MediaRecorder.isTypeSupported(type));
      this._recorder = new MediaRecorder(this._stream, mime ? { mimeType:mime } : {});
      this._chunks = [];
      this._recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) this._chunks.push(event.data);
      });
      this._recorder.addEventListener("stop", () => this._handleRecordingStopped(), { once:true });
      this._recorder.start(250);
      this._recording = true;
      this._started = Date.now();
      this.$("stage").classList.add("recording");
      this.$("hint").textContent = "ĐANG GHI ÂM — THẢ ĐỂ PHÁT";
      this.$("micText").innerHTML = "Đang ghi âm<br>Thả để phát";
      this._status("Đang thu âm giọng nói...", "loading");
      this._timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - this._started) / 1000);
        this.$("counter").textContent = `${seconds}s / ${this._maxSeconds}s`;
        if (seconds >= this._maxSeconds) this._stopRecording(false);
      }, 250);
      this._refreshControls();
    } catch (error) {
      this._pressed = false;
      this._stopTracks();
      this._status(`Không thể mở micro: ${error.message || error}`, "error");
    }
  }

  _stopRecording(cancel) {
    this._pressed = false;
    if (!this._recording) return;
    this._recording = false;
    this._discard = cancel;
    clearInterval(this._timer);
    this._timer = null;
    this.$("stage").classList.remove("recording");
    if (!cancel) this.$("stage").classList.add("sending");
    this.$("hint").textContent = cancel ? "Đã hủy" : "ĐANG GỬI ĐẾN LOA...";
    this.$("micText").innerHTML = cancel ? "Nhấn giữ<br>để nói" : "Đang gửi<br>âm thanh";
    if (!cancel) this._status("Đang chuyển và gửi âm thanh đến loa...", "loading");
    this._refreshControls();
    if (cancel) this._status("Đã hủy bản ghi âm.");
    if (this._recorder && this._recorder.state !== "inactive") this._recorder.stop();
    else this._stopTracks();
  }

  async _handleRecordingStopped() {
    this._stopTracks();
    if (this._discard || !this._chunks.length || !this.isConnected) {
      this._chunks = [];
      this.$("stage").classList.remove("sending");
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this.$("counter").textContent = "Thả nút để phát đến loa đã chọn";
      this._refreshControls();
      return;
    }
    const chunks = this._chunks;
    this._chunks = [];
    const blob = new Blob(chunks, { type:this._recorder?.mimeType || "audio/webm" });
    if (blob.size > this._maxBytes) {
      this._status("Bản ghi âm quá lớn. Hãy ghi ngắn hơn.", "error");
      this.$("stage").classList.remove("sending");
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      return;
    }
    this._sending = true;
    this.$("metrics").textContent = "";
    this._refreshControls();
    const speaker = this.$("speaker").value;
    let uploadId = null;
    try {
      const response = await this._hass.callWS({ type:`${DOMAIN}/upload_start`, mime_type: blob.type.split(";")[0] });
      uploadId = response.upload_id;
      // A single WebSocket preserves message order; six outstanding replies
      // avoid one round trip per 48 KiB chunk on mobile Wi-Fi.
      const chunksCount = Math.ceil(blob.size / CHUNK_BYTES);
      for (let batchStart = 0; batchStart < chunksCount; batchStart += UPLOAD_WINDOW) {
        const pending = [];
        const until = Math.min(chunksCount, batchStart + UPLOAD_WINDOW);
        for (let index = batchStart; index < until; index++) {
          const offset = index * CHUNK_BYTES;
          const part = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
          const data = btoa(String.fromCharCode(...part));
          pending.push(this._hass.callWS({ type:`${DOMAIN}/upload_chunk`, upload_id:uploadId, index, data }));
        }
        await Promise.all(pending);
        this.$("counter").textContent = `Đang gửi ${Math.round(until * 100 / chunksCount)}%`;
      }
      const result = await this._hass.callWS({
        type:`${DOMAIN}/upload_finish`, upload_id:uploadId,
        speaker, volume:Number(this.$("volume").value)/100,
      });
      if (result.performance) {
        const m = result.performance;
        this.$("metrics").textContent = `Chuyển dữ liệu: ${m.transfer_ms} ms · FFmpeg: ${m.convert_ms} ms · Lệnh HA: ${m.service_ms} ms. Thời gian loa bắt đầu phát có thể lâu hơn.`;
      }
      uploadId = null;
      this._status(`Đã gửi giọng nói đến ${this.$("speaker").selectedOptions[0]?.textContent || speaker}.`, "success");
    } catch (error) {
      this._status(`Không phát được âm thanh (${error.code || "error"}): ${error.message || error}. Xem Settings → System → Logs.`, "error");
      if (uploadId) {
        try { await this._hass.callWS({ type:`${DOMAIN}/upload_cancel`, upload_id:uploadId }); }
        catch (_) { /* It may already have expired or been consumed. */ }
      }
    } finally {
      this._sending = false;
      this.$("stage").classList.remove("sending");
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this.$("counter").textContent = "Thả nút để phát đến loa đã chọn";
      this._refreshControls();
    }
  }

  async _stopSpeaker() {
    const speaker = this.$("speaker").value;
    if (!speaker || !this._hass) return;
    this.$("stop").disabled = true;
    try {
      await this._hass.callWS({ type:`${DOMAIN}/stop`, speaker });
      this._status("Đã gửi lệnh dừng phát.", "success");
    } catch (error) {
      this._status(`Không dừng được loa: ${error.message || error}`, "error");
    } finally { this._refreshControls(); }
  }
}

if (!customElements.get("p2talk-google-cast-panel")) {
  customElements.define("p2talk-google-cast-panel", P2TalkGoogleCastPanel);
}
