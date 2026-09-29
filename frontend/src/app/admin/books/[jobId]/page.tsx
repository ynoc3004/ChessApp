"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { resolveImageUrl } from "@/lib/api";
import { formatBytes, formatTime, type AdminBookDetail, type AdminBookPosition } from "@/lib/adminApi";
import styles from "./book-detail.module.css";

function stateLabel(position: AdminBookPosition) {
  if (position.state === "corrected") return "Đã sửa tay";
  if (position.state === "recognized") return "AI đã đọc";
  return "Chưa nhận dạng";
}

function stateClass(position: AdminBookPosition) {
  if (position.state === "corrected") return `${styles.state} ${styles.corrected}`;
  if (position.state === "pending") return `${styles.state} ${styles.pending}`;
  return styles.state;
}

export default function AdminBookDetailPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const jobId = params.jobId;
  const { request, requestRaw } = useAdmin();
  const [book, setBook] = useState<AdminBookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<AdminBookDetail>(`/api/admin/books/${jobId}`);
      setBook(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được kỳ phổ.");
    } finally {
      setLoading(false);
    }
  }, [jobId, request]);

  useEffect(() => { void load(); }, [load]);

  const positions = useMemo(() => {
    if (!book) return [];
    const needle = query.trim().toLocaleLowerCase();
    return book.positions.filter((position) => {
      const haystack = `${position.id} ${position.page ?? ""} ${position.aiFen ?? ""} ${position.savedFen ?? ""}`.toLocaleLowerCase();
      const matchesQuery = !needle || haystack.includes(needle);
      const matchesFilter = filter === "all" || position.state === filter;
      return matchesQuery && matchesFilter;
    });
  }, [book, filter, query]);

  async function runAction(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Thao tác thất bại.");
    } finally {
      setBusy("");
    }
  }

  async function download(path: string, filename: string) {
    await runAction(`download:${path}`, async () => {
      const response = await requestRaw(path);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    });
  }

  async function rescan() {
    if (!book) return;
    const confirmed = window.confirm(
      `Quét lại “${book.filename}”? Diagram hiện tại, cache AI và bản sửa FEN trong kỳ phổ này sẽ được tạo lại từ đầu. Dữ liệu correction đã sao lưu riêng vẫn được giữ.`,
    );
    if (!confirmed) return;
    await runAction("rescan", async () => {
      await request(`/api/admin/books/${jobId}/rescan`, { method: "POST" });
      setNotice("Đã đưa kỳ phổ vào hàng đợi quét lại.");
      await load();
    });
  }

  async function clearAllCache() {
    if (!book || !window.confirm(`Xóa toàn bộ cache nhận dạng AI của “${book.filename}”? Các FEN đã sửa tay vẫn được giữ.`)) return;
    await runAction("clear-all", async () => {
      const result = await request<{ removed: { recognition: number; variants: number } }>(`/api/admin/books/${jobId}/recognition-cache`, { method: "DELETE" });
      setNotice(`Đã xóa ${result.removed.recognition} cache nhận dạng và ${result.removed.variants} ảnh tiền xử lý.`);
      await load();
    });
  }

  async function removeBook() {
    if (!book || !window.confirm(`Xóa TOÀN BỘ kỳ phổ “${book.filename}” và file nguồn? Thao tác này không thể hoàn tác.`)) return;
    await runAction("delete-book", async () => {
      await request(`/api/admin/books/${jobId}`, { method: "DELETE" });
      router.push("/admin/books");
      router.refresh();
    });
  }

  async function recognize(position: AdminBookPosition) {
    await runAction(`recognize:${position.id}`, async () => {
      await request(`/api/admin/books/${jobId}/positions/${position.id}/recognize?force=true`, { method: "POST" });
      setNotice(`Đã nhận dạng lại diagram #${position.id}.`);
      await load();
    });
  }

  async function clearPosition(position: AdminBookPosition) {
    if (!window.confirm(`Xóa cache AI của diagram #${position.id}? FEN sửa tay vẫn được giữ.`)) return;
    await runAction(`clear:${position.id}`, async () => {
      await request(`/api/admin/books/${jobId}/positions/${position.id}/recognition`, { method: "DELETE" });
      setNotice(`Đã xóa cache AI của diagram #${position.id}.`);
      await load();
    });
  }

  async function removePosition(position: AdminBookPosition) {
    if (!window.confirm(`Xóa diagram #${position.id} khỏi kỳ phổ? Ảnh, cache và FEN đã lưu của diagram này sẽ bị xóa.`)) return;
    await runAction(`delete:${position.id}`, async () => {
      await request(`/api/admin/books/${jobId}/positions/${position.id}`, { method: "DELETE" });
      setNotice(`Đã xóa diagram #${position.id}.`);
      await load();
    });
  }

  if (loading && !book) return <div className={styles.empty}>Đang tải chi tiết kỳ phổ…</div>;
  if (!book) return <div className={styles.page}><Link className={styles.back} href="/admin/books">← Quay lại Kỳ phổ</Link>{error && <div className={styles.error}>{error}</div>}</div>;

  const working = book.status === "queued" || book.status === "processing";

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/admin/books">← Quay lại Kỳ phổ</Link>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · CHI TIẾT KỲ PHỔ</p>
          <h1>{book.filename}</h1>
          <p className={styles.meta}>Job {book.jobId} · {book.source.extension?.replace(".", "").toUpperCase() || "không rõ định dạng"} · cập nhật {formatTime(book.updatedAt)}</p>
        </div>
        {working && <div><div className={styles.progress}><span style={{ width: `${Math.max(2, Math.min(100, book.progress))}%` }} /></div><p className={styles.meta}>{book.status} · {book.progress.toFixed(1)}%</p></div>}
      </section>

      {book.error && <div className={styles.error}>Job lỗi: {book.error}</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.metrics}>
        <div className={styles.metric}><span>Diagram</span><strong>{book.count.toLocaleString("vi-VN")}</strong><small>{book.stats.missingImages ? `${book.stats.missingImages} ảnh bị thiếu` : "Ảnh nguồn đầy đủ"}</small></div>
        <div className={styles.metric}><span>AI đã đọc</span><strong>{book.stats.recognized.toLocaleString("vi-VN")}</strong><small>có recognition cache</small></div>
        <div className={styles.metric}><span>Đã sửa tay</span><strong>{book.stats.corrected.toLocaleString("vi-VN")}</strong><small>FEN do người dùng xác nhận</small></div>
        <div className={styles.metric}><span>Chưa xử lý</span><strong>{book.stats.pending.toLocaleString("vi-VN")}</strong><small>chưa AI đọc / chưa sửa</small></div>
        <div className={styles.metric}><span>Dung lượng</span><strong>{formatBytes(book.dataBytes + book.source.bytes)}</strong><small>nguồn {formatBytes(book.source.bytes)}</small></div>
      </section>

      <section className={styles.toolbar}>
        <button className={styles.button} disabled={Boolean(busy) || working || !book.source.available} onClick={() => void rescan()}>{book.status === "failed" ? "↻ Retry quét" : "↻ Quét lại"}</button>
        <button className={styles.button} disabled={Boolean(busy) || working} onClick={() => void clearAllCache()}>✦ Xóa cache AI</button>
        <button className={styles.button} disabled={Boolean(busy) || !book.count} onClick={() => void download(`/api/admin/books/${jobId}/recognized.json`, `${jobId}-recognized-positions.json`)}>↓ Xuất FEN/JSON</button>
        <button className={styles.button} disabled={Boolean(busy) || !book.count} onClick={() => void download(`/api/admin/books/${jobId}/download`, `${jobId}-chess-diagrams.zip`)}>↓ Tải ZIP</button>
        <button className={styles.danger} disabled={Boolean(busy) || working} onClick={() => void removeBook()}>Xóa toàn bộ kỳ phổ</button>
      </section>

      {!book.source.available && <div className={styles.notice}>File nguồn không còn trong thư mục uploads. Bạn vẫn có thể quản lý diagram hiện tại nhưng không thể quét lại sách này.</div>}

      <section className={styles.filters}>
        <label>Tìm diagram<input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, trang hoặc FEN" /></label>
        <label>Trạng thái<select className={styles.select} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tất cả ({book.count})</option><option value="pending">Chưa nhận dạng ({book.stats.pending})</option><option value="recognized">AI đã đọc</option><option value="corrected">Đã sửa tay ({book.stats.corrected})</option></select></label>
      </section>

      {positions.length ? (
        <section className={styles.gallery}>
          {positions.map((position) => {
            const analysisHref = `/analysis?image=${encodeURIComponent(position.imageUrl)}&job=${encodeURIComponent(jobId)}&position=${position.id}`;
            const confidence = typeof position.averageConfidence === "number" ? `${Math.round(position.averageConfidence * 100)}%` : "—";
            const actionBusy = busy.endsWith(`:${position.id}`);
            return (
              <article className={styles.card} key={position.id}>
                <div className={styles.imageWrap}>
                  {position.hasImage ? <img className={styles.image} src={resolveImageUrl(position.imageUrl)} alt={`Diagram #${position.id}`} /> : <div className={styles.imageMissing}>Ảnh diagram bị thiếu</div>}
                  <span className={stateClass(position)}>{stateLabel(position)}</span>
                </div>
                <div className={styles.body}>
                  <div className={styles.titleRow}><strong>Diagram #{position.id}</strong><span>Trang {position.page ?? "—"}</span></div>
                  <div className={styles.info}>
                    <div><small>Detector</small><span>{typeof position.confidence === "number" ? `${Math.round(position.confidence * 100)}%` : "—"}</span></div>
                    <div><small>AI confidence</small><span>{confidence}</span></div>
                    <div><small>Ảnh</small><span>{formatBytes(position.imageBytes)}</span></div>
                    <div><small>Uncertain</small><span>{position.uncertainSquares?.length || 0} ô</span></div>
                  </div>
                  {(position.savedFen || position.aiFen) && <code className={styles.fen}>{position.savedFen || position.aiFen}</code>}
                  <div className={styles.cardActions}>
                    <Link href={analysisHref}>Mở bàn cờ</Link>
                    <button disabled={Boolean(busy) || working || !position.hasImage} onClick={() => void recognize(position)}>{actionBusy && busy.startsWith("recognize:") ? "Đang đọc…" : position.recognized ? "Nhận dạng lại" : "Nhận dạng AI"}</button>
                    {position.recognized && <button disabled={Boolean(busy) || working} onClick={() => void clearPosition(position)}>Xóa cache</button>}
                    <button className={styles.delete} disabled={Boolean(busy) || working} onClick={() => void removePosition(position)}>Xóa</button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : <div className={styles.empty}>{book.count ? "Không có diagram phù hợp bộ lọc." : "Kỳ phổ này chưa có diagram."}</div>}
    </div>
  );
}
