from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .admin_auth import (
    AUTH_DB,
    AdminPrincipal,
    _connect,
    _database,
    _session_ttl_seconds,
    ensure_schema,
    extract_bearer,
    get_user,
    hash_password,
    require_admin,
    require_permission,
    verify_password,
)
from .audit_store import safe_record_event

router = APIRouter(prefix="/api/admin/security", dependencies=[Depends(require_admin)])


class ChangePasswordRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=200)
    newPassword: str = Field(min_length=10, max_length=200)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _public_session_id(token_hash: str) -> str:
    return hashlib.sha256(f"chessapp-session:{token_hash}".encode("utf-8")).hexdigest()[:24]


def list_account_sessions(
    user_id: str,
    *,
    current_token: str = "",
    database: Path | None = None,
) -> list[dict[str, Any]]:
    path = _database(database)
    ensure_schema(path)
    now = time.time()
    current_hash = _token_hash(current_token) if current_token else ""
    with closing(_connect(path)) as db:
        db.execute("DELETE FROM admin_sessions WHERE expires<=?", (now,))
        rows = db.execute(
            "SELECT token_hash, created, expires FROM admin_sessions "
            "WHERE user_id=? AND expires>? ORDER BY created DESC",
            (user_id, now),
        ).fetchall()
        db.commit()
    return [
        {
            "id": _public_session_id(str(row["token_hash"])),
            "createdAt": float(row["created"]),
            "expiresAt": float(row["expires"]),
            "remainingSeconds": max(0, int(float(row["expires"]) - now)),
            "current": bool(current_hash and hmac.compare_digest(str(row["token_hash"]), current_hash)),
        }
        for row in rows
    ]


def revoke_session_by_public_id(
    user_id: str,
    session_id: str,
    *,
    database: Path | None = None,
) -> bool:
    path = _database(database)
    ensure_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            "SELECT token_hash FROM admin_sessions WHERE user_id=?",
            (user_id,),
        ).fetchall()
        target = next(
            (str(row["token_hash"]) for row in rows if _public_session_id(str(row["token_hash"])) == session_id),
            None,
        )
        if target is None:
            return False
        db.execute("DELETE FROM admin_sessions WHERE user_id=? AND token_hash=?", (user_id, target))
        db.commit()
    return True


def revoke_other_sessions(
    user_id: str,
    current_token: str,
    *,
    database: Path | None = None,
) -> int:
    path = _database(database)
    ensure_schema(path)
    current_hash = _token_hash(current_token)
    with closing(_connect(path)) as db:
        deleted = db.execute(
            "DELETE FROM admin_sessions WHERE user_id=? AND token_hash<>?",
            (user_id, current_hash),
        ).rowcount
        db.commit()
    return int(deleted)


def revoke_all_user_sessions(user_id: str, *, database: Path | None = None) -> int:
    path = _database(database)
    ensure_schema(path)
    with closing(_connect(path)) as db:
        deleted = db.execute("DELETE FROM admin_sessions WHERE user_id=?", (user_id,)).rowcount
        db.commit()
    return int(deleted)


def account_session_summary(*, database: Path | None = None) -> list[dict[str, Any]]:
    path = _database(database)
    ensure_schema(path)
    now = time.time()
    with closing(_connect(path)) as db:
        db.execute("DELETE FROM admin_sessions WHERE expires<=?", (now,))
        rows = db.execute(
            "SELECT u.id, u.username, u.display_name, u.role, u.enabled, "
            "COUNT(s.token_hash) AS session_count, MAX(s.created) AS newest_session "
            "FROM admin_users u LEFT JOIN admin_sessions s "
            "ON s.user_id=u.id AND s.expires>? "
            "GROUP BY u.id, u.username, u.display_name, u.role, u.enabled "
            "ORDER BY session_count DESC, u.username ASC",
            (now,),
        ).fetchall()
        db.commit()
    return [
        {
            "id": str(row["id"]),
            "username": str(row["username"]),
            "displayName": str(row["display_name"]),
            "role": str(row["role"]),
            "enabled": bool(row["enabled"]),
            "sessionCount": int(row["session_count"] or 0),
            "newestSessionAt": float(row["newest_session"]) if row["newest_session"] is not None else None,
        }
        for row in rows
    ]


