"""CBT subject-change requests.

Students whose SSCE subjects were locked at first practice start can ask the
admin to change them. Admin approves → profile subjects update and the lock
stays on. Admin rejects → nothing changes. Mirrors desktop admin approvals UX.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import engine, get_db
from app.core.datetime_utils import naive_utc_now
from app.core.deps import require_admin, require_student_or_kind
from app.services.cbt_engine import _norm_subject, subjects_match

logger = logging.getLogger(__name__)

router = APIRouter(tags=["CBT subject change"])

STATUSES = ("pending", "approved", "rejected")


def _ensure_schema_stmts() -> tuple[str, ...]:
    return (
        """
        CREATE TABLE IF NOT EXISTS cbt_subject_change_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id UUID NOT NULL REFERENCES users(id),
            board VARCHAR(30) NOT NULL,
            old_subjects JSON NOT NULL DEFAULT '[]',
            new_subjects JSON NOT NULL DEFAULT '[]',
            reason VARCHAR(500) NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            reviewed_by UUID NULL REFERENCES users(id),
            reviewed_at TIMESTAMP NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """,
        "ALTER TABLE cbt_subject_change_requests ADD COLUMN IF NOT EXISTS reason VARCHAR(500) NULL",
        "ALTER TABLE cbt_subject_change_requests ADD COLUMN IF NOT EXISTS reviewed_by UUID NULL",
        "ALTER TABLE cbt_subject_change_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL",
        "CREATE INDEX IF NOT EXISTS ix_cbt_scr_student_id ON cbt_subject_change_requests (student_id)",
        "CREATE INDEX IF NOT EXISTS ix_cbt_scr_status ON cbt_subject_change_requests (status)",
    )


async def ensure_subject_change_schema() -> None:
    try:
        async with engine.begin() as conn:
            for stmt in _ensure_schema_stmts():
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    logger.warning("subject-change schema stmt skipped: %s", exc)
    except Exception as exc:
        logger.warning("ensure_subject_change_schema failed: %s", exc)


class SubjectChangeRequestIn(BaseModel):
    board: str = Field(..., description="WAEC | NECO (or JAMB)")
    new_subjects: list[str] = Field(..., min_length=1, max_length=12)
    reason: str | None = Field(None, max_length=500)


class SubjectChangeReview(BaseModel):
    request_id: str
    decision: str  # approve | reject
    note: str | None = None


async def _load_own_requests(db: AsyncSession, student_id: str) -> list[dict]:
    rows = (
        await db.execute(
            text(
                """
                SELECT id, board, old_subjects, new_subjects, reason, status,
                       reviewed_at, created_at
                FROM cbt_subject_change_requests
                WHERE student_id = CAST(:sid AS uuid)
                ORDER BY created_at DESC
                LIMIT 20
                """
            ),
            {"sid": str(student_id)},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


@router.post("/cbt/subject-change-requests")
async def create_subject_change_request(
    payload: SubjectChangeRequestIn,
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    await ensure_subject_change_schema()
    from app.models.user import StudentProfile

    board = (payload.board or "").upper().strip()
    if board not in {"WAEC", "NECO", "JAMB"}:
        raise HTTPException(status_code=400, detail="Board must be WAEC, NECO or JAMB")

    new_subjects = [s.strip() for s in (payload.new_subjects or []) if s and s.strip()]
    if not new_subjects:
        raise HTTPException(status_code=400, detail="Select at least one subject")
    if len(set(new_subjects)) != len(new_subjects):
        raise HTTPException(status_code=400, detail="Duplicate subjects in request")
    if len(new_subjects) > 9:
        raise HTTPException(status_code=400, detail="Maximum 9 subjects per request")

    sid = str(current_user["sub"])
    profile = (
        await db.execute(select(StudentProfile).where(StudentProfile.user_id == sid))
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Complete your profile first")

    # Current subjects for the chosen board
    if board == "JAMB":
        old_subjects = list(profile.jamb_subjects or [])
    else:
        old_subjects = list(profile.ssce_subjects or [])
        if profile.ssce_exam_type and (profile.ssce_exam_type or "").upper() != board:
            # Student practising WAEC while profile says NECO: allow the change,
            # it effectively re-registers them under the new board.
            old_subjects = []

    # A subject change means the SSCE board type may flip too (WAEC ↔ NECO)
    # — that's fine; approval writes ssce_exam_type = board.

    # Block duplicate pending request for the same board
    pending = (
        await db.execute(
            text(
                """
                SELECT id FROM cbt_subject_change_requests
                WHERE student_id = CAST(:sid AS uuid)
                  AND board = :board
                  AND status = 'pending'
                LIMIT 1
                """
            ),
            {"sid": sid, "board": board},
        )
    ).first()
    if pending:
        raise HTTPException(
            status_code=409,
            detail="You already have a pending subject-change request for this exam. Wait for admin review.",
        )

    import json as _json

    rid = uuid.uuid4()
    await db.execute(
        text(
            """
            INSERT INTO cbt_subject_change_requests (
                id, student_id, board, old_subjects, new_subjects, reason, status, created_at
            ) VALUES (
                CAST(:id AS uuid), CAST(:sid AS uuid), :board,
                CAST(:old_s AS json), CAST(:new_s AS json), :reason, 'pending', :now
            )
            """
        ),
        {
            "id": str(rid),
            "sid": sid,
            "board": board,
            "old_s": _json.dumps(old_subjects),
            "new_s": _json.dumps(new_subjects),
            "reason": (payload.reason or "").strip()[:500] or None,
            "now": naive_utc_now(),
        },
    )
    await db.commit()
    return {
        "ok": True,
        "request_id": str(rid),
        "message": "Request sent to admin. Your subjects stay locked until it is approved.",
    }


@router.get("/cbt/subject-change-requests/mine")
async def my_subject_change_requests(
    current_user: dict = Depends(require_student_or_kind),
    db: AsyncSession = Depends(get_db),
):
    await ensure_subject_change_schema()
    rows = await _load_own_requests(db, current_user["sub"])
    import json as _json

    out = []
    for r in rows:
        out.append(
            {
                "id": str(r["id"]),
                "board": r["board"],
                "old_subjects": _parse_json_list(r["old_subjects"], _json),
                "new_subjects": _parse_json_list(r["new_subjects"], _json),
                "reason": r["reason"],
                "status": r["status"],
                "reviewed_at": r["reviewed_at"].isoformat() if r["reviewed_at"] else None,
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
        )
    return {"requests": out}


def _parse_json_list(raw, _json) -> list:
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        try:
            data = _json.loads(raw)
            return [str(x) for x in data] if isinstance(data, list) else []
        except Exception:
            return []
    return []


@router.get("/admin/cbt/subject-change-requests")
async def admin_list_subject_change_requests(
    status: str | None = None,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await ensure_subject_change_schema()
    wanted = (status or "pending").lower().strip()
    if wanted not in STATUSES:
        wanted = "pending"
    rows = (
        await db.execute(
            text(
                """
                SELECT r.id, r.student_id, r.board, r.old_subjects, r.new_subjects,
                       r.reason, r.status, r.created_at,
                       u.full_name, u.email
                FROM cbt_subject_change_requests r
                LEFT JOIN users u ON u.id = r.student_id
                WHERE r.status = :status
                ORDER BY r.created_at ASC
                LIMIT 100
                """
            ),
            {"status": wanted},
        )
    ).mappings().all()
    import json as _json

    out = []
    for r in rows:
        out.append(
            {
                "id": str(r["id"]),
                "student_id": str(r["student_id"]),
                "student_name": r["full_name"] or "(unknown)",
                "student_email": r["email"] or "",
                "board": r["board"],
                "old_subjects": _parse_json_list(r["old_subjects"], _json),
                "new_subjects": _parse_json_list(r["new_subjects"], _json),
                "reason": r["reason"],
                "status": r["status"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
        )
    return {"requests": out}


@router.post("/admin/cbt/subject-change-requests/review")
async def admin_review_subject_change_request(
    payload: SubjectChangeReview,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await ensure_subject_change_schema()
    decision = (payload.decision or "").lower().strip()
    if decision not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="decision must be approve or reject")
    try:
        rid = uuid.UUID(payload.request_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid request id") from exc

    row = (
        await db.execute(
            text(
                """
                SELECT id, student_id, board, new_subjects, status
                FROM cbt_subject_change_requests
                WHERE id = CAST(:id AS uuid)
                FOR UPDATE
                """
            ),
            {"id": str(rid)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row["status"] != "pending":
        raise HTTPException(status_code=409, detail="This request was already reviewed")

    if decision == "reject":
        await db.execute(
            text(
                """
                UPDATE cbt_subject_change_requests
                SET status = 'rejected', reviewed_by = CAST(:admin AS uuid), reviewed_at = :now
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {
                "admin": str(current_user["sub"]),
                "id": str(rid),
                "now": naive_utc_now(),
            },
        )
        await db.commit()
        return {"ok": True, "status": "rejected", "message": "Request rejected. Subjects unchanged."}

    # Approve → write the new subjects to the profile (lock stays on)
    new_subjects = _parse_json_list(row["new_subjects"], __import__("json"))
    if not new_subjects:
        raise HTTPException(status_code=400, detail="Request has no subjects to apply")

    from app.models.user import StudentProfile

    profile = (
        await db.execute(
            select(StudentProfile).where(StudentProfile.user_id == row["student_id"])
        )
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Student profile not found")

    board = (row["board"] or "").upper()
    if board == "JAMB":
        profile.jamb_subjects = new_subjects
    else:
        # Per-board columns first (WAEC and NECO each keep their own list);
        # the shared ssce_* columns mirror the latest registration.
        if board == "WAEC":
            profile.waec_subjects = new_subjects
        elif board == "NECO":
            profile.neco_subjects = new_subjects
        profile.ssce_subjects = new_subjects
        profile.ssce_exam_type = board
    profile.cbt_subjects_locked = True
    profile.locked_at = naive_utc_now()
    await db.flush()

    await db.execute(
        text(
            """
            UPDATE cbt_subject_change_requests
            SET status = 'approved', reviewed_by = CAST(:admin AS uuid), reviewed_at = :now
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"admin": str(current_user["sub"]), "id": str(rid), "now": naive_utc_now()},
    )
    await db.commit()
    return {
        "ok": True,
        "status": "approved",
        "message": f"Approved. {profile.user.full_name if getattr(profile, 'user', None) else 'Student'}'s {board} subjects updated.",
    }
