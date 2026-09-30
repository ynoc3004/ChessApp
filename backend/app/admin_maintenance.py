from __future__ import annotations

import json
import re
import sqlite3
import tempfile
import time
import uuid
import zipfile
from contextlib import closing
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .admin_auth import require_permission

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
BACKUP_DIR = DATA_DIR / "backups"
BACKUP_ID_RE = re.compile(r"^[0-9a-f]{12}$")
EXPECTED_DATABASES = (
    "collection.sqlite3",
    "admin-users.sqlite3",
    "admin-audit.sqlite3",
    "lichess-puzzles.sqlite3",
)

router = APIRouter(
    prefix="/maintenance",
    dependencies=[Depends(require_permission("system.read"))],
)


class CreateBackupRequest(BaseModel):
    scope: Literal["core", "full"] = "core"


class PruneBackupsRequest(BaseModel):
    keep: int = Field(default=5, ge=1, le=50)


def _backup_dir(path: Path | None = None) -> Path:
    target = path if path is not None else BACKUP_DIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def _is_sqlite_sidecar(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith((".sqlite3-wal", ".sqlite3-shm", ".sqlite3-journal"))


def _include_path(relative: Path, scope: str) -> bool:
    parts = relative.parts
    if not parts:
        return False
    if parts[0] == "backups":
        return False
    if _is_sqlite_sidecar(relative):
        return False
    if scope == "core" and relative.as_posix() == "lichess-puzzles.sqlite3":
        return False
    return True


def _sqlite_snapshot(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(source, timeout=15)) as src, closing(sqlite3.connect(destination, timeout=15)) as dst:
        src.backup(dst)
        result = dst.execute("PRAGMA quick_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise sqlite3.DatabaseError(f"SQLite quick_check thất bại cho {source.name}.")


def _zip_file(archive: zipfile.ZipFile, source: Path, archive_name: str) -> int:
    archive.write(source, archive_name)
    return int(source.stat().st_size)


def create_backup(
    scope: str = "core",
    *,
    data_dir: Path | None = None,
    backup_dir: Path | None = None,
) -> dict[str, Any]:
    if scope not in {"core", "full"}:
        raise ValueError("Backup scope không hợp lệ.")

    data_root = data_dir if data_dir is not None else DATA_DIR
    backups = _backup_dir(backup_dir)
    created_at = time.time()
    backup_id = uuid.uuid4().hex[:12]
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(created_at))
    filename = f"chessapp-backup-{stamp}-{scope}-{backup_id}.zip"
    final_path = backups / filename
    temp_path = backups / f".{filename}.tmp"

    entries: list[dict[str, Any]] = []
    content_bytes = 0

    try:
        with tempfile.TemporaryDirectory(prefix="chessapp-backup-") as temporary:
            snapshot_root = Path(temporary)
            with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
                if data_root.exists():
                    for source in sorted(data_root.rglob("*")):
                        if not source.is_file():
                            continue
                        relative = source.relative_to(data_root)
                        if not _include_path(relative, scope):
                            continue

                        archive_name = f"data/{relative.as_posix()}"
                        sqlite_snapshot = source.suffix.lower() == ".sqlite3"
                        actual_source = source
                        if sqlite_snapshot:
                            actual_source = snapshot_root / relative
                            _sqlite_snapshot(source, actual_source)

                        size = _zip_file(archive, actual_source, archive_name)
                        content_bytes += size
                        entries.append({
                            "path": archive_name,
                            "bytes": size,
                            "sqliteSnapshot": sqlite_snapshot,
                        })

                manifest = {
                    "format": "chessapp-admin-backup-v1",
                    "createdAt": created_at,
                    "scope": scope,
                    "backupId": backup_id,
                    "fileCount": len(entries),
                    "contentBytes": content_bytes,
                    "includesPuzzleDb": scope == "full",
                    "entries": entries,
                }
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

        temp_path.replace(final_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    return {
        "id": backup_id,
        "filename": filename,
        "createdAt": created_at,
        "scope": scope,
        "fileCount": len(entries),
        "contentBytes": content_bytes,
        "archiveBytes": int(final_path.stat().st_size),
        "includesPuzzleDb": scope == "full",
        "valid": True,
    }


def _read_backup(path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path, "r") as archive:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        if not isinstance(manifest, dict) or manifest.get("format") != "chessapp-admin-backup-v1":
            raise ValueError("manifest không hợp lệ")
        return {
            "id": str(manifest.get("backupId") or ""),
            "filename": path.name,
            "createdAt": float(manifest.get("createdAt") or path.stat().st_mtime),
            "scope": str(manifest.get("scope") or "unknown"),
            "fileCount": int(manifest.get("fileCount") or 0),
            "contentBytes": int(manifest.get("contentBytes") or 0),
            "archiveBytes": int(path.stat().st_size),
            "includesPuzzleDb": bool(manifest.get("includesPuzzleDb")),
            "valid": True,
        }
    except (OSError, ValueError, KeyError, json.JSONDecodeError, zipfile.BadZipFile):
        match = re.search(r"-([0-9a-f]{12})\.zip$", path.name)
        return {
            "id": match.group(1) if match else path.stem,
            "filename": path.name,
            "createdAt": path.stat().st_mtime if path.exists() else 0,
            "scope": "unknown",
            "fileCount": 0,
            "contentBytes": 0,
            "archiveBytes": int(path.stat().st_size) if path.exists() else 0,
            "includesPuzzleDb": False,
            "valid": False,
        }


def list_backups(*, backup_dir: Path | None = None) -> list[dict[str, Any]]:
    backups = _backup_dir(backup_dir)
    rows = [_read_backup(path) for path in backups.glob("chessapp-backup-*.zip") if path.is_file()]
    rows.sort(key=lambda item: float(item["createdAt"]), reverse=True)
    return rows


def _find_backup(backup_id: str, *, backup_dir: Path | None = None) -> Path | None:
    if not BACKUP_ID_RE.fullmatch(backup_id):
        return None
    backups = _backup_dir(backup_dir)
    matches = [path for path in backups.glob(f"chessapp-backup-*-{backup_id}.zip") if path.is_file()]
    return matches[0] if len(matches) == 1 else None


def delete_backup(backup_id: str, *, backup_dir: Path | None = None) -> bool:
    path = _find_backup(backup_id, backup_dir=backup_dir)
    if path is None:
        return False
    path.unlink()
    return True


def prune_backups(keep: int, *, backup_dir: Path | None = None) -> list[str]:
    if keep < 1:
        raise ValueError("Phải giữ lại ít nhất một backup.")
    rows = list_backups(backup_dir=backup_dir)
    removed: list[str] = []
    for row in rows[keep:]:
        backup_id = str(row["id"])
        if BACKUP_ID_RE.fullmatch(backup_id) and delete_backup(backup_id, backup_dir=backup_dir):
            removed.append(backup_id)
    return removed


def sqlite_integrity(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "name": path.name,
            "exists": False,
            "status": "missing",
            "message": "Chưa có database.",
            "bytes": 0,
        }
    started = time.perf_counter()
    try:
        with closing(sqlite3.connect(path, timeout=15)) as db:
            row = db.execute("PRAGMA quick_check").fetchone()
        message = str(row[0]) if row else "Không có kết quả"
        ok = message.lower() == "ok"
        return {
            "name": path.name,
            "exists": True,
            "status": "ok" if ok else "error",
            "message": message,
            "bytes": int(path.stat().st_size),
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
        }
    except (OSError, sqlite3.Error) as exc:
        return {
            "name": path.name,
            "exists": True,
            "status": "error",
            "message": str(exc),
            "bytes": int(path.stat().st_size) if path.exists() else 0,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
        }


def integrity_report(*, data_dir: Path | None = None) -> dict[str, Any]:
    data_root = data_dir if data_dir is not None else DATA_DIR
    databases = [sqlite_integrity(data_root / name) for name in EXPECTED_DATABASES]
    existing = [item for item in databases if item["exists"]]
    errors = [item for item in existing if item["status"] != "ok"]
    return {
        "healthy": len(errors) == 0,
        "checked": len(existing),
        "errors": len(errors),
        "databases": databases,
        "checkedAt": time.time(),
    }


def maintenance_summary() -> dict[str, Any]:
    backups = list_backups()
    return {
        "backups": backups,
        "backupCount": len(backups),
        "backupBytes": sum(int(item["archiveBytes"]) for item in backups),
        "latestBackupAt": backups[0]["createdAt"] if backups else None,
        "coreExcludesPuzzleDb": True,
    }


@router.get("")
def admin_maintenance_summary():
    return maintenance_summary()


@router.post("/backups")
def admin_create_backup(payload: CreateBackupRequest):
    try:
        return create_backup(payload.scope)
    except (OSError, sqlite3.Error, zipfile.BadZipFile, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Không tạo được backup: {exc}") from exc


@router.get("/backups/{backup_id}/download")
def admin_download_backup(backup_id: str):
    path = _find_backup(backup_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy backup.")
    return FileResponse(path, media_type="application/zip", filename=path.name)


@router.delete("/backups/{backup_id}")
def admin_delete_backup(backup_id: str):
    if not delete_backup(backup_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy backup.")
    return {"deleted": True, "backupId": backup_id}


@router.post("/backups/prune")
def admin_prune_backups(payload: PruneBackupsRequest):
    removed = prune_backups(payload.keep)
    return {"removed": removed, "count": len(removed), "keep": payload.keep}


@router.post("/integrity")
def admin_integrity_check():
    return integrity_report()
