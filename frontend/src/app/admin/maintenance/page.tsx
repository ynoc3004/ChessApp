"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import {
  formatBytes,
  formatTime,
  type AdminBackup,
  type AdminIntegrityReport,
  type AdminMaintenanceSummary,
} from "@/lib/adminApi";
import styles from "../admin.module.css";
import maintenanceStyles from "./maintenance.module.css";

export default function AdminMaintenancePage() {
  const { request, requestRaw } = useAdmin();
  const [summary, setSummary] = useState<AdminMaintenanceSummary | null>(null);
  const [integrity, setIntegrity] = useState<AdminIntegrityReport | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setSummary(await request<AdminMaintenanceSummary>("/api/admin/maintenance"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đọc được trạng thái backup.");
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  async function createBackup(scope: "core" | "full") {
    if (scope === "full" && !window.confirm("Full backup sẽ gồm cả Lichess Puzzle DB và có thể rất lớn. Tiếp tục?")) return;
    setBusy(`create-${scope}`);
    setError("");
    setNotice("");
    try {
      const backup = await request<AdminBackup>("/api/admin/maintenance/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      setNotice(`Đã tạo ${scope === "core" ? "Core" : "Full"} backup ${backup.filename}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được backup.");
    } finally {
      setBusy("");
    }
  }

  async function runIntegrity() {
    setBusy("integrity");
    setError("");
    setNotice("");
    try {
      const report = await request<AdminIntegrityReport>("/api/admin/maintenance/integrity", { method: "POST" });
      setIntegrity(report);
      setNotice(report.healthy ? "Integrity check hoàn tất: các database hiện có đều OK." : `Integrity check phát hiện ${report.errors} database có lỗi.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không kiểm tra được database.");
    } finally {
      setBusy("");
    }
  }

  async function downloadBackup(backup: AdminBackup) {
    setBusy(`download-${backup.id}`);
    setError("");
    try {
      const response = await requestRaw(`/api/admin/maintenance/backups/${backup.id}/download`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backup.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được backup.");
    } finally {
      setBusy("");
    }
  }

  async function deleteBackup(backup: AdminBackup) {
    if (!window.confirm(`Xóa backup ${backup.filename}? File ZIP sẽ bị xóa khỏi máy.`)) return;
    setBusy(`delete-${backup.id}`);
    setError("");
    setNotice("");
    try {
      await request(`/api/admin/maintenance/backups/${backup.id}`, { method: "DELETE" });
      setNotice("Đã xóa backup.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được backup.");
    } finally {
      setBusy("");
    }
  }

  async function pruneBackups() {
    if (!window.confirm("Giữ lại 5 backup mới nhất và xóa các bản cũ hơn?")) return;
    setBusy("prune");
    setError("");
    setNotice("");
    try {
      const result = await request<{ count: number }>("/api/admin/maintenance/backups/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep: 5 }),
      });
      setNotice(result.count ? `Đã xóa ${result.count} backup cũ.` : "Không có backup cũ cần dọn.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không dọn được backup cũ.");
    } finally {
      setBusy("");
    }
  }

  const backups = summary?.backups ?? [];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · BACKUP & MAINTENANCE</p>
          <h1>Bảo toàn dữ liệu</h1>
          <p>Tạo snapshot dữ liệu local, kiểm tra SQLite integrity và quản lý các bản sao lưu trước khi nâng cấp hoặc sửa dữ liệu lớn.</p>
        </div>
        <button className={styles.refresh} disabled={Boolean(busy)} onClick={() => void load()}>↻ Làm mới</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Backup hiện có</span><strong>{summary?.backupCount ?? "—"}</strong><small>Snapshot trong backend/data/backups</small></article>
        <article className={styles.metric}><span>Dung lượng backup</span><strong>{summary ? formatBytes(summary.backupBytes) : "—"}</strong><small>Tổng ZIP đang lưu</small></article>
        <article className={styles.metric}><span>Backup gần nhất</span><strong>{summary?.latestBackupAt ? formatTime(summary.latestBackupAt) : "Chưa có"}</strong><small>Core hoặc Full</small></article>
        <article className={styles.metric}><span>DB integrity</span><strong>{integrity ? (integrity.healthy ? "OK" : `${integrity.errors} lỗi`) : "Chưa kiểm"}</strong><small>{integrity ? `${integrity.checked} database đã kiểm` : "Chạy quick_check khi cần"}</small></article>
      </section>

      <section className={maintenanceStyles.controlGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Tạo snapshot</h2><span>SQLite-consistent ZIP</span></div>
          <div className={maintenanceStyles.choiceList}>
            <div className={maintenanceStyles.choice}>
              <div><strong>Core backup</strong><p>Sách, diagram, uploads, Tàng Kinh Các, account/session hash, Audit Log và AI corrections. Không chứa Puzzle DB Lichess.</p></div>
              <button className={styles.button} disabled={Boolean(busy)} onClick={() => void createBackup("core")}>{busy === "create-core" ? "Đang tạo…" : "Tạo Core backup"}</button>
            </div>
            <div className={maintenanceStyles.choice}>
              <div><strong>Full backup</strong><p>Toàn bộ Core + Lichess Puzzle DB. File có thể rất lớn và cần nhiều thời gian hơn.</p></div>
              <button className={styles.button} disabled={Boolean(busy)} onClick={() => void createBackup("full")}>{busy === "create-full" ? "Đang tạo…" : "Tạo Full backup"}</button>
            </div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><h2>Database integrity</h2><span>PRAGMA quick_check</span></div>
          <p className={styles.muted}>Kiểm tra các database collection, tài khoản Admin, Audit Log và Lichess Puzzle DB. Database chưa được tạo sẽ hiện Missing, không tính là lỗi.</p>
          <div className={styles.actions}><button className={styles.button} disabled={Boolean(busy)} onClick={() => void runIntegrity()}>{busy === "integrity" ? "Đang kiểm tra…" : "Chạy integrity check"}</button></div>
          {integrity && (
            <div className={maintenanceStyles.integrityList}>
              {integrity.databases.map((database) => (
                <div className={maintenanceStyles.integrityRow} key={database.name} data-status={database.status}>
                  <div><strong>{database.name}</strong><span>{database.message}</span></div>
                  <div className={maintenanceStyles.dbMeta}><span>{database.exists ? formatBytes(database.bytes) : "—"}</span><b>{database.status === "ok" ? "OK" : database.status === "missing" ? "Missing" : "Error"}</b></div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div><h2>Kho backup</h2><span>{backups.length} file ZIP</span></div>
          <button className={styles.button} disabled={Boolean(busy) || backups.length <= 5} onClick={() => void pruneBackups()}>{busy === "prune" ? "Đang dọn…" : "Giữ 5 bản mới nhất"}</button>
        </div>
        {backups.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Backup</th><th>Scope</th><th>Dữ liệu</th><th>ZIP</th><th>File</th><th>Trạng thái</th><th></th></tr></thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td><strong>{formatTime(backup.createdAt)}</strong><div className={styles.muted}>{backup.filename}</div></td>
                    <td><span className={backup.scope === "full" ? `${styles.badge} ${styles.badgeWorking}` : styles.badge}>{backup.scope.toUpperCase()}</span></td>
                    <td>{formatBytes(backup.contentBytes)}</td>
                    <td>{formatBytes(backup.archiveBytes)}</td>
                    <td>{backup.fileCount.toLocaleString("vi-VN")}</td>
                    <td><span className={backup.valid ? styles.badge : `${styles.badge} ${styles.badgeFailed}`}>{backup.valid ? "Hợp lệ" : "Manifest lỗi"}</span></td>
                    <td><div className={styles.actions}><button className={styles.button} disabled={Boolean(busy) || !backup.valid} onClick={() => void downloadBackup(backup)}>Tải ZIP</button><button className={styles.danger} disabled={Boolean(busy)} onClick={() => void deleteBackup(backup)}>Xóa</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className={styles.empty}>Chưa có backup. Nên tạo một Core backup trước khi thay đổi dữ liệu lớn.</div>}
      </section>

      <section className={maintenanceStyles.restoreNotice}>
        <strong>Restore chưa được tự động hóa ở v7.</strong>
        <p>Backup ZIP có manifest rõ ràng, nhưng khôi phục tự động cần kiểm tra version/schema và cơ chế rollback trước khi cho phép ghi đè dữ liệu đang chạy. V7 ưu tiên tạo bản sao an toàn trước.</p>
      </section>
    </div>
  );
}
