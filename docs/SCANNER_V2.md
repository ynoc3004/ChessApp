# Scanner v2 — ChessApp

Scanner v2 nâng workflow quét sách nhưng **không thay đổi thuật toán detector trong `backend/app/detector.py`**.

## Luồng mới

1. Chọn PDF hoặc DOCX.
2. Có thể để trống để quét toàn bộ hoặc nhập `Từ` / `Đến` để chỉ quét một khoảng.
   - PDF: số trang.
   - DOCX: thứ tự ảnh đọc được trong tài liệu; EMF/WMF vẫn bị bỏ qua như scanner cũ.
3. Backend xử lý từng trang/ảnh độc lập và ghi `status.json` sau mỗi bước.
4. Có thể tạm dừng. Pause có hiệu lực trước trang kế tiếp; trang đang xử lý được phép hoàn tất trước.
5. Một trang lỗi không làm hỏng cả job. Trang lỗi được lưu trong `failedPages` và có thể retry riêng.
6. Diagram có detector confidence dưới `0.76` được gắn `needsReview=true`.
7. Frontend có filter `Cần duyệt`; nút `Duyệt & sửa bàn cờ` mở màn `/analysis` hiện có, nơi AI recognition, square confidence và editor bàn cờ trực quan tiếp tục xử lý.
8. Với PDF, manual crop hiện có vẫn dùng được để thêm bàn cờ detector bỏ sót.

## API

```text
POST /api/scanner/v2/start
GET  /api/scanner/v2/jobs/{job_id}
POST /api/scanner/v2/jobs/{job_id}/pause
POST /api/scanner/v2/jobs/{job_id}/resume
POST /api/scanner/v2/jobs/{job_id}/retry-page
GET  /api/scanner/v2/books/{job_id}/review
```

`POST /start` là multipart upload và nhận hai field tùy chọn:

```text
page_start
page_end
```

Không truyền hai field này = quét toàn bộ.

## Trạng thái job

Scanner v2 giữ các field tương thích với scanner cũ (`jobId`, `filename`, `status`, `current`, `total`, `progress`, `count`, `positions`, `error`) và bổ sung:

```text
scannerVersion
phase
pageStart
pageEnd
sourceTotal
currentPage
processedPages
failedPages
pageStates
reviewCount
```

`status` có thêm giá trị `paused`.

## Tương thích dữ liệu

Scanner v2 vẫn ghi:

```text
backend/data/uploads/<jobId>.<pdf|docx>
backend/data/positions/<jobId>/book.json
backend/data/positions/<jobId>/status.json
backend/data/positions/<jobId>/position-XXXX.png
```

Vì vậy các API download, recognition, Admin Books và trang Analysis hiện tại tiếp tục dùng cùng dữ liệu.

## Retry

Retry một trang:

- xóa diagram/cache recognition/correction thuộc riêng trang đó;
- giữ nguyên ID của diagram ở các trang khác;
- scan lại đúng trang được chọn;
- không làm mất danh sách các trang lỗi khác;
- nếu retry thành công, trang đó được gỡ khỏi `failedPages`.

## Pause / restart backend

Pause không cố ngắt OpenCV/PyMuPDF giữa một trang vì việc kill giữa xử lý ảnh dễ để lại trạng thái nửa chừng. Worker dừng an toàn ở ranh giới giữa hai trang.

Nếu backend bị restart, worker thread không còn tồn tại. Job `queued/processing` được cơ chế recovery hiện có đánh dấu thất bại. Scanner v2 cũng phát hiện trường hợp `paused` nhưng không còn worker và chuyển sang `failed` thay vì để UI chờ vô hạn.

## Review queue

`needsReview` ở Scanner v2 là độ tin cậy của **detector/crop**, không phải kết quả nhận quân cuối cùng. Khi mở `/analysis`, recognizer tiếp tục có confidence từng ô và `uncertainSquares`; người dùng có thể sửa quân trực tiếp trên bàn cờ trước khi lưu FEN hoặc chạy Stockfish.
