"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatBytes, formatTime } from "@/lib/adminApi";
import styles from "../admin.module.css";

type ValidationStats = {
  tiles?: number;
  accuracy?: number | null;
  pieceTiles?: number;
  pieceAccuracy?: number | null;
};

type SpecialistStatus = {
  modelExists: boolean;
  modelBytes: number;
  trainedAt: number | null;
  trainedBoards: number;
  trainedTiles: number;
  pieceTiles: number;
  classCounts: Record<string, number>;
  prototypeCounts: Record<string, number>;
  usablePieceClasses: number;
  validation: ValidationStats;
  skippedImage: number;
  skippedFen: number;
  skippedOrientation: number;
  stale: boolean;
  ready: boolean;
  version: number;
};

type TrainResponse = {
  trained: boolean;
  clearedRecognitionCaches: number;
  model: SpecialistStatus;
};

const PIECES = [
  [".", "Trống"],
  ["K", "Vua trắng"], ["Q", "Hậu trắng"], ["R", "Xe trắng"],
  ["B", "Tượng trắng"], ["N", "Mã trắng"], ["P", "Tốt trắng"],
  ["k", "Vua đen"], ["q", "Hậu đen"], ["r", "Xe đen"],
  ["b", "Tượng đen"], ["n", "Mã đen"], ["p", "Tốt đen"],
] as const;

function percent(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export default function AdminModelPage() {
  const { request, can } = useAdmin();
  const [status, setStatus] = useState<SpecialistStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await request<SpecialistStatus>("/api/admin/dataset/model"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được trạng thái model.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  async function train() {
    if (!window.confirm("Huấn luyện lại model 13 lớp từ toàn bộ correction hợp lệ? Cache AI cũ sẽ được xóa để model mới có hiệu lực.")) return;
    setTraining(true);
    setError("");
    setMessage("");
    try {
      const response = await request<TrainResponse>("/api/admin/dataset/model/train", { method: "POST" });
      setStatus(response.model);
      setMessage(`Đã huấn luyện xong. Đã xóa ${response.clearedRecognitionCaches.toLocaleString("vi-VN")} cache AI cũ; bản sửa tay vẫn được giữ nguyên.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Huấn luyện model thất bại.");
    } finally {
      setTraining(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · RECOGNITION V4</p>
          <h1>Model chuyên biệt 13 lớp</h1>
          <p>Học trực tiếp từ các bàn cờ bạn đã sửa: trống + 12 quân. Model chỉ sửa loại quân; occupancy và màu quân vẫn do Recognition v3/v3.1 bảo vệ.</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.refresh} disabled={loading || training} onClick={() => void load()}>↻ Làm mới</button>
          {can("dataset.write") && <button className={styles.button} disabled={training} onClick={() => void train()}>{training ? "Đang huấn luyện…" : "Huấn luyện lại model"}</button>}
        </div>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {message && <div className={styles.notice}>{message}</div>}

      <section className={styles.grid} aria-busy={loading}>
        <article className={styles.metric}>
          <span>Trạng thái</span>
          <strong>{status?.ready ? (status.stale ? "Cần train lại" : "Sẵn sàng") : "Chưa có model"}</strong>
          <small>Recognition v{status?.version ?? 1} · {formatBytes(status?.modelBytes ?? 0)}</small>
        </article>
        <article className={styles.metric}>
          <span>Board đã học</span>
          <strong>{(status?.trainedBoards ?? 0).toLocaleString("vi-VN")}</strong>
          <small>{(status?.pieceTiles ?? 0).toLocaleString("vi-VN")} ô có quân</small>
        </article>
        <article className={styles.metric}>
          <span>Piece accuracy</span>
          <strong>{percent(status?.validation?.pieceAccuracy)}</strong>
          <small>{(status?.validation?.pieceTiles ?? 0).toLocaleString("vi-VN")} ô validation</small>
        </article>
        <article className={styles.metric}>
          <span>Lần train gần nhất</span>
          <strong>{status?.trainedAt ? formatTime(status.trainedAt) : "—"}</strong>
          <small>{status?.usablePieceClasses ?? 0}/12 lớp quân đủ mẫu tối thiểu</small>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div><h2>Độ phủ 13 lớp</h2><span>Mỗi loại quân cần ít nhất vài ví dụ thật trước khi được phép sửa kết quả model gốc.</span></div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Lớp</th><th>Nhãn</th><th>Sample ô</th><th>Prototype</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {PIECES.map(([piece, label]) => {
                const count = status?.classCounts?.[piece] ?? 0;
                const prototypes = status?.prototypeCounts?.[piece] ?? 0;
                const enough = piece === "." ? count > 0 : count >= 3;
                return <tr key={piece}><td><code>{piece}</code></td><td>{label}</td><td>{count.toLocaleString("vi-VN")}</td><td>{prototypes.toLocaleString("vi-VN")}</td><td><span className={styles.badge}>{enough ? "Đủ dùng" : "Cần thêm mẫu"}</span></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Chất lượng dataset cho training</h2><span>Không âm thầm gán nhãn khi orientation/FEN không chắc.</span></div>
        <div className={styles.grid}>
          <article className={styles.metric}><span>Tổng tile đã học</span><strong>{(status?.trainedTiles ?? 0).toLocaleString("vi-VN")}</strong><small>64 ô × board hợp lệ</small></article>
          <article className={styles.metric}><span>Thiếu ảnh</span><strong>{status?.skippedImage ?? 0}</strong><small>Sample bị bỏ qua</small></article>
          <article className={styles.metric}><span>FEN lỗi</span><strong>{status?.skippedFen ?? 0}</strong><small>Không đưa vào model</small></article>
          <article className={styles.metric}><span>Thiếu orientation</span><strong>{status?.skippedOrientation ?? 0}</strong><small>Không đoán bừa hướng ảnh</small></article>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Cách model v4 can thiệp</h2><span>Conservative override</span></div>
        <p className={styles.muted}>Model chuyên biệt không được tự tạo/xóa quân. Nó chỉ được đổi <strong>loại quân</strong> trên một ô đã có quân khi confidence và khoảng cách với lựa chọn thứ hai đủ lớn. Màu trắng/đen được giữ từ Color Resolver v3.1. Nếu model local chưa có hoặc file lỗi, ChessApp tự quay về recognizer cũ.</p>
      </section>
    </div>
  );
}
