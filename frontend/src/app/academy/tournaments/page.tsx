"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./tournaments.module.css";

const TOKEN_KEY = "chessapp:academy-token";
type Tournament = {
  id: string; title: string; description: string; stepMin: number; stepMax: number; ratingMin: number; ratingMax: number;
  className?: string | null; maxPlayers: number; rounds: number; status: string; playerCount: number; currentRound: number;
  startsAt?: number | null; registered: boolean; eligible: boolean; eligibilityReason: string;
};
const statusLabel: Record<string, string> = { registration: "Đang mở đăng ký", running: "Đang thi đấu", completed: "Đã kết thúc", cancelled: "Đã hủy" };

export default function StudentTournamentsPage() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<Tournament[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load(candidate: string) {
    if (!candidate) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/academy/tournaments`, { cache: "no-store", headers: { Authorization: `Bearer ${candidate}` } });
      if (!response.ok) throw new Error(response.status === 401 ? "Phiên đệ tử đã hết hạn. Hãy đăng nhập lại." : "Không tải được danh sách giải.");
      const data = await response.json() as { tournaments: Tournament[] };
      setItems(data.tournaments);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không tải được giải đấu."); }
  }

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || "";
    setToken(saved); void load(saved);
  }, []);

  async function registration(item: Tournament, method: "POST" | "DELETE") {
    if (!token) return;
    setBusy(item.id); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/academy/tournaments/${item.id}/register`, { method, headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.detail || "Không thể cập nhật đăng ký."));
      await load(token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể cập nhật đăng ký."); }
    finally { setBusy(""); }
  }

  if (!token) return <main className={styles.page}><section className={styles.empty}><h1>Giải Đấu Đệ Tử</h1><p>Hãy đăng nhập Học Viện trước.</p><Link href="/academy">Đăng nhập →</Link></section></main>;

  return <main className={styles.page}>
    <header><Link href="/academy">← Học Viện</Link><Link href="/realms">Bí Cảnh →</Link></header>
    <section className={styles.hero}><p>武 ĐẤU TRƯỜNG · ACADEMY V4</p><h1>Giải Đấu Đệ Tử</h1><span>Thi đấu cùng nhóm Step/trình độ phù hợp. BXH dùng điểm và Buchholz.</span></section>
    {error && <div className={styles.error}>{error}</div>}
    <section className={styles.cards}>{items.map(item => <article key={item.id} data-status={item.status}>
      <div className={styles.cardHead}><span>{statusLabel[item.status] ?? item.status}</span>{item.registered && <b>ĐÃ ĐĂNG KÝ</b>}</div>
      <h2>{item.title}</h2><p>{item.description || "Giải nội bộ Học Viện."}</p>
      <div className={styles.meta}><span>Step {item.stepMin}–{item.stepMax}</span><span>Rating {item.ratingMin}–{item.ratingMax}</span><span>{item.playerCount}/{item.maxPlayers} người</span><span>{item.rounds} vòng Swiss</span>{item.className && <span>{item.className}</span>}</div>
      {item.startsAt && <small>Dự kiến: {new Date(item.startsAt * 1000).toLocaleString("vi-VN")}</small>}
      <p className={item.eligible ? styles.good : styles.reason}>{item.eligibilityReason}</p>
      <div className={styles.actions}><Link href={`/academy/tournaments/${item.id}`}>Xem giải →</Link>{item.status === "registration" && !item.registered && <button disabled={busy === item.id || !item.eligible} onClick={() => void registration(item, "POST")}>Đăng ký tham gia</button>}{item.status === "registration" && item.registered && <button disabled={busy === item.id} onClick={() => void registration(item, "DELETE")}>Rút đăng ký</button>}</div>
    </article>)}{!items.length && <div className={styles.empty}><h2>Chưa có giải phù hợp</h2><p>Khi Nội Các mở đăng ký, giải sẽ xuất hiện tại đây.</p></div>}</section>
  </main>;
}
