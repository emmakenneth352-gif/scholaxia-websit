"""Run initialize_database() against DATABASE_URL and write a result file.

Used to verify the refactored startup migration despite slow per-statement
latency to the remote Render Postgres from a local machine.
"""
import asyncio
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format="%(relativeCreated)8dms %(levelname)s %(name)s %(message)s")

from app.core.startup_db import database_ready, initialize_database  # noqa: E402

t0 = time.time()
try:
    ok = asyncio.run(initialize_database())
    result = f"RESULT: returned={ok} ready={database_ready()} elapsed={time.time() - t0:.0f}s"
except Exception as exc:
    result = f"RESULT: CRASHED after {time.time() - t0:.0f}s: {exc!r}"
print(result)
with open("startup_test_result.txt", "w", encoding="utf-8") as f:
    f.write(result + "\n")
