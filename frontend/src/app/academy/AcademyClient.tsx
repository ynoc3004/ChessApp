"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./academy.module.css";

const TOKEN_KEY = "chessapp:academy-token";

type Student = {
  id: string;
  username: string;
  displayName: string;
  currentStep: number | null;
  placementStatus: string;
  xp: number;
  puzzleRating: number;
};

type Enrollment = {
  class: { id: string; name: string; stepMin: number; stepMax: number };
  teacher: { id: string; displayName: string; bio: string; aiProfileId?: string | null };
} | null;

type Dashboard = {
  student: Student;
  enrollment: Enrollment;
  placement: {
    questionCount: number;
    ready: boolean;
    latestAttempt?: {
      status: string;
      score?: number | null;
      recommendedStep?: number | null;
      skillScores?: Record<string, { correct: number; total: number; percent: number }>;
    } | null;
  };
  nextAction: "placement" | "await-class" | "academy-home";
};

type PlacementQuestion = {
  id: string;
  step: number;
  skill: string;
  prompt: string;
  options: string[];
};

type PlacementSession = {
  attemptId: string;
  questions: PlacementQuestion[];
};

type PlacementResult = {
  completed: boolean;
  score: number;
  recommendedStep: number;
  skillScores: Record<string, { correct: number; total: number; percent: number }>;
  stepScores: Record<string, { correct: number; total: number; percent: number }>;
  enrollment: Enrollment;
};

