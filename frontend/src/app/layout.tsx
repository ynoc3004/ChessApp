import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chess Book Reader",
  description: "Extract chess diagrams from PDF/DOCX and analyze positions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
