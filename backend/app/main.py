from __future__ import annotations

import json
import os
import re
import shutil
import uuid
import zipfile
import threading
import time
from pathlib import Path

import chess
import chess.engine
import cv2
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .detector import extract_from_docx, extract_from_pdf
from .recognizer import recognize_board

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "positions"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

BOOK_METADATA = "book.json"
JOB_STATUS = "status.json"

app = FastAPI(title="Chess Book Reader API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/files", StaticFiles(directory=OUTPUT_DIR), name="files")


class AnalyzeRequest(BaseModel):
    fen: str
    depth: int = 15
    multipv: int = 3


class RecognizeRequest(BaseModel):
    jobId: str
    positionId: int
    force: bool = False


class SavePositionRequest(BaseModel):
    fen: str


def resolve_engine_path() -> str | None:
    configured = os.getenv("STOCKFISH_PATH")
    if configured:
        configured_path = Path(configured)
        if configured_path.exists():
            return str(configured_path)

    discovered = shutil.which("stockfish")
    return discovered


def san_line(board: chess.Board, pv: list[chess.Move], max_plies: int = 10) -> str:
    b = board.copy()
    sans: list[str] = []
    for move in pv[:max_plies]:
        if move not in b.legal_moves:
            break
        sans.append(b.san(move))
        b.push(move)
    return " ".join(sans)


