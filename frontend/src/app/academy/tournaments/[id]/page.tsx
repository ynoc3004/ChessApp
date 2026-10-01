"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "../tournaments.module.css";

const TOKEN_KEY = "chessapp:academy-token";
type Pairing = { id: string; board: number; whiteId: string; whiteName: string; blackId?: string | null; blackName?: string | null; result: string; pgn: string };
type Standing = { rank: number; studentId: string; displayName: string; step?: number | null; puzzleRating: number; score: number; buchholz: number; wins: number };
type Detail = {
  id: string; title: string; description: string; status: string; stepMin: number; stepMax: number; ratingMin: number; ratingMax: number;
  className?: string | null; maxPlayers: number; playerCount: number; rounds: number; currentRound: number; startsAt?: number | null;
  registered: boolean; eligible: boolean; eligibilityReason: string; pairings: Pairing[]; standings: Standing[]; myPairing?: Pairing | null;
};
const statusLabel: Record<string, string> = { registration: "Đang mở đăng ký", running: "Đang thi đấu", completed: "Đã kết thúc", cancelled: "Đã hủy" };

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id || "");
  const [token, setToken] = useState("");
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(candidate: string) {
    if (!candidate || !id) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/academy/tournaments/${id}`, { cache: "no-store", headers: { Authorization: `Bearer ${candidate}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.detail || "Không tải được giải đấu."));
      setData(payload as Detail);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không tải được giải đấu."); }
  }

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || "";
    setToken(saved); void load(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function register(method: "POST" | "DELETE") {
    if (!token) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/academy/tournaments/${id}/register`, { method, headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.detail || "Không cập nhật được đăng ký."));
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không cập nhật được đăng ký."); }
    finally { setBusy(false); }
  }

  if (!token) return <main className={styles.page}><section className={styles.empty}><h1>Giải Đấu</h1><p>Hãy đăng nhập Học Viện trước.</p><Link href="/academy">Đăng nhập →</Link></section></main>;
  if (!data) return <main className={styles.page}><header><Link href="/academy/tournaments">← Danh sách giải</Link></header>{error ? <div className={styles.error}>{error}</div> : <section className={styles.empty}>Đang tải đấu trường…</section>}</main>;

  return <main className={styles.page}>
    <header><Link href="/academy/tournaments">← Các giải đấu</Link><Link href="/academy">Học Viện →</Link></header>
    <section className={styles.hero}><p>武 {statusLabel[data.status] ?? data.status}</p><h1>{data.title}</h1><span>{data.description || "Giải nội bộ Kỳ Phổ Học Viện."}</span></section>
    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.detailGrid}>
      <article className={styles.panel}><h2>Thông tin giải</h2><div className={styles.meta}><span>Step {data.stepMin}–{data.stepMax}</span><span>Rating {data.ratingMin}–{data.ratingMax}</span><span>{data.playerCount}/{data.maxPlayers} người</span><span>{data.rounds} vòng Swiss</span>{data.className && <span>{data.className}</span>}</div>{data.startsAt && <p>Dự kiến: <strong>{new Date(data.startsAt * 1000).toLocaleString("vi-VN")}</strong></p>}<div className={styles.statusBox}><span>{data.registered ? "Bạn đã có tên trong danh sách thi đấu." : data.eligibilityReason}</span>{data.status === "registration" && !data.registered && <button disabled={busy || !data.eligible} onClick={() => void register("POST")}>Đăng ký tham gia</button>}{data.status === "registration" && data.registered && <button disabled={busy} onClick={() => void register("DELETE")}>Rút đăng ký</button>}</div></article>
      <article className={styles.panel}><h2>Vòng hiện tại</h2>{data.currentRound ? <><p>Vòng <strong>{data.currentRound}/{data.rounds}</strong></p>{data.myPairing ? <div className={styles.statusBox}><strong>Bàn {data.myPairing.board}</strong><span>{data.myPairing.whiteName} — {data.myPairing.blackName ?? "BYE"}</span><span>Kết quả: {data.myPairing.result === "pending" ? "đang chờ" : data.myPairing.result}</span></div> : <p>{data.registered ? "Bạn được bye hoặc chưa có cặp ở vòng này." : "Đăng ký để được ghép cặp khi giải bắt đầu."}</p>}</> : <p>Chưa ghép vòng đấu.</p>}</article>
    </section>

    {data.currentRound > 0 && <section className={styles.panel}><h2>Cặp đấu · Vòng {data.currentRound}</h2><div className={styles.pairings}>{data.pairings.map(pair => <div className={`${styles.pairing} ${data.myPairing?.id === pair.id ? styles.mine : ""}`} key={pair.id}><strong>Bàn {pair.board}</strong><span>{pair.whiteName} — {pair.blackName ?? "BYE"}</span><span>{pair.result === "pending" ? "Chưa có kết quả" : pair.result}</span>{pair.pgn && <details><summary>PGN</summary><pre className={styles.pgn}>{pair.pgn}</pre></details>}</div>)}</div></section>}

    <section className={styles.panel}><h2>Bảng xếp hạng</h2><div style={{ overflowX: "auto" }}><table className={styles.table}><thead><tr><th>#</th><th>Đệ tử</th><th>Step</th><th>Rating</th><th>Điểm</th><th>Buchholz</th><th>Thắng</th></tr></thead><tbody>{data.standings.map(row => <tr key={row.studentId}><td className={styles.rank}>{row.rank}</td><td><strong>{row.displayName}</strong></td><td>{row.step ?? "—"}</td><td>{row.puzzleRating}</td><td><strong>{row.score}</strong></td><td>{row.buchholz}</td><td>{row.wins}</td></tr>)}</tbody></table></div></section>
  </main>;
}
