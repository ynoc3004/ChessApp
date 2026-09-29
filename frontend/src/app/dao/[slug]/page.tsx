import Link from "next/link";
import { notFound } from "next/navigation";
import { DAO_PATHS, getDaoPath } from "@/lib/daoPaths";
import styles from "./dao.module.css";

export function generateStaticParams() {
  return DAO_PATHS.map((path) => ({ slug: path.slug }));
}

export default async function DaoPathPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const path = getDaoPath(slug);
  if (!path) notFound();

  return (
    <main className={styles.page} data-dao={path.slug}>
      <div className={styles.clouds} aria-hidden="true" />

      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">Kỳ Phổ Đạo Các</Link>
        <nav className={styles.topnav} aria-label="Đạo lộ điều hướng">
          <Link href="/#upload">Nạp Kỳ Phổ</Link>
          <Link href="/#library">Tàng Kinh Các</Link>
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
          {DAO_PATHS.map((item) => (
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
              <h2 id="dao-modules-title">Lục cảnh tu tập</h2>
            </div>
            <div className={styles.sectionNote}>
              Mỗi cảnh có kỳ thế Lichess liên quan để luyện ngay. Chủ đề câu đố giúp thực hành chiến thuật, còn đạo quyết là phần định hướng học.
            </div>
          </div>

          <div className={styles.modules}>
            {path.modules.map((module, index) => (
              <article
                key={module.title}
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
                  href={`/realms?path=${path.slug}&module=${index + 1}`}
                  aria-label={`Luyện thế Lichess liên quan đến ${module.title}`}
                >
                  Luyện kỳ thế liên quan <span aria-hidden="true">↗</span>
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.sourcePanel} aria-label="Kỳ thế nguyên lưu">
          <article className={styles.sourceCard}>
            <strong>Lichess Kỳ Trận Khố</strong>
            <p>
              Mỗi cảnh mở kho câu đố theo chủ đề gần với nội dung học; bạn có thể chỉnh rating và lưu thế hay vào Tàng Kinh Các.
            </p>
          </article>
          <article className={styles.sourceCard}>
            <strong>Tàng Kinh Kỳ Thế</strong>
            <p>
              Kỳ thế bạn lưu từ sách vẫn ở Tàng Kinh Các cùng nguồn, FEN và ghi chú để xem lại hoặc phân tích.
            </p>
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
