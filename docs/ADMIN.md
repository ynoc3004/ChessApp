# ChessApp Admin — Kỳ Phổ Nội Các

Admin chạy tại:

```text
http://localhost:3000/admin
```

## 1. Cấu hình owner cục bộ một lần

Admin API không dùng biến `NEXT_PUBLIC_*` và không lưu secret trong repository.

Cách đơn giản nhất trên Windows là chạy:

```powershell
cd D:\code\ChessApp\backend
.\start.ps1
```

Ở lần chạy đầu tiên, script sẽ hỏi **Mã quản trị** và lưu vào:

```text
backend/.env
```

Ví dụ nội dung file:

```text
CHESSAPP_ADMIN_TOKEN=ma-quan-tri-cua-ban
CHESSAPP_ADMIN_SESSION_HOURS=12
```

`backend/.env` đã được Git bỏ qua, nên mã không bị push lên GitHub. Từ lần sau chỉ cần:

```powershell
cd D:\code\ChessApp\backend
.\start.ps1
```

không cần nhập lại `$env:CHESSAPP_ADMIN_TOKEN`.

Backend cũng tự đọc `backend/.env`, vì vậy lệnh uvicorn cũ vẫn hoạt động:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Nếu đồng thời có biến môi trường hệ thống và `backend/.env`, biến môi trường hệ thống được ưu tiên.

`CHESSAPP_ADMIN_TOKEN` là **owner cục bộ/bootstrap**. Nó luôn có toàn quyền và dùng làm khóa cứu hộ nếu tài khoản database bị khóa hoặc quên mật khẩu. Owner cục bộ không thể xóa từ Admin UI.

## 2. Tài khoản và đăng nhập Admin v5

Trang `/admin` hỗ trợ hai cách đăng nhập:

1. **Tài khoản Nội Các**: username + password.
2. **Mã owner local**: giá trị `CHESSAPP_ADMIN_TOKEN` trong `backend/.env`.

Lần đầu dùng Admin v5:

1. Đăng nhập bằng **Mã owner local**.
2. Mở **Tài khoản** (`/admin/users`).
3. Tạo tài khoản username/password cho người cần dùng Admin.
4. Những lần sau có thể đăng nhập bằng tài khoản đó thay vì nhập mã owner.

Mật khẩu account được hash bằng PBKDF2-SHA256 với salt riêng. Backend không lưu mật khẩu dạng rõ.

Sau khi đăng nhập account, backend cấp một session token ngẫu nhiên. Database chỉ lưu SHA-256 hash của session token, không lưu token thật. Session mặc định sống 12 giờ; có thể đổi bằng:

```text
CHESSAPP_ADMIN_SESSION_HOURS=12
```

Giá trị được giới hạn từ 1 đến 168 giờ.

Token phía trình duyệt được giữ trong `sessionStorage`. Bấm **Khóa Nội Các** để logout và thu hồi session account hiện tại.

Đổi role, khóa tài khoản hoặc reset mật khẩu sẽ thu hồi toàn bộ session cũ của tài khoản đó.

## 3. Role và permission

### owner

Toàn quyền:

- `admin.read`
- `admin.write`
- `books.write`
- `puzzles.write`
- `dataset.write`
- `collection.write`
- `system.read`
- `audit.read`
- `users.manage`

Chỉ owner mới quản lý account và role.

### admin

Được quản trị dữ liệu, Puzzle DB, hệ thống và Audit Log nhưng **không có `users.manage`**.

### moderator

Được:

- xem Admin;
- quản lý Kỳ phổ;
- quản lý AI Dataset;
- quản lý Tàng Kinh Các.

Không được:

- cập nhật Puzzle DB;
- xem System console;
- xem Audit Log;
- quản lý tài khoản.

### user

Không có quyền vào Nội Các. Role này dành cho tài khoản thường và không nhận `admin.read`.

Permission được kiểm tra ở backend theo route và method. Việc ẩn nút/sidebar trên frontend chỉ là UX; backend vẫn là lớp quyết định cuối cùng.

## 4. Security Center — Admin v6

Mọi tài khoản có quyền vào Nội Các đều có trang:

```text
/admin/security
```

Tại đây account có thể:

- xem tất cả session đăng nhập đang còn hiệu lực của chính mình;
- nhận biết session hiện tại;
- thu hồi từng session khác;
- đăng xuất toàn bộ session khác và giữ session hiện tại;
- đổi mật khẩu của chính mình.

Khi đổi mật khẩu, backend thu hồi **toàn bộ** session của account, kể cả session hiện tại. Người dùng phải đăng nhập lại bằng mật khẩu mới.

Owner có thêm bảng tổng hợp session của mọi account và có thể thu hồi toàn bộ session của một account từ xa.

Security Center không lưu hoặc hiển thị:

