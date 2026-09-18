"""Scholaxia annual CBT practice packages (server-side price catalog).

Prices are authoritative here — clients must never send amounts.
Admin overrides live in the `cbt_packages_admin` table (price / duration / name / is_active)
and are applied on top of these defaults at read time.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Admin overrides cache (refreshed from DB by refresh_cbt_overrides)
_override_cache: dict[str, dict] = {}
# Admin-created custom plans (not in the built-in catalog) live here
_custom_cache: dict[str, dict] = {}


async def refresh_cbt_overrides(db: Any) -> None:
    """Load plan_overrides (plan_group='cbt') into the module cache.

    Call before serving catalogs or charging money. Never raises.
    """
    try:
        from sqlalchemy import select

        from app.models.plan_overrides import PlanOverride

        found = (
            await db.execute(select(PlanOverride).where(PlanOverride.plan_group == "cbt"))
        ).scalars()
        _override_cache.clear()
        _custom_cache.clear()
        for r in found:
            entry = {
                "price": None if r.price is None else float(r.price),
                "duration_days": r.duration_days,
                "name": r.name,
                "is_active": bool(r.is_active),
                "is_custom": bool(getattr(r, "is_custom", False)),
                "boards": (getattr(r, "boards", None) or ""),
            }
            if getattr(r, "is_custom", False):
                _custom_cache[r.plan_id] = entry
            else:
                _override_cache[r.plan_id] = entry
    except Exception as exc:  # table missing / fresh DB — defaults apply
        logger.debug("cbt plan overrides unavailable, using defaults: %s", exc)


def _apply_override_to(package: CbtPackage) -> CbtPackage:
    ov = _override_cache.get(package.id)
    if not ov:
        return package
    return CbtPackage(
        id=package.id,
        name=(ov["name"] or package.name),
        price=(ov["price"] if ov["price"] is not None else package.price),
        duration_days=(ov["duration_days"] or package.duration_days),
        boards=package.boards,
        audience=package.audience,
        features=package.features,
    )


@dataclass(frozen=True)
class CbtPackage:
    id: str
    name: str
    price: float  # NGN
    duration_days: int
    boards: tuple[str, ...]
    audience: str  # student | kind
    features: tuple[str, ...]


CBT_PACKAGES: tuple[CbtPackage, ...] = (
    CbtPackage(
        id="jamb",
        name="JAMB CBT",
        price=3000,
        duration_days=365,
        boards=("JAMB",),
        audience="student",
        features=("Full JAMB CBT package (all selected subjects)", "Randomized questions from bank", "Sia AI with active package"),
    ),
    CbtPackage(
        id="waec",
        name="WAEC CBT",
        price=3000,
        duration_days=365,
        boards=("WAEC",),
        audience="student",
        features=("WAEC subject practice from your registered subjects", "Randomized questions", "Sia AI with active package"),
    ),
    CbtPackage(
        id="neco",
        name="NECO CBT",
        price=2500,
        duration_days=365,
        boards=("NECO",),
        audience="student",
        features=("NECO subject practice from your registered subjects", "Randomized questions", "Sia AI with active package"),
    ),
    CbtPackage(
        id="all",
        name="ALL (JAMB + WAEC + NECO)",
        price=7000,
        duration_days=365,
        boards=("JAMB", "WAEC", "NECO"),
        audience="student",
        features=("Unlock every senior CBT exam type", "Randomized questions", "Sia AI with active package"),
    ),
    # Keep legacy combo ids so old coupons/payments still resolve
    CbtPackage(
        id="jamb_waec",
        name="JAMB & WAEC",
        price=5000,
        duration_days=365,
        boards=("JAMB", "WAEC"),
        audience="student",
        features=("JAMB + WAEC CBT", "Sia AI with active package"),
    ),
    CbtPackage(
        id="jamb_waec_neco",
        name="JAMB, WAEC & NECO",
        price=7000,
        duration_days=365,
        boards=("JAMB", "WAEC", "NECO"),
        audience="student",
        features=("All senior exam boards", "Sia AI with active package"),
    ),
    CbtPackage(
        id="junior_waec",
        name="Junior WAEC",
        price=3000,
        duration_days=365,
        boards=("JUNIOR_WAEC",),
        audience="student",
        features=("Junior WAEC / BECE practice", "Sia AI with active package"),
    ),
    CbtPackage(
        id="common_entrance",
        name="Common Entrance",
        price=2000,
        duration_days=365,
        boards=("COMMON_ENTRANCE",),
        audience="kind",
        features=("Primary 6 Common Entrance practice", "Kid-safe CBT access"),
    ),
)

_PACKAGE_MAP = {p.id: p for p in CBT_PACKAGES}


def _custom_package_to_dict(plan_id: str, entry: dict) -> dict:
    boards = [b for b in (entry.get("boards") or "").split("|") if b] or ["JAMB"]
    return {
        "id": plan_id,
        "name": entry.get("name") or plan_id,
        "price": entry.get("price") or 0,
        "currency": "NGN",
        "duration_days": entry.get("duration_days") or 365,
        "boards": boards,
        "audience": "student",
        "billing": "annual",
        "includes_sia_ai": True,
        "features": [f"{board} CBT practice" for board in boards],
        "is_active": entry.get("is_active", True),
        "is_custom": True,
        "admin_editable": True,
    }


def get_cbt_package(package_id: str) -> Optional[CbtPackage]:
    """Built-in package with overrides applied. Custom admin plans return
    None here — they are dataclass-less, so payment/coupon code that needs a
    CbtPackage should fall back to the catalog dict lookup."""
    pkg = _PACKAGE_MAP.get((package_id or "").strip().lower())
    if pkg is None:
        return None
    return _apply_override_to(pkg)


def get_cbt_plan_dict(plan_id: str) -> Optional[dict]:
    """Any plan (built-in or custom) as its catalog dict — used by payment
    init and coupon redemption so custom plans can be charged/granted too."""
    pid = (plan_id or "").strip().lower()
    pkg = _PACKAGE_MAP.get(pid)
    if pkg is not None:
        return cbt_package_to_dict(pkg)
    entry = _custom_cache.get(pid)
    if entry is not None and entry.get("is_active", True):
        return _custom_package_to_dict(pid, entry)
    return None


def get_plan_meta(plan_id: str) -> Optional[dict]:
    """Lightweight metadata for any plan id (built-in or custom):
    {name, price, duration_days, boards, is_active} — or None.
    Call refresh_cbt_overrides(db) first so custom plans are cached."""
    pid = (plan_id or "").strip().lower()
    pkg = _PACKAGE_MAP.get(pid)
    if pkg is not None:
        d = cbt_package_to_dict(pkg)
        return {
            "name": d["name"],
            "price": d["price"],
            "duration_days": d["duration_days"],
            "boards": list(d["boards"]),
            "is_active": d.get("is_active", True),
        }
    entry = _custom_cache.get(pid)
    if entry is not None:
        boards = [b for b in (entry.get("boards") or "").split("|") if b] or ["JAMB"]
        return {
            "name": entry.get("name") or pid,
            "price": entry.get("price") or 0,
            "duration_days": entry.get("duration_days") or 365,
            "boards": boards,
            "is_active": entry.get("is_active", True),
        }
    return None


def cbt_package_to_dict(package: CbtPackage) -> dict:
    package = _apply_override_to(package)
    return {
        "id": package.id,
        "name": package.name,
        "price": package.price,
        "currency": "NGN",
        "duration_days": package.duration_days,
        "boards": list(package.boards),
        "audience": package.audience,
        "billing": "annual",
        "includes_sia_ai": True,
        "features": list(package.features),
        "is_active": _override_cache.get(package.id, {}).get("is_active", True),
        "admin_editable": True,
    }


def all_cbt_packages_dict() -> list[dict]:
    """Student-facing catalog — inactive plans are hidden, custom plans appended."""
    items = [cbt_package_to_dict(p) for p in CBT_PACKAGES]
    items = [i for i in items if i.get("is_active", True)]
    for pid, entry in _custom_cache.items():
        if entry.get("is_active", True):
            items.append(_custom_package_to_dict(pid, entry))
    return items


async def all_cbt_packages_dict_db(db: Any) -> list[dict]:
    """Catalog with admin overrides applied (refreshes the cache first)."""
    await refresh_cbt_overrides(db)
    return all_cbt_packages_dict()


def all_cbt_packages() -> list[dict]:
    return all_cbt_packages_dict()
