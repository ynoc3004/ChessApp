"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./teacher.module.css";

const TOKEN_KEY = "chessapp:teacher-token";

type Teacher = { teacherId: string; displayName: string; username: string; aiProfileId?: string | null };
type ClassItem = { id: string; name: string; stepMin: number; stepMax: number; studentCount: number };
type Student = {
  id: string; displayName: string; currentStep?: number | null; puzzleRating: number; xp: number;
  class: { id: string; name: string }; training: { last7Days: number; cleanRate?: number | null };
  review: { due: number }; weakestSkill?: { skill: string; mastery: number } | null;
  needsAttention: boolean; attentionReasons: string[];
};
type Assignment = { id: string; title: string; targetName?: string | null; puzzleCount: number; completedCount?: number; active: boolean; dueAt?: number | null };
type Dashboard = {
  teacher: { id: string; displayName: string; bio: string; aiProfileId?: string | null };
  classes: ClassItem[]; students: Student[]; assignments: Assignment[];
  summary: { classes: number; students: number; needAttention: number; activeAssignments: number; overdueTargets: number; last7DaysAttempts: number };
};
type Tournament = { id: string; title: string; status: string; className?: string | null; playerCount: number; currentRound: number; rounds: number };

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { detail?: string }).detail || `HTTP ${response.status}`);
  return data as T;
}

