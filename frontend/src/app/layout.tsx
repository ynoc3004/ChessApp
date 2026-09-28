import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kỳ Phổ Đạo Các | Không gian học cờ",
  description: "Khám phá thế cờ từ sách PDF, DOCX và phân tích từng nước đi cùng Stockfish.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
