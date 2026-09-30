from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .admin_auth import AdminPrincipal, require_permission

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
ACADEMY_DB = DATA_DIR / "academy.sqlite3"
_LOCK = threading.RLock()
PASSWORD_ITERATIONS = 450_000
USERNAME_ALLOWED = set("abcdefghijklmnopqrstuvwxyz0123456789._-")

public_router = APIRouter(prefix="/api/academy")
admin_router = APIRouter(prefix="/academy", dependencies=[Depends(require_permission("admin.write"))])


class StudentLoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=200)


class CreateStudentRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    displayName: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=200)
    classId: str | None = None


class UpdateStudentRequest(BaseModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=80)
    enabled: bool | None = None
    currentStep: int | None = Field(default=None, ge=1, le=20)


class CreateTeacherRequest(BaseModel):
    displayName: str = Field(min_length=1, max_length=80)
    bio: str = Field(default="", max_length=1000)
    aiProfileId: str | None = Field(default=None, max_length=120)


class UpdateTeacherRequest(BaseModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=80)
    bio: str | None = Field(default=None, max_length=1000)
    aiProfileId: str | None = Field(default=None, max_length=120)
    active: bool | None = None


class CreateClassRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    stepMin: int = Field(ge=1, le=20)
    stepMax: int = Field(ge=1, le=20)
    teacherId: str


class UpdateClassRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    stepMin: int | None = Field(default=None, ge=1, le=20)
    stepMax: int | None = Field(default=None, ge=1, le=20)
    teacherId: str | None = None
    active: bool | None = None


class AssignClassRequest(BaseModel):
    classId: str


class PlacementQuestionRequest(BaseModel):
    step: int = Field(ge=1, le=20)
    skill: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=1000)
    options: list[str] = Field(min_length=2, max_length=8)
    correctIndex: int = Field(ge=0, le=7)
    explanation: str = Field(default="", max_length=2000)


class UpdatePlacementQuestionRequest(BaseModel):
    step: int | None = Field(default=None, ge=1, le=20)
    skill: str | None = Field(default=None, min_length=1, max_length=80)
    prompt: str | None = Field(default=None, min_length=1, max_length=1000)
    options: list[str] | None = Field(default=None, min_length=2, max_length=8)
    correctIndex: int | None = Field(default=None, ge=0, le=7)
    explanation: str | None = Field(default=None, max_length=2000)
    active: bool | None = None


class PlacementSubmitRequest(BaseModel):
    attemptId: str
    answers: dict[str, int]


