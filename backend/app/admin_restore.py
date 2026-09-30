from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import stat
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .admin_auth import AdminPrincipal, require_permission
from .admin_maintenance import BACKUP_DIR, DATA_DIR, _find_backup, _include_path, create_backup
from .audit_store import safe_record_event

BACKUP_FORMAT = "chessapp-admin-backup-v1"
SCHEMA_REQUIREMENTS: dict[str, frozenset[str]] = {
    "collection.sqlite3": frozenset({"collection"}),
    "admin-users.sqlite3": frozenset({"admin_users", "admin_sessions"}),
    "admin-audit.sqlite3": frozenset({"audit_log"}),
    "lichess-puzzles.sqlite3": frozenset({"puzzles", "themes", "metadata"}),
}

router = APIRouter(prefix="/maintenance")


class RestoreBackupRequest(BaseModel):
    confirmation: str = Field(min_length=1, max_length=32)


class RestoreValidationError(ValueError):
    pass


class RestoreApplyError(RuntimeError):
    def __init__(self, message: str, *, rollback_ok: bool, pre_backup: dict[str, Any] | None = None):
        super().__init__(message)
        self.rollback_ok = rollback_ok
        self.pre_backup = pre_backup


def _safe_data_relative(archive_name: str, scope: str) -> Path:
    # ZIP uses POSIX separators. Backslashes/drive-like segments are rejected
    # explicitly because the target machine is commonly Windows.
    if "\\" in archive_name or "\x00" in archive_name:
        raise RestoreValidationError(f"Đường dẫn backup không an toàn: {archive_name}")
    pure = PurePosixPath(archive_name)
    if pure.is_absolute() or len(pure.parts) < 2 or pure.parts[0] != "data":
        raise RestoreValidationError(f"Đường dẫn backup không hợp lệ: {archive_name}")
    relative_pure = PurePosixPath(*pure.parts[1:])
    if any(part in {"", ".", ".."} or ":" in part for part in relative_pure.parts):
        raise RestoreValidationError(f"Đường dẫn backup không an toàn: {archive_name}")
    relative = Path(*relative_pure.parts)
    if not _include_path(relative, scope):
        raise RestoreValidationError(f"Backup chứa file ngoài scope {scope}: {archive_name}")
    return relative


def _is_zip_symlink(info: zipfile.ZipInfo) -> bool:
    mode = (info.external_attr >> 16) & 0xFFFF
    return bool(mode and stat.S_ISLNK(mode))


