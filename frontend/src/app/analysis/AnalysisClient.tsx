"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
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
import {
  recognizeBookDiagram,
  warmUpBookRecognizer,
} from "@/lib/bookRecognizer";
import {
  analyzeWithBrowserStockfish,
  type LocalEngineLine,
} from "@/lib/browserStockfish";

type RecognitionResult = {
  source: "Fenshot" | "PyTorch";
  fen: string;
  piecePlacement: string;
  suggestedOrientation: "white" | "black";
  orientationConfidence: number;
  averageConfidence: number;
  minConfidence?: number;
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

type PanelTab = "edit" | "fen" | "engine";

const START_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const PIECE_ORDER = ["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"];

function legalFen(fen: string): boolean {
  try {
    return new Chess(fen).isGameOver() || new Chess(fen).isPositionValid?.() !== false || true;
  } catch {
    return false;
  }
}

function strictLegalFen(fen: string): boolean {
  try {
    const game = new Chess(fen);
    return Boolean(game);
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
  const [activeTab, setActiveTab] = useState<PanelTab>("edit");

  const [lines, setLines] = useState<LocalEngineLine[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [engineDepth, setEngineDepth] = useState(16);

  const [bookPositions, setBookPositions] = useState<Position[]>([]);
  const [savedFen, setSavedFen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fen = useMemo(
    () => buildFen(placement, sideToMove, castling, enPassant),
    [placement, sideToMove, castling, enPassant],
  );
  const isLegal = useMemo(() => strictLegalFen(fen), [fen]);

  useEffect(() => {
    setFenInput(fen);
  }, [fen]);

  useEffect(() => {
    void warmUpBookRecognizer();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    void fetch(`${API_BASE}/api/books/${jobId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as UploadResponse;
      })
      .then((book) => {
        if (book) setBookPositions(book.positions ?? []);
      })
      .catch(() => {});
  }, [jobId]);

  function commitPlacement(next: string, addHistory = true) {
    if (next === placement) return;
    if (addHistory) {
      setHistory((items) => [...items.slice(-39), placement]);
    }
    setPlacement(next);
    setLines([]);
    setWarnings([]);
    setSavedFen((current) => (current === fen ? current : current));
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

  const fetchSavedFen = useCallback(async () => {
    if (!jobId || positionId < 1) return null;
    try {
      const response = await fetch(
        `${API_BASE}/api/books/${jobId}/positions/${positionId}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      const data = await response.json();
      return (data.savedFen as string | null) ?? null;
    } catch {
      return null;
    }
  }, [jobId, positionId]);

  const recognizeWithBackend = useCallback(async (): Promise<RecognitionResult> => {
    const response = await fetch(`${API_BASE}/api/recognize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, positionId, force: false }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail ?? "AI recognition failed");
    return { ...data, source: "PyTorch" } as RecognitionResult;
  }, [jobId, positionId]);

  const recognize = useCallback(
    async (force = false) => {
      if (!jobId || positionId < 1 || !imageUrl) {
        setMessage("Thiếu dữ liệu thế cờ. Hãy quay lại gallery và mở lại.");
        return;
      }

      setRecognizing(true);
      setMessage("AI đang đọc hình cờ…");
      setWarnings([]);

      try {
        const savedPromise = fetchSavedFen();
        let result: RecognitionResult | null = null;

        try {
          const browser = await recognizeBookDiagram(imageUrl);
          if (browser) {
            const warnings: string[] = [];
            if (!browser.plausible) {
              warnings.push("AI chưa chắc đây là một thế cờ hợp lệ; hãy kiểm tra quân.");
            }
            if (!browser.reliable) {
              warnings.push("Một số ô có độ tin cậy thấp và đã được đánh dấu để kiểm tra.");
            }

            result = {
              source: "Fenshot",
              fen: buildFen(browser.placement, "w", "-", "-"),
              piecePlacement: browser.placement,
              suggestedOrientation: browser.orientation,
              orientationConfidence: 1,
              averageConfidence: browser.meanConfidence,
              minConfidence: browser.minConfidence,
              lowConfidenceThreshold: 0.7,
              uncertainSquares: browser.uncertainSquares,
              squareConfidence: browser.squareConfidence,
              sideToMove: "w",
              candidates: {
                whiteBottom: browser.whiteBottom,
                blackBottom: browser.blackBottom,
              },
              confidenceCandidates: browser.confidenceCandidates,
              warnings,
            };
          }
        } catch {
          result = null;
        }

        if (!result) {
          result = await recognizeWithBackend();
        }

        if (force && result.source === "PyTorch") {
          const response = await fetch(`${API_BASE}/api/recognize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, positionId, force: true }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail ?? "AI recognition failed");
          result = { ...data, source: "PyTorch" } as RecognitionResult;
        }

        setRecognition(result);
        setWarnings(result.warnings ?? []);
        applyCandidate(result, result.suggestedOrientation, "w");

        const saved = await savedPromise;
        if (saved) {
          applyFullFen(saved);
          setSavedFen(saved);
          setMessage(`Đã đọc bằng ${result.source} và nạp bản bạn đã lưu trước đó.`);
        } else {
          setSavedFen(null);
          setMessage(
            `Đã đọc bằng ${result.source} · độ tin cậy trung bình ${Math.round(
              result.averageConfidence * 100,
            )}%.`,
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
    [
      applyCandidate,
      applyFullFen,
      fetchSavedFen,
      imageUrl,
      jobId,
      positionId,
      recognizeWithBackend,
    ],
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
        strictLegalFen(
          buildFen(
            parsed.placement,
            parsed.sideToMove,
            parsed.castling,
            parsed.enPassant,
          ),
        )
          ? "Đã nạp FEN."
          : "FEN đã nạp nhưng vị trí chưa hợp lệ.",
      );
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
  }

  function resetToAi() {
    if (!recognition) return;
    applyCandidate(recognition, imageOrientation, sideToMove);
    setWarnings(recognition.warnings ?? []);
    setSavedFen(null);
    setMessage("Đã khôi phục vị trí AI.");
  }

  async function saveCurrentPosition() {
    if (!jobId || positionId < 1 || !isLegal) return;
    setSaving(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/books/${jobId}/positions/${positionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Không lưu được thế cờ");
      setSavedFen(data.fen);
      if (data.fen && data.fen !== fen) applyFullFen(data.fen);
      setMessage("Đã lưu bản thế cờ đã sửa.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Không lưu được thế cờ");
    } finally {
      setSaving(false);
    }
  }

  async function copyFen() {
    try {
      await navigator.clipboard.writeText(fen);
      setMessage("Đã copy FEN.");
    } catch {
      setMessage("Không copy tự động được.");
    }
  }

  function openLichess() {
    if (!isLegal) return;
    window.open(lichessAnalysisUrl(fen), "_blank", "noopener,noreferrer");
  }

  async function openChessCom() {
    if (!isLegal) return;
    window.open(chessComAnalysisUrl(fen), "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(fen);
    } catch {}
  }

  async function analyzeLocal() {
    if (!isLegal) {
      setMessage("Hãy sửa thế cờ thành vị trí hợp lệ trước.");
      return;
    }

    setAnalyzing(true);
    setLines([]);
    setActiveTab("engine");
    setMessage("Stockfish 19 đang tính ngay trên máy…");

    try {
      const result = await analyzeWithBrowserStockfish(fen, engineDepth, 3);
      setLines(result);
      setMessage(
        result.length
          ? "Stockfish local đã phân tích xong."
          : "Stockfish không trả về biến thể.",
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Không chạy được Stockfish local.",
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

  const currentPositionIndex = bookPositions.findIndex(
    (position) => position.id === positionId,
  );
  const previousPosition =
    currentPositionIndex > 0 ? bookPositions[currentPositionIndex - 1] : null;
  const nextPosition =
    currentPositionIndex >= 0 && currentPositionIndex < bookPositions.length - 1
      ? bookPositions[currentPositionIndex + 1]
      : null;

  function analysisHref(position: Position) {
    return `/analysis?job=${jobId}&position=${position.id}&image=${encodeURIComponent(
      position.imageUrl,
    )}`;
  }

  return (
    <main className="analysisApp">
      <header className="analysisTopbar">
        <div className="analysisBrand">
          <strong>Chess Book Reader</strong>
          <span>Thế #{positionId || "—"}</span>
          {recognition && (
            <span className="aiChip">
              {recognition.source} · {Math.round(recognition.averageConfidence * 100)}%
            </span>
          )}
        </div>

        <nav className="analysisNav">
          {previousPosition && (
            <Link className="button compactButton" href={analysisHref(previousPosition)}>
              ← Trước
            </Link>
          )}
          <Link className="button compactButton" href="/">
            Gallery
          </Link>
          {nextPosition && (
            <Link className="button compactButton" href={analysisHref(nextPosition)}>
              Sau →
            </Link>
          )}
        </nav>
      </header>

      <div className="analysisWorkspace">
        <section className="workspacePane sourcePane">
          <div className="paneHeader">
            <div>
              <strong>Ảnh từ sách</strong>
              <span className="paneMeta">
                {recognizing ? "Đang nhận dạng…" : message || "Ảnh gốc để đối chiếu"}
              </span>
            </div>
            <button
              className="button compactButton"
              onClick={() => void recognize(true)}
              disabled={recognizing}
            >
              Nhận dạng lại
            </button>
          </div>

          <div className="sourceStage">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Chess diagram from book" />
            ) : (
              <span className="subtle">Không có ảnh nguồn.</span>
            )}
          </div>

          <div className="sourceStatus">
            <div>
              <span>AI</span>
              <strong>{recognition?.source ?? "—"}</strong>
            </div>
            <div>
              <span>Tin cậy</span>
              <strong>
                {recognition
                  ? `${Math.round(recognition.averageConfidence * 100)}%`
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Cần kiểm tra</span>
              <strong>{uncertainSquares.length}</strong>
            </div>
          </div>
        </section>

        <section className="workspacePane boardPane">
          <div className="boardToolbar compactBoardToolbar">
            <div className="segmented compact">
              <button
                className={editMode ? "active" : ""}
                onClick={() => {
                  setEditMode(true);
                  setActiveTab("edit");
                }}
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
              {isLegal ? "✓ Hợp lệ" : "⚠ Chưa hợp lệ"}
            </span>
          </div>

          <div className="boardStage">
            <Chessboard options={boardOptions} />
          </div>

          <div className="boardQuickbar">
            <div className="segmented miniSegmented">
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
            <button
              className="button compactButton"
              onClick={() =>
                setBoardOrientation((value) =>
                  value === "white" ? "black" : "white",
                )
              }
            >
              Lật bàn
            </button>
          </div>
        </section>

        <aside className="workspacePane toolsPane">
          <div className="toolTabs">
            <button
              className={activeTab === "edit" ? "active" : ""}
              onClick={() => setActiveTab("edit")}
            >
              Sửa quân
            </button>
            <button
              className={activeTab === "fen" ? "active" : ""}
              onClick={() => setActiveTab("fen")}
            >
              FEN
            </button>
            <button
              className={activeTab === "engine" ? "active" : ""}
              onClick={() => setActiveTab("engine")}
            >
              Phân tích
            </button>
          </div>

          <div className="toolBody">
            {activeTab === "edit" && (
              <div className="compactToolSection">
                {uncertainSquares.length > 0 && (
                  <div className="reviewStrip">
                    <span>Ô AI chưa chắc:</span>
                    <div>
                      {uncertainSquares.map((square) => (
                        <button
                          key={square}
                          onClick={() => {
                            setSelectedSquare(square);
                            setEditMode(true);
                          }}
                        >
                          {square}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="selectedInfo">
                  <span>Ô đang chọn</span>
                  <strong>
                    {selectedSquare ?? "—"}
                    {selectedPiece ? ` · ${PIECE_TO_UNICODE[selectedPiece]}` : ""}
                    {selectedConfidence !== undefined
                      ? ` · ${Math.round(selectedConfidence * 100)}%`
                      : ""}
                  </strong>
                </div>

                <div className="piecePalette compactPalette">
                  {PIECE_ORDER.map((piece) => (
                    <button
                      key={piece}
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

                <div className="toolActionGrid">
                  <button
                    className="button"
                    onClick={undoEdit}
                    disabled={history.length === 0}
                  >
                    Hoàn tác
                  </button>
                  <button
                    className="button"
                    onClick={() => commitPlacement(clearPlacement())}
                  >
                    Xóa bàn
                  </button>
                  <button
                    className="button"
                    onClick={resetToAi}
                    disabled={!recognition}
                  >
                    Khôi phục AI
                  </button>
                  <button
                    className="button"
                    onClick={() => setPaintPiece(undefined)}
                  >
                    Dừng công cụ
                  </button>
                </div>

                {recognition && (
                  <>
                    <span className="controlLabel">Hướng hình trong sách</span>
                    <div className="segmented">
                      <button
                        className={imageOrientation === "white" ? "active" : ""}
                        onClick={() => chooseImageOrientation("white")}
                      >
                        Trắng dưới
                      </button>
                      <button
                        className={imageOrientation === "black" ? "active" : ""}
                        onClick={() => chooseImageOrientation("black")}
                      >
                        Đen dưới
                      </button>
                    </div>
                  </>
                )}

                {warnings.length > 0 && (
                  <div className="warningBox compactWarning">
                    {warnings.map((warning) => (
                      <p key={warning}>⚠ {warning}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "fen" && (
              <div className="compactToolSection">
                <label className="controlLabel" htmlFor="fen">
                  FEN hiện tại
                </label>
                <textarea
                  id="fen"
                  className="compactFenInput"
                  value={fenInput}
                  onChange={(event) => setFenInput(event.target.value)}
                  rows={4}
                />

                <div className="toolActionGrid">
                  <button className="button" onClick={loadFen}>
                    Nạp FEN
                  </button>
                  <button className="button" onClick={() => void copyFen()}>
                    Copy FEN
                  </button>
                  <button
                    className="button saveButton"
                    onClick={() => void saveCurrentPosition()}
                    disabled={!isLegal || saving}
                  >
                    {saving
                      ? "Đang lưu…"
                      : savedFen === fen
                        ? "✓ Đã lưu"
                        : "Lưu bản sửa"}
                  </button>
                </div>

                <span className="controlLabel">Quyền nhập thành</span>
                <div className="castlingGrid compactCastling">
                  {(["K", "Q", "k", "q"] as const).map((right) => (
                    <label key={right}>
                      <input
                        type="checkbox"
                        checked={castling !== "-" && castling.includes(right)}
                        onChange={() => toggleCastling(right)}
                      />
                      {right}
                    </label>
                  ))}
                </div>

                <label className="epField">
                  <span className="controlLabel">En passant</span>
                  <input
                    value={enPassant}
                    onChange={(event) => setEnPassant(event.target.value || "-")}
                    placeholder="-"
                  />
                </label>
              </div>
            )}

            {activeTab === "engine" && (
              <div className="compactToolSection engineTools">
                <div className="engineControlRow">
                  <label>
                    <span>Depth</span>
                    <select
                      value={engineDepth}
                      onChange={(event) => setEngineDepth(Number(event.target.value))}
                    >
                      {[12, 14, 16, 18, 20].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    onClick={() => void analyzeLocal()}
                    disabled={analyzing || !isLegal}
                  >
                    {analyzing ? "Đang tính…" : "Stockfish 19 local"}
                  </button>
                </div>

                <div className="externalActions">
                  <button className="button" onClick={openLichess} disabled={!isLegal}>
                    Lichess ↗
                  </button>
                  <button
                    className="button"
                    onClick={() => void openChessCom()}
                    disabled={!isLegal}
                  >
                    Chess.com ↗
                  </button>
                </div>

                <div className="compactEngineLines">
                  {lines.length === 0 ? (
                    <p className="subtle">
                      Stockfish chạy ngay trong trình duyệt, không cần cài file .exe.
                    </p>
                  ) : (
                    lines.map((line, index) => (
                      <div className="compactEngineLine" key={line.multipv}>
                        <strong>
                          #{index + 1}{" "}
                          {line.mate !== null
                            ? `M${line.mate}`
                            : `${line.evaluation >= 0 ? "+" : ""}${line.evaluation.toFixed(2)}`}
                        </strong>
                        <span>{line.san}</span>
                        <small>d{line.depth}</small>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {message && <div className="toolFooter">{message}</div>}
        </aside>
      </div>
    </main>
  );
}
