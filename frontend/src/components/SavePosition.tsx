"use client";
import { useState } from "react";
import { API_BASE } from "@/lib/api";
export type SavedPosition = { id: string; title: string; fen: string; source: "book" | "lichess"; sourcePath: string; themes: string; note: string };
export default function SavePosition({ position, disabled = false }: { position: Omit<SavedPosition, "note">; disabled?: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy || disabled) return;
    setBusy(true); setMessage("");
    try {
      // Preserve existing personal notes when saving this position again.
      const list = await fetch(`${API_BASE}/api/collection`);
      if (!list.ok) throw new Error("Không đọc được Tàng Kinh Các.");
      const data = await list.json();
      const existing = (data.items as SavedPosition[]).find(item => item.id === position.id);
      const response = await fetch(`${API_BASE}/api/collection`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...position, title: existing?.title ?? position.title, themes: existing?.themes ?? position.themes, note: existing?.note ?? "" }) });
      if (!response.ok) throw new Error((await response.json()).detail || "Không lưu được.");
      setMessage("Đã lưu vào Tàng Kinh Các.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Chưa kết nối được dịch vụ lưu trữ."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" className="button compactButton" disabled={busy || disabled} onClick={() => void save()}>{busy ? "Đang lưu…" : "☆ Lưu Tàng Kinh Các"}</button>{message && <p role="status">{message}</p>}</div>;
}
