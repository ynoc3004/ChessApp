"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { API_BASE } from "@/lib/api";
import { type SavedPosition } from "@/components/SavePosition";
import { chessComAnalysisUrl, lichessAnalysisUrl } from "@/lib/fen";
import { analyzeWithBrowserStockfish, type LocalEngineLine } from "@/lib/browserStockfish";
import styles from "./collection.module.css";

type Tab = "positions" | "world" | "players";

type Folder = {
  id: string;
  name: string;
  description: string;
  kind: "system" | "group" | "user";
  parentId: string | null;
  locked: boolean;
  gameCount?: number;
};

type WorldSync = {
  state: string;
  current: number;
  total: number;
  imported: number;
  skipped: number;
  message: string;
  gameCount?: number;
};

type LibraryOverview = {
  folders: Folder[];
  gameCount: number;
  positionCount: number;
  worldSync: WorldSync;
};

type GameSummary = {
  id: string;
  folderId: string;
  title: string;
  event: string;
  date: string;
  round: string;
  white: string;
  black: string;
  result: string;
  site: string;
  eco: string;
  plyCount: number;
  sourceType: string;
  sourceUrl: string;
  sourceCollection: string;
};

type GameRecord = GameSummary & { pgn: string };

const WORLD_FOLDER = "world-championships";
const FAVORITES_ROOT = "favorite-players";

function buildReplay(pgn: string) {
  try {
    const parsed = new Chess();
    parsed.loadPgn(pgn);
    const headers = parsed.getHeaders();
    const sans = parsed.history();
    const replay = headers.FEN ? new Chess(headers.FEN) : new Chess();
    const fens = [replay.fen()];
    for (const san of sans) {
      replay.move(san);
      fens.push(replay.fen());
    }
    return { sans, fens };
  } catch {
    const game = new Chess();
    return { sans: [] as string[], fens: [game.fen()] };
  }
}

