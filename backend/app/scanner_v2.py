from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import fitz
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .detector import (
    _grid_score,
    detect_boards_in_image,
    docx_image_metadata,
    extract_docx_images,
)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "positions"
BOOK_METADATA = "book.json"
JOB_STATUS = "status.json"
LOW_DETECTOR_CONFIDENCE = 0.76

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/api/scanner/v2", tags=["scanner-v2"])


class RetryPageRequest(BaseModel):
    page: int = Field(ge=1, le=100000)


@dataclass
class JobControl:
    run_event: threading.Event = field(default_factory=threading.Event)
    worker: threading.Thread | None = None

    def __post_init__(self) -> None:
        self.run_event.set()


_CONTROLS: dict[str, JobControl] = {}
_CONTROLS_LOCK = threading.RLock()


def _valid_job_id(job_id: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{32}", job_id))


def _job_dir(job_id: str) -> Path:
    if not _valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="Job id không hợp lệ.")
    path = OUTPUT_DIR / job_id
    if not path.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy job quét sách.")
    return path


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    data = json.dumps(payload, ensure_ascii=False, indent=2)
    temp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    last_error: OSError | None = None
    for attempt in range(8):
        try:
            temp.write_text(data, encoding="utf-8")
            os.replace(temp, path)
            return
        except OSError as exc:
            last_error = exc
            time.sleep(0.03 * (attempt + 1))
    try:
        path.write_text(data, encoding="utf-8")
        temp.unlink(missing_ok=True)
    except OSError:
        if last_error is not None:
            raise last_error
        raise


def _read_json(path: Path, default: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else (default or {})
    except (OSError, json.JSONDecodeError):
        return default or {}


def _source_path(job_id: str, suffix: str | None = None) -> Path:
    if suffix:
        candidate = UPLOAD_DIR / f"{job_id}{suffix}"
        if candidate.exists():
            return candidate
    matches = [path for path in UPLOAD_DIR.glob(f"{job_id}.*") if path.suffix.lower() in {".pdf", ".docx"}]
    if len(matches) != 1:
        raise HTTPException(status_code=404, detail="Không tìm thấy file sách nguồn.")
    return matches[0]


def _source_total(path: Path) -> int:
    if path.suffix.lower() == ".pdf":
        document = fitz.open(path)
        try:
            return len(document)
        finally:
            document.close()
    if path.suffix.lower() == ".docx":
        return sum(1 for _name, _image in extract_docx_images(path))
    raise ValueError("Định dạng sách không được hỗ trợ.")


def _normalize_range(total: int, page_start: int | None, page_end: int | None) -> tuple[int, int]:
    if total < 1:
        raise ValueError("Tài liệu không có trang/ảnh có thể quét.")
    start = 1 if page_start is None else page_start
    end = total if page_end is None else page_end
    if start < 1 or end < 1 or start > end or start > total or end > total:
        raise ValueError(f"Khoảng quét phải nằm trong 1–{total}.")
    return start, end


def _render_pdf_page(path: Path, page_number: int) -> np.ndarray:
    document = fitz.open(path)
    try:
        page = document[page_number - 1]
        pix = page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), alpha=False)
        array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        return cv2.cvtColor(array, cv2.COLOR_RGBA2BGR if pix.n == 4 else cv2.COLOR_RGB2BGR)
    finally:
        document.close()


def _docx_image(path: Path, image_number: int) -> np.ndarray:
    for index, (_name, image) in enumerate(extract_docx_images(path), start=1):
        if index == image_number:
            return image
    raise IndexError(f"Không tìm thấy ảnh số {image_number}.")


def _detect_page(path: Path, page_number: int) -> list[tuple[np.ndarray, float]]:
    if path.suffix.lower() == ".pdf":
        return detect_boards_in_image(_render_pdf_page(path, page_number))

    image = _docx_image(path, page_number)
    ratio = image.shape[1] / max(image.shape[0], 1)
    direct_score = _grid_score(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)) if 0.70 <= ratio <= 1.35 else 0.0
    if direct_score >= 0.58:
        return [(image, direct_score)]
    return detect_boards_in_image(image)


def _position_payload(job_id: str, position_id: int, page: int, score: float) -> dict[str, Any]:
    confidence = round(float(score), 3)
    return {
        "id": position_id,
        "page": page,
        "confidence": confidence,
        "imageUrl": f"/files/{job_id}/position-{position_id:04d}.png",
        "needsReview": confidence < LOW_DETECTOR_CONFIDENCE,
        "source": "scanner-v2",
    }


def _load_positions(job_dir: Path) -> list[dict[str, Any]]:
    book = _read_json(job_dir / BOOK_METADATA)
    positions = book.get("positions", [])
    return [dict(item) for item in positions if isinstance(item, dict)]


