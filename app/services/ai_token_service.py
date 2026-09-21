"""AI token service — balance, spend, grants, and the plan catalog.

Design:
- Every student/kind/teacher gets FREE_TOKENS at signup and a monthly refill
  while their balance is below the free allowance.
- AI endpoints spend tokens atomically (single UPDATE ... RETURNING).
- All user ids are converted to uuid.UUID — asyncpg rejects strings for UUID
  columns (that was the DBAPIError on /sia/ask).
- Token accounting must NEVER break a lesson: spend() swallows its own errors
  and returns a neutral balance so Sia always answers.
- Prices are set in USD by the admin; the NGN charge is computed server-side
  with the USD→NGN rate (admin-set, fallback constant). Clients never send
  amounts.
"""
from __future__ import annotations

import logging
import uuid as _uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.datetime_utils import naive_utc_now

logger = logging.getLogger(__name__)

FREE_TOKENS = 100            # signup grant + monthly refill target
REFILL_INTERVAL_DAYS = 30
# Fallback FX rate used only when the admin has not set AI_USD_TO_NGN.
FALLBACK_USD_TO_NGN = 1600.0
# Cost of ONE Sia interaction (an ask, a teach-step, a kind chat, …).
SPEND_PER_CALL = 1
REFILL_REASON = "monthly_refill"


@dataclass(frozen=True)
class AiTokenPack:
    id: str
    name: str
    price_usd: float
    tokens: int
    duration_days: int


BUILTIN_AI_PLANS: tuple[AiTokenPack, ...] = (
    AiTokenPack(id="starter", name="Starter Pack", price_usd=1.99, tokens=150, duration_days=30),
    AiTokenPack(id="standard", name="Standard Pack", price_usd=4.99, tokens=500, duration_days=30),
    AiTokenPack(id="unlimited_month", name="Unlimited Month", price_usd=9.99, tokens=5000, duration_days=30),
)


def usd_to_naira(usd: float) -> float:
    rate = getattr(settings, "AI_USD_TO_NGN", 0) or FALLBACK_USD_TO_NGN
    return round(float(usd) * float(rate), 2)


def _uid(user_id) -> _uuid.UUID:
    """Coerce any user id (str | UUID) into a real uuid.UUID for asyncpg."""
    if isinstance(user_id, _uuid.UUID):
        return user_id
    return _uuid.UUID(str(user_id))


# ── Wallet core ──────────────────────────────────────────────────────────────

async def ensure_wallet(db: AsyncSession, user_id) -> None:
    """Create the wallet row + signup grant if missing. Never raises and never
    leaves the session in a failed state (savepoint-protected)."""
    try:
        await _maybe_monthly_refill(db, _uid(user_id))
    except Exception as exc:
        logger.warning("ai wallet ensure failed for %s: %s", user_id, exc)
        try:
            await db.rollback()
        except Exception:
            pass


async def _maybe_monthly_refill(db: AsyncSession, uid: _uuid.UUID) -> None:
    from app.models.ai_token import AiTokenTransaction, AiTokenWallet

    now = naive_utc_now()
    wallet = (
        await db.execute(select(AiTokenWallet).where(AiTokenWallet.user_id == uid))
    ).scalar_one_or_none()

    if wallet is None:
        wallet = AiTokenWallet(
            user_id=uid,
            balance=FREE_TOKENS,
            lifetime_granted=FREE_TOKENS,
            lifetime_spent=0,
            last_refill_at=now,
        )
        db.add(wallet)
        try:
            await db.flush()
        except IntegrityError:
            # A concurrent request created it first — roll back to a clean
            # state and re-read.
            await db.rollback()
            wallet = (
                await db.execute(select(AiTokenWallet).where(AiTokenWallet.user_id == uid))
            ).scalar_one_or_none()
            if wallet is None:
                return
        else:
            db.add(
                AiTokenTransaction(
                    user_id=uid,
                    delta=FREE_TOKENS,
                    reason="signup",
                    description="Welcome free AI tokens",
                    balance_after=FREE_TOKENS,
                )
            )
            await db.flush()
            return

    balance = int(wallet.balance or 0)
    if balance >= FREE_TOKENS:
        return
    last = wallet.last_refill_at
    if last is not None and (now - last) < timedelta(days=REFILL_INTERVAL_DAYS):
        return

    wallet.balance = FREE_TOKENS
    wallet.last_refill_at = now
    db.add(
        AiTokenTransaction(
            user_id=uid,
            delta=FREE_TOKENS - balance,
            reason=REFILL_REASON,
            description="Monthly free AI tokens",
            balance_after=FREE_TOKENS,
        )
    )
    await db.flush()


async def get_balance(db: AsyncSession, user_id) -> int:
    try:
        from app.models.ai_token import AiTokenWallet

        wallet = (
            await db.execute(
                select(AiTokenWallet).where(AiTokenWallet.user_id == _uid(user_id))
            )
        ).scalar_one_or_none()
        return int(wallet.balance) if wallet else FREE_TOKENS
    except Exception:
        return FREE_TOKENS


async def spend(db: AsyncSession, user_id, amount: int = SPEND_PER_CALL) -> int:
    """Atomically deduct tokens. ALWAYS succeeds from the caller's perspective:
    on any internal error it logs and returns a neutral balance so the AI
    answer is never blocked by token accounting."""
    try:
        return await _spend_inner(db, user_id, amount)
    except Exception as exc:
        logger.warning("ai token spend failed for %s: %s", user_id, exc)
        try:
            await db.rollback()
        except Exception:
            pass
        return FREE_TOKENS