export default function CollectionPage() {
  const [tab, setTab] = useState<Tab>("world");
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
  const [selectedFolder, setSelectedFolder] = useState(WORLD_FOLDER);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameTotal, setGameTotal] = useState(0);
  const [selectedGame, setSelectedGame] = useState<GameRecord | null>(null);
  const [gameQuery, setGameQuery] = useState("");
  const [gameLoading, setGameLoading] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ply, setPly] = useState(0);
  const [gameLines, setGameLines] = useState<LocalEngineLine[]>([]);
  const [gameAnalyzing, setGameAnalyzing] = useState(false);

  const [items, setItems] = useState<SavedPosition[]>([]);
  const [selected, setSelected] = useState<SavedPosition | null>(null);
  const [positionQuery, setPositionQuery] = useState("");
  const [positionMessage, setPositionMessage] = useState("");
  const [positionLoading, setPositionLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [positionLines, setPositionLines] = useState<LocalEngineLine[]>([]);
  const [positionAnalyzing, setPositionAnalyzing] = useState(false);
  const generation = useRef(0);

  const stored = items.find((item) => item.id === selected?.id);
  const dirty = !!selected && JSON.stringify(selected) !== JSON.stringify(stored);
  const filteredPositions = items.filter((item) =>
    `${item.title} ${item.themes} ${item.note}`.toLocaleLowerCase().includes(positionQuery.toLocaleLowerCase()),
  );

  const playerFolders = useMemo(
    () => (overview?.folders ?? []).filter((folder) => folder.parentId === FAVORITES_ROOT),
    [overview],
  );
  const activeFolder = (overview?.folders ?? []).find((folder) => folder.id === selectedFolder) ?? null;
  const replay = useMemo(() => buildReplay(selectedGame?.pgn ?? ""), [selectedGame]);
  const currentFen = replay.fens[Math.min(ply, replay.fens.length - 1)] ?? new Chess().fen();

  async function loadOverview() {
    try {
      const response = await fetch(`${API_BASE}/api/library`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).detail || "Không đọc được Tàng Kinh Các.");
      setOverview(await response.json());
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : "Không đọc được Tàng Kinh Các.");
    }
  }

  async function loadGames(folderId = selectedFolder, query = gameQuery) {
    if (!folderId || folderId === FAVORITES_ROOT) {
      setGames([]);
      setGameTotal(0);
      setSelectedGame(null);
      return;
    }
    setGameLoading(true);
    try {
      const params = new URLSearchParams({ folderId, q: query, limit: "500" });
      const response = await fetch(`${API_BASE}/api/library/games?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Không tải được kỳ cục.");
      setGames(data.games ?? []);
      setGameTotal(data.total ?? 0);
      if (selectedGame && !(data.games ?? []).some((game: GameSummary) => game.id === selectedGame.id)) setSelectedGame(null);
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : "Không tải được kỳ cục.");
    } finally {
      setGameLoading(false);
    }
  }

  async function openGame(game: GameSummary) {
    setLibraryMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/library/games/${game.id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Không mở được kỳ cục.");
      setSelectedGame(data);
      setPly(0);
      setGameLines([]);
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : "Không mở được kỳ cục.");
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const response = await fetch(`${API_BASE}/api/library/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: FAVORITES_ROOT, description: `Kỳ cục tinh tuyển của ${name}` }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Không lập được quyển mục.");
      setNewFolderName("");
      await loadOverview();
      setSelectedFolder(data.id);
      setGames([]);
      setSelectedGame(null);
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : "Không lập được quyển mục.");
    } finally {
      setCreatingFolder(false);
    }
  }

  async function importPgn(file: File | null) {
    if (!file || !selectedFolder || selectedFolder === FAVORITES_ROOT || importing) return;
    setImporting(true);
    setLibraryMessage("");
    try {
      const body = new FormData();
      body.append("folderId", selectedFolder);
      body.append("file", file);
      const response = await fetch(`${API_BASE}/api/library/games/import`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Không nhập được PGN.");
      setLibraryMessage(`Đã thu nhập ${data.added} kỳ cục${data.skipped ? ` · ${data.skipped} trùng lặp đã bỏ qua` : ""}.`);
      await Promise.all([loadOverview(), loadGames(selectedFolder, gameQuery)]);
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : "Không nhập được PGN.");
    } finally {
      setImporting(false);
    }
  }

  async function syncWorldChampionships() {
    if (syncing) return;
    setSyncing(true);
    setLibraryMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/library/world-championships/sync`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Không khởi động được đồng bộ.");
      setOverview((current) => current ? { ...current, worldSync: data } : current);
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : "Không khởi động được đồng bộ.");
      setSyncing(false);
    }
  }

  async function pollWorldSync() {
    try {
      const response = await fetch(`${API_BASE}/api/library/world-championships/status`, { cache: "no-store" });
      if (!response.ok) return;
      const status = (await response.json()) as WorldSync;
      setOverview((current) => current ? { ...current, worldSync: status } : current);
      const active = ["queued", "discovering", "running"].includes(status.state);
      setSyncing(active);
      if (!active) {
        await loadOverview();
        if (selectedFolder === WORLD_FOLDER) await loadGames(WORLD_FOLDER, gameQuery);
      }
    } catch { /* next poll can recover */ }
  }

  async function loadPositions() {
    setPositionLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/collection`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setItems((await response.json()).items ?? []);
      setPositionMessage("");
    } catch {
      setPositionMessage("Không tải được Kỳ Thế Tàng. Hãy bật backend rồi tái thử.");
    } finally {
      setPositionLoading(false);
    }
  }

  function selectPosition(item: SavedPosition) {
    if (dirty && !window.confirm("Chú giải vị lưu. Khả xả biến đổi để khai kỳ thế khác?")) return;
    generation.current += 1;
    setSelected(item);
    setPositionLines([]);
    setPositionAnalyzing(false);
    setPositionMessage("");
  }

  async function savePosition() {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/api/collection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      });
      if (!response.ok) throw new Error((await response.json()).detail);
      setItems((previous) => previous.map((item) => (item.id === selected.id ? selected : item)));
      setPositionMessage("Đã khắc tồn danh mục cùng chú giải.");
    } catch (error) {
      setPositionMessage(error instanceof Error ? error.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  }

  async function analyzePosition() {
    if (!selected) return;
    const token = generation.current;
    setPositionAnalyzing(true);
    try {
      const result = await analyzeWithBrowserStockfish(selected.fen, 14, 3);
      if (generation.current === token) setPositionLines(result);
    } catch (error) {
      if (generation.current === token) setPositionMessage(error instanceof Error ? error.message : "Stockfish vị sẵn sàng.");
    } finally {
      if (generation.current === token) setPositionAnalyzing(false);
    }
  }

  async function analyzeGamePosition() {
    setGameAnalyzing(true);
    try {
      setGameLines(await analyzeWithBrowserStockfish(currentFen, 14, 3));
    } catch (error) {
      setLibraryMessage(error instanceof Error ? error.message : "Stockfish vị sẵn sàng.");
    } finally {
      setGameAnalyzing(false);
    }
  }

  useEffect(() => {
    void loadOverview();
    void loadPositions();
    void loadGames(WORLD_FOLDER, "");
    return () => { generation.current += 1; };
  }, []);

  useEffect(() => {
    const state = overview?.worldSync.state;
    if (!state || !["queued", "discovering", "running"].includes(state)) return;
    const timer = window.setInterval(() => void pollWorldSync(), 1100);
    return () => window.clearInterval(timer);
  }, [overview?.worldSync.state, selectedFolder, gameQuery]);

  useEffect(() => {
    if (tab === "world") {
      setSelectedFolder(WORLD_FOLDER);
      setSelectedGame(null);
      setGameQuery("");
      void loadGames(WORLD_FOLDER, "");
    }
    if (tab === "players") {
      const next = playerFolders[0]?.id ?? FAVORITES_ROOT;
      setSelectedFolder(next);
      setSelectedGame(null);
      setGameQuery("");
      void loadGames(next, "");
    }
  }, [tab]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const worldSync = overview?.worldSync;
  const syncPercent = worldSync?.total ? Math.min(100, Math.round((worldSync.current / worldSync.total) * 100)) : 0;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>藏經閣 · KỲ PHỔ TÀNG THƯ</p>
          <h1>Tàng Kinh Các</h1>
          <p className={styles.heroText}>Tàng kỳ thế từ cổ phổ, toàn bộ Vương Tọa Kỳ Phổ, cùng những danh kỳ cục của kỳ thủ ngươi sở ái. Một nơi để xem lại, diễn toán và tự lập kỳ học tàng thư.</p>
        </div>
        <div className={styles.heroSeal} aria-hidden="true">藏</div>
      </section>

      <nav className={styles.tabs} aria-label="Tàng Kinh Các phân điện">
        <button data-active={tab === "world"} onClick={() => setTab("world")}>
          Vương Tọa Kỳ Phổ<small>Thế Giới Kỳ Vương Tranh Bá</small>
        </button>
        <button data-active={tab === "players"} onClick={() => setTab("players")}>
          Danh Kỳ Sở Ái<small>Tự lập kỳ thủ quyển mục</small>
        </button>
        <button data-active={tab === "positions"} onClick={() => setTab("positions")}>
          Kỳ Thế Tàng<small>Thế cờ từ sách & Bí Cảnh</small>
        </button>
      </nav>

      {libraryMessage && <p className={styles.status} role="status">{libraryMessage}</p>}

      {tab !== "positions" && (
        <section className={styles.grid}>
          <aside className={styles.panel}>
            <div className={styles.panelHead}><p>QUYỂN MỤC</p><h2>{tab === "world" ? "Vương Tọa" : "Danh Kỳ"}</h2></div>
            <div className={styles.panelBody}>
              <div className={styles.folderList}>
                {tab === "world" && (
                  <button className={styles.folderBtn} data-active={selectedFolder === WORLD_FOLDER} onClick={() => { setSelectedFolder(WORLD_FOLDER); setSelectedGame(null); void loadGames(WORLD_FOLDER, gameQuery); }}>
                    <span className={styles.folderGlyph}>♔</span><span><strong>Vương Tọa Kỳ Phổ</strong><small>1886 → hiện đại</small></span><span className={styles.count}>{overview?.folders.find((f) => f.id === WORLD_FOLDER)?.gameCount ?? 0}</span>
                  </button>
                )}
                {tab === "players" && playerFolders.map((folder) => (
                  <button key={folder.id} className={styles.folderBtn} data-active={selectedFolder === folder.id} onClick={() => { setSelectedFolder(folder.id); setSelectedGame(null); setGameQuery(""); void loadGames(folder.id, ""); }}>
                    <span className={styles.folderGlyph}>棋</span><span><strong>{folder.name}</strong><small>{folder.description || "Kỳ thủ sở ái"}</small></span><span className={styles.count}>{folder.gameCount ?? 0}</span>
                  </button>
                ))}
              </div>

              {tab === "players" && (
                <div className={styles.createFolder}>
                  <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createFolder(); }} placeholder="Tên kỳ thủ, ví dụ: Karpov" maxLength={80} />
                  <button className={styles.primary} disabled={!newFolderName.trim() || creatingFolder} onClick={() => void createFolder()}>{creatingFolder ? "Đang lập…" : "+ Lập kỳ thủ quyển"}</button>
                </div>
              )}
            </div>
          </aside>

          <section className={styles.panel}>
            <div className={styles.panelHead}><p>KỲ CỤC</p><h2>{activeFolder?.name ?? "Chưa tuyển quyển"}</h2></div>
            <div className={styles.gameTools}>
              {tab === "world" && (
                <div className={styles.syncCard}>
                  <strong>♔ Đồng bộ Thế Giới Kỳ Vương</strong>
                  <p>{worldSync?.message ?? "Thu nhập toàn bộ dòng chính World Chess Championship từ Lichess Studies."}</p>
                  {syncing && <div className={styles.progress}><span style={{ width: `${Math.max(2, syncPercent)}%` }} /></div>}
                  <button className={styles.primary} disabled={syncing} onClick={() => void syncWorldChampionships()}>{syncing ? `Đang thu nhập ${syncPercent}%` : (overview?.folders.find((f) => f.id === WORLD_FOLDER)?.gameCount ? "↻ Cập nhật Vương Tọa Kỳ Phổ" : "↓ Thu nhập toàn bộ Vương Tọa Kỳ Phổ")}</button>
                </div>
              )}
              <input className={styles.search} value={gameQuery} onChange={(e) => { setGameQuery(e.target.value); void loadGames(selectedFolder, e.target.value); }} placeholder="Tầm kỳ thủ, niên đại, ECO…" />
              {selectedFolder !== FAVORITES_ROOT && (
                <label className={styles.action}>
                  {importing ? "Đang nhập PGN…" : "＋ Nhập PGN vào quyển này"}
                  <input type="file" accept=".pgn,application/x-chess-pgn" hidden disabled={importing} onChange={(e) => { const file = e.target.files?.[0] ?? null; e.currentTarget.value = ""; void importPgn(file); }} />
                </label>
              )}
              <span className={styles.status}>{gameLoading ? "Đang triệu hồi kỳ cục…" : `${gameTotal} kỳ cục`}</span>
            </div>
            <div className={styles.gameList}>
              {!gameLoading && !games.length && <div className={styles.empty}>{tab === "world" ? "Vương Tọa Kỳ Phổ thượng vô kỳ cục. Hãy bấm “Thu nhập toàn bộ” để đồng bộ." : playerFolders.length ? "Quyển mục thượng vô kỳ cục. Khả nhập một tệp PGN." : "Hãy lập quyển mục đầu tiên cho kỳ thủ ngươi yêu thích."}</div>}
              {games.map((game) => (
                <button key={game.id} className={styles.gameItem} data-active={selectedGame?.id === game.id} onClick={() => void openGame(game)}>
                  <strong>{game.white} — {game.black}</strong>
                  <span>{game.event || game.sourceCollection} · {game.date || "?"}{game.round ? ` · ván ${game.round}` : ""}</span>
                  <em>{game.result} {game.eco ? `· ${game.eco}` : ""}</em>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            {selectedGame ? (
              <div className={styles.viewer}>
                <div className={styles.viewerHead}>
                  <div><h2>{selectedGame.white} — {selectedGame.black}</h2><p>{selectedGame.event} · {selectedGame.date} · {selectedGame.result}</p></div>
                  {selectedGame.sourceUrl && <a className={styles.action} href={selectedGame.sourceUrl} target="_blank" rel="noreferrer">Nguyên lưu ↗</a>}
                </div>
                <div className={styles.boardLayout}>
                  <div className={styles.boardBox}>
                    <Chessboard options={{ id: `archive-${selectedGame.id}`, position: currentFen, allowDragging: false, showNotation: true, lightSquareStyle: { backgroundColor: "#f4efd9" }, darkSquareStyle: { backgroundColor: "#8eaa70" } }} />
                  </div>
                  <div className={styles.movePanel}>
                    <div className={styles.gameMeta}>
                      <div><span>BẠCH</span><strong>{selectedGame.white}</strong></div><div><span>HẮC</span><strong>{selectedGame.black}</strong></div>
                      <div><span>KẾT CỤC</span><strong>{selectedGame.result}</strong></div><div><span>ECO</span><strong>{selectedGame.eco || "—"}</strong></div>
                    </div>
                    <div className={styles.replayControls}>
                      <button onClick={() => { setPly(0); setGameLines([]); }} disabled={ply === 0}>|◀</button>
                      <button onClick={() => { setPly((n) => Math.max(0, n - 1)); setGameLines([]); }} disabled={ply === 0}>◀</button>
                      <button onClick={() => { setPly((n) => Math.min(replay.sans.length, n + 1)); setGameLines([]); }} disabled={ply >= replay.sans.length}>▶</button>
                      <button onClick={() => { setPly(replay.sans.length); setGameLines([]); }} disabled={ply >= replay.sans.length}>▶|</button>
                    </div>
                    <div className={styles.moves}>{replay.sans.map((san, index) => <button key={`${index}-${san}`} data-active={ply === index + 1} onClick={() => { setPly(index + 1); setGameLines([]); }}>{index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ""}{san}</button>)}</div>
                    <p className={styles.status}>Bộ {ply}/{replay.sans.length} · {currentFen.split(" ")[1] === "w" ? "Bạch phương hành" : "Hắc phương hành"}</p>
                    <button className={styles.primary} disabled={gameAnalyzing} onClick={() => void analyzeGamePosition()}>{gameAnalyzing ? "Stockfish diễn toán…" : "Diễn toán cục diện hiện tại"}</button>
                    <p className={styles.status}><a href={lichessAnalysisUrl(currentFen)} target="_blank" rel="noreferrer">Lichess ↗</a> · <a href={chessComAnalysisUrl(currentFen)} target="_blank" rel="noreferrer">Chess.com ↗</a></p>
                    {gameLines.map((line) => <p className={styles.status} key={line.multipv}>{line.san}</p>)}
                  </div>
                </div>
              </div>
            ) : <div className={styles.empty}>Tuyển một kỳ cục để khai bàn, phục diễn từng thủ và diễn toán Stockfish.</div>}
          </section>
        </section>
      )}

      {tab === "positions" && (
        <section className={styles.positions}>
          <aside className={styles.panel}>
            <div className={styles.panelHead}><p>KỲ THẾ TÀNG</p><h2>{items.length} kỳ thế</h2></div>
            <div className={styles.gameTools}><input className={styles.search} value={positionQuery} onChange={(e) => setPositionQuery(e.target.value)} placeholder="Tầm danh xưng, chủ đề, chú giải…" /><span className={styles.status}>{positionLoading ? "Đang triệu hồi…" : positionMessage}</span></div>
            <div className={styles.positionList}>{filteredPositions.map((item) => <button key={item.id} data-active={selected?.id === item.id} onClick={() => selectPosition(item)}><strong>{item.title}</strong><p>{item.source === "book" ? "Cổ phổ" : "Lichess"} · {item.themes || "Vị phân loại"}</p></button>)}</div>
          </aside>
          <section className={styles.panel}>
            {selected ? <div className={styles.positionEditor}>
              <div><Chessboard options={{ id: "collection-board", position: selected.fen, allowDragging: false, lightSquareStyle: { backgroundColor: "#f4efd9" }, darkSquareStyle: { backgroundColor: "#8eaa70" } }} /></div>
              <div className={styles.editor}>
                <label>Danh xưng kỳ thế<input maxLength={200} value={selected.title} onChange={(e) => setSelected({ ...selected, title: e.target.value })} /></label>
                <label>Chủ đề<input maxLength={500} value={selected.themes} onChange={(e) => setSelected({ ...selected, themes: e.target.value })} /></label>
                <label>Chú giải<textarea maxLength={3000} rows={6} value={selected.note} onChange={(e) => setSelected({ ...selected, note: e.target.value })} /></label>
                {dirty && <p className={styles.status}>Hữu biến đổi vị khắc tồn.</p>}
                <button className={styles.primary} disabled={saving || !selected.title.trim() || !dirty} onClick={() => void savePosition()}>{saving ? "Đang khắc tồn…" : "Khắc tồn chú giải"}</button>
                <button className={styles.action} disabled={positionAnalyzing} onClick={() => void analyzePosition()}>{positionAnalyzing ? "Stockfish diễn toán…" : "Diễn toán Stockfish"}</button>
                <p className={styles.status}><a href={lichessAnalysisUrl(selected.fen)} target="_blank" rel="noreferrer">Lichess ↗</a> · <a href={chessComAnalysisUrl(selected.fen)} target="_blank" rel="noreferrer">Chess.com ↗</a></p>
                {selected.sourcePath && <a className={styles.action} href={selected.sourcePath}>Hồi nguyên kỳ thế →</a>}
                {positionLines.map((line) => <p className={styles.status} key={line.multipv}>{line.san}</p>)}
              </div>
            </div> : <div className={styles.empty}>Tuyển một kỳ thế từ tàng mục để khai bàn.</div>}
          </section>
        </section>
      )}
    </main>
  );
}
