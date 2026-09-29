from __future__ import annotations

import hashlib
import io
import json
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import chess
import chess.pgn
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api")

BASE_DIR = Path(__file__).resolve().parent.parent
LIBRARY_DIR = BASE_DIR / "data" / "library"
LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

POSITIONS_FILE = LIBRARY_DIR / "positions.json"
FOLDERS_FILE = LIBRARY_DIR / "folders.json"
GAMES_FILE = LIBRARY_DIR / "games.json"
WORLD_STATUS_FILE = LIBRARY_DIR / "world-championship-sync.json"

WORLD_FOLDER_ID = "world-championships"
FAVORITES_ROOT_ID = "favorite-players"
WORLD_INDEX_URL = "https://lichess.org/page/world-championships"

_LOCK = threading.RLock()
_SYNC_LOCK = threading.Lock()

DEFAULT_FOLDERS = [
    {
        "id": WORLD_FOLDER_ID,
        "name": "Vương Tọa Kỳ Phổ",
        "description": "Toàn bộ kỳ cục thuộc dòng chính Thế Giới Kỳ Vương Tranh Bá, khởi từ Steinitz–Zukertort 1886.",
        "kind": "system",
        "parentId": None,
        "locked": True,
        "createdAt": 0,
    },
    {
        "id": FAVORITES_ROOT_ID,
        "name": "Danh Kỳ Sở Ái",
        "description": "Tự lập các quyển mục cho kỳ thủ ngươi yêu thích.",
        "kind": "group",
        "parentId": None,
        "locked": True,
        "createdAt": 0,
    },
]


class SavedPosition(BaseModel):
    id: str
    title: str
    fen: str
    source: str = "book"
    sourcePath: str = ""
    themes: str = ""
    note: str = ""


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    parentId: str | None = FAVORITES_ROOT_ID


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def _write_json(path: Path, payload: Any) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _custom_folders() -> list[dict]:
    data = _read_json(FOLDERS_FILE, [])
    return data if isinstance(data, list) else []


def _all_folders() -> list[dict]:
    return [*DEFAULT_FOLDERS, *_custom_folders()]


def _folder(folder_id: str) -> dict:
    folder = next((item for item in _all_folders() if item.get("id") == folder_id), None)
    if not folder:
        raise HTTPException(status_code=404, detail="Quyển mục không tồn tại.")
    return folder


def _games() -> list[dict]:
    data = _read_json(GAMES_FILE, [])
    return data if isinstance(data, list) else []


def _positions() -> list[dict]:
    data = _read_json(POSITIONS_FILE, [])
    return data if isinstance(data, list) else []


def _sync_status() -> dict:
    return _read_json(
        WORLD_STATUS_FILE,
        {
            "state": "idle",
            "current": 0,
            "total": 0,
            "imported": 0,
            "skipped": 0,
            "message": "Chưa đồng bộ Vương Tọa Kỳ Phổ.",
            "updatedAt": None,
        },
    )


def _set_sync_status(**changes: Any) -> None:
    with _LOCK:
        status = _sync_status()
        status.update(changes)
        status["updatedAt"] = time.time()
        _write_json(WORLD_STATUS_FILE, status)


def _http_text(url: str, accept: str = "text/html") -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ChessApp/0.3 (+local-study-tool)",
            "Accept": accept,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"Không tải được dữ liệu từ Lichess: {exc}") from exc


def _plain_study_title(raw: str) -> str:
    title = re.sub(r"<[^>]+>", "", raw)
    title = title.replace("&amp;", "&").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", title).strip()


def _world_studies() -> list[tuple[str, str]]:
    html = _http_text(WORLD_INDEX_URL)
    start = html.find("Chess World Championship Matches")
    end = html.find("Women&#39;s World Championship Matches")
    if end < 0:
        end = html.find("Women's World Championship Matches")
    section = html[start:end if end > start else None] if start >= 0 else html
    matches = re.findall(
        r'href=["\']/study/([A-Za-z0-9]{8})["\'][^>]*>(.*?)</a>',
        section,
        flags=re.IGNORECASE | re.DOTALL,
    )
    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for study_id, title in matches:
        if study_id in seen:
            continue
        seen.add(study_id)
        result.append((study_id, _plain_study_title(title)))
    if not result:
        raise RuntimeError("Không tìm được danh sách Thế Giới Kỳ Vương trên Lichess.")
    return result


def _normalized_pgn(game: chess.pgn.Game) -> str:
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return game.accept(exporter).strip()


