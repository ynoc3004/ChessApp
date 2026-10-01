from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .academy import (
    ACADEMY_DB,
    _LOCK,
    _connect,
    _extract_bearer,
    _hash_password,
    _normalize_username,
    _verify_password,
    ensure_schema,
)
from .academy_game_analysis import practical_profile, student_games
from .academy_teacher import (
    CreateAssignmentRequest,
    _teacher_assignment_summaries,
    create_assignment,
    ensure_teacher_schema,
    teacher_dashboard,
)
from .academy_tournament import list_tournaments
from .academy_training import training_profile
from .admin_auth import require_permission

admin_router = APIRouter(
    prefix="/academy/teacher-accounts",
    dependencies=[Depends(require_permission("admin.write"))],
)
public_router = APIRouter(prefix="/api/teacher")


class TeacherLoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=200)


class CreateTeacherAccountRequest(BaseModel):
    teacherId: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=10, max_length=200)


class UpdateTeacherAccountRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=32)
    password: str | None = Field(default=None, min_length=10, max_length=200)
    enabled: bool | None = None


class TeacherAssignmentRequest(BaseModel):
    targetType: Literal["class", "student"]
    targetId: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    theme: str | None = Field(default=None, max_length=80)
    ratingMin: int = Field(default=800, ge=400, le=3000)
    ratingMax: int = Field(default=1600, ge=400, le=3000)
    puzzleCount: int = Field(default=10, ge=1, le=50)
    dueAt: float | None = None


class TeacherAssignmentUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    dueAt: float | None = None
    active: bool | None = None


