"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { resolveImageUrl } from "@/lib/api";
import styles from "../admin.module.css";
import review from "./review.module.css";

type ReviewItem = {
  jobId: string;
  filename?: string | null;
  id: number;
  page?: number | null;
  imageUrl: string;
  recognized: boolean;
  corrected: boolean;
  aiFen?: string | null;
  savedFen?: string | null;
  averageConfidence?: number | null;
  uncertainSquares: string[];
  riskScore: number;
  riskReasons: string[];
  validPlacement?: boolean | null;
  pieceColorMismatchCount: number;
  specialistCorrectedCount: number;
  specialistUncertainCount: number;
};

type BatchState = {
  running: boolean;
  startedAt?: number | null;
  finishedAt?: number | null;
  currentJobId?: string | null;
  currentPositionId?: number | null;
  processed: number;
  recognized: number;
  failed: number;
  skipped: number;
  total: number;
  error?: string | null;
};

type ReviewResponse = {
  items: ReviewItem[];
  total: number;
  filtered: number;
  stats: {
    recognized: number;
    corrected: number;
    pending: number;
    highRisk: number;
    boardsWithCorrections: number;
    correctedSquares: number;
    occupancyErrors: number;
    colorErrors: number;
    typeErrors: number;
    topConfusions: { pair: string; count: number }[];
  };
  model: {
    exists?: boolean;
    ready?: boolean;
    stale?: boolean;
    validationAccuracy?: number | null;
    usableBoards?: number;
    usablePieceClasses?: number;
  };
  batch: BatchState;
};

function confidenceLabel(value?: number | null) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function riskLabel(score: number) {
  if (score >= 70) return `Rủi ro rất cao · ${Math.round(score)}`;
  if (score >= 45) return `Rủi ro cao · ${Math.round(score)}`;
  if (score >= 18) return `Cần duyệt · ${Math.round(score)}`;
  return `Rủi ro thấp · ${Math.round(score)}`;
}

