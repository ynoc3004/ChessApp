"""Optional puzzle training and collection; book scanning stays independent."""
from contextlib import closing
from pathlib import Path
import json
import random
import sqlite3
import time
import chess
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .admin import router as admin_router
from .admin_audit import wrap_admin_routes
from .admin_auth import public_router as admin_auth_public_router
from .admin_security import router as admin_security_router
from .scanner_v2 import router as scanner_v2_router

DATA = Path(__file__).resolve().parent.parent / "data"
PUZZLES = DATA / "lichess-puzzles.sqlite3"
COLLECTION = DATA / "collection.sqlite3"
router = APIRouter(prefix="/api")


def collection_db():
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(COLLECTION, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS collection (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated REAL NOT NULL)")
    return db


@router.get("/puzzles/status")
def puzzle_status():
    if not PUZZLES.exists():
        return {"ready": False, "count": 0}
    with closing(sqlite3.connect(PUZZLES)) as db:
        count = db.execute("SELECT value FROM metadata WHERE key='count'").fetchone()
    return {"ready": True, "count": int(count[0]) if count else 0}


@router.get("/puzzles/session")
def puzzle_session(theme: str = "", minimum: int = Query(800, ge=0, le=4000), maximum: int = Query(2000, ge=0, le=4000), limit: int = Query(10, ge=1, le=30)):
    if minimum > maximum:
        raise HTTPException(400, "Độ khó tối thiểu phải nhỏ hơn hoặc bằng tối đa.")
    if not PUZZLES.exists():
        raise HTTPException(409, "Chưa nhập database Lichess. Xem hướng dẫn trong Bí Cảnh.")
    with closing(sqlite3.connect(PUZZLES)) as db:
        db.row_factory = sqlite3.Row
        table = "themes" if theme else "puzzles"
        where = "theme=? AND rating BETWEEN ? AND ?" if theme else "rating BETWEEN ? AND ?"
        params = (theme, minimum, maximum) if theme else (minimum, maximum)
        total = db.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params).fetchone()[0]
        # One random offset per slice of the indexed rating range prevents a
        # session from returning ten almost identical ratings in one block.
        count = min(limit, total)
        offsets = [
            random.randrange(index * total // count, (index + 1) * total // count)
            for index in range(count)
        ]
        ids = [
            db.execute(
                f"SELECT id FROM {table} WHERE {where} ORDER BY rating,id LIMIT 1 OFFSET ?",
                (*params, offset),
            ).fetchone()
            for offset in offsets
        ]
        result = []
        for item in ids:
            row = db.execute("SELECT * FROM puzzles WHERE id=?", (item["id"],)).fetchone()
            try:
                board = chess.Board(row["fen"])
                moves = row["moves"].split()
                if not board.is_valid() or len(moves) < 2:
                    continue
                for move in moves:
                    board.push_uci(move)
                result.append(dict(row))
            except ValueError:
                continue
    random.shuffle(result)
    return {"puzzles": result, "matching": total}


class SavedPosition(BaseModel):
    id: str = Field(min_length=1, max_length=150)
    title: str = Field(min_length=1, max_length=200)
    fen: str = Field(max_length=150)
    source: str = Field(pattern="^(book|lichess)$")
    sourcePath: str = Field(default="", max_length=1000)
    themes: str = Field(default="", max_length=500)
    note: str = Field(default="", max_length=3000)


@router.get("/collection")
def list_collection():
    with closing(collection_db()) as db:
        return {"items": [json.loads(row[0]) for row in db.execute("SELECT payload FROM collection ORDER BY updated DESC")]}


@router.put("/collection")
def save_collection(item: SavedPosition):
    try:
        board = chess.Board(item.fen)
        if not board.is_valid():
            raise ValueError()
    except ValueError:
        raise HTTPException(400, "Thế cờ chưa hợp lệ. Hãy kiểm tra bàn cờ trước khi lưu.")
    if item.sourcePath and not item.sourcePath.startswith(("/analysis?", "https://lichess.org/training/")):
        raise HTTPException(400, "Đường dẫn nguồn không hợp lệ.")
    with closing(collection_db()) as db:
        db.execute("INSERT OR REPLACE INTO collection VALUES (?,?,?)", (item.id, item.model_dump_json(), time.time()))
        db.commit()
    return {"saved": True}


@router.delete("/collection/{item_id}")
def delete_collection(item_id: str):
    with closing(collection_db()) as db:
        deleted = db.execute("DELETE FROM collection WHERE id=?", (item_id,)).rowcount
        db.commit()
    if not deleted:
        raise HTTPException(404, "Không tìm thấy thế cờ đã lưu.")
    return {"deleted": True}


# main.py already mounts this router. Routes below already carry their complete
# /api/... path, so append the concrete routes instead of nesting the /api prefix.
wrap_admin_routes(admin_router)
router.routes.extend(admin_router.routes)
router.routes.extend(admin_auth_public_router.routes)
# Security routes carry their own authentication dependencies and audit events.
# Keep them outside wrap_admin_routes so self-service password/session mutations
# remain available to moderator accounts that only have admin.read.
router.routes.extend(admin_security_router.routes)
# Scanner v2 is public application functionality, not an Admin route.
router.routes.extend(scanner_v2_router.routes)
