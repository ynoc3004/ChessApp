from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from .admin import OUTPUT_DIR
from .admin_auth import AdminPrincipal, require_permission
from .specialist_model import specialist_status, train_specialist_model

router = APIRouter(prefix="/dataset/model")


def _clear_recognition_caches(output_dir: Path = OUTPUT_DIR) -> int:
    cleared = 0
    if not output_dir.exists():
        return cleared
    for path in output_dir.glob("*/position-*.recognition.json"):
        try:
            path.unlink()
            cleared += 1
        except OSError:
            continue
    return cleared


@router.get("")
def admin_specialist_model_status(
    principal: AdminPrincipal = Depends(require_permission("admin.read")),
):
    del principal
    return specialist_status()


@router.post("/train")
def admin_train_specialist_model(
    principal: AdminPrincipal = Depends(require_permission("dataset.write")),
):
    del principal
    try:
        metadata = train_specialist_model()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Huấn luyện model thất bại: {exc}") from exc

    # A newly trained specialist must not be hidden behind old board-recognition
    # caches. Manual corrections (.user.json) are intentionally untouched.
    cleared = _clear_recognition_caches()
    return {
        "trained": True,
        "clearedRecognitionCaches": cleared,
        "model": specialist_status(),
        "training": metadata,
    }
