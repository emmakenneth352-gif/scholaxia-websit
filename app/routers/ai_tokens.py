"""AI tokens — balance, plans, purchases (Paystack), and admin management.

Clients surface the upgrade sheet when `tokens_left <= 0`. The purchase flow
uses the standard Paystack product pipeline: initialize -> in-app checkout ->
verify (idempotent fulfillment via _fulfill).
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.datetime_utils import naive_utc_now
from app.core.deps import get_current_user, require_admin, require_student_or_kind
from app.models.ai_token import AiTokenPlan
from app.models.payment import Payment, PaymentStatus
from app.models.user import User
from app.services import ai_token_service, paystack_service
from app.services.ai_token_service import FREE_TOKENS, usd_to_naira

router = APIRouter(prefix="/ai-tokens", tags=["AI Tokens"])


def _tokens_left(balance: int) -> int:
    return max(0, balance)


async def _wallet_payload(db: AsyncSession, user_id) -> dict:
    await ai_token_service.ensure_wallet(db, user_id)
    uid = uuid.UUID(str(user_id))
    balance = await ai_token_service.get_balance(db, uid)
    next_refill = None
    try:
        from app.models.ai_token import AiTokenWallet

        wallet = (
            await db.execute(select(AiTokenWallet).where(AiTokenWallet.user_id == uid))
        ).scalar_one_or_none()
        if wallet is not None and wallet.last_refill_at is not None:
            next_refill = (
                wallet.last_refill_at + timedelta(days=ai_token_service.REFILL_INTERVAL_DAYS)
            ).isoformat()
    except Exception:
        next_refill = None
    return {
        "balance": int(balance),
        "tokens_left": _tokens_left(int(balance)),
        "free_allowance": FREE_TOKENS,
        "next_refill_at": next_refill,
        "needs_upgrade": int(balance) <= 0,
    }


@router.get("/balance")
async def ai_token_balance(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Any signed-in role (student, kind, teacher) — used by all clients."""
    return await _wallet_payload(db, current_user["sub"])


