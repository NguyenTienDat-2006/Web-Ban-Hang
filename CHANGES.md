# Kiểm tra và nâng cấp cửa hàng

## Vấn đề ban đầu

- API Admin đã kiểm tra session, nhưng trang `admin.html` được phục vụ công khai; chưa phân biệt STAFF và ADMIN, customer gọi API Admin nhận 401.
- Mật khẩu đã dùng scrypt, không phải plaintext. Hàm kiểm tra hash lỗi định dạng có thể gây lỗi server.
- Các truy vấn dữ liệu đầu vào đã dùng tham số. Checkout đã tính giá từ SQLite, kiểm tra tồn kho, gộp biến thể trùng và dùng transaction rollback.
- Chưa có API xóa sản phẩm, dashboard, chi tiết đơn theo ID và sắp xếp giá. Lịch sử khách hàng đã tồn tại nhưng chưa hiển thị chi tiết địa chỉ giao hàng.
- Chuyển đơn sang completed tự đánh dấu paid, chưa có API đối soát thanh toán riêng.
- Chi tiết đơn chưa lưu product_id và subtotal riêng. start.ps1 phụ thuộc runtime nằm trong project; .gitignore chưa có quy tắc WAL/SHM toàn cục.

## File sửa

`src/app.js`, `src/customer-auth.js`, `src/server.js`, `public/admin.html`, `public/assets/admin.js`, `public/assets/customer.js`, `public/index.html`, `public/script.js`, `tests/customer.test.js`, `package.json`, `.gitignore`, `.env.example`, `start.ps1`, `README.md`.

## File mới

`src/passwords.js`, `public/admin-login.html`, `tests/security.test.js`, `tests/migration.test.js`, `CHANGES.md`.

## Chức năng và bảo mật

- Trang admin kiểm tra session ở server, chuyển về `/admin-login.html` khi thiếu session. API trả 401 khi chưa đăng nhập, 403 khi đang đăng nhập CUSTOMER. ADMIN và STAFF có quyền CRUD sản phẩm, quản lý đơn và đối soát thanh toán; đăng ký công khai chỉ tạo CUSTOMER. Vai trò khách được trả riêng, không trả password/hash.
- Tài khoản khách vẫn dùng email làm định danh đăng nhập duy nhất, không tạo username mới để giữ tương thích. Đăng ký kiểm tra email trùng và mật khẩu 8–128 ký tự. Mật khẩu Admin giữ yêu cầu tối thiểu 12 ký tự.
- Giữ scrypt và hash hiện có vì database không lưu plaintext; gom logic hash/compare và từ chối hash sai định dạng an toàn. Không đổi thuật toán sang bcrypt vì yêu cầu chuyển đổi chỉ áp dụng khi đang lưu plaintext.
- Thêm DELETE `/api/admin/products/:id`, DELETE/PUT `/api/products/:id`; xóa mềm bằng is_active=0 để giữ biến thể và lịch sử. Có hộp thoại xác nhận. Sản phẩm đã ẩn không mua được; có thể bật lại từ màn hình sửa.
- Thêm GET `/api/admin/dashboard`, GET `/api/admin/orders/:id`, GET `/api/account/orders/:id`. Khách truy cập đơn người khác nhận 404; chủ sở hữu lấy từ session, không nhận customer_id từ frontend.
- Thêm sắp xếp giá tăng/giảm, giữ tìm kiếm và bộ lọc danh mục/khoảng giá cũ. Thêm số liệu dashboard và chi tiết giao hàng trong lịch sử khách.
- Thêm PATCH `/api/admin/orders/:id/payment` nhận payment_status thuộc unpaid/paid/failed. Admin/Staff xác nhận thu tiền sau đối soát; completed không tự đánh dấu paid. Frontend báo chuyển khoản vẫn chỉ ghi nhận reported_at, không quyết định thanh toán thành công. payments.js và VietQR giữ nguyên.
- Dashboard doanh thu chỉ tính đơn completed và paid; số sản phẩm tính sản phẩm đang bán.
- Các trạng thái giữ dạng chữ thường đang dùng để không phá schema/API/giao diện cũ. Đơn khách vãng lai vẫn được hỗ trợ; không tự gán đơn cũ qua email/điện thoại.

