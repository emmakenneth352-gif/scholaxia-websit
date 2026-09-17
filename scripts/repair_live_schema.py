"""Repair live DB schema drift: create missing tables + add missing columns.

Idempotent + non-destructive only (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS).
Usage: DATABASE_URL=postgresql+asyncpg://... python scripts/repair_live_schema.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from sqlalchemy import create_engine
from app.core.database import Base
import app.models  # noqa: F401 — register all models

url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
# Local .env uses Render's internal hostname; expose the external one for remote access
if ".oregon-postgres.render.com" not in url:
    url = url.replace(
        "dpg-d8co30jtqb8s738m3f10-a",
        "dpg-d8co30jtqb8s738m3f10-a.oregon-postgres.render.com",
    )

engine = create_engine(url, connect_args={"sslmode": "require", "connect_timeout": 20})

print("=== Step 1: create_all (creates missing tables) ===")
try:
    Base.metadata.create_all(engine)
    print("create_all OK")
except Exception as exc:
    print(f"create_all FAILED: {exc}")

# Type map for introspection-based column safety net
TYPE_DDL = {
    "UUID": "UUID",
    "String": "VARCHAR(255)",
    "Text": "TEXT",
    "Boolean": "BOOLEAN",
    "Integer": "INTEGER",
    "BigInteger": "BIGINT",
    "Float": "DOUBLE PRECISION",
    "Numeric": "NUMERIC",
    "DateTime": "TIMESTAMP",
    "Date": "DATE",
    "JSON": "JSON",
    "ENUM": None,
    "ARRAY": None,
}


def ddl_for(col):
    t = type(col.type).__name__
    base = TYPE_DDL.get(t)
    if base is None:
        return None
    if t == "ARRAY":
        et = TYPE_DDL.get(type(col.type.item_type).__name__)
        if et is None:
            return None
        base = f"{et}[]"
    ddl = f"ADD COLUMN IF NOT EXISTS {col.name} {base}"
    if col.nullable or col.default is None:
        ddl += " NULL"
    elif base == "BOOLEAN":
        ddl += " NOT NULL DEFAULT FALSE"
    elif base in ("INTEGER", "BIGINT", "DOUBLE PRECISION", "NUMERIC"):
        ddl += " NOT NULL DEFAULT 0"
    else:
        ddl += " NULL"
    return ddl


print("\n=== Step 2: add missing model columns one-by-one ===")
conn = psycopg2.connect(url, sslmode="require", connect_timeout=20)
cur = conn.cursor()
cur.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'")
live = {}
for t, c in cur.fetchall():
    live.setdefault(t, set()).add(c)

changed = False
for table in Base.metadata.sorted_tables:
    if table.name not in live:
        print(f"skip {table.name} (created by create_all above)")
        continue
    for col in table.columns:
        if col.name in live[table.name]:
            continue
        ddl = ddl_for(col)
        if ddl is None:
            print(f"!! {table.name}.{col.name}: no DDL mapping for {type(col.type).__name__}")
            continue
        stmt = f"ALTER TABLE {table.name} {ddl}"
        try:
            cur.execute(stmt)
            conn.commit()
            changed = True
            print(f"ADDED: {table.name}.{col.name}")
        except Exception as exc:
            conn.rollback()
            print(f"FAILED: {stmt} -> {exc}")

if not changed:
    print("no missing columns found")
conn.close()
print("\nDone. Re-run scripts/check_schema_drift.py to verify.")
