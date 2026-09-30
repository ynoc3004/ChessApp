from __future__ import annotations

import json
import math
import random
import sqlite3
import time
import unicodedata
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any, Literal

import chess
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .academy import ACADEMY_DB, _connect, ensure_schema, require_student

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PUZZLES_DB = DATA_DIR / "lichess-puzzles.sqlite3"
DAY = 86_400

router = APIRouter(prefix="/api/academy/training")

THEME_LABELS: dict[str, str] = {
    "fork": "Đòn đôi",
    "pin": "Ghim quân",
    "skewer": "Xiên quân",
    "mate": "Chiếu hết",
    "mateIn1": "Chiếu hết 1 nước",
    "mateIn2": "Chiếu hết 2 nước",
    "mateIn3": "Chiếu hết 3 nước",
    "discoveredAttack": "Tấn công mở",
    "defensiveMove": "Phòng thủ",
    "quietMove": "Nước đi yên lặng",
    "hangingPiece": "Quân treo",
    "endgame": "Tàn cuộc",
    "advancedPawn": "Tốt thông",
    "promotion": "Phong cấp",
    "backRankMate": "Chiếu hết hàng cuối",
    "doubleCheck": "Chiếu đôi",
    "sacrifice": "Hy sinh",
    "clearance": "Dọn đường",
    "interference": "Cản đường",
    "attraction": "Thu hút",
    "deflection": "Đánh lạc hướng",
    "capturingDefender": "Loại bỏ quân phòng thủ",
    "overloading": "Quá tải",
    "xRayAttack": "Xuyên tia",
}

# Normalized Vietnamese/English keywords -> Lichess theme. The placement bank is
# teacher-authored, so unknown skill names intentionally fall back to mixed puzzles.
_SKILL_THEME_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("don doi", "fork"), "fork"),
    (("ghim", "pin"), "pin"),
    (("xien", "skewer"), "skewer"),
    (("chieu het", "checkmate", "mate"), "mate"),
    (("tan cong mo", "discovered attack", "discovered"), "discoveredAttack"),
    (("phong thu", "defensive", "defense"), "defensiveMove"),
    (("nuoc di yen lang", "quiet move"), "quietMove"),
    (("quan treo", "hanging piece", "bat quan", "capture"), "hangingPiece"),
    (("tan cuoc", "endgame"), "endgame"),
    (("tot thong", "advanced pawn", "passed pawn"), "advancedPawn"),
    (("phong cap", "promotion"), "promotion"),
    (("hang cuoi", "back rank"), "backRankMate"),
    (("chieu doi", "double check"), "doubleCheck"),
    (("hy sinh", "sacrifice"), "sacrifice"),
    (("don duong", "clearance"), "clearance"),
    (("can duong", "interference"), "interference"),
    (("thu hut", "attraction"), "attraction"),
    (("danh lac huong", "deflection"), "deflection"),
    (("loai bo quan phong thu", "capturing defender"), "capturingDefender"),
    (("qua tai", "overloading"), "overloading"),
    (("xuyen tia", "x ray", "xray"), "xRayAttack"),
)


class TrainingSessionRequest(BaseModel):
    mode: Literal["personalized", "review"] = "personalized"
    limit: int = Field(default=10, ge=1, le=20)
    theme: str | None = Field(default=None, max_length=80)


class TrainingResultRequest(BaseModel):
    eventId: str = Field(min_length=8, max_length=100)
    puzzleId: str = Field(min_length=1, max_length=100)
    mode: Literal["personalized", "review", "manual"] = "personalized"
    skill: str | None = Field(default=None, max_length=80)
    theme: str | None = Field(default=None, max_length=80)
    mistakes: int = Field(default=0, ge=0, le=100)
    hinted: bool = False
    elapsedMs: int = Field(default=0, ge=0, le=7_200_000)


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.lower().strip())
    plain = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return " ".join("".join(char if char.isalnum() else " " for char in plain).split())


def skill_to_theme(skill: str) -> str | None:
    normalized = _normalize(skill)
    for keywords, theme in _SKILL_THEME_KEYWORDS:
        if any(keyword in normalized for keyword in keywords):
            return theme
    # Accept an exact Lichess theme supplied by a teacher without forcing it
    # through the Vietnamese alias table.
    for theme in THEME_LABELS:
        if _normalize(theme) == normalized:
            return theme
    return None


