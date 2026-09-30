"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import {
  formatBytes,
  formatTime,
  type AdminAuditEvent,
  type AdminAuditResponse,
  type AdminAuditStats,
} from "@/lib/adminApi";
import styles from "../admin.module.css";
import auditStyles from "./audit.module.css";

const PAGE_SIZE = 50;

export default function AdminAuditPage() {
  const { request } = useAdmin();
  const [stats, setStats] = useState<AdminAuditStats | null>(null);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [resource, setResource] = useState("");
  const [action, setAction] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStats = useCallback(async () => {
    const data = await request<AdminAuditStats>("/api/admin/audit/stats");
    setStats(data);
  }, [request]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      if (resource) params.set("resource_type", resource);
      if (action) params.set("action", action);
      const data = await request<AdminAuditResponse>(`/api/admin/audit?${params.toString()}`);
      setEvents(data.events);
      setTotal(data.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được nhật ký quản trị.");
    } finally {
      setLoading(false);
    }
  }, [action, offset, query, request, resource, status]);

  useEffect(() => {
    void loadStats().catch((reason) => setError(reason instanceof Error ? reason.message : "Không tải được thống kê nhật ký."));
  }, [loadStats]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadEvents(); }, 180);
    return () => window.clearTimeout(timer);
  }, [loadEvents]);

  const resourceOptions = useMemo(() => stats?.topResources.map((item) => item.name) ?? [], [stats]);
  const actionOptions = useMemo(() => stats?.topActions.map((item) => item.name) ?? [], [stats]);
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetFilters() {
    setQuery("");
    setStatus("");
    setResource("");
    setAction("");
    setOffset(0);
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · AUDIT LOG</p>
          <h1>Nhật ký quản trị</h1>
          <p>Mọi thao tác thay đổi dữ liệu trong Admin được ghi tự động. Nhật ký không lưu mã quản trị, Authorization header hoặc request body.</p>
        </div>
        <button className={styles.refresh} disabled={loading} onClick={() => { void loadStats(); void loadEvents(); }}>↻ Làm mới</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Tổng sự kiện</span><strong>{(stats?.total ?? 0).toLocaleString("vi-VN")}</strong><small>Lịch sử mutation Admin</small></article>
        <article className={styles.metric}><span>Thành công</span><strong>{(stats?.success ?? 0).toLocaleString("vi-VN")}</strong><small>Request hoàn tất dưới HTTP 400</small></article>
        <article className={styles.metric}><span>Thất bại</span><strong>{(stats?.failure ?? 0).toLocaleString("vi-VN")}</strong><small>HTTP lỗi hoặc exception</small></article>
        <article className={styles.metric}><span>24 giờ qua</span><strong>{(stats?.last24Hours ?? 0).toLocaleString("vi-VN")}</strong><small>DB {formatBytes(stats?.databaseBytes ?? 0)}</small></article>
      </section>

      <section className={auditStyles.summaryGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Thao tác nhiều nhất</h2><span>Top action</span></div>
          <div className={auditStyles.rankList}>
            {(stats?.topActions ?? []).map((item) => (
              <div className={auditStyles.rankRow} key={item.name}>
                <button onClick={() => { setAction(item.name); setOffset(0); }}>{item.name}</button>
                <strong>{item.count.toLocaleString("vi-VN")}</strong>
              </div>
            ))}
            {stats && stats.topActions.length === 0 && <div className={styles.empty}>Chưa có thao tác nào được ghi.</div>}
          </div>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Nhóm dữ liệu</h2><span>Resource</span></div>
          <div className={auditStyles.rankList}>
            {(stats?.topResources ?? []).map((item) => (
              <div className={auditStyles.rankRow} key={item.name}>
                <button onClick={() => { setResource(item.name); setOffset(0); }}>{item.name}</button>
                <strong>{item.count.toLocaleString("vi-VN")}</strong>
              </div>
            ))}
            {stats && stats.topResources.length === 0 && <div className={styles.empty}>Chưa có resource nào.</div>}
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Bộ lọc</h2><button className={styles.button} onClick={resetFilters}>Xóa lọc</button></div>
        <div className={auditStyles.filters}>
          <label>Tìm kiếm<input className={styles.input} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="action, ID, message…" /></label>
          <label>Trạng thái<select className={styles.select} value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}><option value="">Tất cả</option><option value="success">Thành công</option><option value="failure">Thất bại</option><option value="started">Đã bắt đầu</option></select></label>
          <label>Resource<select className={styles.select} value={resource} onChange={(event) => { setResource(event.target.value); setOffset(0); }}><option value="">Tất cả</option>{resourceOptions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label>Action<select className={styles.select} value={action} onChange={(event) => { setAction(event.target.value); setOffset(0); }}><option value="">Tất cả</option>{actionOptions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        </div>
      </section>

      <section className={styles.panel} aria-busy={loading}>
        <div className={styles.panelHead}><h2>Sự kiện</h2><span>{total.toLocaleString("vi-VN")} kết quả</span></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Thời gian</th><th>Action</th><th>Resource</th><th>Trạng thái</th><th>Thông tin</th><th></th></tr></thead>
            <tbody>
              {events.map((event) => (
                <EventRows event={event} expanded={expanded === event.id} onToggle={() => setExpanded((current) => current === event.id ? null : event.id)} key={event.id} />
              ))}
            </tbody>
          </table>
        </div>
        {!loading && events.length === 0 && <div className={styles.empty}>Không có sự kiện phù hợp bộ lọc.</div>}
        <div className={auditStyles.pagination}>
          <button className={styles.button} disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>← Trang trước</button>
          <span>Trang {page}/{pages}</span>
          <button className={styles.button} disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Trang sau →</button>
        </div>
      </section>
    </div>
  );
}

function EventRows({ event, expanded, onToggle }: { event: AdminAuditEvent; expanded: boolean; onToggle: () => void }) {
  const badge = event.status === "failure" ? `${styles.badge} ${styles.badgeFailed}` : event.status === "started" ? `${styles.badge} ${styles.badgeWorking}` : styles.badge;
  return (
    <>
      <tr>
        <td><strong>{formatTime(event.createdAt)}</strong><div className={styles.muted}>#{event.id}</div></td>
        <td><div className={auditStyles.eventAction}><code>{event.action}</code></div></td>
        <td><div className={auditStyles.resource}><strong>{event.resourceType}</strong>{event.resourceId && <code>{event.resourceId}</code>}</div></td>
        <td><span className={badge}>{event.status === "failure" ? "Thất bại" : event.status === "started" ? "Đang chạy" : "Thành công"}</span></td>
        <td>{event.message || "—"}</td>
        <td><button className={auditStyles.detailToggle} onClick={onToggle}>{expanded ? "Thu gọn" : "Chi tiết"}</button></td>
      </tr>
      {expanded && (
        <tr className={auditStyles.detailRow}>
          <td colSpan={6}>
            <div className={auditStyles.detailGrid}>
              <div><span>Action</span><strong>{event.action}</strong></div>
              <div><span>Resource ID</span><strong>{event.resourceId || "—"}</strong></div>
              <div><span>Message</span><strong>{event.message || "—"}</strong></div>
            </div>
            <pre className={auditStyles.json}>{JSON.stringify(event.details, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}