export default function TeacherPortalPage() {
  const [token, setToken] = useState("");
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [targetType, setTargetType] = useState<"class" | "student">("class");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState("");
  const [ratingMin, setRatingMin] = useState("800");
  const [ratingMax, setRatingMax] = useState("1600");
  const [puzzleCount, setPuzzleCount] = useState("10");
  const [dueAt, setDueAt] = useState("");

  const load = useCallback(async (activeToken: string) => {
    try {
      const [me, dash, tourneys] = await Promise.all([
        api<Teacher>("/api/teacher/me", activeToken),
        api<Dashboard>("/api/teacher/dashboard", activeToken),
        api<{ tournaments: Tournament[] }>("/api/teacher/tournaments", activeToken),
      ]);
      setTeacher(me); setDashboard(dash); setTournaments(tourneys.tournaments); setError("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Không tải được Teacher Portal.";
      setError(message);
      if (/phiên|401|đăng nhập/i.test(message)) {
        window.sessionStorage.removeItem(TOKEN_KEY); setToken(""); setTeacher(null); setDashboard(null);
      }
    }
  }, []);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (saved) { setToken(saved); void load(saved); }
  }, [load]);

  useEffect(() => {
    if (!dashboard) return;
    const options = targetType === "class" ? dashboard.classes : dashboard.students;
    if (!options.some(item => item.id === targetId)) setTargetId(options[0]?.id || "");
  }, [dashboard, targetType, targetId]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy("login"); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/teacher/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json() as { token?: string; teacher?: Teacher; detail?: string };
      if (!response.ok || !data.token) throw new Error(data.detail || "Đăng nhập thất bại.");
      window.sessionStorage.setItem(TOKEN_KEY, data.token); setToken(data.token); setTeacher(data.teacher || null);
      setPassword(""); await load(data.token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Đăng nhập thất bại."); }
    finally { setBusy(""); }
  }

  async function logout() {
    if (token) await api("/api/teacher/auth/logout", token, { method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem(TOKEN_KEY); setToken(""); setTeacher(null); setDashboard(null); setTournaments([]);
  }

  async function createAssignment(event: FormEvent) {
    event.preventDefault(); if (!token || !targetId || !title.trim()) return;
    setBusy("assignment"); setError(""); setNotice("");
    try {
      await api("/api/teacher/assignments", token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType, targetId, title: title.trim(), description: description.trim(), theme: theme.trim() || null,
          ratingMin: Number(ratingMin), ratingMax: Number(ratingMax), puzzleCount: Number(puzzleCount),
          dueAt: dueAt ? new Date(dueAt).getTime() / 1000 : null,
        }),
      });
      setTitle(""); setDescription(""); setTheme(""); setDueAt(""); setNotice("Đã giao bài."); await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không giao được bài."); }
    finally { setBusy(""); }
  }

  const relatedTournaments = useMemo(() => tournaments.filter(item => item.status !== "cancelled"), [tournaments]);

  if (!token || !teacher || !dashboard) {
    return <main className={styles.page}><section className={styles.login}>
      <p className={styles.eyebrow}>KỲ PHỔ ĐẠO CÁC · TEACHER PORTAL</p><h1>Giáo Viên Đăng Nhập</h1><p>Dùng tài khoản do Nội Các cấp. Tài khoản này không có quyền Admin.</p>
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={login}><label>Tên đăng nhập<input className={styles.input} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label><label>Mật khẩu<input className={styles.input} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label><button className={styles.button} disabled={busy === "login" || !username.trim() || !password}>{busy === "login" ? "Đang vào..." : "Nhập Sư Môn"}</button></form>
    </section></main>;
  }

  return <main className={styles.page}><div className={styles.shell}>
    <section className={styles.hero}><div><p className={styles.eyebrow}>ACADEMY V6 · TEACHER PORTAL</p><h1>{dashboard.teacher.displayName}</h1><p>{dashboard.teacher.bio || "Dashboard lớp học, bài tập và dữ liệu tiến bộ của đệ tử."}</p></div><div className={styles.actions}><button className={styles.ghost} onClick={() => void load(token)}>↻ Làm mới</button><button className={styles.ghost} onClick={() => void logout()}>Đăng xuất</button></div></section>
    {error && <div className={styles.error}>{error}</div>}{notice && <div className={styles.notice}>{notice}</div>}
    <section className={styles.metrics}><article className={styles.metric}><span>Lớp</span><strong>{dashboard.summary.classes}</strong></article><article className={styles.metric}><span>Đệ tử</span><strong>{dashboard.summary.students}</strong></article><article className={styles.metric}><span>Cần chú ý</span><strong>{dashboard.summary.needAttention}</strong></article><article className={styles.metric}><span>Bài đang giao</span><strong>{dashboard.summary.activeAssignments}</strong></article><article className={styles.metric}><span>Lượt luyện 7 ngày</span><strong>{dashboard.summary.last7DaysAttempts}</strong></article></section>

    <section className={styles.grid}><div className={styles.panel}><h2>Đệ tử đang phụ trách</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Đệ tử</th><th>Lớp</th><th>Step</th><th>Puzzle</th><th>7 ngày</th><th>Điểm yếu</th><th>Tình trạng</th></tr></thead><tbody>{dashboard.students.map(student => <tr key={student.id}><td><Link href={`/teacher/students/${student.id}`}><strong>{student.displayName}</strong></Link></td><td>{student.class.name}</td><td>{student.currentStep ?? "—"}</td><td>{student.puzzleRating}</td><td>{student.training.last7Days}</td><td>{student.weakestSkill ? `${student.weakestSkill.skill} · ${Math.round(student.weakestSkill.mastery)}%` : "—"}</td><td>{student.needsAttention ? <span className={styles.warn}>{student.attentionReasons[0]}</span> : <span className={styles.badge}>Ổn định</span>}</td></tr>)}</tbody></table></div></div>
      <div className={styles.panel}><h2>AI Giáo Viên</h2><div className={styles.card}><strong>{dashboard.teacher.aiProfileId ? "Đã có AI Profile" : "Chưa gắn AI Profile"}</strong><span>{dashboard.teacher.aiProfileId || "Khi chatbot của giáo viên được cung cấp, profile này sẽ là điểm nối vào Teacher Portal."}</span></div><h2 style={{marginTop:18}}>Lớp phụ trách</h2><div className={styles.cards}>{dashboard.classes.map(item => <div className={styles.card} key={item.id}><strong>{item.name}</strong><span>Step {item.stepMin}–{item.stepMax} · {item.studentCount} đệ tử</span></div>)}</div></div>
    </section>

    <section className={styles.grid}><form className={styles.panel} onSubmit={createAssignment}><h2>Giao bài mới</h2><div className={styles.form}><div className={styles.two}><label>Đối tượng<select className={styles.select} value={targetType} onChange={e => setTargetType(e.target.value as "class" | "student")}><option value="class">Cả lớp</option><option value="student">Một đệ tử</option></select></label><label>Chọn<select className={styles.select} value={targetId} onChange={e => setTargetId(e.target.value)}>{(targetType === "class" ? dashboard.classes : dashboard.students).map(item => <option key={item.id} value={item.id}>{"name" in item ? item.name : item.displayName}</option>)}</select></label></div><label>Tên bài<input className={styles.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Đòn đôi · Tuần 4" /></label><label>Ghi chú<textarea className={styles.textarea} value={description} onChange={e => setDescription(e.target.value)} /></label><div className={styles.two}><label>Lichess theme<input className={styles.input} value={theme} onChange={e => setTheme(e.target.value)} placeholder="fork" /></label><label>Số puzzle<input className={styles.input} type="number" min="1" max="50" value={puzzleCount} onChange={e => setPuzzleCount(e.target.value)} /></label></div><div className={styles.two}><label>Rating từ<input className={styles.input} type="number" value={ratingMin} onChange={e => setRatingMin(e.target.value)} /></label><label>Rating đến<input className={styles.input} type="number" value={ratingMax} onChange={e => setRatingMax(e.target.value)} /></label></div><label>Deadline<input className={styles.input} type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} /></label><button className={styles.button} disabled={busy === "assignment" || !targetId || !title.trim()}>Giao bài</button></div></form>
      <section className={styles.panel}><h2>Bài đã giao</h2><div className={styles.cards}>{dashboard.assignments.slice(0,8).map(item => <div className={styles.card} key={item.id}><strong>{item.title}</strong><span>{item.targetName || "—"} · {item.completedCount || 0} hoàn thành · {item.puzzleCount} puzzle</span></div>)}{!dashboard.assignments.length && <div className={styles.muted}>Chưa có bài tập.</div>}</div></section>
    </section>

    <section className={styles.panel}><h2>Giải đấu liên quan</h2><div className={styles.cards}>{relatedTournaments.slice(0,8).map(item => <div className={styles.card} key={item.id}><strong>{item.title}</strong><span>{item.className || "Toàn Học Viện"} · {item.status} · {item.playerCount} người · vòng {item.currentRound}/{item.rounds}</span></div>)}{!relatedTournaments.length && <div className={styles.muted}>Chưa có giải liên quan.</div>}</div></section>
  </div></main>;
}
