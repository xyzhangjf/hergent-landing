# -*- coding: utf-8 -*-
"""v279f 勘察二：目标样板选址 + 1596 换算依据。全只读。"""
import sqlite3, os

BASE = "/opt/hergent-erp"
def ro(p):
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)

t1 = ro(os.path.join(BASE, "tenant_1.db"))
m = ro(os.path.join(BASE, "erp.db"))

print("=" * 72); print("A. 目标相关表结构")
for tb in ("product_targets", "product_target_alloc", "forecast_import_products"):
    try:
        cols = [r[1] for r in t1.execute("PRAGMA table_info(%s)" % tb).fetchall()]
        n = t1.execute("SELECT COUNT(*) FROM %s" % tb).fetchone()[0]
        print("  %-26s n=%-6s %s" % (tb, n, cols))
    except Exception as e:
        print("  %-26s ERR %s" % (tb, e))

print()
print("=" * 72); print("B. 期次 19 商品清单")
n19 = t1.execute("SELECT COUNT(*) FROM forecast_import_products WHERE period_id=19").fetchone()[0]
print("  period 19 清单行数 =", n19)
try:
    s = t1.execute("SELECT * FROM forecast_import_products WHERE period_id=19 LIMIT 2").fetchall()
    print("  样本:", s)
except Exception as e:
    print("  ", e)

print()
print("=" * 72); print("C. 用户/员工")
ucols = [r[1] for r in m.execute("PRAGMA table_info(users)").fetchall()]
print("  users 列:", ucols)
sel = [x for x in ("id", "username", "display_name", "role", "status", "is_active") if x in ucols]
print("  tenant_1 成员:")
for r in m.execute("SELECT %s FROM users u JOIN user_tenants ut ON ut.user_id=u.id WHERE ut.tenant_id=1"
                   % ",".join("u." + x for x in sel)).fetchall():
    print("     ", dict(zip(sel, r)))
for r in m.execute("SELECT ut.tenant_id, u.username, u.id FROM users u JOIN user_tenants ut ON ut.user_id=u.id "
                   "WHERE u.username LIKE 'mptest%'").fetchall():
    print("  mptest 归属:", r)

print()
print("=" * 72); print("D. 销售表")
for (t,) in t1.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%sale%' OR name LIKE '%order%' OR name LIKE '%achieve%') ORDER BY name").fetchall():
    try:
        n = t1.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
    except Exception as e:
        n = "ERR"
    print("   %-34s %s" % (t, n))

print()
print("=" * 72); print("E. 1596 同族换算依据")
print("  -- name LIKE '%185ml%' 的档案（换算对照）")
for r in t1.execute("SELECT id, name, spec, unit, medium_unit, medium_ratio, large_unit, large_ratio, order_unit "
                    "FROM products WHERE name LIKE '%185ml%' ORDER BY id").fetchall():
    print("   ", r)
print("  -- 品牌=蒙牛鲜奶 的换算分布")
for r in t1.execute("SELECT unit, medium_unit, medium_ratio, large_unit, large_ratio, order_unit, COUNT(*) "
                    "FROM products WHERE brand='蒙牛鲜奶' GROUP BY 1,2,3,4,5,6 ORDER BY 7 DESC").fetchall():
    print("   ", r)

print()
print("=" * 72); print("F. 1596 历史下单量级（判断「组」是不是整箱）")
for t in ("sale_order_items", "order_items", "sales_items", "sale_items"):
    try:
        cols = [r[1] for r in t1.execute("PRAGMA table_info(%s)" % t).fetchall()]
    except Exception:
        continue
    if not cols:
        continue
    pid_col = next((c for c in ("product_id", "pid") if c in cols), None)
    qty_col = next((c for c in ("qty", "quantity", "num", "total_qty") if c in cols), None)
    u_col = next((c for c in ("unit",) if c in cols), None)
    if not (pid_col and qty_col):
        continue
    try:
        rows = t1.execute('SELECT %s %s FROM "%s" WHERE %s=? ORDER BY rowid DESC LIMIT 25'
                          % (qty_col, ("," + u_col) if u_col else "", t, pid_col), (1596,)).fetchall()
    except Exception as e:
        print("   %s ERR %s" % (t, e)); continue
    print("   表 %s -> %d 行样本: %s" % (t, len(rows), rows))
t1.close(); m.close()
