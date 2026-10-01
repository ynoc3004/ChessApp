# Academy v5 — Phân Tích Ván Thực Chiến

Academy v5 nối PGN từ Giải Đấu Đệ Tử với Stockfish và hệ thống học tập.

## Nguyên tắc dữ liệu

`Skill Mastery` và `Practical Profile` là hai nguồn khác nhau:

- Skill Mastery: khảo thí + puzzle đã luyện.
- Practical Profile: những thời điểm trong ván thật mà Stockfish đo được mức mất ưu thế đáng kể.

Một blunder **không trực tiếp trừ Skill Mastery**. Practical Profile chỉ trở thành gợi ý Bí Cảnh khi có bằng chứng lặp lại ở nhiều ván.

## Pipeline

1. Admin nhập kết quả + PGN trong `/admin/academy/tournaments`.
2. `/admin/academy/game-analysis` đưa PGN vào hàng đợi.
3. Một worker tuần tự chạy Stockfish để tránh mở nhiều engine cùng lúc.
4. Mỗi vị trí chỉ cần một lần evaluate; snapshot trước nước đi đã chứa nước tốt nhất, snapshot sau nước đi dùng để tính centipawn loss.
5. Ngưỡng mặc định:
   - `< 80cp`: không ghi moment.
   - `80–149cp`: inaccuracy.
   - `150–299cp`: mistake.
   - `>= 300cp`: blunder.
6. `missedWin` được đánh dấu khi trước nước đi có ưu thế lớn nhưng nước đã đi làm mất phần lớn ưu thế đó.

## Nhóm tình huống

Nhóm `opening`, `tactical`, `calculation`, `material`, `king_safety`, `defense`, `endgame` là **heuristic phục vụ huấn luyện**, không phải kết luận về suy nghĩ/tâm lý của học viên.

Một số nhóm có mapping trực tiếp sang Lichess theme:

- opening → `opening`
- material → `hangingPiece`
- king_safety → `exposedKing`
- defense → `defensiveMove`
- endgame → `endgame`

Tactical và calculation không bị ép vào một motif cụ thể khi evidence không đủ.

## Practical → Bí Cảnh

Bridge v5 chỉ đổi `recommendation` cho lượt Bí Cảnh cá nhân hóa khi:

- có ít nhất 2 ván đã phân tích;
- nhóm lỗi đứng đầu có Lichess theme trực tiếp;
- evidence weight >= 6 (ví dụ 2 blunder hoặc 3 mistake).

Recommendation gốc từ Skill Map vẫn được giữ trong `skillRecommendation`. Không có bảng Skill Mastery nào bị sửa bởi bridge này.

## Cache / PGN thay đổi

Mỗi analysis lưu SHA-256 của PGN. Nếu giáo viên sửa PGN sau đó, Admin sẽ thấy `stale` và có thể chạy lại. Moment cũ chỉ bị xóa khi re-analysis thực sự được queue.

Nếu backend restart giữa lúc phân tích, job `queued/running` cũ được chuyển thành `failed` và có thể retry.

## API

Admin:

- `GET /api/admin/academy/game-analysis/overview`
- `GET /api/admin/academy/game-analysis/games`
- `POST /api/admin/academy/game-analysis/pairings/{pairing_id}/start`
- `POST /api/admin/academy/game-analysis/tournaments/{tournament_id}/start`
- `GET /api/admin/academy/game-analysis/analyses/{analysis_id}`

Đệ tử:

- `GET /api/academy/game-analysis/profile`
- `GET /api/academy/game-analysis/games`
- `GET /api/academy/game-analysis/games/{analysis_id}`

Student endpoint chỉ cho đọc analysis của ván mà chính đệ tử tham gia.

## UI

- Admin: `/admin/academy/game-analysis`
- Đệ tử: `/academy/practical`
- Chi tiết ván: `/academy/practical/{analysis_id}`

## Stockfish

Backend dùng `STOCKFISH_PATH`; nếu không có thì thử executable `stockfish` trong PATH. Depth Admin cho phép 8–18, mặc định 12.

Scanner, Recognition và `detector.py` không thay đổi trong v5.
