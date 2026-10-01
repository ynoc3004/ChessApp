from __future__ import annotations

import math
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .academy import ACADEMY_DB, _connect, ensure_schema, require_student
from .admin_auth import require_permission

admin_router = APIRouter(
    prefix="/academy/tournaments",
    dependencies=[Depends(require_permission("admin.write"))],
)
public_router = APIRouter(prefix="/api/academy/tournaments")

TOURNAMENT_STATUSES = {"draft", "registration", "running", "completed", "cancelled"}
RESULTS = {"1-0", "0-1", "1/2-1/2"}


class CreateTournamentRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=3000)
    stepMin: int = Field(default=1, ge=1, le=20)
    stepMax: int = Field(default=20, ge=1, le=20)
    ratingMin: int = Field(default=400, ge=400, le=3000)
    ratingMax: int = Field(default=3000, ge=400, le=3000)
    classId: str | None = Field(default=None, max_length=100)
    maxPlayers: int = Field(default=32, ge=2, le=256)
    rounds: int = Field(default=5, ge=1, le=12)
    startsAt: float | None = None


class UpdateTournamentRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=3000)
    startsAt: float | None = None
    maxPlayers: int | None = Field(default=None, ge=2, le=256)
    cancelled: bool | None = None


class PairingResultRequest(BaseModel):
    result: Literal["1-0", "0-1", "1/2-1/2"]
    pgn: str = Field(default="", max_length=30000)


