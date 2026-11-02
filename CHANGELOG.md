## Unreleased — Automatic HTTPS on panel open

- Khi P2Talk được mở trong phiên Home Assistant HTTP, tự động chuyển sang HTTPS External/Internal URL do Home Assistant quản lý **trước khi nhấn micro**, không cần nhấn lần đầu hoặc thao tác refresh thủ công.
- Giữ nguyên trang trên HTTPS nếu đã có secure context, chống chuyển hướng lặp, xử lý lỗi điều hướng và không thêm lượt gọi WebSocket.
- Chỉ kiểm tra khi panel P2Talk được mở, không thêm tác vụ trong HA startup hay dashboard khác. HTTP → HTTPS vẫn cần một lần điều hướng theo chính sách trình duyệt.

## Unreleased — Native Home Assistant HTTPS URL

- Bỏ trường HTTPS microphone khỏi Options Flow, tự loại bỏ giá trị `mic_https_url` cũ nếu nâng cấp.
- Chỉ sử dụng HTTPS URL khai báo trong Home Assistant tại Settings → System → Network (ưu tiên External URL, dự phòng Internal URL HTTPS).
- Khi đang mở P2Talk qua HTTP LAN mà HA chưa có HTTPS URL, hiển thị thông báo và đường dẫn cấu hình rõ ràng; không báo lỗi microphone chung chung.
- Dùng panel cùng phiên Home Assistant và WebSocket xác thực như trước; không tạo cổng hay dịch vụ riêng. Không thay đổi cách Google Cast nhận URL media LAN.

## Unreleased — HTTPS microphone entry routing

- When opened on an insecure HTTP LAN origin, microphone press now offers/navigates to the configured Home Assistant HTTPS panel instead of attempting a blocked microphone request.
- Added optional HTTPS origin in the standard Options Flow, with fallback to Home Assistant internal/external HTTPS URLs and validation against unsafe/non-HTTPS redirects.
- Kept recordings, uploads, and playback in the existing authenticated Home Assistant panel; no new audio server or background task.

## Chưa phát hành — Microphone diagnostics

- Phân biệt HTTPS không an toàn, WebView thiếu API, MediaRecorder không hỗ trợ, lỗi quyền microphone và micro đang bận/không có.
- Chẩn đoán trên panel: HTTP/HTTPS, secure context, API, quyền microphone và mã lỗi, không tiết lộ URL hay dữ liệu ghi âm.
- Hướng dẫn khắc phục trực tiếp trong giao diện và README; không có tiến trình nền hoặc thay đổi upload API.

# Changelog — P2Talk Google Cast

## Unreleased — Live Concept UI

- Thay giao diện panel chạy thật bằng bố cục sát ảnh concept đã duyệt: banner xanh có hình loa Cast, logo micro tròn, thông báo sẵn sàng, chọn loa kèm trạng thái online, slider và nút micro có sóng âm lớn.
- Tự thay palette theo `hass.themes.darkMode`, có giao diện sáng/tối và breakpoint 320px; asset speaker WebP nội bộ dưới 10 KB, không tải ảnh ngoài Internet.
- Giữ nguyên WebSocket, quản lý loa, ghi âm/hủy/dừng, upload, log và giới hạn tài nguyên; không có bốn ô giới thiệu hay animation liên tục khi chờ.

## Unreleased — UI Redesign

- Giữ giao diện tập trung vào điều khiển: không hiển thị bốn ô giới thiệu Truyền nhanh / Bảo mật / Tiết kiệm tài nguyên / Tương thích tốt; dọn icon không sử dụng và thêm kiểm thử chống tái xuất hiện.

- Thiết kế lại panel cho theme sáng/tối với SVG icons, micro gradient, sóng âm, trạng thái ghi âm/gửi dữ liệu và khả năng truy cập tốt hơn.
- Bổ sung icon thương hiệu micro + Cast (PNG 256px/512px) trong `brand/`, phù hợp Home Assistant 2026.3+.
- Không thêm JS dependencies; hiệu ứng chỉ chạy khi tương tác, ghi âm hoặc truyền để tiết kiệm tài nguyên, tôn trọng reduced-motion.
- Nút quản lý loa mở cấu hình tích hợp; tăng độ bền khi localStorage bị chặn; URL JS tự tránh cache cũ sau khi cập nhật.

## Unreleased — CI / Packaging

- Thêm GitHub Actions release workflow đồng bộ `manifest.json` trước khi commit/tag/publish; ngăn tag trùng, downgrade và version sai định dạng.
- Đính kèm ZIP có manifest được kiểm tra từ tag; HACS/Marketplace cài từ tagged source tương ứng với số release.
- Bổ sung hướng dẫn release và kiểm thử cho công cụ cập nhật manifest.

## 1.1.0 — 2026-11-02

- Bổ sung trình quản lý loa trong Home Assistant Options Flow: thêm, sửa entity/tên/âm lượng và xóa loa.
- Panel chỉ hiển thị loa đã cấu hình; backend từ chối phát/dừng loa ngoài danh sách.
- Loa offline hiện trạng thái rõ ràng; cập nhật Options có hiệu lực không reload integration.
- Upload theo nhóm 6 chunk với index kiểm tra thứ tự để giảm round-trip time trên Wi-Fi.
- Mặc định MP3 mono 64 kbps; giới hạn 3 phiên upload / 8 MiB / TTL 5 phút; FFmpeg một thread.
- Bỏ qua volume_set nếu âm lượng hiện tại gần mục tiêu.
- Log phiên/trạng thái/thời gian rõ ràng, thêm chẩn đoán Diagnostics không lưu nội dung audio.
- Thêm kiểm thử logic allowlist, update tài liệu tối ưu LAN và troubleshooting.
- **Lưu ý:** bản cập nhật không tự cho phép loa cũ; hãy thêm loa trong Configure. Chưa kiểm thử trên Google Cast phần cứng thực tế.

## 1.0.0 — 2026-11-02

- Tái triển khai ý tưởng Push-to-Talk bằng custom integration Home Assistant.
- Cài qua HACS / chuẩn đóng gói Marketplace; Config Flow và Options Flow.
- Đăng ký panel sidebar sử dụng WebSocket được xác thực của Home Assistant.
- Truyền ghi âm theo chunk, giới hạn tài nguyên và xác minh quyền media player.
- Chuyển MP3 qua FFmpeg khi cần; phát bằng `media_source` và `media_player`.
- Dọn file ghi âm theo retention, có giới hạn đồng thời và thời gian chờ.
- Giao diện tiếng Việt, bản dịch cấu hình tiếng Anh/tiếng Việt, README, LICENSE và CI.

**Lưu ý:** Đây là phiên bản chuyển đổi đầu tiên; chưa xác nhận end-to-end trên thiết bị Google Cast thực tế.

- Giữ tương thích với Home Assistant 2026.7/2026.8 và engine Probatio của 2026.9+ qua API `voluptuous` tương thích.
