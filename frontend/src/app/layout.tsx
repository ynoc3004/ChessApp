import "./globals.css";
import "./fairyland-theme.css";
import "./home-typography.css";
import "./home-motion.css";
import "./analysis-theme.css";
import "./analysis-polish.css";
import "./analysis-layout-fix.css";
import type { Metadata } from "next";
import HanVietMode from "@/components/HanVietMode";
import HanVietSupplement from "@/components/HanVietSupplement";

export const metadata: Metadata = {
  title: "Kỳ Phổ Đạo Các | Tham ngộ kỳ đạo",
  description: "Khai phổ PDF, DOCX; tầm kỳ đồ và diễn toán chư biến cùng Stockfish.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <HanVietMode />
        <HanVietSupplement />
        {children}
      </body>
    </html>
  );
}
