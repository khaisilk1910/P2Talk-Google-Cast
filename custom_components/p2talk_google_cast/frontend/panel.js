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
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
function icon(name, className = "") {
  return `<svg class="svg-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;
}
/**
 * Diagnose the client that is actually displaying Home Assistant.
 * Client-side capture failures never reach the Home Assistant Core logs.
 * Do not log URLs, user identities, device IDs, or raw microphone samples.
 */
function microphoneEnvironment() {
  const secure = window.isSecureContext === true;
  const getUserMedia = typeof navigator.mediaDevices?.getUserMedia === "function";
  const mediaRecorder = typeof window.MediaRecorder === "function";
  let embedded = false;
  try { embedded = window.self !== window.top; }
  catch (_) { embedded = true; }
  return {
    protocol: window.location?.protocol === "https:" ? "HTTPS" : window.location?.protocol === "http:" ? "HTTP" : "other",
    secure, getUserMedia, mediaRecorder, embedded,
  };
}

/** Only HA-configured, exact P2Talk HTTPS panel URLs may be navigation targets. */
function safeHttpsPanelUrl(value) {
  if (typeof value !== "string" || !value || value.length > 320) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
        url.search || url.hash || url.pathname !== `/${DOMAIN}`) return null;
    return url.href;
  } catch (_) { return null; }
}

/** Prefer an HA-managed HTTPS origin with the same hostname to avoid
 * unnecessary cross-host navigation in Companion App WebViews. Never
 * synthesize HTTPS from an untrusted HTTP host or probe arbitrary origins. */
function selectHttpsPanelUrl(preferred, candidates) {
  const fallback = safeHttpsPanelUrl(preferred);
  const hostname = window.location?.hostname?.toLowerCase();
  if (hostname && Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const safe = safeHttpsPanelUrl(candidate);
      if (safe && new URL(safe).hostname.toLowerCase() === hostname) return safe;
    }
  }
  return fallback;
}

function microphoneAdvice(error, environment = microphoneEnvironment()) {
  const name = error?.name || "";
  if (!environment.getUserMedia && !environment.secure) {
    return {
      code: "insecure_context",
      message: "Micro bị chặn vì Home Assistant đang mở trong kết nối không an toàn.",
      action: "Mở Home Assistant bằng HTTPS với chứng chỉ hợp lệ (không dùng HTTP qua IP LAN hay .local). Sau đó tải lại trang và cấp quyền microphone.",
    };
  }
  if (!environment.getUserMedia) {
    return {
      code: "capture_api_unavailable",
      message: "Trình duyệt/WebView này không cung cấp API truy cập microphone.",
      action: "Thử cùng địa chỉ HTTPS bằng Chrome, Edge hoặc Safari mới nhất. Cập nhật Companion App/WebView; nếu ứng dụng vẫn lỗi nhưng trình duyệt chạy được, hãy dùng trình duyệt.",
    };
  }
  if (!environment.mediaRecorder) {
    return {
      code: "recorder_unavailable",
      message: "Trình duyệt/WebView không hỗ trợ MediaRecorder để ghi âm.",
      action: "Cập nhật trình duyệt hoặc Android System WebView/Companion App và thử bằng trình duyệt hiện đại có hỗ trợ MediaRecorder.",
    };
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      code: "permission_denied",
      message: "Microphone đã bị từ chối quyền truy cập.",
      action: "Cho phép Microphone cho địa chỉ Home Assistant trong trình duyệt và trong Cài đặt ứng dụng của điện thoại. Tải lại trang rồi thử lại.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "microphone_missing",
      message: "Không tìm thấy microphone trên thiết bị đang dùng.",
      action: "Kiểm tra micro, tai nghe hoặc thiết bị đầu vào của máy, rồi thử lại.",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      code: "microphone_busy",
      message: "Không thể đọc micro: có thể micro đang bị ứng dụng khác chiếm dụng.",
      action: "Đóng ứng dụng gọi điện/ghi âm khác, kiểm tra quyền của hệ điều hành, rồi mở lại Home Assistant.",
    };
  }
  if (name === "SecurityError") {
    return {
      code: "capture_blocked",
      message: "Trình duyệt chặn micro vì chính sách bảo mật của trang.",
      action: "Mở P2Talk trực tiếp trong Home Assistant qua HTTPS, không nhúng vào iframe hạn chế quyền micro.",
    };
  }
  if (name === "OverconstrainedError") {
    return {
      code: "unsupported_constraints",
      message: "Thiết bị không hỗ trợ các thông số thu âm yêu cầu.",
      action: "Thử lại bằng cấu hình thu âm cơ bản hoặc một microphone khác.",
    };
  }
  return {
    code: "capture_failed",
    message: `Không mở được microphone (${name || "unknown"}).`,
    action: "Kiểm tra HTTPS, quyền microphone và các ứng dụng đang sử dụng micro. Mở mục Chẩn đoán micro bên dưới để xem nguyên nhân.",
  };
}


const styles = `
/* Home Assistant custom panels own their narrow-screen navigation.
   Keep HA's native drawer, never make a competing sidebar or navigate the page. */
.ha-toolbar { display:none; height:56px; min-height:56px; padding:0 12px; box-sizing:border-box;
  align-items:center; gap:12px; position:relative; z-index:5;
  background:var(--app-header-background-color,var(--primary-background-color,#fff));
  color:var(--app-header-text-color,var(--primary-text-color,#222));
  border-bottom:1px solid var(--divider-color,rgba(120,130,150,.22));
  font-size:18px; font-weight:600; }
:host([data-show-panel-bar="true"]) .ha-toolbar { display:flex; }
.ha-menu-button { display:grid; place-items:center; flex:none; width:44px; height:44px; padding:0;
  border:0; background:transparent; border-radius:50%; cursor:pointer;
  color:inherit; touch-action:manipulation; }
.ha-menu-button:hover { background:color-mix(in srgb,currentColor 9%,transparent); }
.ha-menu-button:active { background:color-mix(in srgb,currentColor 16%,transparent); }
.ha-menu-button .svg-icon { width:24px; height:24px; }
.ha-menu-button:focus-visible { outline:2px solid var(--primary-color,#03a9f4); outline-offset:2px; }
.ha-toolbar-title { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
:host([data-show-panel-bar="true"]) .wrap { min-height:calc(100% - 56px); }
@media (max-width: 680px) {
  :host([data-show-panel-bar="true"]) .wrap { padding:12px 10px max(18px,env(safe-area-inset-bottom)); }
  :host([data-show-panel-bar="true"]) .surface { border-radius:23px; }
}
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
.mic-help { margin-top:12px; border:1px solid var(--pt-border); border-radius:13px; padding:12px 14px; background:var(--pt-tint); color:var(--pt-ink); font-size:12px; line-height:1.55; }
.mic-help[hidden] { display:none; }
.mic-help summary { color:var(--pt-primary); font-weight:780; cursor:pointer; }
.mic-help p { margin:7px 0; }
.mic-help a { color:var(--pt-primary); font-weight:720; }
.mic-help pre { padding:9px 11px; max-width:100%; overflow-x:auto; white-space:pre-wrap; word-break:break-word; border:1px solid var(--pt-border); border-radius:9px; color:var(--pt-muted); font:11px/1.5 ui-monospace,monospace; }
.mic-help .copy-diagnostics[hidden] { display:none; }
.mic-help .copy-diagnostics { display:inline-flex; align-items:center; text-decoration:none; margin-top:2px; border:1px solid var(--pt-border); background:var(--pt-card); color:var(--pt-ink); padding:7px 10px; border-radius:9px; cursor:pointer; font-size:12px; font-weight:730; }


/* 2026 Aurora Refresh: speaker-first identity, contiguous hero/body, reactive effects.
   Decorative effects are CSS only; no timers, remote assets, third-party libraries.
   Static idle state avoids continuous paints, especially in mobile WebViews. */
:host {
  --aurora-ice:#7ceafa; --aurora-blue:#258ffc; --aurora-purple:#997cff;
  --aurora-border:rgba(128,193,255,.35);
}
.surface {
  background:linear-gradient(145deg,#16396b 0%,#142a4e 58%,#13213f 100%);
  border-color:rgba(106,175,249,.48);
  box-shadow:0 18px 56px rgba(8,40,89,.22),0 0 0 1px rgba(123,190,255,.08) inset;
}
/* The colored panel below the header is visually part of the same aurora canvas. */
.head {
  background:linear-gradient(120deg,#153f7d 0%,#1b5ba7 52%,#15366d 100%);
  border:0;
}
.hero-glow {
  opacity:1;
  background:radial-gradient(ellipse at 15% 5%,rgba(166,226,255,.42),transparent 48%),
             radial-gradient(ellipse at 84% 85%,rgba(106,58,247,.33),transparent 52%),
             radial-gradient(ellipse at 58% 106%,rgba(37,198,255,.40),transparent 48%);
}
.hero-waves { opacity:.55; filter:drop-shadow(0 -2px 5px rgba(65,189,255,.35)); }
.head .symbol {
  position:relative; border-radius:28px; border:1px solid rgba(180,232,255,.8);
  background:linear-gradient(145deg,rgba(39,125,235,.82),rgba(17,46,124,.83));
  box-shadow:0 0 0 5px rgba(140,206,255,.11),0 12px 25px rgba(3,29,91,.4),inset 0 1px 8px rgba(208,243,255,.24);
  overflow:visible;
}
.head .symbol::before { content:""; position:absolute; inset:-6px; border:1px solid rgba(147,220,255,.24); border-radius:32px; pointer-events:none; }
.mark-speaker { width:100%; height:100%; object-fit:contain; transform:scale(1.32) translateY(2px); filter:drop-shadow(0 7px 9px rgba(0,14,68,.43)); }
.mark-cast { position:absolute; bottom:-6px; right:-7px; width:30px; height:30px; display:grid; place-items:center;
  background:linear-gradient(130deg,#0d82f5,#7759ef); color:#fff; border:1px solid rgba(183,235,255,.8);
  border-radius:10px; box-shadow:0 4px 14px rgba(1,24,75,.43); }
.mark-cast .svg-icon { width:19px; height:19px; }
.hero-speaker { width:185px; right:7px; bottom:-8px; opacity:.87; filter:drop-shadow(0 13px 13px rgba(1,20,63,.5)); }
.heading h1 { color:#f6faff; text-shadow:0 2px 8px rgba(1,25,78,.28); }
.heading h1 em { color:#99e6ff; text-shadow:0 0 16px rgba(52,181,255,.35); }
.heading .subtitle { color:#def3ff; }
.panel-body {
  z-index:1;
  background:
    radial-gradient(ellipse 115% 44% at 48% 34%,rgba(25,121,233,.21),transparent 64%),
    radial-gradient(ellipse 85% 52% at 108% 82%,rgba(117,72,206,.18),transparent 67%),
    radial-gradient(ellipse 70% 32% at -10% 8%,rgba(54,210,255,.14),transparent 68%),
    linear-gradient(180deg,#173d70 0%,#172b50 19%,#17233f 58%,#131d36 100%);
  box-shadow:0 -2px 0 rgba(145,213,255,.20),inset 0 13px 25px rgba(35,149,249,.06);
  color:#ebf6ff;
}
.panel-body::before { content:""; position:absolute; inset:0 10px auto; height:1px;
  background:linear-gradient(90deg,transparent,rgba(124,237,255,.55),transparent); pointer-events:none; }
.section-title { color:#f0f8ff; font-weight:790; text-shadow:0 1px 4px rgba(0,21,71,.15); }
.section-title .svg-icon { color:#69d7ff; fill:rgba(88,174,255,.18); }
.refresh-icon { color:#80d5ff; border-radius:12px; }
.refresh-icon:hover { color:#fff; background:rgba(73,158,255,.14); }
.configure-link { color:#bceaff; border-color:rgba(99,193,255,.62); background:linear-gradient(140deg,rgba(41,130,225,.26),rgba(90,70,193,.19)); box-shadow:inset 0 1px 0 rgba(229,248,255,.13); }
.configure-link:hover { background:rgba(70,149,251,.35); color:#fff; }
.select-wrap,.volume-box {
  background:linear-gradient(112deg,rgba(18,43,77,.9),rgba(26,44,79,.74));
  border:1px solid rgba(117,179,235,.38);
  box-shadow:0 7px 17px rgba(3,17,52,.19),inset 0 1px 0 rgba(181,226,255,.08);
  transition:border-color .22s,box-shadow .22s,transform .18s;
}
.select-wrap:hover,.volume-box:hover { border-color:rgba(128,224,255,.75); box-shadow:0 8px 21px rgba(1,21,73,.25),0 0 0 2px rgba(78,176,252,.07); }
.select-wrap select { color:#f4f9ff; }
.select-wrap select option { color:var(--pt-ink); background:var(--pt-card); }
.select-chevron { color:#b5d9f8; }
.select-wrap .device-icon { background:radial-gradient(ellipse,rgba(79,159,236,.23),rgba(18,42,80,.55)); }
.speaker-availability { color:#bcd1e8; }
.speaker-meta { color:#b7cde5; }
.volume-box .svg-icon,.volume-box .volume-max { color:#82d5ff; }
.volume-box input { background:linear-gradient(90deg,#00c4fa 0%,#148cf8 var(--progress,65%),rgba(154,179,221,.44) var(--progress,65%),rgba(154,179,221,.44) 100%); }
.volume-box input::-webkit-slider-thumb { box-shadow:0 0 0 4px rgba(38,192,255,.2),0 0 16px rgba(31,159,255,.48); }
.volume-box output { color:#e4f6ff; background:linear-gradient(135deg,rgba(21,124,227,.48),rgba(109,89,228,.35)); border:1px solid rgba(91,166,255,.28); }
.stage { background:radial-gradient(ellipse at 50% 49%,rgba(28,163,255,.23),transparent 66%); }
.stage::before { background:radial-gradient(ellipse at 50% 50%,rgba(33,161,255,.27),transparent 67%); }
.mic-orbit::before { border-color:rgba(118,241,255,.74); box-shadow:0 0 24px rgba(46,214,255,.23),inset 0 0 17px rgba(87,196,255,.13); }
.mic-orbit::after { border-color:rgba(155,138,255,.47); }
.mic {
  background:radial-gradient(circle at 35% 14%,#23ddfb 0%,#148ef9 36%,#075de7 75%,#633fe2 100%);
  box-shadow:0 13px 33px rgba(0,69,222,.40),0 0 28px rgba(70,202,255,.46),
             inset 0 4px 7px rgba(255,255,255,.4),inset 0 -11px 25px rgba(23,35,156,.24);
}
.mic:hover:not(:disabled) { box-shadow:0 17px 39px rgba(0,75,233,.46),0 0 38px rgba(66,206,255,.64); }
.stage.recording .mic-orbit::before { border-color:rgba(255,161,157,.92); box-shadow:0 0 35px rgba(255,79,94,.39); }
.stage.recording .mic { box-shadow:0 15px 38px rgba(236,57,106,.44),0 0 28px rgba(251,114,111,.43); }
.stage.sending .mic-orbit::before { border-color:#8cd0ff; }
.wave span { box-shadow:0 0 10px rgba(54,188,255,.4); }
/* Buttons remain clearly legible in their disabled state; visual hierarchy remains obvious. */
.actions { gap:14px; }
.action { min-height:52px; border-radius:17px; font-size:14px; font-weight:820; letter-spacing:.08px;
  transition:transform .18s ease,box-shadow .18s ease,filter .18s ease,background .18s ease; }
.action.cancel-action {
  color:#ffdce3; border:1px solid rgba(255,132,152,.48);
  background:linear-gradient(115deg,rgba(109,38,74,.74),rgba(79,37,68,.83));
  box-shadow:inset 0 1px 0 rgba(255,220,229,.13),0 5px 14px rgba(24,12,44,.16);
}
.action.cancel-action .svg-icon { color:#ff9aa9; }
.action.cancel-action:hover:not(:disabled) { background:linear-gradient(110deg,#a43a67,#c04873); color:white; box-shadow:0 7px 22px rgba(194,71,104,.25); }
.action.stop-action {
  color:#fff; border:1px solid #7bd9ff;
  background:linear-gradient(110deg,#087ced 0%,#2389fb 47%,#705dec 100%);
  box-shadow:0 5px 20px rgba(28,101,239,.34),inset 0 1px 0 rgba(255,255,255,.38);
}
.action.stop-action:hover:not(:disabled) { background:linear-gradient(115deg,#1899ff,#6056f7); box-shadow:0 9px 27px rgba(31,140,255,.48),0 0 13px rgba(114,112,255,.21); }
.action.stop-action .svg-icon { fill:rgba(255,255,255,.92); stroke:rgba(255,255,255,.92); }
.action:active:not(:disabled) { transform:translateY(1px) scale(.985); }
.action:disabled { opacity:.58; filter:saturate(.64); box-shadow:none; }
.action.stop-action:disabled { opacity:.88; filter:saturate(.8); }
.status { box-shadow:0 7px 17px rgba(3,22,53,.18),inset 0 1px 0 rgba(255,255,255,.10); }
.status.success { background:linear-gradient(110deg,#145a59,#206b63 63%,#265b6b); border-color:rgba(88,220,187,.6); }
.status.success .status-content { color:#e4fff5; }
.status.success small { color:#b5e9d9; }
.status.loading { background:linear-gradient(110deg,#183f70,#26547b); border-color:rgba(89,170,242,.62); }
.status.loading .status-content { color:#edf7ff; }
.status.loading small { color:#bddcf3; }
.status.error { background:linear-gradient(110deg,#632744,#422a53); border-color:rgba(243,121,156,.59); }
.status.error .status-content { color:#fff0f4; }
.status.error small { color:#ffc3d6; }
.status-equalizer i { background:#47deb5; }
.foot { color:#a9bdd9; }
.foot .svg-icon { color:#55ddac; }
.mic-help { background:linear-gradient(120deg,rgba(17,47,80,.89),rgba(29,37,67,.91)); border-color:rgba(125,185,244,.31); color:#d9eaff; }
.mic-help pre { color:#c7d5e9; }
.metrics { background:rgba(16,49,87,.56); color:#bfdaef; border:1px solid rgba(116,183,240,.18); }
/* Light HA themes: keep aurora palette while adjusting panel/control contrast. */
:host([data-dark="false"]) .surface { box-shadow:0 19px 54px rgba(26,77,142,.17); }
:host([data-dark="false"]) .head { background:linear-gradient(115deg,#2566ac,#327fc8 55%,#184887); }
:host([data-dark="false"]) .panel-body {
  background:radial-gradient(ellipse 95% 51% at 44% 41%,rgba(91,166,255,.23),transparent 67%),
             radial-gradient(ellipse 68% 46% at 105% 78%,rgba(146,122,245,.18),transparent 70%),
             linear-gradient(180deg,#c3dfff 0%,#daeafa 23%,#e8eeff 63%,#e4ebf7 100%);
  color:#19375f;
}
:host([data-dark="false"]) .section-title { color:#1e416b; text-shadow:none; }
:host([data-dark="false"]) .section-title .svg-icon { color:#1578dd; }
:host([data-dark="false"]) .select-wrap,:host([data-dark="false"]) .volume-box {
  background:linear-gradient(110deg,rgba(255,255,255,.83),rgba(237,247,255,.74));
  border-color:rgba(93,148,204,.40); box-shadow:0 7px 18px rgba(64,125,186,.12),inset 0 1px 0 white;
}
:host([data-dark="false"]) .select-wrap select { color:#203b63; }
:host([data-dark="false"]) .speaker-availability,:host([data-dark="false"]) .speaker-meta { color:#567393; }
:host([data-dark="false"]) .volume-box .svg-icon { color:#2787da; }
:host([data-dark="false"]) .volume-box output { background:linear-gradient(125deg,#b8dbff,#d6eaff); color:#0c57a7; }
:host([data-dark="false"]) .configure-link { color:#175aa0; border-color:#6bb4ee; background:rgba(234,248,255,.74); }
:host([data-dark="false"]) .action.cancel-action { color:#8c3d55; background:linear-gradient(115deg,#ffe4eb,#f7d9e5); border-color:#eb9fb2; }
:host([data-dark="false"]) .action.cancel-action .svg-icon { color:#bc4e6c; }
:host([data-dark="false"]) .action.cancel-action:hover:not(:disabled) { background:#f3c1d1; color:#8b183b; }
:host([data-dark="false"]) .status.success { background:linear-gradient(105deg,#c4f5e4,#b8e7e9); border-color:#81d4bb; }
:host([data-dark="false"]) .status.success .status-content { color:#17654e; }
:host([data-dark="false"]) .status.success small { color:#376e61; }
:host([data-dark="false"]) .status.loading { background:linear-gradient(110deg,#d4eaff,#c7effc); border-color:#9ed2f9; }
:host([data-dark="false"]) .status.loading .status-content { color:#1a557e; }
:host([data-dark="false"]) .status.loading small { color:#456f90; }
:host([data-dark="false"]) .status.error { background:linear-gradient(105deg,#ffdae3,#f9e6f4); border-color:#eda9c0; }
:host([data-dark="false"]) .status.error .status-content { color:#8a2e4c; }
:host([data-dark="false"]) .status.error small { color:#9b4c65; }
:host([data-dark="false"]) .foot { color:#527395; }
:host([data-dark="false"]) .mic-help { background:rgba(242,249,255,.93); color:#254363; }
:host([data-dark="false"]) .mic-help pre { color:#4e6c89; }
:host([data-dark="false"]) .metrics { background:rgba(238,247,255,.88); color:#567393; }
/* Keep the same dark finish if a legacy HA theme reports darkMode=true. */
:host([data-dark="true"]) .head { background:linear-gradient(120deg,#153d76,#1c5596 52%,#102b60); }
:host([data-dark="true"]) .panel-body {
  background:radial-gradient(ellipse 115% 44% at 48% 34%,rgba(25,121,233,.21),transparent 64%),
    radial-gradient(ellipse 85% 52% at 108% 82%,rgba(117,72,206,.18),transparent 67%),
    linear-gradient(180deg,#173c70 0%,#172b50 19%,#17233f 58%,#131d36 100%);
}
:host([data-dark="true"]) .select-wrap,:host([data-dark="true"]) .volume-box { background:linear-gradient(112deg,rgba(18,43,77,.9),rgba(26,44,79,.74)); }
:host([data-dark="true"]) .status.success { background:linear-gradient(110deg,#145a59,#206b63 63%,#265b6b); border-color:rgba(88,220,187,.6); }
:host([data-dark="true"]) .status.success .status-content { color:#e4fff5; }
:host([data-dark="true"]) .status.success small { color:#b5e9d9; }
:host([data-dark="true"]) .status.loading { background:linear-gradient(110deg,#183f70,#26547b); }
:host([data-dark="true"]) .status.loading .status-content { color:#edf7ff; }
:host([data-dark="true"]) .status.loading small { color:#bddcf3; }
:host([data-dark="true"]) .status.error { background:linear-gradient(110deg,#632744,#422a53); }
:host([data-dark="true"]) .status.error .status-content { color:#fff0f4; }
:host([data-dark="true"]) .status.error small { color:#ffc3d6; }
@media (max-width:620px) {
 .head .symbol { border-radius:24px; }
 .head .symbol::before { border-radius:28px; }
 .hero-speaker { width:165px; right:-15px; }
 .mark-cast { width:25px; height:25px; bottom:-5px; right:-4px; }
 .mark-cast .svg-icon { width:16px; height:16px; }
 .actions { gap:10px; }
}
@media (max-width:430px) {
 .head .symbol { border-radius:19px; }
 .head .symbol::before { border-radius:23px; }
 .hero-speaker { width:119px; right:-28px; }
 .action { min-height:46px; border-radius:13px; font-size:12px; }
}
/* Brief feedback motion when an action finishes; recording effects are state-driven. */
@keyframes aurora-status-in { from { opacity:.73; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
.status.success,.status.error { animation:aurora-status-in .32s ease-out both; }
.stage.recording .mic { animation:aurora-record-glow 1.25s ease-in-out infinite alternate; }
@keyframes aurora-record-glow { from { box-shadow:0 13px 33px rgba(225,43,106,.42),0 0 18px rgba(246,95,107,.35); } to { box-shadow:0 15px 39px rgba(225,43,106,.54),0 0 35px rgba(250,120,119,.67); } }
@media (prefers-reduced-motion:reduce) { .status.success,.status.error,.stage.recording .mic { animation:none!important; } }
/* No idle animation. Recording and sending effects remain state-driven. */
@media (prefers-reduced-motion:reduce) { .action,.select-wrap,.volume-box,.mic { transition:none!important; } }

`;

const waveMarkup = () => `<div class="wave" aria-hidden="true">${[14,27,44,67,35,57,84,48,62,37,75,102,65,46,58,31,18].map((n,i)=>`<span style="--h:${n}px;--delay:${(i*.07).toFixed(2)}s"></span>`).join("")}</div>`;

class P2TalkGoogleCastPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._narrow = false;
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
    this._haHttpsConfigured = false;
    this._micHttpsState = "unknown";
    this._timer = null;
    this._started = 0;
  }

  set hass(hass) {
    this._hass = hass;
    if (typeof hass?.themes?.darkMode === "boolean") {
      this.setAttribute("data-dark", hass.themes.darkMode ? "true" : "false");
    }
    this._syncNativeNavigation();
    if (this.isConnected && !this._loaded) this._loadSpeakers();
    else if (this.isConnected && this._loaded) this._syncSpeakerState();
  }
  get hass() { return this._hass; }

  // HA delivers this value whenever its responsive navigation mode changes.
  set narrow(value) {
    this._narrow = Boolean(value);
    this._syncNativeNavigation();
  }
  get narrow() { return this._narrow; }

  _syncNativeNavigation() {
    // Respect Home Assistant's own drawer state. On wide screens with a docked
    // sidebar, the existing HA sidebar stays visible; do not draw a second one.
    const showBar = this._narrow || this._hass?.dockedSidebar === "always_hidden";
    if (showBar && !this.hasAttribute("data-show-panel-bar")) this.setAttribute("data-show-panel-bar", "true");
    else if (!showBar && this.hasAttribute("data-show-panel-bar")) this.removeAttribute("data-show-panel-bar");
  }

  _toggleNativeSidebar() {
    // Home Assistant handles the drawer, its close behavior and navigation.
    // No hardcoded DOM selectors, location changes or page reloads.
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <nav class="ha-toolbar" aria-label="Điều hướng Home Assistant">
        <button id="haMenuButton" type="button" class="ha-menu-button" title="Mở menu Home Assistant" aria-label="Mở menu Home Assistant">${icon("menu")}</button>
        <span class="ha-toolbar-title">P2Talk Google Cast</span>
      </nav>
      <div class="wrap"><main class="surface">
        <header class="head">
          <div class="hero-glow" aria-hidden="true"></div>
          <svg class="hero-waves" viewBox="0 0 680 170" preserveAspectRatio="none" aria-hidden="true"><path d="M0 110C116 190 214 92 333 139S522 104 680 149V170H0Z" fill="#e8f6ff" opacity=".37"/><path d="M0 128C158 200 237 103 364 154S554 83 680 132V170H0Z" fill="#38baf5" opacity=".27"/><path d="M0 155C158 112 234 163 327 143S531 179 680 118V170H0Z" fill="#0797ea" opacity=".36"/></svg>
          <img class="hero-speaker" src="/${DOMAIN}_assets/home-speaker-2026.webp" alt="" aria-hidden="true" loading="eager" decoding="async" />
          <div class="symbol" aria-hidden="true"><img class="mark-speaker" src="/${DOMAIN}_assets/home-speaker-2026.webp" alt="" decoding="async"/><span class="mark-cast">${icon("cast")}</span></div>
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
          <div class="stage-kicker">${icon("wifi")} Kết nối qua Home Assistant</div>
          <div class="mic-layout">${waveMarkup()}<div class="mic-orbit"><button id="mic" class="mic" type="button" disabled aria-label="Nhấn giữ để ghi âm, thả để gửi đến loa" title="Nhấn giữ để nói">${icon("mic")}<span id="micText">Nhấn giữ<br/>để nói</span></button></div>${waveMarkup()}</div>
          <p id="hint" class="hint">Nhấn giữ để nói</p><div id="counter" class="counter">Thả nút để phát đến loa đã chọn</div>
        </section>
        <div class="actions"><button type="button" class="action cancel-action" id="cancel" disabled>${icon("close")} Hủy</button>
        <button type="button" class="action stop-action" id="stop" disabled>${icon("stop")} Dừng loa</button></div>
        <div id="status" class="status loading" role="status" aria-live="polite"><div id="statusIcon" class="status-symbol">${icon("refresh")}</div><div class="status-copy"><strong id="statusText" class="status-content">Đang kết nối Home Assistant...</strong><small id="statusNote">Đang kiểm tra quyền truy cập và thiết bị.</small></div><span class="status-equalizer" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></div>
        <details id="micHelp" class="mic-help" hidden><summary>Chẩn đoán micro & cách khắc phục</summary>
          <p id="micAction"></p><pre id="micDetails"></pre>
          <button id="micCopy" type="button" class="copy-diagnostics">Sao chép chẩn đoán</button>
          <p><a href="https://www.home-assistant.io/docs/configuration/remote/" target="_blank" rel="noopener noreferrer">Hướng dẫn HTTPS/Home Assistant</a></p>
          <p>Lỗi ghi âm xảy ra ở thiết bị đang mở giao diện; nó có thể không xuất hiện trong log Home Assistant Core.</p>
        </details>
        <div id="metrics" class="metrics" aria-live="polite"></div>
        <footer class="foot"><span class="privacy">${icon("lock")} Âm thanh qua phiên Home Assistant đã đăng nhập · Không cần token</span><span class="foot-brand">P2Talk · Google Cast</span></footer>
        </div>
      </main></div>`;
    this.$ = (id) => this.shadowRoot.getElementById(id);
    this.$("haMenuButton").addEventListener("click", () => this._toggleNativeSidebar());
    this._syncNativeNavigation();
    this.$("refresh").addEventListener("click", () => this._loadSpeakers());
    this.$("micCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.$("micDetails").textContent);
        this.$("micCopy").textContent = "Đã sao chép";
      } catch (_) {
        this.$("micCopy").textContent = "Hãy chọn và sao chép phần chẩn đoán";
      }
    });
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

  _status(message, type = "", note = null) {
    const el = this.$("status");
    if (!el) return;
    this.$("statusText").textContent = message;
    this.$("statusIcon").innerHTML = icon(type === "success" ? "check" : type === "error" ? "alert" : type === "loading" ? "refresh" : "info");
    const secondary = this.$("statusNote");
    secondary.textContent = note ?? (type === "success" ? "Âm thanh được gửi qua phiên Home Assistant đã đăng nhập." : type === "error" ? "Kiểm tra kết nối thiết bị và Settings → System → Logs." : type === "loading" ? "Đang xử lý yêu cầu của bạn..." : "Chọn loa và nhấn giữ nút micro để nói.");
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

  /**
   * Redirect the whole HA shell once when this panel is opened on insecure HTTP.
   * A secure iframe/background fetch cannot grant an HTTP document microphone access.
   * This runs ONLY on P2Talk panel load, reusing the authenticated speakers response.
   */
  _autoRedirectToHttps(panelUrl, candidates = []) {
    // Redirect only when HTTP cannot provide microphone access. Localhost
    // may be a trusted HTTP context and should not be redirected unnecessarily.
    const microphoneAvailable = window.isSecureContext === true &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    if (window.location?.protocol !== "http:" || microphoneAvailable || !panelUrl) return false;
    const target = selectHttpsPanelUrl(panelUrl, candidates);
    if (!target) {
      this._status("URL HTTPS trong Home Assistant không hợp lệ.", "error",
        "Kiểm tra Settings → System → Network → Home Assistant URL. Chỉ dùng địa chỉ HTTPS hợp lệ.");
      return true;
    }
    // Session guard also catches a misconfigured reverse proxy that returns to
    // HTTP after a previous redirect. No redirect on other dashboards or startup.
    const guard = `${STORAGE_PREFIX}https_redirect_attempt`;
    try {
      const previous = Number(sessionStorage.getItem(guard) || 0);
      if (previous > 0 && Date.now() - previous >= 0 && Date.now() - previous < 120000) {
        this._status("Chuyển sang HTTPS chưa thành công: Home Assistant vẫn mở qua HTTP.", "error",
          "Kiểm tra HTTPS, Cloudflare Tunnel hoặc reverse proxy và URL tại Settings → System → Network. P2Talk đã dừng chuyển hướng để tránh vòng lặp tải trang.");
        return true;
      }
      sessionStorage.setItem(guard, String(Date.now()));
    } catch (_) {
      // Without a persistent guard, an HTTP <-> HTTPS proxy loop is unsafe.
      this._status("Không thể tự chuyển sang HTTPS an toàn.", "error",
        "Trình duyệt chặn lưu phiên dùng để chống tải trang lặp. Hãy mở Home Assistant trực tiếp bằng tên miền HTTPS đã cấu hình.");
      return true;
    }
    this._status("Đang chuyển P2Talk sang HTTPS của Home Assistant...", "loading",
      "Home Assistant sẽ được tải lại một lần tại địa chỉ HTTPS để cho phép dùng micro.");
    try {
      window.location.replace(target);
    } catch (_) {
      try { sessionStorage.removeItem(guard); } catch (_) { /* ignore */ }
      this._status("Trình duyệt không cho chuyển sang HTTPS.", "error",
        "Kiểm tra HTTPS Home Assistant tại Settings → System → Network và quyền điều hướng của ứng dụng.");
    }
    return true;
  }

  async _loadSpeakers(silent = false) {
    if (!this._hass || this._loadingSpeakers || !this.isConnected) return;
    this._loadingSpeakers = true;
    if (!silent) this._status("Đang đọc thiết bị từ Home Assistant...", "loading");
    try {
      const response = await this._hass.callWS({ type: `${DOMAIN}/speakers` });
      this._maxSeconds = response.max_seconds || 120;
      this._maxBytes = response.max_bytes || this._maxBytes;
      this._haHttpsConfigured = response.mic_https_configured === true;
      this._micHttpsState = response.mic_https_state || "missing";
      // An insecure HA page cannot capture microphone input. Navigate this
      // panel to HA's configured HTTPS URL immediately, not on first mic press.
      // No extra WS calls, preload tasks or navigation from other dashboards.
      this._loaded = true;
      if (this._autoRedirectToHttps(response.mic_https_panel_url, response.mic_https_candidates)) return;
      const insecure = !window.isSecureContext;
      const microphoneHelp = this.$("micHelp");
      microphoneHelp.hidden = !insecure;
      microphoneHelp.open = insecure;
      if (insecure) this.$("micAction").textContent = this._haHttpsConfigured
        ? "Không thể sử dụng micro qua HTTP. P2Talk chỉ tự chuyển khi Home Assistant có URL HTTPS hợp lệ và trình duyệt cho phép điều hướng an toàn."
        : "Home Assistant chưa có URL HTTPS được khai báo. Vào Settings → System → Network → Home Assistant URL → Internet và lưu tên miền HTTPS hợp lệ.";
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
        if (insecure) {
          this._status(this._haHttpsConfigured
            ? "Micro bị chặn: Home Assistant đang mở bằng HTTP."
            : "Chưa cấu hình URL HTTPS cho Home Assistant; micro bị chặn trên HTTP.",
          "error", this.$("micAction").textContent);
        } else this._status(available ? "Sẵn sàng. Nhấn giữ micro để nói." :
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

  async _showMicrophoneFailure(error) {
    const environment = microphoneEnvironment();
    const advice = microphoneAdvice(error, environment);
    const help = this.$("micHelp");
    help.hidden = false;
    help.open = true;
    const missingHttps = advice.code === "insecure_context" && !this._haHttpsConfigured;
    this.$("micAction").textContent = advice.code === "insecure_context"
      ? (missingHttps
        ? "Home Assistant chưa khai báo URL HTTPS. Vào Settings → System → Network → Home Assistant URL → Internet để cấu hình. Sau đó mở Home Assistant bằng chính URL HTTPS này."
        : "Home Assistant đang mở qua HTTP. P2Talk sẽ tự chuyển sang HTTPS khi mở panel; nếu không chuyển được, hãy kiểm tra HTTPS/Cloudflare Tunnel và thử tải lại panel sau khi sửa cấu hình.")
      : advice.action;
    this.$("micCopy").textContent = "Sao chép chẩn đoán";
    let permission = "not available";
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: "microphone" });
        permission = status.state || "unknown";
      }
    } catch (_) { /* Safari/WebViews may not expose microphone permission query. */ }
    const report = [
      `P2Talk microphone: ${advice.code}`,
      `Protocol: ${environment.protocol}`,
      `Secure context: ${environment.secure}`,
      `getUserMedia: ${environment.getUserMedia}`,
      `MediaRecorder: ${environment.mediaRecorder}`,
      `Embedded frame: ${environment.embedded}`,
      `Mic permission: ${permission}`,
      `Home Assistant HTTPS URL configured: ${this._haHttpsConfigured}`,
      `HTTPS URL source: ${this._micHttpsState}`,
      `Error type: ${error?.name || "none"}`,
    ].join("\n");
    this.$("micDetails").textContent = report;
    // Client-side errors never reach HA Core logs. No recorded sound or URLs logged.
    console.warn("[P2Talk][microphone]", report);
    this._status(missingHttps
      ? "Home Assistant chưa cấu hình URL HTTPS cho microphone."
      : advice.message, "error", this.$("micAction").textContent);
  }

  _stopTracks() {
    if (this._stream) this._stream.getTracks().forEach((track) => track.stop());
    this._stream = null;
  }

  async _startRecording() {
    if (this._recording || this._sending || !this.$("speaker").value || this._pressed) return;
    // Microphone permission is granted only to the current secure document;
    // HTTP-to-HTTPS routing is handled on panel load, never by opening a tab.
    if (!window.isSecureContext) {
      await this._showMicrophoneFailure(new Error("insecure_context"));
      return;
    }
    this._pressed = true;
    this._discard = false;
    try {
      if (typeof navigator.mediaDevices?.getUserMedia !== "function" || typeof window.MediaRecorder !== "function") {
        throw new Error("microphone_api_unavailable");
      }
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
      });
      if (!this._pressed) { this._stopTracks(); return; }
      const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];
      const mime = candidates.find((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
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
      this.$("micHelp").hidden = true;
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
      await this._showMicrophoneFailure(error);
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
