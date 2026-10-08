#!/usr/bin/env python3
# AUTHORIZED PROD WRITE: create login accounts for the two 业务员 (sales reps) in
# tenant_1 who own report_mapping stores but have NO bound account:
#   employee_id=4 刘小顶 (owns 美联保康)
#   employee_id=6 刘善涛 (owns 刘善涛仓)
# Uses the real business function staff_account_create (NOT manual UPDATE users.employee_id).
import os, sys, sqlite3, datetime

# --- 1. load .env (ERP_SECRET etc.) BEFORE importing app code ---
env_path = "/opt/hergent-erp/.env"
with open(env_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())
os.environ["ERP_DB_PATH"] = "/opt/hergent-erp/erp.db"

# --- 2. online backup of main db (WAL-safe) ---
BKDIR = "/opt/hergent-erp/backups"
ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bk = os.path.join(BKDIR, f"erp.db.before-sales-acct-{ts}.bak")
src = sqlite3.connect("file:/opt/hergent-erp/erp.db?mode=ro", uri=True)
dst = sqlite3.connect(bk)
src.backup(dst); dst.close(); src.close()
assert os.path.getsize(bk) > 100000, "backup too small"
assert sqlite3.connect(bk).execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0
print("BACKUP:", bk, os.path.getsize(bk), "bytes")

# --- 3. create accounts via real business function ---
sys.path.insert(0, "/opt/hergent-erp")
import erp_db
from db import connection
connection.set_tenant_context(1)

TARGETS = [
    {"employee_id": 4, "username": "liuxiaoding", "password": "xs668866",
     "display_name": "刘小顶", "role": "sales"},
    {"employee_id": 6, "username": "liushantao", "password": "st668866",
     "display_name": "刘善涛", "role": "sales"},
]

print("\n=== BEFORE: employee_account_map(tenant_1) ===")
before = erp_db.employee_account_map()
for k, v in sorted(before.items()):
    print(f"  emp {k}: user {v['id']} ({v['username']}) role={v['role']} active={v['is_active']}")

print("\n=== CREATE ===")
results = {}
for t in TARGETS:
    r = erp_db.staff_account_create(
        employee_id=t["employee_id"], username=t["username"],
        password=t["password"], display_name=t["display_name"],
        role=t["role"], tenant_id=1)
    results[t["employee_id"]] = r
    print(f"  emp {t['employee_id']} ({t['display_name']}): {r}")

# --- 4. verify via authority function (in tenant_1 context) ---
print("\n=== AFTER: employee_account_map(tenant_1) ===")
after = erp_db.employee_account_map()
for k, v in sorted(after.items()):
    print(f"  emp {k}: user {v['id']} ({v['username']}) role={v['role']} active={v['is_active']}")

# column-level proof
print("\n=== COLUMN-LEVEL proof (users.employee_id for new accounts) ===")
m = sqlite3.connect("file:/opt/hergent-erp/erp.db?mode=ro", uri=True)
for t in TARGETS:
    row = m.execute("SELECT id, username, employee_id, role, is_active, password_changed FROM users WHERE username=?",
                    (t["username"],)).fetchone()
    print("  ", dict(zip(["id","username","employee_id","role","is_active","password_changed"], row)))
m.close()

# --- 5. assertions ---
ok = True
for t in TARGETS:
    emp = t["employee_id"]
    r = results[emp]
    if not (isinstance(r, dict) and r.get("success")):
        print(f"  !! FAIL create emp {emp}: {r}"); ok = False; continue
    am = after.get(emp)
    if not am or am["is_active"] != 1 or am["id"] != r.get("user_id"):
        print(f"  !! FAIL bind emp {emp}: map={am}"); ok = False
print("\nRESULT:", "ALL OK" if ok else "HAS FAILURE")
sys.exit(0 if ok else 1)
