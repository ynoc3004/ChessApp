"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadDaoPaths, type ManagedDaoPath } from "@/lib/daoStore";
import styles from "./dao.module.css";

export default function DaoPathClient({ slug }: { slug: string }) {
  const [paths, setPaths] = useState<ManagedDaoPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void loadDaoPaths()
      .then((data) => {
        if (active) setPaths(data);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Không tải được Đạo lộ.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const path = useMemo(() => paths.find((item) => item.slug === slug), [paths, slug]);

  if (loading) {
    return <main className={styles.page}><div className={styles.shell}><p>Đang mở Đạo lộ…</p></div></main>;
  }

  if (!path) {
    return <main className={styles.page}><div className={styles.shell}><h1>Không tìm thấy Đạo lộ</h1><p>{message || "Nội dung này chưa tồn tại hoặc đã bị xóa."}</p><Link href="/">← Hồi Kỳ Phổ Đạo Các</Link></div></main>;
  }

  return (
    <main className={styles.page} data-dao={path.slug}>
      <div className={styles.clouds} aria-hidden="true" />

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">Kỳ Phổ Đạo Các</Link>
        <nav className={styles.topnav} aria-label="Đạo lộ điều hướng">
          <Link href="/#upload">Nạp Kỳ Phổ</Link>
          <Link href="/collection">Tàng Kinh Các</Link>
          <Link href="/">Hồi Các</Link>
        </nav>
      </header>

      <div className={styles.shell}>
        <section className={styles.hero} data-han={path.han}>
          <div>
            <p className={styles.kicker}>TỨ TƯỢNG · KỲ ĐẠO PHÂN LỘ</p>
            <h1>{path.name}</h1>
            <p className={styles.epithet}>{path.epithet}</p>
            <p className={styles.intro}>{path.intro}</p>
          </div>
          <aside className={styles.doctrine}>
            <span>ĐẠO QUYẾT</span>
            <p>“{path.doctrine}”</p>
          </aside>
        </section>

        <nav className={styles.pathSwitcher} aria-label="Tứ Tượng Đạo Lộ">
          {paths.map((item) => (
            <Link
              key={item.slug}
              href={`/dao/${item.slug}`}
              className={item.slug === path.slug ? styles.active : ""}
            >
              {item.name}
            </Link>
          ))}
        </nav>

        <section aria-labelledby="dao-modules-title">
          <div className={styles.sectionHead}>
            <div>
              <p>ĐẠO LỘ KỲ THẾ</p>
              <h2 id="dao-modules-title">Các cảnh tu tập</h2>
            </div>
            <div className={styles.sectionNote}>
              Mỗi cảnh có kỳ thế Lichess liên quan để luyện ngay. Nội dung được quản lý từ Firestore khi Firebase đã cấu hình.
            </div>
          </div>

          <div className={styles.modules}>
            {path.modules.map((module, index) => (
              <article
                key={module.id}
                className={styles.moduleCard}
                data-index={String(index + 1).padStart(2, "0")}
              >
                <h3>{module.title}</h3>
                <span>{module.subtitle}</span>
                <p>{module.description}</p>
                <div className={styles.tags} aria-label={`${module.title} chủ đề`}>
                  {module.themes.map((theme) => <span key={theme}>{theme}</span>)}
                </div>
                <Link
                  className={styles.practiceLink}
                  href={`/realms?path=${path.slug}&moduleId=${encodeURIComponent(module.id)}`}
                  aria-label={`Luyện thế Lichess liên quan đến ${module.title}`}
                >
                  Luyện kỳ thế liên quan <span aria-hidden="true">↗</span>
                </Link>
                {module.lessons.length > 0 && <small>{module.lessons.length} bài học đã soạn</small>}
              </article>
            ))}
          </div>
        </section>

        <section className={styles.sourcePanel} aria-label="Kỳ thế nguyên lưu">
          <article className={styles.sourceCard}>
            <strong>Lichess Kỳ Trận Khố</strong>
            <p>Mỗi cảnh mở kho câu đố theo chủ đề gần với nội dung học; bạn có thể chỉnh rating và lưu thế hay vào Tàng Kinh Các.</p>
          </article>
          <article className={styles.sourceCard}>
            <strong>Tàng Kinh Kỳ Thế</strong>
            <p>Kỳ thế bạn lưu từ sách vẫn ở Tàng Kinh Các cùng nguồn, FEN và ghi chú để xem lại hoặc phân tích.</p>
          </article>
        </section>

        <footer className={styles.footer}>
          <span>{path.han} · {path.epithet}</span>
          <Link href="/">← Hồi Kỳ Phổ Đạo Các</Link>
        </footer>
      </div>
    </main>
  );
}
