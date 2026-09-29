from __future__ import annotations

import io
import sqlite3
from contextlib import closing
from pathlib import Path

import chess.pgn
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .library import (
    FOLDERS_FILE,
    GAMES_FILE,
    POSITIONS_FILE,
    _LOCK,
    _custom_folders,
    _folder,
    _games,
    _positions,
    _write_json,
)

router = APIRouter(prefix="/api")
LEGACY_COLLECTION = Path(__file__).resolve().parent.parent / "data" / "collection.sqlite3"


class GameUpdate(BaseModel):
    folderId: str | None = None
    title: str | None = Field(default=None, max_length=220)
    event: str | None = Field(default=None, max_length=220)
    date: str | None = Field(default=None, max_length=24)
    round: str | None = Field(default=None, max_length=40)
    white: str | None = Field(default=None, max_length=120)
    black: str | None = Field(default=None, max_length=120)
    result: str | None = Field(default=None, pattern=r"^(1-0|0-1|1/2-1/2|\*)$")
    site: str | None = Field(default=None, max_length=180)
    eco: str | None = Field(default=None, max_length=12)


def _refresh_pgn_headers(game: dict) -> None:
    pgn = str(game.get("pgn", "")).strip()
    if not pgn:
        return
    parsed = chess.pgn.read_game(io.StringIO(pgn))
    if parsed is None:
        return
    mapping = {
        "Event": "event",
        "Date": "date",
        "Round": "round",
        "White": "white",
        "Black": "black",
        "Result": "result",
        "Site": "site",
        "ECO": "eco",
    }
    for header, key in mapping.items():
        value = str(game.get(key, "")).strip()
        if value:
            parsed.headers[header] = value
        elif header in parsed.headers and header not in {"Result"}:
            del parsed.headers[header]
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    game["pgn"] = parsed.accept(exporter).strip()


@router.patch("/library/games/{game_id}")
def update_game(game_id: str, req: GameUpdate):
    with _LOCK:
        games = _games()
        target = next((item for item in games if item.get("id") == game_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Kỳ cục không tồn tại.")

        if req.folderId is not None and req.folderId != target.get("folderId"):
            destination = _folder(req.folderId)
            if destination.get("kind") != "user":
                raise HTTPException(status_code=400, detail="Chỉ khả di chuyển kỳ cục vào quyển mục tự lập.")
            target["folderId"] = req.folderId

        for key in ("title", "event", "date", "round", "white", "black", "result", "site", "eco"):
            value = getattr(req, key)
            if value is not None:
                target[key] = value.strip()

        if req.title is None and (req.white is not None or req.black is not None or req.round is not None):
            suffix = f" · ván {target.get('round')}" if target.get("round") and target.get("round") != "?" else ""
            target["title"] = f"{target.get('white', 'Bạch phương')} – {target.get('black', 'Hắc phương')}{suffix}"

        _refresh_pgn_headers(target)
        _write_json(GAMES_FILE, games)
        return target


@router.delete("/library/folders/{folder_id}/with-games")
def delete_folder_with_games(folder_id: str):
    _folder(folder_id)
    with _LOCK:
        folders = _custom_folders()
        if not any(item.get("id") == folder_id for item in folders):
            raise HTTPException(status_code=403, detail="Hệ thống quyển mục bất khả tiêu trừ.")
        games = _games()
        removed = sum(1 for item in games if item.get("folderId") == folder_id)
        _write_json(GAMES_FILE, [item for item in games if item.get("folderId") != folder_id])
        _write_json(FOLDERS_FILE, [item for item in folders if item.get("id") != folder_id])
    return {"ok": True, "removedGames": removed}


@router.delete("/collection/{position_id}")
def delete_saved_position_everywhere(position_id: str):
    removed = False

    # Legacy/current Kỳ Thế Tàng storage used by SavePosition.
    if LEGACY_COLLECTION.exists():
        try:
            with closing(sqlite3.connect(LEGACY_COLLECTION, timeout=15)) as db:
                cursor = db.execute("DELETE FROM collection WHERE id=?", (position_id,))
                db.commit()
                removed = cursor.rowcount > 0
        except (sqlite3.Error, OSError):
            pass

    # Newer archive layout also supports the JSON-backed store.
    with _LOCK:
        items = _positions()
        next_items = [item for item in items if item.get("id") != position_id]
        if len(next_items) != len(items):
            _write_json(POSITIONS_FILE, next_items)
            removed = True

    if not removed:
        raise HTTPException(status_code=404, detail="Kỳ thế không tồn tại.")
    return {"ok": True}