export default function RecognitionReviewPage() {
  const { request, can } = useAdmin();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [state, setState] = useState("needs-review");
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({ state, limit: "200" });
    if (jobId.trim()) params.set("job_id", jobId.trim());
    return params.toString();
  }, [jobId, state]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await request<ReviewResponse>(`/api/admin/review/queue?${query}`);
      setData(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được hàng đợi review.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, request]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!data?.batch.running) return;
    const timer = window.setInterval(() => { void load(true); }, 1800);
    return () => window.clearInterval(timer);
  }, [data?.batch.running, load]);

  async function startBatch(force: boolean) {
    if (!can("dataset.write")) return;
    setBusy("batch");
    setError("");
    setNotice("");
    try {
      const payload = await request<BatchState>("/api/admin/review/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobId.trim() || null, force, limit: 300 }),
      });
      setNotice(payload.total ? `Đã bắt đầu nhận dạng ${payload.total} diagram.` : "Không còn diagram phù hợp để nhận dạng.");
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không khởi động được batch recognition.");
    } finally {
      setBusy("");
    }
  }

  async function confirm(item: ReviewItem) {
    if (!item.recognized || item.corrected || !can("dataset.write")) return;
    setBusy(`confirm:${item.jobId}:${item.id}`);
    setError("");
    setNotice("");
    try {
      await request(`/api/admin/review/${item.jobId}/${item.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sideToMove: "w" }),
      });
      setNotice(`Đã xác nhận diagram #${item.id} là đúng và đưa vào dataset học.`);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xác nhận được diagram.");
    } finally {
      setBusy("");
    }
  }

  const batch = data?.batch;
  const progress = batch?.total ? Math.round((batch.processed / batch.total) * 100) : 0;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · RECOGNITION REVIEW V2</p>
          <h1>Hàng đợi duyệt nhận dạng</h1>
          <p>Đưa những thế AI đáng nghi lên trước, nhận dạng hàng loạt và biến mỗi lần xác nhận thành dữ liệu học cho model chuyên biệt.</p>
        </div>
        <div className={review.toolbar}>
          <label>
            Trạng thái
            <select value={state} onChange={(event) => setState(event.target.value)}>
              <option value="needs-review">Cần duyệt trước</option>
              <option value="pending">Chưa nhận dạng</option>
              <option value="recognized">AI đã đọc, chưa xác nhận</option>
              <option value="corrected">Đã xác nhận/sửa</option>
              <option value="all">Tất cả</option>
            </select>
          </label>
          <label>
            Job ID (tùy chọn)
            <input value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="Để trống = mọi sách" />
          </label>
          <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
        </div>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Cần ưu tiên</span><strong>{data?.stats.highRisk ?? 0}</strong><small>Risk score ≥ 45</small></article>
        <article className={styles.metric}><span>Chưa nhận dạng</span><strong>{data?.stats.pending ?? 0}</strong><small>Có thể chạy batch</small></article>
        <article className={styles.metric}><span>AI đã đọc</span><strong>{data?.stats.recognized ?? 0}</strong><small>Recognition cache hiện có</small></article>
        <article className={styles.metric}><span>Đã xác nhận</span><strong>{data?.stats.corrected ?? 0}</strong><small>Đã thành sample học</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div><h2>Batch Recognition</h2><span>Nhận dạng nền, không cần mở từng diagram.</span></div>
          <div className={review.toolbar}>
            <button className={styles.button} disabled={!can("dataset.write") || Boolean(busy) || Boolean(batch?.running)} onClick={() => void startBatch(false)}>✦ Nhận dạng phần chưa đọc</button>
            <button className={styles.refresh} disabled={!can("dataset.write") || Boolean(busy) || Boolean(batch?.running)} onClick={() => void startBatch(true)}>↻ Nhận dạng lại tối đa 300</button>
          </div>
        </div>
        {batch?.running ? (
          <div>
            <div className={review.progress}><span style={{ width: `${Math.max(2, progress)}%` }} /></div>
            <p className={styles.muted}>{batch.processed}/{batch.total} · thành công {batch.recognized} · lỗi {batch.failed} · đang xử lý {batch.currentJobId ? `${batch.currentJobId.slice(0, 8)}… #${batch.currentPositionId}` : "…"}</p>
          </div>
        ) : (
          <p className={styles.muted}>Batch gần nhất: {batch?.processed ?? 0} xử lý · {batch?.recognized ?? 0} thành công · {batch?.failed ?? 0} lỗi.</p>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Vòng học của model</h2><span>{data?.model.ready ? "Model sẵn sàng" : "Chưa đủ dữ liệu"}</span></div>
        <div className={styles.grid}>
          <article className={styles.metric}><span>Board học được</span><strong>{data?.model.usableBoards ?? 0}</strong><small>Correction có ảnh + orientation</small></article>
          <article className={styles.metric}><span>Lớp quân đủ mẫu</span><strong>{data?.model.usablePieceClasses ?? 0}/12</strong><small>Không tính ô trống</small></article>
          <article className={styles.metric}><span>Validation</span><strong>{typeof data?.model.validationAccuracy === "number" ? `${Math.round(data.model.validationAccuracy * 100)}%` : "—"}</strong><small>Held-out boards</small></article>
          <article className={styles.metric}><span>Trạng thái</span><strong>{data?.model.stale ? "Cần train lại" : data?.model.ready ? "Đang dùng" : "Chưa train"}</strong><small><Link href="/admin/model">Mở Model AI →</Link></small></article>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>AI thường sai ở đâu?</h2><span>{data?.stats.correctedSquares ?? 0} ô đã sửa</span></div>
        <section className={styles.grid}>
          <article className={styles.metric}><span>Occupancy</span><strong>{data?.stats.occupancyErrors ?? 0}</strong><small>Thừa/thiếu quân</small></article>
          <article className={styles.metric}><span>Màu quân</span><strong>{data?.stats.colorErrors ?? 0}</strong><small>Trắng ↔ đen</small></article>
          <article className={styles.metric}><span>Loại quân</span><strong>{data?.stats.typeErrors ?? 0}</strong><small>Xe ↔ Hậu, Tượng ↔ Tốt…</small></article>
          <article className={styles.metric}><span>Board có sửa</span><strong>{data?.stats.boardsWithCorrections ?? 0}</strong><small>Board AI khác FEN đúng</small></article>
        </section>
        <div className={review.confusions}>
          {(data?.stats.topConfusions ?? []).map((item) => <span key={item.pair}>{item.pair} · {item.count}</span>)}
          {!data?.stats.topConfusions.length && <span>Chưa đủ correction khác biệt để thống kê.</span>}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Queue</h2><span>{data?.filtered ?? 0} / {data?.total ?? 0} diagram</span></div>
        <div className={review.queue} aria-busy={loading}>
          {(data?.items ?? []).map((item) => {
            const href = `/analysis?image=${encodeURIComponent(item.imageUrl)}&job=${encodeURIComponent(item.jobId)}&position=${item.id}`;
            const confirmBusy = busy === `confirm:${item.jobId}:${item.id}`;
            return (
              <article className={review.card} key={`${item.jobId}-${item.id}`}>
                <div className={review.imageWrap}>
                  <img className={review.image} src={resolveImageUrl(item.imageUrl)} alt={`Diagram ${item.id}`} />
                  <span className={review.risk}>{riskLabel(item.riskScore)}</span>
                </div>
                <div className={review.cardBody}>
                  <div className={review.cardHead}>
                    <div><h3>{item.filename || "Kỳ phổ"} · #{item.id}</h3><p>Trang {item.page ?? "—"} · Job {item.jobId.slice(0, 10)}…</p></div>
                    <strong>{item.corrected ? "✓ Đã xác nhận" : item.recognized ? "AI đã đọc" : "Chưa đọc"}</strong>
                  </div>
                  <div className={review.reasons}>{item.riskReasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
                  {(item.savedFen || item.aiFen) && <code className={review.fen}>{item.savedFen || item.aiFen}</code>}
                  <div className={review.meta}>
                    <div><small>Confidence</small><strong>{confidenceLabel(item.averageConfidence)}</strong></div>
                    <div><small>Uncertain</small><strong>{item.uncertainSquares?.length ?? 0} ô</strong></div>
                    <div><small>Color mismatch</small><strong>{item.pieceColorMismatchCount}</strong></div>
                    <div><small>Specialist</small><strong>{item.specialistCorrectedCount} sửa / {item.specialistUncertainCount} nghi</strong></div>
                  </div>
                  <div className={review.actions}>
                    <Link href={href}>{item.recognized ? "Mở & kiểm tra" : "Mở bàn cờ"}</Link>
                    {item.recognized && !item.corrected && (
                      <button disabled={!can("dataset.write") || Boolean(busy) || item.validPlacement === false} onClick={() => void confirm(item)}>{confirmBusy ? "Đang lưu…" : "✓ AI đúng — xác nhận"}</button>
                    )}
                    <Link href={`/admin/books/${item.jobId}`}>Mở kỳ phổ</Link>
                  </div>
                </div>
              </article>
            );
          })}
          {!loading && !data?.items.length && <div className={styles.empty}>Không còn diagram phù hợp bộ lọc này.</div>}
        </div>
      </section>
    </div>
  );
}
