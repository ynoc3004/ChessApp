import "./globals.css";
import "./fairyland-theme.css";
import "./home-typography.css";
import "./home-motion.css";
import "./guardian-dao-nav.css";
import "./analysis-theme.css";
import "./analysis-polish.css";
import "./analysis-layout-fix.css";
import "./analysis-glass.css";
import "./site-chrome.css";
import type { Metadata } from "next";
import HanVietMode from "@/components/HanVietMode";
import HanVietSupplement from "@/components/HanVietSupplement";
import GuardianDaoNavEnhancer from "@/components/GuardianDaoNavEnhancer";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

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
        <GuardianDaoNavEnhancer />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
