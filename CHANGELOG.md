# Changelog — P2Talk Google Cast

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
