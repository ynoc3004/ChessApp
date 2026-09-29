"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatTime, type AdminCorrection } from "@/lib/adminApi";
import styles from "../admin.module.css";

export default function AdminCorrectionsPage() {
  const { request, requestRaw } = useAdmin();
  const [items, setItems] = useState<AdminCorrection[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<{ corrections: AdminCorrection[]; total: number }>("/api/admin/corrections?limit=200");
      setItems(data.corrections);
      setTotal(data.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được correction dataset.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  async function showImage(item: AdminCorrection) {
    try {
      const response = await requestRaw(`/api/admin/corrections/${encodeURIComponent(item.sampleId)}/image`);
      const url = URL.createObjectURL(await response.blob());
      setPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return { id: item.sampleId, url };
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không mở được ảnh correction.");
    }
  }

  async function remove(item: AdminCorrection) {
    if (!window.confirm(`Xóa mẫu học ${item.sampleId}? Ảnh và metadata của mẫu này sẽ bị xóa.`)) return;
    setDeleting(item.sampleId);
    setError("");
    try {
      await request(`/api/admin/corrections/${encodeURIComponent(item.sampleId)}`, { method: "DELETE" });
      if (preview?.id === item.sampleId) setPreview(null);
      setItems((current) => current.filter((value) => value.sampleId !== item.sampleId));
      setTotal((value) => Math.max(0, value - 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được correction.");
    } finally {
      setDeleting("");
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>NỘI CÁC · AI DATASET</p><h1>Bản sửa nhận dạng</h1><p>Kiểm tra các thế cờ AI đã đọc sai và dữ liệu người dùng sửa đúng trước khi dùng cho retraining.</p></div>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Tổng correction</span><strong>{total.toLocaleString("vi-VN")}</strong><small>Board đã được sửa và lưu</small></article>
        <article className={styles.metric}><span>Ô huấn luyện tiềm năng</span><strong>{(total * 64).toLocaleString("vi-VN")}</strong><small>64 ô cho mỗi board</small></article>
        <article className={styles.metric}><span>Có ảnh nguồn</span><strong>{items.filter((item) => item.hasImage).length.toLocaleString("vi-VN")}</strong><small>Trong {items.length} mẫu đang hiển thị</small></article>
        <article className={styles.metric}><span>AI ≠ bản sửa</span><strong>{items.filter((item) => item.aiFen && item.correctedFen && item.aiFen !== item.correctedFen).length.toLocaleString("vi-VN")}</strong><small>Mẫu thực sự có thay đổi FEN</small></article>
      </section>

      {preview && <section className={styles.panel}><div className={styles.panelHead}><h2>Ảnh nguồn · {preview.id}</h2><button className={styles.button} onClick={() => setPreview(null)}>Đóng ảnh</button></div><img className={styles.imagePreview} src={preview.url} alt={`Correction ${preview.id}`} /></section>}

      <section className={styles.cards} aria-busy={loading}>
        {items.map((item) => {
          const changed = Boolean(item.aiFen && item.correctedFen && item.aiFen !== item.correctedFen);
          return (
            <article className={styles.correction} key={item.sampleId}>
              <div className={styles.correctionHead}><div><h3>{item.sampleId}</h3><span className={styles.muted}>{formatTime(item.savedAt)}</span></div><span className={changed ? `${styles.badge} ${styles.badgeWorking}` : styles.badge}>{changed ? "Đã sửa FEN" : "Đã xác nhận"}</span></div>
              <div className={styles.fenBlock}><label>AI đọc</label><code>{item.aiFen || "Không lưu AI FEN"}</code></div>
              <div className={styles.fenBlock}><label>Bản đúng</label><code className={changed ? styles.changed : ""}>{item.correctedFen || "Không có FEN"}</code></div>
              <p className={styles.muted}>{item.recognizer || "recognizer không rõ"}{item.preprocessVariant ? ` · ${item.preprocessVariant}` : ""}{item.imageOrientation ? ` · ${item.imageOrientation}` : ""}</p>
              <div className={styles.actions}>{item.hasImage && <button className={styles.button} onClick={() => void showImage(item)}>Xem ảnh</button>}<button className={styles.danger} disabled={deleting === item.sampleId} onClick={() => void remove(item)}>{deleting === item.sampleId ? "Đang xóa…" : "Xóa mẫu"}</button></div>
            </article>
          );
        })}
      </section>
      {!loading && items.length === 0 && <div className={styles.empty}>Chưa có bản sửa AI nào. Khi bạn sửa FEN ở màn phân tích, dữ liệu sẽ xuất hiện tại đây.</div>}
    </div>
  );
}