def _persist_book(job_id: str, filename: str | None, positions: list[dict[str, Any]], extra: dict[str, Any]) -> None:
    payload = {
        "jobId": job_id,
        "filename": filename,
        "count": len(positions),
        "positions": positions,
        "scannerVersion": 2,
        **extra,
    }
    _write_json_atomic(OUTPUT_DIR / job_id / BOOK_METADATA, payload)


def _status_base(
    job_id: str,
    filename: str | None,
    start: int,
    end: int,
    total_source: int,
    positions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    pages = list(range(start, end + 1))
    return {
        "jobId": job_id,
        "filename": filename,
        "status": "queued",
        "phase": "prepare",
        "current": 0,
        "total": len(pages),
        "progress": 0.0,
        "count": len(positions or []),
        "positions": positions or [],
        "error": None,
        "scannerVersion": 2,
        "pageStart": start,
        "pageEnd": end,
        "sourceTotal": total_source,
        "currentPage": None,
        "processedPages": [],
        "failedPages": [],
        "pageStates": {str(page): "pending" for page in pages},
        "reviewCount": sum(1 for item in (positions or []) if item.get("needsReview")),
    }


def _wait_if_paused(control: JobControl, status_path: Path, status: dict[str, Any]) -> None:
    while not control.run_event.wait(timeout=0.25):
        if status.get("status") != "paused":
            status["status"] = "paused"
            status["phase"] = "paused"
            _write_json_atomic(status_path, status)
    if status.get("status") == "paused":
        status["status"] = "processing"
        status["phase"] = "detect"
        _write_json_atomic(status_path, status)


def _scan_worker(
    job_id: str,
    source: Path,
    filename: str | None,
    start: int,
    end: int,
    total_source: int,
    *,
    preserve_existing: bool = False,
) -> None:
    job_dir = OUTPUT_DIR / job_id
    status_path = job_dir / JOB_STATUS
    with _CONTROLS_LOCK:
        control = _CONTROLS.setdefault(job_id, JobControl())

    positions = _load_positions(job_dir) if preserve_existing else []
    extra = docx_image_metadata(source) if source.suffix.lower() == ".docx" else {}
    status = _status_base(job_id, filename, start, end, total_source, positions)
    status.update(status="processing", phase="detect")
    status.update(extra)
    _write_json_atomic(status_path, status)

    processed = 0
    try:
        for page in range(start, end + 1):
            _wait_if_paused(control, status_path, status)
            status["currentPage"] = page
            status["pageStates"][str(page)] = "processing"
            _write_json_atomic(status_path, status)

            try:
                detected = _detect_page(source, page)
                next_id = max((int(item.get("id", 0)) for item in positions), default=0) + 1
                for crop, score in detected:
                    filename_png = f"position-{next_id:04d}.png"
                    if not cv2.imwrite(str(job_dir / filename_png), crop):
                        raise OSError(f"Không ghi được {filename_png}.")
                    positions.append(_position_payload(job_id, next_id, page, score))
                    next_id += 1
                status["pageStates"][str(page)] = "completed"
                status["processedPages"].append(page)
            except Exception as exc:
                status["pageStates"][str(page)] = "failed"
                status["failedPages"].append({"page": page, "error": str(exc)})

            processed += 1
            status["current"] = processed
            status["progress"] = round(processed / max(1, end - start + 1) * 100, 1)
            status["count"] = len(positions)
            status["positions"] = positions
            status["reviewCount"] = sum(1 for item in positions if item.get("needsReview"))
            _persist_book(job_id, filename, positions, {**extra, "scanRange": {"start": start, "end": end, "sourceTotal": total_source}})
            _write_json_atomic(status_path, status)

        status.update(
            status="completed",
            phase="done",
            currentPage=None,
            current=end - start + 1,
            progress=100.0,
            count=len(positions),
            positions=positions,
            error=None,
        )
        _write_json_atomic(status_path, status)
    except Exception as exc:
        status.update(status="failed", phase="failed", error=str(exc), count=len(positions), positions=positions)
        _write_json_atomic(status_path, status)


def _start_thread(
    job_id: str,
    source: Path,
    filename: str | None,
    start: int,
    end: int,
    total_source: int,
    *,
    preserve_existing: bool = False,
) -> None:
    with _CONTROLS_LOCK:
        current = _CONTROLS.get(job_id)
        if current and current.worker and current.worker.is_alive():
            raise HTTPException(status_code=409, detail="Job này đang được quét.")
        control = JobControl()
        thread = threading.Thread(
            target=_scan_worker,
            args=(job_id, source, filename, start, end, total_source),
            kwargs={"preserve_existing": preserve_existing},
            daemon=True,
            name=f"scanner-v2-{job_id[:8]}",
        )
        control.worker = thread
        _CONTROLS[job_id] = control
        thread.start()


def _remove_page_positions(job_id: str, page: int) -> list[dict[str, Any]]:
    job_dir = _job_dir(job_id)
    book_path = job_dir / BOOK_METADATA
    book = _read_json(book_path)
    kept: list[dict[str, Any]] = []
    removed_ids: list[int] = []
    for item in book.get("positions", []):
        if isinstance(item, dict) and int(item.get("page", -1)) == page:
            removed_ids.append(int(item.get("id", 0)))
        elif isinstance(item, dict):
            kept.append(dict(item))
    for position_id in removed_ids:
        for path in job_dir.glob(f"position-{position_id:04d}.*"):
            try:
                path.unlink()
            except OSError:
                pass
    book["positions"] = kept
    book["count"] = len(kept)
    _write_json_atomic(book_path, book)
    return kept


@router.post("/start")
def start_scan_v2(
    file: UploadFile = File(...),
    page_start: int | None = Form(default=None),
    page_end: int | None = Form(default=None),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ PDF và DOCX.")

    job_id = uuid.uuid4().hex
    source = UPLOAD_DIR / f"{job_id}{suffix}"
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    with source.open("wb") as target:
        while chunk := file.file.read(1024 * 1024):
            target.write(chunk)

    try:
        total_source = _source_total(source)
        start, end = _normalize_range(total_source, page_start, page_end)
    except Exception as exc:
        source.unlink(missing_ok=True)
        try:
            job_dir.rmdir()
        except OSError:
            pass
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    initial = _status_base(job_id, file.filename, start, end, total_source)
    _write_json_atomic(job_dir / JOB_STATUS, initial)
    _start_thread(job_id, source, file.filename, start, end, total_source)
    return initial


@router.get("/jobs/{job_id}")
def get_job_v2(job_id: str):
    status_path = _job_dir(job_id) / JOB_STATUS
    status = _read_json(status_path)
    if not status:
        raise HTTPException(status_code=404, detail="Không có trạng thái scan.")
    return status


@router.post("/jobs/{job_id}/pause")
def pause_job_v2(job_id: str):
    _job_dir(job_id)
    with _CONTROLS_LOCK:
        control = _CONTROLS.get(job_id)
        if not control or not control.worker or not control.worker.is_alive():
            raise HTTPException(status_code=409, detail="Job không còn chạy để tạm dừng.")
        control.run_event.clear()
    status_path = OUTPUT_DIR / job_id / JOB_STATUS
    status = _read_json(status_path)
    status.update(status="paused", phase="paused")
    _write_json_atomic(status_path, status)
    return status


@router.post("/jobs/{job_id}/resume")
def resume_job_v2(job_id: str):
    _job_dir(job_id)
    with _CONTROLS_LOCK:
        control = _CONTROLS.get(job_id)
        if not control or not control.worker or not control.worker.is_alive():
            raise HTTPException(status_code=409, detail="Worker không còn tồn tại; hãy retry trang lỗi hoặc quét lại.")
        control.run_event.set()
    status_path = OUTPUT_DIR / job_id / JOB_STATUS
    status = _read_json(status_path)
    status.update(status="processing", phase="detect")
    _write_json_atomic(status_path, status)
    return status


@router.post("/jobs/{job_id}/retry-page")
def retry_page_v2(job_id: str, payload: RetryPageRequest):
    job_dir = _job_dir(job_id)
    status = _read_json(job_dir / JOB_STATUS)
    if status.get("status") in {"queued", "processing", "paused"}:
        raise HTTPException(status_code=409, detail="Hãy đợi job hiện tại kết thúc trước khi retry trang.")
    source = _source_path(job_id)
    total_source = _source_total(source)
    if payload.page > total_source:
        raise HTTPException(status_code=400, detail=f"Trang/ảnh phải nằm trong 1–{total_source}.")

    _remove_page_positions(job_id, payload.page)
    filename = status.get("filename") or _read_json(job_dir / BOOK_METADATA).get("filename")
    retry_status = _status_base(job_id, filename, payload.page, payload.page, total_source, _load_positions(job_dir))
    retry_status["retryPage"] = payload.page
    _write_json_atomic(job_dir / JOB_STATUS, retry_status)
    _start_thread(job_id, source, filename, payload.page, payload.page, total_source, preserve_existing=True)
    return retry_status


@router.get("/books/{job_id}/review")
def review_queue_v2(job_id: str):
    job_dir = _job_dir(job_id)
    positions = _load_positions(job_dir)
    review = [item for item in positions if bool(item.get("needsReview"))]
    review.sort(key=lambda item: (float(item.get("confidence", 1)), int(item.get("page", 0)), int(item.get("id", 0))))
    return {
        "jobId": job_id,
        "threshold": LOW_DETECTOR_CONFIDENCE,
        "count": len(review),
        "positions": review,
    }
