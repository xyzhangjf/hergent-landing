#!/usr/bin/env python3
"""v681 / Task#41 收尾：拆除隔离租户 tenant_99，并自证生产环境回到原状。"""
import os, sqlite3, sys

DB_DIR = "/opt/hergent-erp"
MASTER = os.path.join(DB_DIR, "erp.db")
DST = os.path.join(DB_DIR, "tenant_99.db")
TID = 99

m = sqlite3.connect(MASTER)
m.execute("delete from user_tenants where tenant_id=?", (TID,))
m.execute("delete from tenants where id=?", (TID,))
n_probe = m.execute("select count(*) from sessions where token like 'e2e658%' or token like 'v681probe%'").fetchone()[0]
m.execute("delete from sessions where token like 'e2e658%' or token like 'v681probe%'")
m.commit()
left_t = m.execute("select id,name from tenants order by id").fetchall()
left_u = m.execute("select tenant_id from user_tenants where user_id=2 order by tenant_id").fetchall()
left_s = m.execute("select count(*) from sessions where token like 'e2e658%' or token like 'v681probe%'").fetchone()[0]
m.close()

removed = []
for suffix in ("", "-wal", "-shm", "-journal"):
    p = DST + suffix
    if os.path.exists(p):
        os.remove(p)
        removed.append(os.path.basename(p))

print("removed files:", removed)
print("tenants 剩余:", left_t)
print("boss 的租户:", left_u)
print("探针 session 删除 %d 条，残留 %d" % (n_probe, left_s))
print("tenant_99.db 存在:", os.path.exists(DST))

ok = (not os.path.exists(DST)) and [t[0] for t in left_t] == [1, 10] \
     and [u[0] for u in left_u] == [1] and left_s == 0
print("TEARDOWN %s" % ("OK ✅" if ok else "FAILED ❌"))
sys.exit(0 if ok else 1)
