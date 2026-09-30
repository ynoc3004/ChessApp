from __future__ import annotations

import re
import time

from fastapi import APIRouter, Depends, Query, Request

from . import admin as admin_core
from .audit_store import audit_stats, list_events, record_event

router = APIRouter(prefix="/audit", dependencies=[Depends(admin_core.require_admin)])

_ID_SEGMENT = re.compile(r"^(?:[0-9a-f]{32}(?:-\d{4})?|\d+)$", re.IGNORECASE)


def _normalized_action(method: str, path: str) -> tuple[str, str, str | None]:
    parts = [part for part in path.strip("/").split("/") if part]
    # /api/admin/<resource>/...
    resource_type = parts[2] if len(parts) > 2 else "admin"
    resource_id: str | None = None
    normalized: list[str] = []
    for index, part in enumerate(parts[2:]):
        if _ID_SEGMENT.fullmatch(part):
            if resource_id is None and index > 0:
                resource_id = part
            normalized.append(":id")
        else:
            normalized.append(part)
    action_path = "/".join(normalized) or "admin"
    return f"{method.upper()} {action_path}", resource_type, resource_id


async def audit_admin_mutations(request: Request, call_next):
    path = request.url.path
    method = request.method.upper()
    should_log = path.startswith("/api/admin/") and method not in {"GET", "HEAD", "OPTIONS"}
    if not should_log:
        return await call_next(request)

    started = time.perf_counter()
    action, resource_type, resource_id = _normalized_action(method, path)
    try:
        response = await call_next(request)
    except Exception as exc:
        record_event(
            action,
            resource_type,
            resource_id,
            status="failure",
            message=type(exc).__name__,
            details={
                "method": method,
                "path": path,
                "durationMs": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        raise

    status = "success" if response.status_code < 400 else "failure"
    record_event(
        action,
        resource_type,
        resource_id,
        status=status,
        message=f"HTTP {response.status_code}",
        details={
            "method": method,
            "path": path,
            "statusCode": response.status_code,
            "durationMs": round((time.perf_counter() - started) * 1000, 2),
        },
    )
    return response


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
