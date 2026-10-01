"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import admin from "../../admin.module.css";
import styles from "./teacher.module.css";

type Teacher = { id: string; displayName: string; bio: string; aiProfileId?: string | null; active: boolean };
type AcademyClass = { id: string; name: string; stepMin: number; stepMax: number; studentCount: number };
type WeakSkill = { skill: string; mastery: number; themeLabel?: string } | null;
type TeacherStudent = {
  id: string;
  displayName: string;
  username: string;
  currentStep: number | null;
  placementStatus: string;
  xp: number;
  puzzleRating: number;
  class: { id: string; name: string; stepMin: number; stepMax: number };
  training: { attempts: number; clean: number; cleanRate?: number | null; last7Days: number };
  review: { due: number; total: number };
  weakestSkill: WeakSkill;
  needsAttention: boolean;
  attentionReasons: string[];
};
type Assignment = {
  id: string;
  title: string;
  description: string;
  targetType: "class" | "student";
  targetId: string;
  targetName?: string | null;
  theme?: string | null;
  themeLabel: string;
  ratingMin: number;
  ratingMax: number;
  puzzleCount: number;
  dueAt?: number | null;
  active: boolean;
  targetCount: number;
  completedCount: number;
  completionPercent: number;
  totalAttempts: number;
  totalClean: number;
};
type Dashboard = {
  teacher: { id: string; displayName: string; bio: string; aiProfileId?: string | null };
  classes: AcademyClass[];
  students: TeacherStudent[];
  assignments: Assignment[];
  summary: { classes: number; students: number; needAttention: number; activeAssignments: number; overdueTargets: number; last7DaysAttempts: number };
};

const THEMES = [
  ["", "Tổng hợp"], ["fork", "Đòn đôi"], ["pin", "Ghim quân"], ["skewer", "Xiên quân"],
  ["mate", "Chiếu hết"], ["discoveredAttack", "Tấn công mở"], ["defensiveMove", "Phòng thủ"],
  ["quietMove", "Nước đi yên lặng"], ["hangingPiece", "Quân treo"], ["endgame", "Tàn cuộc"],
] as const;

function dateTimeLocalToEpoch(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() / 1000 : null;
}