def ensure_teacher_portal_schema(database: Path | None = None) -> None:
    path = database or ACADEMY_DB
    ensure_teacher_schema(path)
    with closing(_connect(path)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS academy_teacher_accounts (
                teacher_id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created REAL NOT NULL,
                updated REAL NOT NULL,
                last_login REAL,
                FOREIGN KEY(teacher_id) REFERENCES academy_teachers(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_teacher_sessions (
                token_hash TEXT PRIMARY KEY,
                teacher_id TEXT NOT NULL,
                created REAL NOT NULL,
                expires REAL NOT NULL,
                FOREIGN KEY(teacher_id) REFERENCES academy_teachers(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_academy_teacher_sessions_teacher
                ON academy_teacher_sessions(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_academy_teacher_sessions_expires
                ON academy_teacher_sessions(expires);
            """
        )
        db.commit()


def _session_hours() -> int:
    raw = os.getenv("CHESSAPP_TEACHER_SESSION_HOURS", "168").strip()
    try:
        return max(1, min(720, int(raw)))
    except ValueError:
        return 168


def _teacher_account_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "teacherId": str(row["teacher_id"]),
        "displayName": str(row["display_name"]),
        "bio": str(row["bio"] or ""),
        "aiProfileId": row["ai_profile_id"],
        "username": str(row["username"]),
        "enabled": bool(row["enabled"]),
        "teacherActive": bool(row["teacher_active"]),
        "lastLoginAt": float(row["last_login"]) if row["last_login"] is not None else None,
    }


def _account_row(teacher_id: str, database: Path) -> sqlite3.Row | None:
    with closing(_connect(database)) as db:
        return db.execute(
            """
            SELECT a.*,t.display_name,t.bio,t.ai_profile_id,t.active teacher_active
            FROM academy_teacher_accounts a
            JOIN academy_teachers t ON t.id=a.teacher_id
            WHERE a.teacher_id=?
            """,
            (teacher_id,),
        ).fetchone()


def create_teacher_account(
    teacher_id: str,
    username: str,
    password: str,
    database: Path | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_teacher_portal_schema(path)
    normalized = _normalize_username(username)
    password_hash = _hash_password(password)
    now = time.time()
    with _LOCK, closing(_connect(path)) as db:
        teacher = db.execute("SELECT id,active FROM academy_teachers WHERE id=?", (teacher_id,)).fetchone()
        if teacher is None:
            raise LookupError("teacher")
        if not bool(teacher["active"]):
            raise ValueError("Giáo viên đang bị vô hiệu hóa.")
        try:
            db.execute(
                "INSERT INTO academy_teacher_accounts(teacher_id,username,password_hash,enabled,created,updated) VALUES(?,?,?,1,?,?)",
                (teacher_id, normalized, password_hash, now, now),
            )
            db.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("Giáo viên đã có tài khoản hoặc tên đăng nhập đã tồn tại.") from exc
    row = _account_row(teacher_id, path)
    assert row is not None
    return _teacher_account_payload(row)


def _login_teacher(username: str, password: str, database: Path | None = None) -> tuple[str, float, dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_teacher_portal_schema(path)
    try:
        normalized = _normalize_username(username)
    except ValueError as exc:
        raise PermissionError("Sai tên đăng nhập hoặc mật khẩu.") from exc
    with closing(_connect(path)) as db:
        row = db.execute(
            """
            SELECT a.*,t.display_name,t.bio,t.ai_profile_id,t.active teacher_active
            FROM academy_teacher_accounts a JOIN academy_teachers t ON t.id=a.teacher_id
            WHERE a.username=? COLLATE NOCASE
            """,
            (normalized,),
        ).fetchone()
    if (
        row is None
        or not bool(row["enabled"])
        or not bool(row["teacher_active"])
        or not _verify_password(password, str(row["password_hash"]))
    ):
        raise PermissionError("Sai tên đăng nhập hoặc mật khẩu.")
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    expires = now + _session_hours() * 3600
    with _LOCK, closing(_connect(path)) as db:
        db.execute("DELETE FROM academy_teacher_sessions WHERE expires<=?", (now,))
        db.execute(
            "INSERT INTO academy_teacher_sessions(token_hash,teacher_id,created,expires) VALUES(?,?,?,?)",
            (token_hash, row["teacher_id"], now, expires),
        )
        db.execute(
            "UPDATE academy_teacher_accounts SET last_login=?,updated=? WHERE teacher_id=?",
            (now, now, row["teacher_id"]),
        )
        db.commit()
    payload = _teacher_account_payload(row)
    payload["lastLoginAt"] = now
    return token, expires, payload


def _authenticate_teacher_token(token: str, database: Path | None = None) -> dict[str, Any]:
    if not token:
        raise PermissionError("Thiếu phiên đăng nhập giáo viên.")
    path = database or ACADEMY_DB
    ensure_teacher_portal_schema(path)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    with _LOCK, closing(_connect(path)) as db:
        row = db.execute(
            """
            SELECT a.*,t.display_name,t.bio,t.ai_profile_id,t.active teacher_active
            FROM academy_teacher_sessions s
            JOIN academy_teacher_accounts a ON a.teacher_id=s.teacher_id
            JOIN academy_teachers t ON t.id=a.teacher_id
            WHERE s.token_hash=? AND s.expires>?
            """,
            (token_hash, now),
        ).fetchone()
        if row is None:
            db.execute("DELETE FROM academy_teacher_sessions WHERE token_hash=? OR expires<=?", (token_hash, now))
            db.commit()
            raise PermissionError("Phiên giáo viên không hợp lệ hoặc đã hết hạn.")
        if not bool(row["enabled"]) or not bool(row["teacher_active"]):
            db.execute("DELETE FROM academy_teacher_sessions WHERE token_hash=?", (token_hash,))
            db.commit()
            raise PermissionError("Tài khoản giáo viên đã bị khóa.")
    return _teacher_account_payload(row)


def require_teacher(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    try:
        return _authenticate_teacher_token(_extract_bearer(authorization))
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _teacher_owns_student(teacher_id: str, student_id: str, database: Path) -> bool:
    with closing(_connect(database)) as db:
        row = db.execute(
            """
            SELECT 1 FROM academy_enrollments e
            JOIN academy_classes c ON c.id=e.class_id AND c.active=1
            JOIN academy_students s ON s.id=e.student_id AND s.enabled=1
            WHERE e.active=1 AND c.teacher_id=? AND s.id=? LIMIT 1
            """,
            (teacher_id, student_id),
        ).fetchone()
    return row is not None


def _teacher_tournaments(teacher_id: str, database: Path) -> list[dict[str, Any]]:
    with closing(_connect(database)) as db:
        class_ids = {
            str(row["id"])
            for row in db.execute(
                "SELECT id FROM academy_classes WHERE teacher_id=? AND active=1",
                (teacher_id,),
            ).fetchall()
        }
    return [
        item for item in list_tournaments(database)
        if item.get("classId") is None or str(item.get("classId")) in class_ids
    ]


@admin_router.get("")
def admin_list_teacher_accounts():
    ensure_teacher_portal_schema()
    with closing(_connect()) as db:
        rows = db.execute(
            """
            SELECT a.*,t.display_name,t.bio,t.ai_profile_id,t.active teacher_active
            FROM academy_teacher_accounts a JOIN academy_teachers t ON t.id=a.teacher_id
            ORDER BY a.enabled DESC,t.display_name
            """
        ).fetchall()
    return {"accounts": [_teacher_account_payload(row) for row in rows]}


@admin_router.post("")
def admin_create_teacher_account(payload: CreateTeacherAccountRequest):
    try:
        return create_teacher_account(payload.teacherId, payload.username, payload.password)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy giáo viên.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@admin_router.patch("/{teacher_id}")
def admin_update_teacher_account(teacher_id: str, payload: UpdateTeacherAccountRequest):
    ensure_teacher_portal_schema()
    updates: list[str] = []
    values: list[Any] = []
    if payload.username is not None:
        updates.append("username=?")
        values.append(_normalize_username(payload.username))
    if payload.password is not None:
        updates.append("password_hash=?")
        values.append(_hash_password(payload.password))
    if payload.enabled is not None:
        updates.append("enabled=?")
        values.append(1 if payload.enabled else 0)
    if not updates:
        raise HTTPException(status_code=400, detail="Không có thay đổi.")
    updates.append("updated=?")
    values.extend((time.time(), teacher_id))
    try:
        with _LOCK, closing(_connect()) as db:
            if db.execute(
                f"UPDATE academy_teacher_accounts SET {','.join(updates)} WHERE teacher_id=?",
                values,
            ).rowcount == 0:
                raise HTTPException(status_code=404, detail="Giáo viên chưa có tài khoản Portal.")
            if payload.enabled is False or payload.password is not None or payload.username is not None:
                db.execute("DELETE FROM academy_teacher_sessions WHERE teacher_id=?", (teacher_id,))
            db.commit()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=400, detail="Tên đăng nhập đã được sử dụng.") from exc
    row = _account_row(teacher_id, ACADEMY_DB)
    assert row is not None
    return _teacher_account_payload(row)


@public_router.post("/auth/login")
def teacher_login(payload: TeacherLoginRequest):
    try:
        token, expires, teacher = _login_teacher(payload.username, payload.password)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"token": token, "expiresAt": expires, "teacher": teacher}


@public_router.post("/auth/logout")
def teacher_logout(authorization: str | None = Header(default=None)):
    token = _extract_bearer(authorization)
    if token:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with _LOCK, closing(_connect()) as db:
            db.execute("DELETE FROM academy_teacher_sessions WHERE token_hash=?", (token_hash,))
            db.commit()
    return {"ok": True}


@public_router.get("/me")
def teacher_me(teacher: dict[str, Any] = Depends(require_teacher)):
    return teacher


@public_router.get("/dashboard")
def teacher_portal_dashboard(teacher: dict[str, Any] = Depends(require_teacher)):
    return teacher_dashboard(str(teacher["teacherId"]))


@public_router.get("/assignments")
def teacher_portal_assignments(teacher: dict[str, Any] = Depends(require_teacher)):
    ensure_teacher_portal_schema()
    return {
        "assignments": _teacher_assignment_summaries(
            str(teacher["teacherId"]), ACADEMY_DB, time.time()
        )
    }


@public_router.post("/assignments")
def teacher_portal_create_assignment(
    payload: TeacherAssignmentRequest,
    teacher: dict[str, Any] = Depends(require_teacher),
):
    try:
        return create_assignment(
            CreateAssignmentRequest(
                teacherId=str(teacher["teacherId"]),
                targetType=payload.targetType,
                targetId=payload.targetId,
                title=payload.title,
                description=payload.description,
                theme=payload.theme,
                ratingMin=payload.ratingMin,
                ratingMax=payload.ratingMax,
                puzzleCount=payload.puzzleCount,
                dueAt=payload.dueAt,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Lớp/đệ tử không thuộc phạm vi phụ trách.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@public_router.patch("/assignments/{assignment_id}")
def teacher_portal_update_assignment(
    assignment_id: str,
    payload: TeacherAssignmentUpdateRequest,
    teacher: dict[str, Any] = Depends(require_teacher),
):
    ensure_teacher_portal_schema()
    with closing(_connect()) as db:
        row = db.execute(
            "SELECT id FROM academy_assignments WHERE id=? AND teacher_id=?",
            (assignment_id, teacher["teacherId"]),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy bài tập thuộc giáo viên này.")
        updates: list[str] = []
        values: list[Any] = []
        if payload.title is not None:
            updates.append("title=?")
            values.append(payload.title.strip())
        if payload.description is not None:
            updates.append("description=?")
            values.append(payload.description.strip())
        if payload.dueAt is not None:
            updates.append("due_at=?")
            values.append(payload.dueAt)
        if payload.active is not None:
            updates.append("active=?")
            values.append(1 if payload.active else 0)
        if not updates:
            raise HTTPException(status_code=400, detail="Không có thay đổi.")
        updates.append("updated=?")
        values.extend((time.time(), assignment_id, teacher["teacherId"]))
        db.execute(
            f"UPDATE academy_assignments SET {','.join(updates)} WHERE id=? AND teacher_id=?",
            values,
        )
        db.commit()
    return {"updated": True, "assignmentId": assignment_id}


@public_router.get("/students/{student_id}")
def teacher_student_detail(student_id: str, teacher: dict[str, Any] = Depends(require_teacher)):
    teacher_id = str(teacher["teacherId"])
    if not _teacher_owns_student(teacher_id, student_id, ACADEMY_DB):
        raise HTTPException(status_code=404, detail="Đệ tử không thuộc phạm vi phụ trách.")
    with closing(_connect()) as db:
        row = db.execute(
            "SELECT id,username,display_name,current_step,placement_status,xp,puzzle_rating FROM academy_students WHERE id=?",
            (student_id,),
        ).fetchone()
    assert row is not None
    return {
        "student": {
            "id": str(row["id"]),
            "username": str(row["username"]),
            "displayName": str(row["display_name"]),
            "currentStep": row["current_step"],
            "placementStatus": str(row["placement_status"]),
            "xp": int(row["xp"]),
            "puzzleRating": int(row["puzzle_rating"]),
        },
        "training": training_profile(student_id),
        "practical": practical_profile(student_id),
        "games": student_games(student_id, limit=12),
    }


@public_router.get("/tournaments")
def teacher_portal_tournaments(teacher: dict[str, Any] = Depends(require_teacher)):
    return {"tournaments": _teacher_tournaments(str(teacher["teacherId"]), ACADEMY_DB)}
