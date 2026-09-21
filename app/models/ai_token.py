"""AI token wallets — usage-based access to Sia (student, kind, teacher).

Every learner role starts with FREE_TOKENS and buys more via Paystack
(product_type="ai_token_pack"). Admins manage packs in plan_overrides
(plan_group="ai_token").
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.datetime_utils import naive_utc_now


class AiTokenWallet(Base):
    """One row per user. balance can go NEGATIVE: Sia is never blocked mid-lesson —
    the client shows the upgrade sheet as soon as it sees balance <= 0."""
    __tablename__ = "ai_token_wallets"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lifetime_granted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lifetime_spent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Set when a purchase grants tokens; the next refill (signup grant or a
    # purchase) bumps this so the monthly grant only ever happens once per cycle.
    last_refill_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=naive_utc_now, onupdate=naive_utc_now
    )


class AiTokenTransaction(Base):
    """Audit trail: grant, spend, or purchase."""
    __tablename__ = "ai_token_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), index=True, nullable=False
    )
    delta: Mapped[int] = mapped_column(Integer, nullable=False)  # +grant / -spend
    reason: Mapped[str] = mapped_column(String(40), nullable=False)  # signup|monthly_refill|purchase|spend|admin
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True
    )
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utc_now)


class AiTokenPlan(Base):
    """Admin-created AI token packs (plan_group='ai_token' in plan_overrides)."""
    __tablename__ = "ai_token_plans"

    plan_id: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    price_usd: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    duration_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=naive_utc_now, onupdate=naive_utc_now
    )
