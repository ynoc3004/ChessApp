"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Chess } from "chess.js";
import {
  Chessboard,
  type PieceDropHandlerArgs,
  type SquareHandlerArgs,
} from "react-chessboard";
import { API_BASE, type Position, type UploadResponse } from "@/lib/api";
import {
  PIECE_TO_UNICODE,
  buildFen,
  chessComAnalysisUrl,
  clearPlacement,
  getPieceAt,
  lichessAnalysisUrl,
  movePiece,
  parseFen,
  setPieceAt,
} from "@/lib/fen";

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
  averageConfidence: number;
  lowConfidenceThreshold: number;
  uncertainSquares: string[];
  squareConfidence: Record<string, number>;
  sideToMove: "w" | "b";
  candidates: {
    whiteBottom: string;
    blackBottom: string;
  };
  confidenceCandidates: {
    whiteBottom: Record<string, number>;
    blackBottom: Record<string, number>;
  };
  warnings: string[];
  savedFen?: string | null;
  savedAt?: number | null;
};

const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const PIECE_ORDER = ["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"];

function legalFen(fen: string): boolean {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
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
  const [placement, setPlacement] = useState(START_PLACEMENT);
  const [sideToMove, setSideToMove] = useState<"w" | "b">("w");
  const [castling, setCastling] = useState("-");
  const [enPassant, setEnPassant] = useState("-");
  const [fenInput, setFenInput] = useState(
    buildFen(START_PLACEMENT, "w", "KQkq", "-"),
  );

  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">("white");
  const [imageOrientation, setImageOrientation] = useState<"white" | "black">("white");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recognition, setRecognition] = useState<RecognitionResult | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [squareConfidence, setSquareConfidence] = useState<Record<string, number>>({});
  const [uncertainSquares, setUncertainSquares] = useState<string[]>([]);

  const [editMode, setEditMode] = useState(true);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [paintPiece, setPaintPiece] = useState<string | null | undefined>(undefined);
  const [history, setHistory] = useState<string[]>([]);

  const [lines, setLines] = useState<EngineLine[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [engineAvailable, setEngineAvailable] = useState<boolean | null>(null);
  const [bookPositions, setBookPositions] = useState<Position[]>([]);
  const [savedFen, setSavedFen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fen = useMemo(
    () => buildFen(placement, sideToMove, castling, enPassant),
    [placement, sideToMove, castling, enPassant],
  );
  const isLegal = useMemo(() => legalFen(fen), [fen]);

  useEffect(() => {
    setFenInput(fen);
  }, [fen]);

  useEffect(() => {
    void fetch(`${API_BASE}/api/engine-status`)
      .then((response) => response.json())
      .then((data) => setEngineAvailable(Boolean(data.available)))
      .catch(() => setEngineAvailable(false));
  }, []);

  function commitPlacement(next: string, addHistory = true) {
    if (next === placement) return;
    if (addHistory) {
      setHistory((items) => [...items.slice(-39), placement]);
    }
    setPlacement(next);
    setLines([]);
    setWarnings([]);
  }

  const applyCandidate = useCallback(
    (
      result: RecognitionResult,
      orientation: "white" | "black",
      side: "w" | "b",
    ) => {
      const nextPlacement =
        orientation === "white"
          ? result.candidates.whiteBottom
          : result.candidates.blackBottom;

      const confidence =
        orientation === "white"
          ? result.confidenceCandidates.whiteBottom
          : result.confidenceCandidates.blackBottom;
      const uncertain = Object.entries(confidence)
        .filter(([, value]) => value < result.lowConfidenceThreshold)
        .map(([square]) => square)
        .sort((a, b) => (8 - Number(a[1])) - (8 - Number(b[1])) || a.localeCompare(b));

      setPlacement(nextPlacement);
      setSquareConfidence(confidence);
      setUncertainSquares(uncertain);
      setImageOrientation(orientation);
      setBoardOrientation(orientation);
      setSideToMove(side);
      setCastling("-");
      setEnPassant("-");
      setHistory([]);
      setSelectedSquare(null);
      setPaintPiece(undefined);
      setLines([]);
    },
    [],
  );

  const applyFullFen = useCallback((fenValue: string) => {
    const parsed = parseFen(fenValue);
    setPlacement(parsed.placement);
    setSideToMove(parsed.sideToMove);
    setCastling(parsed.castling);
    setEnPassant(parsed.enPassant);
    setHistory([]);
    setSelectedSquare(null);
    setPaintPiece(undefined);
    setLines([]);
  }, []);

  const recognize = useCallback(
    async (force = false) => {
      if (!jobId || positionId < 1) {
        setMessage("Thiếu mã thế cờ. Hãy quay lại gallery và mở thế cờ từ đó.");
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

        if (result.savedFen) {
          applyFullFen(result.savedFen);
          setSavedFen(result.savedFen);
          setMessage("Đã nạp thế cờ bạn đã lưu trước đó. Bạn vẫn có thể sửa tiếp.");
        } else {
          setSavedFen(null);
          applyCandidate(result, result.suggestedOrientation, "w");
          setMessage(
            "AI đã đọc xong. Nếu có quân sai, bật chế độ sửa và click trực tiếp lên bàn.",
          );
        }
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : "Không nhận dạng được thế cờ",
        );
      } finally {
        setRecognizing(false);
      }
    },
    [applyCandidate, applyFullFen, jobId, positionId],
  );

  useEffect(() => {
    void recognize(false);
  }, [recognize]);

  function loadFen() {
    try {
      const parsed = parseFen(fenInput);
      setPlacement(parsed.placement);
      setSideToMove(parsed.sideToMove);
      setCastling(parsed.castling);
      setEnPassant(parsed.enPassant);
      setHistory([]);
      setLines([]);
      setWarnings([]);
      setMessage(
        legalFen(
          buildFen(
            parsed.placement,
            parsed.sideToMove,
            parsed.castling,
            parsed.enPassant,
          ),
        )
          ? "Đã nạp FEN hợp lệ."
          : "Đã nạp FEN để sửa, nhưng vị trí hiện chưa hợp lệ theo luật cờ vua.",
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "FEN không hợp lệ");
    }
  }

  function chooseImageOrientation(next: "white" | "black") {
    if (!recognition) return;
    applyCandidate(recognition, next, sideToMove);
    setMessage("Đã đổi hướng đọc của hình. Hãy đối chiếu lại quân.");
  }

  function chooseSide(next: "w" | "b") {
    setSideToMove(next);
    setLines([]);
  }

  function toggleCastling(right: "K" | "Q" | "k" | "q") {
    const order = ["K", "Q", "k", "q"];
    const current = new Set(castling === "-" ? [] : castling.split(""));
    if (current.has(right)) current.delete(right);
    else current.add(right);
    const next = order.filter((item) => current.has(item)).join("");
    setCastling(next || "-");
    setLines([]);
  }

  function onSquareClick({ square }: SquareHandlerArgs) {
    setSelectedSquare(square);
    if (!editMode || paintPiece === undefined) return;
    commitPlacement(setPieceAt(placement, square, paintPiece));
  }

  function onPieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs) {
    if (!targetSquare || sourceSquare === targetSquare) return false;

    if (editMode) {
      commitPlacement(movePiece(placement, sourceSquare, targetSquare));
      setSelectedSquare(targetSquare);
      return true;
    }

    try {
      const game = new Chess(fen);
      game.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      const parsed = parseFen(game.fen());
      setPlacement(parsed.placement);
      setSideToMove(parsed.sideToMove);
      setCastling(parsed.castling);
      setEnPassant(parsed.enPassant);
      setLines([]);
      setSelectedSquare(targetSquare);
      return true;
    } catch {
      setMessage("Nước đi không hợp lệ.");
      return false;
    }
  }

  function choosePaintPiece(piece: string | null) {
    setEditMode(true);
    setPaintPiece(piece);

    if (selectedSquare) {
      commitPlacement(setPieceAt(placement, selectedSquare, piece));
    }
  }

  function undoEdit() {
    const previous = history.at(-1);
    if (!previous) return;
    setPlacement(previous);
    setHistory((items) => items.slice(0, -1));
    setLines([]);
    setWarnings([]);
  }

  function resetToAi() {
    if (!recognition) return;
    applyCandidate(recognition, imageOrientation, sideToMove);
    setWarnings(recognition.warnings ?? []);
    setMessage("Đã khôi phục vị trí AI nhận dạng.");
  }

  async function copyFen() {
    try {
      await navigator.clipboard.writeText(fen);
      setMessage("Đã copy FEN vào clipboard.");
    } catch {
      setMessage("Không copy tự động được. Bạn có thể chọn FEN trong ô và copy.");
    }
  }

  function openLichess() {
    if (!isLegal) {
      setMessage("Hãy sửa thế cờ thành vị trí hợp lệ trước khi mở phân tích.");
      return;
    }
    window.open(lichessAnalysisUrl(fen), "_blank", "noopener,noreferrer");
  }

  async function openChessCom() {
    if (!isLegal) {
      setMessage("Hãy sửa thế cờ thành vị trí hợp lệ trước khi mở phân tích.");
      return;
    }

    window.open(chessComAnalysisUrl(fen), "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(fen);
      setMessage(
        "Đã mở Chess.com bằng FEN hiện tại và đồng thời copy FEN để dự phòng. Nếu Chess.com không tự nạp, chọn Load FEN rồi dán vào.",
      );
    } catch {
      setMessage(
        "Đã mở Chess.com. Hãy copy FEN ở website này rồi dùng Load FEN trên Chess.com.",
      );
    }
  }

  async function analyze() {
    if (!isLegal) {
      setMessage("Thế cờ chưa hợp lệ. Hãy sửa quân trước khi chạy Stockfish.");
      return;
    }

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
      setMessage(
        err instanceof Error ? err.message : "Không phân tích được bằng Stockfish",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const squareStyles: Record<string, CSSProperties> = {};

  for (const square of uncertainSquares) {
    squareStyles[square] = {
      boxShadow: "inset 0 0 0 4px rgba(220, 80, 55, .72)",
    };
  }

  if (selectedSquare) {
    squareStyles[selectedSquare] = {
      boxShadow: "inset 0 0 0 4px rgba(255, 196, 0, .98)",
    };
  }

  const boardOptions = {
    position: fen,
    boardOrientation,
    onPieceDrop,
    onSquareClick,
    allowDragging: true,
    allowDrawingArrows: !editMode,
    showNotation: true,
    squareStyles,
  } as const;

  const selectedPiece = selectedSquare
    ? getPieceAt(placement, selectedSquare)
    : null;
  const selectedConfidence = selectedSquare
    ? squareConfidence[selectedSquare]
    : undefined;

  return (
    <main className="shell">
      <div className="sectionHeading">
        <div>
          <p className="eyebrow">PHASE 2.1 · AI + POSITION EDITOR + ANALYSIS</p>
          <h1>Đọc thế cờ, sửa trực tiếp và phân tích</h1>
        </div>
        <Link className="button" href="/">← Quay lại</Link>
      </div>

      <section className="analysisLayout">
        <div className="panel">
          <h2>Ảnh từ sách</h2>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="sourceImage"
              src={imageUrl}
              alt="Extracted chess diagram"
            />
          ) : (
            <p className="subtle">Không có ảnh nguồn.</p>
          )}

          <div className="aiStatus">
            <strong>{recognizing ? "AI đang nhận dạng…" : "Nhận dạng AI"}</strong>
            <p className="subtle">
              AI đọc vị trí quân. Lượt đi, quyền nhập thành và en passant cần
              xác nhận thủ công nếu sách có yêu cầu.
            </p>
            <button
              className="button"
              onClick={() => void recognize(true)}
              disabled={recognizing}
            >
              {recognizing ? "Đang đọc…" : "Nhận dạng lại"}
            </button>
          </div>
        </div>

        <div className="panel">
          {recognition && (
            <div className="confidencePanel">
              <div className="confidenceSummary">
                <div>
                  <span className="controlLabel">Độ tin cậy AI trung bình</span>
                  <strong>{Math.round(recognition.averageConfidence * 100)}%</strong>
                </div>
                <div>
                  <span className="controlLabel">Ô nên kiểm tra lại</span>
                  <strong>{uncertainSquares.length}</strong>
                </div>
              </div>

              {uncertainSquares.length > 0 && (
                <div className="uncertainList">
                  {uncertainSquares.map((square) => (
                    <button
                      key={square}
                      onClick={() => {
                        setEditMode(true);
                        setSelectedSquare(square);
                      }}
                      title={`AI confidence ${Math.round((squareConfidence[square] ?? 0) * 100)}%`}
                    >
                      {square}
                      <small>{Math.round((squareConfidence[square] ?? 0) * 100)}%</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="boardToolbar">
            <div className="segmented compact">
              <button
                className={editMode ? "active" : ""}
                onClick={() => setEditMode(true)}
              >
                Sửa thế cờ
              </button>
              <button
                className={!editMode ? "active" : ""}
                onClick={() => {
                  setEditMode(false);
                  setPaintPiece(undefined);
                }}
              >
                Thử nước
              </button>
            </div>
            <span className={isLegal ? "validBadge" : "invalidBadge"}>
              {isLegal ? "✓ Vị trí hợp lệ" : "⚠ Chưa hợp lệ"}
            </span>
          </div>

          <div className="boardWrap">
            <Chessboard options={boardOptions} />
          </div>

          {editMode && (
            <div className="pieceEditor">
              <div className="editorHeading">
                <div>
                  <strong>Sửa quân bằng click</strong>
                  <p className="subtle">
                    Chọn quân bên dưới rồi click ô cần đặt. Có thể kéo quân tự
                    do khi đang ở chế độ Sửa thế cờ.
                  </p>
                </div>
                {selectedSquare && (
                  <span className="selectedSquare">
                    {selectedSquare}:{" "}
                    {selectedPiece
                      ? PIECE_TO_UNICODE[selectedPiece]
                      : "ô trống"}
                    {selectedConfidence !== undefined
                      ? ` · AI ${Math.round(selectedConfidence * 100)}%`
                      : ""}
                  </span>
                )}
              </div>

              <div className="piecePalette">
                {PIECE_ORDER.map((piece) => (
                  <button
                    key={piece}
                    title={piece}
                    className={paintPiece === piece ? "active" : ""}
                    onClick={() => choosePaintPiece(piece)}
                  >
                    {PIECE_TO_UNICODE[piece]}
                  </button>
                ))}
                <button
                  className={paintPiece === null ? "active eraseTool" : "eraseTool"}
                  onClick={() => choosePaintPiece(null)}
                >
                  Xóa
                </button>
              </div>

              <div className="actions editorActions">
                <button
                  className="button"
                  onClick={() => setPaintPiece(undefined)}
                >
                  Dừng công cụ
                </button>
                <button
                  className="button"
                  onClick={undoEdit}
                  disabled={history.length === 0}
                >
                  Hoàn tác
                </button>
                <button
                  className="button"
                  onClick={() => {
                    commitPlacement(clearPlacement());
                    setSelectedSquare(null);
                  }}
                >
                  Xóa hết bàn
                </button>
                <button
                  className="button"
                  onClick={resetToAi}
                  disabled={!recognition}
                >
                  Khôi phục AI
                </button>
              </div>
            </div>
          )}

          {recognition && (
            <div className="recognitionControls">
              <div>
                <span className="controlLabel">Hướng hình trong sách</span>
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

          <details className="advancedPosition">
            <summary>Thông tin FEN nâng cao</summary>

            <div className="advancedGrid">
              <div>
                <span className="controlLabel">Quyền nhập thành</span>
                <div className="castlingGrid">
                  {(["K", "Q", "k", "q"] as const).map((right) => (
                    <label key={right}>
                      <input
                        type="checkbox"
                        checked={castling !== "-" && castling.includes(right)}
                        onChange={() => toggleCastling(right)}
                      />
                      {right === "K" && " Trắng O-O"}
                      {right === "Q" && " Trắng O-O-O"}
                      {right === "k" && " Đen O-O"}
                      {right === "q" && " Đen O-O-O"}
                    </label>
                  ))}
                </div>
              </div>

              <label className="epField">
                <span className="controlLabel">En passant</span>
                <input
                  value={enPassant}
                  onChange={(event) => {
                    setEnPassant(event.target.value || "-");
                    setLines([]);
                  }}
                  placeholder="-"
                />
              </label>
            </div>
          </details>

          <div className="fenBox">
            <label htmlFor="fen">FEN</label>
            <textarea
              id="fen"
              value={fenInput}
              onChange={(event) => setFenInput(event.target.value)}
              rows={3}
            />

            <div className="actions">
              <button className="button" onClick={loadFen}>
                Nạp FEN đã sửa
              </button>
              <button className="button" onClick={() => void copyFen()}>
                Copy FEN
              </button>
              <button
                className="button"
                onClick={() =>
                  setBoardOrientation((value) =>
                    value === "white" ? "black" : "white",
                  )
                }
              >
                Lật bàn hiển thị
              </button>
            </div>

            {message && <p className="notice">{message}</p>}

            {warnings.length > 0 && (
              <div className="warningBox">
                {warnings.map((warning) => (
                  <p key={warning}>⚠ {warning}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel analysisActionsPanel">
        <div>
          <p className="eyebrow">PHÂN TÍCH THẾ CỜ</p>
          <h2>Chọn cách phân tích</h2>
          <p className="subtle">
            Lichess mở thẳng đúng FEN. Chess.com cũng nhận FEN qua link và
            website vẫn copy FEN vào clipboard làm phương án dự phòng. Stockfish local chỉ cần khi bạn muốn
            phân tích ngay trong website này.
          </p>
        </div>

        <div className="analysisButtons">
          <button
            className="primary bigAction"
            onClick={openLichess}
            disabled={!isLegal}
          >
            Mở phân tích trên Lichess ↗
          </button>

          <button
            className="button bigAction"
            onClick={() => void openChessCom()}
            disabled={!isLegal}
          >
            Mở phân tích trên Chess.com ↗
          </button>

          <button
            className="button bigAction"
            onClick={analyze}
            disabled={analyzing || recognizing || !isLegal || engineAvailable === false}
          >
            {analyzing
              ? "Stockfish đang tính…"
              : engineAvailable === false
                ? "Stockfish local chưa cấu hình"
                : "Phân tích Stockfish trong web"}
          </button>
        </div>

        {engineAvailable === false && (
          <p className="subtle engineHint">
            Không cần cài Stockfish để dùng website: nút Lichess phía trên đã
            mở trực tiếp thế cờ và engine trên Lichess.
          </p>
        )}
      </section>

      {lines.length > 0 && (
        <section className="panel enginePanel">
          <p className="eyebrow">STOCKFISH LOCAL · TOP {lines.length}</p>
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