def ensure_tournament_schema(database: Path | None = None) -> None:
    path = database or ACADEMY_DB
    ensure_schema(path)
    with closing(_connect(path)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS academy_tournaments (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                step_min INTEGER NOT NULL,
                step_max INTEGER NOT NULL,
                rating_min INTEGER NOT NULL,
                rating_max INTEGER NOT NULL,
                class_id TEXT,
                max_players INTEGER NOT NULL,
                planned_rounds INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                starts_at REAL,
                created REAL NOT NULL,
                updated REAL NOT NULL,
                FOREIGN KEY(class_id) REFERENCES academy_classes(id)
            );
            CREATE TABLE IF NOT EXISTS academy_tournament_players (
                tournament_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                seed_rating INTEGER NOT NULL,
                registered_at REAL NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                bye_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(tournament_id, student_id),
                FOREIGN KEY(tournament_id) REFERENCES academy_tournaments(id) ON DELETE CASCADE,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_tournament_rounds (
                tournament_id TEXT NOT NULL,
                round_no INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created REAL NOT NULL,
                completed REAL,
                PRIMARY KEY(tournament_id, round_no),
                FOREIGN KEY(tournament_id) REFERENCES academy_tournaments(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_tournament_pairings (
                id TEXT PRIMARY KEY,
                tournament_id TEXT NOT NULL,
                round_no INTEGER NOT NULL,
                board_no INTEGER NOT NULL,
                white_id TEXT NOT NULL,
                black_id TEXT,
                result TEXT NOT NULL DEFAULT 'pending',
                pgn TEXT NOT NULL DEFAULT '',
                reported_at REAL,
                FOREIGN KEY(tournament_id) REFERENCES academy_tournaments(id) ON DELETE CASCADE,
                FOREIGN KEY(white_id) REFERENCES academy_students(id),
                FOREIGN KEY(black_id) REFERENCES academy_students(id),
                UNIQUE(tournament_id, round_no, board_no)
            );
            CREATE INDEX IF NOT EXISTS idx_academy_tournaments_status
                ON academy_tournaments(status, starts_at, created DESC);
            CREATE INDEX IF NOT EXISTS idx_academy_tournament_players_student
                ON academy_tournament_players(student_id, active);
            CREATE INDEX IF NOT EXISTS idx_academy_tournament_pairings_round
                ON academy_tournament_pairings(tournament_id, round_no, board_no);
            """
        )
        db.commit()


def _row_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "title": str(row["title"]),
        "description": str(row["description"] or ""),
        "stepMin": int(row["step_min"]),
        "stepMax": int(row["step_max"]),
        "ratingMin": int(row["rating_min"]),
        "ratingMax": int(row["rating_max"]),
        "classId": row["class_id"],
        "className": row["class_name"] if "class_name" in row.keys() else None,
        "maxPlayers": int(row["max_players"]),
        "rounds": int(row["planned_rounds"]),
        "status": str(row["status"]),
        "startsAt": float(row["starts_at"]) if row["starts_at"] is not None else None,
        "createdAt": float(row["created"]),
        "updatedAt": float(row["updated"]),
        "playerCount": int(row["player_count"]) if "player_count" in row.keys() else 0,
        "currentRound": int(row["current_round"]) if "current_round" in row.keys() and row["current_round"] is not None else 0,
    }


def _get_tournament(tournament_id: str, database: Path) -> sqlite3.Row | None:
    with closing(_connect(database)) as db:
        return db.execute(
            """
            SELECT t.*,c.name class_name,
                   COUNT(DISTINCT CASE WHEN p.active=1 THEN p.student_id END) player_count,
                   MAX(r.round_no) current_round
            FROM academy_tournaments t
            LEFT JOIN academy_classes c ON c.id=t.class_id
            LEFT JOIN academy_tournament_players p ON p.tournament_id=t.id
            LEFT JOIN academy_tournament_rounds r ON r.tournament_id=t.id
            WHERE t.id=?
            GROUP BY t.id
            """,
            (tournament_id,),
        ).fetchone()


def create_tournament(
    payload: CreateTournamentRequest,
    database: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    if payload.stepMin > payload.stepMax:
        raise ValueError("Step tối thiểu không được lớn hơn Step tối đa.")
    if payload.ratingMin > payload.ratingMax:
        raise ValueError("Rating tối thiểu không được lớn hơn rating tối đa.")
    if payload.classId:
        with closing(_connect(path)) as db:
            if db.execute("SELECT id FROM academy_classes WHERE id=? AND active=1", (payload.classId,)).fetchone() is None:
                raise LookupError("class")
    tournament_id = uuid.uuid4().hex
    with closing(_connect(path)) as db:
        db.execute(
            """
            INSERT INTO academy_tournaments(
                id,title,description,step_min,step_max,rating_min,rating_max,class_id,
                max_players,planned_rounds,status,starts_at,created,updated
            ) VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)
            """,
            (
                tournament_id, payload.title.strip(), payload.description.strip(), payload.stepMin,
                payload.stepMax, payload.ratingMin, payload.ratingMax, payload.classId,
                payload.maxPlayers, payload.rounds, payload.startsAt, current_time, current_time,
            ),
        )
        db.commit()
    row = _get_tournament(tournament_id, path)
    assert row is not None
    return _row_payload(row)


def update_tournament(
    tournament_id: str,
    payload: UpdateTournamentRequest,
    database: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    with closing(_connect(path)) as db:
        row = db.execute("SELECT * FROM academy_tournaments WHERE id=?", (tournament_id,)).fetchone()
        if row is None:
            raise LookupError("tournament")
        if payload.cancelled is True:
            if row["status"] == "completed":
                raise ValueError("Giải đã kết thúc, không thể hủy.")
            db.execute("UPDATE academy_tournaments SET status='cancelled',updated=? WHERE id=?", (current_time, tournament_id))
        else:
            if row["status"] not in {"draft", "registration"}:
                raise ValueError("Chỉ sửa thông tin giải trước khi bắt đầu.")
            updates: list[str] = []
            values: list[Any] = []
            for field, column in (("title", "title"), ("description", "description"), ("startsAt", "starts_at"), ("maxPlayers", "max_players")):
                value = getattr(payload, field)
                if value is not None:
                    updates.append(f"{column}=?")
                    values.append(value.strip() if isinstance(value, str) else value)
            if updates:
                updates.append("updated=?")
                values.extend((current_time, tournament_id))
                db.execute(f"UPDATE academy_tournaments SET {','.join(updates)} WHERE id=?", values)
        db.commit()
    result = _get_tournament(tournament_id, path)
    assert result is not None
    return _row_payload(result)


def open_registration(tournament_id: str, database: Path | None = None, now: float | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    with closing(_connect(path)) as db:
        row = db.execute("SELECT status FROM academy_tournaments WHERE id=?", (tournament_id,)).fetchone()
        if row is None:
            raise LookupError("tournament")
        if row["status"] not in {"draft", "registration"}:
            raise ValueError("Giải không thể mở đăng ký ở trạng thái hiện tại.")
        db.execute("UPDATE academy_tournaments SET status='registration',updated=? WHERE id=?", (current_time, tournament_id))
        db.commit()
    result = _get_tournament(tournament_id, path)
    assert result is not None
    return _row_payload(result)


def _eligibility(row: sqlite3.Row, student: sqlite3.Row | dict[str, Any], database: Path) -> tuple[bool, str]:
    if row["status"] != "registration":
        return False, "Giải hiện chưa mở đăng ký."
    step = student["current_step"] if isinstance(student, sqlite3.Row) else student.get("current_step", student.get("currentStep"))
    rating = student["puzzle_rating"] if isinstance(student, sqlite3.Row) else student.get("puzzle_rating", student.get("puzzleRating"))
    if step is None:
        return False, "Cần hoàn thành Khảo Thí Nhập Môn trước khi đăng ký."
    if not int(row["step_min"]) <= int(step) <= int(row["step_max"]):
        return False, f"Giải dành cho Step {row['step_min']}–{row['step_max']}."
    if not int(row["rating_min"]) <= int(rating) <= int(row["rating_max"]):
        return False, f"Puzzle Rating cần nằm trong {row['rating_min']}–{row['rating_max']}."
    if row["class_id"]:
        student_id = student["id"]
        with closing(_connect(database)) as db:
            active = db.execute(
                "SELECT 1 FROM academy_enrollments WHERE student_id=? AND class_id=? AND active=1",
                (student_id, row["class_id"]),
            ).fetchone()
        if active is None:
            return False, "Giải chỉ dành cho lớp được chỉ định."
    if int(row["player_count"]) >= int(row["max_players"]):
        return False, "Giải đã đủ số người."
    return True, "Đủ điều kiện đăng ký."


def register_student(
    tournament_id: str,
    student_id: str,
    database: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    tournament = _get_tournament(tournament_id, path)
    if tournament is None:
        raise LookupError("tournament")
    with closing(_connect(path)) as db:
        student = db.execute("SELECT * FROM academy_students WHERE id=? AND enabled=1", (student_id,)).fetchone()
        if student is None:
            raise LookupError("student")
        existing = db.execute(
            "SELECT active FROM academy_tournament_players WHERE tournament_id=? AND student_id=?",
            (tournament_id, student_id),
        ).fetchone()
    if existing is not None and bool(existing["active"]):
        return {"registered": True, "duplicate": True}
    eligible, reason = _eligibility(tournament, student, path)
    if not eligible:
        raise ValueError(reason)
    with closing(_connect(path)) as db:
        db.execute(
            """
            INSERT INTO academy_tournament_players(tournament_id,student_id,seed_rating,registered_at,active,bye_count)
            VALUES(?,?,?,?,1,0)
            ON CONFLICT(tournament_id,student_id) DO UPDATE SET
                seed_rating=excluded.seed_rating,registered_at=excluded.registered_at,active=1
            """,
            (tournament_id, student_id, int(student["puzzle_rating"]), current_time),
        )
        db.commit()
    return {"registered": True, "duplicate": False}


def unregister_student(tournament_id: str, student_id: str, database: Path | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    tournament = _get_tournament(tournament_id, path)
    if tournament is None:
        raise LookupError("tournament")
    if tournament["status"] != "registration":
        raise ValueError("Không thể rút đăng ký sau khi giải đã bắt đầu.")
    with closing(_connect(path)) as db:
        changed = db.execute(
            "UPDATE academy_tournament_players SET active=0 WHERE tournament_id=? AND student_id=? AND active=1",
            (tournament_id, student_id),
        ).rowcount
        db.commit()
    return {"unregistered": bool(changed)}


def _pairing_rows(tournament_id: str, database: Path) -> list[sqlite3.Row]:
    with closing(_connect(database)) as db:
        return db.execute(
            "SELECT * FROM academy_tournament_pairings WHERE tournament_id=? ORDER BY round_no,board_no",
            (tournament_id,),
        ).fetchall()


def _score_map(tournament_id: str, database: Path) -> tuple[dict[str, float], dict[str, list[str]], dict[str, tuple[int, int]]]:
    with closing(_connect(database)) as db:
        players = db.execute(
            "SELECT student_id FROM academy_tournament_players WHERE tournament_id=? AND active=1",
            (tournament_id,),
        ).fetchall()
    scores = {str(row["student_id"]): 0.0 for row in players}
    opponents: dict[str, list[str]] = {player_id: [] for player_id in scores}
    colors: dict[str, list[int]] = {player_id: [0, 0] for player_id in scores}  # white, black
    for row in _pairing_rows(tournament_id, database):
        white = str(row["white_id"])
        black = str(row["black_id"]) if row["black_id"] is not None else None
        result = str(row["result"])
        if black is None:
            if result == "bye":
                scores[white] = scores.get(white, 0.0) + 1.0
            continue
        opponents.setdefault(white, []).append(black)
        opponents.setdefault(black, []).append(white)
        colors.setdefault(white, [0, 0])[0] += 1
        colors.setdefault(black, [0, 0])[1] += 1
        if result == "1-0":
            scores[white] = scores.get(white, 0.0) + 1.0
        elif result == "0-1":
            scores[black] = scores.get(black, 0.0) + 1.0
        elif result == "1/2-1/2":
            scores[white] = scores.get(white, 0.0) + 0.5
            scores[black] = scores.get(black, 0.0) + 0.5
    return scores, opponents, {key: (value[0], value[1]) for key, value in colors.items()}


def standings(tournament_id: str, database: Path | None = None) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    scores, opponents, _ = _score_map(tournament_id, path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            """
            SELECT p.student_id,p.seed_rating,p.bye_count,s.display_name,s.username,s.current_step,s.puzzle_rating
            FROM academy_tournament_players p
            JOIN academy_students s ON s.id=p.student_id
            WHERE p.tournament_id=? AND p.active=1
            """,
            (tournament_id,),
        ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        player_id = str(row["student_id"])
        buchholz = sum(scores.get(opponent, 0.0) for opponent in opponents.get(player_id, []))
        wins = 0
        for game in _pairing_rows(tournament_id, path):
            if game["black_id"] is None:
                continue
            if game["result"] == "1-0" and game["white_id"] == player_id:
                wins += 1
            elif game["result"] == "0-1" and game["black_id"] == player_id:
                wins += 1
        result.append({
            "studentId": player_id,
            "displayName": str(row["display_name"]),
            "username": str(row["username"]),
            "step": int(row["current_step"]) if row["current_step"] is not None else None,
            "puzzleRating": int(row["puzzle_rating"]),
            "seedRating": int(row["seed_rating"]),
            "score": scores.get(player_id, 0.0),
            "buchholz": round(buchholz, 2),
            "wins": wins,
            "byeCount": int(row["bye_count"]),
        })
    result.sort(key=lambda item: (-item["score"], -item["buchholz"], -item["wins"], -item["seedRating"], item["displayName"]))
    for index, item in enumerate(result, 1):
        item["rank"] = index
    return result


def _choose_bye(players: list[dict[str, Any]]) -> dict[str, Any]:
    for player in reversed(players):
        if int(player.get("byeCount", 0)) == 0:
            return player
    return players[-1]


def _color_order(a: str, b: str, colors: dict[str, tuple[int, int]], round_no: int, board_no: int) -> tuple[str, str]:
    aw, ab = colors.get(a, (0, 0))
    bw, bb = colors.get(b, (0, 0))
    a_balance = aw - ab
    b_balance = bw - bb
    if a_balance > b_balance:
        return b, a
    if b_balance > a_balance:
        return a, b
    return (a, b) if (round_no + board_no) % 2 == 0 else (b, a)


def _create_round(tournament_id: str, round_no: int, database: Path, now: float) -> list[dict[str, Any]]:
    table = standings(tournament_id, database)
    if len(table) < 2:
        raise ValueError("Cần ít nhất 2 đệ tử để ghép cặp.")
    scores, opponents, colors = _score_map(tournament_id, database)
    pool = [dict(player) for player in table]
    bye_player: dict[str, Any] | None = None
    if len(pool) % 2 == 1:
        bye_player = _choose_bye(pool)
        pool = [player for player in pool if player["studentId"] != bye_player["studentId"]]

    pairs: list[tuple[str, str]] = []
    board_no = 1
    while pool:
        first = pool.pop(0)
        first_id = str(first["studentId"])
        candidates = list(enumerate(pool))
        non_repeat = [(index, player) for index, player in candidates if player["studentId"] not in opponents.get(first_id, [])]
        search = non_repeat or candidates
        search.sort(key=lambda pair: (
            abs(scores.get(first_id, 0.0) - scores.get(str(pair[1]["studentId"]), 0.0)),
            abs(first["seedRating"] - pair[1]["seedRating"]),
            pair[0],
        ))
        opponent_index, opponent = search[0]
        pool.pop(opponent_index)
        white, black = _color_order(first_id, str(opponent["studentId"]), colors, round_no, board_no)
        pairs.append((white, black))
        board_no += 1

    with closing(_connect(database)) as db:
        db.execute(
            "INSERT INTO academy_tournament_rounds(tournament_id,round_no,status,created) VALUES(?,?,'active',?)",
            (tournament_id, round_no, now),
        )
        for index, (white, black) in enumerate(pairs, 1):
            db.execute(
                """
                INSERT INTO academy_tournament_pairings(
                    id,tournament_id,round_no,board_no,white_id,black_id,result,pgn
                ) VALUES(?,?,?,?,?,?,'pending','')
                """,
                (uuid.uuid4().hex, tournament_id, round_no, index, white, black),
            )
        if bye_player is not None:
            db.execute(
                """
                INSERT INTO academy_tournament_pairings(
                    id,tournament_id,round_no,board_no,white_id,black_id,result,pgn,reported_at
                ) VALUES(?,?,?,?,?,NULL,'bye','',?)
                """,
                (uuid.uuid4().hex, tournament_id, round_no, len(pairs) + 1, bye_player["studentId"], now),
            )
            db.execute(
                "UPDATE academy_tournament_players SET bye_count=bye_count+1 WHERE tournament_id=? AND student_id=?",
                (tournament_id, bye_player["studentId"]),
            )
        db.commit()
    return round_pairings(tournament_id, round_no, database)


def start_tournament(tournament_id: str, database: Path | None = None, now: float | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    tournament = _get_tournament(tournament_id, path)
    if tournament is None:
        raise LookupError("tournament")
    if tournament["status"] != "registration":
        raise ValueError("Giải phải ở trạng thái mở đăng ký trước khi bắt đầu.")
    if int(tournament["player_count"]) < 2:
        raise ValueError("Cần ít nhất 2 đệ tử đã đăng ký.")
    with closing(_connect(path)) as db:
        db.execute("UPDATE academy_tournaments SET status='running',updated=? WHERE id=?", (current_time, tournament_id))
        db.commit()
    pairings = _create_round(tournament_id, 1, path, current_time)
    return {"started": True, "round": 1, "pairings": pairings}


def round_pairings(tournament_id: str, round_no: int, database: Path | None = None) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            """
            SELECT p.*,sw.display_name white_name,sb.display_name black_name
            FROM academy_tournament_pairings p
            JOIN academy_students sw ON sw.id=p.white_id
            LEFT JOIN academy_students sb ON sb.id=p.black_id
            WHERE p.tournament_id=? AND p.round_no=? ORDER BY p.board_no
            """,
            (tournament_id, round_no),
        ).fetchall()
    return [{
        "id": str(row["id"]),
        "round": int(row["round_no"]),
        "board": int(row["board_no"]),
        "whiteId": str(row["white_id"]),
        "whiteName": str(row["white_name"]),
        "blackId": str(row["black_id"]) if row["black_id"] is not None else None,
        "blackName": str(row["black_name"]) if row["black_name"] is not None else None,
        "result": str(row["result"]),
        "pgn": str(row["pgn"] or ""),
        "reportedAt": float(row["reported_at"]) if row["reported_at"] is not None else None,
    } for row in rows]


def record_pairing_result(
    tournament_id: str,
    pairing_id: str,
    payload: PairingResultRequest,
    database: Path | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    tournament = _get_tournament(tournament_id, path)
    if tournament is None:
        raise LookupError("tournament")
    if tournament["status"] != "running":
        raise ValueError("Chỉ nhập kết quả khi giải đang diễn ra.")
    with closing(_connect(path)) as db:
        pairing = db.execute(
            "SELECT * FROM academy_tournament_pairings WHERE id=? AND tournament_id=?",
            (pairing_id, tournament_id),
        ).fetchone()
        if pairing is None:
            raise LookupError("pairing")
        if pairing["black_id"] is None:
            raise ValueError("Bàn bye không cần nhập kết quả.")
        db.execute(
            "UPDATE academy_tournament_pairings SET result=?,pgn=?,reported_at=? WHERE id=?",
            (payload.result, payload.pgn.strip(), current_time, pairing_id),
        )
        pending = int(db.execute(
            "SELECT COUNT(*) FROM academy_tournament_pairings WHERE tournament_id=? AND round_no=? AND result='pending'",
            (tournament_id, pairing["round_no"]),
        ).fetchone()[0])
        if pending == 0:
            db.execute(
                "UPDATE academy_tournament_rounds SET status='completed',completed=? WHERE tournament_id=? AND round_no=?",
                (current_time, tournament_id, pairing["round_no"]),
            )
        db.commit()
    return {"saved": True, "standings": standings(tournament_id, path)}


def next_round(tournament_id: str, database: Path | None = None, now: float | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    tournament = _get_tournament(tournament_id, path)
    if tournament is None:
        raise LookupError("tournament")
    if tournament["status"] != "running":
        raise ValueError("Giải chưa ở trạng thái đang đấu.")
    current_round = int(tournament["current_round"] or 0)
    if current_round <= 0:
        raise ValueError("Giải chưa có vòng đấu.")
    with closing(_connect(path)) as db:
        pending = int(db.execute(
            "SELECT COUNT(*) FROM academy_tournament_pairings WHERE tournament_id=? AND round_no=? AND result='pending'",
            (tournament_id, current_round),
        ).fetchone()[0])
    if pending:
        raise ValueError("Cần nhập đủ kết quả vòng hiện tại trước khi ghép vòng mới.")
    if current_round >= int(tournament["planned_rounds"]):
        raise ValueError("Đã đủ số vòng dự kiến. Hãy kết thúc giải.")
    round_no = current_round + 1
    return {"round": round_no, "pairings": _create_round(tournament_id, round_no, path, current_time)}


def finish_tournament(tournament_id: str, database: Path | None = None, now: float | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    current_time = time.time() if now is None else now
    tournament = _get_tournament(tournament_id, path)
    if tournament is None:
        raise LookupError("tournament")
    if tournament["status"] != "running":
        raise ValueError("Chỉ có thể kết thúc một giải đang diễn ra.")
    current_round = int(tournament["current_round"] or 0)
    with closing(_connect(path)) as db:
        pending = int(db.execute(
            "SELECT COUNT(*) FROM academy_tournament_pairings WHERE tournament_id=? AND round_no=? AND result='pending'",
            (tournament_id, current_round),
        ).fetchone()[0])
        if pending:
            raise ValueError("Vòng hiện tại vẫn còn bàn chưa có kết quả.")
        db.execute("UPDATE academy_tournaments SET status='completed',updated=? WHERE id=?", (current_time, tournament_id))
        db.commit()
    return {"completed": True, "standings": standings(tournament_id, path)}


def tournament_detail(tournament_id: str, database: Path | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    tournament = _get_tournament(tournament_id, path)
    if tournament is None:
        raise LookupError("tournament")
    payload = _row_payload(tournament)
    current_round = payload["currentRound"]
    payload["standings"] = standings(tournament_id, path)
    payload["pairings"] = round_pairings(tournament_id, current_round, path) if current_round else []
    return payload


def list_tournaments(database: Path | None = None) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            """
            SELECT t.*,c.name class_name,
                   COUNT(DISTINCT CASE WHEN p.active=1 THEN p.student_id END) player_count,
                   MAX(r.round_no) current_round
            FROM academy_tournaments t
            LEFT JOIN academy_classes c ON c.id=t.class_id
            LEFT JOIN academy_tournament_players p ON p.tournament_id=t.id
            LEFT JOIN academy_tournament_rounds r ON r.tournament_id=t.id
            GROUP BY t.id
            ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'registration' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
                     COALESCE(t.starts_at, 99999999999),t.created DESC
            """
        ).fetchall()
    return [_row_payload(row) for row in rows]


def student_tournaments(student_id: str, database: Path | None = None) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    with closing(_connect(path)) as db:
        student = db.execute("SELECT * FROM academy_students WHERE id=?", (student_id,)).fetchone()
        if student is None:
            raise LookupError("student")
        registered_ids = {str(row["tournament_id"]) for row in db.execute(
            "SELECT tournament_id FROM academy_tournament_players WHERE student_id=? AND active=1", (student_id,)
        ).fetchall()}
    result = []
    for item in list_tournaments(path):
        row = _get_tournament(item["id"], path)
        assert row is not None
        eligible, reason = _eligibility(row, student, path)
        item["registered"] = item["id"] in registered_ids
        item["eligible"] = eligible or item["registered"]
        item["eligibilityReason"] = "Đã đăng ký." if item["registered"] else reason
        if item["status"] != "draft" or item["registered"]:
            result.append(item)
    return result


def student_tournament_detail(tournament_id: str, student_id: str, database: Path | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    detail = tournament_detail(tournament_id, path)
    with closing(_connect(path)) as db:
        student = db.execute("SELECT * FROM academy_students WHERE id=?", (student_id,)).fetchone()
        if student is None:
            raise LookupError("student")
        registration = db.execute(
            "SELECT active FROM academy_tournament_players WHERE tournament_id=? AND student_id=?",
            (tournament_id, student_id),
        ).fetchone()
    row = _get_tournament(tournament_id, path)
    assert row is not None
    eligible, reason = _eligibility(row, student, path)
    detail["registered"] = bool(registration and registration["active"])
    detail["eligible"] = eligible or detail["registered"]
    detail["eligibilityReason"] = "Đã đăng ký." if detail["registered"] else reason
    detail["myPairing"] = next((pair for pair in detail["pairings"] if student_id in {pair["whiteId"], pair["blackId"]}), None)
    return detail


def _translate_error(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail="Không tìm thấy dữ liệu giải đấu.")
    return HTTPException(status_code=409, detail=str(exc))


@admin_router.get("")
def admin_list_tournaments():
    return {"tournaments": list_tournaments()}


@admin_router.post("")
def admin_create_tournament(payload: CreateTournamentRequest):
    try:
        return create_tournament(payload)
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@admin_router.get("/{tournament_id}")
def admin_tournament_detail(tournament_id: str):
    try:
        return tournament_detail(tournament_id)
    except LookupError as exc:
        raise _translate_error(exc) from exc


@admin_router.patch("/{tournament_id}")
def admin_update_tournament(tournament_id: str, payload: UpdateTournamentRequest):
    try:
        return update_tournament(tournament_id, payload)
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@admin_router.post("/{tournament_id}/registration/open")
def admin_open_registration(tournament_id: str):
    try:
        return open_registration(tournament_id)
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@admin_router.post("/{tournament_id}/start")
def admin_start_tournament(tournament_id: str):
    try:
        return start_tournament(tournament_id)
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@admin_router.post("/{tournament_id}/rounds/next")
def admin_next_round(tournament_id: str):
    try:
        return next_round(tournament_id)
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@admin_router.post("/{tournament_id}/pairings/{pairing_id}/result")
def admin_pairing_result(tournament_id: str, pairing_id: str, payload: PairingResultRequest):
    try:
        return record_pairing_result(tournament_id, pairing_id, payload)
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@admin_router.post("/{tournament_id}/finish")
def admin_finish_tournament(tournament_id: str):
    try:
        return finish_tournament(tournament_id)
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@public_router.get("")
def public_list_tournaments(student: dict = Depends(require_student)):
    return {"tournaments": student_tournaments(student["id"])}


@public_router.get("/{tournament_id}")
def public_tournament_detail(tournament_id: str, student: dict = Depends(require_student)):
    try:
        return student_tournament_detail(tournament_id, student["id"])
    except LookupError as exc:
        raise _translate_error(exc) from exc


@public_router.post("/{tournament_id}/register")
def public_register(tournament_id: str, student: dict = Depends(require_student)):
    try:
        return register_student(tournament_id, student["id"])
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc


@public_router.delete("/{tournament_id}/register")
def public_unregister(tournament_id: str, student: dict = Depends(require_student)):
    try:
        return unregister_student(tournament_id, student["id"])
    except (ValueError, LookupError) as exc:
        raise _translate_error(exc) from exc
