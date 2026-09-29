from __future__ import annotations

import hmac
import json
import os
import platform
import re
import shutil
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import FileResponse

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "positions"
LEARNING_DIR = DATA_DIR / "learning_corrections"
PUZZLES_DB = DATA_DIR / "lichess-puzzles.sqlite3"
PUZZLES_SOURCE = DATA_DIR / "lichess-puzzles-source.json"
COLLECTION_DB = DATA_DIR / "collection.sqlite3"
BOOK_METADATA = "book.json"
JOB_STATUS = "status.json"
STARTED_AT = time.time()

UPDATE_LOCK = threading.Lock()
UPDATE_STATE: dict[str, object] = {
    "running": False,
    "startedAt": None,
    "finishedAt": None,
    "error": None,
    "changed": None,
}


def require_admin(authorization: str | None = Header(default=None)) -> None:
    configured = os.getenv("CHESSAPP_ADMIN_TOKEN", "").strip()
    if not configured:
        raise HTTPException(
            status_code=503,
            detail="Admin chưa được cấu hình. Hãy đặt biến CHESSAPP_ADMIN_TOKEN rồi khởi động lại backend.",
        )
    prefix = "Bearer "
    supplied = authorization[len(prefix):].strip() if authorization and authorization.startswith(prefix) else ""
    if not supplied or not hmac.compare_digest(supplied, configured):
        raise HTTPException(status_code=401, detail="Mã quản trị không đúng.")


router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def source_file(job_id: str) -> Path | None:
    for candidate in UPLOAD_DIR.glob(f"{job_id}.*"):
        if candidate.is_file():
            return candidate
    return None


