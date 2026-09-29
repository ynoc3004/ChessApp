# ChessApp Admin v1 — Kỳ Phổ Nội Các

Admin chạy tại:

```text
http://localhost:3000/admin
```

## 1. Cấu hình mã quản trị

Admin API không dùng biến `NEXT_PUBLIC_*` và không lưu secret trong repository.

Trong PowerShell dùng để chạy backend:

```powershell
cd D:\code\ChessApp\backend
$env:CHESSAPP_ADMIN_TOKEN = "dat-mot-ma-quan-tri-rieng-o-day"
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Sau đó mở `/admin` và nhập đúng giá trị của `CHESSAPP_ADMIN_TOKEN`.

Token chỉ được giữ trong `sessionStorage` của tab/trình duyệt hiện tại. Bấm **Khóa Nội Các** để xóa token khỏi phiên.

Nếu backend chưa có `CHESSAPP_ADMIN_TOKEN`, các API `/api/admin/*` trả `503`. Nếu token sai, API trả `401`.

## 2. Chức năng Admin v1

- **Tổng quan**: số sách, diagram, puzzle, correction, Tàng Kinh Các, storage, Stockfish, uptime.
- **Kỳ phổ**: tìm/lọc job, xem trạng thái quét, dung lượng, lỗi, tải ZIP/FEN và xóa toàn bộ dữ liệu một kỳ phổ.
- **Puzzle DB**: tổng số puzzle, rating min/max, theme phổ biến, phân bố rating và nút kiểm tra/cập nhật database Lichess.
- **AI Corrections**: xem FEN AI và FEN đã sửa, xem ảnh nguồn có xác thực, xóa mẫu học không cần thiết.
- **Tàng Kinh Các**: tìm và xóa thế cờ đã lưu, mở lại nguồn khi có đường dẫn.
- **Hệ thống**: backend uptime, Python/platform, Stockfish, data directory và dung lượng từng nhóm dữ liệu.

## 3. Lưu ý an toàn

- Không commit `CHESSAPP_ADMIN_TOKEN` vào Git.
- Không đổi token thành `NEXT_PUBLIC_CHESSAPP_ADMIN_TOKEN`; biến `NEXT_PUBLIC_*` được bundle sang trình duyệt.
- Các thao tác xóa trong admin đều yêu cầu xác nhận trên giao diện và API admin yêu cầu Bearer token.
- Chức năng cập nhật Lichess DB chạy bằng script hiện có và thay database sau khi import tệp mới thành công.
