"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { API_BASE } from "@/lib/api";
import styles from "./AdminShell.module.css";

const TOKEN_KEY = "chessapp:admin-token";

type AdminContextValue = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  requestRaw: (path: string, init?: RequestInit) => Promise<Response>;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin must be used inside AdminShell");
  return value;
}

async function responseError(response: Response) {
  try {
    const payload = await response.json();
    return String(payload.detail || `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "locked" | "ready">("checking");
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validate = useCallback(async (candidate: string) => {
    const response = await fetch(`${API_BASE}/api/admin/session`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${candidate}` },
    });
    if (!response.ok) throw new Error(await responseError(response));
  }, []);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!saved) {
      setState("locked");
      return;
    }
    void validate(saved)
      .then(() => {
        setToken(saved);
        setState("ready");
      })
      .catch((reason) => {
        window.sessionStorage.removeItem(TOKEN_KEY);
        setError(reason instanceof Error ? reason.message : "Không xác thực được quyền quản trị.");
        setState("locked");
      });
  }, [validate]);

  const lock = useCallback(() => {
    window.sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setInput("");
    setState("locked");
  }, []);

  const requestRaw = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
    if (response.status === 401) lock();
    if (!response.ok) throw new Error(await responseError(response));
    return response;
  }, [lock, token]);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await requestRaw(path, init);
    return (await response.json()) as T;
  }, [requestRaw]);

  const context = useMemo(() => ({ request, requestRaw }), [request, requestRaw]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const candidate = input.trim();
    if (!candidate) return;
    setSubmitting(true);
    setError("");
    try {
      await validate(candidate);
      window.sessionStorage.setItem(TOKEN_KEY, candidate);
      setToken(candidate);
      setInput("");
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đăng nhập được.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "checking") {
    return <main className={`${styles.root} ${styles.checking}`}>Đang kiểm tra quyền Nội Các…</main>;
  }

  if (state === "locked") {
    return (
      <main className={`${styles.root} ${styles.loginPage}`}>
        <form className={styles.loginCard} onSubmit={signIn}>
          <div className={styles.loginSeal} aria-hidden="true">令</div>
          <p>NỘI CÁC · QUẢN TRỊ HỆ THỐNG</p>
          <h1>Mở ấn quản trị</h1>
          <p className={styles.loginIntro}>Nhập mã quản trị của máy này. Mã chỉ được giữ trong phiên trình duyệt và không được ghi vào mã nguồn.</p>
          <label>
            Mã quản trị
            <input
              type="password"
              autoComplete="current-password"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="CHESSAPP_ADMIN_TOKEN"
              autoFocus
            />
          </label>
          <button className={styles.loginButton} disabled={submitting || !input.trim()}>
            {submitting ? "Đang kiểm ấn…" : "Vào Nội Các"}
          </button>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.setup}>
            Lần đầu dùng: chạy <code>backend\start.ps1</code> để đặt và lưu mã quản trị cục bộ.
          </div>
        </form>
      </main>
    );
  }

  const links = [
    ["/admin", "⌂", "Tổng quan"],
    ["/admin/books", "▤", "Kỳ phổ"],
    ["/admin/puzzles", "◇", "Puzzle DB"],
    ["/admin/corrections", "✦", "AI Corrections"],
    ["/admin/collection", "藏", "Tàng Kinh Các"],
    ["/admin/audit", "◷", "Nhật ký"],
    ["/admin/system", "⚙", "Hệ thống"],
  ] as const;

  return (
    <AdminContext.Provider value={context}>
      <div className={styles.root}>
        <div className={styles.shell}>
          <aside className={styles.sidebar}>
            <Link href="/admin" className={styles.brand}>
              <span className={styles.mark} aria-hidden="true">令</span>
              <span><strong>Kỳ Phổ Nội Các</strong><small>Admin Console</small></span>
            </Link>
            <nav className={styles.nav} aria-label="Điều hướng quản trị">
              {links.map(([href, icon, label]) => {
                const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
                return (
                  <Link href={href} key={href} data-active={active}>
                    <span className={styles.navIcon} aria-hidden="true">{icon}</span>{label}
                  </Link>
                );
              })}
            </nav>
            <div className={styles.sidebarFoot}>
              <Link className={styles.exitLink} href="/">← Trở về website</Link>
              <button className={styles.logout} onClick={lock}>Khóa Nội Các</button>
            </div>
          </aside>
          <main className={styles.main}>
            <div className={styles.topline}>
              <span>KỲ PHỔ ĐẠO CÁC / QUẢN TRỊ</span>
              <span className={styles.status}>Backend đã xác thực</span>
            </div>
            {children}
          </main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
