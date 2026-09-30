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

type RestorePlan = {
  backupId: string;
  filename: string;
  format: string;
  scope: "core" | "full";
  createdAt: number;
  valid: boolean;
  restoreFiles: number;
  replaceFiles: number;
  newFiles: number;
  removeFiles: number;
  restoreBytes: number;
  includesPuzzleDb: boolean;
  willResetAdminSessions: boolean;
  preRestoreBackupScope: "core" | "full";
  sqliteDatabases: { name: string; status: string; tables: string[] }[];
  restorePreview: string[];
  removePreview: string[];
  warnings: string[];
};

type RestoreResult = {
  restored: boolean;
  backupId: string;
  scope: "core" | "full";
  restoredFiles: number;
  removedFiles: number;
  sessionsRevoked: boolean;
  preRestoreBackup: AdminBackup;
  rollbackUsed: boolean;
  reauthenticate: boolean;
};

export default function AdminMaintenancePage() {
  const { request, requestRaw, can, principal } = useAdmin();
  const [summary, setSummary] = useState<AdminMaintenanceSummary | null>(null);
  const [integrity, setIntegrity] = useState<AdminIntegrityReport | null>(null);
  const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canRestore = can("users.manage");

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
      if (restorePlan?.backupId === backup.id) {
        setRestorePlan(null);
        setConfirmation("");
      }
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
      setRestorePlan(null);
      setConfirmation("");
      setNotice(result.count ? `Đã xóa ${result.count} backup cũ.` : "Không có backup cũ cần dọn.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không dọn được backup cũ.");
    } finally {
      setBusy("");
    }
  }

  async function inspectRestore(backup: AdminBackup) {
    setBusy(`plan-${backup.id}`);
    setError("");
    setNotice("");
    setConfirmation("");
    try {
      const plan = await request<RestorePlan>(`/api/admin/maintenance/backups/${backup.id}/restore-plan`);
      setRestorePlan(plan);
      window.setTimeout(() => document.getElementById("restore-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (reason) {
      setRestorePlan(null);
      setError(reason instanceof Error ? reason.message : "Backup không vượt qua kiểm tra restore.");
    } finally {
      setBusy("");
    }
  }

  async function executeRestore() {
    if (!restorePlan || confirmation !== "RESTORE") return;
    const warning = `Khôi phục ${restorePlan.filename}?\n\n${restorePlan.restoreFiles} file sẽ được áp dụng, ${restorePlan.removeFiles} file hiện tại sẽ bị xóa khỏi scope ${restorePlan.scope.toUpperCase()}. Backend sẽ tự tạo pre-restore backup trước khi ghi dữ liệu.`;
    if (!window.confirm(warning)) return;
    setBusy(`restore-${restorePlan.backupId}`);
    setError("");
    setNotice("");
    try {
      const result = await request<RestoreResult>(`/api/admin/maintenance/backups/${restorePlan.backupId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (result.reauthenticate) {
        window.alert(`Restore thành công. Đã áp dụng ${result.restoredFiles} file và tạo pre-restore backup ${result.preRestoreBackup.filename}. Các session account đã bị thu hồi; hãy đăng nhập lại.`);
        window.location.assign("/admin");
        return;
      }
      setNotice(`Restore thành công: ${result.restoredFiles} file đã áp dụng, ${result.removedFiles} file cũ đã dọn. Pre-restore backup: ${result.preRestoreBackup.filename}.`);
      setRestorePlan(null);
      setConfirmation("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Restore thất bại.");
    } finally {
      setBusy("");
    }
  }

  const backups = summary?.backups ?? [];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · BACKUP, RESTORE & MAINTENANCE</p>
          <h1>Bảo toàn dữ liệu</h1>
          <p>Tạo snapshot, kiểm tra SQLite integrity và khôi phục có staging + rollback trước khi thay đổi dữ liệu thật.</p>
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
          <div className={styles.panelHead}><h2>Tạo snapshot</h2><span>SQLite-consistent ZIP + SHA-256</span></div>
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
                    <td>
                      <div className={styles.actions}>
                        <button className={styles.button} disabled={Boolean(busy) || !backup.valid} onClick={() => void downloadBackup(backup)}>Tải ZIP</button>
                        {canRestore && <button className={styles.button} disabled={Boolean(busy) || !backup.valid} onClick={() => void inspectRestore(backup)}>{busy === `plan-${backup.id}` ? "Đang kiểm…" : "Kiểm tra restore"}</button>}
                        <button className={styles.danger} disabled={Boolean(busy)} onClick={() => void deleteBackup(backup)}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className={styles.empty}>Chưa có backup. Nên tạo một Core backup trước khi thay đổi dữ liệu lớn.</div>}
      </section>

      {restorePlan ? (
        <section id="restore-panel" className={maintenanceStyles.restorePanel}>
          <div className={maintenanceStyles.restoreHeader}>
            <div>
              <span>OWNER ONLY · SAFE RESTORE</span>
              <h2>{restorePlan.filename}</h2>
              <p>Backup đã vượt qua kiểm tra ZIP, manifest, path safety và SQLite schema/integrity.</p>
            </div>
            <button className={styles.button} disabled={Boolean(busy)} onClick={() => { setRestorePlan(null); setConfirmation(""); }}>Đóng</button>
          </div>

          <div className={maintenanceStyles.planGrid}>
            <div><span>Scope</span><strong>{restorePlan.scope.toUpperCase()}</strong></div>
            <div><span>Áp dụng</span><strong>{restorePlan.restoreFiles} file</strong></div>
            <div><span>Ghi đè</span><strong>{restorePlan.replaceFiles}</strong></div>
            <div><span>File mới</span><strong>{restorePlan.newFiles}</strong></div>
            <div><span>Sẽ xóa</span><strong>{restorePlan.removeFiles}</strong></div>
            <div><span>Dữ liệu</span><strong>{formatBytes(restorePlan.restoreBytes)}</strong></div>
          </div>

          <div className={maintenanceStyles.restoreColumns}>
            <div>
              <h3>Database đã xác minh</h3>
              {restorePlan.sqliteDatabases.length ? restorePlan.sqliteDatabases.map((database) => (
                <div className={maintenanceStyles.planLine} key={database.name}><strong>{database.name}</strong><span>OK · {database.tables.length} tables</span></div>
              )) : <p className={styles.muted}>Backup không chứa SQLite database.</p>}
            </div>
            <div>
              <h3>Cảnh báo</h3>
              {restorePlan.warnings.filter(Boolean).map((warning) => <div className={maintenanceStyles.warningLine} key={warning}>{warning}</div>)}
              <div className={maintenanceStyles.warningLine}>Trước khi ghi dữ liệu, hệ thống sẽ tự tạo một {restorePlan.preRestoreBackupScope.toUpperCase()} pre-restore backup để rollback.</div>
            </div>
          </div>

          {restorePlan.removePreview.length > 0 && (
            <details className={maintenanceStyles.preview}>
              <summary>Xem file hiện tại sẽ bị xóa khỏi scope ({restorePlan.removeFiles})</summary>
              <code>{restorePlan.removePreview.join("\n")}{restorePlan.removeFiles > restorePlan.removePreview.length ? "\n…" : ""}</code>
            </details>
          )}

          <div className={maintenanceStyles.confirmBox}>
            <div>
              <strong>Xác nhận khôi phục</strong>
              <p>Chỉ <b>Owner</b> được restore. Nhập chính xác <code>RESTORE</code>. Không đóng backend trong lúc thao tác đang chạy.</p>
            </div>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="RESTORE" autoComplete="off" spellCheck={false} />
            <button className={styles.danger} disabled={Boolean(busy) || confirmation !== "RESTORE"} onClick={() => void executeRestore()}>{busy === `restore-${restorePlan.backupId}` ? "Đang restore…" : "RESTORE dữ liệu"}</button>
          </div>
        </section>
      ) : (
        <section className={maintenanceStyles.restoreNotice}>
          <strong>{canRestore ? "Safe Restore đã sẵn sàng." : "Restore chỉ dành cho Owner."}</strong>
          <p>{canRestore ? "Chọn Kiểm tra restore trên một backup. Hệ thống luôn dry-run và tạo pre-restore backup trước khi ghi dữ liệu; nếu apply lỗi, backend tự rollback." : `Bạn đang đăng nhập với role ${principal.role}. Bạn vẫn có thể tạo, tải và kiểm tra backup nhưng không thể ghi đè dữ liệu bằng restore.`}</p>
        </section>
      )}
    </div>
  );
}
