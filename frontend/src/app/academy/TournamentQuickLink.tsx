"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

const TOKEN_KEY = "chessapp:academy-token";
type Tournament = { status: string; registered: boolean; eligible: boolean };

export default function TournamentQuickLink() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) return;
    void fetch(`${API_BASE}/api/academy/tournaments`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json() as { tournaments: Tournament[] };
        const running = data.tournaments.filter(item => item.status === "running" && item.registered).length;
        const open = data.tournaments.filter(item => item.status === "registration" && (item.registered || item.eligible)).length;
        if (running) setLabel(`武 Giải đang đấu · ${running}`);
        else if (open) setLabel(`武 Giải đang mở · ${open}`);
        else setLabel("武 Đấu Trường");
      }).catch(() => undefined);
  }, []);
  if (!label) return null;
  return <Link href="/academy/tournaments" style={{ position: "fixed", right: 22, bottom: 78, zIndex: 40, padding: "12px 16px", borderRadius: 999, background: "#8a633f", color: "#fff9ee", textDecoration: "none", boxShadow: "0 12px 32px rgba(67,45,30,.22)", fontWeight: 700 }}>{label}</Link>;
}