def valid_job_id(job_id: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{32}", job_id))


def collect_books() -> list[dict]:
    books: list[dict] = []
    if not OUTPUT_DIR.exists():
        return books
    for job_dir in OUTPUT_DIR.iterdir():
        if not job_dir.is_dir() or not valid_job_id(job_dir.name):
            continue
        metadata_path = job_dir / BOOK_METADATA
        status_path = job_dir / JOB_STATUS
        metadata = read_json(metadata_path) if metadata_path.exists() else {}
        status = read_json(status_path) if status_path.exists() else {}
        if not metadata and not status:
            continue
        source = source_file(job_dir.name)
        updated_candidates = [path for path in (metadata_path, status_path) if path.exists()]
        updated_at = max((path.stat().st_mtime for path in updated_candidates), default=0.0)
        state = status.get("status") or ("completed" if metadata else "unknown")
        books.append({
            "jobId": job_dir.name,
            "filename": metadata.get("filename") or status.get("filename") or (source.name if source else "Không rõ"),
            "count": int(metadata.get("count", status.get("count", 0)) or 0),
            "status": state,
            "progress": float(status.get("progress", 100 if state == "completed" else 0) or 0),
            "error": status.get("error"),
            "updatedAt": updated_at,
            "sourceBytes": source.stat().st_size if source else 0,
            "dataBytes": directory_size(job_dir),
        })
    books.sort(key=lambda item: item["updatedAt"], reverse=True)
    return books


def puzzle_stats() -> dict:
    result = {
        "ready": False,
        "count": 0,
        "ratingMin": None,
        "ratingMax": None,
        "themeCount": 0,
        "databaseBytes": PUZZLES_DB.stat().st_size if PUZZLES_DB.exists() else 0,
        "updatedAt": PUZZLES_DB.stat().st_mtime if PUZZLES_DB.exists() else None,
        "source": read_json(PUZZLES_SOURCE) if PUZZLES_SOURCE.exists() else {},
        "topThemes": [],
        "ratingBuckets": [],
    }
    if not PUZZLES_DB.exists():
        return result
    try:
        with closing(sqlite3.connect(PUZZLES_DB, timeout=5)) as db:
            count, rating_min, rating_max = db.execute(
                "SELECT COUNT(*), MIN(rating), MAX(rating) FROM puzzles"
            ).fetchone()
            theme_count = db.execute("SELECT COUNT(DISTINCT theme) FROM themes").fetchone()[0]
            top_themes = db.execute(
                "SELECT theme, COUNT(*) AS total FROM themes GROUP BY theme ORDER BY total DESC, theme LIMIT 12"
            ).fetchall()
            buckets = db.execute(
                "SELECT CAST(rating / 200 AS INTEGER) * 200 AS bucket, COUNT(*) FROM puzzles GROUP BY bucket ORDER BY bucket"
            ).fetchall()
        result.update({
            "ready": True,
            "count": int(count or 0),
            "ratingMin": rating_min,
            "ratingMax": rating_max,
            "themeCount": int(theme_count or 0),
            "topThemes": [{"theme": row[0], "count": int(row[1])} for row in top_themes],
            "ratingBuckets": [{"rating": int(row[0]), "count": int(row[1])} for row in buckets],
        })
    except sqlite3.Error as exc:
        result["error"] = str(exc)
    return result


def collection_count() -> int:
    if not COLLECTION_DB.exists():
        return 0
    try:
        with closing(sqlite3.connect(COLLECTION_DB, timeout=5)) as db:
            return int(db.execute("SELECT COUNT(*) FROM collection").fetchone()[0])
    except sqlite3.Error:
        return 0


def stockfish_status() -> dict:
    configured = os.getenv("STOCKFISH_PATH", "").strip()
    configured_path = Path(configured) if configured else None
    if configured_path and configured_path.exists():
        return {"available": True, "source": "STOCKFISH_PATH", "path": str(configured_path)}
    discovered = shutil.which("stockfish")
    return {"available": bool(discovered), "source": "PATH" if discovered else None, "path": discovered}


def collection_items() -> list[dict]:
    if not COLLECTION_DB.exists():
        return []
    try:
        with closing(sqlite3.connect(COLLECTION_DB, timeout=5)) as db:
            rows = db.execute("SELECT id, payload, updated FROM collection ORDER BY updated DESC").fetchall()
        items = []
        for item_id, payload, updated in rows:
            try:
                item = json.loads(payload)
            except (TypeError, json.JSONDecodeError):
                item = {"id": item_id, "title": "Dữ liệu lỗi"}
            item["updatedAt"] = updated
            items.append(item)
        return items
    except sqlite3.Error:
        return []


@router.get("/session")
def admin_session():
    return {"ok": True}


@router.get("/stats")
def admin_stats():
    books = collect_books()
    puzzles = puzzle_stats()
    corrections = len(list(LEARNING_DIR.glob("*.json"))) if LEARNING_DIR.exists() else 0
    statuses = {"queued": 0, "processing": 0, "completed": 0, "failed": 0, "unknown": 0}
    for book in books:
        state = str(book["status"])
        statuses[state if state in statuses else "unknown"] += 1
    return {
        "books": len(books),
        "diagrams": sum(int(book["count"]) for book in books),
        "bookStatuses": statuses,
        "collection": collection_count(),
        "corrections": corrections,
        "puzzles": puzzles["count"],
        "puzzleReady": puzzles["ready"],
        "stockfish": stockfish_status(),
        "storageBytes": directory_size(DATA_DIR),
        "uptimeSeconds": max(0, int(time.time() - STARTED_AT)),
    }


@router.get("/books")
def admin_books():
    return {"books": collect_books()}


@router.delete("/books/{job_id}")
def admin_delete_book(job_id: str):
    if not valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="Job ID không hợp lệ.")
    job_dir = OUTPUT_DIR / job_id
    uploads = list(UPLOAD_DIR.glob(f"{job_id}.*")) if UPLOAD_DIR.exists() else []
    if not job_dir.exists() and not uploads:
        raise HTTPException(status_code=404, detail="Không tìm thấy kỳ phổ.")
    if job_dir.exists():
        shutil.rmtree(job_dir)
    for upload in uploads:
        try:
            upload.unlink()
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Không xóa được file nguồn: {exc}") from exc
    return {"deleted": True, "jobId": job_id}


@router.get("/puzzles/stats")
def admin_puzzle_stats():
    return puzzle_stats()


def run_puzzle_update() -> None:
    try:
        from scripts.update_lichess_puzzles import update_database

        changed = bool(update_database())
        UPDATE_STATE.update(changed=changed, error=None)
    except Exception as exc:  # pragma: no cover - network/runtime dependent
        UPDATE_STATE.update(error=str(exc), changed=False)
    finally:
        UPDATE_STATE.update(running=False, finishedAt=time.time())
        UPDATE_LOCK.release()


