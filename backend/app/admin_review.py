from __future__ import annotations

import json
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

import chess
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import admin as admin_core
from .admin_auth import AdminPrincipal, require_permission
from .admin_books import book_detail
from .specialist_model import specialist_status

router = APIRouter(prefix="/review")

_BATCH_LOCK = threading.Lock()
_BATCH_STATE: dict[str, Any] = {
    "running": False,
    "startedAt": None,
    "finishedAt": None,
    "jobId": None,
    "currentJobId": None,
    "currentPositionId": None,
    "processed": 0,
    "recognized": 0,
    "failed": 0,
    "skipped": 0,
    "total": 0,
    "error": None,
}


class BatchRequest(BaseModel):
    jobId: str | None = Field(default=None, max_length=64)
    force: bool = False
    limit: int = Field(default=200, ge=1, le=1000)


class ConfirmRequest(BaseModel):
    sideToMove: str = Field(default="w", pattern="^[wb]$")


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _risk(position: dict) -> tuple[float, list[str]]:
    if position.get("corrected"):
        return 0.0, ["Đã được người dùng xác nhận"]
    if not position.get("recognized"):
        return 100.0, ["Chưa nhận dạng AI"]

    confidence = float(position.get("averageConfidence") or 0.0)
    uncertain = len(position.get("uncertainSquares") or [])
    valid = position.get("validPlacement")
    color_mismatches = int(position.get("pieceColorMismatchCount") or 0)
    specialist_uncertain = int(position.get("specialistUncertainCount") or 0)
    specialist_changed = int(position.get("specialistCorrectedCount") or 0)

    score = max(0.0, (0.93 - confidence) * 65.0)
    reasons: list[str] = []
    if valid is False:
        score += 34.0
        reasons.append("FEN AI chưa hợp lệ")
    if confidence < 0.82:
        reasons.append(f"Confidence thấp {round(confidence * 100)}%")
    if uncertain:
        score += min(28.0, uncertain * 2.1)
        reasons.append(f"{uncertain} ô chưa chắc")
    if color_mismatches:
        score += min(18.0, color_mismatches * 4.5)
        reasons.append(f"{color_mismatches} ô nghi sai màu")
    if specialist_uncertain:
        score += min(16.0, specialist_uncertain * 1.8)
        reasons.append(f"{specialist_uncertain} ô model loại quân chưa chắc")
    if specialist_changed:
        score += min(12.0, specialist_changed * 2.0)
        reasons.append(f"Model chuyên biệt đã sửa {specialist_changed} ô")
    if not reasons:
        reasons.append("AI tương đối ổn; chờ xác nhận")
    return round(min(100.0, max(1.0, score)), 1), reasons


def _enrich_position(job: dict, position: dict) -> dict:
    job_id = str(job["jobId"])
    job_dir = admin_core.OUTPUT_DIR / job_id
    position_id = int(position["id"])
    recognition_path = job_dir / f"position-{position_id:04d}.recognition.json"
    recognition = _read_json(recognition_path) if recognition_path.exists() else {}

    payload = dict(position)
    payload["jobId"] = job_id
    payload["filename"] = job.get("filename")
    payload["validPlacement"] = recognition.get("validPlacement")
    payload["pieceColorMismatchCount"] = len(recognition.get("pieceColorMismatches") or [])
    payload["uncertainColorSquares"] = recognition.get("uncertainColorSquares") or []
    payload["specialistCorrectedSquares"] = recognition.get("specialistCorrectedSquares") or []
    payload["specialistUncertainSquares"] = recognition.get("specialistUncertainSquares") or []
    payload["specialistCorrectedCount"] = len(payload["specialistCorrectedSquares"])
    payload["specialistUncertainCount"] = len(payload["specialistUncertainSquares"])
    payload["pieceColorAgreement"] = recognition.get("pieceColorAgreement")
    payload["specialistTypeAgreement"] = recognition.get("specialistTypeAgreement")
    score, reasons = _risk(payload)
    payload["riskScore"] = score
    payload["riskReasons"] = reasons
    return payload


