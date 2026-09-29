# Firebase cho ChessApp

Firebase lưu Đạo, Môn/Cảnh và Bài học. FastAPI vẫn xử lý sách, nhận diện bàn cờ, Stockfish và kho puzzle SQLite.

## 1. Hoàn tất Firebase Console

Web app của project `chessapp-ac295` đã được đăng ký. Còn ba bước trong [Firebase Console](https://console.firebase.google.com/project/chessapp-ac295/overview):

1. **Build → Firestore Database → Create database**. Chọn Production mode và một region gần người dùng (ví dụ Singapore nếu được cung cấp). Region không đổi được sau khi tạo.
2. **Build → Authentication → Get started → Sign-in method → Email/Password**: bật Email/Password. Trong **Users → Add user**, tạo tài khoản của bạn. Giữ mật khẩu riêng, không ghi vào repo hoặc gửi qua chat.
3. Trong **Firestore Database → Rules**, thay nội dung bằng [`firestore.rules`](../firestore.rules) và bấm **Publish**. Dữ liệu Đạo đọc công khai, quyền ghi chỉ dành cho UID có document admin đã bật.

Để cấp quyền cho tài khoản vừa tạo:

1. Trong **Authentication → Users**, copy **User UID** (không phải email).
2. Trong **Firestore Database → Data**, tạo collection `admins`, document ID là chính UID đó, với trường `enabled` kiểu **boolean**, giá trị `true`.
3. Rules không cho ứng dụng web tự tạo hoặc sửa document admin. Chỉ chủ project tạo được trong Console.

Nên cấp quyền admin và Publish rules **trước khi** bấm khởi tạo dữ liệu.

## 2. Chạy nhánh Firebase trên Windows

Mở PowerShell trong repo và chạy:

```powershell
git fetch origin
git switch feature/firebase-admin-crud
cd frontend
Copy-Item .env.local.example .env.local
npm install
npm run dev
```

File mẫu đã điền đúng cấu hình Web App `chessapp-ac295` mà chủ project cung cấp. Firebase Web config là thông tin phía client; bảo mật dựa vào Authentication và Firestore rules. `.env.local` được gitignore. Nếu `git switch` báo thay đổi local có nguy cơ bị ghi đè, hãy lưu các thay đổi đó trước khi chuyển nhánh.

Mở `http://localhost:3000/admin` và đăng nhập bằng tài khoản vừa tạo. Nếu trang báo chưa có quyền, dùng UID được hiện ở trang để kiểm tra document `admins/{uid}`, trường `enabled` và rules đã Publish, rồi tải lại. Bấm **Khởi tạo dữ liệu mẫu** một lần để đưa bốn Đạo cùng các Môn/Cảnh lên Firestore. Nút này chỉ tạo mục mặc định còn thiếu, không ghi đè nội dung đã sửa.

Để thử toàn bộ web, mở thêm backend trong cửa sổ PowerShell khác:

```powershell
cd D:\code\ChessApp\backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Trang `/admin` nói chuyện trực tiếp với Firebase nên không cần backend để thử CRUD.

## 3. Cấu trúc dữ liệu

```text
admins/{uid}
  enabled: true

daoPaths/{slug}
  name, han, epithet, intro, doctrine, order
  modules/{moduleId}
    title, subtitle, description, themes[], puzzleTheme, order
    lessons/{lessonId}
      title, subtitle, description, order, fen?, pgn?
```

Nếu Firebase chưa cấu hình, các trang công khai dùng dữ liệu mẫu trong `src/lib/daoPaths.ts`. Khi Firebase đã cấu hình, Firestore là nguồn dữ liệu; một database trống sẽ hiển thị trống cho đến khi admin khởi tạo.

Collection/Tàng Kinh Các vẫn dùng SQLite ở backend trong giai đoạn này. Không đưa kho puzzle Lichess nhiều triệu câu lên Firestore.
