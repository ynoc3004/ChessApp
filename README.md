# Chess Book Reader — Phase 2.1

Website local để biến diagram trong sách cờ thành thế cờ có thể phân tích:

1. Upload `.pdf` hoặc `.docx`.
2. OpenCV tìm và crop các diagram 8×8.
3. Gallery hiển thị toàn bộ diagram tìm được.
4. Khi mở một diagram, AI nhận dạng 64 ô và sinh FEN piece-placement tự động.
5. Người dùng có thể đổi **Trắng ở dưới / Đen ở dưới** và **Trắng đi / Đen đi**.
6. Editor sửa quân trực tiếp: chọn quân → click ô, kéo quân tự do, xóa, undo, clear board, khôi phục kết quả AI.
7. Có thể chỉnh quyền nhập thành, en passant và FEN thủ công.
8. **Mở thẳng vị trí trên Lichess Analysis** bằng FEN hiện tại.
9. Mở Chess.com Analysis đồng thời copy FEN để dùng `Load FEN`.
10. Stockfish local trả Top 3 engine lines nếu máy đã cấu hình engine.

## Phase 2 dùng gì?

AI recognition dùng `chessimg2pos==0.1.6` (PyTorch, MIT). Recognition chạy **lazy**: model chỉ chạy khi người dùng mở một diagram, vì vậy sách 700 trang không bị bắt nhận dạng AI toàn bộ cùng lúc. Kết quả nhận dạng được cache thành JSON cạnh ảnh đã crop.

> Hình cờ chỉ cho biết chắc phần **piece placement**. Nó không cho biết chắc bên nào đến lượt, quyền nhập thành, en-passant, halfmove clock hay move number. UI cho người dùng chọn bên đi; các field còn lại mặc định là `- - 0 1`.

## Cập nhật code trên máy

```powershell
cd D:\code\ChessApp
git pull origin main
```

## Cập nhật backend cho Phase 2

Nếu `.venv` đã tồn tại:

```powershell
cd D:\code\ChessApp\backend
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Kiểm tra:

```text
http://localhost:8000/health
```

Kết quả đúng:

```json
{"ok": true, "phase": 2}
```

Lần cài Phase 2 đầu tiên có thể lâu hơn vì `chessimg2pos` kéo theo PyTorch / torchvision.

## Chạy frontend

Mở PowerShell thứ hai:

```powershell
cd D:\code\ChessApp\frontend
$env:Path += ";C:\Program Files\nodejs"
npm install
npm run dev
```

Mở:

```text
http://localhost:3000
```

## Cách dùng Phase 2

Sau khi quét sách, bấm **AI đọc FEN & phân tích** ở một diagram. Trang analysis sẽ tự gọi `POST /api/recognize`, đọc ảnh và nạp FEN lên bàn cờ.

Nếu bàn trong sách quay từ phía Đen, bấm **Đen ở dưới**. Nếu đề ghi Black to move, chọn **Đen đi**. Sau đó đối chiếu các quân với ảnh trước khi chạy Stockfish.

## API

### POST /api/recognize

```json
{
  "jobId": "<32-char job id>",
  "positionId": 1,
  "force": false
}
```

Response gồm:

```json
{
  "piecePlacement": "r3k2r/pp1nbppp/2b5/1p1n1p2/2PP4/3Q1NB1/1P3PPP/R4RK1",
  "fen": "r3k2r/pp1nbppp/2b5/1p1n1p2/2PP4/3Q1NB1/1P3PPP/R4RK1 w - - 0 1",
  "suggestedOrientation": "white",
  "orientationConfidence": 0.8,
  "candidates": {
    "whiteBottom": "...",
    "blackBottom": "..."
  },
  "warnings": []
}
```

`force: true` bỏ cache và chạy AI lại.

## Hạn chế hiện tại

- Font quân cờ rất khác dữ liệu huấn luyện hoặc scan mờ có thể làm AI đọc sai.
- Tự đoán hướng chỉ là heuristic; nút đổi hướng luôn có sẵn.
- Chưa có editor click từng ô để thay quân bằng palette; hiện có thể sửa FEN thủ công.
- Prototype vẫn dùng PyMuPDF để render PDF; cần rà soát license trước khi biến thành sản phẩm proprietary/đóng nguồn.


## Phase 2.1 — Position editor & external analysis

Ở trang analysis:

- **Sửa thế cờ**: chọn quân trong palette rồi click vào ô; kéo-thả quân là di chuyển tự do, không kiểm tra luật.
- **Thử nước**: kéo-thả theo luật cờ vua.
- **Hoàn tác / Xóa hết bàn / Khôi phục AI**.
- Badge **Vị trí hợp lệ / Chưa hợp lệ** giúp biết khi nào đã sẵn sàng phân tích.
- **Mở phân tích trên Lichess** truyền FEN trực tiếp trong URL.
- **Mở Chess.com + copy FEN** mở Analysis Board và đặt FEN vào clipboard; trên Chess.com dùng Load FEN.
- **Stockfish trong web** chỉ bật nếu backend tìm thấy executable qua `STOCKFISH_PATH` hoặc lệnh `stockfish` trong PATH.

Lichess là lựa chọn không cần cài thêm engine trên máy.


CI: frontend production build + backend Python syntax check chạy tự động trên mỗi push vào `main`.


## Các tiện ích đã thêm

- AI model được giữ trong RAM sau lần nhận dạng đầu tiên, nên mở thế cờ thứ 2 trở đi nhanh hơn.
- AI trả confidence theo từng ô; các ô dưới ngưỡng 72% được viền cảnh báo và liệt kê để click kiểm tra nhanh.
- Kết quả quét sách mới được lưu metadata ở backend; frontend tự khôi phục lần quét gần nhất sau khi refresh.
- Có nút **Tải tất cả ảnh (.zip)** để tải toàn bộ diagram của một quyển sách.
- Recognition cache cũ tự được nâng cấp lại khi thiếu dữ liệu confidence.


## Lịch sử sách & export

- Backend lưu `book.json` cho mỗi job mới.
- Trang chủ tự khôi phục job gần nhất sau khi refresh.
- Có danh sách tối đa 20 sách quét gần đây trên máy local.
- Có thể tải toàn bộ diagram thành ZIP.
- Có thể tải `recognized-positions.json` chứa các thế cờ đã mở qua AI, kèm FEN, page, confidence và các ô confidence thấp.
- Có thể xóa toàn bộ dữ liệu của một job từ giao diện.


## Quét sách nền và tiến trình

Frontend mới dùng `POST /api/books/start` để bắt đầu quét trong background thread và poll `GET /api/jobs/{jobId}`.

- Hiện phần trăm quét và `X / tổng số trang`.
- Hình cờ xuất hiện dần ngay khi backend tìm thấy.
- API `POST /api/books` cũ vẫn được giữ để tương thích/fallback.
- Khi hoàn tất, metadata được lưu vào lịch sử local như bình thường.
