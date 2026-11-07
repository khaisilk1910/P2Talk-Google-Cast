# P2Talk Google Cast — Thẻ Lovelace cho Home Assistant

Nhấn giữ micro để ghi âm, thả để phát giọng nói lên một hoặc nhiều loa Google Cast đã được cấu hình trong Home Assistant.

**Phiên bản 1.4.2:** tự đăng ký tài nguyên Lovelace (khi Resources dùng chế độ mặc định storage), thêm **hai thẻ Full/Compact hoàn toàn qua giao diện UI**. Không còn sidebar, không tự điều hướng HTTPS và không sửa cấu hình các dashboard của bạn.

## Tính năng

- **P2Talk Full:** toàn bộ giao diện P2Talk trước đây: chọn nhiều loa, âm lượng chung, ghi âm, hủy, **Dừng các loa**, thông báo, chẩn đoán microphone, chỉ số xử lý và lối tắt quản lý loa.
- **P2Talk Compact:** chỉ các điều khiển chính: **chọn loa, âm lượng, nhấn giữ để ghi âm**; hiện cảnh báo HTTPS hoặc lỗi khi cần. Không có nút dừng để giữ thẻ gọn.
- Hoạt động trong dashboard Lovelace **Sections, Masonry và các bố cục thẻ chuẩn**, hỗ trợ đổi kích thước tự nhiên, giao diện sáng/tối và **trình sửa cấu hình trực quan** (đặt tên và chọn loa mặc định).
- Ghi âm qua API micro của trình duyệt và WebSocket được xác thực bằng Home Assistant; chuyển đổi qua FFmpeg **chỉ khi gửi âm thanh**. Không tạo worker âm thanh thường trực, không cần token.
- Gửi lệnh điều khiển qua các action chính thức của Home Assistant, không mở cổng điều khiển riêng.

## Yêu cầu

- Home Assistant **2026.7+** (đã đối chiếu tài liệu Marketplace/Home Assistant 2026.11); hỗ trợ frontend Lovelace mới và custom card resource.
- Tích hợp Google Cast đang chạy, có ít nhất một `media_player` khả dụng; FFmpeg sẵn có cho Home Assistant Core.
- Trình duyệt hoặc Home Assistant Companion App hỗ trợ MediaRecorder và micro. **Phải mở dashboard bằng HTTPS hợp lệ** để ghi âm (kể cả khi truy cập mạng LAN), trừ ngoại lệ sandbox mà P2Talk chủ động không dựa vào.

## Cài đặt và cập nhật

**Khắc phục lỗi cài đặt trên 1.4.0:** Bản 1.4.1 sửa lỗi thiếu hằng số `NAME` khiến `config_flow.py` không được Home Assistant nạp (`Invalid handler specified`). Nếu đã chép bản 1.4.0, hãy chép đè toàn bộ thư mục `custom_components/p2talk_google_cast` từ bản mới, khởi động lại Home Assistant Core, rồi thử **Add integration**. Không cần xóa dữ liệu hoặc sửa `.storage`.

1. **Home Assistant 2026.11+:** vào **Settings → Marketplace**, cài P2Talk nếu repository đã có trong danh mục, hoặc thêm URL GitHub của P2Talk qua mục **Custom repositories**. Khi Marketplace cài mới và tự mở Config Flow, có thể thiết lập ngay mà **không cần khởi động lại**. **Nếu đang nâng cấp tích hợp đã cài**, hãy khởi động lại Home Assistant Core để nạp Python mới. Với **HACS cũ hoặc cài thủ công**, sao chép `custom_components/p2talk_google_cast` vào `/config/custom_components/` rồi khởi động lại Core.
2. Vào **Settings → Devices & services → Add integration → P2Talk Google Cast**; mở **Configure → Add speaker** để thêm loa.
3. Resource JavaScript được P2Talk **tự động đăng ký** trong **Settings → Dashboards → ⋮ → Resources** ở chế độ mặc định (storage). Bạn **không cần thêm URL, không cần YAML**.
4. **Làm mới toàn bộ trang Home Assistant** sau khi cài mới hoặc nâng cấp (và sau khi khởi động lại, nếu có). Mở dashboard → **Edit dashboard → Add card**, tìm `P2Talk Google Cast` trong nhóm thẻ custom/community. Chọn **P2Talk Google Cast — Full** hoặc **P2Talk Google Cast — Compact**.
5. Trong trình chỉnh sửa **trực quan** của thẻ, nhập tên thẻ nếu muốn và tích chọn một hoặc nhiều loa mặc định → **Save**. Không dùng trình soạn YAML.

