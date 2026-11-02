/**
 * P2Talk Google Cast — Home Assistant custom sidebar panel.
 * Home Assistant supplies the authenticated `hass.callWS` API; this panel
 * never stores credentials, makes direct Supervisor requests or opens ports.
 */

const DOMAIN = "p2talk_google_cast";
const CHUNK_BYTES = 48 * 1024;
const UPLOAD_WINDOW = 6; // amortize Wi-Fi/WebSocket RTT while keeping ordering
const STORAGE_PREFIX = "p2talk_google_cast_";

const styles = `
:host { display:block; min-height:100%; color:var(--primary-text-color,#f8fafc); font-family:var(--paper-font-body1_-_font-family,system-ui,-apple-system,'Segoe UI',sans-serif); }
* { box-sizing:border-box; }
.wrap { min-height:100%; display:grid; align-items:start; justify-items:center; padding:clamp(16px,4vw,40px) 16px max(28px,env(safe-area-inset-bottom)); background:var(--primary-background-color,#0c1424); }
.surface { width:min(100%,500px); border:1px solid var(--divider-color,rgba(148,163,184,.18)); border-radius:24px; background:var(--card-background-color,#172033); box-shadow:0 16px 48px rgba(0,0,0,.12); padding:clamp(18px,4vw,32px); }
.head { display:flex; gap:14px; align-items:center; padding-bottom:22px; margin-bottom:22px; border-bottom:1px solid var(--divider-color,rgba(148,163,184,.18)); }
.symbol { width:52px; height:52px; border-radius:17px; flex:none; background:linear-gradient(130deg,#2563eb,#0ea5e9); display:grid; place-items:center; font-size:27px; color:white; }
h1 { margin:0; font-size:21px; font-weight:750; line-height:1.3; letter-spacing:-.4px; }
.subtitle { margin:4px 0 0; color:var(--secondary-text-color,#94a3b8); font-size:13px; }
.field { margin:0 0 22px; }
.field-top { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; }
label { font-size:13px; font-weight:650; color:var(--secondary-text-color,#94a3b8); }
select { width:100%; padding:13px 15px; font-size:16px; border:1px solid var(--divider-color,#526277); border-radius:12px; background:var(--primary-background-color,#0c1424); color:var(--primary-text-color,#fff); }
input[type=range] { width:100%; accent-color:var(--primary-color,#3498db); }
.volume { display:flex; align-items:center; gap:13px; border:1px solid var(--divider-color,#526277); padding:9px 14px; border-radius:12px; }
.volume output { width:46px; text-align:end; font-variant-numeric:tabular-nums; font-size:14px; font-weight:700; }
.mic-area { display:grid; justify-items:center; padding:18px 0 24px; }
.mic { border:0; border-radius:50%; width:144px; height:144px; font-size:57px; cursor:pointer; color:white; background:linear-gradient(130deg,#2563eb,#0ea5e9); box-shadow:0 14px 34px rgba(37,99,235,.32); touch-action:none; user-select:none; transition:transform .15s ease,background .15s ease; }
.mic:hover:not(:disabled) { transform:scale(1.035); }
.mic.recording { background:linear-gradient(130deg,#dc2626,#f97316); box-shadow:0 14px 36px rgba(220,38,38,.3); animation:pulse 1.5s ease-in-out infinite; }
.mic:disabled { opacity:.45; cursor:not-allowed; }
@keyframes pulse { 50% { box-shadow:0 0 0 14px rgba(220,38,38,.08); } }
.hint { font-size:16px; font-weight:700; margin:20px 0 6px; text-align:center; }
.counter { color:var(--secondary-text-color,#94a3b8); font-size:13px; height:19px; font-variant-numeric:tabular-nums; }
.actions { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
button.small { color:var(--primary-text-color,#f8fafc); border:1px solid var(--divider-color,#526277); background:transparent; border-radius:12px; padding:12px 16px; cursor:pointer; font-size:14px; font-weight:650; }
button.small:disabled { opacity:.4; cursor:default; }
button.subtle { border:0; padding:5px 9px; color:var(--primary-color,#03a9f4); background:none; cursor:pointer; font-size:13px; font-weight:650; }
.status { min-height:46px; margin-top:18px; padding:14px; text-align:center; background:var(--primary-background-color,#0c1424); border-radius:12px; border:1px solid var(--divider-color,#526277); font-size:13px; color:var(--secondary-text-color,#94a3b8); overflow-wrap:anywhere; }
.status.error { color:#ef6c6c; border-color:rgba(239,68,68,.45); }
.status.success { color:var(--success-color,#22a668); border-color:rgba(16,185,129,.45); }
.status.loading { color:var(--primary-color,#03a9f4); }
.note { margin:17px 0 0; line-height:1.5; color:var(--secondary-text-color,#94a3b8); font-size:12px; text-align:center; }
@media (prefers-reduced-motion:reduce) { .mic { animation:none!important; transition:none; } }
`;

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
  }
  get hass() { return this._hass; }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="wrap"><main class="surface">
        <header class="head"><span class="symbol" aria-hidden="true">🎙</span>
          <div><h1>P2Talk Google Cast</h1><p class="subtitle">Push-to-Talk · Home Assistant</p></div>
        </header>
        <div class="field">
          <div class="field-top"><label for="speaker">Loa nhận giọng nói</label><button type="button" class="subtle" id="refresh">↻ Làm mới</button></div>
          <select id="speaker" aria-label="Chọn loa"><option value="">Đang tải loa...</option></select>
        </div>
        <div class="field"><div class="field-top"><label for="volume">Âm lượng phát</label></div>
          <div class="volume"><span aria-hidden="true">🔊</span><input id="volume" type="range" min="5" max="100" value="65" /><output id="volumeText">65%</output></div>
        </div>
        <section class="mic-area" aria-label="Ghi âm">
          <button id="mic" class="mic" type="button" disabled aria-label="Nhấn giữ để nói" title="Nhấn giữ để nói">🎙</button>
          <p id="hint" class="hint">Nhấn giữ để nói</p><div id="counter" class="counter"></div>
        </section>
        <div class="actions"><button type="button" class="small" id="cancel" disabled>✕ Hủy</button>
        <button type="button" class="small" id="stop">■ Dừng loa</button></div>
        <div id="status" class="status" role="status" aria-live="polite">Đang kết nối Home Assistant...</div>
        <div id="metrics" class="note" aria-live="polite"></div>
        <p class="note">Âm thanh được gửi qua kết nối Home Assistant đã đăng nhập.<br />Không cần API token hoặc cổng mạng riêng.</p>
      </main></div>`;
    this.$ = (id) => this.shadowRoot.getElementById(id);
    this.$("refresh").addEventListener("click", () => this._loadSpeakers());
    this.$("speaker").addEventListener("change", (e) => {
      localStorage.setItem(`${STORAGE_PREFIX}speaker`, e.target.value);
      this._applySpeakerVolume();
      this._refreshControls();
    });
    this.$("volume").addEventListener("input", (e) => {
      this.$("volumeText").textContent = `${e.target.value}%`;
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
    if (this._recorder && this._recorder.state !== "inactive") {
      this._discard = true;
      this._recorder.stop();
    }
    this._stopTracks();
  }

  _status(message, type = "") {
    const el = this.$("status");
    if (el) { el.textContent = message; el.className = `status ${type}`; }
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
      const previous = select.value || localStorage.getItem(`${STORAGE_PREFIX}speaker`);
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
        option.textContent = `${speaker.friendly_name} (${speaker.state})`;
        option.disabled = !speaker.is_available;
        select.append(option);
      }
      if (previous && speakers.some((s) => s.entity_id === previous && s.is_available)) select.value = previous;
      if (!select.value) {
        const firstOnline = speakers.find((s) => s.is_available);
        if (firstOnline) select.value = firstOnline.entity_id;
      }
      if (!this._recording && !this._sending) this._applySpeakerVolume();
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
      this.$("mic").classList.add("recording");
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
    this.$("mic").classList.remove("recording");
    this.$("hint").textContent = cancel ? "Đã hủy" : "ĐANG GỬI ĐẾN LOA...";
    this._refreshControls();
    if (cancel) this._status("Đã hủy bản ghi âm.");
    if (this._recorder && this._recorder.state !== "inactive") this._recorder.stop();
    else this._stopTracks();
  }

  async _handleRecordingStopped() {
    this._stopTracks();
    if (this._discard || !this._chunks.length || !this.isConnected) {
      this._chunks = [];
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("counter").textContent = "";
      return;
    }
    const chunks = this._chunks;
    this._chunks = [];
    const blob = new Blob(chunks, { type:this._recorder?.mimeType || "audio/webm" });
    if (blob.size > this._maxBytes) {
      this._status("Bản ghi âm quá lớn. Hãy ghi ngắn hơn.", "error");
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
      this.$("hint").textContent = "Nhấn giữ để nói";
      this.$("counter").textContent = "";
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
