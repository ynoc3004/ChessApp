"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth, firebaseConfigured } from "@/lib/firebase";
import {
  deleteDaoLesson,
  deleteDaoModule,
  deleteDaoPath,
  loadDaoPaths,
  makeLessonId,
  makeModuleId,
  saveDaoLesson,
  saveDaoModule,
  saveDaoPath,
  seedDaoPaths,
  type ManagedDaoLesson,
  type ManagedDaoModule,
  type ManagedDaoPath,
} from "@/lib/daoStore";
import styles from "./admin.module.css";

const emptyModule = (title: string, order: number): ManagedDaoModule => ({
  id: makeModuleId(title),
  title,
  subtitle: "",
  description: "",
  themes: [],
  puzzleTheme: "",
  order,
  lessons: [],
});

const emptyLesson = (title: string, order: number): ManagedDaoLesson => ({
  id: makeLessonId(title),
  title,
  subtitle: "",
  description: "",
  order,
});

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [paths, setPaths] = useState<ManagedDaoPath[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedPath = useMemo(
    () => paths.find((item) => item.slug === selectedSlug) ?? null,
    [paths, selectedSlug],
  );
  const selectedModule = useMemo(
    () => selectedPath?.modules.find((item) => item.id === selectedModuleId) ?? null,
    [selectedPath, selectedModuleId],
  );

  async function refresh() {
    setBusy(true);
    try {
      const data = await loadDaoPaths();
      setPaths(data);
      setSelectedSlug((current) =>
        data.some((item) => item.slug === current) ? current : data[0]?.slug ?? "",
      );
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tải được dữ liệu.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!firebaseAuth) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) void refresh();
    });
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      setSelectedModuleId("");
      return;
    }
    if (!selectedPath.modules.some((item) => item.id === selectedModuleId)) {
      setSelectedModuleId(selectedPath.modules[0]?.id ?? "");
    }
  }, [selectedPath, selectedModuleId]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!firebaseAuth) return;
    setBusy(true);
    setMessage("");
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Đăng nhập thất bại.");
    } finally {
      setBusy(false);
    }
  }

  function replacePath(next: ManagedDaoPath) {
    setPaths((current) =>
      current
        .map((item) => (item.slug === next.slug ? next : item))
        .sort((a, b) => a.order - b.order),
    );
  }

  async function persistPath(path: ManagedDaoPath) {
    setBusy(true);
    try {
      await saveDaoPath(path);
      replacePath(path);
      setMessage(`Đã lưu ${path.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được Đạo.");
    } finally {
      setBusy(false);
    }
  }

  async function addPath() {
    const name = window.prompt("Tên Đạo mới:", "Tân Đạo");
    if (!name?.trim()) return;
    const slug = makeModuleId(name);
    if (paths.some((item) => item.slug === slug)) {
      setMessage("Slug này đã tồn tại. Hãy chọn tên khác.");
      return;
    }
    const next: ManagedDaoPath = {
      slug,
      name: name.trim(),
      han: "",
      epithet: "",
      intro: "",
      doctrine: "",
      order: paths.length + 1,
      modules: [],
    };
    setBusy(true);
    try {
      await saveDaoPath(next);
      setPaths((current) => [...current, next]);
      setSelectedSlug(slug);
      setMessage(`Đã thêm ${next.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thêm được Đạo.");
    } finally {
      setBusy(false);
    }
  }

  async function removePath(path: ManagedDaoPath) {
    if (!window.confirm(`Xóa “${path.name}” cùng toàn bộ môn và bài bên trong?`)) return;
    setBusy(true);
    try {
      await deleteDaoPath(path.slug);
      const next = paths.filter((item) => item.slug !== path.slug);
      setPaths(next);
      setSelectedSlug(next[0]?.slug ?? "");
      setMessage(`Đã xóa ${path.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xóa được Đạo.");
    } finally {
      setBusy(false);
    }
  }

  async function addModule() {
    if (!selectedPath) return;
    const title = window.prompt("Tên môn/cảnh mới:", "Tân Cảnh");
    if (!title?.trim()) return;
    const module = emptyModule(title.trim(), selectedPath.modules.length + 1);
    if (selectedPath.modules.some((item) => item.id === module.id)) {
      setMessage("Môn này đã tồn tại.");
      return;
    }
    setBusy(true);
    try {
      await saveDaoModule(selectedPath.slug, module);
      const next = { ...selectedPath, modules: [...selectedPath.modules, module] };
      replacePath(next);
      setSelectedModuleId(module.id);
      setMessage(`Đã thêm ${module.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thêm được môn.");
    } finally {
      setBusy(false);
    }
  }

  async function persistModule(module: ManagedDaoModule) {
    if (!selectedPath) return;
    setBusy(true);
    try {
      await saveDaoModule(selectedPath.slug, module);
      replacePath({
        ...selectedPath,
        modules: selectedPath.modules
          .map((item) => (item.id === module.id ? module : item))
          .sort((a, b) => a.order - b.order),
      });
      setMessage(`Đã lưu ${module.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được môn.");
    } finally {
      setBusy(false);
    }
  }

  async function removeModule(module: ManagedDaoModule) {
    if (!selectedPath) return;
    if (!window.confirm(`Xóa “${module.title}” và toàn bộ bài bên trong?`)) return;
    setBusy(true);
    try {
      await deleteDaoModule(selectedPath.slug, module.id);
      const modules = selectedPath.modules.filter((item) => item.id !== module.id);
      replacePath({ ...selectedPath, modules });
      setSelectedModuleId(modules[0]?.id ?? "");
      setMessage(`Đã xóa ${module.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xóa được môn.");
    } finally {
      setBusy(false);
    }
  }

  async function addLesson() {
    if (!selectedPath || !selectedModule) return;
    const title = window.prompt("Tên bài học mới:", "Bài mới");
    if (!title?.trim()) return;
    const lesson = emptyLesson(title.trim(), selectedModule.lessons.length + 1);
    if (selectedModule.lessons.some((item) => item.id === lesson.id)) {
      setMessage("Bài này đã tồn tại.");
      return;
    }
    setBusy(true);
    try {
      await saveDaoLesson(selectedPath.slug, selectedModule.id, lesson);
      await persistModule({
        ...selectedModule,
        lessons: [...selectedModule.lessons, lesson],
      });
      setMessage(`Đã thêm ${lesson.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thêm được bài.");
    } finally {
      setBusy(false);
    }
  }

  async function persistLesson(lesson: ManagedDaoLesson) {
    if (!selectedPath || !selectedModule) return;
    setBusy(true);
    try {
      await saveDaoLesson(selectedPath.slug, selectedModule.id, lesson);
      const nextModule = {
        ...selectedModule,
        lessons: selectedModule.lessons
          .map((item) => (item.id === lesson.id ? lesson : item))
          .sort((a, b) => a.order - b.order),
      };
      replacePath({
        ...selectedPath,
        modules: selectedPath.modules.map((item) =>
          item.id === nextModule.id ? nextModule : item,
        ),
      });
      setMessage(`Đã lưu ${lesson.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được bài.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLesson(lesson: ManagedDaoLesson) {
    if (!selectedPath || !selectedModule) return;
    if (!window.confirm(`Xóa bài “${lesson.title}”?`)) return;
    setBusy(true);
    try {
      await deleteDaoLesson(selectedPath.slug, selectedModule.id, lesson.id);
      const nextModule = {
        ...selectedModule,
        lessons: selectedModule.lessons.filter((item) => item.id !== lesson.id),
      };
      replacePath({
        ...selectedPath,
        modules: selectedPath.modules.map((item) =>
          item.id === nextModule.id ? nextModule : item,
        ),
      });
      setMessage(`Đã xóa ${lesson.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xóa được bài.");
    } finally {
      setBusy(false);
    }
  }

  if (!firebaseConfigured) {
    return (
      <main className={styles.page}>
        <header className={styles.header}><Link href="/">← Kỳ Phổ Đạo Các</Link><strong>Quản trị nội dung</strong></header>
        <section className={styles.setupCard}>
          <p className={styles.kicker}>FIREBASE CHƯA CẤU HÌNH</p>
          <h1>Kết nối Firebase để mở CRUD</h1>
          <p>Copy <code>.env.local.example</code> thành <code>.env.local</code>, điền cấu hình Firebase Web App rồi khởi động lại frontend.</p>
          <p>Trang công khai vẫn chạy bằng dữ liệu trong <code>daoPaths.ts</code> cho đến khi Firebase sẵn sàng.</p>
        </section>
      </main>
    );
  }

  if (!authReady) return <main className={styles.page}><p>Đang kiểm tra phiên đăng nhập…</p></main>;

  if (!user) {
    return (
      <main className={styles.page}>
        <header className={styles.header}><Link href="/">← Kỳ Phổ Đạo Các</Link><strong>Quản trị nội dung</strong></header>
        <form className={styles.loginCard} onSubmit={login}>
          <p className={styles.kicker}>QUẢN TRỊ VIÊN</p>
          <h1>Đăng nhập Firebase</h1>
          <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Mật khẩu<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
          {message && <p role="alert">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><Link href="/">← Trang chủ</Link><span>/</span><Link href="/realms">Bí Cảnh</Link></div>
        <div><span>{user.email}</span><button onClick={() => firebaseAuth && void signOut(firebaseAuth)}>Đăng xuất</button></div>
      </header>

      <section className={styles.hero}>
        <div><p className={styles.kicker}>KỲ PHỔ ĐẠO CÁC · CMS</p><h1>Quản trị Đạo · Môn · Bài</h1><p>Thêm, sửa, xóa và sắp thứ tự nội dung mà không cần sửa source code.</p></div>
        <div className={styles.heroActions}><button disabled={busy} onClick={() => void refresh()}>Tải lại</button><button disabled={busy} onClick={async () => { if (!window.confirm("Ghi dữ liệu Tứ Tượng mặc định vào Firestore?")) return; setBusy(true); try { await seedDaoPaths(); await refresh(); setMessage("Đã khởi tạo dữ liệu mặc định trên Firestore."); } catch (error) { setMessage(error instanceof Error ? error.message : "Không khởi tạo được."); } finally { setBusy(false); } }}>Khởi tạo dữ liệu mẫu</button></div>
      </section>

      {message && <p className={styles.status} role="status">{message}</p>}

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sectionTitle}><strong>Đạo</strong><button onClick={() => void addPath()} disabled={busy}>+ Thêm</button></div>
          {paths.map((path) => <button key={path.slug} className={selectedSlug === path.slug ? styles.activeItem : styles.item} onClick={() => setSelectedSlug(path.slug)}><span>{path.han || "道"}</span><div><strong>{path.name}</strong><small>{path.slug}</small></div></button>)}
        </aside>

        <section className={styles.editor}>
          {selectedPath ? <>
            <div className={styles.editorHead}><div><p className={styles.kicker}>ĐẠO</p><h2>{selectedPath.name}</h2></div><button className={styles.danger} disabled={busy} onClick={() => void removePath(selectedPath)}>Xóa Đạo</button></div>
            <div className={styles.formGrid}>
              <label>Tên<input value={selectedPath.name} onChange={(event) => replacePath({ ...selectedPath, name: event.target.value })} /></label>
              <label>Hán tự<input value={selectedPath.han} onChange={(event) => replacePath({ ...selectedPath, han: event.target.value })} /></label>
              <label>Biệt hiệu<input value={selectedPath.epithet} onChange={(event) => replacePath({ ...selectedPath, epithet: event.target.value })} /></label>
              <label>Thứ tự<input type="number" min={1} value={selectedPath.order} onChange={(event) => replacePath({ ...selectedPath, order: Number(event.target.value) })} /></label>
              <label className={styles.wide}>Giới thiệu<textarea rows={3} value={selectedPath.intro} onChange={(event) => replacePath({ ...selectedPath, intro: event.target.value })} /></label>
              <label className={styles.wide}>Đạo quyết<textarea rows={2} value={selectedPath.doctrine} onChange={(event) => replacePath({ ...selectedPath, doctrine: event.target.value })} /></label>
            </div>
            <button disabled={busy || !selectedPath.name.trim()} onClick={() => void persistPath(selectedPath)}>Lưu Đạo</button>

            <div className={styles.subsection}>
              <div className={styles.sectionTitle}><div><strong>Môn / Cảnh</strong><small>{selectedPath.modules.length} mục</small></div><button disabled={busy} onClick={() => void addModule()}>+ Thêm môn</button></div>
              <div className={styles.moduleTabs}>{selectedPath.modules.map((module) => <button key={module.id} className={selectedModuleId === module.id ? styles.activeTab : ""} onClick={() => setSelectedModuleId(module.id)}>{module.order}. {module.title}</button>)}</div>
            </div>

            {selectedModule && <div className={styles.moduleEditor}>
              <div className={styles.editorHead}><div><p className={styles.kicker}>MÔN</p><h3>{selectedModule.title}</h3></div><button className={styles.danger} disabled={busy} onClick={() => void removeModule(selectedModule)}>Xóa môn</button></div>
              <div className={styles.formGrid}>
                <label>Tên<input value={selectedModule.title} onChange={(event) => persistModuleLocal({ ...selectedModule, title: event.target.value }, selectedPath, replacePath)} /></label>
                <label>Phụ đề<input value={selectedModule.subtitle} onChange={(event) => persistModuleLocal({ ...selectedModule, subtitle: event.target.value }, selectedPath, replacePath)} /></label>
                <label>Chủ đề puzzle<input value={selectedModule.puzzleTheme} onChange={(event) => persistModuleLocal({ ...selectedModule, puzzleTheme: event.target.value }, selectedPath, replacePath)} /></label>
                <label>Thứ tự<input type="number" min={1} value={selectedModule.order} onChange={(event) => persistModuleLocal({ ...selectedModule, order: Number(event.target.value) }, selectedPath, replacePath)} /></label>
                <label className={styles.wide}>Themes, phân cách dấu phẩy<input value={selectedModule.themes.join(", ")} onChange={(event) => persistModuleLocal({ ...selectedModule, themes: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }, selectedPath, replacePath)} /></label>
                <label className={styles.wide}>Mô tả<textarea rows={3} value={selectedModule.description} onChange={(event) => persistModuleLocal({ ...selectedModule, description: event.target.value }, selectedPath, replacePath)} /></label>
              </div>
              <button disabled={busy || !selectedModule.title.trim()} onClick={() => void persistModule(selectedModule)}>Lưu môn</button>

              <div className={styles.lessons}>
                <div className={styles.sectionTitle}><div><strong>Bài học</strong><small>{selectedModule.lessons.length} bài</small></div><button disabled={busy} onClick={() => void addLesson()}>+ Thêm bài</button></div>
                {selectedModule.lessons.length === 0 && <p className={styles.empty}>Chưa có bài học. Bạn có thể tạo bài đầu tiên ở đây.</p>}
                {selectedModule.lessons.map((lesson) => <article key={lesson.id} className={styles.lessonCard}>
                  <div className={styles.lessonHead}><strong>{lesson.order}. {lesson.title}</strong><button className={styles.dangerText} disabled={busy} onClick={() => void removeLesson(lesson)}>Xóa</button></div>
                  <div className={styles.formGrid}>
                    <label>Tên bài<input value={lesson.title} onChange={(event) => updateLessonLocal({ ...lesson, title: event.target.value }, selectedPath, selectedModule, replacePath)} /></label>
                    <label>Phụ đề<input value={lesson.subtitle} onChange={(event) => updateLessonLocal({ ...lesson, subtitle: event.target.value }, selectedPath, selectedModule, replacePath)} /></label>
                    <label>Thứ tự<input type="number" min={1} value={lesson.order} onChange={(event) => updateLessonLocal({ ...lesson, order: Number(event.target.value) }, selectedPath, selectedModule, replacePath)} /></label>
                    <label>FEN (tùy chọn)<input value={lesson.fen ?? ""} onChange={(event) => updateLessonLocal({ ...lesson, fen: event.target.value }, selectedPath, selectedModule, replacePath)} /></label>
                    <label className={styles.wide}>Mô tả<textarea rows={3} value={lesson.description} onChange={(event) => updateLessonLocal({ ...lesson, description: event.target.value }, selectedPath, selectedModule, replacePath)} /></label>
                    <label className={styles.wide}>PGN (tùy chọn)<textarea rows={3} value={lesson.pgn ?? ""} onChange={(event) => updateLessonLocal({ ...lesson, pgn: event.target.value }, selectedPath, selectedModule, replacePath)} /></label>
                  </div>
                  <button disabled={busy || !lesson.title.trim()} onClick={() => void persistLesson(lesson)}>Lưu bài</button>
                </article>)}
              </div>
            </div>}
          </> : <p>Chưa có Đạo nào.</p>}
        </section>
      </div>
    </main>
  );
}

function persistModuleLocal(
  module: ManagedDaoModule,
  path: ManagedDaoPath,
  replacePath: (path: ManagedDaoPath) => void,
) {
  replacePath({
    ...path,
    modules: path.modules.map((item) => (item.id === module.id ? module : item)),
  });
}

function updateLessonLocal(
  lesson: ManagedDaoLesson,
  path: ManagedDaoPath,
  module: ManagedDaoModule,
  replacePath: (path: ManagedDaoPath) => void,
) {
  const nextModule = {
    ...module,
    lessons: module.lessons.map((item) => (item.id === lesson.id ? lesson : item)),
  };
  replacePath({
    ...path,
    modules: path.modules.map((item) => (item.id === module.id ? nextModule : item)),
  });
}