def _sqlite_schema(path: Path) -> tuple[bool, str, list[str]]:
    try:
        with closing(sqlite3.connect(path, timeout=15)) as db:
            quick = db.execute("PRAGMA quick_check").fetchone()
            if not quick or str(quick[0]).lower() != "ok":
                return False, str(quick[0]) if quick else "quick_check không có kết quả", []
            tables = {
                str(row[0])
                for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }
        required = SCHEMA_REQUIREMENTS.get(path.name, frozenset())
        missing = sorted(required - tables)
        if missing:
            return False, f"Thiếu table bắt buộc: {', '.join(missing)}", sorted(tables)
        return True, "ok", sorted(tables)
    except sqlite3.Error as exc:
        return False, str(exc), []


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, Any]:
    try:
        raw = archive.read("manifest.json")
        manifest = json.loads(raw.decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RestoreValidationError("Backup không có manifest.json hợp lệ.") from exc
    if not isinstance(manifest, dict) or manifest.get("format") != BACKUP_FORMAT:
        raise RestoreValidationError("Phiên bản backup không được hỗ trợ.")
    scope = str(manifest.get("scope") or "")
    if scope not in {"core", "full"}:
        raise RestoreValidationError("Backup scope không hợp lệ.")
    if not isinstance(manifest.get("entries"), list):
        raise RestoreValidationError("Manifest thiếu danh sách file.")
    return manifest


def _stage_archive(archive_path: Path, staging: Path) -> dict[str, Any]:
    staging.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, "r") as archive:
        manifest = _read_manifest(archive)
        scope = str(manifest["scope"])
        infos = {info.filename: info for info in archive.infolist() if not info.is_dir()}
        declared: set[str] = set()
        staged_files: list[dict[str, Any]] = []
        total_bytes = 0

        for entry in manifest["entries"]:
            if not isinstance(entry, dict):
                raise RestoreValidationError("Manifest chứa entry không hợp lệ.")
            archive_name = str(entry.get("path") or "")
            if archive_name in declared:
                raise RestoreValidationError(f"Manifest lặp file: {archive_name}")
            declared.add(archive_name)
            info = infos.get(archive_name)
            if info is None:
                raise RestoreValidationError(f"ZIP thiếu file đã khai báo: {archive_name}")
            if _is_zip_symlink(info):
                raise RestoreValidationError(f"Không chấp nhận symbolic link: {archive_name}")
            relative = _safe_data_relative(archive_name, scope)
            expected_bytes = entry.get("bytes")
            if isinstance(expected_bytes, int) and expected_bytes >= 0 and info.file_size != expected_bytes:
                raise RestoreValidationError(f"Kích thước file không khớp manifest: {archive_name}")

            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with archive.open(info, "r") as source, target.open("wb") as destination:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    destination.write(chunk)
            expected_sha = str(entry.get("sha256") or "").lower()
            actual_sha = digest.hexdigest()
            if expected_sha and expected_sha != actual_sha:
                raise RestoreValidationError(f"SHA-256 không khớp: {archive_name}")

            sqlite_tables: list[str] = []
            if target.suffix.lower() == ".sqlite3":
                ok, message, sqlite_tables = _sqlite_schema(target)
                if not ok:
                    raise RestoreValidationError(f"SQLite không hợp lệ ({archive_name}): {message}")

            total_bytes += int(target.stat().st_size)
            staged_files.append({
                "path": relative.as_posix(),
                "bytes": int(target.stat().st_size),
                "sha256": actual_sha,
                "sqlite": target.suffix.lower() == ".sqlite3",
                "tables": sqlite_tables,
            })

        extra_data_files = sorted(
            name for name in infos if name.startswith("data/") and name not in declared
        )
        if extra_data_files:
            raise RestoreValidationError("ZIP có file dữ liệu không được khai báo trong manifest.")
        declared_count = manifest.get("fileCount")
        if isinstance(declared_count, int) and declared_count != len(staged_files):
            raise RestoreValidationError("Số file trong manifest không khớp nội dung backup.")

    return {"manifest": manifest, "scope": scope, "files": staged_files, "totalBytes": total_bytes}


def _current_scope_files(data_root: Path, scope: str) -> set[str]:
    if not data_root.exists():
        return set()
    result: set[str] = set()
    for path in data_root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(data_root)
        if _include_path(relative, scope):
            result.add(relative.as_posix())
    return result


def build_restore_plan(
    backup_id: str,
    *,
    data_dir: Path | None = None,
    backup_dir: Path | None = None,
) -> dict[str, Any]:
    data_root = data_dir if data_dir is not None else DATA_DIR
    backups = backup_dir if backup_dir is not None else BACKUP_DIR
    archive_path = _find_backup(backup_id, backup_dir=backups)
    if archive_path is None:
        raise FileNotFoundError(backup_id)

    with tempfile.TemporaryDirectory(prefix="chessapp-restore-plan-") as temporary:
        staged = _stage_archive(archive_path, Path(temporary) / "data")
        scope = str(staged["scope"])
        restore_paths = {str(item["path"]) for item in staged["files"]}
        current_paths = _current_scope_files(data_root, scope)
        remove_paths = sorted(current_paths - restore_paths)
        existing_paths = sorted(current_paths & restore_paths)
        new_paths = sorted(restore_paths - current_paths)
        sqlite_files = [item for item in staged["files"] if item["sqlite"]]
        admin_db = "admin-users.sqlite3" in restore_paths
        puzzle_db = "lichess-puzzles.sqlite3" in restore_paths

    manifest = staged["manifest"]
    return {
        "backupId": str(manifest.get("backupId") or backup_id),
        "filename": archive_path.name,
        "format": str(manifest.get("format")),
        "scope": scope,
        "createdAt": float(manifest.get("createdAt") or archive_path.stat().st_mtime),
        "valid": True,
        "restoreFiles": len(restore_paths),
        "replaceFiles": len(existing_paths),
        "newFiles": len(new_paths),
        "removeFiles": len(remove_paths),
        "restoreBytes": int(staged["totalBytes"]),
        "includesPuzzleDb": puzzle_db,
        "willResetAdminSessions": admin_db,
        "preRestoreBackupScope": scope,
        "sqliteDatabases": [
            {"name": Path(str(item["path"])).name, "status": "ok", "tables": item["tables"]}
            for item in sqlite_files
        ],
        "restorePreview": sorted(restore_paths)[:20],
        "removePreview": remove_paths[:20],
        "warnings": [
            "Tất cả session account trong admin-users.sqlite3 sẽ bị thu hồi."
            if admin_db else "",
            "Full restore sẽ thay thế trạng thái Lichess Puzzle DB."
            if scope == "full" else "Core restore giữ nguyên Lichess Puzzle DB hiện tại.",
        ],
    }