Nếu cài đặt từ bản 1.3.0: Resource `/p2talk_google_cast_assets/cards.js` đã đăng ký thủ công sẽ được **sử dụng lại và tự cập nhật phiên bản**, không thêm bản trùng. Sau khi nâng cấp từ bản sidebar cũ, panel P2Talk không còn; có thể xóa resource `panel.js` cũ nếu đã đăng ký thủ công.

**Sửa lỗi event loop trong 1.4.2:** Bản 1.4.1 gọi `Path.read_text()` trên event loop khi đọc `manifest.json` lúc tự đăng ký Lovelace Resource. Bản này dùng `homeassistant.loader.async_get_integration()` để lấy phiên bản từ metadata đã cache bởi Home Assistant, không mở lại tệp trên event loop. Resource được gắn query version để browser không dùng JS cũ. Khi kiểm tra Diagnostics của P2Talk, trường `resource_registration` báo `registered`, `updated`, `already_registered`, `yaml_mode` hoặc `failed` để dễ đối chiếu với Logs.

**Cách đăng ký an toàn:** tích hợp phục vụ JS bằng static path, sau đó đăng ký resource qua API storage chính thức của Home Assistant **sau khi khởi động hoàn tất**. Trước mọi thao tác, tài nguyên Lovelace phải được nạp từ storage; P2Talk chỉ tìm/chỉnh URL `cards.js` của chính mình, không ghi trực tiếp `.storage`, không sửa layout và không thêm resource của thẻ khác. Thẻ chỉ gọi WebSocket lấy loa khi người dùng thực sự mở dashboard có đặt thẻ.

**Lưu ý:** card picker cần trình duyệt nạp JS đã đăng ký. Nếu vừa cài mà chưa thấy thẻ, làm mới trang bằng Ctrl+Shift+R rồi mở lại **Add card**. Đăng ký tự động không có hiệu lực khi `resource_mode: yaml` vì Home Assistant chỉ đọc danh sách tài nguyên từ YAML trong chế độ đó; xem hướng dẫn dưới đây.

### Nếu đang quản lý Resources bằng YAML

Thêm **một** resource vào cấu hình `lovelace` hiện có của `configuration.yaml` (không tạo một khóa `lovelace:` trùng lặp):

```yaml
lovelace:
  resource_mode: yaml
  resources:
    - url: /p2talk_google_cast_assets/cards.js
      type: module
```

Sau khi cấu hình hợp lệ, gọi action `lovelace.reload_resources` và làm mới trình duyệt. Không cần cấu hình `resource_mode: yaml` nếu bạn đã quản lý Resources qua UI.

### Tùy chọn nâng cao: Dùng thẻ bằng YAML (không bắt buộc)

**Full:**

```yaml
type: custom:p2talk-google-cast-card
name: P2Talk phòng khách
speakers:
  - media_player.living_room
```

**Compact:**

```yaml
type: custom:p2talk-google-cast-compact-card
name: Micro nhanh
speakers:
  - media_player.bedroom
```

`name` và `speakers` đều không bắt buộc. Khi chưa chọn trước `speakers`, thẻ chọn loa đã lưu hoặc loa khả dụng đầu tiên. Bạn có thể chọn nhiều loa bằng danh sách chọn ngay trên thẻ. Âm lượng được đặt khi gửi bản ghi, không tự thay đổi âm lượng loa lúc kéo thanh trượt.

## HTTP và HTTPS

P2Talk **không bao giờ tự đổi URL hoặc chuyển trang**. Nếu đang mở Home Assistant bằng `http://192.168.x.x:8123`, thẻ vẫn hiển thị chọn loa và âm lượng, nhưng nút **Nhấn giữ để nói** sẽ mờ/khóa và có cảnh báo cần HTTPS ngay trên thẻ. Nếu đã mở bằng HTTPS tin cậy, nút micro được bật khi có loa được chọn và API trình duyệt hoạt động.

Cấu hình HTTPS trực tiếp cho Home Assistant hoặc thông qua reverse proxy/Tunnel và dùng URL HTTPS đó để mở dashboard. Nếu bạn muốn audio chỉ đi trong LAN, sử dụng HTTPS nội bộ (ví dụ reverse proxy + Split DNS + chứng chỉ tin cậy). HTTPS không tự cấp quyền microphone; khi được trình duyệt hỏi, hãy chấp nhận quyền micro.

## Cơ chế dừng phát Google Cast

