from __future__ import annotations

from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from .auth import current_user_id
from .services_profile import build_profile_summary, build_security_report, collect_user_export

router = APIRouter(prefix="/profile", tags=["profile"])


def _db_path(request: Request):
    return getattr(request.app.state, "db_path", None)


@router.get("/summary")
def profile_summary(
    request: Request,
    user_id: str = Depends(current_user_id),
) -> dict[str, object]:
    return build_profile_summary(_db_path(request), user_id)


@router.get("/security")
def profile_security(
    request: Request,
    user_id: str = Depends(current_user_id),
) -> dict[str, object]:
    return build_security_report(_db_path(request), user_id)


@router.get("/export")
def profile_export(
    request: Request,
    user_id: str = Depends(current_user_id),
) -> JSONResponse:
    """完整数据副本：把该账号在本地库中的全部记录导出为一个 JSON 文件。"""
    payload = collect_user_export(_db_path(request), user_id)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = quote(f"ruanchuang-export-{stamp}.json")
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
        },
    )
