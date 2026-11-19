/**
 * P2Talk Google Cast — two isolated, lazy Home Assistant Lovelace cards.
 * Home Assistant supplies the authenticated `hass.callWS` API; these cards
 * never stores credentials, makes direct Supervisor requests or opens ports.
 */

const DOMAIN = "p2talk_google_cast";
const DEFAULT_TTS_ENTITY = "tts.wyoming_vietnamese";
const CHUNK_BYTES = 48 * 1024;
const UPLOAD_WINDOW = 6; // amortize Wi-Fi/WebSocket RTT while keeping ordering
const MAX_TARGET_SPEAKERS = 32;
const STORAGE_PREFIX = "p2talk_google_cast_";
const COLOR_THEMES = ["ha", "aurora", "ocean", "sunset", "emerald", "graphite"];
function readSpeakerPreferences(key) {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
    }
    // Upgrade a stored single-speaker selection from earlier versions.
    return [];
  } catch (_) { return []; } // Embedded WebViews may block storage.
}
function saveSpeakerPreferences(key, ids) {
  try { localStorage.setItem(key, JSON.stringify(ids)); }
  catch (_) { /* Selection still works without persistence. */ }
}

// Inline, dependency-free SVG icons. No external fonts, icon CDN or runtime package.
const glyphs = {
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
  cast: '<path d="M3 15a6 6 0 0 1 6 6M3 10a11 11 0 0 1 11 11M3 21h.01M9 3h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/>',
  speaker: '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="7.5" r=".65" fill="currentColor" stroke="none"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
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

function microphoneAdvice(error, environment = microphoneEnvironment()) {
  const name = error?.name || "";
  if (environment.protocol === "HTTP" || !environment.secure) {
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
/* P2Talk: compact, theme-aware Lovelace card. Scoped to the shadow root. */
:host {
  display:block; min-width:0; color:var(--primary-text-color,#e7edf8);
  font-family:var(--ha-font-family-body,var(--paper-font-body1_-_font-family,system-ui,-apple-system,"Segoe UI",sans-serif));
  --pt-bg:var(--ha-card-background,var(--card-background-color,#1b2940));
  --pt-ink:var(--primary-text-color,#e7edf8);
  --pt-muted:var(--secondary-text-color,#9caec4);
  --pt-border:var(--divider-color,rgba(152,183,216,.2));
  --pt-primary:var(--primary-color,#56a8fc);
  --pt-accent:var(--accent-color,#7398ff);
  --pt-on-primary:var(--text-primary-color,#fff);
  --pt-head-from:color-mix(in srgb,var(--pt-bg) 81%,var(--pt-primary) 19%);
  --pt-head-to:var(--pt-bg);
  --pt-mic-from:#1665bb; --pt-mic-to:#174580; --pt-mic-text:#fff;
  --pt-glow:var(--pt-primary);
  --pt-soft:color-mix(in srgb,var(--pt-bg) 92%,var(--pt-primary) 8%);
  --pt-soft-2:color-mix(in srgb,var(--pt-bg) 83%,var(--pt-primary) 17%);
}

/* Five integrated multimedia presets. All colors scoped to the P2Talk card only.
   Each preset follows Home Assistant darkMode but does not recolor other cards. */
:host([data-color-theme="aurora"][data-dark="true"]) { --pt-bg:#11182b; --pt-ink:#f5f6ff; --pt-muted:#c0c9e1; --pt-border:#49547c; --pt-primary:#c0b2ff; --pt-accent:#71d7f0; --pt-on-primary:#191433; --pt-head-from:#22244e; --pt-head-to:#192f4b; --pt-mic-from:#6445a8; --pt-mic-to:#43337a; --pt-glow:#7175e8; }
:host([data-color-theme="aurora"][data-dark="false"]) { --pt-bg:#f7f5ff; --pt-ink:#201c3a; --pt-muted:#524b75; --pt-border:#cfc9e3; --pt-primary:#5540ae; --pt-accent:#156e86; --pt-on-primary:#ffffff; --pt-head-from:#e5dcff; --pt-head-to:#e9f5ff; --pt-mic-from:#6044a5; --pt-mic-to:#3c2d77; --pt-glow:#9c83ee; }
:host([data-color-theme="ocean"][data-dark="true"]) { --pt-bg:#091c30; --pt-ink:#effaff; --pt-muted:#b6d5e5; --pt-border:#335673; --pt-primary:#6adbf4; --pt-accent:#81baff; --pt-on-primary:#052739; --pt-head-from:#113b67; --pt-head-to:#09304c; --pt-mic-from:#096aa8; --pt-mic-to:#0a396b; --pt-glow:#16b9ea; }
:host([data-color-theme="ocean"][data-dark="false"]) { --pt-bg:#f0faff; --pt-ink:#0c2c47; --pt-muted:#315a74; --pt-border:#bdd6e5; --pt-primary:#00659d; --pt-accent:#007c84; --pt-on-primary:#ffffff; --pt-head-from:#d7efff; --pt-head-to:#dbfbfa; --pt-mic-from:#086ca5; --pt-mic-to:#0b3e70; --pt-glow:#34acd9; }
:host([data-color-theme="sunset"][data-dark="true"]) { --pt-bg:#281821; --pt-ink:#fff4f0; --pt-muted:#e7c5cc; --pt-border:#744551; --pt-primary:#ffc199; --pt-accent:#ff9cb7; --pt-on-primary:#3c1b1e; --pt-head-from:#673047; --pt-head-to:#482938; --pt-mic-from:#ad3556; --pt-mic-to:#682950; --pt-glow:#f56b85; }
:host([data-color-theme="sunset"][data-dark="false"]) { --pt-bg:#fff6f1; --pt-ink:#43241e; --pt-muted:#785149; --pt-border:#e9c7bc; --pt-primary:#a7343f; --pt-accent:#8e466b; --pt-on-primary:#ffffff; --pt-head-from:#ffe2d6; --pt-head-to:#fce6ed; --pt-mic-from:#b03552; --pt-mic-to:#722b52; --pt-glow:#f39b83; }
:host([data-color-theme="emerald"][data-dark="true"]) { --pt-bg:#0b211e; --pt-ink:#effdf5; --pt-muted:#b7dccf; --pt-border:#386357; --pt-primary:#72eabe; --pt-accent:#76dce1; --pt-on-primary:#093d30; --pt-head-from:#164a41; --pt-head-to:#143333; --pt-mic-from:#0a7965; --pt-mic-to:#095347; --pt-glow:#51cfa5; }
:host([data-color-theme="emerald"][data-dark="false"]) { --pt-bg:#f0fcf5; --pt-ink:#143b2f; --pt-muted:#456b59; --pt-border:#c0ddcc; --pt-primary:#006b52; --pt-accent:#267b72; --pt-on-primary:#ffffff; --pt-head-from:#d5f4df; --pt-head-to:#daf3f2; --pt-mic-from:#13735a; --pt-mic-to:#0b4f43; --pt-glow:#7bd6a4; }
:host([data-color-theme="graphite"][data-dark="true"]) { --pt-bg:#181c25; --pt-ink:#f6f7f9; --pt-muted:#c7ccd6; --pt-border:#48505d; --pt-primary:#ffdc82; --pt-accent:#9ba8c9; --pt-on-primary:#342808; --pt-head-from:#383746; --pt-head-to:#2d3443; --pt-mic-from:#536279; --pt-mic-to:#2b394d; --pt-glow:#edc56b; }
:host([data-color-theme="graphite"][data-dark="false"]) { --pt-bg:#f6f7f9; --pt-ink:#27303b; --pt-muted:#596472; --pt-border:#cbd2db; --pt-primary:#48576b; --pt-accent:#465a83; --pt-on-primary:#ffffff; --pt-head-from:#dfe5ef; --pt-head-to:#e5e8e9; --pt-mic-from:#505f76; --pt-mic-to:#2b384a; --pt-glow:#9eaec5; }
*,*::before,*::after { box-sizing:border-box; }
[hidden] { display:none!important; }
button,input,textarea { font:inherit; }
button { cursor:pointer; }
button:disabled { cursor:not-allowed; opacity:.5; }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible, a:focus-visible { outline:2px solid var(--pt-primary); outline-offset:2px; }
.svg-icon { width:18px; height:18px; flex:none; }
.wrap { padding:0; margin:0; background:transparent; }
.surface {
  display:block; position:relative; isolation:isolate; width:100%; max-width:none;
  margin:0; overflow:hidden; border-radius:var(--ha-card-border-radius,16px);
  color:var(--pt-ink); background:var(--pt-bg);
  border:1px solid var(--ha-card-border-color,var(--pt-border));
  box-shadow:var(--ha-card-box-shadow,0 2px 5px rgba(0,0,0,.08));
}
.head { display:flex; align-items:center; gap:10px; padding:13px 15px 11px; min-height:67px;
  background:linear-gradient(115deg,var(--pt-head-from),var(--pt-head-to));
  border-bottom:1px solid var(--pt-border); }
.head::after { content:""; position:absolute; inset:auto 0 0; height:2px;
  background:linear-gradient(90deg,var(--pt-primary),var(--pt-accent),transparent); opacity:.85; }
.head { position:relative; }
.symbol { display:grid; place-items:center; flex:none; width:36px; height:36px; border-radius:12px;
  background:linear-gradient(145deg,color-mix(in srgb,var(--pt-primary) 22%,var(--pt-bg)),color-mix(in srgb,var(--pt-accent) 11%,var(--pt-bg))); color:var(--pt-primary);
  box-shadow:inset 0 1px 0 color-mix(in srgb,var(--pt-primary) 22%,transparent); }
.symbol .svg-icon { width:21px; height:21px; }
.heading { flex:1; min-width:0; }
.heading h1 { margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--pt-ink); font-size:15px; font-weight:740; letter-spacing:-.25px; line-height:1.3; }
.subtitle { margin:2px 0 0; font-size:10px; line-height:1.35; color:var(--pt-muted); }
.lan-pill { display:inline-flex; align-items:center; flex:none; gap:5px; max-width:88px; min-height:25px;
  padding:5px 7px; border:1px solid var(--pt-border); border-radius:20px; font-size:10px;
  color:var(--pt-muted); background:var(--pt-soft); white-space:nowrap; }
.lan-pill .dot { width:6px; height:6px; border-radius:50%; background:var(--success-color,#25b781); }
.lan-pill.unavailable .dot { background:var(--error-color,#e85b66); }
.lan-pill.busy .dot { background:var(--pt-primary); }
 .panel-body { min-width:0; padding:12px 14px 13px;
  background:radial-gradient(ellipse at 84% -25%,color-mix(in srgb,var(--pt-glow) 8%,transparent),transparent 72%); }
.section { margin:0 0 12px; }
.section-top { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 0 6px; }
.section-title { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--pt-ink); }
.section-title .svg-icon { width:15px; height:15px; color:var(--pt-primary); }
.section-tools { display:flex; align-items:center; gap:3px; }
.refresh-icon,.small-link { display:inline-flex; align-items:center; justify-content:center; gap:5px;
  color:var(--pt-primary); background:transparent; text-decoration:none; border:0; border-radius:9px;
  padding:5px 6px; font-size:11px; font-weight:650; }
.refresh-icon:hover,.small-link:hover { background:var(--pt-soft); }
.refresh-icon .svg-icon,.small-link .svg-icon { width:14px; height:14px; }
.select-wrap { background:var(--pt-soft); border:1px solid var(--pt-border); border-radius:11px; }
.speaker-picker > summary { list-style:none; display:flex; align-items:center; gap:8px; cursor:pointer;
  min-height:44px; padding:5px 10px; }
.speaker-picker > summary::-webkit-details-marker { display:none; }
.speaker-picker > summary[aria-disabled="true"] { opacity:.65; cursor:default; }
.device-icon { display:grid; place-items:center; flex:none; color:var(--pt-primary); }
.device-icon .svg-icon { width:19px; height:19px; }
.speaker-summary-text { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--pt-ink); font-weight:680; font-size:12px; }
.speaker-availability { flex:none; display:flex; align-items:center; gap:5px;
  font-size:10px; color:var(--pt-muted); white-space:nowrap; }
.speaker-availability .state-dot { display:block; width:6px; height:6px; border-radius:50%; background:var(--pt-muted); }
.speaker-availability.online .state-dot { background:var(--success-color,#2bc48b); }
.select-chevron { width:15px; height:15px; flex:none; color:var(--pt-muted); transition:transform .15s; }
.speaker-picker[open] .select-chevron { transform:rotate(180deg); }
.speaker-picker-body { padding:8px; border-top:1px solid var(--pt-border); }
.speaker-picker-tools { display:flex; gap:5px; margin-bottom:7px; }
.speaker-picker-tools button { background:var(--pt-soft); color:var(--pt-ink); padding:6px 7px;
  font-size:11px; border:1px solid var(--pt-border); border-radius:8px; }
.speaker-picker-tools button:last-child { margin-left:auto; color:var(--pt-primary); }
.speaker-options { display:grid; gap:4px; max-height:230px; overflow:auto; }
.speaker-option { display:flex; gap:8px; align-items:center; padding:8px; min-height:38px;
  border:1px solid transparent; border-radius:8px; background:var(--pt-soft); cursor:pointer; }
.speaker-option:has(input:checked) { border-color:color-mix(in srgb,var(--pt-primary) 44%,var(--pt-border)); }
.speaker-option:has(input:disabled) { opacity:.55; cursor:default; }
.speaker-option input { width:16px; height:16px; margin:0; accent-color:var(--pt-primary); }
.speaker-option-name { flex:1; min-width:0; font-size:12px; overflow-wrap:anywhere; }
.speaker-option small { font-size:10px; color:var(--pt-muted); text-align:right; }
.speaker-picker-empty { color:var(--pt-muted); font-size:12px; margin:8px 0; }
.speaker-meta { display:none; }
 .volume-section { margin-bottom:13px; }
.volume-row { display:flex; align-items:stretch; gap:9px; min-width:0; }
.volume-row .volume-box { flex:1 1 0; min-width:0; }
.volume-box { display:flex; align-items:center; gap:10px; min-height:40px; padding:6px 10px;
  border:1px solid var(--pt-border); border-radius:11px; background:var(--pt-soft); }
.volume-box .svg-icon { width:16px; height:16px; color:var(--pt-primary); }
.volume-box input { flex:1; width:100%; min-width:0; height:5px; appearance:none; border:0; outline:0;
  cursor:pointer; border-radius:10px;
  background:linear-gradient(to right,var(--pt-primary) 0%,var(--pt-primary) var(--progress,65%),var(--pt-border) var(--progress,65%),var(--pt-border) 100%); }
.volume-box input::-webkit-slider-thumb { appearance:none; width:16px; height:16px; border:2px solid var(--pt-bg); border-radius:50%; background:var(--pt-primary); box-shadow:0 1px 4px rgba(0,0,0,.18); }
.volume-box input::-moz-range-thumb { width:13px; height:13px; border:2px solid var(--pt-bg); border-radius:50%; background:var(--pt-primary); }
.volume-box output { min-width:38px; text-align:right; color:var(--pt-primary); font-size:12px; font-weight:750; font-variant-numeric:tabular-nums; }
.tablist { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px; padding:3px;
  background:var(--pt-soft); border:1px solid var(--pt-border); border-radius:12px; margin-bottom:10px; }
.tab { display:flex; justify-content:center; align-items:center; gap:7px; min-height:35px;
  padding:6px 9px; border:1px solid transparent; background:transparent; color:var(--pt-muted);
  border-radius:9px; font-size:12px; font-weight:720; }
.tab .svg-icon { width:15px; height:15px; }
 .tab[aria-selected="true"] { background:linear-gradient(120deg,var(--pt-soft-2),var(--pt-soft)); color:var(--pt-primary);
  border-color:color-mix(in srgb,var(--pt-primary) 40%,var(--pt-border));
  box-shadow:0 1px 5px color-mix(in srgb,var(--pt-primary) 11%,transparent); }
.tab-panel { min-width:0; }
.stage { margin:0; padding:5px 0 6px; min-height:112px; }
.mic-layout { display:flex; width:100%; align-items:center; justify-content:center; gap:0; min-height:112px; }
.mic-orbit { display:grid; place-items:center; position:relative; width:112px; height:112px; flex:none; }
.mic-orbit::before { content:""; position:absolute; inset:0; pointer-events:none;
  border:1px solid color-mix(in srgb,var(--pt-primary) 45%,var(--pt-border)); border-radius:50%; }
.mic { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;
  width:96px; height:96px; padding:8px; border:1px solid color-mix(in srgb,var(--pt-primary) 70%,white);
  border-radius:50%; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;
  color:var(--pt-mic-text,#fff); background:linear-gradient(145deg,var(--pt-mic-from),var(--pt-mic-to));
  box-shadow:0 6px 20px color-mix(in srgb,var(--pt-glow) 22%,transparent); transition:transform .13s ease; }
.mic .svg-icon { width:30px; height:30px; stroke-width:1.6; }
.mic span { display:block; text-align:center; font-size:10px; font-weight:720; line-height:1.25; }
.mic:hover:not(:disabled) { transform:scale(1.035); }
.mic:disabled { opacity:.84; }
.mic:active:not(:disabled) { transform:scale(.965); }
/* Retain existing recording state hooks for accessibility and JS, but remove
   the right-hand hint column from the visible Talk layout. */
.talk-feedback-visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
.hint { margin:0; }
.counter { margin:0; }
.stage.recording .mic { background:linear-gradient(135deg,#d62b5b,#f26a54); box-shadow:0 5px 18px rgba(223,49,92,.22); }
.stage.recording .mic-orbit::before { border-color:var(--error-color,#ed5e75); animation:record-pulse 1.2s ease-out infinite; }
.stage.sending .mic-orbit::before { border-top-color:transparent; border-width:2px; animation:spin .8s linear infinite; }
@keyframes record-pulse { 50% { opacity:.35; transform:scale(1.08); } }
@keyframes spin { to { transform:rotate(360deg); } }
.actions { display:flex; justify-content:flex-end; gap:7px; margin-top:9px; }
.action { display:inline-flex; gap:6px; align-items:center; justify-content:center; min-height:36px;
  padding:7px 12px; border-radius:10px; border:1px solid var(--pt-border); background:var(--pt-soft);
  font-size:11px; font-weight:720; color:var(--pt-ink); }
.action .svg-icon { width:14px; height:14px; }
/* Persistent, red icon-only Stop button; right of the volume slider. */
.action.stop-action { flex:0 0 40px; width:40px; height:40px; min-height:40px; padding:0;
  color:#fff; background:linear-gradient(145deg,#c91f45,#9e1736);
  border:1px solid #eb5571; border-radius:11px;
  box-shadow:0 3px 10px rgba(159,19,53,.25),inset 0 1px 0 rgba(255,255,255,.20); }
.action.stop-action .svg-icon { width:19px; height:19px; fill:currentColor; stroke:currentColor; stroke-width:1.4; }
.action.stop-action:hover:not(:disabled) { background:linear-gradient(145deg,#db2448,#ac1637);
  box-shadow:0 4px 14px rgba(201,31,69,.35); }
.action.stop-action:disabled { opacity:.82; filter:none; box-shadow:inset 0 1px 0 rgba(255,255,255,.12); }
.action.cancel-action { margin-left:auto; }
.action.cancel-action { color:var(--error-color,#ec657b); }
.tts-section { padding:0; margin:0; background:transparent; }
.tts-heading { display:none; }
.tts-caption { display:block; margin:2px 0 6px; font-size:10px; color:var(--pt-muted); line-height:1.4; overflow-wrap:anywhere; }
.tts-text { display:block; width:100%; height:76px; min-height:76px; resize:vertical;
  border:1px solid var(--pt-border); border-radius:11px; padding:10px 11px;
  font-size:12px; line-height:1.45; color:var(--pt-ink); background:var(--pt-soft); }
.tts-text::placeholder,.tts-option-input::placeholder { color:var(--pt-muted); opacity:.8; }
.tts-actions { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-top:8px; }
.tts-send { display:inline-flex; justify-content:center; align-items:center; gap:6px; min-height:34px;
  border:0; border-radius:9px; padding:7px 12px; color:var(--pt-on-primary); background:var(--pt-primary);
  font-size:11px; font-weight:720; }
.tts-send .svg-icon { width:14px; height:14px; }
.tts-advanced { flex:1; min-width:140px; font-size:11px; color:var(--pt-muted); }
.tts-advanced > summary { cursor:pointer; padding:6px 2px; }
.tts-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:7px 0; }
.tts-options label { font-size:11px; color:var(--pt-ink); }
.tts-option-input { width:100%; margin-top:4px; min-width:0; padding:8px;
  border:1px solid var(--pt-border); border-radius:8px; color:var(--pt-ink); background:var(--pt-soft); font-size:12px; }
.tts-option-note { display:block; color:var(--pt-muted); font-size:10px; line-height:1.4; }
/* Toast sits over the TOP of the card, not at the bottom or in layout flow. */
.toast { display:flex; align-items:flex-start; gap:9px; position:absolute; z-index:20;
  inset:10px 11px auto; max-height:min(200px,calc(100% - 20px)); overflow-y:auto;
  padding:11px 10px; margin:0; border-radius:12px;
  background:var(--pt-bg); color:var(--pt-ink);
  border:1px solid var(--pt-border); box-shadow:0 10px 32px rgba(0,0,0,.27); }
.toast:not([hidden]) { animation:toast-drop-in .2s ease-out; }
@keyframes toast-drop-in { from { opacity:0; transform:translateY(-7px); } to { opacity:1; transform:translateY(0); } }
.toast.loading { border-left:3px solid var(--pt-primary); }
.toast.success { border-left:3px solid var(--success-color,#25b781); }
.toast.error { border-left:3px solid var(--error-color,#ed6071); }
.status-symbol { display:grid; place-items:center; flex:none; width:21px; height:23px; color:var(--pt-primary); }
.status-symbol .svg-icon { width:19px; height:19px; }
.toast.error .status-symbol { color:var(--error-color,#ed6071); }
.toast.success .status-symbol { color:var(--success-color,#25b781); }
.status-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.status-content { font-size:12px; line-height:1.4; font-weight:750; overflow-wrap:anywhere; }
.status-note { color:var(--pt-muted); font-size:10px; line-height:1.4; overflow-wrap:anywhere; }
.toast-close { display:grid; place-items:center; flex:none; width:25px; height:25px;
  padding:0; color:var(--pt-muted); background:transparent; border:0; border-radius:7px; }
.toast-close:hover { background:var(--pt-soft); }
.toast-close .svg-icon { width:15px; height:15px; }
.https-notice { display:none!important; }
.mic-help { margin-top:8px; padding:9px; border:1px solid var(--pt-border); border-radius:10px;
  color:var(--pt-muted); background:var(--pt-soft); font-size:11px; line-height:1.4; }
.mic-help > summary { cursor:pointer; font-weight:700; color:var(--pt-primary); }
.mic-help p { margin:7px 0; }
.mic-help pre { white-space:pre-wrap; overflow-wrap:anywhere; font:10px/1.5 ui-monospace,monospace; }
.mic-help a { color:var(--pt-primary); }
.copy-diagnostics { padding:7px; font-size:11px; border-radius:8px; color:var(--pt-ink);
  border:1px solid var(--pt-border); background:var(--pt-bg); }
.metrics,.foot { display:none; }
:host([data-compact="true"]) .head { min-height:56px; padding:10px 13px; }
:host([data-compact="true"]) .head .symbol { width:30px; height:30px; }
:host([data-compact="true"]) .head .symbol .svg-icon { width:18px; height:18px; }
:host([data-compact="true"]) .panel-body { padding:10px 12px 12px; }
:host([data-insecure="true"]) .mic { filter:grayscale(.48); opacity:.84; }
@media (max-width:370px) {
  .head { padding:11px; gap:8px; }
  .heading h1 { font-size:13px; }
  .subtitle { font-size:9px; }
  .lan-pill { font-size:9px; padding:4px 6px; }
  .panel-body { padding:11px; }
  .mic-layout { gap:10px; }
  .mic-orbit { width:105px; height:105px; }
  .mic { width:91px; height:91px; }
  .speaker-availability { font-size:9px; }
  .tts-actions { align-items:stretch; }
  .tts-send { flex:1; }
}
@media (max-width:290px) {
  .lan-pill,.speaker-availability,.subtitle { display:none; }
  .mic-layout { gap:5px; }
  .mic-orbit { width:96px; height:96px; }
  .mic { width:86px; height:86px; }
}
@media (prefers-reduced-motion:reduce) {
  *,*::before,*::after { animation:none!important; transition:none!important; }
}
`;
// Do not parse the large stylesheet on dashboards that do not contain P2Talk.
// Resources are global in Lovelace; pay the CSS cost only when a card is mounted.
let sharedSheet;
function getSharedSheet() {
  if (sharedSheet !== undefined) return sharedSheet;
  sharedSheet = null;
  try {
    if (typeof CSSStyleSheet !== "undefined") {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      sharedSheet = sheet;
    }
  } catch (_) { sharedSheet = null; }
  return sharedSheet;
}

const waveMarkup = () => `<div class="wave" aria-hidden="true">${[14,27,44,67,35,57,84,48,62,37,75,102,65,46,58,31,18].map((n,i)=>`<span style="--h:${n}px;--delay:${(i*.07).toFixed(2)}s"></span>`).join("")}</div>`;

function ttsMarkup() {
  return `<section class="tts-section" aria-label="Chuyển văn bản thành giọng nói">
    <h2 class="tts-heading">${icon("send")} Nhập văn bản để phát TTS</h2>
    <p class="tts-caption" id="ttsEngineLabel"></p>
    <label for="ttsText" class="tts-caption">Nội dung cần đọc</label>
    <textarea id="ttsText" class="tts-text" rows="3" maxlength="2000" placeholder="Nhập nội dung muốn TTS..." aria-label="Nhập nội dung muốn TTS"></textarea>
    <div class="tts-actions">
      <details class="tts-advanced" id="ttsAdvanced"><summary>Tuỳ chọn nâng cao: Language / Voice</summary>
        <div class="tts-options">
          <label for="ttsLanguage">Language (không bắt buộc)<input id="ttsLanguage" class="tts-option-input" type="text" maxlength="40" placeholder="Ví dụ: vi" autocomplete="off" /></label>
          <label for="ttsVoice">Voice (không bắt buộc)<input id="ttsVoice" class="tts-option-input" type="text" maxlength="100" placeholder="Ví dụ: maichi" autocomplete="off" /></label>
        </div>
        <small class="tts-option-note">Để trống để dùng mặc định của bộ TTS. Chỉ gửi các trường đã nhập.</small>
      </details>
      <button type="button" id="ttsSend" class="tts-send" disabled>${icon("send")}<span id="ttsSendLabel">Gửi TTS đến loa</span></button>
    </div>
  </section>`;
}

class P2TalkGoogleCastCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._compact = this.localName === "p2talk-google-cast-compact-card";
    this._config = {};
    this._speakerStateSignature = null;
    this._lastVisibleRefresh = 0;
    this._loaded = false;
    this._loadingSpeakers = false;
    this._recording = false;
    this._pressed = false;
    this._sending = false;
    this._ttsSending = false;
    this._ttsText = "";
    this._ttsLanguage = "";
    this._ttsVoice = "";
    this._discard = false;
    this._recorder = null;
    this._stream = null;
    this._chunks = [];
    this._maxSeconds = 120;
    this._maxBytes = 8 * 1024 * 1024;
    this._configuredSpeakers = [];
    this._selectedSpeakerIds = new Set();
    this._selectionInitialized = false;
    this._recordingSpeakerIds = null;
    this._timer = null;
    this._toastTimer = null;
    this._activeTab = null;
    this._lastStatus = null;
    this._started = 0;
  }

  setConfig(config) {
    if (!config || typeof config !== "object" || (config.speakers != null &&
        (!Array.isArray(config.speakers) || !config.speakers.every((id) => typeof id === "string")))) {
      throw new Error("P2Talk: cấu hình 'speakers' phải là danh sách entity_id.");
    }
    if (config.default_tab != null && !["talk", "tts"].includes(config.default_tab)) {
      throw new Error("P2Talk: 'default_tab' phải là 'talk' hoặc 'tts'.");
    }
    if (config.color_theme != null && !COLOR_THEMES.includes(config.color_theme)) {
      throw new Error("P2Talk: 'color_theme' phải là ha, aurora, ocean, sunset, emerald hoặc graphite.");
    }
    if (config.notification_duration != null &&
        (!Number.isInteger(config.notification_duration) || config.notification_duration < 0 || config.notification_duration > 60)) {
      throw new Error("P2Talk: 'notification_duration' phải từ 0 đến 60 giây.");
    }
    const previous = this._config;
    this._config = { ...config };
    this._applyColorTheme();
    if (previous.default_tab !== config.default_tab && this._loaded && this.isConnected) {
      this._setTab(config.default_tab || "talk");
    }
    if (this._toastTimer && this.$?.("status") && !this.$("status").hidden) {
      // A change to the delay applies to the currently visible notification.
      if (previous.notification_duration !== config.notification_duration) this._hideToast();
    }
    const preferencesChanged = previous.name !== config.name ||
      JSON.stringify(previous.speakers || []) !== JSON.stringify(config.speakers || []);
    if (preferencesChanged) this._selectionInitialized = false;
    this._applyTitle();
    // A Lovelace editor can update an existing card without remounting it.
    if (this.isConnected && this._loaded && !this._recording && !this._sending && !this._ttsSending) {
      this._applyConfiguredSpeakers();
    }
    this._applyTtsConfig();
  }
  static getConfigElement() { return document.createElement("p2talk-google-cast-editor"); }
  static getStubConfig() { return {}; }
  getCardSize() { return this._compact ? 5 : 6; }
  getGridOptions() { return { columns:6, min_columns:6 }; }
  get hass() { return this._hass; }
  set hass(hass) {
    const previous = this._hass;
    this._hass = hass;
    if (typeof hass?.themes?.darkMode === "boolean") {
      const themeMode = hass.themes.darkMode ? "true" : "false";
      if (this.getAttribute("data-dark") !== themeMode) this.setAttribute("data-dark", themeMode);
    }
    if (this.isConnected && !this._loaded) this._loadSpeakers();
    else if (this.isConnected && this._loaded && previous !== hass) {
      // HA assigns `hass` on every update: ignore unrelated entities entirely.
      const signature = this._speakerSignature();
      if (signature !== this._speakerStateSignature) {
        this._speakerStateSignature = signature;
        this._renderSpeakerOptions();
        this._syncSpeakerState();
      }
    }
  }
  _speakerSignature() {
    return this._configuredSpeakers.map((s) => {
      const state = this._hass?.states?.[s.entity_id];
      // Only track properties relevant to speaker controls and feedback.
      return `${s.entity_id}:${state?.state}:${state?.attributes?.supported_features}:${state?.attributes?.volume_level}:${state?.attributes?.friendly_name}`;
    }).join("|");
  }
  _secureMicrophoneOrigin() {
    return window.location.protocol === "https:" && window.isSecureContext === true;
  }
  _syncHttpsNotice() {
    const insecure = !this._secureMicrophoneOrigin();
    this.setAttribute("data-insecure", String(insecure));
    const notice = this.$?.("httpsNotice");
    if (notice) notice.hidden = !insecure;
    this._refreshControls();
  }
  _selectionKey() {
    // Keep independently configured cards from overwriting each other's selection.
    const identity = `${this._compact ? "compact" : "full"}:${this._config.name || "default"}:${(this._config.speakers || []).join(",")}`;
    return `${STORAGE_PREFIX}speakers_${identity.slice(0, 120)}`;
  }
  _applyColorTheme() {
    this.setAttribute("data-color-theme", this._config.color_theme || "ha");
  }
  _applyTitle() {
    const label = typeof this._config?.name === "string" ? this._config.name.trim() : "";
    const title = this.shadowRoot?.getElementById(this._compact ? "compactTitle" : "fullTitle");
    if (title) title.textContent = label || "P2Talk Google Cast";
  }
  _applyTtsConfig() {
    const target = typeof this._config.tts_entity === "string" && this._config.tts_entity.trim()
      ? this._config.tts_entity.trim() : DEFAULT_TTS_ENTITY;
    const label = this.shadowRoot?.getElementById("ttsEngineLabel");
    if (label) label.textContent = `Bộ TTS: ${target} · Phát trên loa đang chọn`;
  }
  _applyConfiguredSpeakers() {
    const available = new Set(this._configuredSpeakers.filter((s) => this._speakerAvailable(s)).map((s) => s.entity_id));
    const preferred = this._selectionInitialized ? [...this._selectedSpeakerIds]
      : this._config.speakers?.length ? this._config.speakers : readSpeakerPreferences(this._selectionKey());
    let selected = preferred.filter((id) => available.has(id)).slice(0, MAX_TARGET_SPEAKERS);
    if (!this._selectionInitialized && !selected.length && available.size) selected = [available.values().next().value];
    this._selectionInitialized = true;
    this._selectedSpeakerIds = new Set(selected);
    this._renderSpeakerOptions();
    if (!this._recording && !this._sending && !this._ttsSending) this._applySpeakerVolume();
    this._syncSpeakerState();
  }

  connectedCallback() {
    // Lovelace can disconnect/reconnect the same card when editing or moving it.
    // The DOM is rebuilt below, so fetch fresh speakers and restore selections.
    this._loaded = false;
    this._speakerStateSignature = null;
    if (!this.hasAttribute("data-dark")) {
      const prefersDark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
      this.setAttribute("data-dark", String(prefersDark));
    }
    this._applyColorTheme();
    if (this._compact) this.setAttribute("data-compact", "true");
    // One parsed stylesheet shared across all instances; no per-card CSS parse.
    const sheet = getSharedSheet();
    const canAdopt = !!sheet && "adoptedStyleSheets" in this.shadowRoot;
    if (canAdopt) this.shadowRoot.adoptedStyleSheets = [sheet];
    const talkPanel = `<div class="tab-panel" id="panelTalk" role="tabpanel" aria-labelledby="tabTalk">
      <section class="stage" id="stage" aria-label="Nhấn giữ để nói">
        <div class="mic-layout"><div class="mic-orbit"><button id="mic" class="mic" type="button" disabled aria-label="Nhấn giữ để ghi âm, thả để gửi đến loa" title="Nhấn giữ để nói">${icon("mic")}<span id="micText">Nhấn giữ<br>để nói</span></button></div></div>
        <div class="talk-feedback-visually-hidden"><p id="hint" class="hint">Nhấn giữ để nói</p><p id="counter" class="counter" aria-live="off"></p></div>
      </section>
    </div>`;
    const ttsPanel = `<div class="tab-panel" id="panelTts" role="tabpanel" aria-labelledby="tabTts" hidden>${ttsMarkup()}</div>`;
    this.shadowRoot.innerHTML = (canAdopt ? "" : `<style>${styles}</style>`) + `
      <div class="wrap"><ha-card class="surface">
        <header class="head"><div class="symbol" aria-hidden="true">${icon("cast")}</div>
          <div class="heading"><h1 id="${this._compact ? "compactTitle" : "fullTitle"}">P2Talk Google Cast</h1>
          <p class="subtitle">Talk · TTS · Google Cast</p></div>
          <button type="button" class="lan-pill" id="connectionPill" title="Xem thông báo gần nhất" aria-label="Xem thông báo gần nhất"><span class="dot"></span><span id="connectionLabel">Đang tải</span></button>
        </header>
        <div class="panel-body">
          <section class="section speaker-section" aria-label="Chọn loa Google Cast">
            <div class="section-top"><span class="section-title">${icon("speaker")} Chọn loa Google Cast</span>
              <span class="section-tools"><button type="button" class="refresh-icon" id="refresh" title="Làm mới danh sách loa" aria-label="Làm mới danh sách loa">${icon("refresh")}</button>
                <a class="small-link configure-link" id="configure" href="/config/integrations/integration/p2talk_google_cast" title="Quản lý loa Google Cast">${icon("settings")}<span>Quản lý</span></a></span></div>
            <details class="select-wrap speaker-picker" id="speaker">
              <summary id="speakerSummary" aria-label="Chọn một hoặc nhiều loa Google Cast"><span class="device-icon" aria-hidden="true">${icon("speaker")}</span>
                <span class="speaker-summary-text" id="speakerSummaryText">Đang tải loa...</span>
                <span class="speaker-availability" id="inlineState" aria-hidden="true"><i class="state-dot"></i><span id="inlineStateText">Đang tải</span></span>${icon("chevron","select-chevron")}</summary>
              <div class="speaker-picker-body"><div class="speaker-picker-tools"><button type="button" id="selectAll">Chọn tất cả</button><button type="button" id="selectNone">Bỏ chọn</button><button type="button" id="speakerDone">Xong</button></div>
                <div class="speaker-options" id="speakerOptions" role="group" aria-label="Danh sách loa Google Cast"></div></div>
            </details>
            <div class="speaker-meta" id="speakerMeta"><span id="speakerState"></span></div>
          </section>
          <section class="section volume-section" aria-label="Âm lượng chung cho loa đã chọn">
            <div class="volume-row"><div class="volume-box">${icon("volume")}
              <input id="volume" type="range" min="5" max="100" value="65" aria-label="Âm lượng chung cho loa đã chọn" style="--progress:65%"/>
              <output id="volumeText" for="volume">65%</output></div>
              <button type="button" class="action stop-action" id="stop" disabled
                title="Dừng phát trên các loa đã chọn" aria-label="Dừng phát trên các loa đã chọn">${icon("stop")}</button>
            </div>
          </section>
          <div class="tablist" role="tablist" aria-label="Chọn chế độ phát">
            <button type="button" class="tab" id="tabTalk" role="tab" aria-controls="panelTalk" aria-selected="true" tabindex="0">${icon("mic")} Talk</button>
            <button type="button" class="tab" id="tabTts" role="tab" aria-controls="panelTts" aria-selected="false" tabindex="-1">${icon("send")} TTS</button>
          </div>
          ${talkPanel}${ttsPanel}
          <div class="actions" id="recordActions" hidden><button type="button" class="action cancel-action" id="cancel" disabled hidden>${icon("close")} Hủy ghi âm</button></div>
          <div class="https-notice" id="httpsNotice" hidden></div>
          <details id="micHelp" class="mic-help" hidden><summary>Chẩn đoán microphone</summary><p id="micAction"></p><pre id="micDetails"></pre>
            <button id="micCopy" type="button" class="copy-diagnostics">Sao chép chẩn đoán</button>
            <p><a href="https://www.home-assistant.io/docs/configuration/remote/" target="_blank" rel="noopener noreferrer">Hướng dẫn kết nối HTTPS</a></p></details>
          <div id="metrics" class="metrics" hidden></div>
        </div>
        <div id="status" class="toast" role="status" aria-live="polite" aria-atomic="true" hidden>
          <span id="statusIcon" class="status-symbol">${icon("info")}</span>
          <span class="status-copy"><strong id="statusText" class="status-content"></strong><small id="statusNote" class="status-note"></small></span>
          <button type="button" id="toastClose" class="toast-close" aria-label="Đóng thông báo">${icon("close")}</button>
        </div>
      </ha-card></div>`;
    this.$ = (id) => this.shadowRoot.getElementById(id);
    this._applyTitle();
    this._applyTtsConfig();
    this._setTab(this._config.default_tab || "talk");
    this.$("toastClose").addEventListener("click", () => this._hideToast());
    this.$("connectionPill").addEventListener("click", () => {
      if (this._lastStatus) this._status(...this._lastStatus);
    });
    for (const name of ["talk", "tts"]) {
      const tab = this.$(name === "talk" ? "tabTalk" : "tabTts");
      tab.addEventListener("click", () => this._setTab(name));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "talk" : event.key === "End" ? "tts" : name === "talk" ? "tts" : "talk";
        this._setTab(next);
        this.$(next === "talk" ? "tabTalk" : "tabTts").focus();
      });
    }
    this.$("ttsText").value = this._ttsText;
    this.$("ttsLanguage").value = this._ttsLanguage;
    this.$("ttsVoice").value = this._ttsVoice;
    this.$("ttsText").addEventListener("input", (event) => {
      this._ttsText = event.target.value;
      this._refreshControls();
    });
    this.$("ttsLanguage").addEventListener("input", (event) => { this._ttsLanguage = event.target.value; });
    this.$("ttsVoice").addEventListener("input", (event) => { this._ttsVoice = event.target.value; });
    this.$("ttsSend").addEventListener("click", () => this._sendTts());
    this.$("refresh")?.addEventListener("click", () => this._loadSpeakers());
    this.$("micCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.$("micDetails").textContent);
        this.$("micCopy").textContent = "Đã sao chép";
      } catch (_) {
        this.$("micCopy").textContent = "Hãy chọn và sao chép phần chẩn đoán";
      }
    });
    this.$("speaker").addEventListener("click", (event) => {
      if ((this._recording || this._sending || this._ttsSending) && event.target.closest("summary")) event.preventDefault();
    });
    this.$("selectAll").addEventListener("click", () => {
      this._setSelectedSpeakers(this._configuredSpeakers.filter((s) => this._speakerAvailable(s)).map((s) => s.entity_id));
    });
    this.$("selectNone").addEventListener("click", () => this._setSelectedSpeakers([]));
    this.$("speakerDone").addEventListener("click", () => { this.$("speaker").open = false; });
    this.$("volume").addEventListener("input", (e) => {
      this.$("volumeText").textContent = `${e.target.value}%`;
      this.$("volume").style.setProperty("--progress", `${e.target.value}%`);
      // Volume overrides configuration only for this selected playback; not stored.
    });
    this.$("cancel")?.addEventListener("click", () => this._stopRecording(true));
    this.$("stop")?.addEventListener("click", () => this._stopSpeaker());
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
      if (document.visibilityState === "visible" && Date.now() - this._lastVisibleRefresh > 10000) {
        this._lastVisibleRefresh = Date.now();
        this._loadSpeakers(true);
      }
      else if (this._recording) this._stopRecording(true);
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);
    this._syncHttpsNotice();
    if (this._hass) this._loadSpeakers();
  }

  disconnectedCallback() {
    if (this._visibilityHandler) document.removeEventListener("visibilitychange", this._visibilityHandler);
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = null;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._pressed = false;
    this._recording = false;
    if (this._recorder && this._recorder.state !== "inactive") {
      this._discard = true;
      this._recorder.stop();
    }
    this._stopTracks();
    // Detaching a card must never leave it permanently stuck in a recording state.
    this._sending = false;
    this._ttsSending = false;
  }

  _setTab(tab) {
    if (!this.$ || (this._recording || this._pressed || this._sending || this._ttsSending)) return;
    this._activeTab = tab === "tts" ? "tts" : "talk";
    const talk = this._activeTab === "talk";
    for (const [id, selected] of [["tabTalk", talk], ["tabTts", !talk]]) {
      const button = this.$(id);
      if (!button) continue;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    if (this.$("panelTalk")) this.$("panelTalk").hidden = !talk;
    if (this.$("panelTts")) this.$("panelTts").hidden = talk;
  }

  _hideToast() {
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = null;
    const el = this.$?.("status");
    if (el) el.hidden = true;
  }

  _status(message, type = "", note = null) {
    const el = this.$?.("status");
    if (!el) return;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = null;
    this._lastStatus = [message, type, note];
    this.$("statusText").textContent = message;
    this.$("statusIcon").innerHTML = icon(type === "success" ? "check" : type === "error" ? "alert" : type === "loading" ? "refresh" : "info");
    const secondary = this.$("statusNote");
    secondary.textContent = note ?? (type === "error" ? "Kiểm tra kết nối, cấu hình thiết bị hoặc nhật ký Home Assistant." : "");
    secondary.hidden = !secondary.textContent;
    el.className = `toast ${type}`;
    el.hidden = false;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
    const pill = this.$("connectionPill");
    if (pill) {
      pill.className = `lan-pill ${type === "error" ? "unavailable" : type === "loading" ? "busy" : ""}`;
      this.$("connectionLabel").textContent = type === "error" ? "Cần kiểm tra" : type === "loading" ? "Đang xử lý" : "Sẵn sàng";
    }
    // Loading stays until an action finishes; other messages auto-dismiss.
    const duration = this._config.notification_duration ?? 5;
    if (type !== "loading" && duration > 0) {
      this._toastTimer = setTimeout(() => this._hideToast(), duration * 1000);
    }
  }

  _speakerAvailable(speaker) {
    if (!speaker) return false;
    const live = this._hass?.states?.[speaker.entity_id];
    const state = live?.state || speaker.state;
    const flags = live?.attributes?.supported_features;
    const playSupported = typeof flags === "number" ? !!(flags & 512) : speaker.is_available;
    const allowed = speaker.can_control === undefined ? speaker.is_available : speaker.can_control;
    return !!allowed && !!playSupported && state !== "unavailable" && state !== "unknown";
  }

  _speakerDisplayName(speaker) {
    // Respect an alias set in the Options Flow, otherwise use the latest HA name.
    if (speaker.configured_name) return speaker.configured_name;
    return this._hass?.states?.[speaker.entity_id]?.attributes?.friendly_name ||
      speaker.friendly_name || speaker.entity_id;
  }

  _selectedSpeakers() {
    return this._configuredSpeakers.filter((speaker) =>
      this._selectedSpeakerIds.has(speaker.entity_id) && this._speakerAvailable(speaker));
  }

  _refreshControls() {
    if (!this.$) return;
    const selected = this._selectedSpeakers().length > 0;
    this.$("mic").disabled = !this._secureMicrophoneOrigin() || this._recording || this._sending || this._ttsSending || !selected;
    // Keep the pressed button operable for pointerup during recording.
    if (this._recording && this._secureMicrophoneOrigin()) this.$("mic").disabled = false;
    const locked = this._recording || this._sending || this._ttsSending;
    this.$("tabTalk").disabled = locked;
    this.$("tabTts").disabled = locked;
    this.$("cancel").hidden = !this._recording;
    this.$("recordActions").hidden = !this._recording;
    this.$("ttsSend").disabled = locked || !selected || !this._hass || !this.$("ttsText").value.trim();
    this.$("ttsText").disabled = this._ttsSending;
    this.$("ttsLanguage").disabled = this._ttsSending;
    this.$("ttsVoice").disabled = this._ttsSending;
    this.$("ttsSendLabel").textContent = this._ttsSending ? "Đang gửi TTS..." : "Gửi TTS đến loa";
    if (locked) this.$("speaker").open = false;
    this.$("speakerSummary").setAttribute("aria-disabled", String(locked));
    for (const control of this.$("speakerOptions").querySelectorAll("input")) {
      const speaker = this._configuredSpeakers.find((item) => item.entity_id === control.value);
      control.disabled = locked || !this._speakerAvailable(speaker);
    }
    this.$("selectAll").disabled = locked;
    this.$("selectNone").disabled = locked;
    if (this.$("stop")) this.$("stop").disabled = this._stopPending || this._sending || this._recording || this._ttsSending || !selected;
    if (this.$("cancel")) this.$("cancel").disabled = !this._recording;
    if (this.$("refresh")) this.$("refresh").disabled = locked;
    if (this.$("configure")) this.$("configure").style.pointerEvents = locked ? "none" : "";
  }

  async _loadSpeakers(silent = false) {
    if (!this._hass || this._loadingSpeakers || !this.isConnected) return;
    this._loadingSpeakers = true;
    if (!silent) this._status("Đang đọc thiết bị từ Home Assistant...", "loading");
    try {
      const response = await this._hass.callWS({ type: `${DOMAIN}/speakers` });
      this._maxSeconds = response.max_seconds || 120;
      this._maxBytes = response.max_bytes || this._maxBytes;
      this._loaded = true;
      this._syncHttpsNotice();
      const insecure = !this._secureMicrophoneOrigin();
      const speakers = Array.isArray(response.speakers) ? response.speakers : [];
      this._configuredSpeakers = speakers;
      this._applyConfiguredSpeakers();
      this._speakerStateSignature = this._speakerSignature();
      if (!this._recording && !this._sending && !this._ttsSending) {
        const available = speakers.some((s) => s.is_available);
        if (insecure) {
          this._status("Micro tắt vì HTTP, nhưng có thể nhập văn bản và gửi TTS.", "error",
            "Mở dashboard bằng HTTPS hợp lệ để ghi âm; P2Talk không tự chuyển địa chỉ.");
        } else this._status(available && this._selectedSpeakers().length
          ? "Sẵn sàng. Nhấn giữ micro để nói."
          : available ? "Chọn ít nhất một loa để gửi Talk."
          : (speakers.length ? "Các loa đã thêm đều offline/không hỗ trợ phát. Kiểm tra Google Cast."
            : "Chưa có loa. Vào Settings → Devices & services → P2Talk Google Cast → Configure → Add speaker."),
          available ? "success" : "error");
      }
    } catch (error) {
      if (!silent) this._status(`Không đọc được danh sách loa: ${error.message || error}`, "error");
    } finally {
      this._loadingSpeakers = false;
      this._refreshControls();
    }
  }

  _renderSpeakerOptions() {
    const container = this.$("speakerOptions");
    container.replaceChildren();
    if (!this._configuredSpeakers.length) {
      const empty = document.createElement("p");
      empty.className = "speaker-picker-empty";
      empty.textContent = "Chưa có loa. Hãy thêm loa trong mục Quản lý loa.";
      container.append(empty);
      return;
    }
    for (const speaker of this._configuredSpeakers) {
      const row = document.createElement("label");
      row.className = "speaker-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = speaker.entity_id;
      checkbox.checked = this._selectedSpeakerIds.has(speaker.entity_id);
      checkbox.disabled = !this._speakerAvailable(speaker);
      const text = document.createElement("span");
      text.className = "speaker-option-name";
      text.textContent = this._speakerDisplayName(speaker);
      const state = document.createElement("small");
      state.textContent = checkbox.disabled ? "Offline / không hỗ trợ phát" : "Sẵn sàng";
      row.append(checkbox, text, state);
      checkbox.addEventListener("change", () => {
        const selected = new Set(this._selectedSpeakerIds);
        if (checkbox.checked) selected.add(speaker.entity_id);
        else selected.delete(speaker.entity_id);
        this._setSelectedSpeakers([...selected]);
      });
      container.append(row);
    }
  }

  _setSelectedSpeakers(ids) {
    if (this._recording || this._sending || this._ttsSending) return;
    const allowed = new Set(this._configuredSpeakers.filter((s) => this._speakerAvailable(s)).map((s) => s.entity_id));
    const valid = [...new Set(ids.filter((id) => allowed.has(id)))];
    this._selectedSpeakerIds = new Set(valid.slice(0, MAX_TARGET_SPEAKERS));
    if (valid.length > MAX_TARGET_SPEAKERS) {
      this._status(`Có thể chọn tối đa ${MAX_TARGET_SPEAKERS} loa mỗi lần gửi.`, "error");
    }
    saveSpeakerPreferences(this._selectionKey(), [...this._selectedSpeakerIds]);
    for (const input of this.$("speakerOptions").querySelectorAll("input")) {
      input.checked = this._selectedSpeakerIds.has(input.value);
    }
    this._applySpeakerVolume();
    this._syncSpeakerState();
  }

  _applySpeakerVolume() {
    // A single volume slider is applied to every selected speaker at playback.
    const current = this._selectedSpeakers()[0];
    const volume = current?.configured_volume ?? 0.65;
    const percentage = Math.min(100, Math.max(5, Math.round(volume * 100)));
    this.$("volume").value = String(percentage);
    this.$("volumeText").textContent = `${percentage}%`;
    this.$("volume").style.setProperty("--progress", `${percentage}%`);
  }

  _syncSpeakerState() {
    if (!this.$ || !this.$("speaker")) return;
    const speakers = this._selectedSpeakers();
    const count = speakers.length;
    const names = speakers.map((s) => this._speakerDisplayName(s));
    this.$("speakerSummaryText").textContent = count === 0 ? "Chọn một hoặc nhiều loa..."
      : count === 1 ? names[0]
      : count === 2 ? names.join(" + ")
      : `Đã chọn ${count} loa`;
    if (this.$("inlineState")) this.$("inlineState").className = `speaker-availability ${count ? "online" : ""}`;
    if (this.$("inlineStateText")) this.$("inlineStateText").textContent = count ? `${count} loa` : "Chưa chọn";
    const meta = this.$("speakerMeta");
    if (meta) meta.className = `speaker-meta ${count ? "online" : ""}`;
    if (this.$("speakerState")) this.$("speakerState").textContent = count
      ? `${count} loa đã chọn · Sẵn sàng nhận giọng nói`
      : "Chọn ít nhất một loa để gửi Talk";
    this._refreshControls();
  }

  async _showMicrophoneFailure(error) {
    const environment = microphoneEnvironment();
    const advice = microphoneAdvice(error, environment);
    const help = this.$("micHelp");
    help.hidden = false;
    help.open = false;
    this.$("micAction").textContent = advice.code === "insecure_context"
      ? "Mở Home Assistant qua HTTPS hợp lệ. P2Talk không tự chuyển địa chỉ và không thể bật microphone qua HTTP."
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
      `Error type: ${error?.name || "none"}`,
    ].join("\n");
    this.$("micDetails").textContent = report;
    // Client-side errors never reach HA Core logs. No recorded sound or URLs logged.
    console.warn("[P2Talk][microphone]", report);
    this._status(advice.message, "error", this.$("micAction").textContent);
  }

  _stopTracks() {
    if (this._stream) this._stream.getTracks().forEach((track) => track.stop());
    this._stream = null;
  }

  async _startRecording() {
    if (this._recording || this._sending || this._ttsSending || !this._selectedSpeakers().length || this._pressed) return;
    // Microphone permission is granted only to the current secure document;
    // The current page must already be HTTPS; P2Talk never navigates away.
    if (!this._secureMicrophoneOrigin()) {
      await this._showMicrophoneFailure(new Error("insecure_context"));
      return;
    }
    this._pressed = true;
    this._recordingSpeakerIds = this._selectedSpeakers().map((s) => s.entity_id);
    this.$("speaker").open = false;
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
    if (!cancel) { this.$("stage").classList.add("sending"); this._sending = true; }
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
      this._sending = false;
      this._recordingSpeakerIds = null;
      this.$("stage").classList.remove("sending");
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this.$("counter").textContent = "Thả nút để phát đến loa đã chọn";
      this._refreshControls();
      return;
    }
    const chunks = this._chunks;
    this._chunks = [];
    const blob = new Blob(chunks, { type:this._recorder?.mimeType || "audio/webm" });
    if (blob.size > this._maxBytes) {
      this._sending = false;
      this._recordingSpeakerIds = null;
      this._status("Bản ghi âm quá lớn. Hãy ghi ngắn hơn.", "error");
      this.$("stage").classList.remove("sending");
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this._refreshControls();
      return;
    }
    this._sending = true;
    if (this.$("metrics")) this.$("metrics").textContent = "";
    this._refreshControls();
    const speakers = this._recordingSpeakerIds || this._selectedSpeakers().map((s) => s.entity_id);
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
        speakers, volume:Number(this.$("volume").value)/100,
      });
      if (result.performance) {
        const m = result.performance;
        if (this.$("metrics")) this.$("metrics").textContent = `Chuyển dữ liệu: ${m.transfer_ms} ms · FFmpeg: ${m.convert_ms} ms · Lệnh HA: ${m.service_ms} ms. Thời gian loa bắt đầu phát có thể lâu hơn.`;
      }
      uploadId = null;
      const sent = result.speakers || (result.speaker ? [result.speaker] : []);
      const failures = result.failed_speakers || [];
      const speakerNames = sent.map((id) => {
        const speaker = this._configuredSpeakers.find((s) => s.entity_id === id);
        return speaker ? this._speakerDisplayName(speaker) : id;
      });
      this._status(failures.length
        ? `Đã gửi đến ${sent.length}/${speakers.length} loa. ${failures.length} loa không phát được.`
        : `Đã gửi giọng nói đến ${speakerNames.length === 1 ? speakerNames[0] : `${sent.length} loa đã chọn`}.`,
      failures.length ? "error" : "success", failures.length ? "Kiểm tra kết nối và log Home Assistant của loa không phát được." : null);
    } catch (error) {
      this._status(`Không phát được âm thanh (${error.code || "error"}): ${error.message || error}. Xem Settings → System → Logs.`, "error");
      if (uploadId) {
        try { await this._hass.callWS({ type:`${DOMAIN}/upload_cancel`, upload_id:uploadId }); }
        catch (_) { /* It may already have expired or been consumed. */ }
      }
    } finally {
      this._sending = false;
      this._recordingSpeakerIds = null;
      this.$("stage").classList.remove("sending");
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("micText").innerHTML = "Nhấn giữ<br>để nói";
      this.$("counter").textContent = "Thả nút để phát đến loa đã chọn";
      this._refreshControls();
    }
  }

  async _sendTts() {
    if (this._ttsSending || this._recording || this._sending || !this._hass) return;
    const message = this.$("ttsText").value.trim();
    const speakers = this._selectedSpeakers().map((speaker) => speaker.entity_id);
    if (!message) { this._status("Hãy nhập nội dung cần đọc TTS.", "error"); return; }
    if (!speakers.length) { this._status("Hãy chọn ít nhất một loa để phát TTS.", "error"); return; }
    const ttsEntity = typeof this._config.tts_entity === "string" && this._config.tts_entity.trim()
      ? this._config.tts_entity.trim() : DEFAULT_TTS_ENTITY;
    if (!/^tts\.[a-z0-9_]+$/.test(ttsEntity)) {
      this._status("Entity TTS không hợp lệ. Kiểm tra cấu hình thẻ (tts_entity).", "error");
      return;
    }
    const language = this.$("ttsLanguage").value.trim();
    const voice = this.$("ttsVoice").value.trim();
    // When left blank, language/options must be ABSENT so the TTS provider
    // selects its own language and default voice.
    const payload = { cache:false, message };
    if (language) payload.language = language;
    if (voice) payload.options = { voice };
    this._ttsSending = true;
    this._refreshControls();
    this._status(`Đang gửi TTS đến ${speakers.length} loa...`, "loading");
    try {
      const results = await Promise.allSettled(speakers.map((speaker) =>
        this._hass.callService("tts", "speak", {
          ...payload, media_player_entity_id:speaker,
        }, { entity_id:ttsEntity })
      ));
      const errors = results.filter((result) => result.status === "rejected");
      const succeeded = results.length - errors.length;
      if (errors.length) {
        const reason = errors[0].reason?.message || String(errors[0].reason);
        this._status(`Đã gửi TTS đến ${succeeded}/${speakers.length} loa. ${errors.length} loa lỗi: ${reason}`, "error");
      } else {
        this._status(`Đã gửi TTS đến ${succeeded} loa.`, "success");
      }
    } catch (error) {
      this._status(`Không gửi được TTS: ${error.message || error}`, "error");
    } finally {
      this._ttsSending = false;
      if (this.isConnected) this._refreshControls();
    }
  }

  async _stopSpeaker() {
    const speakers = this._selectedSpeakers().map((s) => s.entity_id);
    if (!speakers.length || !this._hass || this._stopPending) return;
    this._stopPending = true;
    this._refreshControls();
    try {
      const result = await this._hass.callWS({ type:`${DOMAIN}/stop`, speakers });
      const stopped = result?.speakers?.length ?? 0;
      const failed = result?.failed_speakers?.length ?? 0;
      const paused = result?.paused_speakers?.length ?? 0;
      const suffix = paused ? ` ${paused} loa chỉ hỗ trợ tạm dừng.` : "";
      this._status(failed
        ? `Đã gửi lệnh dừng/tạm dừng ${stopped}/${speakers.length} loa; ${failed} loa lỗi.${suffix}`
        : `Đã gửi lệnh dừng đến ${stopped} loa.${suffix}`, failed || paused ? "error" : "success");
    } catch (error) {
      this._status(`Không dừng được loa: ${error.message || error}`, "error");
    } finally {
      this._stopPending = false;
      this._refreshControls();
    }
  }
}


class P2TalkGoogleCastCompactCard extends P2TalkGoogleCastCard {}

class P2TalkGoogleCastEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:"open"});
    this._config = {};
    this._speakers = [];
    this._loading = false;
  }
  setConfig(config) { this._config = {...config}; this._render(); }
  set hass(hass) {
    this._hass = hass;
    if (this.isConnected && !this._loading && !this._fetched) {
      this._loading = true;
      this._fetched = true;
      hass.callWS({type:`${DOMAIN}/speakers`}).then((data) => {
        this._speakers = data.speakers || [];
        this._render();
      }).catch(() => { this._fetched = false; }).finally(() => {this._loading = false;});
    }
  }
  connectedCallback() { this._render(); if (this._hass) this.hass = this._hass; }
  _emit(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail:{config}, bubbles:true, composed:true,
    }));
  }
  _render() {
    if (!this.isConnected) return;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:var(--primary-text-color);font:inherit}
      label{display:block;font-size:14px;margin:10px 0}
      input[type=text],select{box-sizing:border-box;width:100%;padding:9px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:inherit}
      .choices{max-height:220px;overflow:auto}.choices label{display:flex;gap:8px;align-items:center}
      p{font-size:12px;color:var(--secondary-text-color)}
      .theme-swatches{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
      .swatch{height:22px;min-width:44px;flex:1;border-radius:8px;border:1px solid var(--divider-color);cursor:pointer;box-shadow:inset 0 1px 0 #ffffff30}
      .swatch[aria-pressed="true"]{outline:2px solid var(--primary-color,#1976d2);outline-offset:2px}
      .swatch:focus-visible{outline:3px solid var(--primary-color,#1976d2)}
    </style><label>Tên thẻ <input id="name" type="text" placeholder="P2Talk Google Cast" /></label>
    <label>Bộ TTS (entity_id) <input id="ttsEntity" type="text" placeholder="tts.wyoming_vietnamese" /></label>
    <label>Mẫu màu giao diện <select id="colorTheme">
      <option value="ha">Theo theme Home Assistant</option>
      <option value="aurora">Aurora — Tím cực quang</option>
      <option value="ocean">Ocean — Xanh biển công nghệ</option>
      <option value="sunset">Sunset — Cam san hô</option>
      <option value="emerald">Emerald — Ngọc lục bảo</option>
      <option value="graphite">Graphite — Than chì sang trọng</option>
    </select></label>
    <div id="themeSwatches" class="theme-swatches" aria-label="Xem trước màu chủ đạo"></div>
    <p>Các mẫu màu tự đổi bảng màu theo giao diện sáng/tối của Home Assistant. Chỉ tác động đến thẻ này.</p>
    <label>Tab mặc định khi mở thẻ <select id="defaultTab"><option value="talk">Talk — Nhấn giữ để nói</option><option value="tts">TTS — Nhập văn bản</option></select></label>
    <label>Thời gian tự ẩn thông báo <select id="notificationDuration"><option value="3">3 giây</option><option value="5">5 giây (mặc định)</option><option value="8">8 giây</option><option value="12">12 giây</option><option value="20">20 giây</option><option value="0">Không tự ẩn (đóng thủ công)</option></select></label>
    <p>Cảnh báo và trạng thái được hiển thị nổi trong thẻ, không làm tăng chiều cao. Thông báo đang xử lý sẽ hiển thị cho đến khi hoàn tất.</p>
    <p>Nếu để trống, dùng tts.wyoming_vietnamese. Language và Voice có thể nhập trực tiếp trên tab TTS.</p>
    <p>Chọn loa mặc định (để trống sẽ tự chọn loa đang khả dụng hoặc dùng lựa chọn đã lưu).</p>
    <div id="choices" class="choices"></div>`;
    this.shadowRoot.getElementById("name").value = this._config.name || "";
    this.shadowRoot.getElementById("name").addEventListener("change", (event) => {
      const next = {...this._config};
      if (event.target.value.trim()) next.name = event.target.value.trim();
      else delete next.name;
      this._emit(next);
    });
    this.shadowRoot.getElementById("ttsEntity").value = this._config.tts_entity || "";
    this.shadowRoot.getElementById("ttsEntity").addEventListener("change", (event) => {
      const next = {...this._config};
      if (event.target.value.trim()) next.tts_entity = event.target.value.trim();
      else delete next.tts_entity;
      this._emit(next);
    });
    const colorTheme = this.shadowRoot.getElementById("colorTheme");
    colorTheme.value = this._config.color_theme || "ha";
    const swatchWrap = this.shadowRoot.getElementById("themeSwatches");
    const swatchColors = {
      ha:["#3f536b","#73c6ef"], aurora:["#633fb1","#9bdaf6"], ocean:["#0055a4","#45cce9"],
      sunset:["#b63752","#ffbd89"], emerald:["#04775d","#92f1be"], graphite:["#293342","#e6c76c"]
    };
    const chooseTheme = (id) => {
      colorTheme.value = id;
      for (const button of swatchWrap.children) button.setAttribute("aria-pressed", String(button.dataset.theme === id));
      this._emit({...this._config, color_theme:id});
    };
    for (const [id, colors] of Object.entries(swatchColors)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.theme = id;
      button.setAttribute("aria-label", `Xem mẫu màu ${id}`);
      button.title = id === "ha" ? "Theo Home Assistant" : id;
      button.setAttribute("aria-pressed", String(colorTheme.value === id));
      button.style.background = `linear-gradient(120deg, ${colors.join(", ")})`;
      button.addEventListener("click", () => chooseTheme(id));
      swatchWrap.append(button);
    }
    colorTheme.addEventListener("change", (event) => chooseTheme(event.target.value));
    const defaultTab = this.shadowRoot.getElementById("defaultTab");
    defaultTab.value = this._config.default_tab || "talk";
    defaultTab.addEventListener("change", (event) => {
      this._emit({...this._config, default_tab:event.target.value});
    });
    const notificationDuration = this.shadowRoot.getElementById("notificationDuration");
    notificationDuration.value = String(this._config.notification_duration ?? 5);
    notificationDuration.addEventListener("change", (event) => {
      this._emit({...this._config, notification_duration:Number(event.target.value)});
    });
    const choices = this.shadowRoot.getElementById("choices");
    for (const speaker of this._speakers) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = speaker.entity_id;
      input.checked = (this._config.speakers || []).includes(speaker.entity_id);
      input.addEventListener("change", () => {
        const list = new Set(this._config.speakers || []);
        if (input.checked) list.add(input.value); else list.delete(input.value);
        const next = {...this._config};
        if (list.size) next.speakers = [...list]; else delete next.speakers;
        this._emit(next);
      });
      label.append(input, document.createTextNode(speaker.friendly_name || speaker.entity_id));
      choices.append(label);
    }
  }
}

if (!customElements.get("p2talk-google-cast-card"))
  customElements.define("p2talk-google-cast-card", P2TalkGoogleCastCard);
if (!customElements.get("p2talk-google-cast-compact-card"))
  customElements.define("p2talk-google-cast-compact-card", P2TalkGoogleCastCompactCard);
if (!customElements.get("p2talk-google-cast-editor"))
  customElements.define("p2talk-google-cast-editor", P2TalkGoogleCastEditor);

window.customCards = window.customCards || [];
for (const definition of [
  {type:"p2talk-google-cast-card",name:"P2Talk Google Cast — Full",description:"Thẻ gọn với hai tab Talk / TTS, thông báo tự ẩn và điều khiển Google Cast.",preview:false,documentationURL:"https://github.com/khaisilk1910/P2Talk-Google-Cast#readme"},
  {type:"p2talk-google-cast-compact-card",name:"P2Talk Google Cast — Compact",description:"Thẻ tối giản, hai tab Talk / TTS, hỗ trợ loa và thông báo nổi.",preview:false,documentationURL:"https://github.com/khaisilk1910/P2Talk-Google-Cast#readme"},
]) {
  if (!window.customCards.some((card) => card.type === definition.type))
    window.customCards.push(definition);
}
