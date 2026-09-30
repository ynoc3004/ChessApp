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
_LOCK = threading.RLock()


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
                details TEXT,
                actor_id TEXT,
                actor_name TEXT,
                actor_role TEXT,
                auth_type TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
            CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
            CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_log(status);
            """
        )
        columns = {str(row[1]) for row in db.execute("PRAGMA table_info(audit_log)").fetchall()}
        migrations = {
            "actor_id": "TEXT",
            "actor_name": "TEXT",
            "actor_role": "TEXT",
            "auth_type": "TEXT",
        }
        for name, column_type in migrations.items():
            if name not in columns:
                db.execute(f"ALTER TABLE audit_log ADD COLUMN {name} {column_type}")
        db.execute("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, actor_role)")
        db.commit()


def _actor_values(actor: dict[str, Any] | None) -> tuple[str | None, str | None, str | None, str | None]:
    if not actor:
        return None, None, None, None
    actor_id = str(actor.get("id") or "").strip() or None
    actor_name = str(actor.get("displayName") or actor.get("username") or "").strip() or None
    actor_role = str(actor.get("role") or "").strip() or None
    auth_type = str(actor.get("authType") or "").strip() or None
    return actor_id, actor_name, actor_role, auth_type


def record_event(
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    *,
    status: str = "success",
    message: str | None = None,
    details: dict[str, Any] | None = None,
    actor: dict[str, Any] | None = None,
    database: Path | None = None,
) -> int:
    if status not in {"success", "failure", "started"}:
        raise ValueError("Audit status không hợp lệ.")
    path = _database(database)
    ensure_schema(path)
    details_json = json.dumps(details or {}, ensure_ascii=False, separators=(",", ":"))
    actor_id, actor_name, actor_role, auth_type = _actor_values(actor)
    with _LOCK, closing(sqlite3.connect(path, timeout=5)) as db:
        cursor = db.execute(
            "INSERT INTO audit_log(created, action, resource_type, resource_id, status, message, details, "
            "actor_id, actor_name, actor_role, auth_type) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                time.time(),
                action,
                resource_type,
                resource_id,
                status,
                message,
                details_json,
                actor_id,
                actor_name,
                actor_role,
                auth_type,
            ),
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
    actor: dict[str, Any] | None = None,
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
            actor=actor,
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
        clauses.append(
            "(action LIKE ? OR resource_type LIKE ? OR COALESCE(resource_id,'') LIKE ? "
            "OR COALESCE(message,'') LIKE ? OR COALESCE(actor_name,'') LIKE ? "
            "OR COALESCE(actor_role,'') LIKE ?)"
        )
        params.extend([needle, needle, needle, needle, needle, needle])
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
            "SELECT id, created, action, resource_type, resource_id, status, message, details, "
            "actor_id, actor_name, actor_role, auth_type "
            f"FROM audit_log{where} ORDER BY created DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()

    events = []
    for row in rows:
        try:
            details = json.loads(row[7] or "{}")
        except json.JSONDecodeError:
            details = {}
        actor = None
        if any(row[index] is not None for index in range(8, 12)):
            actor = {
                "id": row[8],
                "displayName": row[9],
                "role": row[10],
                "authType": row[11],
            }
        events.append({
            "id": int(row[0]),
            "createdAt": float(row[1]),
            "action": row[2],
            "resourceType": row[3],
            "resourceId": row[4],
            "status": row[5],
            "message": row[6],
            "details": details if isinstance(details, dict) else {},
            "actor": actor,
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
        actors = db.execute(
            "SELECT COALESCE(actor_name, 'Không xác định'), COUNT(*) FROM audit_log "
            "GROUP BY COALESCE(actor_name, 'Không xác định') ORDER BY COUNT(*) DESC, actor_name LIMIT 8"
        ).fetchall()
    return {
        "total": total,
        "success": success,
        "failure": failure,
        "last24Hours": last_day,
        "topActions": [{"name": row[0], "count": int(row[1])} for row in actions],
        "topResources": [{"name": row[0], "count": int(row[1])} for row in resources],
        "topActors": [{"name": row[0], "count": int(row[1])} for row in actors],
        "databaseBytes": path.stat().st_size if path.exists() else 0,
    }
