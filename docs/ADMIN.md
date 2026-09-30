# ChessApp Admin — Kỳ Phổ Nội Các

Admin chạy tại:

```text
http://localhost:3000/admin
```

## 1. Cấu hình mã quản trị một lần

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

Sau đó mở `/admin` và nhập đúng giá trị của `CHESSAPP_ADMIN_TOKEN`.

Token phía trình duyệt chỉ được giữ trong `sessionStorage` của tab/trình duyệt hiện tại. Bấm **Khóa Nội Các** để xóa token khỏi phiên.

Nếu backend chưa có `CHESSAPP_ADMIN_TOKEN`, các API `/api/admin/*` trả `503`. Nếu token sai, API trả `401`.

## 2. Chức năng Admin

- **Tổng quan**: số sách, diagram, puzzle, correction, Tàng Kinh Các, storage, Stockfish, uptime.
- **Kỳ phổ**: quản lý sách, diagram, nhận dạng, re-scan/retry, cache AI, export và xóa dữ liệu.
- **Puzzle DB**: tổng số puzzle, rating min/max, theme phổ biến, phân bố rating và nút kiểm tra/cập nhật database Lichess.
- **AI Dataset**: thống kê correction, filter/search, diff từng ô cờ, ảnh nguồn và export dataset cho retraining local.
- **Tàng Kinh Các**: tìm và xóa thế cờ đã lưu, mở lại nguồn khi có đường dẫn.
- **Hệ thống**: backend uptime, Python/platform, Stockfish, data directory và dung lượng từng nhóm dữ liệu.

## 3. Lưu ý an toàn

- Không commit `backend/.env` hoặc `CHESSAPP_ADMIN_TOKEN` vào Git.
- Không đổi token thành `NEXT_PUBLIC_CHESSAPP_ADMIN_TOKEN`; biến `NEXT_PUBLIC_*` được bundle sang trình duyệt.
- File `backend/.env.example` chỉ là mẫu và không chứa secret thật.
- Các thao tác xóa trong admin đều yêu cầu xác nhận trên giao diện và API admin yêu cầu Bearer token.
- Chức năng cập nhật Lichess DB chạy bằng script hiện có và thay database sau khi import tệp mới thành công.
