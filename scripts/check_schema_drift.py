"""Compare SQLAlchemy models against the live DB to find schema drift (missing columns/tables)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from sqlalchemy import create_engine
from app.core.database import Base
import app.models  # noqa: F401 — register all models

url = os.environ.get("DATABASE_URL", "")
if not url:
    print("Set DATABASE_URL")
    sys.exit(1)

# Normalize asyncpg URL for psycopg2 + SQLAlchemy metadata (no connection needed)
sync_url = url.replace("+asyncpg", "+psycopg2").replace("+psycopg2", "")
# Local .env points at internal hostname; expose external for remote access
sync_url = sync_url.replace("dpg-d8co30jtqb8s738m3f10-a", "dpg-d8co30jtqb8s738m3f10-a.oregon-postgres.render.com")

engine = create_engine(sync_url, connect_args={"sslmode": "require", "connect_timeout": 20})

insp_tables = {}
conn = psycopg2.connect(sync_url, sslmode="require", connect_timeout=20)
cur = conn.cursor()
cur.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'")
for t, c in cur.fetchall():
    insp_tables.setdefault(t, set()).add(c)
conn.close()

missing = []
for table in Base.metadata.sorted_tables:
    live_cols = insp_tables.get(table.name)
    if live_cols is None:
        missing.append(f"TABLE MISSING: {table.name}")
        continue
    for col in table.columns:
        if col.name not in live_cols:
            missing.append(f"{table.name}.{col.name}")

if missing:
    print("SCHEMA DRIFT FOUND:")
    for m in missing:
        print(" -", m)
else:
    print("No drift — all model tables/columns exist in live DB.")
