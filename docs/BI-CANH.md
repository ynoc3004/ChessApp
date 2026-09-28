# Bí Cảnh Lichess — phần luyện tập bổ sung

Chức năng chính vẫn là **nhập PDF/DOCX → quét toàn bộ hình cờ → kiểm tra nhận diện → phân tích bằng Stockfish hoặc mở Lichess/chess.com**. Bí Cảnh và Tàng Kinh Các là các trang riêng; không thay đổi thuật toán quét sách.

## Windows: cài và nhập database một lần

Mở CMD mới, giữ cửa sổ frontend chạy:

```bat
cd /d D:\code\ChessApp\backend
py -3 -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

Nếu đã có môi trường Python của backend, chỉ cần kích hoạt nó và cập nhật requirements.

Tải **lichess_db_puzzle.csv.zst** từ https://database.lichess.org/#puzzles (không phải database ván đấu). Giữ nguyên tệp nén. Nhập đường dẫn thật trên máy, ví dụ:

```bat
python scripts/import_lichess_puzzles.py "D:\Downloads\lichess_db_puzzle.csv.zst" --limit 50000
```

50.000 câu giúp thử nhanh; chủ đề/độ khó sẽ phụ thuộc phần dữ liệu đã nhập. Để nhập **toàn bộ**, bỏ `--limit`:

```bat
python scripts/import_lichess_puzzles.py "D:\Downloads\lichess_db_puzzle.csv.zst"
```

Trình nhập đọc tuần tự, tạo chỉ mục chủ đề/rating trong SQLite. Cần dung lượng trống cho tệp tải và SQLite; khi thay thế kho cũ còn cần chỗ cho kho mới tạm. Chạy một tiến trình nhập tại một thời điểm, không luyện câu đố lúc thay kho trên Windows. Nhập lại thành công thay kho puzzle, không xóa sách hoặc bộ sưu tập. Tệp sai định dạng không thay kho cũ.

Bật backend:

```bat
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Mở frontend bằng **http://localhost:3000** để khớp cấu hình CORS hiện tại. Vào **Bí Cảnh**, bấm “Kiểm tra lại kho”, chọn cửa/chủ đề, rating và mở lượt luyện.

## Chức năng

- Mỗi lượt tối đa 10 câu, dữ liệu được lấy từ SQLite; không nạp toàn bộ CSV vào trình duyệt.
- Bát Quái xoay theo cửa được chọn; tên cửa là quy ước giao diện.
- Đi nước bằng kéo-thả, chọn quân khi phong cấp, đối thủ tự đáp trả theo lời giải.
- Sai có thể thử lại; gợi ý và xem nước tiếp theo được ghi là có hỗ trợ.
- Hỗ trợ nước chiếu hết tức thì khác lời giải, theo quy ước của Lichess.
- Khi hoàn thành: xem chủ đề/rating và phân tích vị trí hiện tại bằng Stockfish hoặc mở Lichess/chess.com.
- Lưu bài từ Bí Cảnh hoặc thế đang xem trong màn phân tích sách vào **Tàng Kinh Các**; thêm nhãn chủ đề/ghi chú và tìm kiếm.
- Bộ sưu tập lưu ở backend/data/collection.sqlite3. Lịch sử các bài hoàn thành lưu tại trình duyệt hiện tại; chưa có đồng bộ tài khoản hoặc thuật toán ôn cách quãng.
- Bản này chưa tự phân loại nội dung cả cuốn sách; nhãn hiện áp dụng cho thế đã lưu.

## Nguồn và giới hạn

Puzzle database: Lichess, CC0. https://database.lichess.org/#puzzles

FEN là thế trước nước mở đầu của đối thủ; nước đầu phải được thực hiện trước khi người học giải. Moves dùng UCI. Kho lưu lời giải để dùng offline sau khi đã tải đủ tài nguyên frontend. Đây là luyện tập cá nhân, không phải thi đấu xếp hạng chống gian lận.

Stockfish trong trình duyệt cần các tài nguyên được chép bởi `npm install`. Các liên kết Lichess/chess.com cần Internet. Chưa kèm toàn bộ database trong Git; bạn tải và nhập trên máy theo các bước trên.

## Kiểm tra

```bat
cd backend
python -m pip install httpx
python -m unittest discover -s tests
cd ..\frontend
node tests/puzzle.test.mjs
npm run build
```

Node 24 (như CI) chạy trực tiếp tệp TypeScript dùng trong bài kiểm tra. Kiểm tra quét sách đầy đủ vẫn cần backend cùng thư viện nhận diện thực tế và sách đầu vào.
