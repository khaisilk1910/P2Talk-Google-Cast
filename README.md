# P2Talk Google Cast

**Push-to-Talk qua loa Google Cast, tích hợp trực tiếp vào Home Assistant.**

[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2026.7%2B-41BDF5?logo=homeassistant)](https://www.home-assistant.io/)
[![HACS / Marketplace](https://img.shields.io/badge/HACS%20%2F%20Marketplace-custom%20integration-18BCF2)](https://www.hacs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

`P2Talk Google Cast` thay thế add-on **Voice Call** bằng một **custom integration** Home Assistant cài được qua **HACS** (Home Assistant 2026.10 trở về trước) và định dạng repository tương thích **Marketplace** (bắt đầu từ Home Assistant 2026.11).

> **Tình trạng:** phiên bản đầu tiên được tái triển khai và kiểm tra tĩnh/chuyển đổi âm thanh cục bộ. Chưa có xác nhận chạy end-to-end trên hệ thống Home Assistant + Google Cast thực tế. Vì đây là custom integration cộng đồng, hãy thử trước trên một hệ thống kiểm thử.

## Tính năng

- **Nhấn giữ để nói, thả để phát:** thu âm từ microphone trình duyệt/WebView, phát bản ghi ngay lên media player đã chọn.
- **Panel sidebar:** truy cập mục **P2Talk Google Cast** trong Home Assistant, trên máy tính và thiết bị di động.
- **Chọn loa & điều chỉnh âm lượng:** hiển thị các thực thể `media_player` hỗ trợ `PLAY_MEDIA` (ưu tiên tên có dấu hiệu Google Cast); gửi lệnh dừng phát.
- **Định dạng phù hợp Cast:** FFmpeg chuyển WebM/Opus, MP4, Ogg… sang MP3 mono 24 kHz; bitrate chọn được.
- **Thiết lập đúng chuẩn:** cấu hình trong **Settings → Devices & services** bằng Config Flow và Options Flow; không cần YAML, Supervisor token hoặc API token tự tạo.
- **Không chặn khởi động:** chỉ đăng ký panel, static assets, WebSocket commands và lịch dọn dẹp; không quét network, không mở socket hoặc chạy FFmpeg khi khởi động. Quá trình chuyển đổi chỉ diễn ra khi gửi bản ghi.
- **Dọn dẹp:** file MP3 được giữ có giới hạn và dọn tự động mỗi giờ, đồng thời kiểm tra sau khi phát thành công.
- **Bảo vệ tài nguyên:** thông điệp WebSocket của Home Assistant đã xác thực; kiểm tra quyền điều khiển entity; giới hạn kích thước/chunk, số phiên đồng thời, thời gian chờ; không mở CORS công khai.

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
5. Mở **P2Talk Google Cast** ở thanh sidebar, chọn loa và nhấn giữ nút microphone.

### Home Assistant 2026.11 và mới hơn: Marketplace

Bắt đầu với phiên bản 2026.11, Home Assistant đưa HACS vào Core dưới tên **Marketplace**. Kho mã này giữ cấu trúc `custom_components/<domain>/`, `hacs.json` và metadata để tương thích cơ chế xuất bản mới. Khi đã xuất bản repo lên GitHub, chọn **Settings → Marketplace** và thêm repository tùy chỉnh nếu giao diện phiên bản của bạn hỗ trợ. Repository chưa được duyệt vào catalog chính thức nên **không tự xuất hiện** trong tìm kiếm cộng đồng. Cách sử dụng repository tuỳ chỉnh và mức độ hỗ trợ sẽ phụ thuộc phiên bản Marketplace.

### Cài đặt thủ công

Sao chép toàn bộ thư mục `custom_components/p2talk_google_cast` vào thư mục `/config/custom_components/p2talk_google_cast` trong Home Assistant. Khởi động lại Core, rồi thêm tích hợp trong **Devices & services**.

## Cấu hình

Mở **Settings → Devices & services → P2Talk Google Cast → Configure (Options)**.

| Tuỳ chọn | Mặc định | Phạm vi |
| --- | --- | --- |
| `audio_bitrate` | `96k` | `64k`, `96k`, `128k`, `192k` |
| `max_record_seconds` | `120` | 10–300 giây |
| `retention_hours` | `2` | 1–48 giờ |
| `default_volume` | `0.65` | 0.05–1.0 |
| `ffmpeg_path` | `ffmpeg` | Lệnh hoặc đường dẫn tới executable |

Cấu hình được lưu trong Home Assistant Config Entry; chỉnh Options tự reload integration (không cần restart toàn bộ Home Assistant). Âm lượng cuối cùng và loa được chọn được lưu theo trình duyệt bằng `localStorage`, không gửi lên đám mây riêng.

## Hướng dẫn sử dụng

1. Truy cập Home Assistant qua HTTPS hoặc Companion App và cho phép dùng microphone.
2. Mở panel **P2Talk Google Cast**, chọn một loa đang online (hỗ trợ PLAY_MEDIA).
3. Chọn âm lượng; **nhấn giữ** biểu tượng microphone để thu âm, **thả** để gửi phát.
4. Bấm **Hủy** khi đang ghi để xóa bản ghi trong trình duyệt; bấm **Dừng loa** để yêu cầu media player ngừng phát.

Giới hạn một bản ghi là **12 MiB**, mỗi mẩu truyền tối đa **64 KiB** và có tối đa **8 phiên upload đồng thời**, mỗi tài khoản một phiên. Một upload không hoàn tất sẽ bị hủy sau 10 phút. Âm thanh thô trong RAM và file tạm được xóa sau khi xử lý; file MP3 cuối lưu tại local media path: `p2talk_google_cast/<uuid>.mp3` và bị dọn theo retention.

## Kiến trúc & hiệu năng

```text
Home Assistant sidebar (custom panel / JS)
    ↕ WebSocket đã đăng nhập của Home Assistant
custom_components/p2talk_google_cast/websocket.py
    ├── danh sách media_player lấy trực tiếp từ hass.states (không HTTP API / token)
    ├── upload mẩu nhỏ, kiểm tra kích thước + quyền truy cập
    ├── chuyển FFmpeg bất đồng bộ (chỉ khi thả nút ghi)
    └── media_player.volume_set / play_media / media_stop
                      └── media-source://media_source/local/p2talk_google_cast/*.mp3
                           └── Home Assistant media proxy → loa Cast
```

Không có Docker container, Supervisor API, `requests`, `FastAPI`, `uvicorn`, `threading`, mở cổng 8098/8099, hoặc quá trình polling nền liên tục. WebSocket thừa hưởng session và chính sách permission của Home Assistant. Quét thư mục file MP3 được chuyển sang executor định kỳ. **Không tuyên bố tác động startup bằng 0:** Core vẫn phải tải các module và đăng ký panel; thiết kế chỉ tránh các tác vụ nặng và I/O bên ngoài trong thời gian setup.

## Lỗi thường gặp

- **Không thấy loa:** kiểm tra tích hợp Google Cast và tính năng `PLAY_MEDIA` của `media_player`; không phải mọi thiết bị Cast đã được khám phá đều hỗ trợ phát file âm thanh.
- **Micro không hoạt động:** kiểm tra quyền microphone, HTTPS, WebView trên iOS/Android; một số WebView hạn chế MediaRecorder.
- **FFmpeg not found:** phần mềm FFmpeg phải có **bên trong môi trường chạy Home Assistant Core**, không phải chỉ trên máy tính cá nhân.
- **Đã gửi nhưng loa không phát:** kiểm tra local media path, `media_source`, URL nội bộ và kết nối từ loa tới HA. Google Cast cần tiếp cận URL media của HA trong mạng LAN.
- **Báo lỗi ủy quyền:** người dùng Home Assistant phải có quyền điều khiển entity media player được chọn.
- **Không có panel:** kiểm tra Config Entry đã được thêm trong Devices & services, thử xóa cache trang hoặc tải lại frontend.

## Phát triển và kiểm thử

```bash
python -m compileall -q custom_components/p2talk_google_cast
node --check custom_components/p2talk_google_cast/frontend/panel.js
python -m unittest discover -s tests -v
```

Thử nghiệm tích hợp thật cần Home Assistant 2026.10/2026.11 và ít nhất một loa Google Cast trên LAN. Nên kiểm tra xử lý input âm thanh WebM/MP4 qua trình duyệt di động, giới hạn tài nguyên, permission, reload Options, dọn ghi âm và ảnh hưởng startup trước khi public release.

## Nguồn gốc và giấy phép

Được thiết kế lại dựa trên **mục tiêu và bộ tính năng** của add-on Voice Call trong archive do người dùng cung cấp. Bản này viết mới các module tích hợp, API và giao diện; **không mang theo Dockerfile, cấu hình add-on hay code server cũ**. Archive được cung cấp không có file LICENSE; nếu có ý định tái sử dụng trực tiếp mã của bên thứ ba trong tương lai, phải kiểm tra quyền và giấy phép của tác giả gốc.

Mã nguồn mới trong repository này được phát hành theo [MIT License](LICENSE).

## Phát hành và đóng góp cho catalog

Sau khi đưa mã nguồn lên GitHub, có thể tạo tag `1.0.0` và GitHub Release để HACS / Marketplace nhận diện bản phát hành. Để được liệt kê trong catalog công khai, cần thực hiện quy trình duyệt repository và yêu cầu thương hiệu/icons của Home Assistant; **chỉ tạo repository và `hacs.json` không làm tích hợp tự xuất hiện trong catalog**.
