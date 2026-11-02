# P2Talk Google Cast

**Push-to-Talk qua loa Google Cast, tích hợp trực tiếp vào Home Assistant — quản lý loa bằng Config Flow / Options Flow.**

[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2026.7%2B-41BDF5?logo=homeassistant)](https://www.home-assistant.io/)
[![HACS / Marketplace](https://img.shields.io/badge/HACS%20%2F%20Marketplace-custom%20integration-18BCF2)](https://www.hacs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

`P2Talk Google Cast` phiên bản **1.1.0** thay thế add-on **Voice Call** bằng một **custom integration** Home Assistant cài được qua **HACS** (Home Assistant 2026.10 trở về trước) và định dạng repository tương thích **Marketplace** (bắt đầu từ Home Assistant 2026.11).

> **Tình trạng:** phiên bản đầu tiên được tái triển khai và kiểm tra tĩnh/chuyển đổi âm thanh cục bộ. Chưa có xác nhận chạy end-to-end trên hệ thống Home Assistant + Google Cast thực tế. Vì đây là custom integration cộng đồng, hãy thử trước trên một hệ thống kiểm thử.

## Tính năng

- **Nhấn giữ để nói, thả để phát:** thu âm từ microphone trình duyệt/WebView, phát bản ghi ngay lên media player đã chọn.
- **Panel sidebar:** truy cập mục **P2Talk Google Cast** trong Home Assistant, trên máy tính và thiết bị di động.
- **Quản lý loa:** thêm, sửa entity, đổi tên, đặt âm lượng, xóa qua Options Flow. Panel CHỈ hiển thị những loa đã cấu hình; lệnh đến loa ngoài danh sách bị chặn ở backend.
- **Định dạng phù hợp Cast:** FFmpeg chuyển WebM/Opus, MP4, Ogg… sang MP3 mono 24 kHz; mặc định **64 kbps** tiết kiệm tài nguyên, bitrate chọn được.
- **Thiết lập đúng chuẩn:** cấu hình trong **Settings → Devices & services** bằng Config Flow và Options Flow; không cần YAML, Supervisor token hoặc API token tự tạo.
- **Không chặn khởi động:** chỉ đăng ký panel, static assets, WebSocket commands và lịch dọn dẹp; không quét network, không mở socket hoặc chạy FFmpeg khi khởi động. Quá trình chuyển đổi chỉ diễn ra khi gửi bản ghi.
- **Dọn dẹp:** file MP3 được giữ có giới hạn và dọn tự động mỗi giờ (không quét thư mục mỗi lần phát).
- **Bảo vệ tài nguyên:** WebSocket đã xác thực; allowlist loa + quyền điều khiển entity; giới hạn kích thước/chunk, số phiên đồng thời, thời gian chờ; giới hạn FFmpeg 1 thread; không mở CORS công khai.
- **Thời gian và chẩn đoán:** trả số mili giây của quá trình upload, FFmpeg, service HA lên panel; log INFO theo mã phiên ngắn và diagnostics của config entry, không log nội dung micro.

## Yêu cầu

1. **Home Assistant Core 2026.7.0 hoặc mới hơn** (đã dùng các API tương ứng với dòng 2026). Đối với 2026.11, xem mục Marketplace bên dưới.
> Tương thích schema: sử dụng import `voluptuous` cho Home Assistant 2026.7/2026.8; từ 2026.9, Home Assistant tự ánh xạ API này sang Probatio, giúp chạy với engine mới mà không tăng phụ thuộc.

2. **Google Cast integration** đã được thiết lập và loa hiển thị dưới dạng `media_player.*` hỗ trợ dịch vụ `media_player.play_media`. Một số media player khác cũng có thể hoạt động.
3. Home Assistant Core phải **có chương trình `ffmpeg` chạy được**. Bản add-on trước tự cài FFmpeg trong container riêng; HACS **không cài binary hệ thống**. Hãy thử đường dẫn mặc định `ffmpeg`; nếu báo lỗi, cài/cung cấp FFmpeg cho đúng môi trường chạy Core và cấu hình đường dẫn trong Options.
4. Home Assistant có **local media directory** (`media_dirs: local`) ghi được. URL nội bộ của HA phải được loa Google Cast truy cập được; tránh chỉ cấu hình external URL mà Cast không truy cập được.
5. **HTTPS hoặc secure context** cho microphone trong trình duyệt. Đảm bảo quyền micro của trình duyệt hoặc Home Assistant Companion App.

### Cài đặt bằng HACS (Home Assistant 2026.10 trở về trước)

1. Vào **HACS → Integrations** → menu **Custom repositories**.
2. Nhập `https://github.com/khaisilk1910/P2Talk-Google-Cast` và chọn loại **Integration**.
3. Mở **P2Talk Google Cast** → **Download**; khởi động lại Home Assistant để nạp custom integration.
4. Vào **Settings → Devices & services → Add integration**, tìm **P2Talk Google Cast** → xác nhận cài đặt.
5. Mở **Settings → Devices & services → P2Talk Google Cast → Configure → Add speaker** để thêm/đặt tên loa (hoặc chọn lúc tạo integration). Mở panel sidebar, chọn loa đã cấu hình rồi nhấn giữ nút micro.

### Home Assistant 2026.11 và mới hơn: Marketplace

Bắt đầu với phiên bản 2026.11, Home Assistant đưa HACS vào Core dưới tên **Marketplace**. Kho mã này giữ cấu trúc `custom_components/<domain>/`, `hacs.json` và metadata để tương thích cơ chế xuất bản mới. Khi đã xuất bản repo lên GitHub, chọn **Settings → Marketplace** và thêm repository tùy chỉnh nếu giao diện phiên bản của bạn hỗ trợ. Repository chưa được duyệt vào catalog chính thức nên **không tự xuất hiện** trong tìm kiếm cộng đồng. Cách sử dụng repository tuỳ chỉnh và mức độ hỗ trợ sẽ phụ thuộc phiên bản Marketplace.

### Cài đặt thủ công

Sao chép toàn bộ thư mục `custom_components/p2talk_google_cast` vào thư mục `/config/custom_components/p2talk_google_cast` trong Home Assistant. Khởi động lại Core, rồi thêm tích hợp trong **Devices & services**.

## Quản lý loa / cấu hình

**Settings → Devices & services → P2Talk Google Cast → Configure** mở menu:

| Tác vụ | Ý nghĩa |
| --- | --- |
| **Add speaker** | Chọn entity `media_player.*` từ Home Assistant, đặt tên tùy chỉnh và âm lượng mặc định. |
| **Edit speaker** | Đổi entity, tên hoặc âm lượng cho một loa hiện có. |
| **Remove speaker** | Xóa loa khỏi danh sách P2Talk (không xóa thực thể khỏi Home Assistant). |
| **Audio and performance settings** | Chỉnh bitrate, thời lượng thu, retention và FFmpeg. |

- Cài Google Cast integration của Home Assistant trước; P2Talk dùng media player có sẵn, không thực hiện discovery riêng.
- Chỉ những loa đã thêm mới xuất hiện trong dropdown panel. Loa offline/không có tính năng `PLAY_MEDIA` vẫn nằm trong cấu hình nhưng tạm không chọn để phát được.
- Chỉ admin mới chỉnh được Config Entry; người dùng khác phải có quyền READ/CONTROL đối với entity mới thấy và điều khiển được. Xóa loa sẽ có hiệu lực ngay ở backend, **không reload integration và không restart Home Assistant**. Nếu panel đang mở, nhấn **Làm mới**.
- Khi cập nhật từ phiên bản 1.0.0, danh sách loa ban đầu rỗng để tránh cấp quyền phát rộng như bản cũ; thêm loa vào Options trước khi sử dụng.

| Tùy chọn âm thanh | Mặc định | Phạm vi |
| --- | --- | --- |
| `audio_bitrate` | `64k` | `48k`, `64k`, `96k`, `128k` |
| `max_record_seconds` | `120` | 10–300 giây |
| `retention_hours` | `2` | 1–48 giờ |
| `default_volume` | `0.65` | 0.05–1.0 (dự phòng) |
| `ffmpeg_path` | `ffmpeg` | Chương trình FFmpeg chạy được trong HA Core |

Loa và cấu hình âm thanh được lưu trong Home Assistant Config Entry. Âm lượng riêng mỗi loa được nạp khi chọn loa; thanh kéo trong panel chỉ thay đổi lần gửi hiện tại. Loa được chọn gần nhất lưu riêng trong trình duyệt (localStorage).

## Hướng dẫn sử dụng

1. Truy cập Home Assistant qua HTTPS hoặc Companion App và cho phép dùng microphone.
2. Trong **Configure**, thêm loa `media_player` đã nhận qua Google Cast. Mở panel **P2Talk Google Cast**, chọn một loa đã thêm và đang online (hỗ trợ PLAY_MEDIA).
3. Chọn âm lượng; **nhấn giữ** biểu tượng microphone để thu âm, **thả** để gửi phát.
4. Bấm **Hủy** khi đang ghi để xóa bản ghi trong trình duyệt; bấm **Dừng loa** để yêu cầu media player ngừng phát.

Giới hạn một bản ghi là **8 MiB**, mỗi mẩu truyền tối đa **64 KiB** và có tối đa **3 phiên upload đồng thời**, mỗi tài khoản một phiên. Một upload không hoàn tất sẽ bị hủy sau **5 phút**. Giao diện gửi theo nhóm 6 mẩu (WebSocket bảo đảm thứ tự) để giảm round-trip time trên Wi-Fi. Một lúc tối đa 2 lệnh chuyển đổi FFmpeg; mỗi FFmpeg giới hạn một thread. Âm thanh thô trong RAM và file tạm được xóa sau khi xử lý; file MP3 cuối lưu tại local media path: `p2talk_google_cast/<uuid>.mp3` và bị dọn theo retention.

## Kiến trúc & hiệu năng

```text
Home Assistant sidebar (custom panel / JS)
    ↕ WebSocket đã đăng nhập của Home Assistant
custom_components/p2talk_google_cast/websocket.py
    ├── allowlist chỉ đọc loa đã cấu hình từ options + trạng thái hass.states
    ├── upload chunk có thứ tự, xử lý theo nhóm, kiểm tra dung lượng + quyền
    ├── chuyển FFmpeg bất đồng bộ (chỉ khi thả nút ghi)
    └── media_player.volume_set / play_media / media_stop
                      └── media-source://media_source/local/p2talk_google_cast/*.mp3
                           └── Home Assistant media proxy → loa Cast
```

Không có Docker container, Supervisor API, `requests`, `FastAPI`, `uvicorn`, `threading`, mở cổng 8098/8099, hoặc quá trình polling nền liên tục. WebSocket thừa hưởng session và chính sách permission của Home Assistant. Quét thư mục file MP3 được chuyển sang executor định kỳ; không dọn từng lượt phát. **Không tuyên bố tác động startup bằng 0:** Core vẫn phải tải các module và đăng ký panel; thiết kế chỉ tránh các tác vụ nặng và I/O bên ngoài trong thời gian setup.

## Lỗi thường gặp

- **Không thấy loa:** trước tiên mở **Configure → Add speaker**. P2Talk cố ý không hiển thị tất cả media player. Kiểm tra Google Cast, entity và tính năng `PLAY_MEDIA`.
- **Micro không hoạt động:** kiểm tra quyền microphone, HTTPS, WebView trên iOS/Android; một số WebView hạn chế MediaRecorder.
- **FFmpeg not found:** phần mềm FFmpeg phải có **bên trong môi trường chạy Home Assistant Core**, không phải chỉ trên máy tính cá nhân.
- **Đã gửi nhưng loa không phát:** kiểm tra local media path, `media_source`, URL nội bộ và kết nối từ loa tới HA. Google Cast cần tiếp cận URL media của HA trong mạng LAN.
- **Báo lỗi ủy quyền:** người dùng Home Assistant phải có quyền điều khiển entity media player được chọn.
- **Không có panel:** kiểm tra Config Entry đã được thêm trong Devices & services, thử xóa cache trang hoặc tải lại frontend.

## Tối ưu thời gian, CPU và chẩn đoán

- **CPU khi Home Assistant khởi động:** không quét mạng, chạy FFmpeg hoặc khởi chạy HTTP server. Đăng ký một panel, handler WebSocket và một timer dọn file mỗi giờ. Không có vòng polling loa.
- **CPU khi nói:** mic do trình duyệt xử lý; FFmpeg chỉ chạy sau khi thả nút, 1 thread, chuyển MP3 mono 24 kHz / 64 kbps mặc định. Không cần cloud speech-to-text, Google Assistant hoặc TTS; P2Talk chỉ truyền **âm thanh giọng nói nguyên bản**, không nhận diện lời nói.
- **Tốc độ:** 6 chunk upload có thể đồng thời chờ ack, không chờ từng chunk. Trước khi phát, bỏ qua `volume_set` nếu âm lượng đã gần mục tiêu (±2%). Số mili giây hiển thị ở panel chỉ đo quá trình backend, không đo thời điểm tiếng phát ra từ loa.
- **Local:** micro → browser/Companion App → WebSocket Home Assistant → file media local → Google Cast trong LAN. Nếu truy cập frontend HA từ Internet, đường browser↔HA có thể đi qua Internet; P2Talk không chủ động gửi dữ liệu tới dịch vụ bên ngoài. Thiết bị Cast có thể vẫn phụ thuộc dịch vụ Google cho tính năng riêng; tích hợp không cam kết toàn bộ phần cứng hoàn toàn offline.
- **Google Cast URL:** trong **Settings → System → Network**, cấu hình Home Assistant Internal URL bằng địa chỉ IP LAN truy cập được từ loa, ví dụ `http://192.168.x.x:8123`. Tránh chỉ dùng `.local`: Chromecast thường không phân giải địa chỉ kiểu này. Nếu mạng chia VLAN/subnet, cần cho phép truy cập HA 8123 và mDNS discovery phù hợp.

### Xem log và tải diagnostics

Vào **Settings → System → Logs** để xem thông điệp `custom_components.p2talk_google_cast`. Mỗi lần phát thành công có mã phiên rút gọn 8 ký tự và thống kê số byte, thời gian upload, FFmpeg, dịch vụ HA. Khi thất bại có mã session và stack trace phía server (nhưng **không** log dữ liệu audio hay token). Có thể bật debug theo chuẩn HA bằng:

```yaml
logger:
  default: warning
  logs:
    custom_components.p2talk_google_cast: debug
```

Hoặc bật **Enable debug logging** trên menu tích hợp nếu phiên bản HA có hỗ trợ. Trong menu của Config Entry, chọn **Download diagnostics** để xuất trạng thái loa, tính năng được công bố và tùy chọn (đường dẫn FFmpeg được ẩn); tuyệt đối không có nội dung ghi âm. Khi báo lỗi, nên kèm mã phiên trong log, thông tin runtime (HA OS/Container/Core), đường truyền LAN, định dạng âm thanh từ trình duyệt và diagnostics. Không chia sẻ bản ghi riêng tư.

## Phát triển và kiểm thử

```bash
python -m compileall -q custom_components/p2talk_google_cast
node --check custom_components/p2talk_google_cast/frontend/panel.js
python -m unittest discover -s tests -v
```

Thử nghiệm tích hợp thật cần Home Assistant 2026.10/2026.11 và ít nhất một loa Google Cast trên LAN. Nên kiểm tra xử lý input âm thanh WebM/MP4 qua trình duyệt di động, giới hạn tài nguyên, permission, reload Options, dọn ghi âm và ảnh hưởng startup trước khi public release.

## Tài liệu tham khảo / thiết kế

- [Home Assistant — Google Cast](https://www.home-assistant.io/integrations/cast/): phát media, discovery mDNS, địa chỉ URL nội bộ và hạn chế DNS trên Chromecast.
- [Google Cast — Supported media](https://developers.google.com/cast/docs/media): MP3, WAV, Ogg, WebM, Opus và các codec/format khác.
- [Home Assistant — Media source](https://www.home-assistant.io/integrations/media_source/): phát `media-source://` từ thư mục local tới loa.
- [Home Assistant Developer — Config Flow](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/): chuẩn nhập cấu hình qua UI và Options Flow.
- [Home Assistant Developer — Extending WebSocket API](https://developers.home-assistant.io/docs/frontend/extending/websocket-api/): command handler có xác thực phiên HA.
- [Home Intercom — Push-to-Talk](https://github.com/mdj2812/home-intercom): tham khảo so sánh lựa chọn xử lý WAV/PCM tại trình duyệt; P2Talk hiện ưu tiên nén MP3 cho Google Cast và hạn chế bộ nhớ/network, không tái sử dụng mã từ dự án này.

## Nguồn gốc và giấy phép

Được thiết kế lại dựa trên **mục tiêu và bộ tính năng** của add-on Voice Call trong archive do người dùng cung cấp. Bản này viết mới các module tích hợp, API và giao diện; **không mang theo Dockerfile, cấu hình add-on hay code server cũ**. Archive được cung cấp không có file LICENSE; nếu có ý định tái sử dụng trực tiếp mã của bên thứ ba trong tương lai, phải kiểm tra quyền và giấy phép của tác giả gốc.

Mã nguồn mới trong repository này được phát hành theo [MIT License](LICENSE).

## Phát hành tự động, đồng bộ manifest với GitHub Release

**Không tạo GitHub Release bằng nút _Draft a new release_** khi chưa cập nhật manifest. Tag trỏ tới một commit bất biến và HACS/Marketplace tải mã nguồn tại chính tag đó; cập nhật `manifest.json` trên `main` sau khi xuất bản **không sửa được nội dung của Release cũ**.

Repository có workflow [`.github/workflows/release.yaml`](.github/workflows/release.yaml). Khi cần phát hành:

1. Đẩy tất cả thay đổi mã nguồn lên nhánh `main` và bảo đảm CI chạy thành công.
2. Trên GitHub mở **Actions → Release P2Talk Google Cast → Run workflow**; chọn **Branch: main**.
3. Nhập **version** dạng `1.2.0` (không thêm `v`, không dùng `-beta`). Nếu lần đầu phát hành từ mã nguồn hiện có, có thể nhập `1.1.0`.
4. Workflow sẽ kiểm tra version/tag trùng lặp, tự cập nhật `custom_components/p2talk_google_cast/manifest.json`, chạy kiểm thử, commit/push thay đổi lên `main`, tạo tag **trên commit có manifest đã cập nhật**, rồi xuất bản GitHub Release kèm release notes tự động và ZIP tải thủ công.
5. Kiểm tra tag và phiên bản trong file `manifest.json` của Release tại **Releases → Assets → Source code (zip)**. Số version phải giống hệt tên tag.

Ví dụ: nhập `1.2.0` sẽ tạo tag `1.2.0`, manifest chứa `"version": "1.2.0"`, và asset `P2Talk-Google-Cast-1.2.0.zip`. HACS/Marketplace lấy phiên bản `1.2.0` từ **tagged source**, **không** lấy code đang thay đổi trên `main` và không dùng asset ZIP vì `hacs.json` chủ ý cấu hình `"zip_release": false`. `"hide_default_branch": true` giúp tránh cài nhầm bản development từ `main`.

Workflow cần quyền `contents: write` cho `GITHUB_TOKEN`; nếu bật Branch Protection, GitHub Actions phải được phép commit vào `main`, hoặc chuyển sang quy trình PR/merge trước khi tạo tag. Không cần tạo PAT hay đưa token vào repository. **Lưu ý:** push do `GITHUB_TOKEN` thực hiện thường không kích hoạt workflow `on: push` khác; vì vậy Release workflow tự chạy kiểm thử trước khi commit và tạo tag.

**Xử lý thất bại:** Nếu chưa có tag, sửa lỗi rồi chạy lại cùng version (script cho phép manifest đã bằng version cần phát hành). Nếu tag đã được đẩy nhưng GitHub Release chưa được xuất bản do lỗi API/mạng, hãy tạo Release từ **tag hiện có** sau khi xác minh version trong tag; không xóa/force-push tag đã công bố. Nếu tên tag đã tồn tại, workflow sẽ dừng thay vì ghi đè bản cũ.

Để được liệt kê trong catalog công khai, cần thực hiện quy trình duyệt repository và yêu cầu thương hiệu/icons của Home Assistant; **chỉ tạo repository và `hacs.json` không làm tích hợp tự xuất hiện trong catalog**.
