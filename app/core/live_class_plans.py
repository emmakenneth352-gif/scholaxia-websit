"""Scholaxia live class plans — 2026 catalog.

All amounts are NGN and authoritative here; clients must never send prices.
Admin overrides live in the `plan_overrides` table (plan_group='live_class') and are
applied on top of these defaults at read time.
Plan ids are stored on StudentProfile.live_plan_id and Payments.live_plan_id.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Admin overrides cache (refreshed from DB by refresh_live_overrides)
_override_cache: dict[str, dict] = {}


async def refresh_live_overrides(db: Any) -> None:
    """Load plan_overrides (plan_group='live_class') into the module cache.

    Call before serving plan lists or charging money. Never raises.
    """
    try:
        from sqlalchemy import select

        from app.models.plan_overrides import PlanOverride

        found = (
            await db.execute(select(PlanOverride).where(PlanOverride.plan_group == "live_class"))
        ).scalars()
        _override_cache.clear()
        for r in found:
            _override_cache[r.plan_id] = {
                "price": None if r.price is None else float(r.price),
                "duration_days": r.duration_days,
                "name": r.name,
                "is_active": bool(r.is_active),
            }
    except Exception as exc:  # table missing / fresh DB — defaults apply
        logger.debug("live class plan overrides unavailable, using defaults: %s", exc)


def _apply_override_to(plan: LiveClassPlan) -> LiveClassPlan:
    ov = _override_cache.get(plan.id)
    if not ov:
        return plan
    return LiveClassPlan(
        id=plan.id,
        category=plan.category,
        name=(ov["name"] or plan.name),
        price=(ov["price"] if ov["price"] is not None else plan.price),
        sessions=plan.sessions,
        session_minutes=plan.session_minutes,
        max_subjects=plan.max_subjects,
        features=plan.features,
        education_levels=plan.education_levels,
        exam_types=plan.exam_types,
        billing=plan.billing,
    )


@dataclass(frozen=True)
class LiveClassPlan:
    id: str
    category: str
    name: str
    price: float
    sessions: int
    session_minutes: int
    max_subjects: int
    features: tuple[str, ...]
    education_levels: tuple[str, ...]
    exam_types: tuple[str, ...]
    billing: str = "monthly"


LIVE_CLASS_PLANS: tuple[LiveClassPlan, ...] = (
    LiveClassPlan(
        id="single_class",
        category="Special Single Class",
        name="Special Single Class",
        price=5000,
        sessions=1,
        session_minutes=90,
        max_subjects=1,
        features=(
            "1 live session",
            "One-on-one tutor",
            "Class notes",
            "Questions and answers",
        ),
        education_levels=(),
        exam_types=(),
        billing="one_time",
    ),
    LiveClassPlan(
        id="jamb_prep",
        category="JAMB Prep",
        name="JAMB Prep",
        price=10000,
        sessions=4,
        session_minutes=60,
        max_subjects=4,
        features=(
            "4 subjects",
            "4 sessions weekly",
            "JAMB past questions & CBT drills",
            "Progress tracking",
        ),
        education_levels=("JAMB", "UTME", "SS3"),
        exam_types=("JAMB", "POST_UTME"),
        billing="monthly",
    ),
    LiveClassPlan(
        id="jamb_waec_neco_prep",
        category="Exam Preparation",
        name="JAMB + WAEC/NECO Prep",
        price=15000,
        sessions=5,
        session_minutes=60,
        max_subjects=6,
        features=(
            "6 subjects",
            "5 sessions weekly",
            "JAMB, WAEC & NECO practice",
            "Mock exams",
            "Progress tracking",
        ),
        education_levels=("JAMB", "UTME", "WAEC", "NECO", "SS"),
        exam_types=("JAMB", "WAEC", "NECO", "POST_UTME"),
        billing="monthly",
    ),
    LiveClassPlan(
        id="private_lesson",
        category="Private Lesson",
        name="Private Lesson (One-on-One)",
        price=25000,
        sessions=4,
        session_minutes=60,
        max_subjects=4,
        features=(
            "4 subjects",
            "4 sessions weekly",
            "Dedicated one-on-one tutor",
            "Personalized study plan",
            "Unlimited Sia AI Tutor",
        ),
        education_levels=tuple(f"JSS{i}" for i in range(1, 4))
        + tuple(f"SS{i}" for i in range(1, 4))
        + ("JSS", "SSS", "SECONDARY"),
        exam_types=(),
        billing="monthly",
    ),
    LiveClassPlan(
        id="primary_school",
        category="Primary School",
        name="Primary School",
        price=25000,
        sessions=3,
        session_minutes=60,
        max_subjects=3,
        features=(
            "3 subjects",
            "3 sessions weekly",
            "Mathematics, English & Phonics",
            "Homework help",
            "Parent feedback",
        ),
        education_levels=tuple(f"PRIMARY {i}" for i in range(1, 7))
        + tuple(f"PRY{i}" for i in range(1, 7))
        + ("PRIMARY",),
        exam_types=(),
        billing="monthly",
    ),
    LiveClassPlan(
        id="nursery_school",
        category="Nursery School",
        name="Nursery School",
        price=25000,
        sessions=2,
        session_minutes=45,
        max_subjects=2,
        features=(
            "2 subjects",
            "2 sessions weekly",
            "Reading & Phonics",
            "Counting & fun games",
            "Parent feedback",
        ),
        education_levels=("NURSERY", "KG", "PRE-NURSERY", "NURSERY 1", "NURSERY 2"),
        exam_types=(),
        billing="monthly",
    ),
)

_PLAN_MAP = {p.id: p for p in LIVE_CLASS_PLANS}


def get_plan(plan_id: str) -> Optional[LiveClassPlan]:
    plan = _PLAN_MAP.get(plan_id)
    if plan is None:
        return None
    return _apply_override_to(plan)


def plan_to_dict(plan: LiveClassPlan) -> dict:
    plan = _apply_override_to(plan)
    return {
        "id": plan.id,
        "category": plan.category,
        "name": plan.name,
        "price": plan.price,
        "currency": "NGN",
        "sessions": plan.sessions,
        "session_minutes": plan.session_minutes,
        "max_subjects": plan.max_subjects if plan.max_subjects < 99 else "All core subjects",
        "features": list(plan.features),
        "billing": plan.billing,
        "duration_days": (30 if plan.billing == "monthly" else None),
        "is_active": _override_cache.get(plan.id, {}).get("is_active", True),
        "admin_editable": True,
    }


def all_plans_dict() -> list[dict]:
    """Student-facing plans — inactive plans are hidden."""
    items = [plan_to_dict(p) for p in LIVE_CLASS_PLANS]
    return [i for i in items if i.get("is_active", True)]


async def all_plans_dict_db(db: Any) -> list[dict]:
    """Plans with admin overrides applied (refreshes the cache first)."""
    await refresh_live_overrides(db)
    return all_plans_dict()


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().upper().replace("-", " ").replace("_", " ")


def suggest_plan_ids(
    education_level: Optional[str] = None,
    exam_type: Optional[str] = None,
) -> list[str]:
    level = _norm(education_level)
    exam = _norm(exam_type).replace("POST UTME", "POST_UTME")

    if exam in {"JAMB", "POST_UTME"} and exam == "JAMB":
        return ["jamb_prep", "jamb_waec_neco_prep"]
    if exam in {"WAEC", "NECO", "POST_UTME", "IGCSE"}:
        return ["jamb_waec_neco_prep"]

    if any(x in level for x in ("NURSERY", "KG", "PRE NURSERY")):
        return ["nursery_school"]

    if "PRIMARY" in level or level.startswith("PRY"):
        return ["primary_school"]

    if exam in {"JAMB", "UTME"} or "JAMB" in level or "UTME" in level:
        return ["jamb_prep", "jamb_waec_neco_prep"]

    if level.startswith("JSS") or level.startswith("SS") or "SECONDARY" in level:
        return ["private_lesson", "jamb_waec_neco_prep"]

    return [p.id for p in LIVE_CLASS_PLANS]
