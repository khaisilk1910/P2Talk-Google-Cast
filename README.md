# P2Talk Google Cast

**Nhấn để nói, thả để phát giọng nói lên loa Google Cast ngay trong Home Assistant.**

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=khaisilk1910&repository=P2Talk-Google-Cast&category=integration)

## Tính năng

- **Push-to-Talk:** giữ nút micro để ghi âm, thả để phát lên loa đã chọn.
- **Quản lý loa:** thêm, sửa, đổi tên, đặt âm lượng mặc định và xóa loa trong phần cấu hình tích hợp. Giao diện chỉ hiển thị loa đã thêm.
- **Hoạt động qua mạng nội bộ:** dùng WebSocket và `media_player` của Home Assistant, không cần tài khoản hoặc API token riêng.
- **Giao diện sáng/tối tự thích ứng**, icon mới, trạng thái ghi âm/phát và sóng âm trực quan; **nhẹ và dễ kiểm tra lỗi:** chỉ chuyển đổi âm thanh bằng FFmpeg khi cần; hỗ trợ log và diagnostics.
- **Cấu hình bằng giao diện:** cài qua HACS/Marketplace, sử dụng trong panel của Home Assistant.

## Cài đặt

**Yêu cầu:** Home Assistant **2026.7+**, HACS hoặc Marketplace tương thích, tích hợp Google Cast và loa `media_player` đã hoạt động, FFmpeg khả dụng trong môi trường Home Assistant Core.

### Cài đặt nhanh — Add to HACS

Nhấn nút **Add to HACS** ở đầu trang, chọn Home Assistant của bạn, xác nhận thêm repository và chọn **Download**. Nút mở trang repository trong HACS (hoặc Marketplace ở phiên bản tương thích); **không tự động cài đặt mà không xác nhận**.

### Cài đặt thủ công qua HACS

1. Mở **HACS → ⋮ → Custom repositories**.
2. Nhập `https://github.com/khaisilk1910/P2Talk-Google-Cast`, chọn **Integration** → **Add**.
3. Chọn **P2Talk Google Cast → Download**, sau đó khởi động lại Home Assistant.
4. Vào **Settings → Devices & services → Add integration → P2Talk Google Cast**.
5. Mở **Configure → Add speaker**, thêm loa; vào panel **P2Talk Google Cast** để sử dụng.

> **Lưu ý:** Cho phép quyền microphone và truy cập Home Assistant qua HTTPS (hoặc ngữ cảnh bảo mật được trình duyệt hỗ trợ). Loa Cast phải truy cập được địa chỉ mạng nội bộ của Home Assistant; nên cấu hình **Internal URL** bằng IP LAN phù hợp.

## Bảo mật và quyền riêng tư

- Chỉ người dùng Home Assistant có quyền phù hợp mới có thể điều khiển loa đã được cấu hình; không mở web server hoặc cổng điều khiển riêng.
- Âm thanh được chuyển qua Home Assistant; file phát được **lưu tạm trong local media** và dọn theo thời hạn cấu hình (mặc định **2 giờ**). Hạn chế chia sẻ file âm thanh hoặc mở quyền truy cập không cần thiết.
- Tích hợp **không chủ động gửi giọng nói đến dịch vụ AI hoặc cloud riêng**. Tuy vậy, truy cập Home Assistant từ xa có thể đi qua Internet và thiết bị Google Cast vẫn có thể sử dụng dịch vụ của Google.

## Bản quyền, rủi ro và miễn trừ trách nhiệm

Phần mã nguồn của repository được cung cấp theo **[giấy phép MIT](LICENSE)**; thư viện và thương hiệu bên thứ ba thuộc về chủ sở hữu tương ứng. Dự án cộng đồng này **không liên kết hoặc được bảo trợ bởi Google hay Home Assistant**.

Phần mềm được cung cấp **“NGUYÊN TRẠNG” (AS IS), KHÔNG KÈM BẤT KỲ BẢO ĐẢM NÀO**. Việc sử dụng có thể gặp lỗi phát âm thanh, độ trễ, gián đoạn, thay đổi tương thích hoặc rủi ro quyền riêng tư. Bạn tự chịu trách nhiệm kiểm tra môi trường, bảo mật mạng và thiết bị trước khi sử dụng; nên thử nghiệm trước khi triển khai chính thức.

**Báo lỗi / góp ý:** [GitHub Issues](https://github.com/khaisilk1910/P2Talk-Google-Cast/issues)
