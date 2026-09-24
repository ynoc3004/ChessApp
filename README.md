# Chess Book Reader — MVP 1

MVP này làm được:

1. Upload `.pdf` hoặc `.docx`.
2. Backend render / đọc ảnh và dùng OpenCV để tìm vùng có hình dạng giống bàn cờ 8×8.
3. Tách các diagram thành PNG riêng.
4. Hiện gallery để tải ảnh.
5. Mở từng diagram cạnh một bàn cờ React tương tác.
6. Nạp FEN, kéo quân hợp lệ và (nếu cấu hình Stockfish) lấy Top 3 engine lines.

> Chưa có ở MVP 1: tự nhận dạng quân cờ từ ảnh → FEN. Đó là phase 2.

## Yêu cầu

- Node.js 20+ (khuyến nghị Node 22+)
- Python 3.11 hoặc 3.12
- Stockfish nếu muốn bật engine analysis

## 1. Chạy backend

Windows PowerShell:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

macOS/Linux:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Kiểm tra: mở `http://localhost:8000/health`.

## 2. Chạy frontend

Mở terminal thứ hai:

```bash
cd frontend
npm install
npm run dev
```

Mở `http://localhost:3000`.

## 3. Bật Stockfish

Tải Stockfish phù hợp hệ điều hành và đặt biến môi trường `STOCKFISH_PATH` trỏ tới executable.

PowerShell ví dụ:

```powershell
$env:STOCKFISH_PATH="C:\\tools\\stockfish\\stockfish-windows-x86-64-avx2.exe"
uvicorn app.main:app --reload --port 8000
```

macOS/Linux ví dụ:

```bash
export STOCKFISH_PATH=/usr/local/bin/stockfish
uvicorn app.main:app --reload --port 8000
```

## Cách detector hiện tại hoạt động

Đây là detector heuristic, không phải AI:

- tìm contour gần hình vuông;
- kiểm tra các đường ngang/dọc gần vị trí 9 đường biên của bàn 8×8;
- kiểm tra pattern sáng/tối xen kẽ của 64 ô;
- loại các box trùng nhau bằng IoU.

Nó hoạt động tốt nhất với diagram in rõ, nhìn gần vuông, nhưng có thể bỏ sót hình scan mờ hoặc nhận nhầm bảng biểu.

## Phase 2: image → FEN

Nên làm theo pipeline:

```text
board crop
  → chuẩn hóa perspective
  → chia 8×8
  → classifier 13 lớp (empty + 12 quân)
  → sửa tay nếu confidence thấp
  → sinh FEN
```

Model có thể dùng PyTorch/ONNX. Khi có model, thêm endpoint:

```text
POST /api/recognize-position
```

response:

```json
{
  "fen": "r3k2r/pp1nbppp/2b5/1p1n1p2/2PP4/3Q1NB1/1P3PPP/R4RK1 w - - 0 14",
  "confidence": 0.94,
  "uncertainSquares": ["c6"]
}
```

## Lưu ý license

Prototype backend dùng **PyMuPDF** để render PDF vì rất tiện. PyMuPDF hiện dùng dual license AGPL/commercial. Nếu bạn muốn làm sản phẩm proprietary/đóng nguồn, hãy rà soát license trước khi deploy hoặc chuyển phần render PDF sang PDF.js (Apache 2.0) ở frontend.
