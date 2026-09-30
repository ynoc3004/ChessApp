"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
import { Chess } from "chess.js";
import BaguaSeal from "@/components/BaguaSeal";
import SavePosition from "@/components/SavePosition";
import EngineAdvantage from "@/components/EngineAdvantage";
import { API_BASE } from "@/lib/api";
import { attemptPuzzle, startPuzzle, type Puzzle } from "@/lib/puzzle";
import { chessComAnalysisUrl, lichessAnalysisUrl } from "@/lib/fen";
import { analyzeWithBrowserStockfish, type LocalEngineLine } from "@/lib/browserStockfish";
import { getDaoPath } from "@/lib/daoPaths";
import styles from "./realms.module.css";

const ACADEMY_TOKEN_KEY = "chessapp:academy-token";
const gates = [
  ["Càn · Thiên Cơ", "", "Tổng hợp"], ["Đoài · Song Kích", "fork", "Đòn đôi"],
  ["Ly · Liệt Hỏa", "mate", "Chiếu hết"], ["Chấn · Kinh Lôi", "discoveredAttack", "Tấn công mở"],
  ["Tốn · Du Phong", "quietMove", "Nước đi yên lặng"], ["Khảm · Huyền Thủy", "defensiveMove", "Phòng thủ"],
  ["Cấn · Sơn Trận", "pin", "Ghim quân"], ["Khôn · Quy Nguyên", "endgame", "Tàn cuộc"],
] as const;

type AcademyPuzzle = Puzzle & {
  academyMode?: "personalized" | "review";
  academySkill?: string;
  academyTheme?: string;
};

type SkillProgress = {
  skill: string;
  theme?: string | null;
  themeLabel: string;
  placementPercent?: number | null;
  mastery: number;
  attempts: number;
  clean: number;
  cleanRate?: number | null;
};

type AcademyProfile = {
  student: { id: string; displayName: string; currentStep: number | null; placementStatus: string; xp: number; puzzleRating: number };
  ratingRange: { minimum: number; maximum: number };
  skills: SkillProgress[];
  weakestSkills: SkillProgress[];
  recommendation: { skill: string; theme?: string | null; themeLabel: string; reason: string };
  review: { due: number; total: number };
  stats: { attempts: number; clean: number; cleanRate?: number | null; last7Days: number };
};

type TrainingSession = {
  mode: "personalized" | "review";
  puzzles: AcademyPuzzle[];
  matching: number;
  profile: AcademyProfile;
  personalization: { skill: string; theme?: string | null; themeLabel: string; minimum: number; maximum: number; reason: string };
};

type TrainingResult = {
  recorded: boolean;
  duplicate: boolean;
  clean?: boolean;
  xpAwarded: number;
  ratingDelta: number;
  ratingAfter?: number;
  mastery?: { skill: string; before: number; after: number };
  review?: { added: boolean; nextReviewAt?: number | null; intervalDays?: number | null };
  profile: AcademyProfile;
};

type MistakeBook = {
  items: { puzzleId: string; skill: string; themeLabel: string; rating?: number | null; lapses: number; nextReviewAt: number; due: boolean }[];
  total: number;
  due: number;
};

type TrainingMode = "personalized" | "review" | "manual";

