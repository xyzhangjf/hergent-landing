#!/usr/bin/env python3
# READ-ONLY proof: in tenant_1 context, for every report_mapping store, resolve the
# responsible employee -> active account via the SAME logic the scheduler uses.
# NO message_send, NO writes.
import os, sqlite3
os.environ.setdefault("ERP_SECRET", "x")  # avoid import crash if not set; overwritten below
env_path = "/opt/hergent-erp/.env"
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())
os.environ["ERP_DB_PATH"] = "/opt/hergent-erp/erp.db"
sys_path = "/opt/hergent-erp"
import sys; sys.path.insert(0, sys_path)
import erp_db
from db import connection
connection.set_tenant_context(1)

# replicate scheduler._forecast_store_owner_map() (read-only)
T1 = "/opt/hergent-erp/tenant_1.db"
c = sqlite3.connect(f"file:{T1}?mode=ro", uri=True)
rows = c.execute("SELECT report_alias, system_name, employee_id FROM report_mapping WHERE is_active=1").fetchall()
c.close()
owner_map = {}
for r in rows:
    eid = int(r[2] or 0)
    if eid <= 0:
        continue
    key = (r[0] or "").strip() or (r[1] or "").strip()
    if key:
        owner_map[key] = eid

acct_map = erp_db.employee_account_map()
print("tenant_1 store -> responsible employee -> account")
print("-" * 60)
all_resolved = True
for store, eid in sorted(owner_map.items()):
    acct = acct_map.get(eid)
    if acct and acct.get("is_active"):
        tag = f"user {acct['id']} ({acct['username']}) [{acct['role']}]"
    else:
        tag = "UNBOUND -> broadcast fallback"
        all_resolved = False
    print(f"  {store:<14} emp {eid:<3} -> {tag}")
print("-" * 60)
print("NEWLY BOUND (emp 4 / 6):")
for eid in (4, 6):
    a = acct_map.get(eid)
    print(f"  emp {eid}: {a['username'] if a else 'MISSING'}")
print("ALL stores resolve to an active account:", all_resolved)
print("DONE (read-only).")
