from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from . import admin as admin_core
from .audit_store import audit_stats, list_events

router = APIRouter(prefix="/audit", dependencies=[Depends(admin_core.require_admin)])


@router.get("")
def admin_audit_events(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    q: str = Query(default="", max_length=160),
    action: str = Query(default="", max_length=100),
    resource_type: str = Query(default="", max_length=100),
    status: str = Query(default="", max_length=20),
):
    return list_events(
        limit=limit,
        offset=offset,
        q=q,
        action=action,
        resource_type=resource_type,
        status=status,
    )


@router.get("/stats")
def admin_audit_stats():
    return audit_stats()
