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
import {
  type AdminLoginResponse,
  type AdminPrincipal,
  type AdminSessionResponse,
} from "@/lib/adminApi";
import styles from "./AdminShell.module.css";

const TOKEN_KEY = "chessapp:admin-token";

type AdminContextValue = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  requestRaw: (path: string, init?: RequestInit) => Promise<Response>;
  principal: AdminPrincipal;
  can: (permission: string) => boolean;
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
  const [principal, setPrincipal] = useState<AdminPrincipal | null>(null);
  const [loginMode, setLoginMode] = useState<"account" | "token">("account");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ownerToken, setOwnerToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validate = useCallback(async (candidate: string) => {
    const response = await fetch(`${API_BASE}/api/admin/session`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${candidate}` },
    });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = (await response.json()) as AdminSessionResponse;
    return payload.principal;
  }, []);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || "";
    if (!saved) {
      setState("locked");
      return;
    }
    void validate(saved)
      .then((identity) => {
        setToken(saved);
        setPrincipal(identity);
        setState("ready");
      })
      .catch((reason) => {
        window.sessionStorage.removeItem(TOKEN_KEY);
        setError(reason instanceof Error ? reason.message : "Không xác thực được quyền quản trị.");
        setState("locked");
      });
  }, [validate]);

  const lock = useCallback(() => {
    if (token) {
      void fetch(`${API_BASE}/api/admin/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    window.sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setPrincipal(null);
    setPassword("");
    setOwnerToken("");
    setState("locked");
  }, [token]);

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

  const can = useCallback((permission: string) => Boolean(principal?.permissions.includes(permission)), [principal]);
  const context = useMemo(
    () => principal ? { request, requestRaw, principal, can } : null,
    [can, principal, request, requestRaw],
  );

  function acceptLogin(nextToken: string, identity: AdminPrincipal) {
    window.sessionStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setPrincipal(identity);
    setPassword("");
    setOwnerToken("");
    setError("");
    setState("ready");
  }

  async function signInAccount(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/admin/auth/login`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = (await response.json()) as AdminLoginResponse;
      acceptLogin(payload.token, payload.principal);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không đăng nhập được.");
    } finally {
      setSubmitting(false);
    }
  }

  async function signInOwner(event: FormEvent) {
    event.preventDefault();
    const candidate = ownerToken.trim();
    if (!candidate) return;
    setSubmitting(true);
    setError("");
    try {
      const identity = await validate(candidate);
      acceptLogin(candidate, identity);
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
        <section className={styles.loginCard}>
          <div className={styles.loginSeal} aria-hidden="true">令</div>
          <p>NỘI CÁC · QUẢN TRỊ HỆ THỐNG</p>
          <h1>Mở ấn quản trị</h1>
          <p className={styles.loginIntro}>Đăng nhập bằng tài khoản Nội Các, hoặc dùng mã owner cục bộ làm khóa dự phòng.</p>
          <div className={styles.loginTabs} role="tablist" aria-label="Cách đăng nhập">
            <button type="button" data-active={loginMode === "account"} onClick={() => { setLoginMode("account"); setError(""); }}>Tài khoản</button>
            <button type="button" data-active={loginMode === "token"} onClick={() => { setLoginMode("token"); setError(""); }}>Mã owner local</button>
          </div>

          {loginMode === "account" ? (
            <form className={styles.loginForm} onSubmit={signInAccount}>
              <label>
                Tên đăng nhập
                <input type="text" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin.thanh" autoFocus />
              </label>
              <label>
                Mật khẩu
                <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 10 ký tự" />
              </label>
              <button className={styles.loginButton} disabled={submitting || !username.trim() || !password}>
                {submitting ? "Đang kiểm ấn…" : "Đăng nhập Nội Các"}
              </button>
            </form>
          ) : (
            <form className={styles.loginForm} onSubmit={signInOwner}>
              <label>
                Mã owner cục bộ
                <input type="password" autoComplete="current-password" value={ownerToken} onChange={(event) => setOwnerToken(event.target.value)} placeholder="CHESSAPP_ADMIN_TOKEN" autoFocus />
              </label>
              <button className={styles.loginButton} disabled={submitting || !ownerToken.trim()}>
                {submitting ? "Đang kiểm ấn…" : "Vào bằng owner local"}
              </button>
            </form>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.setup}>
            Chưa có tài khoản? Dùng <strong>Mã owner local</strong> lần đầu, vào mục <strong>Tài khoản</strong> để tạo username/password. Mã dự phòng nằm trong <code>backend\.env</code> và không được đưa lên GitHub.
          </div>
        </section>
      </main>
    );
  }

  if (!principal || !context) return null;

  const links = [
    ["/admin", "⌂", "Tổng quan", "admin.read"],
    ["/admin/academy", "門", "Học Viện", "admin.write"],
    ["/admin/books", "▤", "Kỳ phổ", "admin.read"],
    ["/admin/puzzles", "◇", "Puzzle DB", "admin.read"],
    ["/admin/corrections", "✦", "AI Corrections", "admin.read"],
    ["/admin/review", "審", "Review AI", "admin.read"],
    ["/admin/model", "棋", "Model AI", "admin.read"],
    ["/admin/collection", "藏", "Tàng Kinh Các", "admin.read"],
    ["/admin/audit", "◷", "Nhật ký", "audit.read"],
    ["/admin/users", "♙", "Tài khoản", "users.manage"],
    ["/admin/security", "⌾", "Bảo mật", "admin.read"],
    ["/admin/maintenance", "▣", "Backup", "system.read"],
    ["/admin/system", "⚙", "Hệ thống", "system.read"],
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
            <div className={styles.identity}>
              <strong>{principal.displayName}</strong>
              <span>{principal.username} · {principal.role}</span>
            </div>
            <nav className={styles.nav} aria-label="Điều hướng quản trị">
              {links.filter(([, , , permission]) => can(permission)).map(([href, icon, label]) => {
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
              <span className={styles.status}>{principal.displayName} · {principal.role}</span>
            </div>
            {children}
          </main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