def _record_from_game(
    game: chess.pgn.Game,
    folder_id: str,
    source_type: str,
    source_url: str = "",
    source_collection: str = "",
) -> dict:
    pgn = _normalized_pgn(game)
    headers = dict(game.headers)
    digest_input = "\n".join(
        [
            headers.get("Event", ""),
            headers.get("Date", ""),
            headers.get("Round", ""),
            headers.get("White", ""),
            headers.get("Black", ""),
            headers.get("Result", ""),
            pgn,
        ]
    )
    game_id = hashlib.sha1(digest_input.encode("utf-8")).hexdigest()[:24]
    white = headers.get("White", "Bạch phương")
    black = headers.get("Black", "Hắc phương")
    event = headers.get("Event", "Kỳ cục")
    round_name = headers.get("Round", "")
    suffix = f" · ván {round_name}" if round_name and round_name != "?" else ""
    board = game.board()
    ply_count = 0
    for move in game.mainline_moves():
        board.push(move)
        ply_count += 1
    return {
        "id": game_id,
        "folderId": folder_id,
        "title": f"{white} – {black}{suffix}",
        "event": event,
        "date": headers.get("Date", ""),
        "round": round_name,
        "white": white,
        "black": black,
        "result": headers.get("Result", "*"),
        "site": headers.get("Site", ""),
        "eco": headers.get("ECO", ""),
        "plyCount": ply_count,
        "pgn": pgn,
        "sourceType": source_type,
        "sourceUrl": source_url,
        "sourceCollection": source_collection,
        "createdAt": time.time(),
    }


def _parse_pgn(text: str, folder_id: str, source_type: str, source_url: str = "", source_collection: str = "") -> list[dict]:
    stream = io.StringIO(text)
    records: list[dict] = []
    while True:
        game = chess.pgn.read_game(stream)
        if game is None:
            break
        records.append(_record_from_game(game, folder_id, source_type, source_url, source_collection))
    return records


def _merge_games(records: list[dict]) -> tuple[int, int]:
    if not records:
        return 0, 0
    with _LOCK:
        current = _games()
        known = {item.get("id") for item in current}
        added = [item for item in records if item.get("id") not in known]
        skipped = len(records) - len(added)
        if added:
            current.extend(added)
            current.sort(key=lambda item: (item.get("date", ""), item.get("event", ""), item.get("round", "")))
            _write_json(GAMES_FILE, current)
        return len(added), skipped


def _sync_world_worker() -> None:
    if not _SYNC_LOCK.acquire(blocking=False):
        return
    try:
        _set_sync_status(state="discovering", current=0, total=0, imported=0, skipped=0, message="Đang dò Vương Tọa Kỳ Phổ trên Lichess…")
        studies = _world_studies()
        imported = 0
        skipped = 0
        _set_sync_status(state="running", total=len(studies), message=f"Đã tìm thấy {len(studies)} kỳ vương đại chiến.")
        for index, (study_id, title) in enumerate(studies, start=1):
            _set_sync_status(current=index - 1, message=f"Đang thu nhập {title}…")
            url = f"https://lichess.org/api/study/{study_id}.pgn?comments=false&variations=false&clocks=false"
            try:
                pgn_text = _http_text(url, "application/x-chess-pgn")
                records = _parse_pgn(
                    pgn_text,
                    WORLD_FOLDER_ID,
                    "lichess-study",
                    f"https://lichess.org/study/{study_id}",
                    title,
                )
                add_count, skip_count = _merge_games(records)
                imported += add_count
                skipped += skip_count
            except Exception as exc:
                skipped += 1
                _set_sync_status(message=f"Bỏ qua {title}: {exc}")
            _set_sync_status(current=index, imported=imported, skipped=skipped)
        total_games = sum(1 for item in _games() if item.get("folderId") == WORLD_FOLDER_ID)
        _set_sync_status(
            state="completed",
            current=len(studies),
            total=len(studies),
            imported=imported,
            skipped=skipped,
            message=f"Vương Tọa Kỳ Phổ viên mãn · hiện tàng {total_games} ván.",
            gameCount=total_games,
        )
    except Exception as exc:
        _set_sync_status(state="failed", message=str(exc))
    finally:
        _SYNC_LOCK.release()


@router.get("/library")
def library_overview():
    folders = _all_folders()
    games = _games()
    counts: dict[str, int] = {}
    for game in games:
        folder_id = game.get("folderId", "")
        counts[folder_id] = counts.get(folder_id, 0) + 1
    return {
        "folders": [{**folder, "gameCount": counts.get(folder.get("id", ""), 0)} for folder in folders],
        "gameCount": len(games),
        "positionCount": len(_positions()),
        "worldSync": _sync_status(),
    }


@router.get("/library/folders")
def list_folders():
    return {"folders": _all_folders()}


@router.post("/library/folders")
def create_folder(req: FolderCreate):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Danh xưng quyển mục bất khả để trống.")
    parent_id = req.parentId or FAVORITES_ROOT_ID
    parent = _folder(parent_id)
    if parent.get("kind") not in {"group", "system", "user"}:
        raise HTTPException(status_code=400, detail="Thượng cấp quyển mục không hợp lệ.")
    folder = {
        "id": f"folder-{uuid.uuid4().hex[:12]}",
        "name": name,
        "description": req.description.strip(),
        "kind": "user",
        "parentId": parent_id,
        "locked": False,
        "createdAt": time.time(),
    }
    with _LOCK:
        folders = _custom_folders()
        folders.append(folder)
        _write_json(FOLDERS_FILE, folders)
    return folder


