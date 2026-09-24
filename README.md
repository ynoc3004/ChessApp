# Chess Book Reader — Phase 2

Website local để biến diagram trong sách cờ thành thế cờ có thể phân tích:

1. Upload `.pdf` hoặc `.docx`.
2. OpenCV tìm và crop các diagram 8×8.
3. Gallery hiển thị toàn bộ diagram tìm được.
4. Khi mở một diagram, AI nhận dạng 64 ô và sinh FEN piece-placement tự động.
5. Người dùng có thể đổi **Trắng ở dưới / Đen ở dưới** và **Trắng đi / Đen đi**.
6. Có thể sửa FEN thủ công trước khi chạy Stockfish.
7. Stockfish trả Top 3 engine lines nếu `STOCKFISH_PATH` đã được cấu hình.

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
