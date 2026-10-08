# -*- coding: utf-8 -*-
"""清理前取证：tenant_9.db 与 db/tenant_1.db 的真实内容 + FTS 误判复核。"""
import sqlite3, os, glob, hashlib
BASE = "/opt/hergent-erp"

def h(p):
    try:
        return hashlib.md5(open(p, "rb").read()).hexdigest()[:16]
    except Exception as e:
        return "ERR:%s" % e

print("=== 待清理文件 ===")
for p in [os.path.join(BASE, "tenant_9.db")] + sorted(glob.glob(os.path.join(BASE, "tenant_9.db*"))) \
       + [os.path.join(BASE, "db", "tenant_1.db")] + sorted(glob.glob(os.path.join(BASE, "db", "tenant_1.db*"))):
    if os.path.exists(p):
        st = os.stat(p)
        import datetime
        print("   %-46s %10d B  %s  md5=%s" % (p, st.st_size,
              datetime.datetime.fromtimestamp(st.st_mtime).strftime("%m-%d %H:%M"), h(p)))

print()
print("=== tenant_9.db 逐表（mode=ro，不用 immutable）===")
c = sqlite3.connect("file:%s?mode=ro" % os.path.join(BASE, "tenant_9.db"), uri=True)
tabs = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
print("   表数 =", len(tabs))
nonzero, total_rows = [], 0
for t in tabs:
    try:
        n = c.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
    except Exception:
        continue
    total_rows += n
    if n:
        nonzero.append((t, n))
print("   非空表:", nonzero)
print("   全库业务行数合计 =", total_rows)
rp = c.execute("SELECT * FROM role_permissions").fetchall()
print("   role_permissions 行:", rp)
c.close()

print()
print("=== db/tenant_1.db ===")
p = os.path.join(BASE, "db", "tenant_1.db")
print("   大小 =", os.path.getsize(p))
try:
    d = sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)
    print("   表数 =", d.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0])
    d.close()
except Exception as e:
    print("   打开:", e)

print()
print("=== FTS 误判复核（正确列名 product_id）===")
t1 = sqlite3.connect("file:%s?mode=ro" % os.path.join(BASE, "tenant_1.db"), uri=True)
print("   含 1556/1494/1596 的 FTS 行:",
      t1.execute("SELECT product_id, name FROM products_fts WHERE product_id IN (1556,1494,1596)").fetchall())
print("   FTS 覆盖商品数:", t1.execute("SELECT COUNT(DISTINCT product_id) FROM products_fts").fetchone()[0])
print("   products 行数   :", t1.execute("SELECT COUNT(*) FROM products").fetchone()[0])
t1.close()
