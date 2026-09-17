"""Scholaxia live class plans — 2026 catalog.

All amounts are NGN and authoritative here; clients must never send prices.
Plan ids are stored on StudentProfile.live_plan_id and Payments.live_plan_id.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


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
    return _PLAN_MAP.get(plan_id)


def plan_to_dict(plan: LiveClassPlan) -> dict:
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
    }


def all_plans_dict() -> list[dict]:
    return [plan_to_dict(p) for p in LIVE_CLASS_PLANS]


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
