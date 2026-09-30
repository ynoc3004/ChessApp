"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import { formatTime, type AdminRole, type AdminUser } from "@/lib/adminApi";
import styles from "../admin.module.css";
import userStyles from "./users.module.css";

type UsersResponse = { users: AdminUser[] };
type RolesResponse = { roles: AdminRole[] };

export default function AdminUsersPage() {
  const { request, principal, can } = useAdmin();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("moderator");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("moderator");
  const [editEnabled, setEditEnabled] = useState(true);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [userData, roleData] = await Promise.all([
        request<UsersResponse>("/api/admin/users"),
        request<RolesResponse>("/api/admin/users/roles"),
      ]);
      setUsers(userData.users);
      setRoles(roleData.roles);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được danh sách tài khoản.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    total: users.length,
    enabled: users.filter((user) => user.enabled).length,
    owners: users.filter((user) => user.role === "owner" && user.enabled).length,
    accounts: users.filter((user) => user.authType === "account").length,
  }), [users]);

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !displayName.trim() || password.length < 10) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      await request<AdminUser>("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          displayName: displayName.trim(),
          password,
          role,
        }),
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("moderator");
      setNotice("Đã tạo tài khoản mới.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được tài khoản.");
    } finally {
      setCreating(false);
    }
  }

  function beginEdit(user: AdminUser) {
    if (user.immutable) return;
    setEditingId(user.id);
    setEditName(user.displayName);
    setEditRole(user.role);
    setEditEnabled(user.enabled);
    setError("");
    setNotice("");
  }

  async function saveEdit(user: AdminUser) {
    setError("");
    setNotice("");
    try {
      await request<AdminUser>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editName.trim(), role: editRole, enabled: editEnabled }),
      });
      setEditingId(null);
      setNotice(`Đã cập nhật ${user.username}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không cập nhật được tài khoản.");
    }
  }

  async function submitPasswordReset(event: FormEvent) {
    event.preventDefault();
    if (!resetUser || resetPassword.length < 10) return;
    setError("");
    setNotice("");
    try {
      await request(`/api/admin/users/${encodeURIComponent(resetUser.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      setNotice(`Đã đặt lại mật khẩu cho ${resetUser.username}. Các phiên cũ đã bị thu hồi.`);
      setResetUser(null);
      setResetPassword("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đặt lại được mật khẩu.");
    }
  }

  async function removeUser(user: AdminUser) {
    if (user.immutable || user.id === principal.id) return;
    if (!window.confirm(`Xóa tài khoản ${user.username}? Các phiên đăng nhập của tài khoản này cũng sẽ bị xóa.`)) return;
    setError("");
    setNotice("");
    try {
      await request(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      setNotice(`Đã xóa ${user.username}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không xóa được tài khoản.");
    }
  }

  if (!can("users.manage")) {
    return <div className={styles.error}>Tài khoản hiện tại không có quyền quản lý người dùng.</div>;
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>NỘI CÁC · RBAC</p>
          <h1>Tài khoản & phân quyền</h1>
          <p>Quản lý tài khoản Nội Các theo role. Owner cục bộ dùng CHESSAPP_ADMIN_TOKEN luôn được giữ làm khóa cứu hộ và không thể xóa từ giao diện.</p>
        </div>
        <button className={styles.refresh} disabled={loading} onClick={() => { void load(); }}>↻ Làm mới</button>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Tổng danh tính</span><strong>{stats.total}</strong><small>Gồm owner local + account</small></article>
        <article className={styles.metric}><span>Đang hoạt động</span><strong>{stats.enabled}</strong><small>Tài khoản chưa bị khóa</small></article>
        <article className={styles.metric}><span>Owner hoạt động</span><strong>{stats.owners}</strong><small>Có quyền users.manage</small></article>
        <article className={styles.metric}><span>Account đăng nhập</span><strong>{stats.accounts}</strong><small>Username + password</small></article>
      </section>

      <section className={userStyles.roleGrid}>
        {roles.map((item) => (
          <article className={userStyles.roleCard} key={item.name}>
            <div className={userStyles.roleHead}><strong>{item.name}</strong><span>{item.permissions.length} quyền</span></div>
            <p>{item.description}</p>
            <div className={userStyles.permissionList}>
              {item.permissions.length ? item.permissions.map((permission) => <code key={permission}>{permission}</code>) : <span>Không có quyền Admin</span>}
            </div>
          </article>
        ))}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Tạo tài khoản</h2><span>Mật khẩu tối thiểu 10 ký tự</span></div>
        <form className={userStyles.createForm} onSubmit={createAccount}>
          <label>Tên đăng nhập<input className={styles.input} value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="admin.thanh" /></label>
          <label>Tên hiển thị<input className={styles.input} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Thanh" /></label>
          <label>Mật khẩu<input className={styles.input} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Ít nhất 10 ký tự" /></label>
          <label>Role<select className={styles.select} value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
          <button className={styles.button} disabled={creating || !username.trim() || !displayName.trim() || password.length < 10}>{creating ? "Đang tạo…" : "+ Tạo tài khoản"}</button>
        </form>
      </section>

      <section className={styles.panel} aria-busy={loading}>
        <div className={styles.panelHead}><h2>Danh sách tài khoản</h2><span>{users.length} danh tính</span></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Tài khoản</th><th>Role</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Quyền</th><th>Thao tác</th></tr></thead>
            <tbody>
              {users.map((user) => {
                const editing = editingId === user.id;
                return (
                  <tr key={user.id}>
                    <td>
                      {editing ? <input className={styles.input} value={editName} onChange={(event) => setEditName(event.target.value)} /> : <><strong>{user.displayName}</strong><div className={styles.muted}>{user.username}{user.id === principal.id ? " · bạn" : ""}</div></>}
                    </td>
                    <td>{editing ? <select className={styles.select} value={editRole} onChange={(event) => setEditRole(event.target.value)}>{roles.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select> : <span className={styles.badge}>{user.role}</span>}</td>
                    <td>{editing ? <label className={userStyles.toggle}><input type="checkbox" checked={editEnabled} onChange={(event) => setEditEnabled(event.target.checked)} /> Hoạt động</label> : <span className={user.enabled ? styles.badge : `${styles.badge} ${styles.badgeFailed}`}>{user.enabled ? "Hoạt động" : "Đã khóa"}</span>}</td>
                    <td>{user.authType === "bootstrap" ? <span className={styles.muted}>Owner local</span> : formatTime(user.lastLoginAt)}</td>
                    <td><span className={styles.muted}>{user.permissions.length} quyền</span></td>
                    <td>
                      <div className={styles.actions}>
                        {editing ? <><button className={styles.button} onClick={() => { void saveEdit(user); }}>Lưu</button><button className={styles.button} onClick={() => setEditingId(null)}>Hủy</button></> : <button className={styles.button} disabled={user.immutable} onClick={() => beginEdit(user)}>Sửa</button>}
                        <button className={styles.button} disabled={user.immutable} onClick={() => { setResetUser(user); setResetPassword(""); }}>Đặt mật khẩu</button>
                        <button className={styles.danger} disabled={user.immutable || user.id === principal.id} onClick={() => { void removeUser(user); }}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && users.length === 0 && <div className={styles.empty}>Chưa có tài khoản.</div>}
      </section>

      {resetUser && (
        <section className={styles.panel}>
          <div className={styles.panelHead}><h2>Đặt lại mật khẩu</h2><button className={styles.button} onClick={() => { setResetUser(null); setResetPassword(""); }}>Đóng</button></div>
          <form className={userStyles.resetForm} onSubmit={submitPasswordReset}>
            <div><strong>{resetUser.displayName}</strong><div className={styles.muted}>{resetUser.username} · {resetUser.role}</div></div>
            <label>Mật khẩu mới<input className={styles.input} type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Tối thiểu 10 ký tự" autoFocus /></label>
            <button className={styles.button} disabled={resetPassword.length < 10}>Đổi mật khẩu & thu hồi phiên cũ</button>
          </form>
        </section>
      )}
    </div>
  );
}