## Database

- Migration bổ sung admin_users.role, mặc định ADMIN cho tài khoản quản trị cũ, giới hạn ADMIN/STAFF.
- Migration bổ sung order_items.product_id và subtotal, backfill từ biến thể và unit_price * quantity. Nếu biến thể cũ không còn, product_id để NULL, giữ nguyên snapshot tên/SKU/giá.
- Cột chi tiết đơn và backfill chạy trong transaction; migration có thể chạy lại. Không xóa bảng, đơn hàng, tồn kho hoặc hash cũ. Giữ liên kết chủ sở hữu qua customer_orders thay vì thêm customer_id trùng lặp.
- File storage/shop.sqlite hiện có chưa bị sửa trong đợt kiểm tra. Migration thực tế chạy ở lần khởi động tiếp theo. Nên sao lưu SQLite nhất quán trước khi triển khai.

## Kiểm tra

- Toàn bộ 4 test đạt: shop.test.js, customer.test.js, security.test.js, migration.test.js. Test cũ giữ lại, chỉ đổi kỳ vọng CUSTOMER gọi API Admin từ 401 sang 403.
- Bao phủ đăng ký trùng, sai mật khẩu, API admin không session/customer, STAFF, giá âm, tên rỗng, tồn kho âm, ID sai/không tồn tại, số lượng 0/âm/lẻ, quá tồn kho, giá giả, đơn người khác, rollback, hủy/hoàn kho một lần, payment token/hết hạn, thanh toán độc lập, xóa mềm, hash sai định dạng, migration và khởi động lại.
- Kiểm tra cú pháp JavaScript bằng node --check; entry point server.js khởi động và API sản phẩm trả 200 với database :memory:.
- Chưa kiểm tra giao diện bằng trình duyệt hoặc xác nhận giao dịch ngân hàng thực tế.
- Runtime có sẵn chỉ dùng làm công cụ kiểm tra trong môi trường này, không khai báo dependency và start.ps1 không tự chọn runtime đó.

## Khởi động

Yêu cầu Node.js >=24. Nếu chưa có .env: sao chép .env.example, đặt ADMIN_PASSWORD mạnh tối thiểu 12 ký tự. Không ghi đè .env hiện có.

```powershell
npm.cmd install
npm.cmd run build:css
npm.cmd test
npm.cmd start
```

Mở http://localhost:3000 và /admin.html. DB_PATH tùy chọn, mặc định storage/shop.sqlite. ADMIN_PASSWORD chỉ tạo tài khoản lần đầu, không đổi mật khẩu tài khoản đã có. STAFF được cấp bằng công cụ quản trị SQLite tin cậy, không qua đăng ký công khai; tài khoản staff phải có hash scrypt hợp lệ. Secret và thông tin thanh toán cấu hình qua môi trường, không hard-code.

## Review và kiểm tra luồng bằng trình duyệt

Các lỗi tìm thấy và đã sửa sau review:

