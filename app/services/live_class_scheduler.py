"""
Background scheduler for live classes:
- Auto-start when start_time is reached
- Auto-end when end_time is reached
- Notify students and broadcast WebSocket events
"""
import asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.datetime_utils import naive_utc_now
from app.models.live_class import (
    ClassAttendance,
    LiveClass,
    LiveClassVisibility,
)
from app.services.notification_service import (
    send_all_students_notification,
    send_subject_notification,
    send_user_notification,
)
from app.websockets.live_class_ws import broadcast as ws_broadcast

_scheduler_task = None


async def run_live_class_scheduler():
    while True:
        try:
            await _tick()
        except Exception as exc:
            print(f"[live_class_scheduler] tick error: {exc}")
        await asyncio.sleep(60)


async def _notify_class_audience(db, live_class) -> None:
    """Notify exactly the students who can SEE this class, matching the
    list-endpoint visibility rules — otherwise students get a push for a
    class that never shows on their Live Class screen."""
    vis = (live_class.visibility or LiveClassVisibility.subject.value).lower()
    data = {
        "class_id": str(live_class.id),
        "room_id": live_class.room_id,
        "join_code": live_class.join_code,
        "visibility": vis,
    }
    if vis == LiveClassVisibility.public.value:
        await send_all_students_notification(
            db=db,
            title="Live class starting now",
            body=f"\u00ab{live_class.title}\u00bb is live — copy your code from the app popup.",
            notification_type="live_class",
            data=data,
        )
    elif vis == LiveClassVisibility.private.value:
        import json as _json

        invited = live_class.invited_student_ids
        if isinstance(invited, str):
            try:
                invited = _json.loads(invited)
            except Exception:
                invited = []
        for sid in invited or []:
            try:
                await send_user_notification(
                    db,
                    str(sid),
                    "Private live class starting now",
                    f"\u00ab{live_class.title}\u00bb — code {live_class.join_code} is in your Access Code tab.",
                    "live_class",
                    data,
                )
            except Exception:
                pass
    elif vis == LiveClassVisibility.class_level.value:
        # Notify exactly the students whose education level matches the class
        # level — the same rule the Live Class list uses to show the class.
        from app.models.user import StudentProfile

        want = (live_class.academic_class or "").replace(" ", "").upper()
        if not want:
            return
        profiles = (await db.execute(select(StudentProfile))).scalars().all()
        for p in profiles:
            have = (p.education_level or "").replace(" ", "").upper()
            if not have or not (want == have or have.startswith(want) or want.startswith(have)):
                continue
            try:
                await send_user_notification(
                    db,
                    str(p.user_id),
                    "Live class starting now",
                    f"\u00ab{live_class.title}\u00bb ({live_class.academic_class}) is live — join from Live Class.",
                    "live_class",
                    data,
                )
            except Exception:
                pass
    elif vis == LiveClassVisibility.school_group.value and live_class.school_group_id:
        # Notify the group's members — same audience the list shows the class to.
        from app.models.school_group import SchoolGroup

        group = (
            await db.execute(
                select(SchoolGroup).where(SchoolGroup.id == live_class.school_group_id)
            )
        ).scalar_one_or_none()
        if not group:
            return
        for sid in group.member_ids():
            try:
                await send_user_notification(
                    db,
                    str(sid),
                    f"{group.school_name} — class is live",
                    f"\u00ab{live_class.title}\u00bb is live — code {live_class.join_code} in Access Code tab.",
                    "live_class",
                    data,
                )
            except Exception:
                pass
    else:
        # subject visibility: discovered by subject — subject-matched students.
        await send_subject_notification(
            db=db,
            subject=live_class.subject,
            title="Live class starting now",
            body=f"Your {live_class.subject} class \u00ab{live_class.title}\u00bb is live. Join from your dashboard.",
            notification_type="live_class",
            data=data,
        )


async def _tick():
    now = naive_utc_now()
    async with AsyncSessionLocal() as db:
        # ── Auto-start scheduled classes ─────────────────────────────────────
        start_res = await db.execute(
            select(LiveClass).where(
                LiveClass.is_live == False,  # noqa: E712
                LiveClass.start_time <= now,
                (LiveClass.end_time.is_(None)) | (LiveClass.end_time > now),
            )
        )
        for live_class in start_res.scalars().all():
            live_class.is_live = True
            # Announce only the FIRST time the class starts. Re-announcing on
            # every tick spam-fires the moment anything (e.g. the stale-flag
            # healer) flips is_live back to false for an already-started class.
            already_announced = bool(getattr(live_class, "started_notified_at", None))
            if not already_announced:
                try:
                    live_class.started_notified_at = now
                    await _notify_class_audience(db, live_class)
                except Exception:
                    pass
            try:
                await ws_broadcast(
                    live_class.room_id,
                    {
                        "event": "class_started",
                        "class_id": str(live_class.id),
                        "title": live_class.title,
                        "subject": live_class.subject,
                    },
                )
            except Exception:
                pass
            print(f"[live_class_scheduler] auto-started class {live_class.id}")

        # ── Auto-end classes at scheduled end_time ───────────────────────────
        end_res = await db.execute(
            select(LiveClass).where(
                LiveClass.is_live == True,  # noqa: E712
                LiveClass.end_time.isnot(None),
                LiveClass.end_time <= now,
            )
        )
        for live_class in end_res.scalars().all():
            live_class.is_live = False
            att_res = await db.execute(
                select(ClassAttendance).where(
                    ClassAttendance.live_class_id == live_class.id,
                    ClassAttendance.left_at.is_(None),
                )
            )
            for att in att_res.scalars().all():
                att.left_at = now
            try:
                await ws_broadcast(
                    live_class.room_id,
                    {
                        "event": "class_ended",
                        "class_id": str(live_class.id),
                        "message": "Class ended at the scheduled time.",
                    },
                )
            except Exception:
                pass
            print(f"[live_class_scheduler] auto-ended class {live_class.id}")

        await db.commit()


def start_live_class_scheduler():
    global _scheduler_task
    if _scheduler_task is not None:
        return
    _scheduler_task = asyncio.create_task(run_live_class_scheduler())
