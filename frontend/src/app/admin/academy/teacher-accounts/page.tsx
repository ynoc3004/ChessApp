"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import styles from "../../admin.module.css";

type Teacher = { id: string; displayName: string; active: boolean; aiProfileId?: string | null };
type Account = {
  teacherId: string; displayName: string; username: string; enabled: boolean;
  teacherActive: boolean; aiProfileId?: string | null; lastLoginAt?: number | null;
};

export default function TeacherAccountsAdminPage() {
  const { request } = useAdmin();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [teacherData, accountData] = await Promise.all([
        request<{ teachers: Teacher[] }>("/api/admin/academy/teachers"),
        request<{ accounts: Account[] }>("/api/admin/academy/teacher-accounts"),
      ]);
      setTeachers(teacherData.teachers);
      setAccounts(accountData.accounts);
      if (!teacherId) {
        const used = new Set(accountData.accounts.map(item => item.teacherId));
        setTeacherId(teacherData.teachers.find(item => item.active && !used.has(item.id))?.id || "");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được tài khoản giáo viên.");
    }
  }, [request, teacherId]);

  useEffect(() => { void load(); }, [load]);

  const available = useMemo(() => {
    const used = new Set(accounts.map(item => item.teacherId));
    return teachers.filter(item => item.active && !used.has(item.id));
  }, [teachers, accounts]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!teacherId || !username.trim() || password.length < 10) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      await request("/api/admin/academy/teacher-accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId, username: username.trim(), password }),
      });
      setUsername(""); setPassword(""); setTeacherId("");
      setNotice("Đã cấp tài khoản Teacher Portal.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không cấp được tài khoản.");
    } finally { setBusy(""); }
  }

  async function patch(teacherIdValue: string, payload: Record<string, unknown>, message: string) {
    setBusy(teacherIdValue); setError(""); setNotice("");
    try {
      await request(`/api/admin/academy/teacher-accounts/${teacherIdValue}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      setNotice(message); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không cập nhật được tài khoản.");
    } finally { setBusy(""); }
  }

  async function resetPassword(account: Account) {
    const value = window.prompt(`Mật khẩu mới cho ${account.displayName} (ít nhất 10 ký tự):`);
    if (!value) return;
    if (value.length < 10) { setError("Mật khẩu phải có ít nhất 10 ký tự."); return; }
    await patch(account.teacherId, { password: value }, "Đã đổi mật khẩu và đăng xuất toàn bộ phiên cũ.");
  }

  return <div className={styles.page}>
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>ACADEMY V6 · TEACHER AUTH</p><h1>Tài Khoản Giáo Viên</h1><p>Cấp quyền Teacher Portal riêng. Giáo viên không cần dùng tài khoản Nội Các/Admin.</p></div>
      <button className={styles.refresh} onClick={() => void load()}>↻ Làm mới</button>
    </section>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}

    <section className={styles.grid}>
      <article className={styles.metric}><span>Giáo viên</span><strong>{teachers.filter(x => x.active).length}</strong><small>đang hoạt động</small></article>
      <article className={styles.metric}><span>Có Portal</span><strong>{accounts.length}</strong><small>đã được cấp tài khoản</small></article>
      <article className={styles.metric}><span>Đang bật</span><strong>{accounts.filter(x => x.enabled && x.teacherActive).length}</strong><small>có thể đăng nhập</small></article>
      <article className={styles.metric}><span>Chưa cấp</span><strong>{available.length}</strong><small>giáo viên còn thiếu tài khoản</small></article>
    </section>

    <form className={styles.panel} onSubmit={create}>
      <div className={styles.panelHead}><div><h2>Cấp tài khoản mới</h2><span>Session giáo viên tách hoàn toàn khỏi Admin và Đệ Tử.</span></div></div>
      <div className={styles.toolbar}>
        <label>Giáo viên<select className={styles.select} value={teacherId} onChange={e => setTeacherId(e.target.value)}><option value="">Chọn giáo viên</option>{available.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <label>Tên đăng nhập<input className={styles.input} value={username} onChange={e => setUsername(e.target.value)} placeholder="teacher.nguyen" /></label>
        <label>Mật khẩu<input className={styles.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Ít nhất 10 ký tự" /></label>
        <button className={styles.button} disabled={Boolean(busy) || !teacherId || !username.trim() || password.length < 10}>Cấp tài khoản</button>
      </div>
    </form>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>Teacher Portal</h2><span>Đăng nhập tại /teacher</span></div></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Giáo viên</th><th>Username</th><th>AI Profile</th><th>Đăng nhập cuối</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        {accounts.map(account => <tr key={account.teacherId}>
          <td><strong>{account.displayName}</strong></td>
          <td><code>{account.username}</code></td>
          <td>{account.aiProfileId || "—"}</td>
          <td>{account.lastLoginAt ? new Date(account.lastLoginAt * 1000).toLocaleString("vi-VN") : "Chưa đăng nhập"}</td>
          <td><span className={account.enabled && account.teacherActive ? styles.badge : styles.badgeFailed}>{account.enabled && account.teacherActive ? "Hoạt động" : "Đã khóa"}</span></td>
          <td><div className={styles.actions}><button className={styles.button} disabled={Boolean(busy)} onClick={() => void resetPassword(account)}>Đổi mật khẩu</button><button className={account.enabled ? styles.danger : styles.button} disabled={Boolean(busy)} onClick={() => void patch(account.teacherId, { enabled: !account.enabled }, account.enabled ? "Đã khóa tài khoản và thu hồi phiên." : "Đã mở lại tài khoản.")}>{account.enabled ? "Khóa" : "Mở"}</button></div></td>
        </tr>)}
        {!accounts.length && <tr><td colSpan={6} className={styles.empty}>Chưa giáo viên nào có tài khoản Portal.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
