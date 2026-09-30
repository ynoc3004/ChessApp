from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
AUDIT_DB = DATA_DIR / "admin-audit.sqlite3"
_LOCK = threading.Lock()


def _database(database: Path | None = None) -> Path:
    return database if database is not None else AUDIT_DB


def ensure_schema(database: Path | None = None) -> None:
    path = _database(database)
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, closing(sqlite3.connect(path, timeout=5)) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created REAL NOT NULL,
                action TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT,
                status TEXT NOT NULL,
                message TEXT,
                details TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
            CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
            CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_log(status);
            """
        )
        db.commit()


def record_event(
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    *,
    status: str = "success",
    message: str | None = None,
    details: dict[str, Any] | None = None,
    database: Path | None = None,
) -> int:
    if status not in {"success", "failure", "started"}:
        raise ValueError("Audit status không hợp lệ.")
    path = _database(database)
    ensure_schema(path)
    details_json = json.dumps(details or {}, ensure_ascii=False, separators=(",", ":"))
    with _LOCK, closing(sqlite3.connect(path, timeout=5)) as db:
        cursor = db.execute(
            "INSERT INTO audit_log(created, action, resource_type, resource_id, status, message, details) "
            "VALUES(?,?,?,?,?,?,?)",
            (time.time(), action, resource_type, resource_id, status, message, details_json),
        )
        db.commit()
        return int(cursor.lastrowid)


def safe_record_event(
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    *,
    status: str = "success",
    message: str | None = None,
    details: dict[str, Any] | None = None,
) -> bool:
    """Audit must never break the admin action it observes."""
    try:
        record_event(
            action,
            resource_type,
            resource_id,
            status=status,
            message=message,
            details=details,
        )
        return True
    except (OSError, sqlite3.Error, ValueError, TypeError):
        return False


def list_events(
    *,
    limit: int = 100,
    offset: int = 0,
    q: str = "",
    action: str = "",
    resource_type: str = "",
    status: str = "",
    database: Path | None = None,
) -> dict[str, Any]:
    path = _database(database)
    ensure_schema(path)
    clauses: list[str] = []
    params: list[Any] = []

    if q.strip():
        needle = f"%{q.strip()}%"
        clauses.append("(action LIKE ? OR resource_type LIKE ? OR COALESCE(resource_id,'') LIKE ? OR COALESCE(message,'') LIKE ?)")
        params.extend([needle, needle, needle, needle])
    if action.strip():
        clauses.append("action = ?")
        params.append(action.strip())
    if resource_type.strip():
        clauses.append("resource_type = ?")
        params.append(resource_type.strip())
    if status.strip():
        clauses.append("status = ?")
        params.append(status.strip())

    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with closing(sqlite3.connect(path, timeout=5)) as db:
        total = int(db.execute(f"SELECT COUNT(*) FROM audit_log{where}", params).fetchone()[0])
        rows = db.execute(
            "SELECT id, created, action, resource_type, resource_id, status, message, details "
            f"FROM audit_log{where} ORDER BY created DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()

    events = []
    for row in rows:
        try:
            details = json.loads(row[7] or "{}")
        except json.JSONDecodeError:
            details = {}
        events.append({
            "id": int(row[0]),
            "createdAt": float(row[1]),
            "action": row[2],
            "resourceType": row[3],
            "resourceId": row[4],
            "status": row[5],
            "message": row[6],
            "details": details if isinstance(details, dict) else {},
        })
    return {"events": events, "total": total, "limit": limit, "offset": offset}


def audit_stats(database: Path | None = None) -> dict[str, Any]:
    path = _database(database)
    ensure_schema(path)
    cutoff = time.time() - 86400
    with closing(sqlite3.connect(path, timeout=5)) as db:
        total = int(db.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0])
        success = int(db.execute("SELECT COUNT(*) FROM audit_log WHERE status='success'").fetchone()[0])
        failure = int(db.execute("SELECT COUNT(*) FROM audit_log WHERE status='failure'").fetchone()[0])
        last_day = int(db.execute("SELECT COUNT(*) FROM audit_log WHERE created>=?", (cutoff,)).fetchone()[0])
        actions = db.execute(
            "SELECT action, COUNT(*) FROM audit_log GROUP BY action ORDER BY COUNT(*) DESC, action LIMIT 12"
        ).fetchall()
        resources = db.execute(
            "SELECT resource_type, COUNT(*) FROM audit_log GROUP BY resource_type ORDER BY COUNT(*) DESC, resource_type LIMIT 8"
        ).fetchall()
    return {
        "total": total,
        "success": success,
        "failure": failure,
        "last24Hours": last_day,
        "topActions": [{"name": row[0], "count": int(row[1])} for row in actions],
        "topResources": [{"name": row[0], "count": int(row[1])} for row in resources],
        "databaseBytes": path.stat().st_size if path.exists() else 0,
    }
