#!/usr/bin/env python3
# READ-ONLY: list all hr_employees in tenant_1 with explicit column mapping.
import sqlite3
T1 = "/opt/hergent-erp/tenant_1.db"
c = sqlite3.connect(f"file:{T1}?mode=ro", uri=True)
cols = [r[1] for r in c.execute("PRAGMA table_info(hr_employees)")]
print("COLS:", cols)
rows = c.execute("SELECT * FROM hr_employees ORDER BY id").fetchall()
print("ROWCOUNT:", len(rows))
for r in rows:
    d = {cols[i]: r[i] for i in range(len(cols))}
    print(d)
c.close()
print("DONE")
