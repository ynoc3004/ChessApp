# Academy v2 — Bí Cảnh cá nhân hóa

Academy v2 nối hồ sơ đệ tử với kho puzzle Lichess mà không thay đổi Scanner/Recognition.

## Vòng lặp học tập

```text
Step + Skill Map từ khảo thí
        ↓
Bí Cảnh cá nhân hóa
        ↓
Puzzle thật từ kho Lichess
        ↓
Kết quả: sai / gợi ý / thời gian
        ↓
Tu Vi + Puzzle Rating + Mastery
        ↓
Sai hoặc dùng gợi ý → Sổ Sai Lầm
        ↓
Ôn giãn cách 1 → 3 → 7 → 14 → 30 → 60 ngày
```

## Dữ liệu

Các bảng mới nằm chung trong `backend/data/academy.sqlite3`:

- `academy_puzzle_attempts`: lịch sử từng puzzle đã giải.
- `academy_skill_progress`: mastery theo kỹ năng.
- `academy_review_items`: Sổ Sai Lầm và lịch ôn.

Backup Core hiện đã quét đệ quy `backend/data`, nên `academy.sqlite3` được đưa vào snapshot giống các dữ liệu local khác.

## Cá nhân hóa

`GET /api/academy/training/profile`

- Step hiện tại.
- Tu Vi.
- Puzzle Rating nội bộ.
- Skill Map hợp nhất giữa khảo thí và lịch sử puzzle.
- kỹ năng yếu nhất.
- số bài trong Sổ Sai Lầm / đến hạn.
- rating band đề xuất.

Step là cấp giáo trình, **không được coi là Elo**. Rating band dùng Step làm tín hiệu ban đầu rồi trộn với Puzzle Rating thích nghi của đệ tử.

`POST /api/academy/training/session`

```json
{ "mode": "personalized", "limit": 10 }
```

Khoảng 60% lượt được ưu tiên vào motif tương ứng kỹ năng yếu nhất nếu skill có ánh xạ sang Lichess theme; phần còn lại là bài tổng hợp cùng tầm độ khó. Nếu tên kỹ năng do giáo viên đặt không ánh xạ được, hệ thống giữ chế độ tổng hợp thay vì đoán bừa.

Chế độ ôn:

```json
{ "mode": "review", "limit": 10 }
```

chỉ trả các puzzle trong Sổ Sai Lầm đã đến hạn.

## Ghi kết quả

`POST /api/academy/training/result`

Frontend gửi:

- puzzle ID;
- số lần sai;
- có dùng gợi ý hay không;
- thời gian giải;
- mode/kỹ năng/theme của lượt luyện.

Backend tự đọc rating/theme thật từ Puzzle DB. `eventId` làm request idempotent để retry mạng không cộng XP hai lần.

### Tu Vi

Tu Vi chỉ tăng. Bài sạch nhận nhiều XP hơn; dùng gợi ý nhận ít hơn. Nếu lặp cùng puzzle trong vòng 20 giờ, XP giảm mạnh để tránh farm.

### Puzzle Rating

Puzzle Rating tăng/giảm theo độ khó puzzle và chất lượng lời giải. Nó là rating luyện tập nội bộ của ChessApp, không phải FIDE/chess.com/Lichess rating.

### Mastery

Mastery bắt đầu từ điểm kỹ năng của Khảo Thí Nhập Môn nếu có. Mỗi puzzle cập nhật dần bằng kết quả thực tế, nên Skill Map không bị đóng băng sau bài test đầu vào.

## Sổ Sai Lầm

Puzzle được đưa vào Sổ Sai Lầm khi:

- có ít nhất một nước sai; hoặc
- đệ tử dùng gợi ý.

Các lần vượt lại sạch làm giãn lịch ôn. Nếu lại sai, lịch quay về ôn sớm.

`GET /api/academy/training/mistakes`

trả danh sách bài đang theo dõi và trạng thái đến hạn.

## Frontend

`/realms` có ba chế độ:

1. **Cá nhân hóa** — dùng Step + Skill Map + Puzzle Rating.
2. **Ôn Sổ Sai Lầm** — chỉ puzzle đến hạn.
3. **Tự chọn** — giữ nguyên Bí Cảnh thủ công cũ cho khách và học viên muốn tự luyện.

Khách chưa đăng nhập vẫn dùng Bí Cảnh cũ bình thường.