async function readError(response: Response) {
  try {
    const payload = await response.json();
    return String(payload.detail || `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export default function AcademyClient() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [placement, setPlacement] = useState<PlacementSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as T;
  }, [token]);

  const loadDashboard = useCallback(async (candidate?: string) => {
    const activeToken = candidate ?? token;
    if (!activeToken) return;
    const response = await fetch(`${API_BASE}/api/academy/dashboard`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    if (!response.ok) throw new Error(await readError(response));
    const data = (await response.json()) as Dashboard;
    setDashboard(data);
  }, [token]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!saved) {
      setLoading(false);
      return;
    }
    setToken(saved);
    void loadDashboard(saved)
      .catch(() => {
        window.sessionStorage.removeItem(TOKEN_KEY);
        setToken("");
      })
      .finally(() => setLoading(false));
  }, [loadDashboard]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/academy/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as { token: string; student: Student };
      window.sessionStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setPassword("");
      await loadDashboard(data.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đăng nhập được.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (token) {
      void fetch(`${API_BASE}/api/academy/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    window.sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setDashboard(null);
    setPlacement(null);
    setAnswers({});
    setResult(null);
  }

  async function startPlacement() {
    setBusy(true);
    setError("");
    try {
      const data = await request<PlacementSession>("/api/academy/placement/start", { method: "POST" });
      setPlacement(data);
      setAnswers({});
      setResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không mở được khảo thí.");
    } finally {
      setBusy(false);
    }
  }

  async function submitPlacement() {
    if (!placement) return;
    setBusy(true);
    setError("");
    try {
      const data = await request<PlacementResult>("/api/academy/placement/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: placement.attemptId, answers }),
      });
      setResult(data);
      setPlacement(null);
      await loadDashboard();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không nộp được khảo thí.");
    } finally {
      setBusy(false);
    }
  }

  const answered = useMemo(() => Object.keys(answers).length, [answers]);
  const skills = result?.skillScores ?? dashboard?.placement.latestAttempt?.skillScores ?? {};

  if (loading) return <main className={styles.loading}>Đang mở sơn môn…</main>;

  if (!token || !dashboard) {
    return (
      <main className={styles.root}>
        <header className={styles.topbar}>
          <Link href="/" className={styles.brand}><span>♞</span><strong>Kỳ Phổ Học Viện</strong></Link>
          <Link href="/">← Trở về Đạo Các</Link>
        </header>
        <section className={styles.loginScene}>
          <div className={styles.loginCopy}>
            <p className={styles.eyebrow}>NHẬP MÔN · ĐỆ TỬ</p>
            <h1>Mở cửa sơn môn.</h1>
            <p>Tài khoản đệ tử do giáo viên hoặc Nội Các cấp. Sau lần đăng nhập đầu tiên, bạn sẽ làm Khảo Thí Nhập Môn để xác định Step phù hợp.</p>
            <div className={styles.pathPreview}>
              <span>Khảo thí</span><i>→</i><span>Xếp lớp</span><i>→</i><span>Bí Cảnh</span><i>→</i><span>Thăng Step</span>
            </div>
          </div>
          <form className={styles.loginCard} onSubmit={login}>
            <div className={styles.seal}>門</div>
            <h2>Đăng nhập đệ tử</h2>
            <label>Tên đăng nhập<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="detu.an" /></label>
            <label>Mật khẩu<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••" /></label>
            <button disabled={busy || !username.trim() || !password}>{busy ? "Đang kiểm ấn…" : "Nhập môn →"}</button>
            {error && <p className={styles.error}>{error}</p>}
          </form>
        </section>
      </main>
    );
  }

  const student = dashboard.student;
  const enrollment = result?.enrollment ?? dashboard.enrollment;

  return (
    <main className={styles.root}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}><span>♞</span><strong>Kỳ Phổ Học Viện</strong></Link>
        <nav><Link href="/realms">Bí Cảnh</Link><Link href="/collection">Tàng Kinh Các</Link><button onClick={() => void logout()}>Xuất môn</button></nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>HỒ SƠ ĐỆ TỬ</p>
          <h1>{student.displayName}</h1>
          <p>@{student.username} · {student.currentStep ? `Step ${student.currentStep}` : "Chưa định Step"}</p>
        </div>
        <div className={styles.metrics}>
          <div><span>Tu vi</span><strong>{student.xp.toLocaleString("vi-VN")}</strong></div>
          <div><span>Puzzle Rating</span><strong>{student.puzzleRating}</strong></div>
          <div><span>Step</span><strong>{student.currentStep ?? "—"}</strong></div>
        </div>
      </section>

      {error && <div className={styles.errorBox}>{error}</div>}

      {dashboard.nextAction === "placement" && !placement && !result && (
        <section className={styles.placementIntro}>
          <div className={styles.seal}>試</div>
          <div>
            <p className={styles.eyebrow}>KHẢO THÍ NHẬP MÔN</p>
            <h2>Xác định căn cơ theo Step by Step</h2>
            <p>Bài khảo thí đo từng nhóm kỹ năng rồi đề xuất Step ban đầu. Kết quả không chỉ là một con số: nó trở thành bản đồ kỹ năng để Bí Cảnh chọn bài phù hợp về sau.</p>
            {dashboard.placement.ready ? <button onClick={() => void startPlacement()} disabled={busy}>Bắt đầu khảo thí · {dashboard.placement.questionCount} câu →</button> : <div className={styles.notice}>Ngân hàng câu hỏi Step by Step chưa được giáo viên cấu hình. Tài khoản của bạn đã sẵn sàng; hãy chờ Nội Các mở khảo thí.</div>}
          </div>
        </section>
      )}

      {placement && (
        <section className={styles.exam}>
          <div className={styles.examHead}>
            <div><p className={styles.eyebrow}>KHẢO THÍ ĐANG DIỄN RA</p><h2>{answered}/{placement.questions.length} câu đã trả lời</h2></div>
            <div className={styles.progress}><span style={{ width: `${placement.questions.length ? answered / placement.questions.length * 100 : 0}%` }} /></div>
          </div>
          <div className={styles.questions}>
            {placement.questions.map((question, index) => (
              <article className={styles.question} key={question.id}>
                <div className={styles.questionMeta}><span>Câu {index + 1}</span><span>Step {question.step}</span><span>{question.skill}</span></div>
                <h3>{question.prompt}</h3>
                <div className={styles.options}>
                  {question.options.map((option, optionIndex) => (
                    <label key={optionIndex} data-selected={answers[question.id] === optionIndex}>
                      <input type="radio" name={question.id} checked={answers[question.id] === optionIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} />
                      <span>{String.fromCharCode(65 + optionIndex)}</span>{option}
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <button className={styles.submitExam} disabled={busy || answered !== placement.questions.length} onClick={() => void submitPlacement()}>{busy ? "Đang chấm khảo thí…" : "Nộp bài và định Step →"}</button>
        </section>
      )}

      {result && (
        <section className={styles.result}>
          <p className={styles.eyebrow}>KẾT QUẢ KHẢO THÍ</p>
          <h2>Step đề xuất: <strong>{result.recommendedStep}</strong></h2>
          <p>Tổng điểm {result.score.toFixed(1)}%. Hệ thống đã lưu hồ sơ kỹ năng để dùng cho các Bí Cảnh sau này.</p>
        </section>
      )}

      {student.currentStep && (
        <section className={styles.dashboardGrid}>
          <article className={styles.panel}>
            <p className={styles.eyebrow}>SƯ MÔN</p>
            <h2>{enrollment?.class.name ?? "Đang chờ xếp lớp"}</h2>
            {enrollment ? <><p>Giáo viên phụ trách: <strong>{enrollment.teacher.displayName}</strong></p><p>{enrollment.teacher.bio || "Hồ sơ giáo viên sẽ được bổ sung."}</p><span className={styles.tag}>{enrollment.teacher.aiProfileId ? "AI giáo viên đã được gắn profile" : "AI giáo viên sẽ tích hợp sau"}</span></> : <p>Nội Các chưa xếp lớp phù hợp với Step của bạn.</p>}
          </article>
          <article className={styles.panel}>
            <p className={styles.eyebrow}>BÍ CẢNH</p>
            <h2>Luyện theo trình độ</h2>
            <p>Ở bước tiếp theo, Bí Cảnh sẽ dùng Step và các kỹ năng yếu của bạn để chọn puzzle thích hợp thay vì phát câu hỏi ngẫu nhiên.</p>
            <Link className={styles.panelLink} href="/realms">Mở Bí Cảnh hiện tại →</Link>
          </article>
          <article className={styles.panel}>
            <p className={styles.eyebrow}>AI SƯ PHỤ</p>
            <h2>Hỏi bài và trò chuyện</h2>
            <p>Khung liên kết giáo viên đã sẵn sàng. Khi model AI giáo viên của bạn hoàn thiện, profile tương ứng sẽ được gắn vào đúng lớp.</p>
            <span className={styles.tag}>Chờ tích hợp model giáo viên</span>
          </article>
        </section>
      )}

      {Object.keys(skills).length > 0 && (
        <section className={styles.skillSection}>
          <div><p className={styles.eyebrow}>THIÊN PHÚ ĐỒ · BẢN ĐẦU</p><h2>Bản đồ kỹ năng</h2></div>
          <div className={styles.skillGrid}>
            {Object.entries(skills).sort((a, b) => b[1].percent - a[1].percent).map(([skill, score]) => (
              <div className={styles.skill} key={skill}><div><strong>{skill}</strong><span>{score.percent.toFixed(0)}%</span></div><div className={styles.skillTrack}><span style={{ width: `${score.percent}%` }} /></div><small>{score.correct}/{score.total} câu đúng</small></div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