def review_items(job_id: str | None = None) -> list[dict]:
    jobs: list[dict] = []
    if job_id:
        if not admin_core.valid_job_id(job_id):
            raise HTTPException(status_code=400, detail="Job ID không hợp lệ.")
        jobs.append(book_detail(job_id))
    else:
        for book in admin_core.collect_books():
            if str(book.get("status")) not in {"completed", "unknown", "failed"}:
                continue
            try:
                jobs.append(book_detail(str(book["jobId"])))
            except HTTPException:
                continue

    items: list[dict] = []
    for job in jobs:
        for position in job.get("positions", []):
            if not position.get("hasImage"):
                continue
            items.append(_enrich_position(job, position))
    items.sort(key=lambda item: (-float(item["riskScore"]), str(item.get("filename") or ""), int(item["id"])))
    return items


def _diff_kind(before: str | None, after: str | None) -> str:
    if before is None or after is None:
        return "occupancy"
    if before.upper() == after.upper() and before != after:
        return "color"
    if before.upper() != after.upper():
        return "type"
    return "other"


def correction_stats() -> dict:
    kind_counts: Counter[str] = Counter()
    confusions: Counter[str] = Counter()
    corrected_boards = 0
    corrected_squares = 0

    learning_dir = admin_core.LEARNING_DIR
    if learning_dir.exists():
        from .admin_dataset import fen_square_diff

        for path in learning_dir.glob("*.json"):
            data = _read_json(path)
            diffs = fen_square_diff(data.get("aiFen"), data.get("correctedFen"))
            if diffs:
                corrected_boards += 1
            for diff in diffs:
                before = diff.get("aiPiece")
                after = diff.get("correctedPiece")
                kind = _diff_kind(before, after)
                kind_counts[kind] += 1
                corrected_squares += 1
                confusions[f"{before or '∅'}→{after or '∅'}"] += 1

    return {
        "boardsWithCorrections": corrected_boards,
        "correctedSquares": corrected_squares,
        "occupancyErrors": kind_counts["occupancy"],
        "colorErrors": kind_counts["color"],
        "typeErrors": kind_counts["type"],
        "topConfusions": [
            {"pair": pair, "count": count}
            for pair, count in confusions.most_common(12)
        ],
    }


def _batch_targets(job_id: str | None, force: bool, limit: int) -> list[tuple[str, int]]:
    targets: list[tuple[str, int]] = []
    for item in review_items(job_id):
        if item.get("corrected"):
            continue
        if item.get("recognized") and not force:
            continue
        targets.append((str(item["jobId"]), int(item["id"])))
        if len(targets) >= limit:
            break
    return targets


def _run_batch(targets: list[tuple[str, int]], force: bool) -> None:
    from . import main as main_module

    try:
        for job_id, position_id in targets:
            _BATCH_STATE.update(currentJobId=job_id, currentPositionId=position_id)
            try:
                main_module.recognize_position(
                    main_module.RecognizeRequest(jobId=job_id, positionId=position_id, force=force)
                )
                _BATCH_STATE["recognized"] = int(_BATCH_STATE["recognized"]) + 1
            except Exception:
                _BATCH_STATE["failed"] = int(_BATCH_STATE["failed"]) + 1
            finally:
                _BATCH_STATE["processed"] = int(_BATCH_STATE["processed"]) + 1
    except Exception as exc:  # pragma: no cover - defensive thread guard
        _BATCH_STATE["error"] = str(exc)
    finally:
        _BATCH_STATE.update(
            running=False,
            finishedAt=time.time(),
            currentJobId=None,
            currentPositionId=None,
        )
        _BATCH_LOCK.release()


