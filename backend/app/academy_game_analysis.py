from __future__ import annotations

import hashlib
import queue
import sqlite3
import threading
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .academy import ACADEMY_DB, _connect, require_student
from .academy_tournament import ensure_tournament_schema
from .admin_auth import require_permission
from .game_analysis_engine import CATEGORY_META, SEVERITY_WEIGHT, analyze_pgn_stockfish, parse_pgn, resolve_engine_path

admin_router = APIRouter(prefix="/academy/game-analysis", dependencies=[Depends(require_permission("admin.write"))])
public_router = APIRouter(prefix="/api/academy/game-analysis")

_JOB_QUEUE: queue.Queue[tuple[str, int, str]] = queue.Queue()
_WORKER_LOCK = threading.Lock()
_WORKER_STARTED = False
_RECOVERY_LOCK = threading.Lock()
_RECOVERED_PATHS: set[str] = set()


class StartAnalysisRequest(BaseModel):
    depth: int = Field(default=12, ge=8, le=18)
    force: bool = False


def ensure_game_analysis_schema(database: Path | None = None) -> None:
    path = database or ACADEMY_DB
    ensure_tournament_schema(path)
    with closing(_connect(path)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS academy_game_analyses (
                id TEXT PRIMARY KEY,
                pairing_id TEXT NOT NULL UNIQUE,
                tournament_id TEXT NOT NULL,
                pgn_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                engine_depth INTEGER NOT NULL DEFAULT 12,
                moves_total INTEGER NOT NULL DEFAULT 0,
                moments_total INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created REAL NOT NULL,
                started REAL,
                completed REAL,
                FOREIGN KEY(pairing_id) REFERENCES academy_tournament_pairings(id) ON DELETE CASCADE,
                FOREIGN KEY(tournament_id) REFERENCES academy_tournaments(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS academy_game_moments (
                id TEXT PRIMARY KEY,
                analysis_id TEXT NOT NULL,
                pairing_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                ply INTEGER NOT NULL,
                move_no INTEGER NOT NULL,
                color TEXT NOT NULL,
                san TEXT NOT NULL,
                uci TEXT NOT NULL,
                fen_before TEXT NOT NULL,
                best_move_uci TEXT,
                best_line TEXT NOT NULL DEFAULT '',
                best_score_cp INTEGER NOT NULL,
                played_score_cp INTEGER NOT NULL,
                cp_loss INTEGER NOT NULL,
                severity TEXT NOT NULL,
                missed_win INTEGER NOT NULL DEFAULT 0,
                category TEXT NOT NULL,
                category_label TEXT NOT NULL,
                created REAL NOT NULL,
                FOREIGN KEY(analysis_id) REFERENCES academy_game_analyses(id) ON DELETE CASCADE,
                FOREIGN KEY(student_id) REFERENCES academy_students(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_academy_game_analysis_tournament ON academy_game_analyses(tournament_id,status,created DESC);
            CREATE INDEX IF NOT EXISTS idx_academy_game_moments_student ON academy_game_moments(student_id,created DESC);
            CREATE INDEX IF NOT EXISTS idx_academy_game_moments_analysis ON academy_game_moments(analysis_id,ply);
            """
        )
        db.commit()

    # Threads do not survive a process restart. Recover stale statuses once per DB.
    key = str(path.resolve())
    with _RECOVERY_LOCK:
        if key not in _RECOVERED_PATHS:
            with closing(_connect(path)) as db:
                db.execute(
                    "UPDATE academy_game_analyses SET status='failed',error=? WHERE status IN ('queued','running')",
                    ("Backend đã khởi động lại. Hãy chạy phân tích lại.",),
                )
                db.commit()
            _RECOVERED_PATHS.add(key)


def _pairing_row(pairing_id: str, database: Path) -> sqlite3.Row | None:
    with closing(_connect(database)) as db:
        return db.execute(
            """
            SELECT p.*,t.title tournament_title,sw.display_name white_name,sb.display_name black_name
            FROM academy_tournament_pairings p
            JOIN academy_tournaments t ON t.id=p.tournament_id
            JOIN academy_students sw ON sw.id=p.white_id
            JOIN academy_students sb ON sb.id=p.black_id
            WHERE p.id=? AND p.black_id IS NOT NULL
            """,
            (pairing_id,),
        ).fetchone()


def _analysis_payload(row: sqlite3.Row) -> dict[str, Any]:
    keys = set(row.keys())
    return {
        "id": str(row["id"]), "pairingId": str(row["pairing_id"]), "tournamentId": str(row["tournament_id"]),
        "tournamentTitle": row["tournament_title"] if "tournament_title" in keys else None,
        "round": int(row["round_no"]) if "round_no" in keys and row["round_no"] is not None else None,
        "board": int(row["board_no"]) if "board_no" in keys and row["board_no"] is not None else None,
        "whiteName": row["white_name"] if "white_name" in keys else None,
        "blackName": row["black_name"] if "black_name" in keys else None,
        "status": str(row["status"]), "depth": int(row["engine_depth"]),
        "moves": int(row["moves_total"]), "moments": int(row["moments_total"]), "error": row["error"],
        "createdAt": float(row["created"]),
        "startedAt": float(row["started"]) if row["started"] is not None else None,
        "completedAt": float(row["completed"]) if row["completed"] is not None else None,
    }


def queue_pairing_analysis(pairing_id: str, depth: int = 12, force: bool = False, database: Path | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_game_analysis_schema(path)
    pairing = _pairing_row(pairing_id, path)
    if pairing is None:
        raise LookupError("pairing")
    pgn = str(pairing["pgn"] or "").strip()
    if not pgn:
        raise ValueError("Bàn đấu chưa có PGN để phân tích.")
    parse_pgn(pgn)
    digest = hashlib.sha256(pgn.encode("utf-8")).hexdigest()
    now = time.time()
    with closing(_connect(path)) as db:
        old = db.execute("SELECT * FROM academy_game_analyses WHERE pairing_id=?", (pairing_id,)).fetchone()
        if old is not None and not force and old["pgn_hash"] == digest and old["status"] in {"queued", "running", "completed"}:
            return _analysis_payload(old)
        analysis_id = str(old["id"]) if old is not None else uuid.uuid4().hex
        if old is not None:
            db.execute("DELETE FROM academy_game_moments WHERE analysis_id=?", (analysis_id,))
            db.execute(
                "UPDATE academy_game_analyses SET tournament_id=?,pgn_hash=?,status='queued',engine_depth=?,moves_total=0,moments_total=0,error=NULL,created=?,started=NULL,completed=NULL WHERE id=?",
                (pairing["tournament_id"], digest, depth, now, analysis_id),
            )
        else:
            db.execute(
                "INSERT INTO academy_game_analyses(id,pairing_id,tournament_id,pgn_hash,status,engine_depth,created) VALUES(?,?,?,?, 'queued', ?, ?)",
                (analysis_id, pairing_id, pairing["tournament_id"], digest, depth, now),
            )
        db.commit()
        row = db.execute("SELECT * FROM academy_game_analyses WHERE id=?", (analysis_id,)).fetchone()
    _ensure_worker(path)
    _JOB_QUEUE.put((analysis_id, depth, str(path)))
    return _analysis_payload(row)


def _process_analysis(analysis_id: str, depth: int, database: Path) -> None:
    with closing(_connect(database)) as db:
        row = db.execute(
            "SELECT a.*,p.pgn,p.white_id,p.black_id FROM academy_game_analyses a JOIN academy_tournament_pairings p ON p.id=a.pairing_id WHERE a.id=?",
            (analysis_id,),
        ).fetchone()
        if row is None:
            return
        db.execute("UPDATE academy_game_analyses SET status='running',started=?,error=NULL WHERE id=?", (time.time(), analysis_id))
        db.commit()
    moves_total, moments = analyze_pgn_stockfish(str(row["pgn"]), str(row["white_id"]), str(row["black_id"]), depth)
    completed = time.time()
    with closing(_connect(database)) as db:
        db.execute("DELETE FROM academy_game_moments WHERE analysis_id=?", (analysis_id,))
        db.executemany(
            """INSERT INTO academy_game_moments(
                id,analysis_id,pairing_id,student_id,ply,move_no,color,san,uci,fen_before,best_move_uci,best_line,
                best_score_cp,played_score_cp,cp_loss,severity,missed_win,category,category_label,created
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(
                uuid.uuid4().hex, analysis_id, row["pairing_id"], item["studentId"], item["ply"], item["moveNo"], item["color"],
                item["san"], item["uci"], item["fenBefore"], item["bestMoveUci"], item["bestLine"], item["bestScoreCp"],
                item["playedScoreCp"], item["cpLoss"], item["severity"], 1 if item["missedWin"] else 0,
                item["category"], item["categoryLabel"], completed,
            ) for item in moments],
        )
        db.execute(
            "UPDATE academy_game_analyses SET status='completed',moves_total=?,moments_total=?,completed=?,error=NULL WHERE id=?",
            (moves_total, len(moments), completed, analysis_id),
        )
        db.commit()


def _worker_loop() -> None:
    while True:
        analysis_id, depth, path_text = _JOB_QUEUE.get()
        path = Path(path_text)
        try:
            _process_analysis(analysis_id, depth, path)
        except Exception as exc:
            with closing(_connect(path)) as db:
                db.execute("UPDATE academy_game_analyses SET status='failed',error=?,completed=? WHERE id=?", (str(exc)[:1000], time.time(), analysis_id))
                db.commit()
        finally:
            _JOB_QUEUE.task_done()


def _ensure_worker(database: Path) -> None:
    global _WORKER_STARTED
    with _WORKER_LOCK:
        if _WORKER_STARTED:
            return
        threading.Thread(target=_worker_loop, daemon=True, name="academy-game-analysis").start()
        _WORKER_STARTED = True


def pending_games(database: Path | None = None, limit: int = 200) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_game_analysis_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            """
            SELECT p.id pairing_id,p.tournament_id,p.round_no,p.board_no,p.result,p.pgn,t.title tournament_title,
                   sw.display_name white_name,sb.display_name black_name,a.status analysis_status,a.pgn_hash analysis_hash
            FROM academy_tournament_pairings p
            JOIN academy_tournaments t ON t.id=p.tournament_id
            JOIN academy_students sw ON sw.id=p.white_id JOIN academy_students sb ON sb.id=p.black_id
            LEFT JOIN academy_game_analyses a ON a.pairing_id=p.id
            WHERE p.black_id IS NOT NULL AND p.result!='pending' AND LENGTH(TRIM(p.pgn))>0
            ORDER BY t.updated DESC,p.round_no DESC,p.board_no LIMIT ?
            """, (limit,)
        ).fetchall()
    result = []
    for row in rows:
        digest = hashlib.sha256(str(row["pgn"]).strip().encode("utf-8")).hexdigest()
        result.append({
            "pairingId": str(row["pairing_id"]), "tournamentId": str(row["tournament_id"]), "tournamentTitle": str(row["tournament_title"]),
            "round": int(row["round_no"]), "board": int(row["board_no"]), "whiteName": str(row["white_name"]), "blackName": str(row["black_name"]),
            "result": str(row["result"]), "analysisStatus": str(row["analysis_status"]) if row["analysis_status"] else "not_started",
            "stale": bool(row["analysis_hash"] and row["analysis_hash"] != digest),
        })
    return result


def list_analyses(database: Path | None = None, limit: int = 100) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_game_analysis_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            """SELECT a.*,p.round_no,p.board_no,t.title tournament_title,sw.display_name white_name,sb.display_name black_name
            FROM academy_game_analyses a JOIN academy_tournament_pairings p ON p.id=a.pairing_id
            JOIN academy_tournaments t ON t.id=a.tournament_id JOIN academy_students sw ON sw.id=p.white_id JOIN academy_students sb ON sb.id=p.black_id
            ORDER BY a.created DESC LIMIT ?""", (limit,)
        ).fetchall()
    return [_analysis_payload(row) for row in rows]


def practical_profile(student_id: str, database: Path | None = None, limit_games: int = 20) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_game_analysis_schema(path)
    with closing(_connect(path)) as db:
        games = db.execute(
            """SELECT DISTINCT a.id,a.completed FROM academy_game_analyses a JOIN academy_tournament_pairings p ON p.id=a.pairing_id
            WHERE a.status='completed' AND (p.white_id=? OR p.black_id=?) ORDER BY a.completed DESC LIMIT ?""",
            (student_id, student_id, limit_games),
        ).fetchall()
        ids = [str(row["id"]) for row in games]
        if ids:
            marks = ",".join("?" for _ in ids)
            moments = db.execute(f"SELECT * FROM academy_game_moments WHERE student_id=? AND analysis_id IN ({marks})", (student_id, *ids)).fetchall()
        else:
            moments = []
    categories: dict[str, dict[str, Any]] = {}
    severity = {"inaccuracy": 0, "mistake": 0, "blunder": 0, "missedWin": 0}
    for row in moments:
        key = str(row["category"])
        item = categories.setdefault(key, {"category": key, "label": CATEGORY_META.get(key, {}).get("label", key), "theme": CATEGORY_META.get(key, {}).get("theme"), "count": 0, "weight": 0})
        item["count"] += 1
        item["weight"] += SEVERITY_WEIGHT.get(str(row["severity"]), 1) + (1 if row["missed_win"] else 0)
        severity[str(row["severity"])] = severity.get(str(row["severity"]), 0) + 1
        if row["missed_win"]: severity["missedWin"] += 1
    focus = sorted(categories.values(), key=lambda item: (-item["weight"], -item["count"], item["label"]))
    top = focus[0] if len(games) >= 2 and focus else None
    return {
        "gamesAnalyzed": len(games), "moments": len(moments), "severity": severity, "focusAreas": focus,
        "recommendation": ({"category": top["category"], "label": top["label"], "theme": top["theme"], "evidenceWeight": top["weight"], "reason": "Ưu tiên nhóm lỗi lặp lại trong các ván đã được Stockfish phân tích."} if top else None),
        "note": "Practical Profile phản ánh tình huống trong ván thật và không tự trừ Skill Mastery.",
    }


def student_games(student_id: str, database: Path | None = None, limit: int = 30) -> list[dict[str, Any]]:
    path = database or ACADEMY_DB
    ensure_game_analysis_schema(path)
    with closing(_connect(path)) as db:
        rows = db.execute(
            """SELECT a.*,p.round_no,p.board_no,p.white_id,p.black_id,p.result,t.title tournament_title,
                   sw.display_name white_name,sb.display_name black_name,SUM(CASE WHEN m.student_id=? THEN 1 ELSE 0 END) my_moments
            FROM academy_game_analyses a JOIN academy_tournament_pairings p ON p.id=a.pairing_id JOIN academy_tournaments t ON t.id=a.tournament_id
            JOIN academy_students sw ON sw.id=p.white_id JOIN academy_students sb ON sb.id=p.black_id LEFT JOIN academy_game_moments m ON m.analysis_id=a.id
            WHERE a.status='completed' AND (p.white_id=? OR p.black_id=?) GROUP BY a.id ORDER BY a.completed DESC LIMIT ?""",
            (student_id, student_id, student_id, limit),
        ).fetchall()
    return [{**_analysis_payload(row), "result": str(row["result"]), "myColor": "white" if str(row["white_id"]) == student_id else "black", "myMoments": int(row["my_moments"] or 0)} for row in rows]


def analysis_detail(analysis_id: str, student_id: str | None = None, database: Path | None = None) -> dict[str, Any]:
    path = database or ACADEMY_DB
    ensure_game_analysis_schema(path)
    with closing(_connect(path)) as db:
        row = db.execute(
            """SELECT a.*,p.round_no,p.board_no,p.white_id,p.black_id,p.result,t.title tournament_title,sw.display_name white_name,sb.display_name black_name
            FROM academy_game_analyses a JOIN academy_tournament_pairings p ON p.id=a.pairing_id JOIN academy_tournaments t ON t.id=a.tournament_id
            JOIN academy_students sw ON sw.id=p.white_id JOIN academy_students sb ON sb.id=p.black_id WHERE a.id=?""", (analysis_id,)
        ).fetchone()
        if row is None: raise LookupError("analysis")
        if student_id is not None and student_id not in {str(row["white_id"]), str(row["black_id"])}: raise PermissionError("analysis")
        if student_id is None:
            moments = db.execute("SELECT * FROM academy_game_moments WHERE analysis_id=? ORDER BY ply", (analysis_id,)).fetchall()
        else:
            moments = db.execute("SELECT * FROM academy_game_moments WHERE analysis_id=? AND student_id=? ORDER BY ply", (analysis_id, student_id)).fetchall()
    return {"analysis": {**_analysis_payload(row), "result": str(row["result"])}, "moments": [{
        "ply": int(m["ply"]), "moveNo": int(m["move_no"]), "color": str(m["color"]), "san": str(m["san"]), "uci": str(m["uci"]),
        "fenBefore": str(m["fen_before"]), "bestMoveUci": m["best_move_uci"], "bestLine": str(m["best_line"]),
        "bestScoreCp": int(m["best_score_cp"]), "playedScoreCp": int(m["played_score_cp"]), "cpLoss": int(m["cp_loss"]),
        "severity": str(m["severity"]), "missedWin": bool(m["missed_win"]), "category": str(m["category"]), "categoryLabel": str(m["category_label"]),
    } for m in moments]}


def _api_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=404 if isinstance(exc, (LookupError, PermissionError)) else 409, detail="Không tìm thấy dữ liệu phân tích phù hợp." if isinstance(exc, (LookupError, PermissionError)) else str(exc))


@admin_router.get("/overview")
def admin_overview():
    games, analyses = pending_games(limit=300), list_analyses(limit=300)
    return {"engineAvailable": bool(resolve_engine_path()), "gamesWithPgn": len(games), "notStarted": sum(x["analysisStatus"] == "not_started" for x in games), "stale": sum(x["stale"] for x in games), "running": sum(x["status"] in {"queued", "running"} for x in analyses), "failed": sum(x["status"] == "failed" for x in analyses), "completed": sum(x["status"] == "completed" for x in analyses)}


@admin_router.get("/games")
def admin_games(limit: int = Query(default=200, ge=1, le=500)):
    return {"games": pending_games(limit=limit), "analyses": list_analyses(limit=limit)}


@admin_router.post("/pairings/{pairing_id}/start")
def admin_start_pairing(pairing_id: str, payload: StartAnalysisRequest):
    try: return queue_pairing_analysis(pairing_id, payload.depth, payload.force)
    except (ValueError, LookupError) as exc: raise _api_error(exc) from exc


@admin_router.post("/tournaments/{tournament_id}/start")
def admin_start_tournament(tournament_id: str, payload: StartAnalysisRequest):
    games = [x for x in pending_games(limit=500) if x["tournamentId"] == tournament_id]
    queued = skipped = 0; errors: list[str] = []
    for item in games:
        try:
            old = item["analysisStatus"]
            queue_pairing_analysis(item["pairingId"], payload.depth, payload.force or item["stale"])
            if old in {"not_started", "failed"} or payload.force or item["stale"]: queued += 1
            else: skipped += 1
        except Exception as exc: errors.append(f"V{item['round']} B{item['board']}: {exc}")
    return {"queued": queued, "skipped": skipped, "errors": errors}


@admin_router.get("/analyses/{analysis_id}")
def admin_detail(analysis_id: str):
    try: return analysis_detail(analysis_id)
    except LookupError as exc: raise _api_error(exc) from exc


@public_router.get("/profile")
def student_profile(student: dict = Depends(require_student)):
    return practical_profile(str(student["id"]))


@public_router.get("/games")
def student_game_list(limit: int = Query(default=30, ge=1, le=100), student: dict = Depends(require_student)):
    return {"games": student_games(str(student["id"]), limit=limit)}


@public_router.get("/games/{analysis_id}")
def student_detail(analysis_id: str, student: dict = Depends(require_student)):
    try: return analysis_detail(analysis_id, str(student["id"]))
    except (LookupError, PermissionError) as exc: raise _api_error(exc) from exc
