"use client";

import { useCallback, useEffect, useState } from "react";
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

type RecognitionResult = {
  fen: string;
  piecePlacement: string;
  suggestedOrientation: "white" | "black";
  orientationConfidence: number;
  sideToMove: "w" | "b";
  candidates: {
    whiteBottom: string;
    blackBottom: string;
  };
  warnings: string[];
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function buildFen(piecePlacement: string, side: "w" | "b") {
  return `${piecePlacement} ${side} - - 0 1`;
}

export default function AnalysisClient({
  imageUrl,
  jobId,
  positionId,
}: {
  imageUrl: string;
  jobId: string;
  positionId: number;
}) {
  const [fenInput, setFenInput] = useState(START);
  const [fen, setFen] = useState(START);
  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");
  const [imageOrientation, setImageOrientation] = useState<"white" | "black">("white");
  const [sideToMove, setSideToMove] = useState<"w" | "b">("w");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  const applyCandidate = useCallback(
    (result: RecognitionResult, orientation: "white" | "black", side: "w" | "b") => {
      const placement = orientation === "white"
        ? result.candidates.whiteBottom
        : result.candidates.blackBottom;
      const nextFen = buildFen(placement, side);
      setImageOrientation(orientation);
      setBoardOrientation(orientation);
      setSideToMove(side);
      setFen(nextFen);
      setFenInput(nextFen);
      setLines([]);
    },
    [],
  );

  const recognize = useCallback(async (force = false) => {
    if (!jobId || positionId < 1) {
      setMessage("Thiếu mã thế cờ để AI nhận dạng. Hãy quay lại gallery và mở thế cờ từ đó.");
      return;
    }

    setRecognizing(true);
    setMessage("AI đang đọc 64 ô cờ…");
    setWarnings([]);

    try {
      const response = await fetch(`${API_BASE}/api/recognize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, positionId, force }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "AI recognition failed");

      const result = data as RecognitionResult;
      setRecognition(result);
      setWarnings(result.warnings ?? []);
      applyCandidate(result, result.suggestedOrientation, "w");
      setMessage("AI đã đọc xong. Hãy đối chiếu nhanh hình bên trái với bàn cờ bên phải trước khi chạy Stockfish.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Không nhận dạng được thế cờ");
    } finally {
      setRecognizing(false);
    }
  }, [applyCandidate, jobId, positionId]);

  useEffect(() => {
    void recognize(false);
  }, [recognize]);

  function loadFen() {
    try {
      const candidate = new Chess(fenInput);
      setFen(candidate.fen());
      setFenInput(candidate.fen());
      setLines([]);
      setMessage("FEN hợp lệ.");
      setWarnings([]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "FEN không hợp lệ");
    }
  }

  function chooseImageOrientation(next: "white" | "black") {
    if (!recognition) return;
    applyCandidate(recognition, next, sideToMove);
  }

  function chooseSide(next: "w" | "b") {
    setSideToMove(next);

    if (recognition) {
      applyCandidate(recognition, imageOrientation, next);
      return;
    }

    const parts = fenInput.trim().split(/\s+/);
    if (parts.length >= 1) {
      const nextFen = buildFen(parts[0], next);
      setFen(nextFen);
      setFenInput(nextFen);
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
      setMessage("Thế cờ hiện tại chưa hợp lệ hoặc nước đi không hợp lệ.");
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
    boardOrientation,
    onPieceDrop,
    allowDrawingArrows: true,
    showNotation: true,
  } as const;

  return (
    <main className="shell">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">PHASE 2 · IMAGE → FEN</p>
          <h1>AI đọc thế cờ và nạp lên bàn phân tích</h1>
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

          <div className="aiStatus">
            <strong>{recognizing ? "AI đang nhận dạng…" : "Nhận dạng AI"}</strong>
            <p className="subtle">
              AI chỉ đọc vị trí quân. Lượt đi, nhập thành và en passant không thể suy ra chắc chắn chỉ từ một hình cờ.
            </p>
            <button className="button" onClick={() => void recognize(true)} disabled={recognizing}>
              {recognizing ? "Đang đọc…" : "Nhận dạng lại"}
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="boardWrap">
            <Chessboard options={boardOptions} />
          </div>

          {recognition && (
            <div className="recognitionControls">
              <div>
                <span className="controlLabel">Hướng của hình trong sách</span>
                <div className="segmented">
                  <button
                    className={imageOrientation === "white" ? "active" : ""}
                    onClick={() => chooseImageOrientation("white")}
                  >
                    Trắng ở dưới
                  </button>
                  <button
                    className={imageOrientation === "black" ? "active" : ""}
                    onClick={() => chooseImageOrientation("black")}
                  >
                    Đen ở dưới
                  </button>
                </div>
              </div>

              <div>
                <span className="controlLabel">Bên đến lượt</span>
                <div className="segmented">
                  <button
                    className={sideToMove === "w" ? "active" : ""}
                    onClick={() => chooseSide("w")}
                  >
                    Trắng đi
                  </button>
                  <button
                    className={sideToMove === "b" ? "active" : ""}
                    onClick={() => chooseSide("b")}
                  >
                    Đen đi
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="fenBox">
            <label htmlFor="fen">FEN</label>
            <textarea
              id="fen"
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              rows={3}
            />
            <div className="actions">
              <button className="button" onClick={loadFen}>Nạp FEN đã sửa</button>
              <button
                className="button"
                onClick={() => setBoardOrientation((o) => (o === "white" ? "black" : "white"))}
              >
                Chỉ lật bàn hiển thị
              </button>
              <button
                className="primary"
                onClick={analyze}
                disabled={analyzing || recognizing}
              >
                {analyzing ? "Stockfish đang tính…" : "Phân tích Stockfish"}
              </button>
            </div>

            {message && <p className="notice">{message}</p>}

            {warnings.length > 0 && (
              <div className="warningBox">
                {warnings.map((warning) => <p key={warning}>⚠ {warning}</p>)}
              </div>
            )}
          </div>
        </div>
      </section>

      {lines.length > 0 && (
        <section className="panel enginePanel">
          <p className="eyebrow">STOCKFISH · TOP {lines.length}</p>
          {lines.map((line, index) => (
            <div className="engineLine" key={index}>
              <strong>
                #{index + 1}{" "}
                {line.mate !== null
                  ? `Mate ${line.mate}`
                  : `${line.evaluation >= 0 ? "+" : ""}${line.evaluation.toFixed(2)}`}
              </strong>
              <span>{line.san}</span>
              <small>depth {line.depth}</small>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