async function responseError(response: Response) {
  try {
    const payload = await response.json();
    return String(payload.detail || `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export default function RealmsPage() {
  const [gate, setGate] = useState(0), [minimum, setMinimum] = useState(800), [maximum, setMaximum] = useState(2000);
  const [status, setStatus] = useState<{ ready: boolean; count: number } | null>(null);
  const [puzzles, setPuzzles] = useState<AcademyPuzzle[]>([]), [index, setIndex] = useState(0);
  const [fen, setFen] = useState(""), [ply, setPly] = useState(1), [done, setDone] = useState(false);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [hinted, setHinted] = useState(false), [mistakes, setMistakes] = useState(0);
  const [solved, setSolved] = useState(0), [clean, setClean] = useState(0);
  const [lines, setLines] = useState<LocalEngineLine[]>([]), [analyzing, setAnalyzing] = useState(false);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [pathSelection, setPathSelection] = useState<{ slug: string; name: string; module: string; theme: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [academyToken, setAcademyToken] = useState("");
  const [academyProfile, setAcademyProfile] = useState<AcademyProfile | null>(null);
  const [mistakeBook, setMistakeBook] = useState<MistakeBook | null>(null);
  const [trainingMode, setTrainingMode] = useState<TrainingMode>("manual");
  const [personalization, setPersonalization] = useState<TrainingSession["personalization"] | null>(null);
  const [academyReward, setAcademyReward] = useState("");
  const generation = useRef(0);
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const puzzleStartedAt = useRef(0);
  const reportedPuzzle = useRef("");
  const puzzle = puzzles[index];

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = getDaoPath(params.get("path") ?? "");
    const moduleIndex = Number(params.get("module"));
    if (path && Number.isInteger(moduleIndex) && moduleIndex >= 1 && moduleIndex <= path.modules.length) {
      const module = path.modules[moduleIndex - 1];
      setPathSelection({ slug: path.slug, name: path.name, module: module.title, theme: module.puzzleTheme });
      setTrainingMode("manual");
    }
    const saved = window.sessionStorage.getItem(ACADEMY_TOKEN_KEY) || "";
    if (saved) {
      setAcademyToken(saved);
      void loadAcademy(saved);
    }
    void refresh();
    return () => { generation.current++; if (openingTimer.current) clearTimeout(openingTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try { const r = await fetch(`${API_BASE}/api/puzzles/status`); if (!r.ok) throw Error(); setStatus(await r.json()); setMessage(""); }
    catch { setMessage("Chưa kết nối được backend. Hãy bật dịch vụ xử lý sách rồi thử lại."); }
  }

  async function loadAcademy(candidate = academyToken) {
    if (!candidate) return;
    try {
      const headers = { Authorization: `Bearer ${candidate}` };
      const profileResponse = await fetch(`${API_BASE}/api/academy/training/profile`, { cache: "no-store", headers });
      if (!profileResponse.ok) {
        if (profileResponse.status === 401) {
          window.sessionStorage.removeItem(ACADEMY_TOKEN_KEY);
          setAcademyToken("");
          setAcademyProfile(null);
          setTrainingMode("manual");
          return;
        }
        throw new Error(await responseError(profileResponse));
      }
      const profile = await profileResponse.json() as AcademyProfile;
      setAcademyProfile(profile);
      setMinimum(profile.ratingRange.minimum);
      setMaximum(profile.ratingRange.maximum);
      if (profile.student.placementStatus === "completed" && !pathSelection) setTrainingMode("personalized");
      const bookResponse = await fetch(`${API_BASE}/api/academy/training/mistakes?limit=8`, { cache: "no-store", headers });
      if (bookResponse.ok) setMistakeBook(await bookResponse.json() as MistakeBook);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Không tải được hồ sơ luyện tập.");
    }
  }

  function open(p: AcademyPuzzle) {
    generation.current++; setAnalyzing(false);
    const game = startPuzzle(p); setFen(game.fen()); setOrientation(game.turn() === "w" ? "white" : "black");
    setPly(1); setDone(false); setHinted(false); setMistakes(0); setLines([]); setPromotion(null); setAcademyReward("");
    puzzleStartedAt.current = Date.now(); reportedPuzzle.current = "";
    setMessage("Tìm nước đi tốt nhất.");
  }

  async function begin() {
    if (minimum > maximum) { setMessage("Khoảng độ khó chưa hợp lệ."); return; }
    setBusy(true); setOpening(true); setAcademyReward("");
    if (openingTimer.current) clearTimeout(openingTimer.current);
    openingTimer.current = setTimeout(() => setOpening(false), 850);
    try {
      if (academyToken && academyProfile && trainingMode !== "manual") {
        const response = await fetch(`${API_BASE}/api/academy/training/session`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${academyToken}` },
          body: JSON.stringify({ mode: trainingMode, limit: 10 }),
        });
        const data = await response.json() as TrainingSession & { detail?: string };
        if (!response.ok) throw Error(data.detail || "Không mở được Bí Cảnh cá nhân hóa.");
        setAcademyProfile(data.profile);
        setPersonalization(data.personalization);
        if (!data.puzzles.length) {
          setPuzzles([]);
          setMessage(trainingMode === "review" ? "Sổ Sai Lầm hiện không có bài nào đến hạn. Hãy quay lại Bí Cảnh cá nhân hóa." : "Chưa tìm được puzzle phù hợp. Hãy thử lại.");
          return;
        }
        setPuzzles(data.puzzles); setIndex(0); setSolved(0); setClean(0); open(data.puzzles[0]);
        return;
      }

      const theme = pathSelection?.theme ?? gates[gate][1];
      const r = await fetch(`${API_BASE}/api/puzzles/session?theme=${encodeURIComponent(theme)}&minimum=${minimum}&maximum=${maximum}&limit=10`);
      const data = await r.json(); if (!r.ok) throw Error(data.detail || "Không tải được câu đố.");
      if (!data.puzzles.length) { setMessage("Không có bài phù hợp. Hãy đổi chủ đề hoặc khoảng độ khó."); return; }
      setPersonalization(null); setPuzzles(data.puzzles); setIndex(0); setSolved(0); setClean(0); open(data.puzzles[0]);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Không tải được."); }
    finally { setBusy(false); }
  }

  async function reportAcademyResult(current: AcademyPuzzle, currentMistakes: number, currentHinted: boolean) {
    if (!academyToken || !academyProfile) return;
    const reportKey = `${current.id}:${index}:${puzzleStartedAt.current}`;
    if (reportedPuzzle.current === reportKey) return;
    reportedPuzzle.current = reportKey;
    const manualTheme = pathSelection?.theme ?? gates[gate][1];
    const manualSkill = pathSelection?.module ?? gates[gate][2];
    const eventId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const response = await fetch(`${API_BASE}/api/academy/training/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${academyToken}` },
        body: JSON.stringify({
          eventId,
          puzzleId: current.id,
          mode: current.academyMode ?? "manual",
          skill: current.academySkill ?? manualSkill,
          theme: current.academyTheme ?? manualTheme,
          mistakes: currentMistakes,
          hinted: currentHinted,
          elapsedMs: Math.max(0, Date.now() - puzzleStartedAt.current),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const reward = await response.json() as TrainingResult;
      setAcademyProfile(reward.profile);
      const ratingText = reward.ratingDelta === 0 ? "Rating ±0" : `Rating ${reward.ratingDelta > 0 ? "+" : ""}${reward.ratingDelta}`;
      const masteryText = reward.mastery ? ` · ${reward.mastery.skill} ${reward.mastery.before.toFixed(0)}% → ${reward.mastery.after.toFixed(0)}%` : "";
      const reviewText = reward.review?.added ? ` · đã ghi Sổ Sai Lầm, ôn lại sau ${reward.review.intervalDays ?? 1} ngày` : "";
      setAcademyReward(`+${reward.xpAwarded} Tu Vi · ${ratingText}${masteryText}${reviewText}`);
      void loadAcademy(academyToken);
    } catch (reason) {
      reportedPuzzle.current = "";
      setAcademyReward(reason instanceof Error ? `Chưa lưu được tiến độ: ${reason.message}` : "Chưa lưu được tiến độ.");
    }
  }

  function submitMove(from: string, to: string, promote = "") {
    if (!puzzle || done || busy) return false;
    const result = attemptPuzzle(puzzle, fen, ply, from + to + promote);
    if (!result) { setMistakes(n => n + 1); setMessage("Chưa đúng. Thế cờ được giữ nguyên để bạn thử lại."); return false; }
    setFen(result.fen); setPly(result.ply); setDone(result.done); setMessage(result.done ? "Đã vượt qua thế cờ!" : "Đúng rồi. Đối thủ đã đáp trả, tiếp tục nhé.");
    if (result.done) {
      setSolved(n => n + 1); if (!hinted && mistakes === 0) setClean(n => n + 1);
      void reportAcademyResult(puzzle, mistakes, hinted);
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

  function chooseMode(mode: TrainingMode) {
    if (puzzle && !done) return;
    setTrainingMode(mode); setPuzzles([]); setPersonalization(null); setMessage(""); setAcademyReward("");
    if (mode !== "manual") setPathSelection(null);
    if (mode === "personalized" && academyProfile) {
      setMinimum(academyProfile.ratingRange.minimum); setMaximum(academyProfile.ratingRange.maximum);
    }
  }

  return <main className={styles.page}>
    <header><Link href="/">← Quét sách & phân tích</Link><div className={styles.headerLinks}><Link href="/academy">Học Viện</Link><Link href="/collection">Tàng Kinh Các →</Link></div></header>

    {academyProfile ? <section className={styles.academyStrip}>
      <div><p className={styles.kicker}>HỒ SƠ BÍ CẢNH · STEP {academyProfile.student.currentStep ?? "—"}</p><h2>{academyProfile.student.displayName}</h2><p>Hệ thống đang dùng Step, Puzzle Rating và Skill Map để điều chỉnh bài luyện.</p></div>
      <div className={styles.academyMetrics}>
        <span><small>Tu Vi</small><strong>{academyProfile.student.xp.toLocaleString("vi-VN")}</strong></span>
        <span><small>Puzzle Rating</small><strong>{academyProfile.student.puzzleRating}</strong></span>
        <span><small>Ôn đến hạn</small><strong>{academyProfile.review.due}</strong></span>
        <span><small>Clean rate</small><strong>{academyProfile.stats.cleanRate == null ? "—" : `${academyProfile.stats.cleanRate.toFixed(0)}%`}</strong></span>
      </div>
      <div className={styles.modeSwitch}>
        <button aria-pressed={trainingMode === "personalized"} disabled={!!puzzle && !done} onClick={() => chooseMode("personalized")}>✦ Cá nhân hóa</button>
        <button aria-pressed={trainingMode === "review"} disabled={(!!puzzle && !done) || academyProfile.review.due === 0} onClick={() => chooseMode("review")}>↺ Ôn Sổ Sai Lầm ({academyProfile.review.due})</button>
        <button aria-pressed={trainingMode === "manual"} disabled={!!puzzle && !done} onClick={() => chooseMode("manual")}>☰ Tự chọn</button>
      </div>
    </section> : <section className={styles.academyInvite}><div><strong>Đệ tử Học Viện?</strong><span>Đăng nhập để Bí Cảnh tự chọn bài theo Step, điểm yếu và lịch ôn của bạn.</span></div><Link href="/academy">Vào Học Viện →</Link></section>}

    <section className={styles.gateway}>
      <div><p className={styles.kicker}>{trainingMode === "manual" ? "LUYỆN TẬP BỔ SUNG · LICHESS" : trainingMode === "review" ? "ÔN LUYỆN · SỔ SAI LẦM" : "BÍ CẢNH · CÁ NHÂN HÓA"}</p><h1>Bát Quái Bí Cảnh</h1>
        {academyProfile && trainingMode === "personalized" ? <p>Ưu tiên <strong>{academyProfile.recommendation.skill}</strong> · độ khó đề xuất {academyProfile.ratingRange.minimum}–{academyProfile.ratingRange.maximum}. Phần còn lại là bài tổng hợp cùng tầm sức.</p> : trainingMode === "review" ? <p>Ôn lại những thế từng sai hoặc dùng gợi ý theo lịch giãn cách 1 → 3 → 7 → 14 → 30 → 60 ngày.</p> : <p>Chọn một cửa, luyện từng thế. Sách và bàn phân tích của bạn vẫn ở trang chính.</p>}
        {pathSelection && <p className={styles.pathContext}><Link href={`/dao/${pathSelection.slug}`}>{pathSelection.name}</Link> · {pathSelection.module} · thế luyện liên quan</p>}
        {trainingMode === "manual" && <div className={styles.gates}>{gates.map(([name, , topic], i) => <button key={name} aria-pressed={!pathSelection && gate === i} disabled={busy || !!puzzle && !done} onClick={() => { setPathSelection(null); setGate(i); setPuzzles([]); setMessage(""); }}><strong>{name}</strong><small>{topic}</small></button>)}</div>}
        {academyProfile && trainingMode !== "manual" && <div className={styles.weaknesses}>
          {academyProfile.weakestSkills.slice(0, 4).map(skill => <span key={skill.skill}><small>{skill.skill}</small><strong>{skill.mastery.toFixed(0)}%</strong></span>)}
        </div>}
      </div>
      <div className={styles.portal}>
        <button className={`${styles.seal} ${opening ? styles.opening : ""}`} type="button" disabled={busy || !status?.ready || !!puzzle && !done || (trainingMode !== "manual" && !academyProfile)} onClick={() => void begin()} aria-label="Mở Bí Cảnh">
          <span className={styles.portalAura} aria-hidden="true" />
          <span className={styles.sealRing} style={{ transform: `rotate(${gate * 45}deg)` }}><BaguaSeal /></span>
          <span className={styles.portalCore} aria-hidden="true">✦</span>
        </button>
        <span className={styles.portalCaption}>CHẠM ẤN ĐỂ MỞ BÍ CẢNH</span>
      </div>
    </section>

    <section className={styles.panel}>
      {status?.ready ? <p>Kho đã nhập: {status.count.toLocaleString("vi-VN")} câu · Nguồn Lichess, CC0. <a href="https://github.com/ynoc3004/ChessApp/blob/main/docs/BI-CANH.md" target="_blank" rel="noreferrer">Cách cập nhật kho</a></p> : <div><h2>Nhập kho câu đố Lichess</h2><p>Chạy <code>python scripts/update_lichess_puzzles.py</code> trong thư mục backend để tải và cập nhật kho.</p><button onClick={() => void refresh()}>Kiểm tra lại kho</button></div>}
      {trainingMode === "manual" ? <div className={styles.controls}><label>Rating từ<input type="number" min={0} max={4000} value={minimum} onChange={e => setMinimum(Number(e.target.value))} /></label><label>Đến<input type="number" min={0} max={4000} value={maximum} onChange={e => setMaximum(Number(e.target.value))} /></label><button disabled={busy || !status?.ready || !!puzzle && !done} onClick={() => void begin()}>{busy ? "Đang mở…" : "Mở bí cảnh · tối đa 10 bài"}</button></div> : <div className={styles.personalizedSummary}>
        <div><small>Chế độ</small><strong>{trainingMode === "review" ? "Ôn Sổ Sai Lầm" : "Cá nhân hóa"}</strong></div>
        <div><small>Mục tiêu</small><strong>{personalization?.skill ?? academyProfile?.recommendation.skill ?? "Tổng hợp"}</strong></div>
        <div><small>Độ khó</small><strong>{personalization ? `${personalization.minimum}–${personalization.maximum}` : academyProfile ? `${academyProfile.ratingRange.minimum}–${academyProfile.ratingRange.maximum}` : "—"}</strong></div>
        <button disabled={busy || !status?.ready || !!puzzle && !done} onClick={() => void begin()}>{busy ? "Đang mở…" : trainingMode === "review" ? "Mở lượt ôn →" : "Mở Bí Cảnh phù hợp →"}</button>
      </div>}
      <p role="status">{message}</p>
      {academyReward && <p className={styles.reward} role="status">{academyReward}</p>}
    </section>

    {academyProfile && mistakeBook && mistakeBook.total > 0 && <section className={styles.mistakeBook}>
      <div><p className={styles.kicker}>SỔ SAI LẦM</p><h2>{mistakeBook.total} thế đang được theo dõi · {mistakeBook.due} đến hạn</h2><p>Sai hoặc dùng gợi ý sẽ đưa puzzle vào đây. Vượt lại sạch nhiều lần thì khoảng ôn tự giãn ra.</p></div>
      <div className={styles.mistakeList}>{mistakeBook.items.slice(0, 5).map(item => <span key={item.puzzleId} data-due={item.due}><strong>{item.skill}</strong><small>#{item.puzzleId} · {item.rating ?? "—"} · {item.due ? "đến hạn" : `ôn ${new Date(item.nextReviewAt * 1000).toLocaleDateString("vi-VN")}`}</small></span>)}</div>
    </section>}

    {puzzle && <section className={styles.training}>
      <div className={styles.panel}><h2>Thế {index + 1}/{puzzles.length} · {orientation === "white" ? "Trắng" : "Đen"} đi</h2>
        <Chessboard options={{ id: "realm-board", position: fen, boardOrientation: orientation, onPieceDrop: drop, allowDragging: !done && !busy && !promotion, darkSquareStyle: { backgroundColor: "#9f8974" }, lightSquareStyle: { backgroundColor: "#f6e6cc" } }} />
        {promotion && <div role="group" aria-label="Chọn quân phong cấp">{[["q", "Hậu"], ["r", "Xe"], ["b", "Tượng"], ["n", "Mã"]].map(([piece, label]) => <button key={piece} onClick={() => { submitMove(promotion.from, promotion.to, piece); setPromotion(null); }}>{label}</button>)}<button onClick={() => setPromotion(null)}>Hủy</button></div>}
      </div>
      <aside className={styles.panel}><p className={styles.kicker}>{puzzle.academySkill ? `${puzzle.academyMode === "review" ? "ÔN" : "MỤC TIÊU"} · ${puzzle.academySkill}` : pathSelection ? `${pathSelection.name} · ${pathSelection.module}` : gates[gate][0]}</p><h2>Luyện tập từng nước</h2><p>Đã giải: {solved} · Không sai/gợi ý: {clean}</p><p>Số lần sai bài này: {mistakes}{hinted ? " · Đã dùng gợi ý" : ""}</p>
        {!done && <><button onClick={() => { setHinted(true); setMessage(`Thử quan sát quân ở ô ${puzzle.moves.split(/\s+/)[ply].slice(0, 2)}.`); }}>Gợi ý quân cần đi</button><button onClick={() => { setHinted(true); setMessage(`Nước tiếp theo: ${puzzle.moves.split(/\s+/)[ply]}.`); }}>Xem nước tiếp theo</button></>}
        <SavePosition position={{ id: `lichess:${puzzle.id}`, title: `Lichess #${puzzle.id}`, fen: startPuzzle(puzzle).fen(), source: "lichess", sourcePath: `https://lichess.org/training/${puzzle.id}`, themes: puzzle.themes }} />
        {done && <><p>Rating Lichess: {puzzle.rating} · Chủ đề: {puzzle.themes}</p>{academyReward && <p className={styles.reward}>{academyReward}</p>}{index + 1 < puzzles.length ? <button onClick={() => { setIndex(index + 1); open(puzzles[index + 1]); }}>Thế tiếp theo →</button> : <p>Hoàn thành lượt luyện. Bạn có thể mở lượt mới hoặc ôn Sổ Sai Lầm khi đến hạn.</p>}<button disabled={analyzing} onClick={() => void analyze()}>{analyzing ? "Stockfish đang phân tích…" : "Phân tích vị trí hiện tại bằng Stockfish"}</button><p><a href={lichessAnalysisUrl(fen)} target="_blank" rel="noreferrer">Mở Lichess</a> · <a href={chessComAnalysisUrl(fen)} target="_blank" rel="noreferrer">Mở chess.com</a></p><EngineAdvantage lines={lines} fen={fen} /></>}
      </aside>
    </section>}
  </main>;
}
