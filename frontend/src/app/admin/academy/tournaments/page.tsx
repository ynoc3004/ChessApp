"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminShell";
import styles from "../../admin.module.css";
import local from "./tournaments.module.css";

type Tournament = {
  id: string; title: string; description: string; stepMin: number; stepMax: number;
  ratingMin: number; ratingMax: number; classId?: string | null; className?: string | null;
  maxPlayers: number; rounds: number; status: string; startsAt?: number | null;
  playerCount: number; currentRound: number;
};
type Pairing = { id: string; board: number; whiteId: string; whiteName: string; blackId?: string | null; blackName?: string | null; result: string; pgn: string };
type Standing = { rank: number; studentId: string; displayName: string; step?: number | null; puzzleRating: number; score: number; buchholz: number; wins: number; byeCount: number };
type Detail = Tournament & { standings: Standing[]; pairings: Pairing[] };
type AcademyClass = { id: string; name: string; active: boolean };

const statusLabel: Record<string, string> = {
  draft: "Nháp", registration: "Mở đăng ký", running: "Đang đấu", completed: "Đã kết thúc", cancelled: "Đã hủy",
};

export default function TournamentsAdminPage() {
  const { request } = useAdmin();
  const [items, setItems] = useState<Tournament[]>([]);
  const [classes, setClasses] = useState<AcademyClass[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pgn, setPgn] = useState<Record<string, string>>({});

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stepMin, setStepMin] = useState("1");
  const [stepMax, setStepMax] = useState("20");
  const [ratingMin, setRatingMin] = useState("400");
  const [ratingMax, setRatingMax] = useState("3000");
  const [classId, setClassId] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("32");
  const [rounds, setRounds] = useState("5");
  const [startsAt, setStartsAt] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [tournaments, classData] = await Promise.all([
        request<{ tournaments: Tournament[] }>("/api/admin/academy/tournaments"),
        request<{ classes: AcademyClass[] }>("/api/admin/academy/classes"),
      ]);
      setItems(tournaments.tournaments);
      setClasses(classData.classes.filter(item => item.active));
      const wanted = selectedId || tournaments.tournaments[0]?.id || "";
      setSelectedId(wanted);
      if (wanted) {
        const data = await request<Detail>(`/api/admin/academy/tournaments/${wanted}`);
        setDetail(data);
        setPgn(Object.fromEntries(data.pairings.map(pair => [pair.id, pair.pgn || ""])));
      } else setDetail(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được giải đấu.");
    }
  }, [request, selectedId]);

  useEffect(() => { void load(); }, [load]);

  async function choose(id: string) {
    setSelectedId(id); setError(""); setNotice("");
    try {
      const data = await request<Detail>(`/api/admin/academy/tournaments/${id}`);
      setDetail(data);
      setPgn(Object.fromEntries(data.pairings.map(pair => [pair.id, pair.pgn || ""])));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không tải được giải."); }
  }

  async function run(key: string, task: () => Promise<void>, message: string) {
    setBusy(key); setError(""); setNotice("");
    try { await task(); setNotice(message); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Thao tác thất bại."); }
    finally { setBusy(""); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await run("create", async () => {
      const created = await request<Tournament>("/api/admin/academy/tournaments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), description: description.trim(), stepMin: Number(stepMin), stepMax: Number(stepMax),
          ratingMin: Number(ratingMin), ratingMax: Number(ratingMax), classId: classId || null,
          maxPlayers: Number(maxPlayers), rounds: Number(rounds), startsAt: startsAt ? new Date(startsAt).getTime() / 1000 : null,
        }),
      });
      setSelectedId(created.id); setTitle(""); setDescription("");
    }, "Đã tạo giải ở trạng thái nháp.");
  }

  async function saveResult(pairing: Pairing, result: "1-0" | "0-1" | "1/2-1/2") {
    if (!detail) return;
    await run(`result:${pairing.id}`, async () => {
      await request(`/api/admin/academy/tournaments/${detail.id}/pairings/${pairing.id}/result`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, pgn: pgn[pairing.id] || "" }),
      });
    }, `Đã lưu kết quả bàn ${pairing.board}.`);
  }

  const metrics = useMemo(() => ({
    registration: items.filter(item => item.status === "registration").length,
    running: items.filter(item => item.status === "running").length,
    completed: items.filter(item => item.status === "completed").length,
  }), [items]);

  return <div className={styles.page}>
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>ACADEMY V4 · SWISS</p><h1>Giải Đấu Đệ Tử</h1><p>Tổ chức giải theo Step/lớp/trình độ, ghép cặp Swiss, nhập kết quả và theo dõi điểm + Buchholz.</p></div>
      <button className={styles.refresh} onClick={() => void load()}>↻ Làm mới</button>
    </section>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}

    <section className={styles.grid}>
      <article className={styles.metric}><span>Tổng giải</span><strong>{items.length}</strong><small>mọi trạng thái</small></article>
      <article className={styles.metric}><span>Đang đăng ký</span><strong>{metrics.registration}</strong><small>đệ tử có thể tham gia</small></article>
      <article className={styles.metric}><span>Đang đấu</span><strong>{metrics.running}</strong><small>Swiss đang chạy</small></article>
      <article className={styles.metric}><span>Đã kết thúc</span><strong>{metrics.completed}</strong><small>có BXH cuối</small></article>
    </section>

    <section className={local.twoCol}>
      <form className={styles.panel} onSubmit={create}>
        <div className={styles.panelHead}><div><h2>Tạo giải mới</h2><span>Bắt đầu ở trạng thái nháp</span></div></div>
        <div className={local.formGrid}>
          <label>Tên giải<input className={styles.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Nội Môn Step 4 · Tháng 10" /></label>
          <label>Lớp (tùy chọn)<select className={styles.select} value={classId} onChange={e => setClassId(e.target.value)}><option value="">Toàn Học Viện</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Step từ<input className={styles.select} type="number" min="1" max="20" value={stepMin} onChange={e => setStepMin(e.target.value)} /></label>
          <label>Step đến<input className={styles.select} type="number" min="1" max="20" value={stepMax} onChange={e => setStepMax(e.target.value)} /></label>
          <label>Rating từ<input className={styles.select} type="number" min="400" max="3000" value={ratingMin} onChange={e => setRatingMin(e.target.value)} /></label>
          <label>Rating đến<input className={styles.select} type="number" min="400" max="3000" value={ratingMax} onChange={e => setRatingMax(e.target.value)} /></label>
          <label>Số người tối đa<input className={styles.select} type="number" min="2" max="256" value={maxPlayers} onChange={e => setMaxPlayers(e.target.value)} /></label>
          <label>Số vòng<input className={styles.select} type="number" min="1" max="12" value={rounds} onChange={e => setRounds(e.target.value)} /></label>
          <label>Ngày dự kiến<input className={styles.select} type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></label>
        </div>
        <label className={local.full}>Mô tả<textarea value={description} onChange={e => setDescription(e.target.value)} /></label>
        <button className={styles.button} disabled={Boolean(busy) || !title.trim()}>Tạo giải</button>
      </form>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>Danh sách giải</h2><span>{items.length} giải</span></div></div>
        <div className={local.list}>{items.map(item => <button key={item.id} data-active={selectedId === item.id} onClick={() => void choose(item.id)}>
          <strong>{item.title}</strong><span>{statusLabel[item.status] ?? item.status} · {item.playerCount}/{item.maxPlayers} người · vòng {item.currentRound}/{item.rounds}</span><small>Step {item.stepMin}–{item.stepMax} · Rating {item.ratingMin}–{item.ratingMax}{item.className ? ` · ${item.className}` : ""}</small>
        </button>)}{!items.length && <p className={styles.empty}>Chưa có giải.</p>}</div>
      </section>
    </section>

    {detail && <>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>{detail.title}</h2><span>{statusLabel[detail.status] ?? detail.status} · {detail.playerCount}/{detail.maxPlayers} đệ tử</span></div></div>
        <p className={styles.muted}>{detail.description || "Chưa có mô tả."}</p>
        <div className={styles.actions}>
          {detail.status === "draft" && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void run("open", () => request(`/api/admin/academy/tournaments/${detail.id}/registration/open`, { method: "POST" }), "Đã mở đăng ký.")}>Mở đăng ký</button>}
          {detail.status === "registration" && <button className={styles.button} disabled={Boolean(busy) || detail.playerCount < 2} onClick={() => void run("start", () => request(`/api/admin/academy/tournaments/${detail.id}/start`, { method: "POST" }), "Đã ghép vòng 1.")}>Bắt đầu giải</button>}
          {detail.status === "running" && detail.currentRound < detail.rounds && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void run("next", () => request(`/api/admin/academy/tournaments/${detail.id}/rounds/next`, { method: "POST" }), "Đã ghép vòng tiếp theo.")}>Ghép vòng tiếp →</button>}
          {detail.status === "running" && <button className={styles.button} disabled={Boolean(busy)} onClick={() => void run("finish", () => request(`/api/admin/academy/tournaments/${detail.id}/finish`, { method: "POST" }), "Đã kết thúc giải.")}>Kết thúc giải</button>}
        </div>
      </section>

      {detail.currentRound > 0 && <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>Vòng {detail.currentRound}</h2><span>Nhập kết quả từng bàn; PGN là tùy chọn.</span></div></div>
        <div className={local.pairings}>{detail.pairings.map(pair => <article key={pair.id}>
          <div className={local.boardNo}>Bàn {pair.board}</div><div className={local.players}><strong>{pair.whiteName}</strong><span>vs</span><strong>{pair.blackName ?? "BYE"}</strong></div>
          <div className={local.result}>{pair.result === "bye" ? "1 điểm bye" : pair.result === "pending" ? "Chưa có kết quả" : pair.result}</div>
          {pair.blackId && <><textarea placeholder="PGN (tùy chọn)" value={pgn[pair.id] ?? ""} onChange={e => setPgn(current => ({ ...current, [pair.id]: e.target.value }))} /><div className={styles.actions}><button className={styles.button} onClick={() => void saveResult(pair, "1-0")}>1–0</button><button className={styles.button} onClick={() => void saveResult(pair, "1/2-1/2")}>½–½</button><button className={styles.button} onClick={() => void saveResult(pair, "0-1")}>0–1</button></div></>}
        </article>)}</div>
      </section>}

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>Bảng xếp hạng</h2><span>Điểm → Buchholz → số ván thắng → seed rating</span></div></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>#</th><th>Đệ tử</th><th>Step</th><th>Rating</th><th>Điểm</th><th>Buchholz</th><th>Thắng</th></tr></thead><tbody>{detail.standings.map(row => <tr key={row.studentId}><td>{row.rank}</td><td><strong>{row.displayName}</strong></td><td>{row.step ?? "—"}</td><td>{row.puzzleRating}</td><td><strong>{row.score}</strong></td><td>{row.buchholz}</td><td>{row.wins}</td></tr>)}</tbody></table></div>
      </section>
    </>}
  </div>;
}