def _clear_staged_sessions(staging: Path) -> bool:
    auth_db = staging / "admin-users.sqlite3"
    if not auth_db.exists():
        return False
    with closing(sqlite3.connect(auth_db, timeout=15)) as db:
        tables = {str(row[0]) for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "admin_sessions" not in tables:
            raise RestoreValidationError("admin-users.sqlite3 thiếu table admin_sessions.")
        db.execute("DELETE FROM admin_sessions")
        db.commit()
        result = db.execute("PRAGMA quick_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise RestoreValidationError("admin-users.sqlite3 lỗi sau khi thu hồi session.")
    return True


def _ensure_safe_destination(data_root: Path, relative: Path) -> None:
    current = data_root
    for part in relative.parts[:-1]:
        current = current / part
        if current.exists() and current.is_symlink():
            raise RestoreValidationError(f"Không restore qua thư mục symbolic link: {relative.as_posix()}")


def _apply_staged(staging: Path, data_root: Path, scope: str, restore_paths: set[str]) -> tuple[int, int]:
    current_paths = _current_scope_files(data_root, scope)
    remove_paths = sorted(current_paths - restore_paths, reverse=True)
    removed = 0
    restored = 0

    for relative_text in remove_paths:
        relative = Path(relative_text)
        _ensure_safe_destination(data_root, relative)
        destination = data_root / relative
        if destination.exists() and destination.is_file():
            destination.unlink()
            removed += 1

    for relative_text in sorted(restore_paths):
        relative = Path(relative_text)
        _ensure_safe_destination(data_root, relative)
        source = staging / relative
        if not source.is_file():
            raise RestoreValidationError(f"Staging thiếu file: {relative_text}")
        destination = data_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.restore-tmp")
        try:
            shutil.copy2(source, temporary)
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        restored += 1

    if data_root.exists():
        directories = sorted(
            (path for path in data_root.rglob("*") if path.is_dir()),
            key=lambda path: len(path.parts),
            reverse=True,
        )
        for directory in directories:
            try:
                relative = directory.relative_to(data_root)
                if relative.parts and relative.parts[0] == "backups":
                    continue
                directory.rmdir()
            except OSError:
                pass
    return restored, removed


def _apply_archive(
    archive_path: Path,
    *,
    data_root: Path,
    clear_sessions: bool,
    apply_func: Callable[[Path, Path, str, set[str]], tuple[int, int]] = _apply_staged,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="chessapp-restore-stage-") as temporary:
        staging = Path(temporary) / "data"
        staged = _stage_archive(archive_path, staging)
        reset_sessions = _clear_staged_sessions(staging) if clear_sessions else False
        restore_paths = {str(item["path"]) for item in staged["files"]}
        restored, removed = apply_func(staging, data_root, str(staged["scope"]), restore_paths)
        return {
            "scope": str(staged["scope"]),
            "restoredFiles": restored,
            "removedFiles": removed,
            "sessionsRevoked": reset_sessions,
        }


def restore_backup(
    backup_id: str,
    *,
    data_dir: Path | None = None,
    backup_dir: Path | None = None,
    actor: dict[str, Any] | None = None,
    apply_func: Callable[[Path, Path, str, set[str]], tuple[int, int]] = _apply_staged,
) -> dict[str, Any]:
    data_root = data_dir if data_dir is not None else DATA_DIR
    backups = backup_dir if backup_dir is not None else BACKUP_DIR
    archive_path = _find_backup(backup_id, backup_dir=backups)
    if archive_path is None:
        raise FileNotFoundError(backup_id)

    # A complete dry-run happens before any current data is mutated.
    plan = build_restore_plan(backup_id, data_dir=data_root, backup_dir=backups)
    safe_record_event(
        "POST maintenance/restore",
        "maintenance",
        backup_id,
        status="started",
        message="Restore started",
        details={"scope": plan["scope"], "filename": plan["filename"]},
        actor=actor,
    )
    safe_record_event(
        "POST maintenance/restore",
        "maintenance",
        backup_id,
        status="started",
        message="Restore validated",
        details={"restoreFiles": plan["restoreFiles"], "removeFiles": plan["removeFiles"]},
        actor=actor,
    )

    pre_backup = create_backup(str(plan["preRestoreBackupScope"]), data_dir=data_root, backup_dir=backups)
    pre_path = backups / str(pre_backup["filename"])
    try:
        result = _apply_archive(
            archive_path,
            data_root=data_root,
            clear_sessions=True,
            apply_func=apply_func,
        )
    except Exception as exc:
        try:
            _apply_archive(pre_path, data_root=data_root, clear_sessions=True)
            rollback_ok = True
        except Exception:
            rollback_ok = False
        safe_record_event(
            "POST maintenance/restore",
            "maintenance",
            backup_id,
            status="failure",
            message="Restore rolled back" if rollback_ok else "Restore failed; rollback also failed",
            details={"error": type(exc).__name__, "preRestoreBackupId": pre_backup["id"], "rollbackOk": rollback_ok},
            actor=actor,
        )
        raise RestoreApplyError(
            f"Restore thất bại: {exc}",
            rollback_ok=rollback_ok,
            pre_backup=pre_backup,
        ) from exc

    safe_record_event(
        "POST maintenance/restore",
        "maintenance",
        backup_id,
        status="success",
        message="Restore completed",
        details={
            "scope": result["scope"],
            "restoredFiles": result["restoredFiles"],
            "removedFiles": result["removedFiles"],
            "preRestoreBackupId": pre_backup["id"],
            "sessionsRevoked": result["sessionsRevoked"],
        },
        actor=actor,
    )
    return {
        "restored": True,
        "backupId": backup_id,
        "scope": result["scope"],
        "restoredFiles": result["restoredFiles"],
        "removedFiles": result["removedFiles"],
        "sessionsRevoked": result["sessionsRevoked"],
        "preRestoreBackup": pre_backup,
        "rollbackUsed": False,
    }


@router.get("/backups/{backup_id}/restore-plan")
def admin_restore_plan(
    backup_id: str,
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    del principal
    try:
        return build_restore_plan(backup_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy backup.") from exc
    except (OSError, RestoreValidationError, sqlite3.Error, zipfile.BadZipFile) as exc:
        raise HTTPException(status_code=409, detail=f"Backup không thể restore: {exc}") from exc


@router.post("/backups/{backup_id}/restore")
def admin_restore_backup(
    backup_id: str,
    payload: RestoreBackupRequest,
    principal: AdminPrincipal = Depends(require_permission("users.manage")),
):
    if payload.confirmation != "RESTORE":
        raise HTTPException(status_code=400, detail="Nhập chính xác RESTORE để xác nhận khôi phục dữ liệu.")
    try:
        result = restore_backup(backup_id, actor=principal.to_dict())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy backup.") from exc
    except (OSError, RestoreValidationError, sqlite3.Error, zipfile.BadZipFile, ValueError) as exc:
        raise HTTPException(status_code=409, detail=f"Backup không thể restore: {exc}") from exc
    except RestoreApplyError as exc:
        status = 500 if exc.rollback_ok else 503
        detail = f"{exc}. " + (
            "Dữ liệu đã rollback về trạng thái trước restore; account session có thể đã bị thu hồi."
            if exc.rollback_ok
            else "Rollback cũng thất bại; hãy dừng ghi dữ liệu và dùng pre-restore backup để phục hồi thủ công."
        )
        raise HTTPException(status_code=status, detail=detail) from exc
    result["reauthenticate"] = bool(result["sessionsRevoked"] and principal.auth_type == "account")
    return result