- Request thiếu body, body sai kiểu, biến thể null/array hoặc ID sai trước đây có thể gây HTTP 500. Nay trả 400 và giữ nguyên dữ liệu.
- Không cắt khoảng trắng của mật khẩu Admin khi đăng nhập; giới hạn chiều dài khớp cấu hình tạo tài khoản. Dùng dummy hash cho tài khoản không tồn tại và dọn dữ liệu giới hạn đăng nhập hết hạn.
- Đăng nhập Admin đổi session và thu hồi session cũ trong transaction. Đăng ký khách và tạo session chạy chung transaction để không lưu tài khoản dở dang khi bước tạo session thất bại.
- Kiểm tra ID biến thể trùng, không cho gửi ID có sẵn khi tạo sản phẩm mới; so sánh size/màu bằng tuple JSON tránh nhầm khi chứa ký tự |. POST /api/admin/products trả đúng 201.
- Gom migration role/chi tiết đơn, tạo Admin và seed vào transaction; rollback/đóng kết nối khi khởi tạo thất bại.
- Cập nhật thanh toán kiểm tra đơn chưa hủy ngay trong câu UPDATE để tránh cuộc đua với hủy đơn từ kết nối khác. Lỗi database bận trả 503.
- Chặn alias trang Admin có chữ hoa, URL encode, dấu chấm/khoảng trắng cuối tên và NTFS stream. Trang đăng nhập công khai chỉ chứa form đăng nhập, dùng script riêng, giữ nguyên CSS. Logout/hết session chuyển về trang đăng nhập.
- Sửa nhãn tiếng Việt bị hỏng, reset bộ lọc đặt lại thứ tự giá. Giỏ hàng lọc từng mục sai, giữ mục hợp lệ và chỉ gửi ID/số lượng.
- Checkout ban đầu tắt nút đặt hàng cho đến khi tải xong giỏ và kiểm tra tồn kho; trước đó gửi sớm có thể bị bỏ qua.
- Nút đăng nhập Admin chỉ bật sau khi gắn handler JavaScript. Form đăng nhập/đăng ký dùng method POST và action API rõ ràng, tránh gửi mật khẩu qua URL nếu script chưa tải hoặc bị lỗi.
- Entry point hỗ trợ PORT=0, kiểm tra PORT, giải quyết DB_PATH tương đối theo thư mục project, xử lý cổng bị chiếm và đóng database khi dừng server.

File sửa thêm trong review: src/app.js, src/customer-auth.js, src/server.js, public/assets/admin.js, public/assets/customer.js, public/assets/common.js, public/admin.html, public/admin-login.html, public/index.html, public/checkout.html, public/script.js, tests/migration.test.js, CHANGES.md. File mới: public/assets/admin-login.js, tests/review.test.js, tests/browser.e2e.test.js.

Kiểm tra database thật ở chế độ chỉ đọc: integrity_check=ok, không có lỗi khóa ngoại; không tạo khách/đơn kiểm thử trong database thật.

Test trình duyệt khởi động server.js và Chrome headless, dùng SQLite/profile tạm riêng; thao tác form và các nút thật trên trang để kiểm tra đăng ký → logout/login → sản phẩm → thêm giỏ → giỏ hàng → checkout COD → đơn được tạo → tồn kho giảm 1 → lịch sử đúng khách → chi tiết địa chỉ → Admin login → xem đơn → confirmed → shipping → completed. Tổng tiền và chủ sở hữu được kiểm tra từ database; payment_status vẫn unpaid khi hoàn tất giao hàng. Không có lỗi JavaScript runtime trong luồng. Server/profile kiểm thử được dừng và dọn sau test. Tài nguyên HTTPS bên ngoài được chặn trong test; không xác minh ảnh/CDN hoặc giao dịch ngân hàng thật.

Chạy toàn bộ test: npm.cmd test. Test trình duyệt tự tìm Chrome/Edge trên Windows; hệ thống khác có thể đặt CHROME_PATH tới trình duyệt. Nếu không có trình duyệt, test đó báo skip. Trong môi trường sandbox hiện tại, Chrome cần chạy ngoài sandbox do tiến trình GPU bị từ chối quyền. Không cần thêm dependency browser vào project.

Kết quả cuối: 11/11 test đạt, không có test bị skip; toàn bộ JavaScript kiểm tra cú pháp đạt. Test E2E chạy entry point server.js thật trên cổng tự động và database tạm; database shop hiện có được giữ nguyên.
