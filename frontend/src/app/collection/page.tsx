"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chessboard } from "react-chessboard";
import { API_BASE } from "@/lib/api";
import { type SavedPosition } from "@/components/SavePosition";
import { chessComAnalysisUrl, lichessAnalysisUrl } from "@/lib/fen";
import { analyzeWithBrowserStockfish, type LocalEngineLine } from "@/lib/browserStockfish";
import styles from "../realms/realms.module.css";
import archive from "./collection.module.css";
export default function CollectionPage() {
  const [items, setItems] = useState<SavedPosition[]>([]), [selected, setSelected] = useState<SavedPosition | null>(null);
  const [query, setQuery] = useState(""), [message, setMessage] = useState(""), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<LocalEngineLine[]>([]), [analyzing, setAnalyzing] = useState(false);
  const generation = useRef(0);
  const stored = items.find(item => item.id === selected?.id);
  const dirty = !!selected && JSON.stringify(selected) !== JSON.stringify(stored);
  const filteredItems = items.filter(item => `${item.title} ${item.themes} ${item.note}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function select(item: SavedPosition) {
    if (dirty && !window.confirm("Ghi chú chưa được lưu. Bạn muốn bỏ thay đổi để mở thế khác?")) return;
    generation.current++;
    setSelected(item); setLines([]); setAnalyzing(false); setMessage("");
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function load() {
    setLoading(true);
    try { const r = await fetch(`${API_BASE}/api/collection`); if (!r.ok) throw Error(); setItems((await r.json()).items); setMessage(""); }
    catch { setMessage("Không tải được bộ sưu tập. Hãy bật backend rồi thử lại."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, []);
  async function save() {
    if (!selected) return; setSaving(true);
    try { const r = await fetch(`${API_BASE}/api/collection`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected) }); if (!r.ok) throw Error((await r.json()).detail); setItems(prev => prev.map(item => item.id === selected.id ? selected : item)); setMessage("Đã lưu nhãn chủ đề và ghi chú."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Không lưu được."); } finally { setSaving(false); }
  }
  async function analyze() {
    if (!selected) return; const token = generation.current; setAnalyzing(true);
    try { const result = await analyzeWithBrowserStockfish(selected.fen, 14, 3); if (generation.current === token) setLines(result); }
    catch (e) { if (generation.current === token) setMessage(e instanceof Error ? e.message : "Stockfish chưa sẵn sàng."); }
    finally { if (generation.current === token) setAnalyzing(false); }
  }
  return <main className={`${styles.page} ${archive.archive}`}><header><Link href="/">← Quét sách & phân tích</Link><Link href="/realms">Bát Quái Bí Cảnh →</Link></header>
    <div className={archive.hero}><div><span className={archive.eyebrow}>KỲ PHỔ ĐẠO CÁC · LƯU GIỮ KỲ THẾ</span><h1>Tàng Kinh Các</h1><p>Thế cờ bạn chọn từ sách và Lichess. Gắn nhãn để tìm lại theo chủ đề.</p></div><div className={archive.heroMark} aria-hidden="true">藏</div></div>
    <section className={`${styles.panel} ${archive.shelf}`}><div className={archive.shelfHead}><div><span className={archive.eyebrow}>KỆ CỔ THƯ</span><h2>{items.length} kỳ thế đã lưu</h2></div><span className={archive.shelfOrnament} aria-hidden="true">✦ ── ✦</span></div><label>Tìm tên, chủ đề hoặc ghi chú<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ví dụ: ghim quân, tàn cuộc…" /></label><p role="status">{loading ? "Đang tải…" : message}</p>{message.includes("Không tải") && <button onClick={() => void load()}>Thử lại</button>}
      {!loading && !items.length && !message && <p>Chưa có thế cờ. Bấm “Lưu Tàng Kinh Các” trong màn phân tích sách hoặc Bí Cảnh.</p>}
      {!loading && items.length > 0 && !filteredItems.length && <p>Không tìm thấy thế cờ phù hợp với từ khóa.</p>}
      <div className={styles.list}>{filteredItems.map((item, index) => <button className={archive.volume} key={item.id} disabled={saving} aria-pressed={selected?.id === item.id} onClick={() => select(item)}><span className={archive.volumeNumber}>{String(index + 1).padStart(2, "0")} / {item.source === "book" ? "KỲ PHỔ" : "LICHESS"}</span><span className={archive.volumeSeal} aria-hidden="true">棋</span><strong>{item.title}</strong><p>{item.themes || "Chưa gắn nhãn"}</p><span className={archive.volumeAction}>Mở kỳ thế ↗</span></button>)}</div>
    </section>
    {selected && <section className={styles.training}><div className={`${styles.panel} ${archive.boardFrame}`}><Chessboard options={{ id: "collection-board", position: selected.fen, allowDragging: false }} /></div><div className={`${styles.panel} ${archive.notePanel}`}>
      <span className={archive.eyebrow}>CHÚ GIẢI KỲ THẾ</span>
      <label>Tên thế cờ<input maxLength={200} value={selected.title} onChange={e => setSelected({ ...selected, title: e.target.value })} /></label><label>Chủ đề (phân cách bằng dấu phẩy)<input maxLength={500} value={selected.themes} onChange={e => setSelected({ ...selected, themes: e.target.value })} /></label><label>Ghi chú<textarea maxLength={3000} rows={5} value={selected.note} onChange={e => setSelected({ ...selected, note: e.target.value })} /></label>
      {dirty && <p role="status">Có thay đổi chưa lưu.</p>}
      <button disabled={saving || !selected.title.trim() || !dirty} onClick={() => void save()}>{saving ? "Đang lưu…" : "Lưu ghi chú"}</button><button disabled={analyzing} onClick={() => void analyze()}>{analyzing ? "Đang phân tích…" : "Phân tích Stockfish"}</button>
      <p><a href={lichessAnalysisUrl(selected.fen)} target="_blank" rel="noreferrer">Lichess</a> · <a href={chessComAnalysisUrl(selected.fen)} target="_blank" rel="noreferrer">chess.com</a></p>{selected.sourcePath && <a href={selected.sourcePath}>Mở nguồn gốc thế cờ →</a>}{lines.map(line => <p key={line.multipv}>{line.san}</p>)}
    </div></section>}
  </main>;
}