function dueLabel(value?: number | null) {
  if (!value) return "Không hạn";
  return new Date(value * 1000).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export default function TeacherDashboardPage() {
  const { request } = useAdmin();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const [targetType, setTargetType] = useState<"class" | "student">("class");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState("");
  const [ratingMin, setRatingMin] = useState("800");
  const [ratingMax, setRatingMax] = useState("1600");
  const [puzzleCount, setPuzzleCount] = useState("10");
  const [dueAt, setDueAt] = useState("");

  const loadTeachers = useCallback(async () => {
    const data = await request<{ teachers: Teacher[] }>("/api/admin/academy/teachers");
    const active = data.teachers.filter((item) => item.active);
    setTeachers(active);
    setTeacherId((current) => current || active[0]?.id || "");
    return active;
  }, [request]);

  const loadDashboard = useCallback(async (candidate: string) => {
    if (!candidate) { setDashboard(null); return; }
    const data = await request<Dashboard>(`/api/admin/academy/teacher/dashboard?teacherId=${encodeURIComponent(candidate)}`);
    setDashboard(data);
  }, [request]);

  useEffect(() => {
    setLoading(true); setError("");
    void loadTeachers()
      .then((list) => list[0] ? loadDashboard(list[0].id) : undefined)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Không tải được dashboard giáo viên."))
      .finally(() => setLoading(false));
  }, [loadDashboard, loadTeachers]);

  useEffect(() => {
    if (!teacherId || loading) return;
    setLoading(true); setError("");
    void loadDashboard(teacherId)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Không tải được dashboard giáo viên."))
      .finally(() => setLoading(false));
  }, [teacherId, loadDashboard]);

  const targetOptions = useMemo(() => {
    if (!dashboard) return [];
    return targetType === "class"
      ? dashboard.classes.map((item) => ({ id: item.id, label: `${item.name} · ${item.studentCount} đệ tử` }))
      : dashboard.students.map((item) => ({ id: item.id, label: `${item.displayName} · ${item.class.name}` }));
  }, [dashboard, targetType]);

  useEffect(() => {
    if (!targetOptions.some((item) => item.id === targetId)) setTargetId(targetOptions[0]?.id || "");
  }, [targetOptions, targetId]);

  const students = useMemo(() => {
    const list = dashboard?.students ?? [];
    const filtered = attentionOnly ? list.filter((item) => item.needsAttention) : list;
    return [...filtered].sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.class.name.localeCompare(b.class.name) || a.displayName.localeCompare(b.displayName));
  }, [attentionOnly, dashboard]);

  async function createAssignment(event: FormEvent) {
    event.preventDefault();
    if (!teacherId || !targetId || !title.trim()) return;
    setBusy("assignment"); setError(""); setNotice("");
    try {
      await request("/api/admin/academy/teacher/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          targetType,
          targetId,
          title: title.trim(),
          description: description.trim(),
          theme: theme || null,
          ratingMin: Number(ratingMin),
          ratingMax: Number(ratingMax),
          puzzleCount: Number(puzzleCount),
          dueAt: dateTimeLocalToEpoch(dueAt),
        }),
      });
      setTitle(""); setDescription(""); setDueAt("");
      setNotice("Đã giao bài. Danh sách đệ tử của lớp được chụp tại thời điểm giao để theo dõi tiến độ ổn định.");
      await loadDashboard(teacherId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không giao được bài.");
    } finally {
      setBusy("");
    }
  }

  async function closeAssignment(id: string) {
    if (!window.confirm("Đóng bài tập này? Đệ tử sẽ không thể mở lượt mới.")) return;
    setBusy(id); setError("");
    try {
      await request(`/api/admin/academy/teacher/assignments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      await loadDashboard(teacherId);
      setNotice("Đã đóng bài tập.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đóng được bài tập.");
    } finally { setBusy(""); }
  }

  return (
    <div className={admin.page}>
      <section className={admin.hero}>
        <div>
          <p className={admin.eyebrow}>ACADEMY V3 · GIÁO VIÊN</p>
          <h1>Dashboard Giáo Viên</h1>
          <p>Xem tình hình lớp, nhận diện đệ tử cần chú ý, giao Bí Cảnh có mục tiêu và theo dõi hoàn thành.</p>
        </div>
        <div className={styles.teacherPicker}>
          <label>Giáo viên<select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>{teachers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          <button className={admin.refresh} disabled={loading || !teacherId} onClick={() => void loadDashboard(teacherId)}>↻ Làm mới</button>
        </div>
      </section>

      {error && <div className={admin.error}>{error}</div>}
      {notice && <div className={admin.notice}>{notice}</div>}
      {!teachers.length && !loading && <div className={admin.notice}>Chưa có giáo viên. Hãy tạo hồ sơ ở mục Quản lý Học Viện trước.</div>}

      {dashboard && <>
        <section className={admin.grid}>
          <article className={admin.metric}><span>Đệ tử</span><strong>{dashboard.summary.students}</strong><small>{dashboard.summary.classes} lớp phụ trách</small></article>
          <article className={admin.metric}><span>Cần chú ý</span><strong>{dashboard.summary.needAttention}</strong><small>từ dữ liệu học 7 ngày + Sổ Sai Lầm</small></article>
          <article className={admin.metric}><span>Bài đang giao</span><strong>{dashboard.summary.activeAssignments}</strong><small>{dashboard.summary.overdueTargets} lượt quá hạn</small></article>
          <article className={admin.metric}><span>Lượt luyện 7 ngày</span><strong>{dashboard.summary.last7DaysAttempts}</strong><small>toàn bộ đệ tử của giáo viên</small></article>
        </section>

        <section className={styles.teacherCard}>
          <div><p className={admin.eyebrow}>SƯ MÔN</p><h2>{dashboard.teacher.displayName}</h2><p>{dashboard.teacher.bio || "Chưa có giới thiệu giáo viên."}</p></div>
          <div className={styles.classChips}>{dashboard.classes.map((item) => <span key={item.id}><strong>{item.name}</strong><small>Step {item.stepMin}{item.stepMax !== item.stepMin ? `–${item.stepMax}` : ""} · {item.studentCount} đệ tử</small></span>)}</div>
        </section>

        <section className={styles.assignmentGrid}>
          <form className={styles.assignmentForm} onSubmit={createAssignment}>
            <p className={admin.eyebrow}>GIAO BÀI</p><h2>Tạo Bí Cảnh bắt buộc</h2>
            <div className={styles.twoCols}>
              <label>Đối tượng<select value={targetType} onChange={(e) => setTargetType(e.target.value as "class" | "student")}><option value="class">Cả lớp</option><option value="student">Một đệ tử</option></select></label>
              <label>Chọn {targetType === "class" ? "lớp" : "đệ tử"}<select value={targetId} onChange={(e) => setTargetId(e.target.value)}>{targetOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            </div>
            <label>Tên bài<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Đòn đôi · Tuần 1" /></label>
            <label>Ghi chú<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Hoàn thành trước buổi học tiếp theo..." /></label>
            <div className={styles.twoCols}>
              <label>Chủ đề<select value={theme} onChange={(e) => setTheme(e.target.value)}>{THEMES.map(([value, label]) => <option key={value || "mixed"} value={value}>{label}</option>)}</select></label>
              <label>Số puzzle<input type="number" min="1" max="50" value={puzzleCount} onChange={(e) => setPuzzleCount(e.target.value)} /></label>
            </div>
            <div className={styles.threeCols}>
              <label>Rating từ<input type="number" min="400" max="3000" value={ratingMin} onChange={(e) => setRatingMin(e.target.value)} /></label>
              <label>đến<input type="number" min="400" max="3000" value={ratingMax} onChange={(e) => setRatingMax(e.target.value)} /></label>
              <label>Hạn bài<input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
            </div>
            <button disabled={Boolean(busy) || !targetId || !title.trim()}>{busy === "assignment" ? "Đang giao…" : "Giao bài →"}</button>
          </form>

          <div className={styles.assignmentList}>
            <div className={styles.sectionHead}><div><p className={admin.eyebrow}>TIẾN ĐỘ BÀI TẬP</p><h2>Đã giao</h2></div><span>{dashboard.assignments.length} bài</span></div>
            {dashboard.assignments.length === 0 ? <p className={styles.empty}>Chưa giao bài nào.</p> : dashboard.assignments.map((item) => <article key={item.id} data-active={item.active}>
              <div className={styles.assignmentTitle}><div><strong>{item.title}</strong><small>{item.targetName} · {item.themeLabel} · {item.ratingMin}–{item.ratingMax}</small></div><span>{item.completedCount}/{item.targetCount}</span></div>
              <div className={styles.progress}><span style={{ width: `${item.completionPercent}%` }} /></div>
              <p>{item.description || `${item.puzzleCount} puzzle · hạn ${dueLabel(item.dueAt)}`}</p>
              <div className={styles.assignmentMeta}><span>{item.puzzleCount} puzzle/người</span><span>{item.totalAttempts} lượt hoàn thành</span><span>Hạn: {dueLabel(item.dueAt)}</span></div>
              {item.active && <button disabled={busy === item.id} onClick={() => void closeAssignment(item.id)}>Đóng bài</button>}
            </article>)}
          </div>
        </section>

        <section className={admin.panel}>
          <div className={styles.sectionHead}><div><h2>Tình hình đệ tử</h2><p>“Cần chú ý” là tín hiệu vận hành từ dữ liệu học, không phải đánh giá năng lực tổng thể.</p></div><label className={styles.check}><input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} /> Chỉ hiện cần chú ý</label></div>
          <div className={admin.tableWrap}><table className={admin.table}><thead><tr><th>Đệ tử</th><th>Step / Rating</th><th>7 ngày</th><th>Điểm yếu</th><th>Sổ Sai Lầm</th><th>Tín hiệu</th></tr></thead><tbody>{students.map((student) => <tr key={student.id}>
            <td><strong>{student.displayName}</strong><br /><small>{student.class.name} · @{student.username}</small></td>
            <td>Step {student.currentStep ?? "—"}<br /><small>Puzzle {student.puzzleRating} · Tu Vi {student.xp.toLocaleString("vi-VN")}</small></td>
            <td><strong>{student.training.last7Days}</strong> lượt<br /><small>Clean {student.training.cleanRate == null ? "—" : `${student.training.cleanRate.toFixed(0)}%`}</small></td>
            <td>{student.weakestSkill ? <><strong>{student.weakestSkill.skill}</strong><br /><small>{student.weakestSkill.mastery.toFixed(0)}% mastery</small></> : "Chưa đủ dữ liệu"}</td>
            <td>{student.review.due} đến hạn<br /><small>{student.review.total} đang theo dõi</small></td>
            <td>{student.needsAttention ? <div className={styles.reasons}>{student.attentionReasons.map((reason) => <span key={reason}>{reason}</span>)}</div> : <span className={styles.ok}>Ổn định</span>}</td>
          </tr>)}</tbody></table></div>
        </section>
      </>}
    </div>
  );
}
