from __future__ import annotations

import json
import shutil
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from . import admin as admin_core

OUTPUT_DIR = admin_core.OUTPUT_DIR
UPLOAD_DIR = admin_core.UPLOAD_DIR
BOOK_METADATA = admin_core.BOOK_METADATA
JOB_STATUS = admin_core.JOB_STATUS

router = APIRouter(prefix="/books", dependencies=[Depends(admin_core.require_admin)])


def _job_dir(job_id: str) -> Path:
    if not admin_core.valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="Job ID không hợp lệ.")
    path = OUTPUT_DIR / job_id
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Không tìm thấy kỳ phổ.")
    return path


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _status(job_dir: Path) -> dict:
    path = job_dir / JOB_STATUS
    return admin_core.read_json(path) if path.exists() else {}


def _ensure_idle(job_dir: Path) -> None:
    state = str(_status(job_dir).get("status") or "")
    if state in {"queued", "processing"}:
        raise HTTPException(status_code=409, detail="Kỳ phổ đang được quét. Hãy chờ job hiện tại hoàn tất.")


def _position_id(value: int) -> int:
    if value < 1 or value > 100000:
        raise HTTPException(status_code=400, detail="Position ID không hợp lệ.")
    return value


def _position_payload(job_dir: Path, item: dict) -> dict:
    try:
        position_id = int(item.get("id"))
    except (TypeError, ValueError):
        return {}

    stem = f"position-{position_id:04d}"
    image_path = job_dir / f"{stem}.png"
    recognition_path = job_dir / f"{stem}.recognition.json"
    saved_path = job_dir / f"{stem}.user.json"
    recognition = admin_core.read_json(recognition_path) if recognition_path.exists() else {}
    saved = admin_core.read_json(saved_path) if saved_path.exists() else {}

    recognized = bool(recognition)
    corrected = bool(saved.get("fen"))
    state = "corrected" if corrected else ("recognized" if recognized else "pending")
    variants = sum(
        int((job_dir / f"{stem}.{variant}.png").exists())
        for variant in ("contrast", "binary", "dehatch")
    )

    return {
        "id": position_id,
        "page": item.get("page"),
        "confidence": item.get("confidence"),
        "imageUrl": item.get("imageUrl") or f"/files/{job_dir.name}/{stem}.png",
        "hasImage": image_path.exists(),
        "imageBytes": image_path.stat().st_size if image_path.exists() else 0,
        "state": state,
        "recognized": recognized,
        "corrected": corrected,
        "aiFen": recognition.get("fen"),
        "savedFen": saved.get("fen"),
        "averageConfidence": recognition.get("averageConfidence"),
        "suggestedOrientation": recognition.get("suggestedOrientation"),
        "uncertainSquares": recognition.get("uncertainSquares", []),
        "savedAt": saved.get("savedAt"),
        "recognitionUpdatedAt": recognition_path.stat().st_mtime if recognition_path.exists() else None,
        "variantCount": variants,
    }


def book_detail(job_id: str) -> dict:
    job_dir = _job_dir(job_id)
    metadata_path = job_dir / BOOK_METADATA
    status_path = job_dir / JOB_STATUS
    metadata = admin_core.read_json(metadata_path) if metadata_path.exists() else {}
    status = admin_core.read_json(status_path) if status_path.exists() else {}
    if not metadata and not status:
        raise HTTPException(status_code=404, detail="Kỳ phổ chưa có metadata.")

    source = admin_core.source_file(job_id)
    raw_positions = metadata.get("positions") or status.get("positions") or []
    positions = []
    for item in raw_positions:
        if not isinstance(item, dict):
            continue
        payload = _position_payload(job_dir, item)
        if payload:
            positions.append(payload)
    positions.sort(key=lambda item: int(item["id"]))

    recognized = sum(1 for item in positions if item["recognized"])
    corrected = sum(1 for item in positions if item["corrected"])
    pending = sum(1 for item in positions if not item["recognized"] and not item["corrected"])
    missing_images = sum(1 for item in positions if not item["hasImage"])
    state = status.get("status") or ("completed" if metadata else "unknown")

    return {
        "jobId": job_id,
        "filename": metadata.get("filename") or status.get("filename") or (source.name if source else "Không rõ"),
        "status": state,
        "progress": float(status.get("progress", 100 if state == "completed" else 0) or 0),
        "error": status.get("error"),
        "count": len(positions),
        "updatedAt": max(
            (path.stat().st_mtime for path in (metadata_path, status_path) if path.exists()),
            default=0.0,
        ),
        "source": {
            "available": bool(source),
            "extension": source.suffix.lower() if source else None,
            "bytes": source.stat().st_size if source else 0,
        },
        "dataBytes": admin_core.directory_size(job_dir),
        "stats": {
            "recognized": recognized,
            "corrected": corrected,
            "pending": pending,
            "missingImages": missing_images,
        },
        "positions": positions,
    }


