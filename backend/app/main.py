from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from pathlib import Path

import chess
import chess.engine
import cv2
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .detector import extract_from_docx, extract_from_pdf
from .recognizer import recognize_board

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "positions"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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


def _position_paths(job_id: str, position_id: int) -> tuple[Path, Path]:
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise HTTPException(status_code=400, detail="Invalid job id")
    if position_id < 1 or position_id > 100000:
        raise HTTPException(status_code=400, detail="Invalid position id")

    job_dir = OUTPUT_DIR / job_id
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

    return {
        "jobId": job_id,
        "filename": file.filename,
        "count": len(positions),
        "positions": positions,
    }


@app.post("/api/recognize")
def recognize_position(req: RecognizeRequest):
    """Read a detected board image and return FEN piece-placement candidates.

    Recognition is lazy: for a 700-page book we only run the ML model for a
    diagram when the user opens it. The result is cached next to the PNG.
    """
    image_path, cache_path = _position_paths(req.jobId, req.positionId)

    if cache_path.exists() and not req.force:
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
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