@router.get("/queue")
def admin_review_queue(
    state: str = Query(default="needs-review", pattern="^(needs-review|pending|recognized|corrected|all)$"),
    job_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    principal: AdminPrincipal = Depends(require_permission("admin.read")),
):
    del principal
    items = review_items(job_id)
    if state == "needs-review":
        filtered = [item for item in items if not item["corrected"] and (not item["recognized"] or item["riskScore"] >= 18)]
    elif state == "pending":
        filtered = [item for item in items if not item["recognized"] and not item["corrected"]]
    elif state == "recognized":
        filtered = [item for item in items if item["recognized"] and not item["corrected"]]
    elif state == "corrected":
        filtered = [item for item in items if item["corrected"]]
    else:
        filtered = items

    recognized = sum(1 for item in items if item["recognized"])
    corrected = sum(1 for item in items if item["corrected"])
    pending = sum(1 for item in items if not item["recognized"] and not item["corrected"])
    high_risk = sum(1 for item in items if not item["corrected"] and item["riskScore"] >= 45)
    return {
        "items": filtered[offset:offset + limit],
        "total": len(items),
        "filtered": len(filtered),
        "offset": offset,
        "limit": limit,
        "stats": {
            "recognized": recognized,
            "corrected": corrected,
            "pending": pending,
            "highRisk": high_risk,
            **correction_stats(),
        },
        "model": specialist_status(),
        "batch": dict(_BATCH_STATE),
    }


@router.get("/batch")
def admin_batch_status(
    principal: AdminPrincipal = Depends(require_permission("admin.read")),
):
    del principal
    return dict(_BATCH_STATE)


@router.post("/batch")
def admin_batch_recognize(
    payload: BatchRequest,
    principal: AdminPrincipal = Depends(require_permission("dataset.write")),
):
    del principal
    if payload.jobId and not admin_core.valid_job_id(payload.jobId):
        raise HTTPException(status_code=400, detail="Job ID không hợp lệ.")
    if not _BATCH_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Đang có một batch recognition chạy.")

    try:
        targets = _batch_targets(payload.jobId, payload.force, payload.limit)
        _BATCH_STATE.update(
            running=True,
            startedAt=time.time(),
            finishedAt=None,
            jobId=payload.jobId,
            currentJobId=None,
            currentPositionId=None,
            processed=0,
            recognized=0,
            failed=0,
            skipped=0,
            total=len(targets),
            error=None,
        )
        if not targets:
            _BATCH_STATE.update(running=False, finishedAt=time.time())
            _BATCH_LOCK.release()
            return dict(_BATCH_STATE)

        thread = threading.Thread(
            target=_run_batch,
            args=(targets, payload.force),
            daemon=True,
            name="recognition-review-batch",
        )
        thread.start()
        return dict(_BATCH_STATE)
    except Exception:
        if _BATCH_LOCK.locked():
            _BATCH_LOCK.release()
        raise


@router.post("/{job_id}/{position_id}/confirm")
def admin_confirm_ai(
    job_id: str,
    position_id: int,
    payload: ConfirmRequest,
    principal: AdminPrincipal = Depends(require_permission("dataset.write")),
):
    del principal
    if not admin_core.valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="Job ID không hợp lệ.")
    if position_id < 1 or position_id > 100000:
        raise HTTPException(status_code=400, detail="Position ID không hợp lệ.")

    job_dir = admin_core.OUTPUT_DIR / job_id
    recognition_path = job_dir / f"position-{position_id:04d}.recognition.json"
    recognition = _read_json(recognition_path)
    placement = str(recognition.get("piecePlacement") or "")
    if not placement:
        raise HTTPException(status_code=409, detail="Diagram này chưa có kết quả AI để xác nhận.")
    fen = f"{placement} {payload.sideToMove} - - 0 1"
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=f"FEN AI không hợp lệ: {exc}") from exc
    if not board.is_valid():
        raise HTTPException(status_code=409, detail="FEN AI chưa hợp lệ; hãy mở bàn cờ và sửa tay thay vì xác nhận.")

    from . import main as main_module

    saved = main_module.save_corrected_position(
        job_id,
        position_id,
        main_module.SavePositionRequest(
            fen=board.fen(),
            trialMove=False,
            aiFen=recognition.get("fen") or fen,
            imageOrientation=recognition.get("suggestedOrientation"),
            recognizer="review-confirm",
            preprocessVariant=recognition.get("preprocessVariant"),
        ),
    )
    return {"confirmed": True, "jobId": job_id, "positionId": position_id, "saved": saved}
