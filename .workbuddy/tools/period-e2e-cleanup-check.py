# -*- coding: utf-8 -*-
"""E2E 收尾核查：隔离租户零残留 + 真租户数据未变。"""
import sqlite3, glob, os

m = sqlite3.connect("/opt/hergent-erp/erp.db")
print("tenants  id=9996     =", m.execute("SELECT COUNT(*) FROM tenants WHERE id=9996").fetchone()[0])
print("users    pavuser     =", m.execute("SELECT COUNT(*) FROM users WHERE username=?", ("pavuser",)).fetchone()[0])
print("sessions token pav%  =", m.execute("SELECT COUNT(*) FROM sessions WHERE token LIKE ?", ("pav%",)).fetchone()[0])
print("user_tenants 9996    =", m.execute("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=9996").fetchone()[0])
m.close()
print("隔离库残留文件        =", glob.glob("/opt/hergent-erp/tenant_9996.db*") or "无 ✅")
print()
for f in ["/opt/hergent-erp/tenant_1.db", "/opt/hergent-erp/tenant_10.db"]:
    c = sqlite3.connect("file:%s?mode=ro" % os.path.abspath(f), uri=True)
    print("%-16s 报单 %s 行 | 期次 %s 个 | 商品 %s 个" % (
        os.path.basename(f),
        c.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0],
        c.execute("SELECT COUNT(*) FROM forecast_periods").fetchone()[0],
        c.execute("SELECT COUNT(*) FROM products").fetchone()[0]))
    c.close()
