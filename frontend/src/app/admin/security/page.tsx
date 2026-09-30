"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatTime, type AdminPrincipal } from "@/lib/adminApi";
import styles from "../admin.module.css";
import securityStyles from "./security.module.css";

const TOKEN_KEY = "chessapp:admin-token";

type SecuritySession = {
  id: string;
  createdAt: number;
  expiresAt: number;
  remainingSeconds: number;
  current: boolean;
};

type SecurityOverview = {
  principal: AdminPrincipal;
  sessions: SecuritySession[];
  sessionCount: number;
  sessionHours: number;
  bootstrap: boolean;
};

type UserSessionSummary = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  enabled: boolean;
  sessionCount: number;
  newestSessionAt: number | null;
};

export default function AdminSecurityPage() {
  const { request, principal, can } = useAdmin();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [users, setUsers] = useState<UserSessionSummary[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<SecurityOverview>("/api/admin/security");
      setOverview(data);
      if (can("users.manage")) {
        const summary = await request<{ users: UserSessionSummary[] }>("/api/admin/security/users");
        setUsers(summary.users);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được trung tâm bảo mật.");
    } finally {
      setLoading(false);
    }
  }, [can, request]);

  useEffect(() => { void load(); }, [load]);

  async function revokeOtherSessions() {
    if (!window.confirm("Thu hồi toàn bộ phiên đăng nhập khác và chỉ giữ phiên hiện tại?")) return;
    setWorking("others");
    setError("");
    setNotice("");
    try {
      const result = await request<{ revoked: number }>("/api/admin/security/sessions/revoke-others", { method: "POST" });
      setNotice(`Đã thu hồi ${result.revoked} phiên khác.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thu hồi được phiên đăng nhập.");
    } finally {
      setWorking("");
    }
  }

  async function revokeSession(session: SecuritySession) {
    if (session.current) return;
    if (!window.confirm("Thu hồi phiên đăng nhập này?")) return;
    setWorking(session.id);
    setError("");
    try {
      await request(`/api/admin/security/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thu hồi được phiên đăng nhập.");
    } finally {
      setWorking("");
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) {
      setError("Mật khẩu mới nhập lại chưa khớp.");
      return;
    }
    if (!window.confirm("Đổi mật khẩu sẽ đăng xuất toàn bộ phiên, gồm cả phiên hiện tại. Tiếp tục?")) return;
    setWorking("password");
    setError("");
    try {
      await request("/api/admin/security/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đổi được mật khẩu.");
      setWorking("");
    }
  }

  async function revokeUserSessions(user: UserSessionSummary) {
    if (!user.sessionCount) return;
    if (!window.confirm(`Thu hồi toàn bộ ${user.sessionCount} phiên của ${user.username}?`)) return;
    setWorking(`user-${user.id}`);
    setError("");
    try {
      const result = await request<{ revoked: number }>(`/api/admin/security/users/${user.id}/revoke-sessions`, { method: "POST" });
      setNotice(`Đã thu hồi ${result.revoked} phiên của ${user.username}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thu hồi được phiên của tài khoản.");
    } finally {
      setWorking("");
    }
  }

  const sessions = overview?.sessions ?? [];
  const otherSessionCount = sessions.filter((item) => !item.current).length;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · SECURITY CENTER</p>
          <h1>Bảo mật tài khoản</h1>
          <p>Quản lý phiên đăng nhập và mật khẩu. ChessApp chỉ lưu hash của session token; trang này không lưu IP, User-Agent hay mật khẩu dạng rõ.</p>
        </div>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Tài khoản</span><strong>{principal.username}</strong><small>{principal.displayName}</small></article>
        <article className={styles.metric}><span>Vai trò</span><strong>{principal.role}</strong><small>{principal.authType === "bootstrap" ? "Owner local dự phòng" : "Tài khoản Nội Các"}</small></article>
        <article className={styles.metric}><span>Phiên hoạt động</span><strong>{overview?.bootstrap ? "—" : overview?.sessionCount ?? "—"}</strong><small>{overview?.bootstrap ? "Owner local không dùng session DB" : `${otherSessionCount} phiên khác`}</small></article>
        <article className={styles.metric}><span>Thời hạn session</span><strong>{overview?.sessionHours ?? "—"}h</strong><small>Cấu hình backend hiện tại</small></article>
      </section>

      {overview?.bootstrap ? (
        <section className={styles.panel}>
          <div className={styles.panelHead}><h2>Owner cục bộ</h2><span>Bootstrap access</span></div>
          <div className={securityStyles.ownerNotice}>
            <strong>Đây là khóa cứu hộ của máy.</strong>
            <p>Owner local dùng trực tiếp <code>CHESSAPP_ADMIN_TOKEN</code>, không tạo session SQLite. Muốn đổi mã, sửa <code>backend/.env</code> rồi khởi động lại backend.</p>
          </div>
        </section>
      ) : (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>Phiên đăng nhập của tôi</h2>
              <button className={styles.button} disabled={!otherSessionCount || working === "others"} onClick={() => void revokeOtherSessions()}>
                {working === "others" ? "Đang thu hồi…" : "Đăng xuất các phiên khác"}
              </button>
            </div>
            <div className={securityStyles.sessionList}>
              {sessions.map((session) => (
                <article className={securityStyles.sessionCard} key={session.id}>
                  <div>
                    <div className={securityStyles.sessionTitle}>
                      <strong>{session.current ? "Phiên hiện tại" : "Phiên đăng nhập"}</strong>
                      {session.current && <span>Đang dùng</span>}
                    </div>
                    <p>Tạo: {formatTime(session.createdAt)} · Hết hạn: {formatTime(session.expiresAt)}</p>
                    <code>{session.id}</code>
                  </div>
                  {!session.current && (
                    <button className={styles.danger} disabled={working === session.id} onClick={() => void revokeSession(session)}>
                      {working === session.id ? "Đang thu hồi…" : "Thu hồi"}
                    </button>
                  )}
                </article>
              ))}
              {!loading && sessions.length === 0 && <div className={styles.empty}>Không tìm thấy session hoạt động.</div>}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Đổi mật khẩu</h2><span>Đăng xuất toàn bộ phiên sau khi đổi</span></div>
            <form className={securityStyles.passwordForm} onSubmit={changePassword}>
              <label>Mật khẩu hiện tại<input className={styles.input} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>Mật khẩu mới<input className={styles.input} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Tối thiểu 10 ký tự" /></label>
              <label>Nhập lại mật khẩu mới<input className={styles.input} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              <button className={styles.button} disabled={working === "password" || !currentPassword || !newPassword || !confirmPassword}>
                {working === "password" ? "Đang đổi…" : "Đổi mật khẩu"}
              </button>
            </form>
          </section>
        </>
      )}

      {can("users.manage") && (
        <section className={styles.panel}>
          <div className={styles.panelHead}><h2>Phiên của toàn bộ tài khoản</h2><span>Owner control</span></div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Tài khoản</th><th>Role</th><th>Trạng thái</th><th>Session</th><th>Phiên mới nhất</th><th></th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td><strong>{user.displayName}</strong><div className={styles.muted}>{user.username}</div></td>
                    <td>{user.role}</td>
                    <td><span className={user.enabled ? styles.badge : `${styles.badge} ${styles.badgeFailed}`}>{user.enabled ? "Đang mở" : "Đã khóa"}</span></td>
                    <td><strong>{user.sessionCount}</strong></td>
                    <td>{formatTime(user.newestSessionAt)}</td>
                    <td><button className={styles.danger} disabled={!user.sessionCount || working === `user-${user.id}`} onClick={() => void revokeUserSessions(user)}>{working === `user-${user.id}` ? "Đang thu hồi…" : "Thu hồi tất cả"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && users.length === 0 && <div className={styles.empty}>Chưa có tài khoản Nội Các.</div>}
        </section>
      )}
    </div>
  );
}
