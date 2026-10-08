# -*- coding: utf-8 -*-
"""v279f 生产只读勘察：清理候选 + 1596 换算 + 本期目标样板选址。全只读。"""
import sqlite3, os, glob

BASE = "/opt/hergent-erp"

def ro(p):
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)

def tables_of(p):
    try:
        c = ro(p)
        n = c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
        c.close()
        return n
    except Exception as e:
        return "ERR:%s" % e

print("=" * 72)
print("A. 清理候选")
print("=" * 72)
m = sqlite3.connect(os.path.join(BASE, "erp.db"))
print("tenants      :", m.execute("SELECT id,name FROM tenants ORDER BY id").fetchall())
print("user_tenants :", m.execute("SELECT tenant_id, COUNT(*) FROM user_tenants GROUP BY tenant_id ORDER BY tenant_id").fetchall())
m.close()

for p in sorted(glob.glob(os.path.join(BASE, "tenant_*.db"))):
    st = os.stat(p)
    print("  %-42s %10d B  %s  tables=%s" % (p, st.st_size,
          __import__("datetime").datetime.fromtimestamp(st.st_mtime).strftime("%m-%d %H:%M"), tables_of(p)))
print("--- db 子目录 ---")
for p in sorted(glob.glob(os.path.join(BASE, "db", "*.db*"))):
    st = os.stat(p)
    print("  %-42s %10d B  %s  tables=%s" % (p, st.st_size,
          __import__("datetime").datetime.fromtimestamp(st.st_mtime).strftime("%m-%d %H:%M"), tables_of(p)))

# tenant_9.db 里到底有没有业务数据
p9 = os.path.join(BASE, "tenant_9.db")
if os.path.exists(p9):
    c = ro(p9)
    print("--- tenant_9.db 非空表 ---")
    empties = 0
    for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
        try:
            n = c.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
        except Exception:
            continue
        if n:
            print("   %-40s %d" % (t, n))
        else:
            empties += 1
    print("   合计：非空表 %d / 空表 %d" % (0 if empties == 0 else -1, empties) if False else
          "   空表数 = %d（若无非空表输出则 0 行业务数据）" % empties)
    c.close()

print()
print("=" * 72)
print("B. id=1596 档案")
print("=" * 72)
t1 = os.path.join(BASE, "tenant_1.db")
c = ro(t1)
cols = [r[1] for r in c.execute("PRAGMA table_info(products)").fetchall()]
want = [x for x in ("id", "name", "spec", "unit", "order_unit", "medium_unit", "medium_ratio",
                    "large_unit", "large_ratio", "brand", "status", "is_active") if x in cols]
r = c.execute("SELECT %s FROM products WHERE id=1596" % ",".join(want)).fetchone()
print(dict(zip(want, r)) if r else "  1596 不存在")
print()
print("--- 档案里 unit/large_unit 取值分布（top10）---")
for row in c.execute("SELECT COALESCE(unit,''), COALESCE(large_unit,''), COALESCE(order_unit,''), COUNT(*) "
                     "FROM products GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 12").fetchall():
    print("   unit=%-6r large=%-6r order=%-6r n=%d" % row)

print()
print("=" * 72)
print("C. tenant_1 期次")
print("=" * 72)
pcols = [r[1] for r in c.execute("PRAGMA table_info(forecast_periods)").fetchall()]
print("forecast_periods 列:", pcols)
for row in c.execute("SELECT * FROM forecast_periods ORDER BY id DESC LIMIT 8").fetchall():
    d = dict(zip(pcols, row))
    print("   ", {k: d.get(k) for k in pcols if k in ("id", "name", "status", "order_start", "order_end",
                                                       "period_start", "period_end", "is_confirm", "confirmed_at", "closed_at")})

print()
print("=" * 72)
print("D. 目标样板选址")
print("=" * 72)
tcols = [r[1] for r in c.execute("PRAGMA table_info(product_targets)").fetchall()]
print("product_targets 列:", tcols)
print("现有目标行数:", c.execute("SELECT COUNT(*) FROM product_targets").fetchone()[0])
for row in c.execute("SELECT id, product_id, period_start, period_end, period_id, target_box, status "
                     "FROM product_targets ORDER BY id DESC LIMIT 6").fetchall():
    print("   ", row)
acols = [r[1] for r in c.execute("PRAGMA table_info(product_target_alloc)").fetchall()]
print("product_target_alloc 列:", acols)
print("分配行数:", c.execute("SELECT COUNT(*) FROM product_target_alloc").fetchone()[0])

print()
print("--- 本期（未关闭）期次里的商品清单规模 ---")
openp = c.execute("SELECT id, order_start, order_end FROM forecast_periods WHERE COALESCE(status,'')!='closed' "
                  "ORDER BY id DESC LIMIT 3").fetchall()
for pid, s, e in openp:
    try:
        n = c.execute("SELECT COUNT(*) FROM forecast_import_products WHERE period_id=?", (pid,)).fetchone()[0]
    except Exception as ex:
        n = "ERR:%s" % ex
    print("   period %s  %s~%s  清单行数=%s" % (pid, s, e, n))
c.close()
