from __future__ import annotations

import re
import time
from typing import Any

from fastapi import APIRouter, Depends, Query

from . import admin as admin_core
from .audit_store import audit_stats, list_events, record_event

router = APIRouter(prefix="/audit", dependencies=[Depends(admin_core.require_admin)])

_ID_SEGMENT = re.compile(r"^(?:[0-9a-f]{32}(?:-\d{4})?|\d+)$", re.IGNORECASE)


def _normalized_action(method: str, path: str, route_path: str | None = None) -> tuple[str, str, str | None]:
    raw_parts = [part for part in path.strip("/").split("/") if part]
    template_parts = [part for part in (route_path or path).strip("/").split("/") if part]
    resource_type = template_parts[2] if len(template_parts) > 2 else "admin"
    resource_id: str | None = None
    normalized: list[str] = []

    for absolute_index, template_part in enumerate(template_parts[2:], start=2):
        dynamic = template_part.startswith("{") and template_part.endswith("}")
        raw_part = raw_parts[absolute_index] if absolute_index < len(raw_parts) else ""
        if dynamic or (not route_path and _ID_SEGMENT.fullmatch(template_part)):
            if resource_id is None and absolute_index > 2:
                resource_id = raw_part or template_part
            normalized.append(":id")
        else:
            normalized.append(template_part)

    action_path = "/".join(normalized) or "admin"
    return f"{method.upper()} {action_path}", resource_type, resource_id


def wrap_admin_routes(admin_router: APIRouter) -> None:
    """Audit every mutating admin route without touching request bodies or auth headers."""
    for route in admin_router.routes:
        if getattr(route, "_chessapp_audited", False) or not hasattr(route, "app"):
            continue
        original = route.app
        route_path = str(getattr(route, "path", ""))

        async def audited_app(scope, receive, send, _original=original, _route_path=route_path):
            if scope.get("type") != "http":
                return await _original(scope, receive, send)
            method = str(scope.get("method") or "GET").upper()
            if method in {"GET", "HEAD", "OPTIONS"}:
                return await _original(scope, receive, send)

            path = str(scope.get("path") or "")
            action, resource_type, resource_id = _normalized_action(method, path, _route_path)
            started = time.perf_counter()
            response_status: dict[str, int] = {}

            async def send_with_status(message: dict[str, Any]) -> None:
                if message.get("type") == "http.response.start":
                    response_status["code"] = int(message.get("status", 200))
                await send(message)

            try:
                result = await _original(scope, receive, send_with_status)
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

            code = response_status.get("code", 200)
            record_event(
                action,
                resource_type,
                resource_id,
                status="success" if code < 400 else "failure",
                message=f"HTTP {code}",
                details={
                    "method": method,
                    "path": path,
                    "statusCode": code,
                    "durationMs": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            return result

        route.app = audited_app
        setattr(route, "_chessapp_audited", True)


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
