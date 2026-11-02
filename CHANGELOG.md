# Changelog — P2Talk Google Cast

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