def _delete_cached_files(job_dir: Path, stem: str | None = None) -> dict:
    recognition_pattern = f"{stem}.recognition.json" if stem else "position-*.recognition.json"
    variant_patterns = (
        f"{stem}.contrast.png" if stem else "position-*.contrast.png",
        f"{stem}.binary.png" if stem else "position-*.binary.png",
        f"{stem}.dehatch.png" if stem else "position-*.dehatch.png",
    )
    removed_recognition = 0
    removed_variants = 0

    for path in job_dir.glob(recognition_pattern):
        path.unlink(missing_ok=True)
        removed_recognition += 1
    for pattern in variant_patterns:
        for path in job_dir.glob(pattern):
            path.unlink(missing_ok=True)
            removed_variants += 1

    export = job_dir / "recognized-positions.json"
    export.unlink(missing_ok=True)
    return {"recognition": removed_recognition, "variants": removed_variants}


def _start_scan(job_id: str, source: Path, suffix: str, filename: str) -> None:
    from . import main as main_module

    worker = threading.Thread(
        target=main_module._scan_book_job,
        args=(job_id, source, suffix, filename),
        daemon=True,
        name=f"admin-rescan-{job_id[:8]}",
    )
    worker.start()


@router.get("/{job_id}")
def admin_book_detail(job_id: str):
    return book_detail(job_id)


@router.post("/{job_id}/rescan")
def admin_rescan_book(job_id: str):
    job_dir = _job_dir(job_id)
    _ensure_idle(job_dir)
    source = admin_core.source_file(job_id)
    if source is None:
        raise HTTPException(status_code=409, detail="File nguồn không còn trên máy nên không thể quét lại.")
    suffix = source.suffix.lower()
    if suffix not in {".pdf", ".docx"}:
        raise HTTPException(status_code=409, detail="Định dạng file nguồn không còn được hỗ trợ.")

    metadata = admin_core.read_json(job_dir / BOOK_METADATA)
    status = _status(job_dir)
    filename = str(metadata.get("filename") or status.get("filename") or source.name)

    shutil.rmtree(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)
    queued = {
        "jobId": job_id,
        "filename": filename,
        "status": "queued",
        "current": 0,
        "total": 0,
        "progress": 0.0,
        "count": 0,
        "positions": [],
        "error": None,
        "requestedAt": time.time(),
    }
    _write_json(job_dir / JOB_STATUS, queued)
    _start_scan(job_id, source, suffix, filename)
    return queued


@router.delete("/{job_id}/recognition-cache")
def admin_clear_recognition_cache(job_id: str):
    job_dir = _job_dir(job_id)
    _ensure_idle(job_dir)
    removed = _delete_cached_files(job_dir)
    return {"ok": True, "jobId": job_id, "removed": removed}


@router.delete("/{job_id}/positions/{position_id}/recognition")
def admin_clear_position_recognition(job_id: str, position_id: int):
    job_dir = _job_dir(job_id)
    _ensure_idle(job_dir)
    position_id = _position_id(position_id)
    stem = f"position-{position_id:04d}"
    if not (job_dir / f"{stem}.png").exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy diagram.")
    removed = _delete_cached_files(job_dir, stem)
    return {"ok": True, "jobId": job_id, "positionId": position_id, "removed": removed}


@router.post("/{job_id}/positions/{position_id}/recognize")
def admin_recognize_position(job_id: str, position_id: int, force: bool = False):
    job_dir = _job_dir(job_id)
    _ensure_idle(job_dir)
    position_id = _position_id(position_id)
    if not (job_dir / f"position-{position_id:04d}.png").exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy diagram.")

    from . import main as main_module

    return main_module.recognize_position(
        main_module.RecognizeRequest(jobId=job_id, positionId=position_id, force=force)
    )


@router.delete("/{job_id}/positions/{position_id}")
def admin_delete_position(job_id: str, position_id: int):
    job_dir = _job_dir(job_id)
    _ensure_idle(job_dir)
    position_id = _position_id(position_id)
    metadata_path = job_dir / BOOK_METADATA
    metadata = admin_core.read_json(metadata_path)
    positions = metadata.get("positions")
    if not isinstance(positions, list):
        raise HTTPException(status_code=404, detail="Kỳ phổ chưa có danh sách diagram.")

    remaining = []
    found = False
    for item in positions:
        try:
            same = isinstance(item, dict) and int(item.get("id")) == position_id
        except (TypeError, ValueError):
            same = False
        if same:
            found = True
        else:
            remaining.append(item)
    if not found:
        raise HTTPException(status_code=404, detail="Không tìm thấy diagram.")

    stem = f"position-{position_id:04d}"
    for path in job_dir.glob(f"{stem}*"):
        if path.is_file():
            path.unlink(missing_ok=True)
    (job_dir / "recognized-positions.json").unlink(missing_ok=True)
    (job_dir / "chess-diagrams.zip").unlink(missing_ok=True)

    metadata["positions"] = remaining
    metadata["count"] = len(remaining)
    _write_json(metadata_path, metadata)

    status_path = job_dir / JOB_STATUS
    if status_path.exists():
        status = admin_core.read_json(status_path)
        status["positions"] = remaining
        status["count"] = len(remaining)
        _write_json(status_path, status)

    return {"deleted": True, "jobId": job_id, "positionId": position_id, "count": len(remaining)}


@router.get("/{job_id}/download")
def admin_download_book(job_id: str):
    _job_dir(job_id)
    from . import main as main_module
    return main_module.download_book_diagrams(job_id)


@router.get("/{job_id}/recognized.json")
def admin_download_recognized(job_id: str):
    _job_dir(job_id)
    from . import main as main_module
    return main_module.download_recognized_positions(job_id)
