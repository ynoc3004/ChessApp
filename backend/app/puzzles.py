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
from .library import router as library_router

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
        offset = random.randint(0, max(0, total - limit))
        ids = db.execute(f"SELECT id FROM {table} WHERE {where} ORDER BY rating,id LIMIT ? OFFSET ?", (*params, limit, offset)).fetchall()
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


# Library routes carry their own /api prefix. Appending them avoids changing
# main.py while keeping the existing puzzle/collection endpoints intact.
router.routes.extend(library_router.routes)
