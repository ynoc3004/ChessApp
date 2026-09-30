from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .audit_store import safe_record_event

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
AUTH_DB = DATA_DIR / "admin-users.sqlite3"
_LOCK = threading.RLock()
PASSWORD_ITERATIONS = 600_000
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
ROLES = ("owner", "admin", "moderator", "user")
ALL_PERMISSIONS = frozenset({
    "admin.read",
    "admin.write",
    "books.write",
    "puzzles.write",
    "dataset.write",
    "collection.write",
    "system.read",
    "audit.read",
    "users.manage",
})
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": ALL_PERMISSIONS,
    "admin": frozenset({
        "admin.read",
        "admin.write",
        "books.write",
        "puzzles.write",
        "dataset.write",
        "collection.write",
        "system.read",
        "audit.read",
    }),
    "moderator": frozenset({
        "admin.read",
        "books.write",
        "dataset.write",
        "collection.write",
    }),
    "user": frozenset(),
}
ROLE_DESCRIPTIONS = {
    "owner": "Toàn quyền, gồm quản lý tài khoản và phân quyền.",
    "admin": "Quản trị dữ liệu, Puzzle DB, hệ thống và nhật ký; không quản lý tài khoản.",
    "moderator": "Quản lý kỳ phổ, AI Dataset và Tàng Kinh Các; không đổi hệ thống hoặc Puzzle DB.",
    "user": "Tài khoản thường, không được vào Nội Các.",
}


@dataclass(frozen=True)
class AdminPrincipal:
    id: str
    username: str
    display_name: str
    role: str
    auth_type: str
    permissions: frozenset[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "displayName": self.display_name,
            "role": self.role,
            "authType": self.auth_type,
            "permissions": sorted(self.permissions),
        }


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=200)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    displayName: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=200)
    role: str = Field(default="moderator", max_length=20)


class UpdateUserRequest(BaseModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=80)
    role: str | None = Field(default=None, max_length=20)
    enabled: bool | None = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=10, max_length=200)


def _database(database: Path | None = None) -> Path:
    return database if database is not None else AUTH_DB