@router.get("/plans")
async def ai_token_plans(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Public plan catalog in USD + computed NGN (Paystack charges NGN)."""
    plans = await ai_token_service.list_ai_plans(db, active_only=True)
    return {
        "plans": plans,
        "currency_usd": "USD",
        "currency_naira": "NGN",
        "usd_to_ngn": float(settings.AI_USD_TO_NGN or 1600.0),
        "public_key": settings.PAYSTACK_PUBLIC_KEY,
    }


class SpendStateRequest(BaseModel):
    balance: int = Field(..., ge=-100000, le=100000)


# ── Admin: manage AI token packs ─────────────────────────────────────────────

class AiPlanUpsert(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    price_usd: float = Field(..., ge=0, le=100000)
    tokens: int = Field(..., ge=1, le=1_000_000)
    duration_days: int = Field(30, ge=1, le=3650)
    is_active: bool = True


class AiPlanUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    price_usd: Optional[float] = Field(None, ge=0, le=100000)
    tokens: Optional[int] = Field(None, ge=1, le=1_000_000)
    duration_days: Optional[int] = Field(None, ge=1, le=3650)
    is_active: Optional[bool] = None


@router.get("/admin/plans")
async def admin_list_ai_plans(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    from app.models.plan_overrides import PlanOverride

    plans = await ai_token_service.list_ai_plans(db, active_only=False)
    saved = {
        r.plan_id: r
        for r in (
            await db.execute(select(PlanOverride).where(PlanOverride.plan_group == "ai_token"))
        ).scalars()
    }
    for p in plans:
        ov = saved.get(p["id"])
        p["saved_override"] = (
            {
                "name": ov.name,
                "price": None if ov.price is None else float(ov.price),
                "tokens": getattr(ov, "ai_tokens", None),
                "duration_days": ov.duration_days,
                "is_active": ov.is_active,
            }
            if ov
            else {}
        )
    return {
        "plans": plans,
        "usd_to_ngn": float(settings.AI_USD_TO_NGN or 1600.0),
        "free_tokens": FREE_TOKENS,
    }


@router.post("/admin/plans")
async def admin_create_ai_plan(
    payload: AiPlanUpsert,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new AI token pack (visible to users immediately)."""
    import re as _re

    from app.models.plan_overrides import PlanOverride

    base = _re.sub(r"[^a-z0-9]+", "_", payload.name.strip().lower()).strip("_") or "pack"
    plan_id = f"{base}_{uuid.uuid4().hex[:6]}"
    row = PlanOverride(
        plan_group="ai_token",
        plan_id=plan_id,
        name=payload.name.strip()[:120],
        price=payload.price_usd,           # USD — the AI pack currency
        duration_days=payload.duration_days,
        ai_tokens=payload.tokens,
        is_active=payload.is_active,
        is_custom=True,
        updated_by=current_user.get("email") or "admin",
    )
    db.add(row)
    await db.commit()
    return {"ok": True, "plan_id": plan_id, "message": f"Plan '{row.name}' added."}


@router.put("/admin/plans/{plan_id}")
async def admin_update_ai_plan(
    plan_id: str,
    payload: AiPlanUpdate,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit any plan — builtin (override) or custom."""
    from app.models.plan_overrides import PlanOverride

    row = (
        await db.execute(
            select(PlanOverride).where(
                PlanOverride.plan_group == "ai_token", PlanOverride.plan_id == plan_id
            )
        )
    ).scalar_one_or_none()

    builtin_ids = {p.id for p in ai_token_service.BUILTIN_AI_PLANS}
    defaults = {p.id: p for p in ai_token_service.BUILTIN_AI_PLANS}

    if row is None:
        if plan_id not in builtin_ids:
            raise HTTPException(status_code=404, detail="AI plan not found")
        d = defaults[plan_id]
        row = PlanOverride(
            plan_group="ai_token",
            plan_id=plan_id,
            name=d.name,
            price=d.price_usd,
            duration_days=d.duration_days,
            ai_tokens=d.tokens,
            is_active=True,
            is_custom=False,
        )
        db.add(row)

    if payload.name is not None:
        row.name = payload.name.strip()[:120]
    if payload.price_usd is not None:
        row.price = payload.price_usd
    if payload.tokens is not None:
        row.ai_tokens = payload.tokens
    if payload.duration_days is not None:
        row.duration_days = payload.duration_days
    if payload.is_active is not None:
        row.is_active = payload.is_active
    row.updated_by = current_user.get("email") or "admin"
    await db.commit()
    return {"ok": True, "plan_id": plan_id, "message": "Plan updated."}


@router.delete("/admin/plans/{plan_id}")
async def admin_delete_ai_plan(
    plan_id: str,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a custom pack. Built-in packs can only be hidden (is_active=false)."""
    from app.models.plan_overrides import PlanOverride

    row = (
        await db.execute(
            select(PlanOverride).where(
                PlanOverride.plan_group == "ai_token", PlanOverride.plan_id == plan_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        if plan_id in {p.id for p in ai_token_service.BUILTIN_AI_PLANS}:
            raise HTTPException(
                status_code=400,
                detail="Built-in plans cannot be deleted — untick 'Visible to students' to hide it instead.",
            )
        raise HTTPException(status_code=404, detail="AI plan not found")
    if not row.is_custom:
        raise HTTPException(
            status_code=400,
            detail="Built-in plans cannot be deleted — untick 'Visible to students' to hide it instead.",
        )
    await db.delete(row)
    await db.commit()
    return {"ok": True, "plan_id": plan_id}


# ── Paystack purchase ────────────────────────────────────────────────────────

PRODUCT_AI_TOKEN_PACK = "ai_token_pack"


class AiTokenInitializeRequest(BaseModel):
    plan_id: str = Field(..., min_length=2, max_length=60)


class AiTokenVerifyRequest(BaseModel):
    reference: str = Field(..., min_length=4, max_length=120)


def _new_reference() -> str:
    return f"pstk-aitok-{uuid.uuid4().hex}"


@router.post("/purchase/initialize")
async def ai_token_purchase_initialize(
    payload: AiTokenInitializeRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start Paystack checkout for an AI token pack. Amount computed server-side."""
    if not paystack_service.is_configured():
        raise HTTPException(status_code=503, detail="Paystack is not configured on the server.")
    plan = await ai_token_service.get_ai_plan(db, payload.plan_id.strip())
    if not plan:
        raise HTTPException(status_code=404, detail="AI plan not found")

    user = (
        await db.execute(select(User).where(User.id == current_user["sub"]))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")

    price_naira = usd_to_naira(plan["price_usd"])
    if price_naira <= 0:
        raise HTTPException(status_code=400, detail="This plan is not priced yet — contact support.")

    amount_kobo = paystack_service.naira_to_kobo(price_naira)
    reference = _new_reference()
    payment = Payment(
        student_id=user.id,
        amount=price_naira,
        currency="NGN",
        status=PaymentStatus.pending,
        provider="paystack",
        provider_reference=reference,
        product_type=PRODUCT_AI_TOKEN_PACK,
        product_id=plan["id"],
        description=f"ai_token_pack: {plan['name']} ({plan['tokens']} tokens, ${plan['price_usd']})"[:255],
    )
    db.add(payment)
    await db.flush()

    try:
        data = await paystack_service.initialize_transaction(
            email=user.email,
            amount_kobo=amount_kobo,
            reference=reference,
            metadata={
                "student_id": str(user.id),
                "product_type": PRODUCT_AI_TOKEN_PACK,
                "product_id": plan["id"],
                "payment_id": str(payment.id),
                "plan_name": plan["name"],
                "tokens": str(plan["tokens"]),
            },
        )
    except paystack_service.PaystackError as exc:
        raise HTTPException(status_code=502, detail=f"Paystack error: {exc}")

    return {
        "payment_id": str(payment.id),
        "reference": reference,
        "authorization_url": data.get("authorization_url"),
        "access_code": data.get("access_code"),
        "amount_naira": price_naira,
        "price_usd": plan["price_usd"],
        "tokens": plan["tokens"],
        "plan_name": plan["name"],
        "currency": "NGN",
        "public_key": settings.PAYSTACK_PUBLIC_KEY,
    }


@router.post("/purchase/verify")
async def ai_token_purchase_verify(
    payload: AiTokenVerifyRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify + credit tokens (idempotent)."""
    reference = payload.reference.strip()
    pay_res = await db.execute(
        select(Payment).where(
            Payment.provider == "paystack",
            Payment.provider_reference == reference,
            Payment.student_id == uuid.UUID(str(current_user["sub"])),
        )
    )
    payment = pay_res.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment reference not found")

    if payment.status != PaymentStatus.success:
        try:
            tx = await paystack_service.verify_transaction(reference)
        except paystack_service.PaystackError as exc:
            raise HTTPException(status_code=400, detail=f"Payment verification failed: {exc}")
        if (tx.get("status") or "").lower() != "success":
            raise HTTPException(status_code=400, detail="Payment was not successful")
        if (tx.get("currency") or "").upper() != paystack_service.SUPPORTED_CURRENCY:
            raise HTTPException(status_code=400, detail="Unsupported payment currency")
        paid_kobo = int(tx.get("amount") or 0)
        expected_kobo = paystack_service.naira_to_kobo(float(payment.amount or 0))
        if paid_kobo < expected_kobo:
            raise HTTPException(status_code=400, detail="Incorrect payment amount")

        plan = await ai_token_service.get_ai_plan(db, payment.product_id or "")
        tokens = int(plan["tokens"]) if plan else 0
        if tokens <= 0:
            # Fall back to the recorded metadata so a since-deleted plan still credits.
            try:
                md = tx.get("metadata") or {}
                tokens = int(str(md.get("tokens") or 0))
            except Exception:
                tokens = 0
        if tokens <= 0:
            raise HTTPException(status_code=400, detail="Could not determine tokens for this payment")

        payment.status = PaymentStatus.success
        await ai_token_service.grant_tokens(
            db,
            str(current_user["sub"]),
            tokens,
            reason="purchase",
            description=f"AI pack: {payment.description or payment.product_id}",
            payment_id=payment.id,
        )
        await db.commit()

    out = await _wallet_payload(db, current_user["sub"])
    out.update(
        {
            "paid": True,
            "has_access": True,
            "reference": reference,
            "product_type": PRODUCT_AI_TOKEN_PACK,
        }
    )
    return out


async def fulfill_ai_token_pack(db: AsyncSession, payment: Payment) -> None:
    """Webhook path fulfillment (called from paystack_payments._fulfill)."""
    if payment.status != PaymentStatus.success or not payment.student_id:
        return
    plan = await ai_token_service.get_ai_plan(db, payment.product_id or "")
    tokens = int(plan["tokens"]) if plan else 0
    if tokens <= 0:
        return
    await ai_token_service.grant_tokens(
        db,
        str(payment.student_id),
        tokens,
        reason="purchase",
        description=f"AI pack: {payment.description or payment.product_id}",
        payment_id=payment.id,
    )