Nút **Dừng các loa** trong bản Full gửi WebSocket có xác thực về Home Assistant. Backend kiểm tra allowlist, quyền điều khiển, trạng thái và `supported_features` của từng `media_player`:

- Nếu thiết bị hỗ trợ **STOP**, gọi `media_player.media_stop` với `target.entity_id` qua Service Registry của Home Assistant.
- Nếu **không hỗ trợ STOP** nhưng hỗ trợ **PAUSE**, gọi `media_player.media_pause` và thông báo rõ là *tạm dừng* chứ không phải dừng hẳn.
- Nếu loa đã `idle`/`off`/`standby`, xem như đã dừng; nếu offline hoặc lỗi service, đưa vào danh sách thất bại mà **không chặn những loa còn lại**.

Gửi action thành công có nghĩa Home Assistant đã xử lý yêu cầu; loa Cast có thể cần thêm thời gian để cập nhật trạng thái. Nếu bạn vẫn không dừng được, vào **Developer tools → Actions**, gọi thử `media_player.media_stop` trực tiếp cho entity tương ứng và xem **Settings → System → Logs**.

## Hiệu năng, bảo mật và tương thích

- Không sidebar, không đăng ký panel, không sửa dashboard hoặc resource của tích hợp khác; chỉ tự đăng ký URL `cards.js` vào Lovelace storage sau khi khởi động. Không network discovery hoặc FFmpeg khi khởi động.
- CSS dùng **Shadow DOM** để tránh ảnh hưởng giao diện/theme của các thẻ khác; các thẻ tái sử dụng một stylesheet; card Compact không tạo các chi tiết trang trí nặng của bản Full.
- Mỗi thẻ chỉ gọi `p2talk_google_cast/speakers` khi khởi tạo và khi người dùng chủ động refresh/quay lại tab; cập nhật `hass` thường xuyên chỉ so sánh trạng thái các loa liên quan, không quét toàn bộ hệ thống.
- Bản Full tải hình ảnh cục bộ bằng `loading="lazy"`; không phụ thuộc CDN hoặc font ngoài.
- Không gửi âm thanh tới máy chủ AI. Audio tải lên qua WebSocket đã đăng nhập được lưu tạm tại local media rồi dọn theo thời gian cấu hình (mặc định 2 giờ). Thiết bị Google Cast hoặc phương thức truy cập từ xa vẫn có thể dùng hạ tầng bên ngoài của chúng.

**Kiểm thử:** `python -m unittest discover -s tests -v` và `node tests/test_microphone.cjs`; thử giao diện tùy chọn với `python tests/browser_cards.py` (cần Chromium và Playwright). Các bài này **không thay thế kiểm thử trên một Home Assistant Core thực và loa Cast thật**.

Nguồn mở theo [MIT License](LICENSE). Đây là dự án cộng đồng, không liên kết với Google hoặc Home Assistant. [Báo lỗi / góp ý](https://github.com/khaisilk1910/P2Talk-Google-Cast/issues).

## Đăng ký trong Marketplace và HACS

Tích hợp là **một repository loại `integration`** với `hacs.json` ở gốc, và `custom_components/p2talk_google_cast/` chứa trọn mã Python, cấu hình, bản dịch và `frontend/cards.js`. Marketplace 2026.11 và HACS trước đó đều đọc cấu trúc này. **Không đăng ký cùng repository thành plugin riêng** để tránh cài hai Resource khác nhau. Khi Marketplace cài đặt qua GitHub release, `manifest.json.version` trong tag phải trùng tên phiên bản release. Workflow `.github/workflows/release.yaml` thực hiện việc đó.

Trước khi gửi repository lên danh mục chính thức, chạy GitHub Actions **HACS validation** và **Hassfest validation**, thêm mô tả, topics, bật Issues và phát hành một GitHub Release. Bản ZIP thủ công không tự tạo GitHub release hoặc xuất bản lên Marketplace. Để được tìm thấy trong danh mục công khai, chủ repository cần gửi pull request lên `hacs/default` và được chấp thuận; vẫn có thể cài như custom repository trước khi được duyệt.

**Thông tin chẩn đoán:** Vào Settings → Devices & services → P2Talk Google Cast → Download diagnostics; trường `resource_registration` cho biết liệu Lovelace module đã đăng ký hay đang bị chặn bởi resource_mode YAML / lỗi storage. Với lỗi phát/dừng loa, bật `logger` với namespace `custom_components.p2talk_google_cast` ở mức `debug` chỉ khi cần thiết, sau đó tắt để giữ log gọn.