def _connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def ensure_schema(database: Path | None = None) -> None:
    path = _database(database)
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, closing(_connect(path)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS admin_users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created REAL NOT NULL,
                updated REAL NOT NULL,
                last_login REAL
            );
            CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created REAL NOT NULL,
                expires REAL NOT NULL,
                FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
            CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires);
            """
        )
        db.commit()


def normalize_username(value: str) -> str:
    username = value.strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang; dài 3–32 ký tự.")
    return username


def validate_role(role: str) -> str:
    value = role.strip().lower()
    if value not in ROLE_PERMISSIONS:
        raise ValueError("Role không hợp lệ.")
    return value


def validate_password(password: str) -> str:
    if len(password) < 10:
        raise ValueError("Mật khẩu phải có ít nhất 10 ký tự.")
    if len(password) > 200:
        raise ValueError("Mật khẩu quá dài.")
    return password


def hash_password(password: str, *, iterations: int = PASSWORD_ITERATIONS) -> str:
    validate_password(password)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = base64.b64decode(salt_text.encode("ascii"), validate=True)
        expected = base64.b64decode(digest_text.encode("ascii"), validate=True)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, base64.binascii.Error):
        return False


def _row_to_user(row: sqlite3.Row) -> dict[str, Any]:
    role = str(row["role"])
    return {
        "id": str(row["id"]),
        "username": str(row["username"]),
        "displayName": str(row["display_name"]),
        "role": role,
        "enabled": bool(row["enabled"]),
        "createdAt": float(row["created"]),
        "updatedAt": float(row["updated"]),
        "lastLoginAt": float(row["last_login"]) if row["last_login"] is not None else None,
        "authType": "account",
        "immutable": False,
        "permissions": sorted(ROLE_PERMISSIONS.get(role, frozenset())),
    }


def local_owner_record() -> dict[str, Any]:
    configured = bool(os.getenv("CHESSAPP_ADMIN_TOKEN", "").strip())
    return {
        "id": "local-owner",
        "username": "local-owner",
        "displayName": "Owner cục bộ",
        "role": "owner",
        "enabled": configured,
        "createdAt": None,
        "updatedAt": None,
        "lastLoginAt": None,
        "authType": "bootstrap",
        "immutable": True,
        "permissions": sorted(ALL_PERMISSIONS),
    }


def count_users(database: Path | None = None) -> int:
    path = _database(database)
    ensure_schema(path)
    with closing(_connect(path)) as db:
        return int(db.execute("SELECT COUNT(*) FROM admin_users").fetchone()[0])


def list_users(database: Path | None = None) -> list[dict[str, Any]]:
    path = _database(database)
    ensure_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            "SELECT id, username, display_name, role, enabled, created, updated, last_login "
            "FROM admin_users ORDER BY created ASC, username ASC"
        ).fetchall()
    return [_row_to_user(row) for row in rows]


def get_user(user_id: str, database: Path | None = None) -> dict[str, Any] | None:
    path = _database(database)
    ensure_schema(path)
    with closing(_connect(path)) as db:
        row = db.execute(
            "SELECT id, username, display_name, role, enabled, created, updated, last_login "
            "FROM admin_users WHERE id=?",
            (user_id,),
        ).fetchone()
    return _row_to_user(row) if row else None


def create_user(
    username: str,
    display_name: str,
    password: str,
    role: str,
    *,
    database: Path | None = None,
) -> dict[str, Any]:
    path = _database(database)
    ensure_schema(path)
    username = normalize_username(username)
    role = validate_role(role)
    display_name = display_name.strip()
    if not display_name:
        raise ValueError("Tên hiển thị không được để trống.")
    password_hash = hash_password(password)
    now = time.time()
    user_id = uuid.uuid4().hex
    try:
        with _LOCK, closing(_connect(path)) as db:
            db.execute(
                "INSERT INTO admin_users(id, username, display_name, password_hash, role, enabled, created, updated) "
                "VALUES(?,?,?,?,?,1,?,?)",
                (user_id, username, display_name, password_hash, role, now, now),
            )
            db.commit()
    except sqlite3.IntegrityError as exc:
        raise ValueError("Tên đăng nhập đã tồn tại.") from exc
    user = get_user(user_id, path)
    if user is None:  # pragma: no cover - defensive
        raise RuntimeError("Không tạo được tài khoản.")
    return user


def update_user(
    user_id: str,
    *,
    display_name: str | None = None,
    role: str | None = None,
    enabled: bool | None = None,
    database: Path | None = None,
) -> dict[str, Any]:
    path = _database(database)
    ensure_schema(path)
    current = get_user(user_id, path)
    if current is None:
        raise KeyError(user_id)

    updates: list[str] = []
    params: list[Any] = []
    invalidates_sessions = False
    if display_name is not None:
        value = display_name.strip()
        if not value:
            raise ValueError("Tên hiển thị không được để trống.")
        updates.append("display_name=?")
        params.append(value)
    if role is not None:
        value = validate_role(role)
        updates.append("role=?")
        params.append(value)
        invalidates_sessions = value != current["role"]
    if enabled is not None:
        updates.append("enabled=?")
        params.append(1 if enabled else 0)
        invalidates_sessions = invalidates_sessions or bool(enabled) != bool(current["enabled"])
    if not updates:
        return current

    updates.append("updated=?")
    params.append(time.time())
    params.append(user_id)
    with _LOCK, closing(_connect(path)) as db:
        db.execute(f"UPDATE admin_users SET {', '.join(updates)} WHERE id=?", params)
        if invalidates_sessions:
            db.execute("DELETE FROM admin_sessions WHERE user_id=?", (user_id,))
        db.commit()
    updated = get_user(user_id, path)
    if updated is None:  # pragma: no cover - defensive
        raise KeyError(user_id)
    return updated


def reset_password(user_id: str, password: str, database: Path | None = None) -> None:
    path = _database(database)
    ensure_schema(path)
    password_hash = hash_password(password)
    with _LOCK, closing(_connect(path)) as db:
        updated = db.execute(
            "UPDATE admin_users SET password_hash=?, updated=? WHERE id=?",
            (password_hash, time.time(), user_id),
        ).rowcount
        if not updated:
            raise KeyError(user_id)
        db.execute("DELETE FROM admin_sessions WHERE user_id=?", (user_id,))
        db.commit()


def delete_user(user_id: str, database: Path | None = None) -> None:
    path = _database(database)
    ensure_schema(path)
    with _LOCK, closing(_connect(path)) as db:
        deleted = db.execute("DELETE FROM admin_users WHERE id=?", (user_id,)).rowcount
        db.commit()
    if not deleted:
        raise KeyError(user_id)


def _session_ttl_seconds() -> int:
    raw = os.getenv("CHESSAPP_ADMIN_SESSION_HOURS", "12").strip()
    try:
        hours = max(1, min(168, int(raw)))
    except ValueError:
        hours = 12
    return hours * 3600


def _principal_from_user(row: sqlite3.Row) -> AdminPrincipal:
    role = str(row["role"])
    return AdminPrincipal(
        id=str(row["id"]),
        username=str(row["username"]),
        display_name=str(row["display_name"]),
        role=role,
        auth_type="account",
        permissions=ROLE_PERMISSIONS.get(role, frozenset()),
    )


def _local_owner_principal() -> AdminPrincipal:
    return AdminPrincipal(
        id="local-owner",
        username="local-owner",
        display_name="Owner cục bộ",
        role="owner",
        auth_type="bootstrap",
        permissions=ALL_PERMISSIONS,
    )


def login_user(username: str, password: str, database: Path | None = None) -> tuple[str, float, AdminPrincipal]:
    path = _database(database)
    ensure_schema(path)
    try:
        username = normalize_username(username)
    except ValueError as exc:
        raise PermissionError("Sai tên đăng nhập hoặc mật khẩu.") from exc

    with closing(_connect(path)) as db:
        row = db.execute("SELECT * FROM admin_users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
    if row is None or not bool(row["enabled"]) or not verify_password(password, str(row["password_hash"])):
        raise PermissionError("Sai tên đăng nhập hoặc mật khẩu.")

    principal = _principal_from_user(row)
    if "admin.read" not in principal.permissions:
        raise PermissionError("Tài khoản này không có quyền vào Nội Các.")

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    expires = now + _session_ttl_seconds()
    with _LOCK, closing(_connect(path)) as db:
        db.execute("DELETE FROM admin_sessions WHERE expires<=?", (now,))
        db.execute(
            "INSERT INTO admin_sessions(token_hash, user_id, created, expires) VALUES(?,?,?,?)",
            (token_hash, principal.id, now, expires),
        )
        db.execute("UPDATE admin_users SET last_login=?, updated=? WHERE id=?", (now, now, principal.id))
        db.commit()
    return token, expires, principal


def revoke_session(token: str, database: Path | None = None) -> None:
    if not token:
        return
    path = _database(database)
    ensure_schema(path)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with _LOCK, closing(_connect(path)) as db:
        db.execute("DELETE FROM admin_sessions WHERE token_hash=?", (token_hash,))
        db.commit()


def extract_bearer(authorization: str | None) -> str:
    prefix = "Bearer "
    if authorization and authorization.startswith(prefix):
        return authorization[len(prefix):].strip()
    return ""


def authenticate_token(token: str, database: Path | None = None) -> AdminPrincipal:
    token = token.strip()
    configured = os.getenv("CHESSAPP_ADMIN_TOKEN", "").strip()
    if configured and token and hmac.compare_digest(token, configured):
        return _local_owner_principal()
    if not token:
        raise PermissionError("Thiếu thông tin xác thực quản trị.")

    path = _database(database)
    ensure_schema(path)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    with _LOCK, closing(_connect(path)) as db:
        row = db.execute(
            "SELECT u.* FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id "
            "WHERE s.token_hash=? AND s.expires>?",
            (token_hash, now),
        ).fetchone()
        if row is None:
            db.execute("DELETE FROM admin_sessions WHERE token_hash=? OR expires<=?", (token_hash, now))
            db.commit()
            raise PermissionError("Phiên quản trị không hợp lệ hoặc đã hết hạn.")
        if not bool(row["enabled"]):
            db.execute("DELETE FROM admin_sessions WHERE token_hash=?", (token_hash,))
            db.commit()
            raise PermissionError("Tài khoản quản trị đã bị khóa.")
    return _principal_from_user(row)


def require_admin(authorization: str | None = Header(default=None)) -> AdminPrincipal:
    token = extract_bearer(authorization)
    if not token and not os.getenv("CHESSAPP_ADMIN_TOKEN", "").strip() and count_users() == 0:
        raise HTTPException(
            status_code=503,
            detail="Admin chưa được cấu hình. Hãy chạy backend\\start.ps1 để tạo mã owner cục bộ.",
        )
    try:
        principal = authenticate_token(token)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if "admin.read" not in principal.permissions:
        raise HTTPException(status_code=403, detail="Tài khoản không có quyền vào Nội Các.")
    return principal


def require_permission(permission: str) -> Callable[..., AdminPrincipal]:
    def dependency(authorization: str | None = Header(default=None)) -> AdminPrincipal:
        principal = require_admin(authorization)
        if permission not in principal.permissions:
            raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện thao tác này.")
        return principal

    return dependency


def required_permission(method: str, route_path: str) -> str:
    method = method.upper()
    path = route_path.lower()
    if "/users" in path:
        return "users.manage"
    if "/audit" in path:
        return "audit.read"
    if path.endswith("/system") or "/system/" in path:
        return "system.read"
    if method in {"GET", "HEAD", "OPTIONS"}:
        return "admin.read"
    if "/books" in path:
        return "books.write"
    if "/puzzles" in path:
        return "puzzles.write"
    if "/dataset" in path or "/corrections" in path:
        return "dataset.write"
    if "/collection" in path:
        return "collection.write"
    return "admin.write"


public_router = APIRouter(prefix="/api/admin/auth")
users_router = APIRouter(prefix="/users")


@public_router.post("/login")
def admin_login(payload: LoginRequest):
    try:
        token, expires, principal = login_user(payload.username, payload.password)
    except PermissionError as exc:
        safe_record_event(
            "POST auth/login",
            "auth",
            status="failure",
            message="Đăng nhập thất bại",
            details={"username": payload.username.strip().lower()},
        )
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    safe_record_event(
        "POST auth/login",
        "auth",
        principal.id,
        status="success",
        message="Đăng nhập tài khoản quản trị",
        details={"username": principal.username},
        actor=principal.to_dict(),
    )
    return {"token": token, "expiresAt": expires, "principal": principal.to_dict()}


@public_router.post("/logout")
def admin_logout(authorization: str | None = Header(default=None)):
    token = extract_bearer(authorization)
    principal: AdminPrincipal | None = None
    if token:
        try:
            principal = authenticate_token(token)
        except PermissionError:
            principal = None
        revoke_session(token)
    safe_record_event(
        "POST auth/logout",
        "auth",
        principal.id if principal else None,
        status="success",
        message="Khóa phiên quản trị",
        actor=principal.to_dict() if principal else None,
    )
    return {"ok": True}


@users_router.get("")
def admin_users(principal: AdminPrincipal = Depends(require_permission("users.manage"))):
    del principal
    return {"users": [local_owner_record(), *list_users()]}


@users_router.get("/roles")
def admin_roles(principal: AdminPrincipal = Depends(require_permission("users.manage"))):
    del principal
    return {
        "roles": [
            {
                "name": role,
                "description": ROLE_DESCRIPTIONS[role],
                "permissions": sorted(ROLE_PERMISSIONS[role]),
            }
            for role in ROLES
        ]
    }


@users_router.post("")
def admin_create_user(
    payload: CreateUserRequest,
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    try:
        user = create_user(payload.username, payload.displayName, payload.password, payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    safe_record_event(
        "POST users",
        "users",
        user["id"],
        status="success",
        message="Tạo tài khoản quản trị",
        details={"username": user["username"], "role": user["role"]},
        actor=principal.to_dict(),
    )
    return user


@users_router.patch("/{user_id}")
def admin_update_user(
    user_id: str,
    payload: UpdateUserRequest,
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    if user_id == "local-owner":
        raise HTTPException(status_code=409, detail="Owner cục bộ được quản lý bằng CHESSAPP_ADMIN_TOKEN, không sửa tại đây.")
    current = get_user(user_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    if user_id == principal.id:
        if payload.enabled is False:
            raise HTTPException(status_code=409, detail="Không thể tự khóa tài khoản đang đăng nhập.")
        if payload.role is not None and payload.role != current["role"]:
            raise HTTPException(status_code=409, detail="Không thể tự đổi role của tài khoản đang đăng nhập.")
    try:
        updated = update_user(
            user_id,
            display_name=payload.displayName,
            role=payload.role,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    safe_record_event(
        "PATCH users/:id",
        "users",
        user_id,
        status="success",
        message="Cập nhật tài khoản quản trị",
        details={"username": updated["username"], "role": updated["role"], "enabled": updated["enabled"]},
        actor=principal.to_dict(),
    )
    return updated


@users_router.post("/{user_id}/password")
def admin_reset_user_password(
    user_id: str,
    payload: ResetPasswordRequest,
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    if user_id == "local-owner":
        raise HTTPException(status_code=409, detail="Đổi mã owner cục bộ trong backend/.env.")
    try:
        reset_password(user_id, payload.password)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    safe_record_event(
        "POST users/:id/password",
        "users",
        user_id,
        status="success",
        message="Đặt lại mật khẩu quản trị",
        actor=principal.to_dict(),
    )
    return {"ok": True, "userId": user_id}


@users_router.delete("/{user_id}")
def admin_delete_user(
    user_id: str,
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    if user_id == "local-owner":
        raise HTTPException(status_code=409, detail="Không thể xóa owner cục bộ.")
    if user_id == principal.id:
        raise HTTPException(status_code=409, detail="Không thể tự xóa tài khoản đang đăng nhập.")
    user = get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    try:
        delete_user(user_id)
    except KeyError as exc:  # pragma: no cover - race protection
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.") from exc
    safe_record_event(
        "DELETE users/:id",
        "users",
        user_id,
        status="success",
        message="Xóa tài khoản quản trị",
        details={"username": user["username"], "role": user["role"]},
        actor=principal.to_dict(),
    )
    return {"deleted": True, "userId": user_id}
