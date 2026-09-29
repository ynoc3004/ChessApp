"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { API_BASE } from "@/lib/api";
import { formatBytes, formatTime, type AdminBook } from "@/lib/adminApi";
import styles from "../admin.module.css";

function statusClass(status: string) {
  if (status === "failed") return `${styles.badge} ${styles.badgeFailed}`;
  if (status === "queued" || status === "processing") return `${styles.badge} ${styles.badgeWorking}`;
  return styles.badge;
}

export default function AdminBooksPage() {
  const { request } = useAdmin();
  const [books, setBooks] = useState<AdminBook[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<{ books: AdminBook[] }>("/api/admin/books");
      setBooks(data.books);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được kỳ phổ.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return books.filter((book) => {
      const matchesQuery = !needle || `${book.filename} ${book.jobId}`.toLocaleLowerCase().includes(needle);
      const matchesStatus = status === "all" || book.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [books, query, status]);

  async function remove(book: AdminBook) {
    if (!window.confirm(`Xóa toàn bộ dữ liệu của “${book.filename}”? Thao tác này không thể hoàn tác.`)) return;
    setDeleting(book.jobId);
    setError("");
    try {
      await request(`/api/admin/books/${book.jobId}`, { method: "DELETE" });
      setBooks((items) => items.filter((item) => item.jobId !== book.jobId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được kỳ phổ.");
    } finally {
      setDeleting("");
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>NỘI CÁC · KỲ PHỔ</p><h1>Quản lý sách đã quét</h1><p>Kiểm tra job quét, dung lượng, lỗi và dọn dữ liệu sách không còn cần thiết.</p></div>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>{filtered.length} / {books.length} kỳ phổ</h2><span>{loading ? "Đang tải…" : "Dữ liệu local"}</span></div>
        <div className={styles.toolbar}>
          <label>Tìm kiếm<input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên file hoặc Job ID" /></label>
          <label>Trạng thái<select className={styles.select} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả</option><option value="completed">Hoàn tất</option><option value="processing">Đang xử lý</option><option value="queued">Đang chờ</option><option value="failed">Lỗi</option><option value="unknown">Không rõ</option></select></label>
        </div>
      </section>

      <section className={styles.tableWrap} aria-busy={loading}>
        <table className={styles.table}>
          <thead><tr><th>Kỳ phổ</th><th>Trạng thái</th><th>Diagram</th><th>Dung lượng</th><th>Cập nhật</th><th>Thao tác</th></tr></thead>
          <tbody>
            {filtered.map((book) => (
              <tr key={book.jobId}>
                <td><strong>{book.filename}</strong><div className={styles.muted}>{book.jobId.slice(0, 12)}…</div>{book.error && <div className={styles.muted}>{book.error}</div>}</td>
                <td><span className={statusClass(book.status)}>{book.status}</span>{["queued", "processing"].includes(book.status) && <div className={styles.progress}><span style={{ width: `${Math.max(2, Math.min(100, book.progress))}%` }} /></div>}</td>
                <td>{book.count.toLocaleString("vi-VN")}</td>
                <td>{formatBytes(book.sourceBytes + book.dataBytes)}<div className={styles.muted}>nguồn {formatBytes(book.sourceBytes)}</div></td>
                <td>{formatTime(book.updatedAt)}</td>
                <td><div className={styles.actions}><a className={styles.button} href={`${API_BASE}/api/books/${book.jobId}/download`}>ZIP</a><a className={styles.button} href={`${API_BASE}/api/books/${book.jobId}/recognized.json`}>FEN</a><button className={styles.danger} disabled={deleting === book.jobId} onClick={() => void remove(book)}>{deleting === book.jobId ? "Đang xóa…" : "Xóa"}</button></div></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={6}><div className={styles.empty}>Không có kỳ phổ phù hợp.</div></td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
