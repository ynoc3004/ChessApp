"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
import { Chess } from "chess.js";
import BaguaSeal from "@/components/BaguaSeal";
import SavePosition from "@/components/SavePosition";
import { API_BASE } from "@/lib/api";
import { attemptPuzzle, startPuzzle, type Puzzle } from "@/lib/puzzle";
import { chessComAnalysisUrl, lichessAnalysisUrl } from "@/lib/fen";
import { analyzeWithBrowserStockfish, type LocalEngineLine } from "@/lib/browserStockfish";
import styles from "./realms.module.css";
const gates = [
  ["Càn · Thiên Cơ", "", "Tổng hợp"], ["Đoài · Song Kích", "fork", "Đòn đôi"],
  ["Ly · Liệt Hỏa", "mate", "Chiếu hết"], ["Chấn · Kinh Lôi", "discoveredAttack", "Tấn công mở"],
  ["Tốn · Du Phong", "quietMove", "Nước đi yên lặng"], ["Khảm · Huyền Thủy", "defensiveMove", "Phòng thủ"],
  ["Cấn · Sơn Trận", "pin", "Ghim quân"], ["Khôn · Quy Nguyên", "endgame", "Tàn cuộc"],
];
export default function RealmsPage() {
  const [gate, setGate] = useState(0), [minimum, setMinimum] = useState(800), [maximum, setMaximum] = useState(2000);
  const [status, setStatus] = useState<{ ready: boolean; count: number } | null>(null);
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]), [index, setIndex] = useState(0);
  const [fen, setFen] = useState(""), [ply, setPly] = useState(1), [done, setDone] = useState(false);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [hinted, setHinted] = useState(false), [mistakes, setMistakes] = useState(0);
  const [solved, setSolved] = useState(0), [clean, setClean] = useState(0);
  const [lines, setLines] = useState<LocalEngineLine[]>([]), [analyzing, setAnalyzing] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const generation = useRef(0);
  const puzzle = puzzles[index];
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, []);
  async function refresh() {
    try { const r = await fetch(`${API_BASE}/api/puzzles/status`); if (!r.ok) throw Error(); setStatus(await r.json()); setMessage(""); }
    catch { setMessage("Chưa kết nối được backend. Hãy bật dịch vụ xử lý sách rồi thử lại."); }
  }
  function open(p: Puzzle) {
    generation.current++; setAnalyzing(false);
    const game = startPuzzle(p); setFen(game.fen()); setOrientation(game.turn() === "w" ? "white" : "black");
    setPly(1); setDone(false); setHinted(false); setMistakes(0); setLines([]); setPromotion(null); setMessage("Tìm nước đi tốt nhất.");
  }
  async function begin() {
    if (minimum > maximum) { setMessage("Khoảng độ khó chưa hợp lệ."); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/puzzles/session?theme=${gates[gate][1]}&minimum=${minimum}&maximum=${maximum}&limit=10`);
      const data = await r.json(); if (!r.ok) throw Error(data.detail || "Không tải được câu đố.");
      if (!data.puzzles.length) { setMessage("Không có bài phù hợp. Hãy đổi chủ đề hoặc khoảng độ khó."); return; }
      setPuzzles(data.puzzles); setIndex(0); setSolved(0); setClean(0); open(data.puzzles[0]);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Không tải được."); }
    finally { setBusy(false); }
  }
  function submitMove(from: string, to: string, promote = "") {
    if (!puzzle || done || busy) return false;
    const result = attemptPuzzle(puzzle, fen, ply, from + to + promote);
    if (!result) { setMistakes(n => n + 1); setMessage("Chưa đúng. Thế cờ được giữ nguyên để bạn thử lại."); return false; }
    setFen(result.fen); setPly(result.ply); setDone(result.done); setMessage(result.done ? "Đã vượt qua thế cờ!" : "Đúng rồi. Đối thủ đã đáp trả, tiếp tục nhé.");
    if (result.done) {
      setSolved(n => n + 1); if (!hinted && mistakes === 0) setClean(n => n + 1);
      try {
        const history = JSON.parse(localStorage.getItem("chess:realm-history") || "{}");
        history[puzzle.id] = { mistakes, hinted, completedAt: Date.now() };
        localStorage.setItem("chess:realm-history", JSON.stringify(history));
      } catch { /* Training remains available if browser storage is disabled. */ }
    }
    return true;
  }
  function drop({ sourceSquare, targetSquare }: PieceDropHandlerArgs) {
    if (!targetSquare || !fen || done || busy || promotion) return false;
    const game = new Chess(fen);
    const legal = game.moves({ verbose: true }).filter(m => m.from === sourceSquare && m.to === targetSquare);
    if (!legal.length) return false;
    if (legal.some(m => m.promotion)) { setPromotion({ from: sourceSquare, to: targetSquare }); return false; }
    return submitMove(sourceSquare, targetSquare);
  }
  async function analyze() {
    const token = generation.current; setAnalyzing(true);
    try { const result = await analyzeWithBrowserStockfish(fen, 14, 3); if (token === generation.current) setLines(result); }
    catch (e) { if (token === generation.current) setMessage(e instanceof Error ? e.message : "Stockfish chưa sẵn sàng."); }
    finally { if (token === generation.current) setAnalyzing(false); }
  }
  return <main className={styles.page}>
    <header><Link href="/">← Quét sách & phân tích</Link><Link href="/collection">Tàng Kinh Các →</Link></header>
    <section className={styles.gateway}>
      <div><p className={styles.kicker}>LUYỆN TẬP BỔ SUNG · LICHESS</p><h1>Bát Quái Bí Cảnh</h1><p>Chọn một cửa, luyện từng thế. Sách và bàn phân tích của bạn vẫn ở trang chính.</p>
        <div className={styles.gates}>{gates.map(([name, , topic], i) => <button key={name} aria-pressed={gate === i} disabled={busy || !!puzzle && !done} onClick={() => setGate(i)}><strong>{name}</strong><small>{topic}</small></button>)}</div>
      </div><div className={styles.seal} style={{ transform: `rotate(${gate * 45}deg)` }}><BaguaSeal /></div>
    </section>
    <section className={styles.panel}>
      {status?.ready ? <p>Kho đã nhập: {status.count.toLocaleString("vi-VN")} câu · Nguồn Lichess, CC0.</p> : <div><h2>Nhập kho câu đố một lần</h2><p>Tải <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noreferrer">database câu đố chính thức</a>, rồi làm theo <a href="https://github.com/ynoc3004/ChessApp/blob/codex/refine-library-experience/docs/BI-CANH.md" target="_blank" rel="noreferrer">hướng dẫn cài Bí Cảnh</a>. Không cần giải nén tệp .csv.zst.</p><button onClick={() => void refresh()}>Kiểm tra lại kho</button></div>}
      <div className={styles.controls}><label>Rating từ<input type="number" min={0} max={4000} value={minimum} onChange={e => setMinimum(Number(e.target.value))} /></label><label>Đến<input type="number" min={0} max={4000} value={maximum} onChange={e => setMaximum(Number(e.target.value))} /></label><button disabled={busy || !status?.ready || !!puzzle && !done} onClick={() => void begin()}>{busy ? "Đang mở…" : "Mở bí cảnh · tối đa 10 bài"}</button></div>
      <p role="status">{message}</p>
    </section>
    {puzzle && <section className={styles.training}>
      <div className={styles.panel}><h2>Thế {index + 1}/{puzzles.length} · {orientation === "white" ? "Trắng" : "Đen"} đi</h2>
        <Chessboard options={{ id: "realm-board", position: fen, boardOrientation: orientation, onPieceDrop: drop, allowDragging: !done && !busy && !promotion, darkSquareStyle: { backgroundColor: "#9f8974" }, lightSquareStyle: { backgroundColor: "#f6e6cc" } }} />
        {promotion && <div role="group" aria-label="Chọn quân phong cấp">{[["q", "Hậu"], ["r", "Xe"], ["b", "Tượng"], ["n", "Mã"]].map(([piece, label]) => <button key={piece} onClick={() => { submitMove(promotion.from, promotion.to, piece); setPromotion(null); }}>{label}</button>)}<button onClick={() => setPromotion(null)}>Hủy</button></div>}
      </div>
      <aside className={styles.panel}><p className={styles.kicker}>{gates[gate][0]}</p><h2>Luyện tập từng nước</h2><p>Đã giải: {solved} · Không sai/gợi ý: {clean}</p><p>Số lần sai bài này: {mistakes}{hinted ? " · Đã dùng gợi ý" : ""}</p>
        {!done && <><button onClick={() => { setHinted(true); setMessage(`Thử quan sát quân ở ô ${puzzle.moves.split(/\s+/)[ply].slice(0, 2)}.`); }}>Gợi ý quân cần đi</button><button onClick={() => { setHinted(true); setMessage(`Nước tiếp theo: ${puzzle.moves.split(/\s+/)[ply]}.`); }}>Xem nước tiếp theo</button></>}
        <SavePosition position={{ id: `lichess:${puzzle.id}`, title: `Lichess #${puzzle.id}`, fen: startPuzzle(puzzle).fen(), source: "lichess", sourcePath: `https://lichess.org/training/${puzzle.id}`, themes: puzzle.themes }} />
        {done && <><p>Rating Lichess: {puzzle.rating} · Chủ đề: {puzzle.themes}</p>{index + 1 < puzzles.length ? <button onClick={() => { setIndex(index + 1); open(puzzles[index + 1]); }}>Thế tiếp theo →</button> : <p>Hoàn thành lượt luyện. Bạn có thể chọn cửa khác và mở lượt mới.</p>}<button disabled={analyzing} onClick={() => void analyze()}>{analyzing ? "Stockfish đang phân tích…" : "Phân tích vị trí hiện tại bằng Stockfish"}</button><p><a href={lichessAnalysisUrl(fen)} target="_blank" rel="noreferrer">Mở Lichess</a> · <a href={chessComAnalysisUrl(fen)} target="_blank" rel="noreferrer">Mở chess.com</a></p>{lines.map(line => <p key={line.multipv}>{line.san}</p>)}</>}
      </aside>
    </section>}
  </main>;
}
