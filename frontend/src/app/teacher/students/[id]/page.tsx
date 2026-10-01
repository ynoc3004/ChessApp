"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import styles from "../../teacher.module.css";

const TOKEN_KEY = "chessapp:teacher-token";

type Skill = { skill: string; mastery: number; attempts: number; cleanRate?: number | null };
type Focus = { category: string; label: string; count: number; weight: number; theme?: string | null };
type Game = { id: string; tournamentTitle?: string | null; round?: number | null; board?: number | null; whiteName?: string | null; blackName?: string | null; myMoments: number; result: string };
type Detail = {
  student: { id: string; displayName: string; username: string; currentStep?: number | null; xp: number; puzzleRating: number };
  training: { skills: Skill[]; weakestSkills: Skill[]; stats: { attempts: number; cleanRate?: number | null; last7Days: number }; review: { due: number; total: number } };
  practical: { gamesAnalyzed: number; moments: number; focusAreas: Focus[]; recommendation?: { label: string; evidenceWeight: number } | null };
  games: Game[];
};

export default function TeacherStudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) { router.replace("/teacher"); return; }
    void fetch(`${API_BASE}/api/teacher/students/${params.id}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
        setDetail(data as Detail);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Không tải được hồ sơ đệ tử."));
  }, [params.id, router]);

  return <main className={styles.page}><div className={styles.shell}>
    <section className={styles.hero}><div><p className={styles.eyebrow}>TEACHER PORTAL · STUDENT PROFILE</p><h1>{detail?.student.displayName || "Hồ Sơ Đệ Tử"}</h1><p>{detail ? `Step ${detail.student.currentStep ?? "—"} · Puzzle ${detail.student.puzzleRating} · Tu Vi ${detail.student.xp}` : "Skill Map và Practical Profile trong phạm vi lớp đang phụ trách."}</p></div><div className={styles.actions}><Link className={styles.ghost} href="/teacher">← Dashboard</Link></div></section>
    {error && <div className={styles.error}>{error}</div>}
    {!detail && !error && <section className={styles.panel}>Đang tải...</section>}
    {detail && <>
      <section className={styles.metrics}><article className={styles.metric}><span>Puzzle Rating</span><strong>{detail.student.puzzleRating}</strong></article><article className={styles.metric}><span>Tu Vi</span><strong>{detail.student.xp}</strong></article><article className={styles.metric}><span>Lượt luyện</span><strong>{detail.training.stats.attempts}</strong></article><article className={styles.metric}><span>Ôn đến hạn</span><strong>{detail.training.review.due}</strong></article><article className={styles.metric}><span>Ván phân tích</span><strong>{detail.practical.gamesAnalyzed}</strong></article></section>

      <section className={styles.grid}><div className={styles.panel}><h2>Skill Map</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Kỹ năng</th><th>Mastery</th><th>Lượt</th><th>Clean</th></tr></thead><tbody>{detail.training.skills.map(item => <tr key={item.skill}><td><strong>{item.skill}</strong></td><td>{Math.round(item.mastery)}%</td><td>{item.attempts}</td><td>{item.cleanRate == null ? "—" : `${Math.round(item.cleanRate)}%`}</td></tr>)}</tbody></table></div></div>
        <div className={styles.panel}><h2>Practical Profile</h2><div className={styles.cards}>{detail.practical.focusAreas.slice(0,7).map(item => <div className={styles.card} key={item.category}><strong>{item.label}</strong><span>{item.count} tình huống · evidence {item.weight}{item.theme ? ` · ${item.theme}` : ""}</span></div>)}{!detail.practical.focusAreas.length && <div className={styles.muted}>Chưa đủ dữ liệu ván thực chiến.</div>}</div>{detail.practical.recommendation && <div className={styles.notice} style={{marginTop:12}}>Trọng tâm thực chiến: {detail.practical.recommendation.label} · evidence {detail.practical.recommendation.evidenceWeight}</div>}</div>
      </section>

      <section className={styles.panel}><h2>Ván đã phân tích gần đây</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Giải</th><th>Vòng/Bàn</th><th>Trắng</th><th>Đen</th><th>Kết quả</th><th>Điểm cần xem</th></tr></thead><tbody>{detail.games.map(game => <tr key={game.id}><td>{game.tournamentTitle || "—"}</td><td>V{game.round ?? "—"} · B{game.board ?? "—"}</td><td>{game.whiteName}</td><td>{game.blackName}</td><td>{game.result}</td><td><strong>{game.myMoments}</strong></td></tr>)}{!detail.games.length && <tr><td colSpan={6}>Chưa có ván đã phân tích.</td></tr>}</tbody></table></div></section>
    </>}
  </div></main>;
}
