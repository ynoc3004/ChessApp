"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Chessboard } from "react-chessboard";
import { API_BASE } from "@/lib/api";
import styles from "../practical.module.css";

const TOKEN_KEY = "chessapp:academy-token";

type Moment = {
  ply: number; moveNo: number; color: string; san: string; uci: string; fenBefore: string;
  bestMoveUci?: string | null; bestLine: string; bestScoreCp: number; playedScoreCp: number;
  cpLoss: number; severity: string; missedWin: boolean; category: string; categoryLabel: string;
};
type Report = {
  analysis: { id: string; tournamentTitle?: string | null; round?: number | null; board?: number | null; whiteName?: string | null; blackName?: string | null; result: string; depth: number; moves: number; moments: number };
  moments: Moment[];
};

const severityLabel: Record<string, string> = { inaccuracy: "Inaccuracy", mistake: "Mistake", blunder: "Blunder" };

export default function PracticalGameDetailPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) { setError("Hãy đăng nhập Học Viện trước."); return; }
    void fetch(`${API_BASE}/api/academy/game-analysis/games/${params.id}`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { if (!response.ok) throw new Error("Không tải được báo cáo ván."); return response.json() as Promise<Report>; })
      .then(data => { setReport(data); setSelected(0); })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Không tải được báo cáo."));
  }, [params.id]);

  const moment = report?.moments[selected];
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/academy/practical">← Practical Profile</Link><Link href="/realms">Bí Cảnh →</Link></header>
    {error && <section className={styles.panel}><p>{error}</p></section>}
    {report && <>
      <section className={styles.hero}><p>VÁN THỰC CHIẾN · DEPTH {report.analysis.depth}</p><h1>{report.analysis.tournamentTitle || "Giải đấu"} · V{report.analysis.round ?? "—"} B{report.analysis.board ?? "—"}</h1><p>{report.analysis.whiteName} — {report.analysis.blackName} · {report.analysis.result}. Stockfish đánh dấu {report.moments.length} thời điểm của riêng bạn vượt ngưỡng phân tích.</p></section>
      {!report.moments.length ? <section className={styles.panel} style={{ marginTop: 18 }}><h2>Không có lỗi lớn theo ngưỡng hiện tại</h2><p className={styles.muted}>Không có nước của bạn mất từ 80 centipawn trở lên ở depth đã dùng.</p></section> : <section className={styles.boardGrid} style={{ marginTop: 18 }}>
        <article className={styles.panel}>
          <Chessboard options={{ id: "practical-board", position: moment?.fenBefore || "start", boardOrientation: moment?.color === "black" ? "black" : "white", allowDragging: false, darkSquareStyle: { backgroundColor: "#9f8974" }, lightSquareStyle: { backgroundColor: "#f6e6cc" } }} />
          {moment && <div style={{ marginTop: 16 }}><h2>Nước {moment.moveNo}{moment.color === "black" ? "…" : "."} {moment.san}</h2><div className={styles.severity}><span>{severityLabel[moment.severity] ?? moment.severity}</span><span>Mất {Math.round(moment.cpLoss / 100 * 10) / 10} pawn</span><span>{moment.categoryLabel}</span>{moment.missedWin && <span>Bỏ lỡ ưu thế thắng</span>}</div><p className={styles.muted}>Phân loại “{moment.categoryLabel}” là heuristic phục vụ chọn bài luyện; Stockfish chỉ xác định chênh lệch nước đi, không xác định suy nghĩ của người chơi.</p><p><strong>Nước máy:</strong> <code>{moment.bestMoveUci || "—"}</code></p><p className={styles.line}><strong>PV:</strong> {moment.bestLine || "—"}</p><p className={styles.muted}>Eval tốt nhất: {(moment.bestScoreCp / 100).toFixed(2)} · sau nước đã đi: {(moment.playedScoreCp / 100).toFixed(2)}</p></div>}
        </article>
        <aside className={styles.panel}><h2>Các thời điểm cần xem</h2><div className={styles.moments}>{report.moments.map((item, index) => <button className={styles.moment} data-active={index === selected} key={`${item.ply}-${item.uci}`} onClick={() => setSelected(index)}><strong>{item.moveNo}{item.color === "black" ? "…" : "."} {item.san} · {item.categoryLabel}</strong><small>{severityLabel[item.severity] ?? item.severity} · CP loss {item.cpLoss}{item.missedWin ? " · missed win" : ""}</small></button>)}</div></aside>
      </section>}
    </>}
  </main>;
}
