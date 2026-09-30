# Admin Maintenance UI

Trang `/admin/maintenance` dành cho role có `system.read`.

- Core backup bỏ Lichess Puzzle DB.
- Full backup gồm Puzzle DB và có thể rất lớn.
- Download dùng authenticated fetch để không đưa bearer token vào URL.
- Delete/prune đều có confirm trên UI.
- Restore không có trong v7.
