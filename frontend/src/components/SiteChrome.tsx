"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const primaryNav = [
  { href: "/#upload", match: "/", label: "Khai Phổ", note: "Nạp kỳ kinh" },
  { href: "/collection", match: "/collection", label: "Tàng Kinh Các", note: "Tàng kỳ thế" },
  { href: "/realms", match: "/realms", label: "Bí Cảnh", note: "Luyện kỳ cục" },
] as const;

const daoNav = [
  { href: "/dao/thanh-long", label: "Thanh Long", han: "青龍" },
  { href: "/dao/bach-ho", label: "Bạch Hổ", han: "白虎" },
  { href: "/dao/chu-tuoc", label: "Chu Tước", han: "朱雀" },
  { href: "/dao/huyen-vu", label: "Huyền Vũ", han: "玄武" },
] as const;

function useHideChrome() {
  const pathname = usePathname();
  return pathname.startsWith("/analysis");
}

export function SiteHeader() {
  const pathname = usePathname();
  const hidden = useHideChrome();
  if (hidden) return null;

  return (
    <header className="siteHeader" data-site-chrome="header">
      <div className="siteHeaderInner">
        <Link className="siteIdentity" href="/" aria-label="Kỳ Phổ Đạo Các · Hồi các">
          <span className="siteSeal" aria-hidden="true">
            <b>棋</b>
            <i>☯</i>
          </span>
          <span className="siteIdentityText">
            <strong>Kỳ Phổ Đạo Các</strong>
            <small>Kỳ kinh · diễn trận · ngộ đạo</small>
          </span>
        </Link>

        <nav className="sitePrimaryNav" aria-label="Chủ đạo điều hướng">
          {primaryNav.map((item) => {
            const active = item.match === "/" ? pathname === "/" : pathname.startsWith(item.match);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                <span>{item.label}</span>
                <small>{item.note}</small>
              </Link>
            );
          })}

          <details className="daoMenu">
            <summary className={pathname.startsWith("/dao/") ? "active" : ""}>
              <span>Tứ Tượng</span>
              <small>Phân lộ kỳ đạo</small>
            </summary>
            <div className="daoMenuPanel">
              <p>TỨ TƯỢNG · ĐẠO LỘ</p>
              {daoNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathname === item.href ? "active" : ""}
                >
                  <b>{item.han}</b>
                  <span>{item.label} Đạo</span>
                  <i aria-hidden="true">→</i>
                </Link>
              ))}
            </div>
          </details>
        </nav>

        <Link className="siteRealmShortcut" href="/realms" title="Tiến nhập Bát Quái Bí Cảnh">
          <span aria-hidden="true">☯</span>
          <b>Nhập Bí Cảnh</b>
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const hidden = useHideChrome();
  if (hidden) return null;

  return (
    <footer className="siteFooter" data-site-chrome="footer">
      <div className="siteFooterMist" aria-hidden="true" />
      <div className="siteFooterInner">
        <section className="siteFooterBrand" aria-label="Kỳ Phổ Đạo Các">
          <span className="siteFooterSeal" aria-hidden="true">棋</span>
          <div>
            <strong>Kỳ Phổ Đạo Các</strong>
            <p>Khảo kỳ phổ · Quan kỳ cục · Diễn chư biến · Ngộ kỳ đạo.</p>
            <blockquote>“Nhất cục nhất ngộ, bộ bộ tinh tiến.”</blockquote>
          </div>
        </section>

        <nav className="siteFooterNav" aria-label="Kỳ học điều hướng">
          <p>KỲ HỌC</p>
          <Link href="/#upload">Khai Phổ</Link>
          <Link href="/collection">Tàng Kinh Các</Link>
          <Link href="/realms">Bát Quái Bí Cảnh</Link>
          <Link href="/#library">Bản Mệnh Kỳ Phổ</Link>
        </nav>

        <nav className="siteFooterNav daoFooterNav" aria-label="Tứ Tượng đạo lộ">
          <p>TỨ TƯỢNG ĐẠO LỘ</p>
          {daoNav.map((item) => (
            <Link href={item.href} key={item.href}>
              <span>{item.han}</span> {item.label}
            </Link>
          ))}
        </nav>

        <section className="siteFooterAside">
          <p>THAM KỲ TÂM QUYẾT</p>
          <strong>Tĩnh tâm quan cục.</strong>
          <span>Định thế trước, cầu biến sau.</span>
          <span>Stockfish vi kính, kỳ lý vi bản.</span>
        </section>
      </div>

      <div className="siteFooterBase">
        <span>☯ Kỳ Phổ Đạo Các</span>
        <span className="siteFooterLine" aria-hidden="true" />
        <span>Tiên sơn vân hải · Kỳ đạo vô cùng</span>
      </div>
    </footer>
  );
}
