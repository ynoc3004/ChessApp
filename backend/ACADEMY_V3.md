# Academy v3 — Dashboard Giáo Viên + Giao Bài

Academy v3 nối dữ liệu học thật từ Academy v1/v2 thành workflow dành cho giáo viên.

## Dashboard giáo viên

Trang quản trị:

- `/admin/academy/teacher`

Mỗi giáo viên xem được:

- các lớp đang phụ trách;
- số đệ tử;
- Step, Puzzle Rating và Tu Vi;
- số lượt luyện 7 ngày gần nhất;
- clean rate;
- kỹ năng mastery thấp nhất;
- số bài Sổ Sai Lầm đang đến hạn;
- các tín hiệu cần chú ý.

`needsAttention` chỉ là tín hiệu vận hành từ dữ liệu học, không phải đánh giá tổng thể năng lực hay xếp hạng học viên.

## Giao bài

Giáo viên có thể giao bài cho:

- cả lớp;
- một đệ tử thuộc lớp mình phụ trách.

Mỗi bài gồm:

- tiêu đề và ghi chú;
- Lichess theme hoặc tổng hợp;
- khoảng rating;
- số puzzle cần hoàn thành;
- deadline tùy chọn.

Khi giao cho lớp, danh sách học viên được snapshot vào `academy_assignment_targets`. Việc chuyển lớp sau đó không làm mất lịch sử bài đã giao.

## Tiến độ bài tập

Mỗi puzzle chỉ được tính một lần cho cùng học viên + assignment. Replay puzzle không thể farm tiến độ bài tập.

Trạng thái:

- `pending` — chưa bắt đầu;
- `in_progress` — đã làm ít nhất một phần;
- `overdue` — quá deadline nhưng chưa hoàn thành;
- `completed` — đủ số puzzle yêu cầu.

Bài quá hạn vẫn có thể hoàn thành để giáo viên nhìn thấy tiến độ thật.

## Student workflow

Danh sách bài:

- `/academy/assignments`

Làm bài:

- `/academy/assignments/{assignmentId}`

Mỗi puzzle hoàn thành vẫn đi qua Academy v2 progression nên đồng thời cập nhật:

- Tu Vi/XP;
- Puzzle Rating;
- Skill Mastery;
- Sổ Sai Lầm nếu có sai/gợi ý.

Progress assignment được ghi riêng để không phụ thuộc UI.

## API

Admin:

- `GET /api/admin/academy/teacher/dashboard?teacherId=...`
- `GET /api/admin/academy/teacher/assignments?teacherId=...`
- `POST /api/admin/academy/teacher/assignments`
- `PATCH /api/admin/academy/teacher/assignments/{id}`

Student:

- `GET /api/academy/assignments`
- `GET /api/academy/assignments/{id}`
- `POST /api/academy/assignments/{id}/session`
- `POST /api/academy/assignments/{id}/result`

## Phạm vi v3

v3 chưa tạo hệ đăng nhập giáo viên riêng. Giáo viên thao tác qua Admin Console với dữ liệu teacher đã có từ v1. Việc tách Teacher Portal/Auth có thể làm ở v4 mà không đổi schema assignment hiện tại.

Scanner, Recognition và `detector.py` không thay đổi.
