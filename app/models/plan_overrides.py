"""Admin-editable subscription plan overrides.

The code ships default catalogs (cbt_packages, live_class_plans). Admins can
override price / duration / display name / visibility per plan id here; the
public catalog endpoints merge these on top of the defaults at read time.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.datetime_utils import naive_utc_now


class PlanOverride(Base):
    __tablename__ = "plan_overrides"

    # plan_group + plan_id uniquely identify one catalog entry
    plan_group: Mapped[str] = mapped_column(String(40), primary_key=True)  # cbt | live_class
    plan_id: Mapped[str] = mapped_column(String(60), primary_key=True)     # jamb, waec, single_class, ...
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utc_now, onupdate=naive_utc_now)