def _connect(database: Path | None = None) -> sqlite3.Connection:
    path = database or ACADEMY_DB
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def ensure_schema(database: Path | None = None) -> None:
    path = database or ACADEMY_DB
    with _LOCK, closing(_connect(path)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS academy_teachers (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT '',
                ai_profile_id TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created REAL NOT NULL,
                updated REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS academy_classes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                step_min INTEGER NOT NULL,
                step_max INTEGER NOT NULL,
                teacher_id TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created REAL NOT NULL,
                updated REAL NOT NULL,
                FOREIGN KEY(teacher_id) REFERENCES academy_teachers(id)
            );
            CREATE TABLE IF NOT EXISTS academy_students (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                current_step INTEGER,
                placement_status TEXT NOT NULL DEFAULT 'pending',
                xp INTEGER NOT NULL DEFAULT 0,
                puzzle_rating INTEGER NOT NULL DEFAULT 800,
                created REAL NOT NULL,
                updated REAL NOT NULL,
                last_login REAL
            );
            CREATE TABLE IF NOT EXISTS academy_student_sessions (
                token_hash TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                created REAL NOT NULL,
                expires REAL NOT NULL,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_enrollments (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                class_id TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                enrolled_at REAL NOT NULL,
                ended_at REAL,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE,
                FOREIGN KEY(class_id) REFERENCES academy_classes(id)
            );
            CREATE TABLE IF NOT EXISTS academy_placement_questions (
                id TEXT PRIMARY KEY,
                step INTEGER NOT NULL,
                skill TEXT NOT NULL,
                prompt TEXT NOT NULL,
                options_json TEXT NOT NULL,
                correct_index INTEGER NOT NULL,
                explanation TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                created REAL NOT NULL,
                updated REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS academy_placement_attempts (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                status TEXT NOT NULL,
                question_ids_json TEXT NOT NULL,
                answers_json TEXT NOT NULL DEFAULT '{}',
                skill_scores_json TEXT NOT NULL DEFAULT '{}',
                step_scores_json TEXT NOT NULL DEFAULT '{}',
                score REAL,
                recommended_step INTEGER,
                started REAL NOT NULL,
                completed REAL,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_academy_sessions_student ON academy_student_sessions(student_id);
            CREATE INDEX IF NOT EXISTS idx_academy_sessions_expires ON academy_student_sessions(expires);
            CREATE INDEX IF NOT EXISTS idx_academy_enrollments_student ON academy_enrollments(student_id, active);
            CREATE INDEX IF NOT EXISTS idx_academy_classes_teacher ON academy_classes(teacher_id, active);
            CREATE INDEX IF NOT EXISTS idx_academy_questions_step ON academy_placement_questions(active, step, skill);
            CREATE INDEX IF NOT EXISTS idx_academy_attempts_student ON academy_placement_attempts(student_id, started DESC);
            """
        )
        db.commit()


def _normalize_username(value: str) -> str:
    username = value.strip().lower()
    if not 3 <= len(username) <= 32 or username[0] not in USERNAME_ALLOWED:
        raise ValueError("Tên đăng nhập phải dài 3–32 ký tự.")
    if any(char not in USERNAME_ALLOWED for char in username):
        raise ValueError("Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.")
    return username


def _validate_password(password: str) -> None:
    if len(password) < 10:
        raise ValueError("Mật khẩu phải có ít nhất 10 ký tự.")
    if len(password) > 200:
        raise ValueError("Mật khẩu quá dài.")


def _hash_password(password: str) -> str:
    _validate_password(password)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_text.encode("ascii"), validate=True)
        expected = base64.b64decode(digest_text.encode("ascii"), validate=True)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations_text))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, base64.binascii.Error):
        return False


def _session_hours() -> int:
    raw = os.getenv("CHESSAPP_STUDENT_SESSION_HOURS", "168").strip()
    try:
        return max(1, min(720, int(raw)))
    except ValueError:
        return 168


def _student_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "username": str(row["username"]),
        "displayName": str(row["display_name"]),
        "enabled": bool(row["enabled"]),
        "currentStep": int(row["current_step"]) if row["current_step"] is not None else None,
        "placementStatus": str(row["placement_status"]),
        "xp": int(row["xp"]),
        "puzzleRating": int(row["puzzle_rating"]),
        "createdAt": float(row["created"]),
        "lastLoginAt": float(row["last_login"]) if row["last_login"] is not None else None,
    }


def _teacher_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "displayName": str(row["display_name"]),
        "bio": str(row["bio"] or ""),
        "aiProfileId": row["ai_profile_id"],
        "active": bool(row["active"]),
    }


def _class_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "stepMin": int(row["step_min"]),
        "stepMax": int(row["step_max"]),
        "teacherId": str(row["teacher_id"]),
        "teacherName": row["teacher_name"] if "teacher_name" in row.keys() else None,
        "active": bool(row["active"]),
        "studentCount": int(row["student_count"]) if "student_count" in row.keys() else 0,
    }


def create_teacher(display_name: str, bio: str = "", ai_profile_id: str | None = None, database: Path | None = None) -> dict:
    path = database or ACADEMY_DB
    ensure_schema(path)
    now = time.time()
    teacher_id = uuid.uuid4().hex
    with _LOCK, closing(_connect(path)) as db:
        db.execute(
            "INSERT INTO academy_teachers(id,display_name,bio,ai_profile_id,active,created,updated) VALUES(?,?,?,?,1,?,?)",
            (teacher_id, display_name.strip(), bio.strip(), ai_profile_id.strip() if ai_profile_id else None, now, now),
        )
        db.commit()
        row = db.execute("SELECT * FROM academy_teachers WHERE id=?", (teacher_id,)).fetchone()
    return _teacher_payload(row)


def create_class(name: str, step_min: int, step_max: int, teacher_id: str, database: Path | None = None) -> dict:
    if step_min > step_max:
        raise ValueError("Step tối thiểu không được lớn hơn Step tối đa.")
    path = database or ACADEMY_DB
    ensure_schema(path)
    now = time.time()
    class_id = uuid.uuid4().hex
    with _LOCK, closing(_connect(path)) as db:
        teacher = db.execute("SELECT id FROM academy_teachers WHERE id=? AND active=1", (teacher_id,)).fetchone()
        if teacher is None:
            raise KeyError("teacher")
        db.execute(
            "INSERT INTO academy_classes(id,name,step_min,step_max,teacher_id,active,created,updated) VALUES(?,?,?,?,?,1,?,?)",
            (class_id, name.strip(), step_min, step_max, teacher_id, now, now),
        )
        db.commit()
        row = db.execute(
            "SELECT c.*,t.display_name teacher_name,0 student_count FROM academy_classes c JOIN academy_teachers t ON t.id=c.teacher_id WHERE c.id=?",
            (class_id,),
        ).fetchone()
    return _class_payload(row)


def assign_student_class(student_id: str, class_id: str, database: Path | None = None) -> dict:
    path = database or ACADEMY_DB
    ensure_schema(path)
    now = time.time()
    with _LOCK, closing(_connect(path)) as db:
        if db.execute("SELECT id FROM academy_students WHERE id=?", (student_id,)).fetchone() is None:
            raise KeyError("student")
        if db.execute("SELECT id FROM academy_classes WHERE id=? AND active=1", (class_id,)).fetchone() is None:
            raise KeyError("class")
        db.execute(
            "UPDATE academy_enrollments SET active=0,ended_at=? WHERE student_id=? AND active=1",
            (now, student_id),
        )
        enrollment_id = uuid.uuid4().hex
        db.execute(
            "INSERT INTO academy_enrollments(id,student_id,class_id,active,enrolled_at) VALUES(?,?,?,1,?)",
            (enrollment_id, student_id, class_id, now),
        )
        db.commit()
    return {"assigned": True, "studentId": student_id, "classId": class_id}


def create_student(
    username: str,
    display_name: str,
    password: str,
    class_id: str | None = None,
    database: Path | None = None,
) -> dict:
    path = database or ACADEMY_DB
    ensure_schema(path)
    username = _normalize_username(username)
    password_hash = _hash_password(password)
    now = time.time()
    student_id = uuid.uuid4().hex
    try:
        with _LOCK, closing(_connect(path)) as db:
            db.execute(
                "INSERT INTO academy_students(id,username,display_name,password_hash,enabled,current_step,placement_status,xp,puzzle_rating,created,updated) "
                "VALUES(?,?,?,?,1,NULL,'pending',0,800,?,?)",
                (student_id, username, display_name.strip(), password_hash, now, now),
            )
            db.commit()
    except sqlite3.IntegrityError as exc:
        raise ValueError("Tên đăng nhập đệ tử đã tồn tại.") from exc
    if class_id:
        assign_student_class(student_id, class_id, path)
    with closing(_connect(path)) as db:
        row = db.execute("SELECT * FROM academy_students WHERE id=?", (student_id,)).fetchone()
    return _student_payload(row)


def _active_enrollment(student_id: str, database: Path | None = None) -> dict | None:
    path = database or ACADEMY_DB
    with closing(_connect(path)) as db:
        row = db.execute(
            """
            SELECT e.id enrollment_id,e.enrolled_at,c.*,t.display_name teacher_name,t.bio teacher_bio,t.ai_profile_id teacher_ai_profile_id
            FROM academy_enrollments e
            JOIN academy_classes c ON c.id=e.class_id
            JOIN academy_teachers t ON t.id=c.teacher_id
            WHERE e.student_id=? AND e.active=1
            ORDER BY e.enrolled_at DESC LIMIT 1
            """,
            (student_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "enrollmentId": row["enrollment_id"],
        "enrolledAt": row["enrolled_at"],
        "class": {
            "id": row["id"],
            "name": row["name"],
            "stepMin": row["step_min"],
            "stepMax": row["step_max"],
        },
        "teacher": {
            "id": row["teacher_id"],
            "displayName": row["teacher_name"],
            "bio": row["teacher_bio"],
            "aiProfileId": row["teacher_ai_profile_id"],
        },
    }


def _latest_attempt(student_id: str, database: Path | None = None) -> dict | None:
    path = database or ACADEMY_DB
    with closing(_connect(path)) as db:
        row = db.execute(
            "SELECT * FROM academy_placement_attempts WHERE student_id=? ORDER BY started DESC LIMIT 1",
            (student_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "status": row["status"],
        "startedAt": row["started"],
        "completedAt": row["completed"],
        "score": row["score"],
        "recommendedStep": row["recommended_step"],
        "skillScores": json.loads(row["skill_scores_json"] or "{}"),
        "stepScores": json.loads(row["step_scores_json"] or "{}"),
    }


def _extract_bearer(authorization: str | None) -> str:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:].strip()
    return ""


def _authenticate_student_token(token: str, database: Path | None = None) -> dict:
    if not token:
        raise PermissionError("Thiếu phiên đăng nhập đệ tử.")
    path = database or ACADEMY_DB
    ensure_schema(path)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    with _LOCK, closing(_connect(path)) as db:
        row = db.execute(
            """
            SELECT s.* FROM academy_student_sessions ss
            JOIN academy_students s ON s.id=ss.student_id
            WHERE ss.token_hash=? AND ss.expires>?
            """,
            (token_hash, now),
        ).fetchone()
        if row is None:
            db.execute("DELETE FROM academy_student_sessions WHERE token_hash=? OR expires<=?", (token_hash, now))
            db.commit()
            raise PermissionError("Phiên đệ tử không hợp lệ hoặc đã hết hạn.")
        if not bool(row["enabled"]):
            db.execute("DELETE FROM academy_student_sessions WHERE token_hash=?", (token_hash,))
            db.commit()
            raise PermissionError("Tài khoản đệ tử đã bị khóa.")
    return _student_payload(row)


def require_student(authorization: str | None = Header(default=None)) -> dict:
    try:
        return _authenticate_student_token(_extract_bearer(authorization))
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _login_student(username: str, password: str, database: Path | None = None) -> tuple[str, float, dict]:
    path = database or ACADEMY_DB
    ensure_schema(path)
    try:
        username = _normalize_username(username)
    except ValueError as exc:
        raise PermissionError("Sai tên đăng nhập hoặc mật khẩu.") from exc
    with closing(_connect(path)) as db:
        row = db.execute("SELECT * FROM academy_students WHERE username=? COLLATE NOCASE", (username,)).fetchone()
    if row is None or not bool(row["enabled"]) or not _verify_password(password, str(row["password_hash"])):
        raise PermissionError("Sai tên đăng nhập hoặc mật khẩu.")
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = time.time()
    expires = now + _session_hours() * 3600
    with _LOCK, closing(_connect(path)) as db:
        db.execute("DELETE FROM academy_student_sessions WHERE expires<=?", (now,))
        db.execute(
            "INSERT INTO academy_student_sessions(token_hash,student_id,created,expires) VALUES(?,?,?,?)",
            (token_hash, row["id"], now, expires),
        )
        db.execute("UPDATE academy_students SET last_login=?,updated=? WHERE id=?", (now, now, row["id"]))
        db.commit()
    student = dict(_student_payload(row))
    student["lastLoginAt"] = now
    return token, expires, student


def _dashboard(student_id: str, database: Path | None = None) -> dict:
    path = database or ACADEMY_DB
    ensure_schema(path)
    with closing(_connect(path)) as db:
        row = db.execute("SELECT * FROM academy_students WHERE id=?", (student_id,)).fetchone()
        if row is None:
            raise KeyError(student_id)
        active_questions = int(db.execute("SELECT COUNT(*) FROM academy_placement_questions WHERE active=1").fetchone()[0])
    student = _student_payload(row)
    latest = _latest_attempt(student_id, path)
    enrollment = _active_enrollment(student_id, path)
    if student["placementStatus"] != "completed":
        next_action = "placement"
    elif enrollment is None:
        next_action = "await-class"
    else:
        next_action = "academy-home"
    return {
        "student": student,
        "enrollment": enrollment,
        "placement": {
            "questionCount": active_questions,
            "latestAttempt": latest,
            "ready": active_questions > 0,
        },
        "nextAction": next_action,
    }


def _question_public(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "step": int(row["step"]),
        "skill": row["skill"],
        "prompt": row["prompt"],
        "options": json.loads(row["options_json"]),
    }


def _question_admin(row: sqlite3.Row) -> dict:
    payload = _question_public(row)
    payload.update(
        correctIndex=int(row["correct_index"]),
        explanation=row["explanation"],
        active=bool(row["active"]),
    )
    return payload


def _auto_assign(student_id: str, recommended_step: int, database: Path | None = None) -> dict | None:
    path = database or ACADEMY_DB
    if _active_enrollment(student_id, path) is not None:
        return _active_enrollment(student_id, path)
    with closing(_connect(path)) as db:
        row = db.execute(
            """
            SELECT c.id,COUNT(e.id) students
            FROM academy_classes c
            LEFT JOIN academy_enrollments e ON e.class_id=c.id AND e.active=1
            WHERE c.active=1 AND ? BETWEEN c.step_min AND c.step_max
            GROUP BY c.id
            ORDER BY students ASC,c.created ASC LIMIT 1
            """,
            (recommended_step,),
        ).fetchone()
    if row is None:
        return None
    assign_student_class(student_id, str(row["id"]), path)
    return _active_enrollment(student_id, path)


def _compute_placement(questions: list[sqlite3.Row], answers: dict[str, int]) -> tuple[float, int, dict, dict]:
    total = len(questions)
    correct_total = 0
    skills: dict[str, dict[str, int]] = {}
    steps: dict[int, dict[str, int]] = {}
    for question in questions:
        qid = str(question["id"])
        selected = answers.get(qid)
        correct = selected == int(question["correct_index"])
        if correct:
            correct_total += 1
        skill = str(question["skill"])
        step = int(question["step"])
        skill_bucket = skills.setdefault(skill, {"correct": 0, "total": 0})
        step_bucket = steps.setdefault(step, {"correct": 0, "total": 0})
        skill_bucket["total"] += 1
        step_bucket["total"] += 1
        if correct:
            skill_bucket["correct"] += 1
            step_bucket["correct"] += 1

    skill_scores = {
        skill: {
            **values,
            "percent": round(values["correct"] / values["total"] * 100, 1) if values["total"] else 0.0,
        }
        for skill, values in skills.items()
    }
    step_scores = {
        str(step): {
            **values,
            "percent": round(values["correct"] / values["total"] * 100, 1) if values["total"] else 0.0,
        }
        for step, values in sorted(steps.items())
    }
    available_steps = sorted(steps)
    recommended = available_steps[0]
    for step in available_steps:
        bucket = steps[step]
        percent = bucket["correct"] / bucket["total"] * 100 if bucket["total"] else 0
        if percent >= 70:
            recommended = step
        else:
            break
    score = round(correct_total / total * 100, 1) if total else 0.0
    return score, recommended, skill_scores, step_scores


@public_router.post("/auth/login")
def student_login(payload: StudentLoginRequest):
    try:
        token, expires, student = _login_student(payload.username, payload.password)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"token": token, "expiresAt": expires, "student": student}


@public_router.post("/auth/logout")
def student_logout(authorization: str | None = Header(default=None)):
    token = _extract_bearer(authorization)
    if token:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with _LOCK, closing(_connect()) as db:
            db.execute("DELETE FROM academy_student_sessions WHERE token_hash=?", (token_hash,))
            db.commit()
    return {"ok": True}


@public_router.get("/me")
def student_me(student: dict = Depends(require_student)):
    return student


@public_router.get("/dashboard")
def student_dashboard(student: dict = Depends(require_student)):
    return _dashboard(student["id"])


@public_router.post("/placement/start")
def placement_start(student: dict = Depends(require_student)):
    path = ACADEMY_DB
    ensure_schema(path)
    with _LOCK, closing(_connect(path)) as db:
        active = db.execute(
            "SELECT * FROM academy_placement_attempts WHERE student_id=? AND status='in_progress' ORDER BY started DESC LIMIT 1",
            (student["id"],),
        ).fetchone()
        if active is not None:
            ids = json.loads(active["question_ids_json"])
            placeholders = ",".join("?" for _ in ids)
            rows = db.execute(
                f"SELECT * FROM academy_placement_questions WHERE id IN ({placeholders}) ORDER BY step,skill,id",
                ids,
            ).fetchall() if ids else []
            return {"attemptId": active["id"], "questions": [_question_public(row) for row in rows]}
        rows = db.execute(
            "SELECT * FROM academy_placement_questions WHERE active=1 ORDER BY step,skill,created LIMIT 40"
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=409, detail="Khảo thí chưa có ngân hàng câu hỏi Step by Step. Giáo viên cần cấu hình trước.")
        attempt_id = uuid.uuid4().hex
        ids = [str(row["id"]) for row in rows]
        db.execute(
            "INSERT INTO academy_placement_attempts(id,student_id,status,question_ids_json,started) VALUES(?,?,'in_progress',?,?)",
            (attempt_id, student["id"], json.dumps(ids), time.time()),
        )
        db.execute("UPDATE academy_students SET placement_status='in_progress',updated=? WHERE id=?", (time.time(), student["id"]))
        db.commit()
    return {"attemptId": attempt_id, "questions": [_question_public(row) for row in rows]}


@public_router.post("/placement/submit")
def placement_submit(payload: PlacementSubmitRequest, student: dict = Depends(require_student)):
    path = ACADEMY_DB
    ensure_schema(path)
    with _LOCK, closing(_connect(path)) as db:
        attempt = db.execute(
            "SELECT * FROM academy_placement_attempts WHERE id=? AND student_id=?",
            (payload.attemptId, student["id"]),
        ).fetchone()
        if attempt is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy lượt khảo thí.")
        if attempt["status"] == "completed":
            raise HTTPException(status_code=409, detail="Lượt khảo thí này đã hoàn tất.")
        ids = json.loads(attempt["question_ids_json"])
        missing = [qid for qid in ids if qid not in payload.answers]
        if missing:
            raise HTTPException(status_code=400, detail=f"Bạn còn {len(missing)} câu chưa trả lời.")
        placeholders = ",".join("?" for _ in ids)
        rows = db.execute(
            f"SELECT * FROM academy_placement_questions WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        if len(rows) != len(ids):
            raise HTTPException(status_code=409, detail="Ngân hàng khảo thí đã thay đổi. Hãy bắt đầu một lượt mới.")
        for qid, answer in payload.answers.items():
            if qid in ids and (not isinstance(answer, int) or answer < 0):
                raise HTTPException(status_code=400, detail="Đáp án không hợp lệ.")
        score, recommended, skill_scores, step_scores = _compute_placement(rows, payload.answers)
        now = time.time()
        db.execute(
            "UPDATE academy_placement_attempts SET status='completed',answers_json=?,skill_scores_json=?,step_scores_json=?,score=?,recommended_step=?,completed=? WHERE id=?",
            (
                json.dumps(payload.answers, ensure_ascii=False),
                json.dumps(skill_scores, ensure_ascii=False),
                json.dumps(step_scores, ensure_ascii=False),
                score,
                recommended,
                now,
                payload.attemptId,
            ),
        )
        db.execute(
            "UPDATE academy_students SET current_step=?,placement_status='completed',updated=? WHERE id=?",
            (recommended, now, student["id"]),
        )
        db.commit()
    enrollment = _auto_assign(student["id"], recommended, path)
    return {
        "completed": True,
        "score": score,
        "recommendedStep": recommended,
        "skillScores": skill_scores,
        "stepScores": step_scores,
        "enrollment": enrollment,
    }


@admin_router.get("/overview")
def admin_academy_overview(principal: AdminPrincipal = Depends(require_permission("admin.read"))):
    del principal
    ensure_schema()
    with closing(_connect()) as db:
        students = int(db.execute("SELECT COUNT(*) FROM academy_students").fetchone()[0])
        active_students = int(db.execute("SELECT COUNT(*) FROM academy_students WHERE enabled=1").fetchone()[0])
        teachers = int(db.execute("SELECT COUNT(*) FROM academy_teachers WHERE active=1").fetchone()[0])
        classes = int(db.execute("SELECT COUNT(*) FROM academy_classes WHERE active=1").fetchone()[0])
        pending = int(db.execute("SELECT COUNT(*) FROM academy_students WHERE placement_status!='completed'").fetchone()[0])
        questions = int(db.execute("SELECT COUNT(*) FROM academy_placement_questions WHERE active=1").fetchone()[0])
    return {
        "students": students,
        "activeStudents": active_students,
        "teachers": teachers,
        "classes": classes,
        "pendingPlacement": pending,
        "placementQuestions": questions,
    }


@admin_router.get("/teachers")
def admin_list_teachers():
    ensure_schema()
    with closing(_connect()) as db:
        rows = db.execute("SELECT * FROM academy_teachers ORDER BY active DESC,display_name").fetchall()
    return {"teachers": [_teacher_payload(row) for row in rows]}


@admin_router.post("/teachers")
def admin_create_teacher(payload: CreateTeacherRequest):
    return create_teacher(payload.displayName, payload.bio, payload.aiProfileId)


@admin_router.patch("/teachers/{teacher_id}")
def admin_update_teacher(teacher_id: str, payload: UpdateTeacherRequest):
    updates: list[str] = []
    values: list[Any] = []
    for column, value in (
        ("display_name", payload.displayName),
        ("bio", payload.bio),
        ("ai_profile_id", payload.aiProfileId),
    ):
        if value is not None:
            updates.append(f"{column}=?")
            values.append(value.strip() if isinstance(value, str) else value)
    if payload.active is not None:
        updates.append("active=?")
        values.append(1 if payload.active else 0)
    if not updates:
        raise HTTPException(status_code=400, detail="Không có thay đổi.")
    updates.append("updated=?")
    values.extend([time.time(), teacher_id])
    with _LOCK, closing(_connect()) as db:
        if db.execute(f"UPDATE academy_teachers SET {','.join(updates)} WHERE id=?", values).rowcount == 0:
            raise HTTPException(status_code=404, detail="Không tìm thấy giáo viên.")
        db.commit()
        row = db.execute("SELECT * FROM academy_teachers WHERE id=?", (teacher_id,)).fetchone()
    return _teacher_payload(row)


@admin_router.get("/classes")
def admin_list_classes():
    ensure_schema()
    with closing(_connect()) as db:
        rows = db.execute(
            """
            SELECT c.*,t.display_name teacher_name,COUNT(e.id) student_count
            FROM academy_classes c
            JOIN academy_teachers t ON t.id=c.teacher_id
            LEFT JOIN academy_enrollments e ON e.class_id=c.id AND e.active=1
            GROUP BY c.id ORDER BY c.active DESC,c.step_min,c.name
            """
        ).fetchall()
    return {"classes": [_class_payload(row) for row in rows]}


@admin_router.post("/classes")
def admin_create_class(payload: CreateClassRequest):
    try:
        return create_class(payload.name, payload.stepMin, payload.stepMax, payload.teacherId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy giáo viên đang hoạt động.") from exc


@admin_router.patch("/classes/{class_id}")
def admin_update_class(class_id: str, payload: UpdateClassRequest):
    ensure_schema()
    with _LOCK, closing(_connect()) as db:
        current = db.execute("SELECT * FROM academy_classes WHERE id=?", (class_id,)).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy lớp.")
        step_min = payload.stepMin if payload.stepMin is not None else int(current["step_min"])
        step_max = payload.stepMax if payload.stepMax is not None else int(current["step_max"])
        if step_min > step_max:
            raise HTTPException(status_code=400, detail="Step tối thiểu không được lớn hơn Step tối đa.")
        teacher_id = payload.teacherId or str(current["teacher_id"])
        if db.execute("SELECT id FROM academy_teachers WHERE id=?", (teacher_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy giáo viên.")
        db.execute(
            "UPDATE academy_classes SET name=?,step_min=?,step_max=?,teacher_id=?,active=?,updated=? WHERE id=?",
            (
                payload.name.strip() if payload.name is not None else current["name"],
                step_min,
                step_max,
                teacher_id,
                1 if (payload.active if payload.active is not None else bool(current["active"])) else 0,
                time.time(),
                class_id,
            ),
        )
        db.commit()
    return {"updated": True, "classId": class_id}


@admin_router.get("/students")
def admin_list_students():
    ensure_schema()
    with closing(_connect()) as db:
        rows = db.execute("SELECT * FROM academy_students ORDER BY enabled DESC,created DESC").fetchall()
    students = []
    for row in rows:
        item = _student_payload(row)
        item["enrollment"] = _active_enrollment(item["id"])
        students.append(item)
    return {"students": students}


@admin_router.post("/students")
def admin_create_student(payload: CreateStudentRequest):
    try:
        student = create_student(payload.username, payload.displayName, payload.password, payload.classId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Lớp được chọn không tồn tại.") from exc
    student["enrollment"] = _active_enrollment(student["id"])
    return student


@admin_router.patch("/students/{student_id}")
def admin_update_student(student_id: str, payload: UpdateStudentRequest):
    ensure_schema()
    updates: list[str] = []
    values: list[Any] = []
    if payload.displayName is not None:
        updates.append("display_name=?")
        values.append(payload.displayName.strip())
    if payload.enabled is not None:
        updates.append("enabled=?")
        values.append(1 if payload.enabled else 0)
    if payload.currentStep is not None:
        updates.append("current_step=?")
        values.append(payload.currentStep)
    if not updates:
        raise HTTPException(status_code=400, detail="Không có thay đổi.")
    updates.append("updated=?")
    values.extend([time.time(), student_id])
    with _LOCK, closing(_connect()) as db:
        if db.execute(f"UPDATE academy_students SET {','.join(updates)} WHERE id=?", values).rowcount == 0:
            raise HTTPException(status_code=404, detail="Không tìm thấy đệ tử.")
        if payload.enabled is False:
            db.execute("DELETE FROM academy_student_sessions WHERE student_id=?", (student_id,))
        db.commit()
        row = db.execute("SELECT * FROM academy_students WHERE id=?", (student_id,)).fetchone()
    item = _student_payload(row)
    item["enrollment"] = _active_enrollment(student_id)
    return item


@admin_router.post("/students/{student_id}/assign")
def admin_assign_student(student_id: str, payload: AssignClassRequest):
    try:
        return assign_student_class(student_id, payload.classId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy đệ tử hoặc lớp.") from exc


@admin_router.get("/placement/questions")
def admin_list_placement_questions():
    ensure_schema()
    with closing(_connect()) as db:
        rows = db.execute("SELECT * FROM academy_placement_questions ORDER BY step,skill,created").fetchall()
    return {"questions": [_question_admin(row) for row in rows]}


@admin_router.post("/placement/questions")
def admin_create_placement_question(payload: PlacementQuestionRequest):
    if payload.correctIndex >= len(payload.options):
        raise HTTPException(status_code=400, detail="correctIndex vượt quá số đáp án.")
    ensure_schema()
    question_id = uuid.uuid4().hex
    now = time.time()
    with _LOCK, closing(_connect()) as db:
        db.execute(
            "INSERT INTO academy_placement_questions(id,step,skill,prompt,options_json,correct_index,explanation,active,created,updated) VALUES(?,?,?,?,?,?,?,1,?,?)",
            (
                question_id,
                payload.step,
                payload.skill.strip(),
                payload.prompt.strip(),
                json.dumps(payload.options, ensure_ascii=False),
                payload.correctIndex,
                payload.explanation.strip(),
                now,
                now,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM academy_placement_questions WHERE id=?", (question_id,)).fetchone()
    return _question_admin(row)


@admin_router.patch("/placement/questions/{question_id}")
def admin_update_placement_question(question_id: str, payload: UpdatePlacementQuestionRequest):
    ensure_schema()
    with _LOCK, closing(_connect()) as db:
        current = db.execute("SELECT * FROM academy_placement_questions WHERE id=?", (question_id,)).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy câu hỏi.")
        options = payload.options if payload.options is not None else json.loads(current["options_json"])
        correct_index = payload.correctIndex if payload.correctIndex is not None else int(current["correct_index"])
        if correct_index >= len(options):
            raise HTTPException(status_code=400, detail="correctIndex vượt quá số đáp án.")
        db.execute(
            """
            UPDATE academy_placement_questions
            SET step=?,skill=?,prompt=?,options_json=?,correct_index=?,explanation=?,active=?,updated=?
            WHERE id=?
            """,
            (
                payload.step if payload.step is not None else current["step"],
                payload.skill.strip() if payload.skill is not None else current["skill"],
                payload.prompt.strip() if payload.prompt is not None else current["prompt"],
                json.dumps(options, ensure_ascii=False),
                correct_index,
                payload.explanation.strip() if payload.explanation is not None else current["explanation"],
                1 if (payload.active if payload.active is not None else bool(current["active"])) else 0,
                time.time(),
                question_id,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM academy_placement_questions WHERE id=?", (question_id,)).fetchone()
    return _question_admin(row)
