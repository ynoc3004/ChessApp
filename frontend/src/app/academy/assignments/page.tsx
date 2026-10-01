"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./assignments.module.css";

const TOKEN_KEY = "chessapp:academy-token";

type Assignment = {
  id: string;
  teacherName?: string | null;
  targetName?: string | null;
  title: string;
  description: string;
  themeLabel: string;
  ratingMin: number;
  ratingMax: number;
  puzzleCount: number;
  dueAt?: number | null;
  attempts: number;
  cleanAttempts: number;
  remaining: number;
  progressPercent: number;
  status: "pending" | "in_progress" | "completed" | "overdue";
};

async function readError(response: Response) {
  try { const payload = await response.json(); return String(payload.detail || `HTTP ${response.status}`); }
  catch { return `HTTP ${response.status}`; }
}

function dueLabel(value?: number | null) {
  if (!value) return "Không giới hạn thời gian";
  return new Date(value * 1000).toLocaleString("vi-VN", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(status: Assignment["status"]) {
  if (status === "completed") return "Đã hoàn thành";
  if (status === "overdue") return "Quá hạn";
  if (status === "in_progress") return "Đang làm";
  return "Chưa bắt đầu";
}

export default function AssignmentListPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [state, setState] = useState<"loading" | "guest" | "ready">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) { setState("guest"); return; }
    void fetch(`${API_BASE}/api/academy/assignments`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
      if (response.status === 401) {
        window.sessionStorage.removeItem(TOKEN_KEY);
        setState("guest");
        return;
      }
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { assignments: Assignment[] };
      setAssignments(payload.assignments);
      setState("ready");
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Không tải được bài tập.");
      setState("ready");
    });
  }, []);

  if (state === "loading") return <main className={styles.page}><p>Đang mở bảng giao bài…</p></main>;
  if (state === "guest") return <main className={styles.page}><section className={styles.empty}><h1>Cần đăng nhập đệ tử</h1><p>Bài giáo viên giao gắn với hồ sơ Học Viện của bạn.</p><Link href="/academy">Đăng nhập Học Viện →</Link></section></main>;

  const pending = assignments.filter((item) => item.status !== "completed");
  const completed = assignments.filter((item) => item.status === "completed");

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/academy">← Hồ sơ đệ tử</Link><Link href="/realms">Bí Cảnh tự luyện →</Link></header>
    <section className={styles.hero}><div><p>HỌC VIỆN · NHIỆM VỤ SƯ MÔN</p><h1>Bài Giáo Viên Giao</h1><span>Hoàn thành các Bí Cảnh theo đúng chủ đề và độ khó giáo viên đã chỉ định.</span></div><strong>{pending.length}<small>đang chờ</small></strong></section>
    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.section}><div className={styles.sectionHead}><h2>Đang thực hiện</h2><span>{pending.length} bài</span></div>
      {pending.length === 0 ? <div className={styles.empty}><h3>Không có bài đang chờ.</h3><p>Bạn có thể tiếp tục vào Bí Cảnh cá nhân hóa.</p><Link href="/realms">Vào Bí Cảnh →</Link></div> : <div className={styles.cards}>{pending.map((item) => <article key={item.id} data-status={item.status}>
        <div className={styles.cardHead}><div><span>{item.teacherName || "Giáo viên"}</span><h3>{item.title}</h3></div><b>{statusLabel(item.status)}</b></div>
        <p>{item.description || `${item.puzzleCount} puzzle ${item.themeLabel}`}</p>
        <div className={styles.meta}><span>{item.themeLabel}</span><span>Rating {item.ratingMin}–{item.ratingMax}</span><span>Hạn {dueLabel(item.dueAt)}</span></div>
        <div className={styles.progress}><span style={{ width: `${item.progressPercent}%` }} /></div>
        <div className={styles.cardFoot}><small>{item.attempts}/{item.puzzleCount} thế · {item.cleanAttempts} vượt sạch</small><Link href={`/academy/assignments/${item.id}`}>{item.attempts ? "Tiếp tục →" : "Bắt đầu →"}</Link></div>
      </article>)}</div>}
    </section>

    {completed.length > 0 && <section className={styles.section}><div className={styles.sectionHead}><h2>Đã hoàn thành</h2><span>{completed.length} bài</span></div><div className={styles.cards}>{completed.map((item) => <article key={item.id} data-status="completed"><div className={styles.cardHead}><div><span>{item.teacherName || "Giáo viên"}</span><h3>{item.title}</h3></div><b>Hoàn thành</b></div><p>{item.attempts}/{item.puzzleCount} thế · {item.cleanAttempts} vượt sạch</p><div className={styles.progress}><span style={{ width: "100%" }} /></div></article>)}</div></section>}
  </main>;
}
