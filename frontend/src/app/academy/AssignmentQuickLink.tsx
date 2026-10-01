"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

const TOKEN_KEY = "chessapp:academy-token";

type Assignment = { status: "pending" | "in_progress" | "completed" | "overdue" };

export default function AssignmentQuickLink() {
  const [count, setCount] = useState<number | null>(null);
  const [overdue, setOverdue] = useState(0);

  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) return;
    void fetch(`${API_BASE}/api/academy/assignments`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { assignments: Assignment[] };
      const active = data.assignments.filter((item) => item.status !== "completed");
      setCount(active.length);
      setOverdue(active.filter((item) => item.status === "overdue").length);
    }).catch(() => undefined);
  }, []);

  if (count === null) return null;
  return <Link href="/academy/assignments" style={{ position: "fixed", right: 22, bottom: 22, zIndex: 40, padding: "12px 16px", borderRadius: 999, background: overdue ? "#8c4938" : "#70553f", color: "#fff9ee", textDecoration: "none", boxShadow: "0 12px 32px rgba(67,45,30,.24)", fontWeight: 700 }}>
    任 Bài giáo viên giao · {count}{overdue ? ` · ${overdue} quá hạn` : ""}
  </Link>;
}