def _job_dir(job_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    job_dir = OUTPUT_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Book job not found")
    return job_dir


def _write_json_atomic(path: Path, payload: dict) -> None:
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def _scan_book_job(
    job_id: str,
    upload_path: Path,
    suffix: str,
    original_filename: str | None,
) -> None:
    job_output = OUTPUT_DIR / job_id
    status_path = job_output / JOB_STATUS
    positions: list[dict] = []

    status = {
        "jobId": job_id,
        "filename": original_filename,
        "status": "processing",
        "current": 0,
        "total": 0,
        "progress": 0.0,
        "count": 0,
        "positions": positions,
        "error": None,
    }
    _write_json_atomic(status_path, status)

    def on_progress(current: int, total: int) -> None:
        status["current"] = current
        status["total"] = total
        status["progress"] = round((current / total) * 100, 1) if total else 0.0
        status["count"] = len(positions)
        _write_json_atomic(status_path, status)

    try:
        extracted = (
            extract_from_pdf(upload_path, progress_callback=on_progress)
            if suffix == ".pdf"
            else extract_from_docx(upload_path, progress_callback=on_progress)
        )

        for idx, detected in enumerate(extracted, start=1):
            filename = f"position-{idx:04d}.png"
            target = job_output / filename
            cv2.imwrite(str(target), detected.image)
            positions.append(
                {
                    "id": idx,
                    "page": detected.page,
                    "confidence": round(float(detected.score), 3),
                    "imageUrl": f"http://localhost:8000/files/{job_id}/{filename}",
                }
            )

        payload = {
            "jobId": job_id,
            "filename": original_filename,
            "count": len(positions),
            "positions": positions,
        }
        _write_json_atomic(job_output / BOOK_METADATA, payload)

        status.update(
            {
                "status": "completed",
                "progress": 100.0,
                "count": len(positions),
                "positions": positions,
            }
        )
        if status["total"]:
            status["current"] = status["total"]
        _write_json_atomic(status_path, status)
    except Exception as exc:
        status.update(
            {
                "status": "failed",
                "error": str(exc),
                "count": len(positions),
                "positions": positions,
            }
        )
        _write_json_atomic(status_path, status)


def _position_paths(job_id: str, position_id: int) -> tuple[Path, Path]:
    job_dir = _job_dir(job_id)
    if position_id < 1 or position_id > 100000:
        raise HTTPException(status_code=400, detail="Invalid position id")

    image_path = job_dir / f"position-{position_id:04d}.png"
    cache_path = job_dir / f"position-{position_id:04d}.recognition.json"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Position image not found")
    return image_path, cache_path


@app.get("/health")
def health():
    return {"ok": True, "phase": 2}


@app.get("/api/engine-status")
def engine_status():
    engine_path = resolve_engine_path()
    return {
        "available": bool(engine_path),
        "source": "STOCKFISH_PATH" if os.getenv("STOCKFISH_PATH") and engine_path else ("PATH" if engine_path else None),
    }


@app.post("/api/books/start")
def start_book_scan(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Only .pdf and .docx are supported.")

    job_id = uuid.uuid4().hex
    upload_path = UPLOAD_DIR / f"{job_id}{suffix}"
    job_output = OUTPUT_DIR / job_id
    job_output.mkdir(parents=True, exist_ok=True)

    with upload_path.open("wb") as f_out:
        shutil.copyfileobj(file.file, f_out)

    initial_status = {
        "jobId": job_id,
        "filename": file.filename,
        "status": "queued",
        "current": 0,
        "total": 0,
        "progress": 0.0,
        "count": 0,
        "positions": [],
        "error": None,
    }
    _write_json_atomic(job_output / JOB_STATUS, initial_status)

    worker = threading.Thread(
        target=_scan_book_job,
        args=(job_id, upload_path, suffix, file.filename),
        daemon=True,
        name=f"book-scan-{job_id[:8]}",
    )
    worker.start()

    return initial_status


@app.get("/api/jobs/{job_id}")
def get_scan_job(job_id: str):
    job_dir = _job_dir(job_id)
    status_path = job_dir / JOB_STATUS
    if not status_path.exists():
        raise HTTPException(status_code=404, detail="Scan status not found")

    try:
        return json.loads(status_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail="Could not read scan status") from exc


@app.post("/api/books")
def upload_book(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Only .pdf and .docx are supported.")

    job_id = uuid.uuid4().hex
    upload_path = UPLOAD_DIR / f"{job_id}{suffix}"
    job_output = OUTPUT_DIR / job_id
    job_output.mkdir(parents=True, exist_ok=True)

    with upload_path.open("wb") as f_out:
        shutil.copyfileobj(file.file, f_out)

    try:
        extracted = extract_from_pdf(upload_path) if suffix == ".pdf" else extract_from_docx(upload_path)
        positions = []
        for idx, detected in enumerate(extracted, start=1):
            filename = f"position-{idx:04d}.png"
            target = job_output / filename
            cv2.imwrite(str(target), detected.image)
            positions.append(
                {
                    "id": idx,
                    "page": detected.page,
                    "confidence": round(float(detected.score), 3),
                    "imageUrl": f"http://localhost:8000/files/{job_id}/{filename}",
                }
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not process document: {exc}") from exc

    payload = {
        "jobId": job_id,
        "filename": file.filename,
        "count": len(positions),
        "positions": positions,
    }
    (job_output / BOOK_METADATA).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload


@app.get("/api/books")
def list_books():
    books = []
    for job_dir in OUTPUT_DIR.iterdir():
        if not job_dir.is_dir():
            continue
        metadata_path = job_dir / BOOK_METADATA
        if not metadata_path.exists():
            continue
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            payload["updatedAt"] = metadata_path.stat().st_mtime
            books.append(payload)
        except (json.JSONDecodeError, OSError):
            continue

    books.sort(key=lambda item: item.get("updatedAt", 0), reverse=True)
    return {"books": books[:20]}


@app.get("/api/books/{job_id}")
def get_book(job_id: str):
    job_dir = _job_dir(job_id)
    metadata_path = job_dir / BOOK_METADATA
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Book metadata not found")
    try:
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail="Could not read book metadata") from exc


@app.get("/api/books/{job_id}/recognized.json")
def download_recognized_positions(job_id: str):
    job_dir = _job_dir(job_id)
    metadata_path = job_dir / BOOK_METADATA
    page_by_id: dict[int, int] = {}

    if metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            page_by_id = {
                int(item["id"]): int(item["page"])
                for item in metadata.get("positions", [])
                if "id" in item and "page" in item
            }
        except (json.JSONDecodeError, OSError, ValueError, TypeError):
            page_by_id = {}

    recognized = []
    for cache_path in sorted(job_dir.glob("position-*.recognition.json")):
        try:
            position_id = int(cache_path.name.split("-")[1].split(".")[0])
            data = json.loads(cache_path.read_text(encoding="utf-8"))
        except (ValueError, IndexError, json.JSONDecodeError, OSError):
            continue

        recognized.append(
            {
                "positionId": position_id,
                "page": page_by_id.get(position_id),
                "fen": data.get("fen"),
                "piecePlacement": data.get("piecePlacement"),
                "suggestedOrientation": data.get("suggestedOrientation"),
                "averageConfidence": data.get("averageConfidence"),
                "uncertainSquares": data.get("uncertainSquares", []),
            }
        )

    payload = {
        "jobId": job_id,
        "count": len(recognized),
        "positions": recognized,
    }
    export_path = job_dir / "recognized-positions.json"
    export_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return FileResponse(
        path=export_path,
        media_type="application/json",
        filename=f"{job_id}-recognized-positions.json",
    )


@app.delete("/api/books/{job_id}")
def delete_book(job_id: str):
    job_dir = _job_dir(job_id)
    shutil.rmtree(job_dir, ignore_errors=True)
    for upload_path in UPLOAD_DIR.glob(f"{job_id}.*"):
        try:
            upload_path.unlink()
        except OSError:
            pass
    return {"ok": True, "jobId": job_id}


@app.get("/api/books/{job_id}/download")
def download_book_diagrams(job_id: str):
    job_dir = _job_dir(job_id)
    zip_path = job_dir / "chess-diagrams.zip"

    png_files = sorted(job_dir.glob("position-*.png"))
    if not png_files:
        raise HTTPException(status_code=404, detail="No diagrams found")

    newest_png = max(path.stat().st_mtime for path in png_files)
    if not zip_path.exists() or zip_path.stat().st_mtime < newest_png:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for image_path in png_files:
                archive.write(image_path, arcname=image_path.name)

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"{job_id}-chess-diagrams.zip",
    )


@app.post("/api/recognize")
def recognize_position(req: RecognizeRequest):
    """Read a detected board image and return FEN piece-placement candidates.

    Recognition is lazy: for a 700-page book we only run the ML model for a
    diagram when the user opens it. The result is cached next to the PNG.
    """
    image_path, cache_path = _position_paths(req.jobId, req.positionId)

    if cache_path.exists() and not req.force:
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            # Older Phase 2 caches did not include per-square confidence.
            # Re-run recognition once so the frontend always receives the
            # current response shape after an app update.
            if "confidenceCandidates" in cached:
                return cached
        except (json.JSONDecodeError, OSError):
            pass

    try:
        result = recognize_board(image_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI recognition failed: {exc}") from exc

    payload = {
        **result,
        "fen": f"{result['piecePlacement']} w - - 0 1",
        "sideToMove": "w",
        "jobId": req.jobId,
        "positionId": req.positionId,
    }
    cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


@app.post("/api/analyze")
def analyze_position(req: AnalyzeRequest):
    try:
        board = chess.Board(req.fen)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {exc}") from exc

    if not board.is_valid():
        raise HTTPException(
            status_code=400,
            detail="This FEN is not a legal chess position. Check the AI-recognized pieces first.",
        )

    engine_path = resolve_engine_path()
    if not engine_path:
        raise HTTPException(
            status_code=503,
            detail="STOCKFISH_PATH is not configured. Set it to your Stockfish executable path.",
        )

    engine = None
    try:
        engine = chess.engine.SimpleEngine.popen_uci(engine_path)
        infos = engine.analyse(
            board,
            chess.engine.Limit(depth=max(8, min(req.depth, 22))),
            multipv=max(1, min(req.multipv, 5)),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Stockfish failed: {exc}") from exc
    finally:
        if engine is not None:
            try:
                engine.quit()
            except Exception:
                pass

    if not isinstance(infos, list):
        infos = [infos]

    lines = []
    for info in infos:
        score_obj = info["score"].pov(board.turn)
        score = score_obj.score(mate_score=100000)
        evaluation = score / 100 if score is not None else 0
        pv = info.get("pv", [])
        lines.append(
            {
                "evaluation": evaluation,
                "mate": score_obj.mate(),
                "depth": info.get("depth"),
                "uci": " ".join(m.uci() for m in pv[:10]),
                "san": san_line(board, pv),
            }
        )

    return {"fen": req.fen, "lines": lines}
