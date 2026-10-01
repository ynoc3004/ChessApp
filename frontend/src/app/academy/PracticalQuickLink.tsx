"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

const TOKEN_KEY = "chessapp:academy-token";

type Profile = { gamesAnalyzed: number; recommendation?: { label: string } | null };

export default function PracticalQuickLink() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) return;
    void fetch(`${API_BASE}/api/academy/game-analysis/profile`, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json() as Profile;
        if (!data.gamesAnalyzed) return;
        setLabel(data.recommendation ? `析 Thực chiến · ${data.recommendation.label}` : `析 Ván đã phân tích · ${data.gamesAnalyzed}`);
      }).catch(() => undefined);
  }, []);
  if (!label) return null;
  return <Link href="/academy/practical" style={{ position: "fixed", right: 22, bottom: 134, zIndex: 40, padding: "12px 16px", borderRadius: 999, background: "#536f61", color: "#fff9ee", textDecoration: "none", boxShadow: "0 12px 32px rgba(67,45,30,.2)", fontWeight: 700 }}>{label}</Link>;
}