def change_account_password(
    user_id: str,
    current_password: str,
    new_password: str,
    *,
    database: Path | None = None,
) -> None:
    path = _database(database)
    ensure_schema(path)
    with closing(_connect(path)) as db:
        row = db.execute("SELECT password_hash FROM admin_users WHERE id=? AND enabled=1", (user_id,)).fetchone()
        if row is None or not verify_password(current_password, str(row["password_hash"])):
            raise PermissionError("Mật khẩu hiện tại không đúng.")
        password_hash = hash_password(new_password)
        now = time.time()
        db.execute(
            "UPDATE admin_users SET password_hash=?, updated=? WHERE id=?",
            (password_hash, now, user_id),
        )
        db.execute("DELETE FROM admin_sessions WHERE user_id=?", (user_id,))
        db.commit()


def _current_token(authorization: str | None) -> str:
    return extract_bearer(authorization)


@router.get("")
def security_overview(
    authorization: str | None = Header(default=None),
    principal: AdminPrincipal = Depends(require_admin),
):
    token = _current_token(authorization)
    sessions = [] if principal.auth_type == "bootstrap" else list_account_sessions(principal.id, current_token=token)
    return {
        "principal": principal.to_dict(),
        "sessions": sessions,
        "sessionCount": len(sessions),
        "sessionHours": max(1, int(_session_ttl_seconds() / 3600)),
        "bootstrap": principal.auth_type == "bootstrap",
    }


@router.delete("/sessions/{session_id}")
def delete_own_session(
    session_id: str,
    principal: AdminPrincipal = Depends(require_admin),
):
    if principal.auth_type == "bootstrap":
        raise HTTPException(status_code=409, detail="Owner local không dùng session SQLite.")
    if not revoke_session_by_public_id(principal.id, session_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên đăng nhập.")
    safe_record_event(
        "DELETE security/sessions/:id",
        "security",
        session_id,
        message="Thu hồi phiên đăng nhập",
        actor=principal.to_dict(),
    )
    return {"revoked": True, "sessionId": session_id}


@router.post("/sessions/revoke-others")
def delete_other_sessions(
    authorization: str | None = Header(default=None),
    principal: AdminPrincipal = Depends(require_admin),
):
    if principal.auth_type == "bootstrap":
        return {"revoked": 0, "bootstrap": True}
    token = _current_token(authorization)
    deleted = revoke_other_sessions(principal.id, token)
    safe_record_event(
        "POST security/sessions/revoke-others",
        "security",
        principal.id,
        message="Thu hồi các phiên đăng nhập khác",
        details={"revoked": deleted},
        actor=principal.to_dict(),
    )
    return {"revoked": deleted}


@router.post("/password")
def change_own_password(
    payload: ChangePasswordRequest,
    principal: AdminPrincipal = Depends(require_admin),
):
    if principal.auth_type == "bootstrap":
        raise HTTPException(status_code=409, detail="Đổi mã owner local trong backend/.env rồi khởi động lại backend.")
    try:
        change_account_password(principal.id, payload.currentPassword, payload.newPassword)
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    safe_record_event(
        "POST security/password",
        "security",
        principal.id,
        message="Đổi mật khẩu tài khoản hiện tại",
        actor=principal.to_dict(),
    )
    return {"ok": True, "reauthenticate": True}


@router.get("/users")
def owner_session_summary(
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    del principal
    return {"users": account_session_summary()}


@router.post("/users/{user_id}/revoke-sessions")
def owner_revoke_user_sessions(
    user_id: str,
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    if user_id == "local-owner":
        raise HTTPException(status_code=409, detail="Owner local không dùng session SQLite.")
    user = get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản.")
    deleted = revoke_all_user_sessions(user_id)
    safe_record_event(
        "POST security/users/:id/revoke-sessions",
        "security",
        user_id,
        message="Owner thu hồi toàn bộ phiên của tài khoản",
        details={"username": user["username"], "revoked": deleted},
        actor=principal.to_dict(),
    )
    return {"revoked": deleted, "userId": user_id}
