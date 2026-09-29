"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatBytes, formatUptime, type AdminSystem } from "@/lib/adminApi";
import styles from "../admin.module.css";

export default function AdminSystemPage() {
  const { request } = useAdmin();
  const [data, setData] = useState<AdminSystem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await request<AdminSystem>("/api/admin/system"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đọc được trạng thái hệ thống.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>NỘI CÁC · HỆ THỐNG</p><h1>System Health</h1><p>Kiểm tra backend, Stockfish, dung lượng dữ liệu và cấu hình runtime của ChessApp.</p></div>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
      </section>
      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Backend</span><strong>{data?.backend.online ? "Online" : "—"}</strong><small>Uptime {data ? formatUptime(data.backend.uptimeSeconds) : "—"}</small></article>
        <article className={styles.metric}><span>Stockfish</span><strong>{data?.stockfish.available ? "Ready" : "Missing"}</strong><small>{data?.stockfish.source || "Không tìm thấy engine"}</small></article>
        <article className={styles.metric}><span>Tổng storage</span><strong>{data ? formatBytes(data.storageBytes) : "—"}</strong><small>backend/data</small></article>
        <article className={styles.metric}><span>Puzzle DB</span><strong>{data ? formatBytes(data.puzzleBytes) : "—"}</strong><small>{data?.puzzleUpdate.running ? "Đang cập nhật" : "Ổn định"}</small></article>
      </section>

      <section className={styles.systemGrid}>
        <article className={styles.systemCard}><h3>Runtime</h3><div className={styles.statusList}><div className={styles.statusRow}><span>Python</span><strong>{data?.python || "—"}</strong></div><div className={styles.statusRow}><span>Platform</span><strong>{data?.platform || "—"}</strong></div><div className={styles.statusRow}><span>Admin auth</span><strong>{data?.adminConfigured ? "Configured" : "Missing"}</strong></div></div></article>
        <article className={styles.systemCard}><h3>Dung lượng theo nhóm</h3><div className={styles.statusList}><div className={styles.statusRow}><span>Sách + diagram</span><strong>{data ? formatBytes(data.booksBytes) : "—"}</strong></div><div className={styles.statusRow}><span>Lichess puzzles</span><strong>{data ? formatBytes(data.puzzleBytes) : "—"}</strong></div><div className={styles.statusRow}><span>AI corrections</span><strong>{data ? formatBytes(data.correctionBytes) : "—"}</strong></div></div></article>
        <article className={styles.systemCard}><h3>Đường dẫn dữ liệu</h3><code className={styles.code}>{data?.dataDirectory || "—"}</code></article>
        <article className={styles.systemCard}><h3>Stockfish executable</h3><code className={styles.code}>{data?.stockfish.path || "Chưa cấu hình STOCKFISH_PATH và không có stockfish trong PATH."}</code></article>
      </section>
    </div>
  );
}
