"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import styles from "../../admin.module.css";
import local from "./gameAnalysis.module.css";

type Overview = {
  engineAvailable: boolean; gamesWithPgn: number; notStarted: number; stale: number;
  running: number; failed: number; completed: number;
};
type Game = {
  pairingId: string; tournamentId: string; tournamentTitle: string; round: number; board: number;
  whiteName: string; blackName: string; result: string; analysisStatus: string; stale: boolean;
};
type Analysis = {
  id: string; pairingId: string; tournamentId: string; tournamentTitle?: string | null;
  round?: number | null; board?: number | null; whiteName?: string | null; blackName?: string | null;
  status: string; depth: number; moves: number; moments: number; error?: string | null;
};

const statusLabel: Record<string, string> = {
  not_started: "Chưa phân tích", queued: "Đang chờ", running: "Stockfish đang chạy",
  completed: "Hoàn tất", failed: "Lỗi",
};

export default function GameAnalysisAdminPage() {
  const { request } = useAdmin();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [depth, setDepth] = useState(12);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [summary, data] = await Promise.all([
        request<Overview>("/api/admin/academy/game-analysis/overview"),
        request<{ games: Game[]; analyses: Analysis[] }>("/api/admin/academy/game-analysis/games"),
      ]);
      setOverview(summary); setGames(data.games); setAnalyses(data.analyses); setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được phân tích ván.");
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!overview?.running) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, overview?.running]);

  const analysisByPairing = useMemo(() => new Map(analyses.map(item => [item.pairingId, item])), [analyses]);
  const tournamentGroups = useMemo(() => {
    const groups = new Map<string, { title: string; id: string; games: Game[] }>();
    for (const game of games) {
      const group = groups.get(game.tournamentId) ?? { title: game.tournamentTitle, id: game.tournamentId, games: [] };
      group.games.push(game); groups.set(game.tournamentId, group);
    }
    return [...groups.values()];
  }, [games]);

  async function run(key: string, task: () => Promise<unknown>, message: string) {
    setBusy(key); setError(""); setNotice("");
    try { await task(); setNotice(message); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Không chạy được Stockfish."); }
    finally { setBusy(""); }
  }

  function startGame(game: Game) {
    return run(`game:${game.pairingId}`, () => request(`/api/admin/academy/game-analysis/pairings/${game.pairingId}/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depth, force: game.stale || game.analysisStatus === "failed" }),
    }), `Đã đưa ván vòng ${game.round}, bàn ${game.board} vào hàng đợi.`);
  }

  function startTournament(id: string) {
    return run(`tournament:${id}`, () => request(`/api/admin/academy/game-analysis/tournaments/${id}/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ depth, force: false }),
    }), "Đã đưa các PGN chưa phân tích của giải vào hàng đợi.");
  }

  return <div className={styles.page}>
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>ACADEMY V5 · PRACTICAL PROFILE</p><h1>Phân Tích Ván Thực Chiến</h1><p>Stockfish đọc PGN giải đấu, đánh dấu thời điểm mất ưu thế và gom thành Practical Profile. Dữ liệu này không tự trừ Skill Mastery.</p></div>
      <button className={styles.refresh} onClick={() => void load()}>↻ Làm mới</button>
    </section>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}
    {!overview?.engineAvailable && <div className={styles.error}>Stockfish backend chưa sẵn sàng. Hãy cấu hình <code>STOCKFISH_PATH</code> trước khi chạy phân tích PGN.</div>}

    <section className={styles.grid}>
      <article className={styles.metric}><span>PGN có thể phân tích</span><strong>{overview?.gamesWithPgn ?? 0}</strong><small>{overview?.notStarted ?? 0} chưa chạy · {overview?.stale ?? 0} PGN đã đổi</small></article>
      <article className={styles.metric}><span>Đang chạy</span><strong>{overview?.running ?? 0}</strong><small>worker chạy tuần tự để không ép máy</small></article>
      <article className={styles.metric}><span>Hoàn tất</span><strong>{overview?.completed ?? 0}</strong><small>đã tạo Practical Profile</small></article>
      <article className={styles.metric}><span>Lỗi</span><strong>{overview?.failed ?? 0}</strong><small>có thể retry sau khi sửa PGN/Stockfish</small></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h2>Cấu hình phân tích</h2><span>Depth cao hơn chính xác hơn nhưng chậm hơn.</span></div></div>
      <div className={styles.toolbar}><label>Stockfish depth<select className={styles.select} value={depth} onChange={e => setDepth(Number(e.target.value))}>{[8,10,12,14,16,18].map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
    </section>

    <div className={local.groups}>{tournamentGroups.map(group => <section className={styles.panel} key={group.id}>
      <div className={styles.panelHead}><div><h2>{group.title}</h2><span>{group.games.length} bàn có PGN</span></div><button className={styles.button} disabled={Boolean(busy) || !overview?.engineAvailable} onClick={() => void startTournament(group.id)}>Phân tích PGN chưa chạy</button></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Vòng / Bàn</th><th>Ván</th><th>Kết quả</th><th>Trạng thái</th><th>Kết quả máy</th><th></th></tr></thead><tbody>{group.games.map(game => {
        const analysis = analysisByPairing.get(game.pairingId);
        return <tr key={game.pairingId}><td>V{game.round} · B{game.board}</td><td><strong>{game.whiteName}</strong><br/><small>{game.blackName}</small></td><td>{game.result}</td><td><span className={styles.badge}>{game.stale ? "PGN đã đổi" : statusLabel[game.analysisStatus] ?? game.analysisStatus}</span></td><td>{analysis ? <><strong>{analysis.moments} điểm cần xem</strong><br/><small>{analysis.moves} ply · depth {analysis.depth}{analysis.error ? ` · ${analysis.error}` : ""}</small></> : "—"}</td><td><button className={styles.button} disabled={Boolean(busy) || !overview?.engineAvailable || game.analysisStatus === "running" || game.analysisStatus === "queued"} onClick={() => void startGame(game)}>{game.stale || game.analysisStatus === "failed" ? "Phân tích lại" : game.analysisStatus === "completed" ? "Đã xong" : "Phân tích"}</button></td></tr>;
      })}</tbody></table></div>
    </section>)}</div>

    {!games.length && <section className={styles.panel}><p className={styles.empty}>Chưa có bàn đấu nào vừa có kết quả vừa có PGN. Hãy nhập PGN ở trang Giải Đấu trước.</p></section>}
  </div>;
}
