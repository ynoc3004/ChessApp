"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatTime, type AdminCollectionItem } from "@/lib/adminApi";
import styles from "../admin.module.css";

export default function AdminCollectionPage() {
  const { request } = useAdmin();
  const [items, setItems] = useState<AdminCollectionItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<{ items: AdminCollectionItem[] }>("/api/admin/collection");
      setItems(data.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được Tàng Kinh Các.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.title || ""} ${item.themes || ""} ${item.note || ""} ${item.fen || ""}`.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  async function remove(item: AdminCollectionItem) {
    if (!window.confirm(`Xóa “${item.title || item.id}” khỏi Tàng Kinh Các?`)) return;
    setDeleting(item.id);
    try {
      await request(`/api/admin/collection/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setItems((current) => current.filter((value) => value.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được thế cờ.");
    } finally {
      setDeleting("");
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>NỘI CÁC · TÀNG KINH CÁC</p><h1>Kho thế cờ đã lưu</h1><p>Rà soát metadata, nguồn và các thế cờ người dùng đã chọn để lưu lâu dài.</p></div>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
      </section>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>{filtered.length} / {items.length} thế cờ</h2><span>collection.sqlite3</span></div>
        <div className={styles.toolbar}><label>Tìm trong kho<input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, chủ đề, ghi chú hoặc FEN" /></label></div>
      </section>
      <section className={styles.tableWrap} aria-busy={loading}>
        <table className={styles.table}>
          <thead><tr><th>Thế cờ</th><th>Nguồn</th><th>Chủ đề</th><th>Cập nhật</th><th>Thao tác</th></tr></thead>
          <tbody>
            {filtered.map((item) => <tr key={item.id}>
              <td><strong>{item.title || "Chưa đặt tên"}</strong><div className={styles.muted}>{item.fen || "Không có FEN"}</div></td>
              <td><span className={styles.badge}>{item.source || "unknown"}</span>{item.sourcePath && <div className={styles.muted}>{item.sourcePath.slice(0, 80)}</div>}</td>
              <td>{item.themes || <span className={styles.muted}>Chưa gắn nhãn</span>}</td>
              <td>{formatTime(item.updatedAt)}</td>
              <td><div className={styles.actions}>{item.sourcePath?.startsWith("/") && <Link className={styles.button} href={item.sourcePath}>Mở nguồn</Link>}{item.sourcePath?.startsWith("https://") && <a className={styles.button} href={item.sourcePath} target="_blank" rel="noreferrer">Mở nguồn</a>}<button className={styles.danger} disabled={deleting === item.id} onClick={() => void remove(item)}>{deleting === item.id ? "Đang xóa…" : "Xóa"}</button></div></td>
            </tr>)}
            {!loading && filtered.length === 0 && <tr><td colSpan={5}><div className={styles.empty}>Không tìm thấy thế cờ phù hợp.</div></td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
