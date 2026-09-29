"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatBytes, formatTime, type PuzzleStats, type PuzzleUpdateState } from "@/lib/adminApi";
import styles from "../admin.module.css";

export default function AdminPuzzlesPage() {
  const { request } = useAdmin();
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [update, setUpdate] = useState<PuzzleUpdateState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statsData, updateData] = await Promise.all([
        request<PuzzleStats>("/api/admin/puzzles/stats"),
        request<PuzzleUpdateState>("/api/admin/puzzles/update"),
      ]);
      setStats(statsData);
      setUpdate(updateData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đọc được database puzzle.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!update?.running) return;
    const timer = window.setInterval(() => {
      void request<PuzzleUpdateState>("/api/admin/puzzles/update").then((state) => {
        setUpdate(state);
        if (!state.running) void load();
      }).catch(() => {});
    }, 2500);
    return () => window.clearInterval(timer);
  }, [load, request, update?.running]);

  async function startUpdate() {
    if (!window.confirm("Kiểm tra và tải database Lichess mới nếu có? Quá trình có thể dùng nhiều băng thông và dung lượng.")) return;
    setError("");
    try {
      setUpdate(await request<PuzzleUpdateState>("/api/admin/puzzles/update", { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không bắt đầu cập nhật được.");
    }
  }

  const maxBucket = useMemo(() => Math.max(1, ...(stats?.ratingBuckets.map((item) => item.count) ?? [1])), [stats]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>NỘI CÁC · BÍ CẢNH</p><h1>Lichess Puzzle Database</h1><p>Theo dõi kho puzzle local, phân bố rating, theme và cập nhật dữ liệu nguồn khi cần.</p></div>
        <button className={styles.refresh} disabled={loading || update?.running} onClick={() => void load()}>↻ Làm mới</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {update?.running && <div className={styles.notice}>Database đang được cập nhật ở backend. Trang này sẽ tự kiểm tra trạng thái cho đến khi hoàn tất.</div>}
      {update?.error && <div className={styles.error}>Lần cập nhật gần nhất lỗi: {update.error}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Tổng puzzle</span><strong>{stats?.count.toLocaleString("vi-VN") ?? "—"}</strong><small>{stats?.ready ? "Database sẵn sàng" : "Chưa nhập dữ liệu"}</small></article>
        <article className={styles.metric}><span>Khoảng rating</span><strong>{stats?.ratingMin ?? "—"}–{stats?.ratingMax ?? "—"}</strong><small>Rating trong database</small></article>
        <article className={styles.metric}><span>Theme</span><strong>{stats?.themeCount.toLocaleString("vi-VN") ?? "—"}</strong><small>Chủ đề khác nhau</small></article>
        <article className={styles.metric}><span>Dung lượng DB</span><strong>{stats ? formatBytes(stats.databaseBytes) : "—"}</strong><small>Cập nhật {formatTime(stats?.updatedAt)}</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Cập nhật kho puzzle</h2><span>{update?.finishedAt ? `Lần chạy: ${formatTime(update.finishedAt)}` : "Chưa chạy trong phiên này"}</span></div>
        <p className={styles.muted}>Backend dùng script cập nhật sẵn có của dự án, tải bản Lichess mới vào file tạm rồi chỉ thay database sau khi import thành công.</p>
        <div className={styles.actions}><button className={styles.button} disabled={Boolean(update?.running)} onClick={() => void startUpdate()}>{update?.running ? "Đang cập nhật…" : "Kiểm tra & cập nhật Lichess DB"}</button></div>
      </section>

      <section className={styles.split}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Theme phổ biến</h2><span>Top 12</span></div>
          <div className={styles.themeGrid}>{stats?.topThemes.map((item) => <div className={styles.theme} key={item.theme}><strong>{item.theme}</strong><span>{item.count.toLocaleString("vi-VN")} puzzle</span></div>)}</div>
          {!loading && !stats?.topThemes.length && <div className={styles.empty}>Chưa có dữ liệu theme.</div>}
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Phân bố rating</h2><span>mỗi 200 Elo</span></div>
          <div className={styles.bars}>{stats?.ratingBuckets.map((item) => <div className={styles.barRow} key={item.rating}><span>{item.rating}+</span><div className={styles.barTrack}><span style={{ width: `${Math.max(1, item.count / maxBucket * 100)}%` }} /></div><strong>{item.count.toLocaleString("vi-VN")}</strong></div>)}</div>
          {!loading && !stats?.ratingBuckets.length && <div className={styles.empty}>Chưa có dữ liệu rating.</div>}
        </article>
      </section>
    </div>
  );
}
