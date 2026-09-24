"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { API_BASE } from "@/lib/api";

type EngineLine = {
  evaluation: number;
  mate: number | null;
  depth: number;
  san: string;
  uci: string;
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function AnalysisClient({ imageUrl }: { imageUrl: string }) {
  const [fenInput, setFenInput] = useState(START);
  const [fen, setFen] = useState(START);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [message, setMessage] = useState("");
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  const game = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  function loadFen() {
    try {
      const candidate = new Chess(fenInput);
      setFen(candidate.fen());
      setFenInput(candidate.fen());
      setLines([]);
      setMessage("FEN hợp lệ.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "FEN không hợp lệ");
    }
  }

  function onPieceDrop({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) {
    if (!targetSquare) return false;
    try {
      const copy = new Chess(fen);
      copy.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      setFen(copy.fen());
      setFenInput(copy.fen());
      setLines([]);
      return true;
    } catch {
      return false;
    }
  }

  async function analyze() {
    setAnalyzing(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen, depth: 15, multipv: 3 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Engine error");
      setLines(data.lines);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Không phân tích được");
    } finally {
      setAnalyzing(false);
    }
  }

  const boardOptions = {
    position: fen,
    boardOrientation: orientation,
    onPieceDrop,
    allowDrawingArrows: true,
    showNotation: true,
  } as const;

  return (
    <main className="shell">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">ANALYSIS BOARD</p>
          <h1>Đối chiếu ảnh sách và bàn cờ tương tác</h1>
        </div>
        <Link className="button" href="/">← Quay lại</Link>
      </div>

      <section className="analysisLayout">
        <div className="panel">
          <h2>Ảnh từ sách</h2>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="sourceImage" src={imageUrl} alt="Extracted chess diagram" />
          ) : (
            <p className="subtle">Không có ảnh nguồn.</p>
          )}
          <p className="subtle">MVP hiện tại chưa tự đọc quân thành FEN. Hãy nhập FEN đúng của hình trước khi chạy Stockfish.</p>
        </div>

        <div className="panel">
          <div className="boardWrap">
            <Chessboard options={boardOptions} />
          </div>
          <div className="fenBox">
            <label htmlFor="fen">FEN</label>
            <textarea id="fen" value={fenInput} onChange={(e) => setFenInput(e.target.value)} rows={3} />
            <div className="actions">
              <button className="button" onClick={loadFen}>Nạp FEN</button>
              <button className="button" onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>Lật bàn cờ</button>
              <button className="primary" onClick={analyze} disabled={analyzing}>{analyzing ? "Stockfish đang tính…" : "Phân tích Stockfish"}</button>
            </div>
            {message && <p className="notice">{message}</p>}
          </div>
        </div>
      </section>

      {lines.length > 0 && (
        <section className="panel enginePanel">
          <p className="eyebrow">STOCKFISH · TOP {lines.length}</p>
          {lines.map((line, index) => (
            <div className="engineLine" key={index}>
              <strong>#{index + 1} {line.mate !== null ? `Mate ${line.mate}` : `${line.evaluation >= 0 ? "+" : ""}${line.evaluation.toFixed(2)}`}</strong>
              <span>{line.san}</span>
              <small>depth {line.depth}</small>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
