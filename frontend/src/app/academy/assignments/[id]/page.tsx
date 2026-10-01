"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
import { Chess } from "chess.js";
import { API_BASE } from "@/lib/api";
import { attemptPuzzle, startPuzzle, type Puzzle } from "@/lib/puzzle";
import styles from "../assignments.module.css";

const TOKEN_KEY = "chessapp:academy-token";

type Assignment = {
  id: string;
  teacherName?: string | null;
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
  active: boolean;
};

type AssignmentPuzzle = Puzzle & {
  academySkill?: string;
  academyTheme?: string;
  academyAssignmentId?: string;
  academyAssignmentTitle?: string;
};

type SessionResponse = { assignment: Assignment; puzzles: AssignmentPuzzle[]; completed: boolean };
type ResultResponse = {
  training: { xpAwarded: number; ratingDelta: number; mastery?: { skill: string; before: number; after: number }; review?: { added: boolean; intervalDays?: number | null } };
  assignment: Assignment;
};

async function readError(response: Response) {
  try { const payload = await response.json(); return String(payload.detail || `HTTP ${response.status}`); }
  catch { return `HTTP ${response.status}`; }
}

export default function AssignmentTrainingPage() {
  const params = useParams<{ id: string }>();
  const assignmentId = String(params.id || "");
  const [token, setToken] = useState("");
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [puzzles, setPuzzles] = useState<AssignmentPuzzle[]>([]);
  const [index, setIndex] = useState(0);
  const [fen, setFen] = useState("");
  const [ply, setPly] = useState(1);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [done, setDone] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [message, setMessage] = useState("");
  const [reward, setReward] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const startedAt = useRef(0);
  const reported = useRef("");
  const puzzle = puzzles[index];

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!saved) { setLoading(false); return; }
    setToken(saved);
    void loadSession(saved).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  function openPuzzle(next: AssignmentPuzzle, nextIndex: number) {
    const game = startPuzzle(next);
    setIndex(nextIndex);
    setFen(game.fen());
    setOrientation(game.turn() === "w" ? "white" : "black");
    setPly(1); setDone(false); setMistakes(0); setHinted(false); setPromotion(null); setReward("");
    setMessage("Tìm nước đi tốt nhất.");
    startedAt.current = Date.now();
    reported.current = "";
  }

  async function loadSession(candidate = token) {
    if (!candidate || !assignmentId) return;
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/academy/assignments/${encodeURIComponent(assignmentId)}/session`, {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${candidate}` },
      });
      if (response.status === 401) {
        window.sessionStorage.removeItem(TOKEN_KEY); setToken(""); return;
      }
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as SessionResponse;
      setAssignment(data.assignment);
      setPuzzles(data.puzzles);
      if (data.puzzles.length) openPuzzle(data.puzzles[0], 0);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Không mở được bài tập.");
    } finally { setLoading(false); }
  }

  async function reportResult(current: AssignmentPuzzle, currentMistakes: number, currentHinted: boolean) {
    if (!token || !assignment) return;
    const key = `${current.id}:${startedAt.current}`;
    if (reported.current === key) return;
    reported.current = key;
    setSaving(true);
    const eventId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const response = await fetch(`${API_BASE}/api/academy/assignments/${encodeURIComponent(assignment.id)}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          eventId,
          puzzleId: current.id,
          mistakes: currentMistakes,
          hinted: currentHinted,
          elapsedMs: Math.max(0, Date.now() - startedAt.current),
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as ResultResponse;
      setAssignment(data.assignment);
      const rating = data.training.ratingDelta === 0 ? "Rating ±0" : `Rating ${data.training.ratingDelta > 0 ? "+" : ""}${data.training.ratingDelta}`;
      const mastery = data.training.mastery ? ` · ${data.training.mastery.skill} ${data.training.mastery.before.toFixed(0)}% → ${data.training.mastery.after.toFixed(0)}%` : "";
      const review = data.training.review?.added ? ` · vào Sổ Sai Lầm, ôn sau ${data.training.review.intervalDays ?? 1} ngày` : "";
      setReward(`+${data.training.xpAwarded} Tu Vi · ${rating}${mastery}${review}`);
    } catch (reason) {
      reported.current = "";
      setReward(reason instanceof Error ? `Chưa lưu được tiến độ: ${reason.message}` : "Chưa lưu được tiến độ.");
    } finally { setSaving(false); }
  }

  function submitMove(from: string, to: string, promote = "") {
    if (!puzzle || done || saving) return false;
    const result = attemptPuzzle(puzzle, fen, ply, from + to + promote);
    if (!result) {
      setMistakes((value) => value + 1);
      setMessage("Chưa đúng. Bàn cờ được giữ nguyên để bạn thử lại.");
      return false;
    }
    setFen(result.fen); setPly(result.ply); setDone(result.done);
    setMessage(result.done ? "Đã vượt qua thế cờ." : "Đúng. Đối thủ đã đáp trả, tiếp tục.");
    if (result.done) void reportResult(puzzle, mistakes, hinted);
    return true;
  }

  function drop({ sourceSquare, targetSquare }: PieceDropHandlerArgs) {
    if (!targetSquare || !fen || done || saving || promotion) return false;
    const game = new Chess(fen);
    const legal = game.moves({ verbose: true }).filter((move) => move.from === sourceSquare && move.to === targetSquare);
    if (!legal.length) return false;
    if (legal.some((move) => move.promotion)) { setPromotion({ from: sourceSquare, to: targetSquare }); return false; }
    return submitMove(sourceSquare, targetSquare);
  }

  function nextPuzzle() {
    if (index + 1 < puzzles.length) openPuzzle(puzzles[index + 1], index + 1);
    else void loadSession();
  }

  if (loading) return <main className={styles.page}><p>Đang mở nhiệm vụ sư môn…</p></main>;
  if (!token) return <main className={styles.page}><section className={styles.empty}><h1>Cần đăng nhập đệ tử</h1><Link href="/academy">Đăng nhập Học Viện →</Link></section></main>;
  if (!assignment) return <main className={styles.page}><header className={styles.header}><Link href="/academy/assignments">← Bài được giao</Link></header><section className={styles.empty}><h1>Không mở được bài tập</h1><p>{message || "Bài tập không tồn tại hoặc không thuộc tài khoản này."}</p></section></main>;

  if (assignment.status === "completed" && !puzzle) return <main className={styles.page}><header className={styles.header}><Link href="/academy/assignments">← Bài được giao</Link><Link href="/academy">Hồ sơ đệ tử →</Link></header><section className={styles.completion}><p>任 · NHIỆM VỤ HOÀN THÀNH</p><h2>{assignment.title}</h2><p>Bạn đã hoàn thành {assignment.attempts}/{assignment.puzzleCount} thế, trong đó {assignment.cleanAttempts} thế vượt sạch.</p><Link href="/academy/assignments">Xem các bài khác →</Link></section></main>;

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/academy/assignments">← Bài được giao</Link><Link href="/realms">Bí Cảnh tự luyện →</Link></header>
    <section className={styles.hero}><div><p>NHIỆM VỤ SƯ MÔN · {assignment.teacherName || "GIÁO VIÊN"}</p><h1>{assignment.title}</h1><span>{assignment.description || `${assignment.themeLabel} · Rating ${assignment.ratingMin}–${assignment.ratingMax}`}</span></div><strong>{assignment.attempts}/{assignment.puzzleCount}<small>đã vượt</small></strong></section>
    <div className={styles.progress}><span style={{ width: `${assignment.progressPercent}%` }} /></div>
    {assignment.status === "overdue" && <p className={styles.warning}>Bài đã quá hạn nhưng vẫn mở để bạn hoàn thành. Giáo viên sẽ thấy trạng thái quá hạn trên dashboard.</p>}
    {message && !puzzle && <p className={styles.warning}>{message}</p>}

    {puzzle && <section className={styles.trainingShell}>
      <div className={styles.boardPanel}>
        <h2>Thế {index + 1}/{puzzles.length} · {orientation === "white" ? "Trắng" : "Đen"} đi</h2>
        <Chessboard options={{ id: "academy-assignment-board", position: fen, boardOrientation: orientation, onPieceDrop: drop, allowDragging: !done && !saving && !promotion, darkSquareStyle: { backgroundColor: "#9f8974" }, lightSquareStyle: { backgroundColor: "#f6e6cc" } }} />
        {promotion && <div className={styles.promotion}>{[["q", "Hậu"], ["r", "Xe"], ["b", "Tượng"], ["n", "Mã"]].map(([piece, label]) => <button key={piece} onClick={() => { submitMove(promotion.from, promotion.to, piece); setPromotion(null); }}>{label}</button>)}<button onClick={() => setPromotion(null)}>Hủy</button></div>}
      </div>
      <aside className={styles.sidePanel}>
        <p className={styles.eyebrow}>{assignment.themeLabel} · RATING {assignment.ratingMin}–{assignment.ratingMax}</p>
        <h1>{assignment.title}</h1>
        <div className={styles.assignmentMeta}><span><small>Tiến độ</small><strong>{assignment.attempts}/{assignment.puzzleCount}</strong></span><span><small>Vượt sạch</small><strong>{assignment.cleanAttempts}</strong></span><span><small>Sai bài này</small><strong>{mistakes}</strong></span><span><small>Gợi ý</small><strong>{hinted ? "Đã dùng" : "Chưa dùng"}</strong></span></div>
        <p className={styles.statusLine}>{message}</p>
        {!done && <><button onClick={() => { setHinted(true); setMessage(`Quan sát quân ở ô ${puzzle.moves.split(/\s+/)[ply].slice(0, 2)}.`); }}>Gợi ý quân cần đi</button><button onClick={() => { setHinted(true); setMessage(`Nước tiếp theo: ${puzzle.moves.split(/\s+/)[ply]}.`); }}>Xem nước tiếp theo</button></>}
        {reward && <p className={styles.reward}>{reward}</p>}
        {done && <button disabled={saving || !reward} onClick={nextPuzzle}>{saving ? "Đang lưu tiến độ…" : assignment.remaining <= 0 ? "Hoàn tất nhiệm vụ →" : index + 1 < puzzles.length ? "Thế tiếp theo →" : "Mở lượt tiếp →"}</button>}
      </aside>
    </section>}
  </main>;
}
