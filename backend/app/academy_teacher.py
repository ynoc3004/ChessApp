from __future__ import annotations

import random
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .academy import ACADEMY_DB, _connect, ensure_schema, require_student
from .academy_training import (
    PUZZLES_DB,
    TrainingResultRequest,
    _load_puzzles,
    _sample_puzzle_ids,
    ensure_training_schema,
    record_training_result,
    theme_label,
    training_profile,
)
from .admin_auth import require_permission

admin_router = APIRouter(
    prefix="/academy/teacher",
    dependencies=[Depends(require_permission("admin.write"))],
)
public_router = APIRouter(prefix="/api/academy/assignments")


class CreateAssignmentRequest(BaseModel):
    teacherId: str = Field(min_length=1, max_length=100)
    targetType: Literal["class", "student"]
    targetId: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    theme: str | None = Field(default=None, max_length=80)
    ratingMin: int = Field(default=800, ge=400, le=3000)
    ratingMax: int = Field(default=1600, ge=400, le=3000)
    puzzleCount: int = Field(default=10, ge=1, le=50)
    dueAt: float | None = None


class UpdateAssignmentRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    dueAt: float | None = None
    active: bool | None = None


class AssignmentResultRequest(BaseModel):
    eventId: str = Field(min_length=8, max_length=100)
    puzzleId: str = Field(min_length=1, max_length=100)
    mistakes: int = Field(default=0, ge=0, le=100)
    hinted: bool = False
    elapsedMs: int = Field(default=0, ge=0, le=7_200_000)


