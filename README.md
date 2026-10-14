# MỘC — Cửa hàng quần áo

HTML, Tailwind CSS, JavaScript thuần; Express; SQLite tích hợp Node.js 24. Giao diện và API cùng origin. Database mới được tạo tự động trong `storage/`, kèm 5 sản phẩm mẫu và 3 danh mục. Database đã có dữ liệu được giữ nguyên, không thêm mẫu trùng khi khởi động lại. Ảnh mẫu sử dụng URL Unsplash và cần Internet; ảnh lỗi có hình thay thế.

## API chính

Chạy `npm.cmd start` hoặc `node server.js`. Entry point `server.js` khởi động `src/server.js`; `src/app.js` kết nối SQLite và khai báo các route.

- `GET /api/products`: danh sách sản phẩm đang bán, kèm các biến thể; lọc bằng `?category=1`.
- `POST /api/products`: thêm sản phẩm, cần cookie session Admin sau khi đăng nhập `POST /api/admin/login`. Thành công trả HTTP 201 và `{ "id": ... }`.
- `POST /api/orders`: tạo đơn COD, trả HTTP 201 cùng mã đơn và tổng tiền; server tính giá và kiểm tra tồn kho.

JSON thêm sản phẩm:

```json
{
  "name": "Áo thun mới",
  "category_id": 1,
  "description": "Áo cotton thoải mái",
  "price": 199000,
  "image_url": "https://example.com/ao.jpg",
  "variants": [{ "size": "M", "color": "Trắng", "stock": 20 }]
}
```

JSON tạo đơn (lấy `variant_id` từ `variants[].id` của API sản phẩm):

```json
{
  "customer_name": "Nguyễn An",
  "customer_phone": "0901234567",
  "shipping_address": "123 Nguyễn Huệ, TP.HCM",
  "items": [{ "variant_id": 1, "quantity": 2 }]
}
```

## Chạy trên Windows

Sử dụng Node.js >= 24 được cài trên máy, mở Terminal PowerShell tại thư mục dự án và chạy:

```powershell
npm.cmd install
npm.cmd run build:css
npm.cmd start
```

Để chạy tự động trên máy này có thể dùng `./start.ps1`. Script dùng Node trong PATH, không phụ thuộc runtime/ZIP trong project.

Mở http://localhost:3000 và http://localhost:3000/admin.html. Tài khoản là `admin`; mật khẩu trong `.env` được tạo riêng trên máy, không commit. Nếu `.env` chưa có, sao chép `.env.example` thành `.env`, thay mật khẩu bằng chuỗi ít nhất 12 ký tự.

Mật khẩu được băm bằng scrypt khi tạo tài khoản lần đầu. Thay ADMIN_PASSWORD sau đó không tự đổi mật khẩu tài khoản đã có. Không xóa Database chứa đơn hàng để đổi mật khẩu.

## Tính năng

- Khách hàng: modal Đăng nhập/Đăng ký hai tab, avatar chữ cái đầu và menu tài khoản. Styles của phần này ở `public/style.css`, logic ở `public/assets/customer.js`.
- Tài khoản khách lưu SQLite, mật khẩu băm scrypt, session HttpOnly/SameSite riêng với Admin. Ghi nhớ đăng nhập 30 ngày; không ghi nhớ dùng session cookie và hết hạn phía server sau 8 giờ.
- Lịch sử chỉ gồm đơn tạo khi đang đăng nhập; không gán đơn cũ/đơn khách vãng lai bằng email hoặc điện thoại để tránh lộ thông tin. Vẫn hỗ trợ checkout không tài khoản.
- Quên mật khẩu hiện hiển thị hướng dẫn hỗ trợ, chưa gửi email hay có quy trình reset. Cần dịch vụ email và token khôi phục để kích hoạt phần đó.