@router.get("/puzzles/update")
def puzzle_update_status():
    return dict(UPDATE_STATE)


@router.post("/puzzles/update")
def start_puzzle_update():
    if not UPDATE_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Database Lichess đang được cập nhật.")
    UPDATE_STATE.update(running=True, startedAt=time.time(), finishedAt=None, error=None, changed=None)
    threading.Thread(target=run_puzzle_update, daemon=True, name="admin-lichess-update").start()
    return dict(UPDATE_STATE)


@router.get("/corrections")
def admin_corrections(limit: int = Query(default=100, ge=1, le=500)):
    rows = []
    if LEARNING_DIR.exists():
        files = sorted(LEARNING_DIR.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
        for path in files[:limit]:
            data = read_json(path)
            if not data:
                continue
            rows.append({
                "sampleId": data.get("sampleId") or path.stem,
                "jobId": data.get("jobId"),
                "positionId": data.get("positionId"),
                "correctedFen": data.get("correctedFen"),
                "aiFen": data.get("aiFen"),
                "recognizer": data.get("recognizer"),
                "preprocessVariant": data.get("preprocessVariant"),
                "imageOrientation": data.get("imageOrientation"),
                "savedAt": data.get("savedAt") or path.stat().st_mtime,
                "hasImage": bool(data.get("image") and (LEARNING_DIR / str(data.get("image"))).exists()),
            })
    return {"corrections": rows, "total": len(list(LEARNING_DIR.glob("*.json"))) if LEARNING_DIR.exists() else 0}


@router.get("/corrections/{sample_id}/image")
def admin_correction_image(sample_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}-\d{4}", sample_id):
        raise HTTPException(status_code=400, detail="Sample ID không hợp lệ.")
    metadata = read_json(LEARNING_DIR / f"{sample_id}.json")
    image_name = metadata.get("image")
    image_path = LEARNING_DIR / str(image_name) if image_name else LEARNING_DIR / f"{sample_id}.png"
    if not image_path.exists() or image_path.parent != LEARNING_DIR:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh correction.")
    return FileResponse(image_path, media_type="image/png", filename=image_path.name)


@router.delete("/corrections/{sample_id}")
def admin_delete_correction(sample_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}-\d{4}", sample_id):
        raise HTTPException(status_code=400, detail="Sample ID không hợp lệ.")
    metadata_path = LEARNING_DIR / f"{sample_id}.json"
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy correction.")
    metadata = read_json(metadata_path)
    image_name = metadata.get("image")
    candidates = [metadata_path]
    if image_name and Path(str(image_name)).name == str(image_name):
        candidates.append(LEARNING_DIR / str(image_name))
    else:
        candidates.append(LEARNING_DIR / f"{sample_id}.png")
    for path in candidates:
        if path.exists():
            path.unlink()
    return {"deleted": True, "sampleId": sample_id}


@router.get("/collection")
def admin_collection():
    return {"items": collection_items()}


@router.delete("/collection/{item_id}")
def admin_delete_collection_item(item_id: str):
    if not COLLECTION_DB.exists():
        raise HTTPException(status_code=404, detail="Tàng Kinh Các đang trống.")
    try:
        with closing(sqlite3.connect(COLLECTION_DB, timeout=5)) as db:
            deleted = db.execute("DELETE FROM collection WHERE id=?", (item_id,)).rowcount
            db.commit()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail=f"Không cập nhật được Tàng Kinh Các: {exc}") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy thế cờ.")
    return {"deleted": True, "id": item_id}


@router.get("/system")
def admin_system():
    return {
        "backend": {"online": True, "uptimeSeconds": max(0, int(time.time() - STARTED_AT))},
        "stockfish": stockfish_status(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "dataDirectory": str(DATA_DIR),
        "storageBytes": directory_size(DATA_DIR),
        "booksBytes": directory_size(OUTPUT_DIR) + directory_size(UPLOAD_DIR),
        "puzzleBytes": PUZZLES_DB.stat().st_size if PUZZLES_DB.exists() else 0,
        "correctionBytes": directory_size(LEARNING_DIR),
        "adminConfigured": bool(os.getenv("CHESSAPP_ADMIN_TOKEN", "").strip()),
        "puzzleUpdate": dict(UPDATE_STATE),
    }
