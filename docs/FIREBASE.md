# Firebase cho ChessApp

ChessApp giữ FastAPI cho PDF/DOCX, OpenCV, nhận diện bàn cờ và Stockfish. Firebase được dùng cho dữ liệu ứng dụng cần CRUD và đồng bộ.

## 1. Tạo Firebase project

1. Mở Firebase Console và tạo project.
2. Add app -> Web.
3. Bật **Authentication -> Email/Password**.
4. Tạo **Cloud Firestore**.
5. Tạo ít nhất một tài khoản quản trị trong Authentication.

## 2. Cấu hình frontend

Trong `frontend/`:

```bash
copy .env.local.example .env.local
```

Điền các giá trị của Firebase Web App vào `.env.local`, sau đó:

```bash
npm install
npm run dev
```

Trang quản trị nằm ở:

```text
http://localhost:3000/admin
```

Nếu chưa cấu hình Firebase, các trang hiện tại vẫn dùng dữ liệu fallback trong `src/lib/daoPaths.ts`.

## 3. Firestore structure

```text
daoPaths/{slug}
  name
  han
  epithet
  intro
  doctrine
  order

  modules/{moduleId}
    title
    subtitle
    description
    themes[]
    puzzleTheme
    order

    lessons/{lessonId}
      title
      subtitle
      description
      order
      fen?
      pgn?
```

Sau khi đăng nhập `/admin`, bấm **Khởi tạo dữ liệu mẫu** để đưa bốn Đạo hiện tại và các module từ `daoPaths.ts` lên Firestore.

## 4. Security rules

`firestore.rules` hiện cho phép mọi người đọc `daoPaths`, nhưng chỉ người đã đăng nhập Firebase Authentication mới được ghi.

Đây là cấu hình giai đoạn đầu phù hợp khi project chỉ có tài khoản quản trị. Trước khi mở đăng ký tài khoản công khai, nên đổi quyền ghi sang custom claim `admin` hoặc một cơ chế role riêng.

## 5. Phạm vi hiện tại

- Firebase: Đạo, module, bài học, Authentication.
- FastAPI: giữ nguyên xử lý sách, AI, Stockfish.
- SQLite: tiếp tục dùng cho kho puzzle Lichess trong giai đoạn này.
