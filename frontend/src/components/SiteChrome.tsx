"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./SiteChrome.module.css";

const paths = [
  { href: "/dao/thanh-long", label: "Thanh Long" },
  { href: "/dao/bach-ho", label: "Bạch Hổ" },
  { href: "/dao/chu-tuoc", label: "Chu Tước" },
  { href: "/dao/huyen-vu", label: "Huyền Vũ" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const daoActive = pathname.startsWith("/dao/");

  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#main-content">Bỏ qua điều hướng</a>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label="Kỳ Phổ Đạo Các — trang chủ">
          <span className={styles.brandMark} aria-hidden="true">♞</span>
          <span><strong>Kỳ Phổ Đạo Các</strong><small>Từ kỳ phổ đến kỳ đạo</small></span>
        </Link>
        <nav className={styles.navigation} aria-label="Điều hướng chính">
          <Link href="/#upload" aria-current={pathname === "/" ? "page" : undefined}>Nhập sách</Link>
          <Link href="/#library">Thư viện sách</Link>
          <details className={styles.daoMenu}>
            <summary className={daoActive ? styles.active : undefined}>Tứ Tượng <span aria-hidden="true">⌄</span></summary>
            <div className={styles.daoLinks} aria-label="Bốn đạo lộ">
              {paths.map((path) => <Link key={path.href} href={path.href} aria-current={pathname === path.href ? "page" : undefined}>{path.label}</Link>)}
            </div>
          </details>
          <Link href="/realms" aria-current={pathname === "/realms" ? "page" : undefined}>Bí Cảnh</Link>
          <Link href="/collection" aria-current={pathname === "/collection" ? "page" : undefined}>Tàng Kinh Các</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}><span aria-hidden="true">♞</span><div><strong>Kỳ Phổ Đạo Các</strong><small>Mỗi thế cờ, một điều khai mở.</small></div></div>
        <nav aria-label="Điều hướng cuối trang">
          <Link href="/#upload">Nhập sách</Link>
          <Link href="/#library">Thư viện sách</Link>
          <Link href="/dao/thanh-long">Tứ Tượng</Link>
          <Link href="/realms">Bí Cảnh</Link>
          <Link href="/collection">Tàng Kinh Các</Link>
        </nav>
        <p>Quét sách · Phân tích Stockfish · Luyện thế Lichess</p>
      </div>
    </footer>
  );
}