def theme_label(theme: str | None) -> str:
    if not theme:
        return "Tổng hợp"
    return THEME_LABELS.get(theme, theme)


def recommended_rating_range(step: int | None, puzzle_rating: int) -> tuple[int, int]:
    safe_step = max(1, min(20, int(step or 1)))
    # Step is curriculum level, not Elo. Blend it with the student's own
    # adaptive puzzle rating instead of pretending there is a direct conversion.
    step_center = 650 + (safe_step - 1) * 140
    center = round((max(400, puzzle_rating) * 2 + step_center) / 3)
    return max(400, center - 220), min(3000, center + 260)


def review_interval(repetitions: int, clean: bool) -> tuple[int, int]:
    if not clean:
        return 0, 1
    next_repetitions = max(0, repetitions) + 1
    schedule = (1, 3, 7, 14, 30, 60)
    interval = schedule[min(next_repetitions - 1, len(schedule) - 1)]
    return next_repetitions, interval


def _rating_change(student_rating: int, puzzle_rating: int, performance: float, k: int = 24) -> int:
    expected = 1.0 / (1.0 + math.pow(10.0, (puzzle_rating - student_rating) / 400.0))
    return max(-24, min(24, round(k * (performance - expected))))


def ensure_training_schema(database: Path | None = None) -> None:
    path = database or ACADEMY_DB
    ensure_schema(path)
    with closing(_connect(path)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS academy_puzzle_attempts (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL UNIQUE,
                student_id TEXT NOT NULL,
                puzzle_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                skill TEXT NOT NULL,
                theme TEXT NOT NULL,
                puzzle_rating INTEGER NOT NULL,
                mistakes INTEGER NOT NULL,
                hinted INTEGER NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                performance REAL NOT NULL,
                rating_before INTEGER NOT NULL,
                rating_after INTEGER NOT NULL,
                rating_delta INTEGER NOT NULL,
                xp_awarded INTEGER NOT NULL,
                created REAL NOT NULL,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_skill_progress (
                student_id TEXT NOT NULL,
                skill TEXT NOT NULL,
                theme TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                clean INTEGER NOT NULL DEFAULT 0,
                mastery REAL NOT NULL DEFAULT 50,
                updated REAL NOT NULL,
                PRIMARY KEY(student_id, skill),
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_review_items (
                student_id TEXT NOT NULL,
                puzzle_id TEXT NOT NULL,
                skill TEXT NOT NULL,
                theme TEXT NOT NULL,
                repetitions INTEGER NOT NULL DEFAULT 0,
                lapses INTEGER NOT NULL DEFAULT 0,
                interval_days INTEGER NOT NULL DEFAULT 1,
                next_review REAL NOT NULL,
                last_seen REAL NOT NULL,
                last_mistakes INTEGER NOT NULL DEFAULT 0,
                last_hinted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(student_id, puzzle_id),
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_academy_attempts_student_created
                ON academy_puzzle_attempts(student_id, created DESC);
            CREATE INDEX IF NOT EXISTS idx_academy_attempts_student_puzzle
                ON academy_puzzle_attempts(student_id, puzzle_id, created DESC);
            CREATE INDEX IF NOT EXISTS idx_academy_review_due
                ON academy_review_items(student_id, next_review);
            CREATE INDEX IF NOT EXISTS idx_academy_skill_mastery
                ON academy_skill_progress(student_id, mastery);
            """
        )
        db.commit()


def _placement_skill_scores(student_id: str, database: Path) -> dict[str, dict[str, Any]]:
    with closing(_connect(database)) as db:
        row = db.execute(
            "SELECT skill_scores_json FROM academy_placement_attempts "
            "WHERE student_id=? AND status='completed' ORDER BY completed DESC LIMIT 1",
            (student_id,),
        ).fetchone()
    if row is None:
        return {}
    try:
        payload = json.loads(row["skill_scores_json"] or "{}")
        return payload if isinstance(payload, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def training_profile(student_id: str, database: Path | None = None, now: float | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_training_schema(path)
    current_time = time.time() if now is None else now
    placement = _placement_skill_scores(student_id, path)
    with closing(_connect(path)) as db:
        student = db.execute(
            "SELECT id,display_name,current_step,placement_status,xp,puzzle_rating FROM academy_students WHERE id=?",
            (student_id,),
        ).fetchone()
        if student is None:
            raise KeyError(student_id)
        progress_rows = db.execute(
            "SELECT * FROM academy_skill_progress WHERE student_id=? ORDER BY mastery,skill",
            (student_id,),
        ).fetchall()
        total_attempts = int(db.execute(
            "SELECT COUNT(*) FROM academy_puzzle_attempts WHERE student_id=?", (student_id,)
        ).fetchone()[0])
        clean_attempts = int(db.execute(
            "SELECT COUNT(*) FROM academy_puzzle_attempts WHERE student_id=? AND mistakes=0 AND hinted=0", (student_id,)
        ).fetchone()[0])
        week_attempts = int(db.execute(
            "SELECT COUNT(*) FROM academy_puzzle_attempts WHERE student_id=? AND created>=?", (student_id, current_time - 7 * DAY)
        ).fetchone()[0])
        due_review = int(db.execute(
            "SELECT COUNT(*) FROM academy_review_items WHERE student_id=? AND next_review<=?", (student_id, current_time)
        ).fetchone()[0])
        mistake_book = int(db.execute(
            "SELECT COUNT(*) FROM academy_review_items WHERE student_id=?", (student_id,)
        ).fetchone()[0])

    by_normalized: dict[str, dict[str, Any]] = {}
    for skill, values in placement.items():
        if not isinstance(values, dict):
            continue
        percent = float(values.get("percent") or 0.0)
        theme = skill_to_theme(skill)
        by_normalized[_normalize(skill)] = {
            "skill": skill,
            "theme": theme,
            "themeLabel": theme_label(theme),
            "placementPercent": round(percent, 1),
            "mastery": round(percent, 1),
            "attempts": 0,
            "clean": 0,
            "cleanRate": None,
        }

    for row in progress_rows:
        key = _normalize(str(row["skill"]))
        item = by_normalized.get(key, {
            "skill": str(row["skill"]),
            "placementPercent": None,
        })
        attempts = int(row["attempts"])
        clean_count = int(row["clean"])
        theme = str(row["theme"] or "") or skill_to_theme(str(row["skill"]))
        item.update({
            "theme": theme or None,
            "themeLabel": theme_label(theme),
            "mastery": round(float(row["mastery"]), 1),
            "attempts": attempts,
            "clean": clean_count,
            "cleanRate": round(clean_count / attempts * 100, 1) if attempts else None,
        })
        by_normalized[key] = item

    skills = sorted(by_normalized.values(), key=lambda item: (float(item.get("mastery") or 0), item["skill"]))
    mapped_weaknesses = [item for item in skills if item.get("theme")]
    weakest = mapped_weaknesses[:4] if mapped_weaknesses else skills[:4]
    rating_min, rating_max = recommended_rating_range(student["current_step"], int(student["puzzle_rating"]))
    recommendation = weakest[0] if weakest else None
    return {
        "student": {
            "id": student["id"],
            "displayName": student["display_name"],
            "currentStep": student["current_step"],
            "placementStatus": student["placement_status"],
            "xp": int(student["xp"]),
            "puzzleRating": int(student["puzzle_rating"]),
        },
        "ratingRange": {"minimum": rating_min, "maximum": rating_max},
        "skills": skills,
        "weakestSkills": weakest,
        "recommendation": {
            "skill": recommendation["skill"] if recommendation else "Tổng hợp",
            "theme": recommendation.get("theme") if recommendation else None,
            "themeLabel": recommendation.get("themeLabel") if recommendation else "Tổng hợp",
            "reason": "Ưu tiên kỹ năng có mastery thấp nhất" if recommendation else "Chưa đủ dữ liệu kỹ năng; luyện tổng hợp",
        },
        "review": {"due": due_review, "total": mistake_book},
        "stats": {
            "attempts": total_attempts,
            "clean": clean_attempts,
            "cleanRate": round(clean_attempts / total_attempts * 100, 1) if total_attempts else None,
            "last7Days": week_attempts,
        },
    }


def _recent_puzzle_ids(student_id: str, database: Path, limit: int = 120) -> set[str]:
    with closing(_connect(database)) as db:
        rows = db.execute(
            "SELECT puzzle_id FROM academy_puzzle_attempts WHERE student_id=? ORDER BY created DESC LIMIT ?",
            (student_id, limit),
        ).fetchall()
    return {str(row["puzzle_id"]) for row in rows}


def _valid_puzzle(row: sqlite3.Row | None) -> bool:
    if row is None:
        return False
    try:
        board = chess.Board(row["fen"])
        moves = str(row["moves"]).split()
        if not board.is_valid() or len(moves) < 2:
            return False
        for move in moves:
            board.push_uci(move)
        return True
    except (ValueError, TypeError):
        return False


def _sample_puzzle_ids(
    db: sqlite3.Connection,
    minimum: int,
    maximum: int,
    limit: int,
    *,
    theme: str | None = None,
    exclude: set[str] | None = None,
) -> list[str]:
    blocked = exclude or set()
    table = "themes" if theme else "puzzles"
    where = "theme=? AND rating BETWEEN ? AND ?" if theme else "rating BETWEEN ? AND ?"
    params: tuple[Any, ...] = (theme, minimum, maximum) if theme else (minimum, maximum)
    total = int(db.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params).fetchone()[0])
    if total <= 0 or limit <= 0:
        return []

    # Stratified offsets avoid ORDER BY RANDOM() on the 6M+ row Lichess database.
    attempts = min(total, max(limit * 5, limit))
    offsets: list[int] = []
    if attempts == 1:
        offsets = [random.randrange(total)]
    else:
        for index in range(attempts):
            start = index * total // attempts
            stop = max(start + 1, (index + 1) * total // attempts)
            offsets.append(random.randrange(start, stop))
        random.shuffle(offsets)

    result: list[str] = []
    seen = set(blocked)
    for offset in offsets:
        row = db.execute(
            f"SELECT id FROM {table} WHERE {where} ORDER BY rating,id LIMIT 1 OFFSET ?",
            (*params, offset),
        ).fetchone()
        if row is None:
            continue
        puzzle_id = str(row["id"])
        if puzzle_id in seen:
            continue
        seen.add(puzzle_id)
        result.append(puzzle_id)
        if len(result) >= limit:
            break
    return result


def _load_puzzles(
    ids: list[str],
    puzzles_db: Path,
    *,
    mode: str,
    preferred_skill: str | None = None,
    preferred_theme: str | None = None,
) -> list[dict[str, Any]]:
    if not ids or not puzzles_db.exists():
        return []
    result: list[dict[str, Any]] = []
    with closing(sqlite3.connect(puzzles_db)) as db:
        db.row_factory = sqlite3.Row
        for puzzle_id in ids:
            row = db.execute("SELECT * FROM puzzles WHERE id=?", (puzzle_id,)).fetchone()
            if not _valid_puzzle(row):
                continue
            item = dict(row)
            themes = str(item.get("themes") or "").split()
            selected_theme = preferred_theme if preferred_theme in themes else (themes[0] if themes else preferred_theme)
            item["academyMode"] = mode
            item["academyTheme"] = selected_theme or ""
            item["academySkill"] = preferred_skill or theme_label(selected_theme)
            result.append(item)
    return result


def build_training_session(
    student_id: str,
    mode: str = "personalized",
    limit: int = 10,
    explicit_theme: str | None = None,
    *,
    database: Path | None = None,
    puzzles_db: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    puzzle_path = puzzles_db or PUZZLES_DB
    current_time = time.time() if now is None else now
    profile = training_profile(student_id, path, current_time)
    if profile["student"]["placementStatus"] != "completed":
        raise ValueError("Đệ tử cần hoàn thành Khảo Thí Nhập Môn trước khi vào Bí Cảnh cá nhân hóa.")
    if not puzzle_path.exists():
        raise FileNotFoundError("Chưa nhập database puzzle Lichess.")

    if mode == "review":
        ensure_training_schema(path)
        with closing(_connect(path)) as db:
            rows = db.execute(
                "SELECT puzzle_id,skill,theme FROM academy_review_items "
                "WHERE student_id=? AND next_review<=? ORDER BY next_review,lapses DESC LIMIT ?",
                (student_id, current_time, limit),
            ).fetchall()
        ids = [str(row["puzzle_id"]) for row in rows]
        meta = {str(row["puzzle_id"]): (str(row["skill"]), str(row["theme"])) for row in rows}
        puzzles: list[dict[str, Any]] = []
        with closing(sqlite3.connect(puzzle_path)) as pdb:
            pdb.row_factory = sqlite3.Row
            for puzzle_id in ids:
                row = pdb.execute("SELECT * FROM puzzles WHERE id=?", (puzzle_id,)).fetchone()
                if not _valid_puzzle(row):
                    continue
                skill, theme = meta[puzzle_id]
                item = dict(row)
                item["academyMode"] = "review"
                item["academySkill"] = skill
                item["academyTheme"] = theme
                puzzles.append(item)
        return {
            "mode": "review",
            "puzzles": puzzles,
            "matching": len(ids),
            "profile": profile,
            "personalization": {
                "skill": "Sổ Sai Lầm",
                "theme": None,
                "themeLabel": "Ôn bài đến hạn",
                "minimum": profile["ratingRange"]["minimum"],
                "maximum": profile["ratingRange"]["maximum"],
                "reason": f"Có {profile['review']['due']} bài đến hạn ôn",
            },
        }

    minimum = int(profile["ratingRange"]["minimum"])
    maximum = int(profile["ratingRange"]["maximum"])
    recommendation = profile["recommendation"]
    target_theme = explicit_theme or recommendation.get("theme")
    target_skill = theme_label(explicit_theme) if explicit_theme else str(recommendation.get("skill") or "Tổng hợp")
    recent = _recent_puzzle_ids(student_id, path)

    with closing(sqlite3.connect(puzzle_path)) as pdb:
        pdb.row_factory = sqlite3.Row
        focused_limit = max(1, round(limit * 0.6)) if target_theme else 0
        focused = _sample_puzzle_ids(
            pdb, minimum, maximum, focused_limit, theme=target_theme, exclude=recent
        ) if target_theme else []
        blocked = recent | set(focused)
        mixed = _sample_puzzle_ids(
            pdb, minimum, maximum, limit - len(focused), exclude=blocked
        )
    ids = focused + mixed
    random.shuffle(ids)
    puzzles = _load_puzzles(
        ids, puzzle_path, mode="personalized", preferred_skill=target_skill, preferred_theme=target_theme
    )
    return {
        "mode": "personalized",
        "puzzles": puzzles,
        "matching": len(ids),
        "profile": profile,
        "personalization": {
            "skill": target_skill,
            "theme": target_theme,
            "themeLabel": theme_label(target_theme),
            "minimum": minimum,
            "maximum": maximum,
            "reason": "Ưu tiên điểm yếu trong Skill Map; phần còn lại là bài tổng hợp cùng độ khó",
        },
    }


def _baseline_mastery(student_id: str, skill: str, database: Path) -> float:
    scores = _placement_skill_scores(student_id, database)
    wanted = _normalize(skill)
    for name, values in scores.items():
        if _normalize(name) == wanted and isinstance(values, dict):
            return max(0.0, min(100.0, float(values.get("percent") or 0.0)))
    return 50.0


def record_training_result(
    student_id: str,
    payload: TrainingResultRequest,
    *,
    database: Path | None = None,
    puzzles_db: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    puzzle_path = puzzles_db or PUZZLES_DB
    current_time = time.time() if now is None else now
    ensure_training_schema(path)

    with closing(_connect(path)) as db:
        duplicate = db.execute(
            "SELECT rating_after,rating_delta,xp_awarded FROM academy_puzzle_attempts WHERE event_id=? AND student_id=?",
            (payload.eventId, student_id),
        ).fetchone()
        if duplicate is not None:
            profile = training_profile(student_id, path, current_time)
            return {
                "recorded": True,
                "duplicate": True,
                "xpAwarded": int(duplicate["xp_awarded"]),
                "ratingDelta": int(duplicate["rating_delta"]),
                "profile": profile,
            }
        student = db.execute(
            "SELECT xp,puzzle_rating FROM academy_students WHERE id=?", (student_id,)
        ).fetchone()
        if student is None:
            raise KeyError(student_id)
        recent_same = db.execute(
            "SELECT created FROM academy_puzzle_attempts WHERE student_id=? AND puzzle_id=? ORDER BY created DESC LIMIT 1",
            (student_id, payload.puzzleId),
        ).fetchone()

    if not puzzle_path.exists():
        raise FileNotFoundError("Chưa nhập database puzzle Lichess.")
    with closing(sqlite3.connect(puzzle_path)) as pdb:
        pdb.row_factory = sqlite3.Row
        puzzle = pdb.execute("SELECT id,rating,themes FROM puzzles WHERE id=?", (payload.puzzleId,)).fetchone()
    if puzzle is None:
        raise LookupError(payload.puzzleId)

    puzzle_rating = int(puzzle["rating"])
    puzzle_themes = str(puzzle["themes"] or "").split()
    requested_theme = (payload.theme or "").strip()
    theme = requested_theme if requested_theme and requested_theme in puzzle_themes else (puzzle_themes[0] if puzzle_themes else requested_theme)
    skill = (payload.skill or theme_label(theme)).strip() or "Tổng hợp"
    clean = payload.mistakes == 0 and not payload.hinted
    if clean:
        performance = 1.0
    elif payload.hinted:
        performance = 0.40
    elif payload.mistakes <= 1:
        performance = 0.72
    else:
        performance = 0.55

    rating_before = int(student["puzzle_rating"])
    repeated_recently = bool(recent_same and current_time - float(recent_same["created"]) < 20 * 3600)
    k = 8 if repeated_recently else 24
    rating_delta = _rating_change(rating_before, puzzle_rating, performance, k=k)
    rating_after = max(400, min(3000, rating_before + rating_delta))

    difficulty_bonus = max(0, min(8, round((puzzle_rating - rating_before) / 100)))
    if clean:
        xp = 18 + difficulty_bonus
    elif payload.hinted:
        xp = 5 + max(0, difficulty_bonus // 2)
    else:
        xp = 10 + max(0, difficulty_bonus // 2)
    if repeated_recently:
        xp = max(1, round(xp * 0.25))

    with closing(_connect(path)) as db:
        progress = db.execute(
            "SELECT * FROM academy_skill_progress WHERE student_id=? AND skill=?",
            (student_id, skill),
        ).fetchone()
        old_mastery = float(progress["mastery"]) if progress is not None else _baseline_mastery(student_id, skill, path)
        performance_score = performance * 100.0
        alpha = 0.12 if payload.mode == "review" else 0.18
        new_mastery = round(max(0.0, min(100.0, old_mastery * (1 - alpha) + performance_score * alpha)), 1)
        attempts = int(progress["attempts"]) + 1 if progress is not None else 1
        clean_count = int(progress["clean"]) + (1 if clean else 0) if progress is not None else (1 if clean else 0)

        review = db.execute(
            "SELECT * FROM academy_review_items WHERE student_id=? AND puzzle_id=?",
            (student_id, payload.puzzleId),
        ).fetchone()
        review_due: float | None = None
        interval_days: int | None = None
        if not clean or review is not None:
            previous_repetitions = int(review["repetitions"]) if review is not None else 0
            next_repetitions, interval_days = review_interval(previous_repetitions, clean)
            lapses = int(review["lapses"]) + (0 if clean else 1) if review is not None else (0 if clean else 1)
            review_due = current_time + interval_days * DAY
            db.execute(
                """
                INSERT INTO academy_review_items(
                    student_id,puzzle_id,skill,theme,repetitions,lapses,interval_days,next_review,last_seen,last_mistakes,last_hinted
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(student_id,puzzle_id) DO UPDATE SET
                    skill=excluded.skill,theme=excluded.theme,repetitions=excluded.repetitions,
                    lapses=excluded.lapses,interval_days=excluded.interval_days,next_review=excluded.next_review,
                    last_seen=excluded.last_seen,last_mistakes=excluded.last_mistakes,last_hinted=excluded.last_hinted
                """,
                (
                    student_id, payload.puzzleId, skill, theme or "", next_repetitions, lapses,
                    interval_days, review_due, current_time, payload.mistakes, 1 if payload.hinted else 0,
                ),
            )

        db.execute(
            """
            INSERT INTO academy_skill_progress(student_id,skill,theme,attempts,clean,mastery,updated)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(student_id,skill) DO UPDATE SET
                theme=excluded.theme,attempts=excluded.attempts,clean=excluded.clean,
                mastery=excluded.mastery,updated=excluded.updated
            """,
            (student_id, skill, theme or "", attempts, clean_count, new_mastery, current_time),
        )
        db.execute(
            "UPDATE academy_students SET xp=xp+?,puzzle_rating=?,updated=? WHERE id=?",
            (xp, rating_after, current_time, student_id),
        )
        db.execute(
            """
            INSERT INTO academy_puzzle_attempts(
                id,event_id,student_id,puzzle_id,mode,skill,theme,puzzle_rating,mistakes,hinted,elapsed_ms,
                performance,rating_before,rating_after,rating_delta,xp_awarded,created
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                uuid.uuid4().hex, payload.eventId, student_id, payload.puzzleId, payload.mode, skill,
                theme or "", puzzle_rating, payload.mistakes, 1 if payload.hinted else 0, payload.elapsedMs,
                performance, rating_before, rating_after, rating_delta, xp, current_time,
            ),
        )
        db.commit()

    profile = training_profile(student_id, path, current_time)
    return {
        "recorded": True,
        "duplicate": False,
        "clean": clean,
        "xpAwarded": xp,
        "ratingBefore": rating_before,
        "ratingAfter": rating_after,
        "ratingDelta": rating_delta,
        "mastery": {"skill": skill, "before": round(old_mastery, 1), "after": new_mastery},
        "review": {
            "added": not clean,
            "nextReviewAt": review_due,
            "intervalDays": interval_days,
        },
        "profile": profile,
    }


def mistake_book(student_id: str, limit: int = 50, database: Path | None = None, puzzles_db: Path | None = None, now: float | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    puzzle_path = puzzles_db or PUZZLES_DB
    current_time = time.time() if now is None else now
    ensure_training_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            "SELECT * FROM academy_review_items WHERE student_id=? ORDER BY next_review,lapses DESC LIMIT ?",
            (student_id, limit),
        ).fetchall()
    puzzle_meta: dict[str, dict[str, Any]] = {}
    if puzzle_path.exists() and rows:
        with closing(sqlite3.connect(puzzle_path)) as pdb:
            pdb.row_factory = sqlite3.Row
            for row in rows:
                puzzle = pdb.execute("SELECT id,rating,themes FROM puzzles WHERE id=?", (row["puzzle_id"],)).fetchone()
                if puzzle is not None:
                    puzzle_meta[str(row["puzzle_id"])] = dict(puzzle)
    items = []
    for row in rows:
        meta = puzzle_meta.get(str(row["puzzle_id"]), {})
        items.append({
            "puzzleId": row["puzzle_id"],
            "skill": row["skill"],
            "theme": row["theme"],
            "themeLabel": theme_label(row["theme"]),
            "rating": meta.get("rating"),
            "themes": meta.get("themes", ""),
            "repetitions": int(row["repetitions"]),
            "lapses": int(row["lapses"]),
            "intervalDays": int(row["interval_days"]),
            "nextReviewAt": float(row["next_review"]),
            "due": float(row["next_review"]) <= current_time,
            "lastMistakes": int(row["last_mistakes"]),
            "lastHinted": bool(row["last_hinted"]),
        })
    return {
        "items": items,
        "total": len(items),
        "due": sum(1 for item in items if item["due"]),
    }


@router.get("/profile")
def training_profile_route(student: dict = Depends(require_student)):
    return training_profile(student["id"])


@router.post("/session")
def training_session_route(payload: TrainingSessionRequest, student: dict = Depends(require_student)):
    try:
        return build_training_session(student["id"], payload.mode, payload.limit, payload.theme)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/result")
def training_result_route(payload: TrainingResultRequest, student: dict = Depends(require_student)):
    try:
        return record_training_result(student["id"], payload)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy puzzle trong kho Lichess.") from exc


@router.get("/mistakes")
def mistake_book_route(limit: int = Query(default=50, ge=1, le=200), student: dict = Depends(require_student)):
    return mistake_book(student["id"], limit=limit)
