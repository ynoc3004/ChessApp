from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .admin_auth import AdminPrincipal, require_permission
from .specialist_model import specialist_status, train_specialist_model

router = APIRouter(prefix="/dataset/model")


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
    return {"trained": True, "model": specialist_status(), "training": metadata}
