"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";
import styles from "./practical.module.css";

const TOKEN_KEY = "chessapp:academy-token";

type Focus = { category: string; label: string; theme?: string | null; count: number; weight: number };
type Profile = {
  gamesAnalyzed: number; moments: number;
  severity: { inaccuracy: number; mistake: number; blunder: number; missedWin: number };
  focusAreas: Focus[];
  recommendation?: { category: string; label: string; theme?: string | null; evidenceWeight: number; reason: string } | null;
  note: string;
};
type Game = {
  id: string; tournamentTitle?: string | null; round?: number | null; board?: number | null;
  whiteName?: string | null; blackName?: string | null; result: string; myColor: string; myMoments: number;
  moves: number; moments: number; completedAt?: number | null;
};

export default function PracticalProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) { setError("Hãy đăng nhập Học Viện trước."); setLoading(false); return; }
    const headers = { Authorization: `Bearer ${token}` };
    void Promise.all([
      fetch(`${API_BASE}/api/academy/game-analysis/profile`, { cache: "no-store", headers }),
      fetch(`${API_BASE}/api/academy/game-analysis/games`, { cache: "no-store", headers }),
    ]).then(async ([profileResponse, gamesResponse]) => {
      if (!profileResponse.ok || !gamesResponse.ok) throw new Error("Không tải được Practical Profile.");
      setProfile(await profileResponse.json() as Profile);
      const gameData = await gamesResponse.json() as { games: Game[] };
      setGames(gameData.games);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Không tải được dữ liệu.")).finally(() => setLoading(false));
  }, []);

  const maxWeight = useMemo(() => Math.max(1, ...(profile?.focusAreas.map(item => item.weight) ?? [1])), [profile]);

  return <main className={styles.page}>
    <header className={styles.header}><Link href="/academy">← Học Viện</Link><Link href="/academy/tournaments">Giải Đấu →</Link></header>
    <section className={styles.hero}>
      <p>ACADEMY V5 · THỰC CHIẾN</p><h1>Practical Profile</h1>
      <p>Hồ sơ này chỉ tổng hợp những thời điểm Stockfish phát hiện mất ưu thế trong ván giải. Nó không tự trừ Skill Mastery và không kết luận nguyên nhân tâm lý của người chơi.</p>
    </section>
    {error && <section className={styles.panel}><p>{error}</p></section>}
    {loading && <section className={styles.panel}><p>Đang đọc kỳ phổ thực chiến…</p></section>}

    {profile && <>
      <section className={styles.metrics}>
        <article className={styles.metric}><small>Ván đã phân tích</small><strong>{profile.gamesAnalyzed}</strong></article>
        <article className={styles.metric}><small>Điểm cần xem</small><strong>{profile.moments}</strong></article>
        <article className={styles.metric}><small>Blunder</small><strong>{profile.severity.blunder}</strong></article>
        <article className={styles.metric}><small>Missed win</small><strong>{profile.severity.missedWin}</strong></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Trọng tâm thực chiến</h2>
          {profile.recommendation ? <><p><strong>{profile.recommendation.label}</strong> đang là nhóm xuất hiện nổi bật nhất trong các ván đã phân tích.</p><p className={styles.muted}>{profile.recommendation.reason}</p>{profile.recommendation.theme && <p className={styles.muted}>Bí Cảnh cá nhân hóa có thể ưu tiên theme <strong>{profile.recommendation.theme}</strong> khi bằng chứng lặp lại đủ mạnh.</p>}</> : <p className={styles.muted}>Cần ít nhất hai ván đã phân tích trước khi hệ thống đề xuất một trọng tâm thực chiến.</p>}
          <div className={styles.severity}><span>Inaccuracy {profile.severity.inaccuracy}</span><span>Mistake {profile.severity.mistake}</span><span>Blunder {profile.severity.blunder}</span></div>
        </article>
        <article className={styles.panel}>
          <h2>Nhóm tình huống</h2><div className={styles.focus}>{profile.focusAreas.slice(0, 7).map(item => <article key={item.category}><strong>{item.label}</strong><small>{item.count} lần · trọng số {item.weight}</small><div style={{ marginTop: 8, height: 5, borderRadius: 999, background: "#eadfce" }}><div style={{ width: `${Math.max(8, item.weight / maxWeight * 100)}%`, height: "100%", borderRadius: 999, background: "#866342" }} /></div></article>)}</div>
          {!profile.focusAreas.length && <p className={styles.muted}>Chưa có lỗi đủ ngưỡng 80 centipawn trong các ván đã phân tích.</p>}
        </article>
      </section>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <h2>Ván gần đây</h2><div className={styles.list}>{games.map(game => <div className={styles.row} key={game.id}><div><Link href={`/academy/practical/${game.id}`}>{game.tournamentTitle || "Giải đấu"} · V{game.round ?? "—"} B{game.board ?? "—"}</Link><div className={styles.muted}>{game.whiteName} — {game.blackName} · {game.result}</div></div><div><span className={styles.badge}>{game.myMoments} điểm cần xem</span></div></div>)}</div>
        {!games.length && <p className={styles.muted}>Chưa có ván nào được giáo viên chạy Stockfish. Khi PGN được phân tích, báo cáo sẽ xuất hiện ở đây.</p>}
      </section>
    </>}
  </main>;
}