def ensure_teacher_schema(database: Path | None = None) -> None:
    path = database or ACADEMY_DB
    ensure_training_schema(path)
    with closing(_connect(path)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS academy_assignments (
                id TEXT PRIMARY KEY,
                teacher_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                theme TEXT NOT NULL DEFAULT '',
                rating_min INTEGER NOT NULL,
                rating_max INTEGER NOT NULL,
                puzzle_count INTEGER NOT NULL,
                due_at REAL,
                active INTEGER NOT NULL DEFAULT 1,
                created REAL NOT NULL,
                updated REAL NOT NULL,
                FOREIGN KEY(teacher_id) REFERENCES academy_teachers(id)
            );
            CREATE TABLE IF NOT EXISTS academy_assignment_targets (
                assignment_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                assigned_at REAL NOT NULL,
                started_at REAL,
                completed_at REAL,
                attempts INTEGER NOT NULL DEFAULT 0,
                clean_attempts INTEGER NOT NULL DEFAULT 0,
                last_activity REAL,
                PRIMARY KEY(assignment_id, student_id),
                FOREIGN KEY(assignment_id) REFERENCES academy_assignments(id) ON DELETE CASCADE,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_assignment_events (
                event_id TEXT PRIMARY KEY,
                assignment_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                puzzle_id TEXT NOT NULL,
                clean INTEGER NOT NULL,
                created REAL NOT NULL,
                FOREIGN KEY(assignment_id) REFERENCES academy_assignments(id) ON DELETE CASCADE,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE,
                UNIQUE(assignment_id, student_id, puzzle_id)
            );
            CREATE INDEX IF NOT EXISTS idx_academy_assignments_teacher
                ON academy_assignments(teacher_id, active, created DESC);
            CREATE INDEX IF NOT EXISTS idx_academy_assignment_targets_student
                ON academy_assignment_targets(student_id, completed_at);
            CREATE INDEX IF NOT EXISTS idx_academy_assignment_events_target
                ON academy_assignment_events(assignment_id, student_id, created);
            """
        )
        db.commit()


def _teacher_row(teacher_id: str, database: Path) -> sqlite3.Row | None:
    with closing(_connect(database)) as db:
        return db.execute(
            "SELECT * FROM academy_teachers WHERE id=? AND active=1", (teacher_id,)
        ).fetchone()


def _assignment_status(row: sqlite3.Row, now: float) -> str:
    if row["completed_at"] is not None:
        return "completed"
    if row["started_at"] is not None:
        if row["due_at"] is not None and float(row["due_at"]) < now:
            return "overdue"
        return "in_progress"
    if row["due_at"] is not None and float(row["due_at"]) < now:
        return "overdue"
    return "pending"


def _assignment_payload(row: sqlite3.Row, now: float | None = None) -> dict[str, Any]:
    current_time = time.time() if now is None else now
    attempts = int(row["attempts"]) if "attempts" in row.keys() else 0
    clean_attempts = int(row["clean_attempts"]) if "clean_attempts" in row.keys() else 0
    count = int(row["puzzle_count"])
    payload: dict[str, Any] = {
        "id": str(row["id"]),
        "teacherId": str(row["teacher_id"]),
        "teacherName": row["teacher_name"] if "teacher_name" in row.keys() else None,
        "targetType": str(row["target_type"]),
        "targetId": str(row["target_id"]),
        "targetName": row["target_name"] if "target_name" in row.keys() else None,
        "title": str(row["title"]),
        "description": str(row["description"] or ""),
        "theme": str(row["theme"] or "") or None,
        "themeLabel": theme_label(str(row["theme"] or "")),
        "ratingMin": int(row["rating_min"]),
        "ratingMax": int(row["rating_max"]),
        "puzzleCount": count,
        "dueAt": float(row["due_at"]) if row["due_at"] is not None else None,
        "active": bool(row["active"]),
        "createdAt": float(row["created"]),
        "attempts": attempts,
        "cleanAttempts": clean_attempts,
        "remaining": max(0, count - attempts),
        "progressPercent": round(min(1.0, attempts / count) * 100, 1) if count else 100.0,
    }
    if "student_id" in row.keys():
        payload.update(
            studentId=row["student_id"],
            assignedAt=float(row["assigned_at"]) if row["assigned_at"] is not None else None,
            startedAt=float(row["started_at"]) if row["started_at"] is not None else None,
            completedAt=float(row["completed_at"]) if row["completed_at"] is not None else None,
            lastActivityAt=float(row["last_activity"]) if row["last_activity"] is not None else None,
            status=_assignment_status(row, current_time),
        )
    return payload


def _validate_teacher_target(
    teacher_id: str,
    target_type: str,
    target_id: str,
    database: Path,
) -> tuple[str, list[str]]:
    with closing(_connect(database)) as db:
        teacher = db.execute(
            "SELECT id FROM academy_teachers WHERE id=? AND active=1", (teacher_id,)
        ).fetchone()
        if teacher is None:
            raise LookupError("teacher")
        if target_type == "class":
            klass = db.execute(
                "SELECT id,name FROM academy_classes WHERE id=? AND teacher_id=? AND active=1",
                (target_id, teacher_id),
            ).fetchone()
            if klass is None:
                raise LookupError("class")
            rows = db.execute(
                """
                SELECT e.student_id FROM academy_enrollments e
                JOIN academy_students s ON s.id=e.student_id
                WHERE e.class_id=? AND e.active=1 AND s.enabled=1
                ORDER BY e.enrolled_at
                """,
                (target_id,),
            ).fetchall()
            students = [str(row["student_id"]) for row in rows]
            if not students:
                raise ValueError("Lớp chưa có đệ tử đang hoạt động để giao bài.")
            return str(klass["name"]), students

        student = db.execute(
            """
            SELECT s.id,s.display_name FROM academy_students s
            JOIN academy_enrollments e ON e.student_id=s.id AND e.active=1
            JOIN academy_classes c ON c.id=e.class_id AND c.active=1
            WHERE s.id=? AND s.enabled=1 AND c.teacher_id=?
            """,
            (target_id, teacher_id),
        ).fetchone()
        if student is None:
            raise LookupError("student")
        return str(student["display_name"]), [str(student["id"])]


def create_assignment(
    payload: CreateAssignmentRequest,
    database: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_teacher_schema(path)
    current_time = time.time() if now is None else now
    if payload.ratingMin > payload.ratingMax:
        raise ValueError("Rating tối thiểu không được lớn hơn rating tối đa.")
    if payload.dueAt is not None and payload.dueAt <= current_time:
        raise ValueError("Hạn bài tập phải nằm trong tương lai.")
    target_name, student_ids = _validate_teacher_target(
        payload.teacherId, payload.targetType, payload.targetId, path
    )
    assignment_id = uuid.uuid4().hex
    with closing(_connect(path)) as db:
        db.execute(
            """
            INSERT INTO academy_assignments(
                id,teacher_id,target_type,target_id,title,description,theme,
                rating_min,rating_max,puzzle_count,due_at,active,created,updated
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)
            """,
            (
                assignment_id,
                payload.teacherId,
                payload.targetType,
                payload.targetId,
                payload.title.strip(),
                payload.description.strip(),
                (payload.theme or "").strip(),
                payload.ratingMin,
                payload.ratingMax,
                payload.puzzleCount,
                payload.dueAt,
                current_time,
                current_time,
            ),
        )
        db.executemany(
            "INSERT INTO academy_assignment_targets(assignment_id,student_id,assigned_at) VALUES(?,?,?)",
            [(assignment_id, student_id, current_time) for student_id in student_ids],
        )
        db.commit()
        row = db.execute(
            """
            SELECT a.*,t.display_name teacher_name,? target_name,
                   COUNT(at.student_id) target_count,
                   SUM(CASE WHEN at.completed_at IS NOT NULL THEN 1 ELSE 0 END) completed_count
            FROM academy_assignments a
            JOIN academy_teachers t ON t.id=a.teacher_id
            LEFT JOIN academy_assignment_targets at ON at.assignment_id=a.id
            WHERE a.id=? GROUP BY a.id
            """,
            (target_name, assignment_id),
        ).fetchone()
    result = _assignment_payload(row, current_time)
    result.update(targetCount=len(student_ids), completedCount=0)
    return result


def _target_progress(
    assignment_id: str,
    student_id: str,
    database: Path,
    now: float | None = None,
) -> dict[str, Any]:
    current_time = time.time() if now is None else now
    with closing(_connect(database)) as db:
        row = db.execute(
            """
            SELECT a.*,at.student_id,at.assigned_at,at.started_at,at.completed_at,
                   at.attempts,at.clean_attempts,at.last_activity,
                   t.display_name teacher_name,
                   CASE WHEN a.target_type='class' THEN c.name ELSE s.display_name END target_name
            FROM academy_assignments a
            JOIN academy_assignment_targets at ON at.assignment_id=a.id
            JOIN academy_teachers t ON t.id=a.teacher_id
            LEFT JOIN academy_classes c ON a.target_type='class' AND c.id=a.target_id
            LEFT JOIN academy_students s ON a.target_type='student' AND s.id=a.target_id
            WHERE a.id=? AND at.student_id=?
            """,
            (assignment_id, student_id),
        ).fetchone()
    if row is None:
        raise LookupError("assignment")
    return _assignment_payload(row, current_time)


def student_assignments(
    student_id: str,
    database: Path | None = None,
    now: float | None = None,
) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_teacher_schema(path)
    current_time = time.time() if now is None else now
    with closing(_connect(path)) as db:
        rows = db.execute(
            """
            SELECT a.*,at.student_id,at.assigned_at,at.started_at,at.completed_at,
                   at.attempts,at.clean_attempts,at.last_activity,
                   t.display_name teacher_name,
                   CASE WHEN a.target_type='class' THEN c.name ELSE s.display_name END target_name
            FROM academy_assignment_targets at
            JOIN academy_assignments a ON a.id=at.assignment_id
            JOIN academy_teachers t ON t.id=a.teacher_id
            LEFT JOIN academy_classes c ON a.target_type='class' AND c.id=a.target_id
            LEFT JOIN academy_students s ON a.target_type='student' AND s.id=a.target_id
            WHERE at.student_id=? AND a.active=1
            ORDER BY CASE WHEN at.completed_at IS NULL THEN 0 ELSE 1 END,
                     COALESCE(a.due_at, 99999999999),a.created DESC
            """,
            (student_id,),
        ).fetchall()
    return [_assignment_payload(row, current_time) for row in rows]


def assignment_session(
    assignment_id: str,
    student_id: str,
    database: Path | None = None,
    puzzles_db: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    puzzle_path = puzzles_db or PUZZLES_DB
    current_time = time.time() if now is None else now
    ensure_teacher_schema(path)
    progress = _target_progress(assignment_id, student_id, path, current_time)
    if not progress["active"]:
        raise ValueError("Bài tập này đã được giáo viên đóng.")
    remaining = int(progress["remaining"])
    if remaining <= 0:
        return {"assignment": progress, "puzzles": [], "completed": True}
    if not puzzle_path.exists():
        raise FileNotFoundError("Chưa nhập database puzzle Lichess.")

    with closing(_connect(path)) as db:
        rows = db.execute(
            "SELECT puzzle_id FROM academy_assignment_events WHERE assignment_id=? AND student_id=?",
            (assignment_id, student_id),
        ).fetchall()
        completed_ids = {str(row["puzzle_id"]) for row in rows}
        db.execute(
            "UPDATE academy_assignment_targets SET started_at=COALESCE(started_at,?) WHERE assignment_id=? AND student_id=?",
            (current_time, assignment_id, student_id),
        )
        db.commit()

    limit = min(10, remaining)
    with closing(sqlite3.connect(puzzle_path)) as pdb:
        pdb.row_factory = sqlite3.Row
        ids = _sample_puzzle_ids(
            pdb,
            int(progress["ratingMin"]),
            int(progress["ratingMax"]),
            limit,
            theme=progress.get("theme"),
            exclude=completed_ids,
        )
    if not ids:
        raise ValueError("Không còn puzzle phù hợp với tiêu chí bài tập. Giáo viên cần nới theme/rating.")
    puzzles = _load_puzzles(
        ids,
        puzzle_path,
        mode="assignment",
        preferred_skill=progress["themeLabel"],
        preferred_theme=progress.get("theme"),
    )
    for puzzle in puzzles:
        puzzle["academyAssignmentId"] = assignment_id
        puzzle["academyAssignmentTitle"] = progress["title"]
    random.shuffle(puzzles)
    return {"assignment": progress, "puzzles": puzzles, "completed": False}


def record_assignment_event(
    assignment_id: str,
    student_id: str,
    event_id: str,
    puzzle_id: str,
    clean: bool,
    database: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_teacher_schema(path)
    current_time = time.time() if now is None else now
    progress = _target_progress(assignment_id, student_id, path, current_time)
    if not progress["active"]:
        raise ValueError("Bài tập này đã được giáo viên đóng.")

    with closing(_connect(path)) as db:
        existing = db.execute(
            "SELECT event_id FROM academy_assignment_events WHERE event_id=? AND student_id=?",
            (event_id, student_id),
        ).fetchone()
        if existing is None:
            try:
                db.execute(
                    "INSERT INTO academy_assignment_events(event_id,assignment_id,student_id,puzzle_id,clean,created) VALUES(?,?,?,?,?,?)",
                    (event_id, assignment_id, student_id, puzzle_id, 1 if clean else 0, current_time),
                )
            except sqlite3.IntegrityError:
                # Same puzzle was already credited for this assignment. Training
                # progress can still be recorded, but assignment completion must
                # never be farmed by replaying one position.
                db.rollback()
            else:
                counts = db.execute(
                    "SELECT COUNT(*) attempts,SUM(clean) clean_attempts FROM academy_assignment_events WHERE assignment_id=? AND student_id=?",
                    (assignment_id, student_id),
                ).fetchone()
                attempts = int(counts["attempts"] or 0)
                clean_attempts = int(counts["clean_attempts"] or 0)
                required = int(progress["puzzleCount"])
                completed_at = current_time if attempts >= required else None
                db.execute(
                    """
                    UPDATE academy_assignment_targets
                    SET started_at=COALESCE(started_at,?),attempts=?,clean_attempts=?,last_activity=?,
                        completed_at=COALESCE(completed_at,?)
                    WHERE assignment_id=? AND student_id=?
                    """,
                    (
                        current_time, attempts, clean_attempts, current_time, completed_at,
                        assignment_id, student_id,
                    ),
                )
                db.commit()
    return _target_progress(assignment_id, student_id, path, current_time)


def _teacher_assignment_summaries(teacher_id: str, database: Path, now: float) -> list[dict[str, Any]]:
    with closing(_connect(database)) as db:
        rows = db.execute(
            """
            SELECT a.*,t.display_name teacher_name,
                   CASE WHEN a.target_type='class' THEN c.name ELSE s.display_name END target_name,
                   COUNT(at.student_id) target_count,
                   SUM(CASE WHEN at.completed_at IS NOT NULL THEN 1 ELSE 0 END) completed_count,
                   SUM(at.attempts) attempts,
                   SUM(at.clean_attempts) clean_attempts
            FROM academy_assignments a
            JOIN academy_teachers t ON t.id=a.teacher_id
            LEFT JOIN academy_classes c ON a.target_type='class' AND c.id=a.target_id
            LEFT JOIN academy_students s ON a.target_type='student' AND s.id=a.target_id
            LEFT JOIN academy_assignment_targets at ON at.assignment_id=a.id
            WHERE a.teacher_id=?
            GROUP BY a.id ORDER BY a.active DESC,a.created DESC
            """,
            (teacher_id,),
        ).fetchall()
    result = []
    for row in rows:
        item = _assignment_payload(row, now)
        target_count = int(row["target_count"] or 0)
        completed_count = int(row["completed_count"] or 0)
        item.update(
            targetCount=target_count,
            completedCount=completed_count,
            completionPercent=round(completed_count / target_count * 100, 1) if target_count else 0.0,
            totalAttempts=int(row["attempts"] or 0),
            totalClean=int(row["clean_attempts"] or 0),
        )
        result.append(item)
    return result


def teacher_dashboard(
    teacher_id: str,
    database: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_teacher_schema(path)
    current_time = time.time() if now is None else now
    teacher = _teacher_row(teacher_id, path)
    if teacher is None:
        raise LookupError("teacher")

    with closing(_connect(path)) as db:
        class_rows = db.execute(
            """
            SELECT c.*,COUNT(e.student_id) student_count
            FROM academy_classes c
            LEFT JOIN academy_enrollments e ON e.class_id=c.id AND e.active=1
            WHERE c.teacher_id=? AND c.active=1
            GROUP BY c.id ORDER BY c.step_min,c.name
            """,
            (teacher_id,),
        ).fetchall()
        student_rows = db.execute(
            """
            SELECT DISTINCT s.*,c.id class_id,c.name class_name,c.step_min,c.step_max
            FROM academy_students s
            JOIN academy_enrollments e ON e.student_id=s.id AND e.active=1
            JOIN academy_classes c ON c.id=e.class_id AND c.active=1
            WHERE c.teacher_id=? AND s.enabled=1
            ORDER BY c.step_min,c.name,s.display_name
            """,
            (teacher_id,),
        ).fetchall()

    students: list[dict[str, Any]] = []
    attention = 0
    for row in student_rows:
        profile = training_profile(str(row["id"]), path, current_time)
        weakest = profile["weakestSkills"][0] if profile["weakestSkills"] else None
        reasons: list[str] = []
        if row["placement_status"] != "completed":
            reasons.append("Chưa hoàn thành khảo thí")
        if profile["stats"]["last7Days"] == 0:
            reasons.append("7 ngày chưa luyện Bí Cảnh")
        if profile["review"]["due"] >= 3:
            reasons.append(f"{profile['review']['due']} bài ôn đang đến hạn")
        clean_rate = profile["stats"].get("cleanRate")
        if profile["stats"]["attempts"] >= 5 and clean_rate is not None and clean_rate < 60:
            reasons.append(f"Clean rate {clean_rate:.0f}%")
        if weakest and float(weakest.get("mastery") or 100) < 45:
            reasons.append(f"{weakest['skill']} còn {float(weakest['mastery']):.0f}%")
        needs_attention = bool(reasons)
        if needs_attention:
            attention += 1
        students.append(
            {
                "id": row["id"],
                "displayName": row["display_name"],
                "username": row["username"],
                "currentStep": row["current_step"],
                "placementStatus": row["placement_status"],
                "xp": int(row["xp"]),
                "puzzleRating": int(row["puzzle_rating"]),
                "class": {
                    "id": row["class_id"],
                    "name": row["class_name"],
                    "stepMin": int(row["step_min"]),
                    "stepMax": int(row["step_max"]),
                },
                "training": profile["stats"],
                "review": profile["review"],
                "weakestSkill": weakest,
                "needsAttention": needs_attention,
                "attentionReasons": reasons,
            }
        )

    assignments = _teacher_assignment_summaries(teacher_id, path, current_time)
    active_assignments = sum(1 for item in assignments if item["active"])
    overdue_targets = 0
    with closing(_connect(path)) as db:
        overdue_targets = int(
            db.execute(
                """
                SELECT COUNT(*) FROM academy_assignment_targets at
                JOIN academy_assignments a ON a.id=at.assignment_id
                WHERE a.teacher_id=? AND a.active=1 AND a.due_at IS NOT NULL AND a.due_at<?
                  AND at.completed_at IS NULL
                """,
                (teacher_id, current_time),
            ).fetchone()[0]
        )

    classes = [
        {
            "id": row["id"],
            "name": row["name"],
            "stepMin": int(row["step_min"]),
            "stepMax": int(row["step_max"]),
            "studentCount": int(row["student_count"]),
        }
        for row in class_rows
    ]
    return {
        "teacher": {
            "id": teacher["id"],
            "displayName": teacher["display_name"],
            "bio": teacher["bio"],
            "aiProfileId": teacher["ai_profile_id"],
        },
        "classes": classes,
        "students": students,
        "assignments": assignments,
        "summary": {
            "classes": len(classes),
            "students": len(students),
            "needAttention": attention,
            "activeAssignments": active_assignments,
            "overdueTargets": overdue_targets,
            "last7DaysAttempts": sum(int(item["training"]["last7Days"]) for item in students),
        },
    }


@admin_router.get("/dashboard")
def admin_teacher_dashboard(teacherId: str = Query(min_length=1)):
    try:
        return teacher_dashboard(teacherId)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy giáo viên đang hoạt động.") from exc


@admin_router.get("/assignments")
def admin_teacher_assignments(teacherId: str = Query(min_length=1)):
    ensure_teacher_schema()
    if _teacher_row(teacherId, ACADEMY_DB) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy giáo viên đang hoạt động.")
    return {"assignments": _teacher_assignment_summaries(teacherId, ACADEMY_DB, time.time())}


@admin_router.post("/assignments")
def admin_create_assignment(payload: CreateAssignmentRequest):
    try:
        return create_assignment(payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Giáo viên/lớp/đệ tử không thuộc phạm vi phụ trách.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@admin_router.patch("/assignments/{assignment_id}")
def admin_update_assignment(assignment_id: str, payload: UpdateAssignmentRequest):
    ensure_teacher_schema()
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
    values.extend([time.time(), assignment_id])
    with closing(_connect()) as db:
        changed = db.execute(
            f"UPDATE academy_assignments SET {','.join(updates)} WHERE id=?", values
        ).rowcount
        db.commit()
    if not changed:
        raise HTTPException(status_code=404, detail="Không tìm thấy bài tập.")
    return {"updated": True, "assignmentId": assignment_id}


@public_router.get("")
def public_student_assignments(student: dict = Depends(require_student)):
    return {"assignments": student_assignments(student["id"])}


@public_router.get("/{assignment_id}")
def public_assignment_detail(assignment_id: str, student: dict = Depends(require_student)):
    try:
        return _target_progress(assignment_id, student["id"], ACADEMY_DB)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy bài tập của bạn.") from exc


@public_router.post("/{assignment_id}/session")
def public_assignment_session(assignment_id: str, student: dict = Depends(require_student)):
    try:
        return assignment_session(assignment_id, student["id"])
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy bài tập của bạn.") from exc
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@public_router.post("/{assignment_id}/result")
def public_assignment_result(
    assignment_id: str,
    payload: AssignmentResultRequest,
    student: dict = Depends(require_student),
):
    try:
        assignment = _target_progress(assignment_id, student["id"], ACADEMY_DB)
        result = record_training_result(
            student["id"],
            TrainingResultRequest(
                eventId=payload.eventId,
                puzzleId=payload.puzzleId,
                mode="manual",
                skill=assignment["themeLabel"],
                theme=assignment.get("theme"),
                mistakes=payload.mistakes,
                hinted=payload.hinted,
                elapsedMs=payload.elapsedMs,
            ),
        )
        clean = payload.mistakes == 0 and not payload.hinted
        progress = record_assignment_event(
            assignment_id,
            student["id"],
            payload.eventId,
            payload.puzzleId,
            clean,
        )
        return {"training": result, "assignment": progress}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy bài tập/puzzle.") from exc
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