- IP;
- User-Agent;
- session token dạng rõ;
- Authorization header.

Session ID hiển thị trên UI là mã định danh một chiều dẫn xuất từ token hash, không phải session token thật.

Owner local/bootstrap không dùng session SQLite. Muốn đổi khóa owner local, sửa `CHESSAPP_ADMIN_TOKEN` trong `backend/.env` rồi khởi động lại backend.

## 5. Backup & Maintenance — Admin v7

Owner và Admin có trang:

```text
/admin/maintenance
```

Có hai loại snapshot:

- **Core backup**: lưu kỳ phổ/diagram, file upload, Tàng Kinh Các, account + session hash, Audit Log, AI corrections và dữ liệu local khác; không đưa `lichess-puzzles.sqlite3` vào ZIP.
- **Full backup**: giống Core nhưng có thêm Lichess Puzzle DB. File Full có thể rất lớn.

Backup được lưu tại:

```text
backend/data/backups/
```

Thư mục `backups/` không được nhét ngược vào backup mới, tránh backup lồng nhau.

Các file `.sqlite3` không được copy thẳng khi database đang mở. Backend dùng SQLite backup API tạo snapshot nhất quán, chạy `PRAGMA quick_check`, rồi mới đưa snapshot đó vào ZIP. Mỗi ZIP có `manifest.json` ghi scope, thời gian, danh sách file và dung lượng.

Maintenance Center hỗ trợ:

- tạo Core backup;
- tạo Full backup;
- tải ZIP qua API Admin đã xác thực;
- xóa từng backup;
- giữ 5 backup mới nhất và dọn các bản cũ hơn;
- chạy `PRAGMA quick_check` trên `collection.sqlite3`, `admin-users.sqlite3`, `admin-audit.sqlite3` và `lichess-puzzles.sqlite3`.

Database chưa tồn tại được báo `Missing` và không tính là lỗi integrity.

**V7 chưa có restore tự động.** Restore cần thêm kiểm tra version/schema và rollback an toàn trước khi cho phép ghi đè database đang chạy. ZIP v7 được thiết kế để làm nguồn snapshot trước.

## 6. Chức năng Admin

- **Tổng quan**: số sách, diagram, puzzle, correction, Tàng Kinh Các, storage, Stockfish, uptime.
- **Kỳ phổ**: quản lý sách, diagram, nhận dạng, re-scan/retry, cache AI, export và xóa dữ liệu.
- **Puzzle DB**: tổng số puzzle, rating min/max, theme phổ biến, phân bố rating và cập nhật database Lichess khi role có `puzzles.write`.
- **AI Dataset**: thống kê correction, filter/search, diff từng ô cờ, ảnh nguồn và export dataset cho retraining local.
- **Tàng Kinh Các**: tìm và xóa thế cờ đã lưu, mở lại nguồn khi có đường dẫn.
- **Nhật ký**: mutation Admin, HTTP status, thời gian xử lý và actor thực hiện.
- **Tài khoản**: tạo account, đổi role, khóa/mở, reset mật khẩu, xóa account.
- **Bảo mật**: session của chính mình, đổi mật khẩu, thu hồi session; owner có thể thu hồi session của account khác.
- **Backup**: Core/Full snapshot, tải/xóa/prune backup và SQLite integrity check.
- **Hệ thống**: backend uptime, Python/platform, Stockfish, data directory và dung lượng từng nhóm dữ liệu.

## 7. Dữ liệu local của Admin

Các database Admin nằm trong `backend/data/` và đã được Git bỏ qua:

```text
backend/data/admin-users.sqlite3
backend/data/admin-audit.sqlite3
```

`admin-users.sqlite3` chứa account, password hash và session hash. `admin-audit.sqlite3` chứa nhật ký thao tác.

Audit Log không lưu:

- `CHESSAPP_ADMIN_TOKEN`;
- Authorization header;
- mật khẩu;
- request body.

## 8. Lưu ý an toàn

- Không commit `backend/.env` hoặc `CHESSAPP_ADMIN_TOKEN` vào Git.
- Không đổi token thành `NEXT_PUBLIC_CHESSAPP_ADMIN_TOKEN`; biến `NEXT_PUBLIC_*` được bundle sang trình duyệt.
- File `backend/.env.example` chỉ là mẫu và không chứa secret thật.
- Không dùng chung một account cho nhiều người nếu muốn Audit Log xác định đúng actor.
- Các thao tác xóa trong admin đều yêu cầu xác nhận trên giao diện và API admin yêu cầu Bearer token hợp lệ.
- Trước khi thay đổi dữ liệu lớn, nên tạo ít nhất một Core backup.
- Chức năng cập nhật Lichess DB chạy bằng script hiện có và thay database sau khi import tệp mới thành công.