- Checkout hỗ trợ COD và VietQR. Tài khoản nhận tiền cấu hình trong `.env`: `VIETQR_BANK_ID`, `VIETQR_BANK_NAME`, `VIETQR_ACCOUNT_NO`, `VIETQR_ACCOUNT_NAME`; khởi động lại server khi thay đổi.
- VietQR Quick Link: https://www.vietqr.io/intro/ . Server tạo URL ảnh chứa đúng tổng tiền gồm phí vận chuyển và nội dung `DH[Mã_Đơn_Hàng]`. Ảnh QR cần Internet; tên chủ tài khoản trong QR lấy từ cấu hình, không phải kết quả xác minh của ngân hàng.
- Phiên thanh toán 5 phút lưu ở SQLite; tải lại cùng tab giữ thời hạn bằng sessionStorage. Hết thời gian sẽ ẩn QR và dừng nút xác nhận, không tự hủy đơn hoặc hoàn kho vì chuyển khoản có thể đang xử lý.
- Khách bấm xác nhận gửi thông báo có token riêng cho từng đơn; Admin thấy thông báo cần đối soát. Không tự đổi `payment_status` thành `paid`. Chưa có webhook xác minh ngân hàng.
- Hiệu ứng xác nhận dùng canvas-confetti 1.9.4 qua CDN (https://github.com/catdad/canvas-confetti), tôn trọng giảm chuyển động. Nếu CDN không tải được, xác nhận vẫn hoạt động.

- Trang người mua Cyberpunk, tông cyan/tím; Dark/Light Mode lưu ở `moc-theme`.
- Live Search lọc ngay khi gõ, hỗ trợ tìm tên tiếng Việt không dấu; kết hợp danh mục và khoảng giá.
- Hai thanh trượt chọn giá thấp nhất/cao nhất, giới hạn dựa trên giá sản phẩm từ API; có nút xóa toàn bộ bộ lọc.
- Nút Xem nhanh mở modal ảnh, mô tả, size/màu, số lượng và thêm vào giỏ. Đóng bằng Escape, nút X hoặc bấm ngoài; hỗ trợ focus bàn phím và giao diện điện thoại.
- Hero slider tự chuyển mỗi 5 giây; có chọn ảnh, chuyển trước/sau, tạm dừng. Tự chuyển dừng khi hover, focus trong banner, tab ẩn; mặc định tắt khi người dùng chọn giảm chuyển động.
- Product card nghiêng 3D theo chuột trên thiết bị hỗ trợ hover; skeleton khi chờ API; không nghiêng trên điện thoại hoặc khi giảm chuyển động.
- Popup hoạt động mua sắm **minh họa** mỗi 10 giây, hiển thị 6 giây; nút đóng tắt các popup tiếp theo cho lần mở trang đó. Tên và hoạt động được mô phỏng, không lấy từ đơn hàng thật.

- Danh sách, tìm kiếm, lọc danh mục; chi tiết sản phẩm với size, màu và tồn kho.
- Giỏ hàng localStorage, cập nhật số lượng, xóa mặt hàng.
- Checkout COD; server tính tiền và phí ship (30.000đ, miễn phí từ 600.000đ).
- Tạo đơn và trừ tồn kho trong một transaction; đơn giữ bản chụp tên/giá/size/màu.
- Admin: thêm, sửa, ẩn sản phẩm; thêm biến thể, quản lý tồn kho; xem đơn và cập nhật trạng thái.
- Hủy đơn pending/confirmed hoàn tồn kho đúng một lần; hoàn tất giao hàng ghi nhận đã thu tiền COD.
- Session SQLite 8 giờ, cookie HttpOnly/SameSite, kiểm tra origin cho yêu cầu thay đổi dữ liệu, giới hạn thử đăng nhập.

## Cấu trúc

`src/app.js`: cấu hình Express, API và nghiệp vụ; `src/server.js`: khởi động; `src/db/schema.sql`: schema; `public/`: HTML và JS frontend; `styles/`: nguồn Tailwind; `tests/`: kiểm thử API; `storage/`: Database runtime. Bản đầu gom backend vào app.js để giữ dự án nhỏ, có thể tách controllers/services/repositories khi mở rộng.

```powershell
npm.cmd test
```

Server mặc định chỉ nghe trên 127.0.0.1 để phát triển local. Khi triển khai cần cấu hình host, HTTPS, COOKIE_SECURE=true, lưu trữ bền vững và backup SQLite. Phiên bản này chưa tích hợp cổng thanh toán, vận chuyển, email tự động hay tài khoản khách hàng. Frontend dùng CSS Tailwind build local, không phụ thuộc CDN Tailwind.
