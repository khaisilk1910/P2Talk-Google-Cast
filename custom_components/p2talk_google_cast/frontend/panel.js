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
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
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
`;

const waveMarkup = () => `<div class="wave" aria-hidden="true">${[16,28,43,64,34,48,27,17,12].map((n,i)=>`<span style="--h:${n}px;--delay:${(i*.11).toFixed(2)}s"></span>`).join("")}</div>`;

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
    if (this.isConnected && !this._loaded) this._loadSpeakers();
    else if (this.isConnected && this._loaded) this._syncSpeakerState();
  }
  get hass() { return this._hass; }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="wrap"><main class="surface">
        <header class="head">
          <div class="symbol">${mark}</div>
          <div class="heading"><p class="eyebrow">GIỌNG NÓI · GOOGLE CAST</p><h1>P2Talk Google Cast</h1><p class="subtitle">Nhấn giữ để nói · Thả để phát lên loa</p></div>
          <span class="lan-pill"><span class="dot"></span>LAN</span>
        </header>
        <section class="section" aria-label="Thiết bị phát">
          <div class="section-top"><label class="section-title" for="speaker">${icon("speaker")} Chọn loa Google Cast</label>
            <a class="small-link" id="configure" href="/config/integrations/integration/p2talk_google_cast" title="Cấu hình, thêm, sửa hoặc xóa loa">${icon("settings")} Quản lý loa</a></div>
          <div class="select-wrap"><span class="device-icon">${icon("speaker")}</span><select id="speaker" aria-label="Chọn loa được thêm trong cấu hình"><option value="">Đang tải loa...</option></select>${icon("chevron","select-chevron")}</div>
          <div class="speaker-meta" id="speakerMeta"><span class="state-dot"></span><span id="speakerState">Đang kiểm tra thiết bị...</span><button type="button" class="small-link" id="refresh" title="Cập nhật danh sách loa">${icon("refresh")} Làm mới</button></div>
        </section>
        <section class="section" aria-label="Âm lượng phát"><div class="section-top"><label for="volume" class="section-title">${icon("volume")} Âm lượng phát</label></div>
          <div class="volume-box">${icon("volume")}<input id="volume" type="range" min="5" max="100" value="65" aria-label="Âm lượng phát" style="--progress:65%"/><output id="volumeText" for="volume">65%</output></div>
        </section>
        <section class="stage" id="stage" aria-label="Nhấn giữ để nói">
          <div class="stage-kicker">${icon("wifi")} Kết nối nội bộ qua Home Assistant</div>
          <div class="mic-layout">${waveMarkup()}<div class="mic-orbit"><button id="mic" class="mic" type="button" disabled aria-label="Nhấn giữ để ghi âm, thả để gửi đến loa" title="Nhấn giữ để nói">${icon("mic")}<span>NHẤN GIỮ</span></button></div>${waveMarkup()}</div>
          <p id="hint" class="hint">Nhấn giữ để nói</p><div id="counter" class="counter">Thả nút để phát đến loa đã chọn</div>
        </section>
        <div class="actions"><button type="button" class="action" id="cancel" disabled>${icon("close")} Hủy ghi âm</button>
        <button type="button" class="action stop-action" id="stop" disabled>${icon("stop")} Dừng loa</button></div>
        <div id="status" class="status loading" role="status" aria-live="polite"><div id="statusIcon" class="status-symbol">${icon("refresh")}</div><span id="statusText" class="status-content">Đang kết nối Home Assistant...</span></div>
        <div id="metrics" class="metrics" aria-live="polite"></div>
        <footer class="foot"><span class="privacy">${icon("lock")} Âm thanh qua Home Assistant đã đăng nhập · Không cần token</span><span class="foot-brand">P2Talk · Google Cast</span></footer>
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
    el.className = `status ${type}`;
  }

  _refreshControls() {
    if (!this.$) return;
    const selected = !!this.$("speaker").value;
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
