"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import {
  formatBytes,
  formatTime,
  type AdminDatasetSample,
  type AdminDatasetSamplesResponse,
  type AdminDatasetStats,
} from "@/lib/adminApi";
import styles from "../admin.module.css";
import dataset from "./dataset.module.css";

function pieceLabel(piece: string | null) {
  if (!piece) return "trống";
  const names: Record<string, string> = {
    K: "Vua trắng", Q: "Hậu trắng", R: "Xe trắng", B: "Tượng trắng", N: "Mã trắng", P: "Tốt trắng",
    k: "Vua đen", q: "Hậu đen", r: "Xe đen", b: "Tượng đen", n: "Mã đen", p: "Tốt đen",
  };
  return names[piece] || piece;
}

export default function AdminCorrectionsPage() {
  const { request, requestRaw } = useAdmin();
  const [stats, setStats] = useState<AdminDatasetStats | null>(null);
  const [items, setItems] = useState<AdminDatasetSample[]>([]);
  const [total, setTotal] = useState(0);
  const [filtered, setFiltered] = useState(0);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [recognizer, setRecognizer] = useState("");
  const [preprocess, setPreprocess] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState("");
  const [exporting, setExporting] = useState("");
  const [selected, setSelected] = useState<AdminDatasetSample | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: "300", state });
    if (query.trim()) value.set("query", query.trim());
    if (recognizer) value.set("recognizer", recognizer);
    if (preprocess) value.set("preprocess", preprocess);
    return value.toString();
  }, [preprocess, query, recognizer, state]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statsData, samplesData] = await Promise.all([
        request<AdminDatasetStats>("/api/admin/dataset/stats"),
        request<AdminDatasetSamplesResponse>(`/api/admin/dataset/samples?${params}`),
      ]);
      setStats(statsData);
      setItems(samplesData.samples);
      setTotal(samplesData.total);
      setFiltered(samplesData.filtered);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được AI dataset.");
    } finally {
      setLoading(false);
    }
  }, [params, request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (selectedImage) URL.revokeObjectURL(selectedImage); }, [selectedImage]);

  async function openDetail(item: AdminDatasetSample) {
    setError("");
    try {
      const detail = await request<AdminDatasetSample>(`/api/admin/dataset/samples/${encodeURIComponent(item.sampleId)}`);
      let imageUrl: string | null = null;
      if (detail.hasImage) {
        const response = await requestRaw(`/api/admin/corrections/${encodeURIComponent(item.sampleId)}/image`);
        imageUrl = URL.createObjectURL(await response.blob());
      }
      setSelectedImage((current) => {
        if (current) URL.revokeObjectURL(current);
        return imageUrl;
      });
      setSelected(detail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không mở được chi tiết sample.");
    }
  }

  async function remove(item: AdminDatasetSample) {
    if (!window.confirm(`Xóa mẫu học ${item.sampleId}? Ảnh và metadata của mẫu này sẽ bị xóa.`)) return;
    setDeleting(item.sampleId);
    setError("");
    try {
      await request(`/api/admin/corrections/${encodeURIComponent(item.sampleId)}`, { method: "DELETE" });
      if (selected?.sampleId === item.sampleId) {
        setSelected(null);
        setSelectedImage(null);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được sample.");
    } finally {
      setDeleting("");
    }
  }

  async function exportDataset(changedOnly: boolean) {
    const key = changedOnly ? "changed" : "all";
    setExporting(key);
    setError("");
    try {
      const response = await requestRaw(`/api/admin/dataset/export?changed_only=${changedOnly ? "true" : "false"}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = changedOnly ? "chessapp-ai-dataset-changed.zip" : "chessapp-ai-dataset.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không export được dataset.");
    } finally {
      setExporting("");
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · AI DATASET</p>
          <h1>Dataset nhận dạng bàn cờ</h1>
          <p>Đo chất lượng correction, tìm ô cờ AI thường đọc sai và xuất dữ liệu sạch để retraining local.</p>
        </div>
        <div className={dataset.exportBar}>
          <button className={styles.button} disabled={Boolean(exporting)} onClick={() => void exportDataset(true)}>{exporting === "changed" ? "Đang đóng gói…" : "Export mẫu AI sai"}</button>
          <button className={styles.refresh} disabled={Boolean(exporting)} onClick={() => void exportDataset(false)}>{exporting === "all" ? "Đang đóng gói…" : "Export toàn dataset"}</button>
          <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
        </div>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Tổng sample</span><strong>{(stats?.total ?? total).toLocaleString("vi-VN")}</strong><small>Board correction đã lưu</small></article>
        <article className={styles.metric}><span>AI đọc sai</span><strong>{(stats?.changed ?? 0).toLocaleString("vi-VN")}</strong><small>FEN AI khác bản người dùng sửa</small></article>
        <article className={styles.metric}><span>Ô sai trung bình</span><strong>{stats?.averageChangedSquares ?? 0}</strong><small>Trên mỗi board thực sự bị sửa</small></article>
        <article className={styles.metric}><span>Dung lượng dataset</span><strong>{formatBytes(stats?.datasetBytes ?? 0)}</strong><small>{stats?.missingImage ?? 0} mẫu thiếu ảnh · {stats?.invalidCorrectedFen ?? 0} FEN lỗi</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Bộ lọc dataset</h2><span>{filtered.toLocaleString("vi-VN")} / {total.toLocaleString("vi-VN")} sample</span></div>
        <div className={dataset.filters}>
          <label>Tìm kiếm<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sample ID, Job ID hoặc FEN" /></label>
          <label>Trạng thái<select value={state} onChange={(event) => setState(event.target.value)}><option value="all">Tất cả</option><option value="changed">AI đọc sai</option><option value="confirmed">AI đọc đúng</option><option value="missing-ai">Thiếu AI FEN</option><option value="missing-image">Thiếu ảnh</option><option value="invalid">FEN sửa không hợp lệ</option></select></label>
          <label>Recognizer<select value={recognizer} onChange={(event) => setRecognizer(event.target.value)}><option value="">Tất cả</option>{stats?.recognizers.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select></label>
          <label>Preprocess<select value={preprocess} onChange={(event) => setPreprocess(event.target.value)}><option value="">Tất cả</option>{stats?.preprocessVariants.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select></label>
        </div>
      </section>

      <section className={dataset.secondaryGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Pipeline dữ liệu</h2><span>Phân bố sample</span></div>
          <div className={dataset.distribution}>
            {(stats?.recognizers ?? []).slice(0, 8).map((item) => <div className={dataset.distributionRow} key={`r-${item.name}`}><span>Recognizer · {item.name}</span><strong>{item.count.toLocaleString("vi-VN")}</strong></div>)}
            {(stats?.preprocessVariants ?? []).slice(0, 8).map((item) => <div className={dataset.distributionRow} key={`p-${item.name}`}><span>Preprocess · {item.name}</span><strong>{item.count.toLocaleString("vi-VN")}</strong></div>)}
            {!stats?.recognizers.length && <div className={styles.empty}>Chưa có dữ liệu pipeline.</div>}
          </div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Ô cờ AI hay đọc sai</h2><span>Top 16</span></div>
          <div className={dataset.squareGrid}>
            {(stats?.topErrorSquares ?? []).map((item) => <div className={dataset.square} key={item.square}><strong>{item.square}</strong><span>{item.count} lần</span></div>)}
            {!stats?.topErrorSquares.length && <div className={styles.empty}>Chưa đủ correction khác biệt để thống kê.</div>}
          </div>
        </article>
      </section>

      {selected && (
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><h2>Chi tiết · {selected.sampleId}</h2><span>{formatTime(selected.savedAt)} · {selected.changedSquares} ô thay đổi</span></div><button className={styles.button} onClick={() => { setSelected(null); setSelectedImage(null); }}>Đóng</button></div>
          <div className={dataset.detailGrid}>
            <div>{selectedImage ? <img className={dataset.detailImage} src={selectedImage} alt={`Sample ${selected.sampleId}`} /> : <div className={styles.notice}>Sample này không có ảnh nguồn.</div>}</div>
            <div>
              <div className={dataset.fen}><label>AI FEN</label><code>{selected.aiFen || "Không có"}</code></div>
              <div className={dataset.fen}><label>Corrected FEN</label><code>{selected.correctedFen || "Không có"}</code></div>
              <p className={styles.muted}>{selected.recognizer || "Recognizer không rõ"} · {selected.preprocessVariant || "Preprocess không rõ"} · {selected.imageOrientation || "Orientation không rõ"}</p>
              {selected.diffs.length > 0 ? <div className={dataset.diffGrid}>{selected.diffs.map((diff) => <div className={dataset.diff} key={diff.square}><strong>{diff.square}</strong><span>{pieceLabel(diff.aiPiece)} → {pieceLabel(diff.correctedPiece)}</span></div>)}</div> : <div className={styles.notice}>Không phát hiện khác biệt quân cờ giữa hai FEN.</div>}
            </div>
          </div>
        </section>
      )}

      <section className={dataset.sampleGrid} aria-busy={loading}>
        {items.map((item) => (
          <article className={dataset.sample} key={item.sampleId}>
            <div className={dataset.sampleHead}>
              <div><h3>{item.sampleId}</h3><span className={styles.muted}>{formatTime(item.savedAt)}</span></div>
              <span className={item.changed ? `${styles.badge} ${styles.badgeWorking}` : styles.badge}>{item.changed ? `${item.changedSquares} ô sai` : item.aiFen ? "AI khớp" : "Thiếu AI FEN"}</span>
            </div>
            <div className={dataset.fen}><label>AI đọc</label><code>{item.aiFen || "Không lưu AI FEN"}</code></div>
            <div className={dataset.fen}><label>Bản đúng</label><code>{item.correctedFen || "Không có FEN"}</code></div>
            <div className={dataset.sampleMeta}><span>{item.recognizer || "recognizer ?"}</span><span>{item.preprocessVariant || "preprocess ?"}</span><span>{formatBytes(item.imageBytes)}</span>{!item.hasImage && <span className={dataset.warning}>thiếu ảnh</span>}{!item.validCorrectedFen && <span className={dataset.warning}>FEN lỗi</span>}</div>
            <div className={styles.actions}><button className={styles.button} onClick={() => void openDetail(item)}>Chi tiết</button><button className={styles.danger} disabled={deleting === item.sampleId} onClick={() => void remove(item)}>{deleting === item.sampleId ? "Đang xóa…" : "Xóa mẫu"}</button></div>
          </article>
        ))}
      </section>
      {!loading && items.length === 0 && <div className={styles.empty}>Không có sample phù hợp với bộ lọc.</div>}
    </div>
  );
}
