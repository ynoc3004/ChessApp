"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import styles from "../admin.module.css";
import academy from "./academy.module.css";

type Overview = {
  students: number;
  activeStudents: number;
  teachers: number;
  classes: number;
  pendingPlacement: number;
  placementQuestions: number;
};

type Teacher = { id: string; displayName: string; bio: string; aiProfileId?: string | null; active: boolean };
type AcademyClass = { id: string; name: string; stepMin: number; stepMax: number; teacherId: string; teacherName?: string | null; studentCount: number; active: boolean };
type Enrollment = { class: { id: string; name: string }; teacher: { displayName: string } } | null;
type Student = { id: string; username: string; displayName: string; enabled: boolean; currentStep?: number | null; placementStatus: string; xp: number; puzzleRating: number; enrollment?: Enrollment };
type PlacementQuestion = { id: string; step: number; skill: string; prompt: string; options: string[]; correctIndex: number; explanation: string; active: boolean };

export default function AcademyAdminPage() {
  const { request } = useAdmin();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classes, setClasses] = useState<AcademyClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [teacherName, setTeacherName] = useState("");
  const [teacherBio, setTeacherBio] = useState("");
  const [teacherAi, setTeacherAi] = useState("");

  const [className, setClassName] = useState("");
  const [classStepMin, setClassStepMin] = useState("1");
  const [classStepMax, setClassStepMax] = useState("1");
  const [classTeacher, setClassTeacher] = useState("");

  const [studentUsername, setStudentUsername] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [studentClass, setStudentClass] = useState("");

  const [qStep, setQStep] = useState("1");
  const [qSkill, setQSkill] = useState("");
  const [qPrompt, setQPrompt] = useState("");
  const [qOptions, setQOptions] = useState("\n\n");
  const [qCorrect, setQCorrect] = useState("0");
  const [qExplanation, setQExplanation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summary, teacherData, classData, studentData, questionData] = await Promise.all([
        request<Overview>("/api/admin/academy/overview"),
        request<{ teachers: Teacher[] }>("/api/admin/academy/teachers"),
        request<{ classes: AcademyClass[] }>("/api/admin/academy/classes"),
        request<{ students: Student[] }>("/api/admin/academy/students"),
        request<{ questions: PlacementQuestion[] }>("/api/admin/academy/placement/questions"),
      ]);
      setOverview(summary);
      setTeachers(teacherData.teachers);
      setClasses(classData.classes);
      setStudents(studentData.students);
      setQuestions(questionData.questions);
      if (!classTeacher && teacherData.teachers[0]) setClassTeacher(teacherData.teachers[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được Học Viện.");
    } finally {
      setLoading(false);
    }
  }, [classTeacher, request]);

  useEffect(() => { void load(); }, [load]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key); setError(""); setNotice("");
    try { await task(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Thao tác thất bại."); }
    finally { setBusy(""); }
  }

  async function addTeacher(event: FormEvent) {
    event.preventDefault();
    if (!teacherName.trim()) return;
    await run("teacher", async () => {
      await request("/api/admin/academy/teachers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: teacherName.trim(), bio: teacherBio.trim(), aiProfileId: teacherAi.trim() || null }) });
      setTeacherName(""); setTeacherBio(""); setTeacherAi(""); setNotice("Đã tạo hồ sơ giáo viên.");
    });
  }

  async function addClass(event: FormEvent) {
    event.preventDefault();
    if (!className.trim() || !classTeacher) return;
    await run("class", async () => {
      await request("/api/admin/academy/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: className.trim(), stepMin: Number(classStepMin), stepMax: Number(classStepMax), teacherId: classTeacher }) });
      setClassName(""); setNotice("Đã mở lớp mới.");
    });
  }

  async function addStudent(event: FormEvent) {
    event.preventDefault();
    if (!studentUsername.trim() || !studentName.trim() || !studentPassword) return;
    await run("student", async () => {
      await request("/api/admin/academy/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: studentUsername.trim(), displayName: studentName.trim(), password: studentPassword, classId: studentClass || null }) });
      setStudentUsername(""); setStudentName(""); setStudentPassword(""); setStudentClass(""); setNotice("Đã cấp tài khoản đệ tử.");
    });
  }

  async function assign(studentId: string, classId: string) {
    if (!classId) return;
    await run(`assign:${studentId}`, async () => {
      await request(`/api/admin/academy/students/${studentId}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classId }) });
      setNotice("Đã chuyển/xếp lớp cho đệ tử.");
    });
  }

  async function addQuestion(event: FormEvent) {
    event.preventDefault();
    const options = qOptions.split("\n").map((item) => item.trim()).filter(Boolean);
    if (!qSkill.trim() || !qPrompt.trim() || options.length < 2) return;
    await run("question", async () => {
      await request("/api/admin/academy/placement/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: Number(qStep), skill: qSkill.trim(), prompt: qPrompt.trim(), options, correctIndex: Number(qCorrect), explanation: qExplanation.trim() }) });
      setQPrompt(""); setQOptions("\n\n"); setQCorrect("0"); setQExplanation(""); setNotice("Đã thêm câu hỏi vào ngân hàng khảo thí.");
    });
  }

  const activeClasses = useMemo(() => classes.filter((item) => item.active), [classes]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>NỘI CÁC · ACADEMY V1</p><h1>Học Viện Đệ Tử</h1><p>Cấp tài khoản, xếp lớp, gắn giáo viên và xây ngân hàng Khảo Thí Nhập Môn theo Step by Step.</p></div>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()}>↻ Làm mới</button>
      </section>
      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.grid}>
        <article className={styles.metric}><span>Đệ tử</span><strong>{overview?.students ?? 0}</strong><small>{overview?.activeStudents ?? 0} đang hoạt động</small></article>
        <article className={styles.metric}><span>Giáo viên</span><strong>{overview?.teachers ?? 0}</strong><small>hồ sơ đang hoạt động</small></article>
        <article className={styles.metric}><span>Lớp</span><strong>{overview?.classes ?? 0}</strong><small>đang mở</small></article>
        <article className={styles.metric}><span>Chờ khảo thí</span><strong>{overview?.pendingPlacement ?? 0}</strong><small>{overview?.placementQuestions ?? 0} câu hỏi đang dùng</small></article>
      </section>

      <section className={academy.forms}>
        <form className={academy.formCard} onSubmit={addTeacher}><p className={styles.eyebrow}>01 · GIÁO VIÊN</p><h2>Tạo hồ sơ giáo viên</h2><label>Tên hiển thị<input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="Sư phụ Nguyễn..." /></label><label>Giới thiệu<textarea value={teacherBio} onChange={(e) => setTeacherBio(e.target.value)} placeholder="HLV phụ trách Step 4..." /></label><label>AI Profile ID (để trống hiện tại)<input value={teacherAi} onChange={(e) => setTeacherAi(e.target.value)} placeholder="teacher-ai-profile" /></label><button disabled={Boolean(busy)}>Tạo giáo viên</button></form>
        <form className={academy.formCard} onSubmit={addClass}><p className={styles.eyebrow}>02 · LỚP</p><h2>Mở lớp</h2><label>Tên lớp<input value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Trúc Cơ 4A" /></label><div className={academy.row}><label>Step từ<input type="number" min="1" max="20" value={classStepMin} onChange={(e) => setClassStepMin(e.target.value)} /></label><label>đến<input type="number" min="1" max="20" value={classStepMax} onChange={(e) => setClassStepMax(e.target.value)} /></label></div><label>Giáo viên<select value={classTeacher} onChange={(e) => setClassTeacher(e.target.value)}><option value="">Chọn giáo viên</option>{teachers.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}</select></label><button disabled={Boolean(busy) || !teachers.length}>Mở lớp</button></form>
        <form className={academy.formCard} onSubmit={addStudent}><p className={styles.eyebrow}>03 · ĐỆ TỬ</p><h2>Cấp tài khoản</h2><label>Tên đăng nhập<input value={studentUsername} onChange={(e) => setStudentUsername(e.target.value.toLowerCase())} placeholder="detu.an" /></label><label>Tên hiển thị<input value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Trần Minh An" /></label><label>Mật khẩu ban đầu<input type="password" value={studentPassword} onChange={(e) => setStudentPassword(e.target.value)} placeholder="Tối thiểu 10 ký tự" /></label><label>Xếp lớp ngay (tùy chọn)<select value={studentClass} onChange={(e) => setStudentClass(e.target.value)}><option value="">Để khảo thí rồi tự xếp</option>{activeClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button disabled={Boolean(busy)}>Cấp tài khoản</button></form>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>Đệ tử hiện tại</h2><span>Tài khoản học viên tách hoàn toàn khỏi Admin RBAC.</span></div></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Đệ tử</th><th>Step</th><th>Khảo thí</th><th>Lớp / Giáo viên</th><th>Xếp lớp</th></tr></thead><tbody>{students.map((student) => <tr key={student.id}><td><strong>{student.displayName}</strong><br /><small>@{student.username}</small></td><td>{student.currentStep ?? "—"}</td><td><span className={styles.badge}>{student.placementStatus}</span></td><td>{student.enrollment ? <><strong>{student.enrollment.class.name}</strong><br /><small>{student.enrollment.teacher.displayName}</small></> : "Chưa xếp"}</td><td><select className={academy.compactSelect} value={student.enrollment?.class.id ?? ""} onChange={(e) => void assign(student.id, e.target.value)} disabled={Boolean(busy)}><option value="">Chọn lớp…</option>{activeClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td></tr>)}</tbody></table></div>
      </section>

      <section className={academy.questionSection}>
        <form className={academy.formCard} onSubmit={addQuestion}><p className={styles.eyebrow}>KHẢO THÍ · STEP BY STEP</p><h2>Thêm câu hỏi thật</h2><p className={styles.muted}>V1 không tự bịa nội dung giáo trình. Hãy nhập câu hỏi theo tài liệu Step by Step mà bạn dùng giảng dạy.</p><div className={academy.row}><label>Step<input type="number" min="1" max="20" value={qStep} onChange={(e) => setQStep(e.target.value)} /></label><label>Kỹ năng<input value={qSkill} onChange={(e) => setQSkill(e.target.value)} placeholder="Chiếu hết / Bắt quân..." /></label></div><label>Câu hỏi<textarea value={qPrompt} onChange={(e) => setQPrompt(e.target.value)} /></label><label>Các đáp án · mỗi dòng một đáp án<textarea value={qOptions} onChange={(e) => setQOptions(e.target.value)} placeholder={"Đáp án A\nĐáp án B\nĐáp án C"} /></label><div className={academy.row}><label>Đáp án đúng (0=A, 1=B...)<input type="number" min="0" max="7" value={qCorrect} onChange={(e) => setQCorrect(e.target.value)} /></label><label>Giải thích<input value={qExplanation} onChange={(e) => setQExplanation(e.target.value)} /></label></div><button disabled={Boolean(busy)}>Thêm vào ngân hàng</button></form>
        <div className={academy.questionList}><div className={styles.panelHead}><div><h2>Ngân hàng hiện tại</h2><span>{questions.filter((q) => q.active).length} câu đang hoạt động</span></div></div>{questions.length ? questions.map((q, index) => <article key={q.id}><span>#{index + 1} · Step {q.step} · {q.skill}</span><strong>{q.prompt}</strong><small>{q.options.length} lựa chọn · đúng: {String.fromCharCode(65 + q.correctIndex)} · {q.active ? "đang dùng" : "đã tắt"}</small></article>) : <div className={styles.empty}>Chưa có câu hỏi. Khi chưa cấu hình, đệ tử vẫn đăng nhập được nhưng chưa thể bắt đầu khảo thí.</div>}</div>
      </section>
    </div>
  );
}
