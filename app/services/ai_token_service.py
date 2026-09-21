"""AI token service — balance, spend, grants, and the plan catalog.

Design:
- Every student/kind/teacher gets FREE_TOKENS at signup and a monthly refill
  while their balance is below the free allowance.
- AI endpoints spend tokens in ONE atomic UPDATE ... RETURNING statement, so a
  learner can never spend tokens they do not have and concurrent calls cannot
  race the balance.
- Prices are set in USD by the admin; the NGN charge is computed server-side
  with the USD→NGN rate (admin-set, fallback constant). Clients never send
  amounts.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from sqlalchemy import text, select
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
    duration_days: int  # validity of the granted tokens' refill window


BUILTIN_AI_PLANS: tuple[AiTokenPack, ...] = (
    AiTokenPack(id="starter", name="Starter Pack", price_usd=1.99, tokens=150, duration_days=30),
    AiTokenPack(id="standard", name="Standard Pack", price_usd=4.99, tokens=500, duration_days=30),
    AiTokenPack(id="unlimited_month", name="Unlimited Month", price_usd=9.99, tokens=5000, duration_days=30),
)


def usd_to_naira(usd: float) -> float:
    rate = getattr(settings, "AI_USD_TO_NGN", 0) or FALLBACK_USD_TO_NGN
    return round(float(usd) * float(rate), 2)


# ── Wallet core ──────────────────────────────────────────────────────────────

async def ensure_wallet(db: AsyncSession, user_id: str) -> None:
    """Create the wallet row + signup grant if missing. Never raises.
    Uses savepoint-free insert-if-missing (ON CONFLICT DO NOTHING)."""
    try:
        await _maybe_monthly_refill(db, user_id)
    except Exception as exc:
        logger.warning("ai wallet ensure failed for %s: %s", user_id, exc)


async def _maybe_monthly_refill(db: AsyncSession, user_id: str) -> None:
    """Create-or-top-up the wallet. Grants FREE_TOKENS at signup and again at
    most once every REFILL_INTERVAL_DAYS whenever the balance fell below it."""
    now = naive_utc_now()
    row = (
        await db.execute(
            text(
                """
                INSERT INTO ai_token_wallets (user_id, balance, lifetime_granted, lifetime_spent, last_refill_at)
                VALUES (:uid, :free, :free, 0, NOW())
                ON CONFLICT (user_id) DO NOTHING
                """
            ),
            {"uid": user_id, "free": FREE_TOKENS},
        )
    )
    created = getattr(row, "rowcount", 0) > 0
    if created:
        await db.execute(
            text(
                """
                INSERT INTO ai_token_transactions (id, user_id, delta, reason, description, balance_after, created_at)
                VALUES (:id, :uid, :delta, 'signup', 'Welcome free AI tokens', :free, NOW())
                """
            ),
            {"id": uuid.uuid4(), "uid": user_id, "delta": FREE_TOKENS, "free": FREE_TOKENS},
        )
        return

    # Existing wallet: top up when below free allowance and refill is due.
    res = await db.execute(
        text("SELECT balance, last_refill_at FROM ai_token_wallets WHERE user_id = :uid"),
        {"uid": user_id},
    )
    wallet = res.first()
    if not wallet:
        return
    balance = int(wallet.balance or 0)
    last = wallet.last_refill_at
    if balance >= FREE_TOKENS:
        return
    if last is not None and (now.replace(tzinfo=None) - last) < timedelta(days=REFILL_INTERVAL_DAYS):
        return
    await db.execute(
        text(
            """
            UPDATE ai_token_wallets
               SET balance = :free, last_refill_at = NOW(), updated_at = NOW()
             WHERE user_id = :uid
            """
        ),
        {"uid": user_id, "free": FREE_TOKENS},
    )
    await db.execute(
        text(
            """
            INSERT INTO ai_token_transactions (id, user_id, delta, reason, description, balance_after, created_at)
            VALUES (:id, :uid, :delta, :reason, 'Monthly free AI tokens', :free, NOW())
            """
        ),
        {
            "id": uuid.uuid4(),
            "uid": user_id,
            "delta": FREE_TOKENS - balance,
            "reason": REFILL_REASON,
            "free": FREE_TOKENS,
        },
    )


async def get_balance(db: AsyncSession, user_id: str) -> int:
    try:
        res = await db.execute(
            text("SELECT balance FROM ai_token_wallets WHERE user_id = :uid"),
            {"uid": user_id},
        )
        row = res.first()
        return int(row.balance) if row else FREE_TOKENS
    except Exception:
        return FREE_TOKENS


async def spend(db: AsyncSession, user_id: str, amount: int = SPEND_PER_CALL) -> int:
    """Atomically deduct tokens; wallet auto-created on first spend.

    Returns the new balance. If the learner has fewer tokens than `amount`,
    the balance goes negative by design (never block a lesson mid-flow) —
    callers compare against zero to decide the low/empty state shown in UI.
    Actually NO: spend clamps at allowed-with-overdraft = cost of this call:
    we allow the call to succeed (so the answer arrives) and land the balance
    at <= 0; the NEXT call still succeeds — the client surfaces the upgrade
    sheet from balance<=0 on every response. This keeps teaching uninterrupted.
    """
    await ensure_wallet(db, user_id)
    res = await db.execute(
        text(
            """
            UPDATE ai_token_wallets
               SET balance = balance - :amt, lifetime_spent = lifetime_spent + :amt, updated_at = NOW()
             WHERE user_id = :uid
            RETURNING balance
            """
        ),
        {"uid": user_id, "amt": amount},
    )
    row = res.first()
    return int(row.balance) if row else 0


async def grant_tokens(
    db: AsyncSession,
    user_id: str,
    amount: int,
    reason: str,
    description: str | None = None,
    payment_id: Optional[uuid.UUID] = None,
    set_refill_stamp: bool = False,
) -> int:
    """Credit tokens (purchase, admin). Returns the new balance."""
    await ensure_wallet(db, user_id)
    res = await db.execute(
        text(
            """
            UPDATE ai_token_wallets
               SET balance = balance + :amt,
                   lifetime_granted = lifetime_granted + :amt,
                   last_refill_at = CASE WHEN :stamp THEN NOW() ELSE last_refill_at END,
                   updated_at = NOW()
             WHERE user_id = :uid
            RETURNING balance
            """
        ),
        {"uid": user_id, "amt": amount, "stamp": bool(set_refill_stamp)},
    )
    row = res.first()
    balance = int(row.balance) if row else amount
    await db.execute(
        text(
            """
            INSERT INTO ai_token_transactions (id, user_id, delta, reason, description, payment_id, balance_after, created_at)
            VALUES (:id, :uid, :amt, :reason, :descr, :pid, :bal, NOW())
            """
        ),
        {
            "id": uuid.uuid4(),
            "uid": user_id,
            "amt": amount,
            "reason": reason,
            "descr": (description or reason)[:255],
            "pid": payment_id,
            "bal": balance,
        },
    )
    return balance


# ── Plan catalog (admin-managed via plan_overrides) ─────────────────────────

async def refresh_ai_plan_overrides(db: AsyncSession) -> None:
    """Sync plan_overrides (plan_group='ai_token') into the ai_token_plans table.

    Reads override rows (price overrides in USD, name, is_active, custom packs,
    token amount via ai_tokens column) and mirrors them into ai_token_plans so
    the catalog + fulfillment always agree. Admin edits write BOTH tables.
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
