# ChessApp Backup Notes

Admin v7 tạo backup tại `backend/data/backups/` và cho phép tải ZIP từ `/admin/maintenance`.

## Scope

- **Core**: dữ liệu ứng dụng local quan trọng, không gồm `lichess-puzzles.sqlite3`.
- **Full**: Core + Lichess Puzzle DB.

Mỗi ZIP có `manifest.json` với format `chessapp-admin-backup-v1`.

## An toàn

Backup có thể chứa `admin-users.sqlite3`, tức password hash và session hash. Đây không phải mật khẩu/session token dạng rõ, nhưng vẫn là dữ liệu nhạy cảm.

- Không commit ZIP vào Git.
- Không chia sẻ public link.
- Nếu copy sang cloud/USB, nên bảo vệ nơi lưu bằng quyền truy cập phù hợp.
- Xóa các bản cũ không còn cần thiết.

## SQLite

Các file `.sqlite3` được snapshot bằng SQLite backup API trước khi nén. Snapshot được `PRAGMA quick_check` trước khi đưa vào ZIP.

## Restore

Admin v7 chưa tự restore. Không giải nén đè lên `backend/data/` khi backend đang chạy. Restore tự động sẽ cần kiểm tra schema/version và rollback trước khi được thêm vào Admin.