async def _spend_inner(db: AsyncSession, user_id, amount: int = SPEND_PER_CALL) -> int:
    from app.models.ai_token import AiTokenWallet

    uid = _uid(user_id)
    await ensure_wallet(db, uid)
    res = await db.execute(
        update(AiTokenWallet)
        .where(AiTokenWallet.user_id == uid)
        .values(
            balance=AiTokenWallet.balance - amount,
            lifetime_spent=AiTokenWallet.lifetime_spent + amount,
            updated_at=naive_utc_now(),
        )
        .returning(AiTokenWallet.balance)
    )
    row = res.first()
    await db.flush()
    return int(row.balance) if row else FREE_TOKENS


async def grant_tokens(
    db: AsyncSession,
    user_id,
    amount: int,
    reason: str,
    description: str | None = None,
    payment_id=None,
    set_refill_stamp: bool = False,
) -> int:
    """Credit tokens (purchase, admin). Returns the new balance."""
    from app.models.ai_token import AiTokenTransaction, AiTokenWallet

    uid = _uid(user_id)
    await ensure_wallet(db, uid)
    res = await db.execute(
        update(AiTokenWallet)
        .where(AiTokenWallet.user_id == uid)
        .values(
            balance=AiTokenWallet.balance + amount,
            lifetime_granted=AiTokenWallet.lifetime_granted + amount,
            last_refill_at=naive_utc_now() if set_refill_stamp else AiTokenWallet.last_refill_at,
            updated_at=naive_utc_now(),
        )
        .returning(AiTokenWallet.balance)
    )
    row = res.first()
    balance = int(row.balance) if row else amount
    await db.flush()
    db.add(
        AiTokenTransaction(
            user_id=uid,
            delta=amount,
            reason=reason,
            description=(description or reason)[:255],
            payment_id=payment_id,
            balance_after=balance,
        )
    )
    await db.flush()
    return balance


# ── Plan catalog (admin-managed via plan_overrides) ─────────────────────────

async def refresh_ai_plan_overrides(db: AsyncSession) -> None:
    """Sync plan_overrides (plan_group='ai_token') into the ai_token_plans table.

    Reads override rows (price in USD, name, is_active, ai_tokens) and mirrors
    them into ai_token_plans so the catalog + fulfillment always agree.
    """
    try:
        from sqlalchemy import delete as _delete

        from app.models.ai_token import AiTokenPlan
        from app.models.plan_overrides import PlanOverride

        rows = (
            await db.execute(
                select(PlanOverride).where(PlanOverride.plan_group == "ai_token")
            )
        ).scalars()
        found = list(rows)
        await db.execute(_delete(AiTokenPlan).where(AiTokenPlan.is_custom.is_(True)))
        for r in found:
            tokens = int(getattr(r, "ai_tokens", 0) or 0)
            if tokens <= 0:
                continue
            db.add(
                AiTokenPlan(
                    plan_id=r.plan_id,
                    name=r.name or r.plan_id,
                    price_usd=float(r.price or 0),
                    tokens=tokens,
                    duration_days=int(r.duration_days or 30),
                    is_active=bool(r.is_active),
                    is_custom=True,
                    updated_by=r.updated_by,
                )
            )
        await db.flush()
    except Exception as exc:
        logger.debug("ai plan overrides refresh skipped: %s", exc)


async def list_ai_plans(db: AsyncSession, active_only: bool = True) -> list[dict]:
    """Public catalog: builtin packs + admin custom packs (custom wins on id clash)."""
    await refresh_ai_plan_overrides(db)
    try:
        from app.models.ai_token import AiTokenPlan

        rows = (await db.execute(select(AiTokenPlan))).scalars().all()
        db_plans: dict[str, dict] = {}
        for p in rows:
            if p.is_custom or p.plan_id not in {b.id for b in BUILTIN_AI_PLANS}:
                db_plans[p.plan_id] = {
                    "id": p.plan_id,
                    "name": p.name,
                    "price_usd": float(p.price_usd or 0),
                    "tokens": int(p.tokens),
                    "duration_days": int(p.duration_days or 30),
                    "is_active": bool(p.is_active),
                    "is_custom": True,
                }
    except Exception as exc:
        logger.debug("ai_token_plans table not ready: %s", exc)
        db_plans = {}

    out: dict[str, dict] = {}
    for b in BUILTIN_AI_PLANS:
        ov = db_plans.get(b.id)
        out[b.id] = {
            "id": b.id,
            "name": (ov or {}).get("name") or b.name,
            "price_usd": (ov or {}).get("price_usd") if ov and ov.get("price_usd") is not None else b.price_usd,
            "tokens": (ov or {}).get("tokens") if ov and ov.get("tokens") else b.tokens,
            "duration_days": (ov or {}).get("duration_days") if ov and ov.get("duration_days") else b.duration_days,
            "is_active": (ov or {}).get("is_active", True) if ov else True,
            "is_custom": False,
        }
    for pid, p in db_plans.items():
        if pid not in out:
            out[pid] = p

    plans = list(out.values())
    if active_only:
        plans = [p for p in plans if p["is_active"]]
    for p in plans:
        p["price_naira"] = usd_to_naira(p["price_usd"])
    plans.sort(key=lambda x: x["price_usd"])
    return plans


async def get_ai_plan(db: AsyncSession, plan_id: str) -> Optional[dict]:
    for p in await list_ai_plans(db, active_only=True):
        if p["id"] == plan_id:
            return p
    return None


def spend_note(endpoint: str) -> str:
    return f"Sia {endpoint}"
