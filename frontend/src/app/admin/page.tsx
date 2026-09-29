"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatBytes, formatUptime, type AdminStats } from "@/lib/adminApi";
import styles from "./admin.module.css";

export default function AdminDashboard() {
  const { request } = useAdmin();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStats(await request<AdminStats>("/api/admin/stats"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được dashboard.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · TỔNG QUAN</p>
          <h1>Trung tâm quản trị</h1>
          <p>Theo dõi kỳ phổ, kho puzzle, dữ liệu sửa AI và tình trạng hệ thống từ một nơi.</p>
        </div>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()}>{loading ? "Đang cập nhật…" : "↻ Làm mới"}</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.grid} aria-busy={loading}>
        <article className={styles.metric}><span>Kỳ phổ</span><strong>{stats?.books.toLocaleString("vi-VN") ?? "—"}</strong><small>{stats?.bookStatuses.failed ?? 0} job lỗi</small></article>
        <article className={styles.metric}><span>Diagram</span><strong>{stats?.diagrams.toLocaleString("vi-VN") ?? "—"}</strong><small>Ảnh thế cờ đã tách</small></article>
        <article className={styles.metric}><span>Lichess Puzzle</span><strong>{stats?.puzzles.toLocaleString("vi-VN") ?? "—"}</strong><small>{stats?.puzzleReady ? "Database sẵn sàng" : "Chưa có database"}</small></article>
        <article className={styles.metric}><span>AI Corrections</span><strong>{stats?.corrections.toLocaleString("vi-VN") ?? "—"}</strong><small>Mẫu sửa dùng cho dataset</small></article>
        <article className={styles.metric}><span>Tàng Kinh Các</span><strong>{stats?.collection.toLocaleString("vi-VN") ?? "—"}</strong><small>Thế cờ đã lưu</small></article>
        <article className={styles.metric}><span>Dung lượng dữ liệu</span><strong>{stats ? formatBytes(stats.storageBytes) : "—"}</strong><small>Books + puzzle + correction</small></article>
        <article className={styles.metric}><span>Stockfish</span><strong>{stats?.stockfish.available ? "Sẵn sàng" : "Chưa có"}</strong><small>{stats?.stockfish.source || "Không tìm thấy engine"}</small></article>
        <article className={styles.metric}><span>Backend uptime</span><strong>{stats ? formatUptime(stats.uptimeSeconds) : "—"}</strong><small>Thời gian từ lần khởi động gần nhất</small></article>
      </section>

      <section className={styles.split}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Trạng thái quét sách</h2><span>theo job</span></div>
          <div className={styles.statusList}>
            <div className={styles.statusRow}><span><i className={styles.dot} />Hoàn tất</span><strong>{stats?.bookStatuses.completed ?? 0}</strong></div>
            <div className={styles.statusRow}><span><i className={styles.dot} />Đang xử lý</span><strong>{(stats?.bookStatuses.processing ?? 0) + (stats?.bookStatuses.queued ?? 0)}</strong></div>
            <div className={styles.statusRow}><span><i className={`${styles.dot} ${styles.dotBad}`} />Thất bại</span><strong>{stats?.bookStatuses.failed ?? 0}</strong></div>
            <div className={styles.statusRow}><span>Không xác định</span><strong>{stats?.bookStatuses.unknown ?? 0}</strong></div>
          </div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Sức khỏe hệ thống</h2><span>runtime hiện tại</span></div>
          <div className={styles.statusList}>
            <div className={styles.statusRow}><span><i className={styles.dot} />Backend API</span><strong>Online</strong></div>
            <div className={styles.statusRow}><span><i className={`${styles.dot} ${stats?.stockfish.available ? "" : styles.dotBad}`} />Stockfish</span><strong>{stats?.stockfish.available ? "Ready" : "Unavailable"}</strong></div>
            <div className={styles.statusRow}><span><i className={`${styles.dot} ${stats?.puzzleReady ? "" : styles.dotBad}`} />Lichess DB</span><strong>{stats?.puzzleReady ? "Ready" : "Missing"}</strong></div>
          </div>
        </article>
      </section>
    </div>
  );
}