@router.patch("/library/folders/{folder_id}")
def update_folder(folder_id: str, req: FolderUpdate):
    _folder(folder_id)
    with _LOCK:
        folders = _custom_folders()
        target = next((item for item in folders if item.get("id") == folder_id), None)
        if not target:
            raise HTTPException(status_code=403, detail="Hệ thống quyển mục bất khả cải danh.")
        if req.name is not None:
            target["name"] = req.name.strip()
        if req.description is not None:
            target["description"] = req.description.strip()
        _write_json(FOLDERS_FILE, folders)
        return target


@router.delete("/library/folders/{folder_id}")
def delete_folder(folder_id: str):
    _folder(folder_id)
    with _LOCK:
        folders = _custom_folders()
        if not any(item.get("id") == folder_id for item in folders):
            raise HTTPException(status_code=403, detail="Hệ thống quyển mục bất khả tiêu trừ.")
        if any(item.get("folderId") == folder_id for item in _games()):
            raise HTTPException(status_code=409, detail="Quyển mục hữu kỳ cục. Thỉnh di chuyển hoặc tiêu trừ kỳ cục trước.")
        folders = [item for item in folders if item.get("id") != folder_id]
        _write_json(FOLDERS_FILE, folders)
    return {"ok": True}


@router.get("/library/games")
def list_games(folderId: str | None = None, q: str = "", limit: int = 300, offset: int = 0):
    games = _games()
    if folderId:
        games = [item for item in games if item.get("folderId") == folderId]
    query = q.strip().lower()
    if query:
        games = [
            item
            for item in games
            if query
            in " ".join(
                str(item.get(key, ""))
                for key in ("title", "event", "white", "black", "date", "eco", "sourceCollection")
            ).lower()
        ]
    total = len(games)
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    summaries = [{key: value for key, value in item.items() if key != "pgn"} for item in games[offset : offset + limit]]
    return {"games": summaries, "total": total}


@router.get("/library/games/{game_id}")
def get_game(game_id: str):
    game = next((item for item in _games() if item.get("id") == game_id), None)
    if not game:
        raise HTTPException(status_code=404, detail="Kỳ cục không tồn tại.")
    return game


@router.delete("/library/games/{game_id}")
def delete_game(game_id: str):
    with _LOCK:
        games = _games()
        next_games = [item for item in games if item.get("id") != game_id]
        if len(next_games) == len(games):
            raise HTTPException(status_code=404, detail="Kỳ cục không tồn tại.")
        _write_json(GAMES_FILE, next_games)
    return {"ok": True}


@router.post("/library/games/import")
def import_games(folderId: str = Form(...), file: UploadFile = File(...)):
    _folder(folderId)
    filename = file.filename or "games.pgn"
    if not filename.lower().endswith(".pgn"):
        raise HTTPException(status_code=400, detail="Chỉ tiếp nhận kỳ phổ PGN.")
    raw = file.file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    records = _parse_pgn(text, folderId, "user-pgn", source_collection=filename)
    if not records:
        raise HTTPException(status_code=400, detail="PGN vô hữu khả đọc kỳ cục.")
    added, skipped = _merge_games(records)
    return {"added": added, "skipped": skipped, "total": len(records)}


@router.post("/library/world-championships/sync")
def start_world_sync():
    status = _sync_status()
    if status.get("state") in {"discovering", "running"}:
        return status
    thread = threading.Thread(target=_sync_world_worker, daemon=True, name="world-championship-sync")
    thread.start()
    return {**status, "state": "queued", "message": "Đã khởi động đồng bộ Vương Tọa Kỳ Phổ."}


@router.get("/library/world-championships/status")
def world_sync_status():
    return _sync_status()


@router.get("/collection")
def list_saved_positions():
    return {"items": _positions()}


@router.put("/collection")
def save_collection_position(req: SavedPosition):
    try:
        board = chess.Board(req.fen)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"FEN bất hợp lệ: {exc}") from exc
    if not board.is_valid():
        raise HTTPException(status_code=400, detail="Kỳ thế bất hợp lệ.")
    payload = req.model_dump()
    payload["fen"] = board.fen()
    with _LOCK:
        items = _positions()
        index = next((i for i, item in enumerate(items) if item.get("id") == req.id), -1)
        if index >= 0:
            items[index] = payload
        else:
            items.append(payload)
        _write_json(POSITIONS_FILE, items)
    return payload


@router.delete("/collection/{position_id}")
def delete_collection_position(position_id: str):
    with _LOCK:
        items = _positions()
        next_items = [item for item in items if item.get("id") != position_id]
        if len(items) == len(next_items):
            raise HTTPException(status_code=404, detail="Kỳ thế không tồn tại.")
        _write_json(POSITIONS_FILE, next_items)
    return {"ok": True}
