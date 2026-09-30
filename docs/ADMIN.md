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

Chỉ owner mới quản lý account/role và thực hiện Safe Restore.

### admin

Được quản trị dữ liệu, Puzzle DB, hệ thống, backup và Audit Log nhưng **không có `users.manage`**, vì vậy không được restore.

### moderator

Được quản lý Kỳ phổ, AI Dataset và Tàng Kinh Các. Không được cập nhật Puzzle DB, xem System/Audit, quản lý tài khoản hoặc backup/restore.

### user

Không có quyền vào Nội Các.

Permission được kiểm tra ở backend theo route và method. Việc ẩn nút/sidebar trên frontend chỉ là UX; backend vẫn là lớp quyết định cuối cùng.

## 4. Security Center — Admin v6

Mọi tài khoản có quyền vào Nội Các đều có trang:

```text
/admin/security
```

Account có thể xem session của chính mình, thu hồi session khác, đăng xuất mọi phiên khác và đổi mật khẩu. Đổi mật khẩu thu hồi toàn bộ session và yêu cầu đăng nhập lại.

Owner có thể xem số session của mọi account và thu hồi toàn bộ session của một account từ xa.

Security Center không lưu hoặc hiển thị IP, User-Agent, session token dạng rõ hoặc Authorization header. Owner local/bootstrap không dùng session SQLite.

## 5. Backup & Maintenance — Admin v7

Owner và Admin có trang:

```text
/admin/maintenance
```

Có hai loại snapshot:

- **Core backup**: kỳ phổ/diagram, file upload, Tàng Kinh Các, account + session hash, Audit Log, AI corrections và dữ liệu local khác; không chứa `lichess-puzzles.sqlite3`.
- **Full backup**: Core + Lichess Puzzle DB.

Backup được lưu tại:

```text
backend/data/backups/
```

Thư mục `backups/` không được đưa ngược vào backup mới. SQLite được snapshot bằng SQLite backup API và `PRAGMA quick_check` trước khi đóng ZIP. Từ Admin v8, backup mới còn ghi SHA-256 cho từng file trong `manifest.json`; backup v7 cũ vẫn tương thích restore nhờ ZIP CRC + manifest + schema validation.

Maintenance Center hỗ trợ tạo Core/Full backup, tải/xóa/prune snapshot và chạy integrity check cho các SQLite DB chính.

## 6. Safe Restore — Admin v8

Chỉ **Owner** (`users.manage`) được restore. Admin thường có thể tạo/tải backup nhưng backend từ chối endpoint restore.

Luồng restore:

```text
Chọn backup
→ Dry-run / restore plan
→ Validate ZIP + manifest + path safety
→ Verify SHA-256 nếu backup có checksum
→ PRAGMA quick_check + schema validation cho SQLite
→ Tạo pre-restore backup hiện trạng
→ Giải nén vào staging
→ Atomic replace dữ liệu trong scope
→ Completed
```

UI yêu cầu nhập chính xác:

```text
RESTORE
```

trước khi gọi endpoint ghi dữ liệu.

### Scope

- Core restore không chạm `lichess-puzzles.sqlite3` hiện tại.
- Full restore đưa toàn bộ dữ liệu trong Full snapshot về trạng thái của snapshot, gồm Puzzle DB.
- File thuộc scope hiện tại nhưng không có trong snapshot sẽ bị xóa để dữ liệu khớp snapshot.
- Thư mục `backend/data/backups/` luôn được giữ nguyên.

### Session

Nếu backup có `admin-users.sqlite3`, backend xóa toàn bộ `admin_sessions` trong bản staging trước khi áp dụng. Session cũ không được hồi sinh từ backup. Account đang thực hiện restore phải đăng nhập lại sau khi restore; owner local/bootstrap không bị ảnh hưởng.

### Rollback

Ngay trước khi ghi dữ liệu, backend tự tạo một Core hoặc Full **pre-restore backup** cùng scope với snapshot đích. Nếu apply phát sinh exception, backend tự khôi phục pre-restore backup. Nếu cả restore lẫn rollback thất bại, API trả trạng thái nghiêm trọng và phải ngừng ghi dữ liệu cho đến khi phục hồi thủ công từ pre-restore ZIP.

### Audit

Restore ghi các sự kiện:

- `Restore started`
- `Restore validated`
- `Restore completed`
- `Restore rolled back` khi có lỗi và rollback thành công

## 7. Chức năng Admin

- **Tổng quan**: số sách, diagram, puzzle, correction, Tàng Kinh Các, storage, Stockfish, uptime.
- **Kỳ phổ**: quản lý sách, diagram, nhận dạng, re-scan/retry, cache AI, export và xóa dữ liệu.
- **Puzzle DB**: thống kê và cập nhật database Lichess theo permission.
- **AI Dataset**: correction, filter/search, diff ô cờ, ảnh nguồn và export dataset.
- **Tàng Kinh Các**: tìm/xóa thế cờ và mở nguồn.
- **Nhật ký**: mutation Admin, HTTP status, thời gian xử lý và actor.
- **Tài khoản**: tạo account, đổi role, khóa/mở, reset mật khẩu, xóa account.
- **Bảo mật**: session và đổi mật khẩu.
- **Backup/Restore**: Core/Full snapshot, download/prune, integrity check, dry-run và Safe Restore.
- **Hệ thống**: backend uptime, Python/platform, Stockfish và storage.

## 8. Dữ liệu local của Admin

Các database Admin nằm trong `backend/data/` và đã được Git bỏ qua:

```text
backend/data/admin-users.sqlite3
backend/data/admin-audit.sqlite3
```

`admin-users.sqlite3` chứa account, password hash và session hash. `admin-audit.sqlite3` chứa nhật ký thao tác.

Audit Log không lưu `CHESSAPP_ADMIN_TOKEN`, Authorization header, mật khẩu hoặc request body.

## 9. Lưu ý an toàn

- Không commit `backend/.env` hoặc `CHESSAPP_ADMIN_TOKEN` vào Git.
- Không đổi token thành `NEXT_PUBLIC_CHESSAPP_ADMIN_TOKEN`.
- Backup ZIP có thể chứa password hash/session hash nên phải xem là file nhạy cảm.
- Không public hoặc commit ZIP backup lên GitHub.
- Không dùng chung một account cho nhiều người nếu muốn Audit Log xác định đúng actor.
- Trước thay đổi dữ liệu lớn, nên tạo ít nhất một Core backup.
- Không tắt backend giữa lúc Safe Restore đang apply/rollback.
- Sau Admin v8, nhánh Admin được xem là hoàn chỉnh; ưu tiên phát triển tiếp Scanner/Recognition/Analysis.
