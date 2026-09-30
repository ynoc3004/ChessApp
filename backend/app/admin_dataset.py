from __future__ import annotations

import json
import re
import time
import zipfile
from collections import Counter
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from .admin import DATA_DIR, LEARNING_DIR, read_json

router = APIRouter(prefix="/dataset")
EXPORT_PATH = DATA_DIR / "admin-dataset-export.zip"
SAMPLE_ID = re.compile(r"[0-9a-f]{32}-\d{4}")


def _sample_files() -> list[Path]:
    if not LEARNING_DIR.exists():
        return []
    return sorted(
        LEARNING_DIR.glob("*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def _board_map(fen: str | None) -> dict[str, str] | None:
    if not fen:
        return None
    placement = str(fen).strip().split()[0]
    ranks = placement.split("/")
    if len(ranks) != 8:
        return None

    board: dict[str, str] = {}
    files = "abcdefgh"
    for rank_index, encoded in enumerate(ranks):
        file_index = 0
        for token in encoded:
            if token.isdigit():
                width = int(token)
                if width < 1 or width > 8:
                    return None
                file_index += width
                continue
            if token not in "prnbqkPRNBQK" or file_index >= 8:
                return None
            board[f"{files[file_index]}{8 - rank_index}"] = token
            file_index += 1
        if file_index != 8:
            return None
    return board


def fen_square_diff(ai_fen: str | None, corrected_fen: str | None) -> list[dict]:
    ai_board = _board_map(ai_fen)
    corrected_board = _board_map(corrected_fen)
    if ai_board is None or corrected_board is None:
        return []

    diffs = []
    for rank in range(8, 0, -1):
        for file_name in "abcdefgh":
            square = f"{file_name}{rank}"
            before = ai_board.get(square)
            after = corrected_board.get(square)
            if before != after:
                diffs.append({"square": square, "aiPiece": before, "correctedPiece": after})
    return diffs


def _image_path(data: dict, sample_id: str) -> Path:
    raw_name = str(data.get("image") or f"{sample_id}.png")
    safe_name = Path(raw_name).name
    return LEARNING_DIR / safe_name


def sample_record(path: Path) -> dict:
    data = read_json(path)
    sample_id = str(data.get("sampleId") or path.stem)
    image_path = _image_path(data, sample_id)
    ai_fen = data.get("aiFen")
    corrected_fen = data.get("correctedFen")
    diffs = fen_square_diff(ai_fen, corrected_fen)
    changed = bool(ai_fen and corrected_fen and ai_fen != corrected_fen)
    return {
        "sampleId": sample_id,
        "jobId": data.get("jobId"),
        "positionId": data.get("positionId"),
        "correctedFen": corrected_fen,
        "aiFen": ai_fen,
        "recognizer": data.get("recognizer"),
        "preprocessVariant": data.get("preprocessVariant"),
        "imageOrientation": data.get("imageOrientation"),
        "corners": data.get("corners"),
        "savedAt": data.get("savedAt") or path.stat().st_mtime,
        "hasImage": image_path.exists(),
        "imageBytes": image_path.stat().st_size if image_path.exists() else 0,
        "changed": changed,
        "changedSquares": len(diffs),
        "validCorrectedFen": _board_map(corrected_fen) is not None,
        "validAiFen": _board_map(ai_fen) is not None if ai_fen else False,
        "diffs": diffs,
    }


def dataset_stats() -> dict:
    records = [sample_record(path) for path in _sample_files()]
    recognizers: Counter[str] = Counter()
    preprocess: Counter[str] = Counter()
    orientations: Counter[str] = Counter()
    square_errors: Counter[str] = Counter()

    for record in records:
        recognizers[str(record.get("recognizer") or "Không rõ")] += 1
        preprocess[str(record.get("preprocessVariant") or "Không rõ")] += 1
        orientations[str(record.get("imageOrientation") or "Không rõ")] += 1
        for diff in record["diffs"]:
            square_errors[diff["square"]] += 1

    changed = [record for record in records if record["changed"]]
    with_image = [record for record in records if record["hasImage"]]
    total_changed_squares = sum(record["changedSquares"] for record in changed)
    return {
        "total": len(records),
        "changed": len(changed),
        "confirmed": sum(1 for record in records if record["aiFen"] and not record["changed"]),
        "missingAiFen": sum(1 for record in records if not record["aiFen"]),
        "withImage": len(with_image),
        "missingImage": len(records) - len(with_image),
        "invalidCorrectedFen": sum(1 for record in records if not record["validCorrectedFen"]),
        "datasetBytes": sum(int(record["imageBytes"]) for record in records) + sum(
            path.stat().st_size for path in _sample_files()
        ),
        "averageChangedSquares": round(total_changed_squares / len(changed), 2) if changed else 0,
        "recognizers": [{"name": name, "count": count} for name, count in recognizers.most_common()],
        "preprocessVariants": [{"name": name, "count": count} for name, count in preprocess.most_common()],
        "orientations": [{"name": name, "count": count} for name, count in orientations.most_common()],
        "topErrorSquares": [{"square": square, "count": count} for square, count in square_errors.most_common(16)],
    }


def _matches(record: dict, query: str, state: str, recognizer: str, preprocess: str) -> bool:
    needle = query.strip().lower()
    if needle:
        haystack = " ".join(
            str(record.get(key) or "")
            for key in ("sampleId", "jobId", "positionId", "aiFen", "correctedFen")
        ).lower()
        if needle not in haystack:
            return False
    if state == "changed" and not record["changed"]:
        return False
    if state == "confirmed" and (record["changed"] or not record["aiFen"]):
        return False
    if state == "missing-ai" and record["aiFen"]:
        return False
    if state == "missing-image" and record["hasImage"]:
        return False
    if state == "invalid" and record["validCorrectedFen"]:
        return False
    if recognizer and str(record.get("recognizer") or "Không rõ") != recognizer:
        return False
    if preprocess and str(record.get("preprocessVariant") or "Không rõ") != preprocess:
        return False
    return True


@router.get("/stats")
def admin_dataset_stats():
    return dataset_stats()


@router.get("/samples")
def admin_dataset_samples(
    query: str = Query(default="", max_length=200),
    state: str = Query(default="all", pattern="^(all|changed|confirmed|missing-ai|missing-image|invalid)$"),
    recognizer: str = Query(default="", max_length=100),
    preprocess: str = Query(default="", max_length=100),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    records = [sample_record(path) for path in _sample_files()]
    filtered = [record for record in records if _matches(record, query, state, recognizer, preprocess)]
    return {
        "samples": filtered[offset:offset + limit],
        "total": len(records),
        "filtered": len(filtered),
        "offset": offset,
        "limit": limit,
    }


@router.get("/samples/{sample_id}")
def admin_dataset_sample(sample_id: str):
    if not SAMPLE_ID.fullmatch(sample_id):
        raise HTTPException(status_code=400, detail="Sample ID không hợp lệ.")
    path = LEARNING_DIR / f"{sample_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy sample.")
    return sample_record(path)


@router.get("/export")
def admin_dataset_export(changed_only: bool = Query(default=False)):
    records = [sample_record(path) for path in _sample_files()]
    selected = [record for record in records if not changed_only or record["changed"]]
    usable = [record for record in selected if record["hasImage"] and record["validCorrectedFen"]]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = EXPORT_PATH.with_suffix(".tmp.zip")
    manifest_lines = []
    with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for record in usable:
            metadata_path = LEARNING_DIR / f"{record['sampleId']}.json"
            metadata = read_json(metadata_path)
            image_path = _image_path(metadata, record["sampleId"])
            image_name = f"images/{record['sampleId']}{image_path.suffix.lower() or '.png'}"
            archive.write(image_path, arcname=image_name)
            manifest_lines.append(json.dumps({
                "sampleId": record["sampleId"],
                "image": image_name,
                "correctedFen": record["correctedFen"],
                "aiFen": record["aiFen"],
                "changed": record["changed"],
                "changedSquares": record["changedSquares"],
                "recognizer": record["recognizer"],
                "preprocessVariant": record["preprocessVariant"],
                "imageOrientation": record["imageOrientation"],
                "corners": record["corners"],
                "savedAt": record["savedAt"],
            }, ensure_ascii=False))
        archive.writestr("dataset.jsonl", "\n".join(manifest_lines) + ("\n" if manifest_lines else ""))
        archive.writestr("summary.json", json.dumps({
            "exportedAt": time.time(),
            "changedOnly": changed_only,
            "selected": len(selected),
            "exported": len(usable),
            "skipped": len(selected) - len(usable),
        }, ensure_ascii=False, indent=2))

    tmp_path.replace(EXPORT_PATH)
    return FileResponse(
        EXPORT_PATH,
        media_type="application/zip",
        filename="chessapp-ai-dataset.zip",
    )
