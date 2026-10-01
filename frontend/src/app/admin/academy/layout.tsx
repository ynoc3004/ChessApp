import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./academyNav.module.css";

export default function AcademyLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <nav className={styles.nav} aria-label="Điều hướng Học Viện">
        <Link href="/admin/academy">門 Quản lý Học Viện</Link>
        <Link href="/admin/academy/teacher">師 Dashboard Giáo Viên</Link>
        <Link href="/admin/academy/teacher-accounts">鑰 Tài Khoản GV</Link>
        <Link href="/admin/academy/tournaments">武 Giải Đấu</Link>
        <Link href="/admin/academy/game-analysis">析 Phân Tích Ván</Link>
      </nav>
      {children}
    </div>
  );
}
