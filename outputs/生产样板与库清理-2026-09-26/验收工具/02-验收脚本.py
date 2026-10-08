# -*- coding: utf-8 -*-
"""v279f 验收（修正版）：活库一律用 mode=ro（不带 immutable），才读得到 WAL 里刚提交的内容。"""
import json, os, sqlite3, urllib.request, urllib.error

BASE = "/opt/hergent-erp"
API = "http://127.0.0.1:8700"
BK = "/opt/hergent-erp/backups/2026-09-26"
_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def req(path, token=None, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token); r.add_header("X-Tenant-Id", "1")
    try:
        with _op.open(r, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

def live(p):
    """活库：mode=ro（hergent 可写 -shm）⇒ 能读到 WAL 最新提交。绝不用 immutable。"""
    return sqlite3.connect("file:%s?mode=ro" % p, uri=True)

def dead(p):
    """静态备份：无 -wal/-shm 兄弟文件 ⇒ 必须 immutable=1。"""
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)

FAILS, PASSES = [], []
def chk(tag, got, want, note=""):
    ok = (got == want); (PASSES if ok else FAILS).append(tag)
    print("   %-6s %-32s got=%r want=%r %s" % ("PASS" if ok else "FAIL", tag, got, want, note))

T1 = os.path.join(BASE, "tenant_1.db")
BKP = os.path.join(BK, "tenant_1.db.bak-v279f-sample-20260926-194216")
c = live(T1)
b = dead(BKP)

print("=" * 74); print("A. 1596 换算（改后 vs 备份=改前）"); print("=" * 74)
KD = ("id", "spec", "unit", "order_unit", "medium_unit", "medium_ratio", "large_unit", "large_ratio", "updated_at")
def rowof(conn, pid):
    r = conn.execute("SELECT %s FROM products WHERE id=?" % ",".join(KD), (pid,)).fetchone()
    return dict(zip(KD, r))
a, z = rowof(c, 1596), rowof(b, 1596)
print("   改前:", json.dumps(z, ensure_ascii=False)); print("   改后:", json.dumps(a, ensure_ascii=False))
chk("1596.medium_unit", a["medium_unit"], "组")
chk("1596.medium_ratio", a["medium_ratio"], 4.0)
chk("1596.large_unit", a["large_unit"], "件")
chk("1596.large_ratio", a["large_ratio"], 24.0)
chk("1596.unit 未动", a["unit"], z["unit"])
chk("1596.order_unit 未动", a["order_unit"], z["order_unit"])
chk("1596.spec 未动", a["spec"], z["spec"])

print()
print("=" * 74); print("B. 目标与分配"); print("=" * 74)
tg = c.execute("SELECT id,period_month,product_id,product_name,target_qty,target_unit,order_count,status,created_by "
               "FROM product_targets ORDER BY id").fetchall()
for r in tg:
    print("   ", r)
chk("目标行数", len(tg), 2)
chk("目标 created_by", {r[8] for r in tg}, {"boss"})
al = c.execute("SELECT target_id,employee_id,employee_name,ratio,target_qty FROM product_target_alloc ORDER BY id").fetchall()
for r in al:
    print("   alloc", r)
chk("分配行数", len(al), 6)
chk("Σratio/目标 = 100", round(sum(r[3] for r in al if r[0] == 1), 2), 100.0)

print()
print("=" * 74); print("C. 期次19 清单"); print("=" * 74)
chk("期次19 清单行数", c.execute("SELECT COUNT(*) FROM forecast_import_products WHERE period_id=19").fetchone()[0], 154)
chk("期次18 清单仍为 0", c.execute("SELECT COUNT(*) FROM forecast_import_products WHERE period_id=18").fetchone()[0], 0)
chk("期次17 清单未动", c.execute("SELECT COUNT(*) FROM forecast_import_products WHERE period_id=17").fetchone()[0], 154)
chk("清单总行数 +154", c.execute("SELECT COUNT(*) FROM forecast_import_products").fetchone()[0],
    b.execute("SELECT COUNT(*) FROM forecast_import_products").fetchone()[0] + 154)
chk("origin=seeded 行", c.execute("SELECT COUNT(*) FROM forecast_import_products WHERE period_id=19 AND origin='seeded'").fetchone()[0], 154)

print()
print("=" * 74); print("D. 「不该变的」逐项对照（备份 vs 现网）"); print("=" * 74)
tabs = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
diff = []
for t in tabs:
    try:
        n1 = c.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
        n0 = b.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
    except Exception:
        continue
    if n1 != n0:
        diff.append((t, n0, n1))
print("   行数有差异的表:", diff)
chk("差异表集合", sorted(x[0] for x in diff), ["forecast_import_products", "product_target_alloc", "product_targets"])

print()
print("=" * 74); print("E. 读端（真接口）"); print("=" * 74)
st, d = req("/api/auth/login", method="POST", body={"username": "mptestsp", "password": "Mpsup@1"})
TOK = d["token"]
st, fs = req("/api/products/fill-search?period_id=19&limit=200&offset=0", token=TOK)
chk("fill-search p19 total", (fs or {}).get("total"), 154)
st, av = req("/api/product-targets/avg-target?period_id=19&product_ids=1556,1494,1596", token=TOK)
it = (av or {}).get("items") or {}
for k, v in it.items():
    print("   id=%s unit=%r achieved=%s avg=%s per_unit=%s flags=%s"
          % (k, v.get("unit"), v.get("achieved_box"), v.get("avg_box"),
             json.dumps(v.get("per_unit"), ensure_ascii=False), v.get("flags")))
chk("1556 per_unit", it["1556"].get("per_unit"), {"箱": 75.0, "包": 600.0})
chk("1494 per_unit", it["1494"].get("per_unit"), {"件": 60.0, "瓶": 900.0})
chk("1596 无 no_convert", "no_convert" in (it["1596"].get("flags") or {}), False)
chk("1596 仍有 unit_mismatch", "unit_mismatch" in (it["1596"].get("flags") or {}), True)
st, ex = req("/api/product-targets/extra-alloc?period_id=19", token=TOK)
print("   extra-alloc:", st, json.dumps(ex, ensure_ascii=False)[:200])

print()
print("=" * 74); print("F. 1596 品牌与到货规则（决定「能否提示」的那一环）"); print("=" * 74)
for pid in (1204, 1596, 1556, 1494):
    r = c.execute("SELECT id,name,brand,unit,order_unit,large_unit,large_ratio FROM products WHERE id=?", (pid,)).fetchone()
    print("   ", r)
print("   到货规则(dimension=brand):",
      c.execute("SELECT scope_key,is_active FROM rebate_target_rules WHERE dimension='brand'").fetchall())
n_mx = c.execute("SELECT COUNT(*) FROM products WHERE brand='蒙牛鲜奶'").fetchone()[0]
n_mx19 = c.execute("SELECT COUNT(*) FROM products p JOIN forecast_import_products i ON i.product_id=p.id "
                   "WHERE p.brand='蒙牛鲜奶' AND i.period_id=19").fetchone()[0]
n_md19 = c.execute("SELECT COUNT(*) FROM products p JOIN forecast_import_products i ON i.product_id=p.id "
                   "WHERE p.brand='蒙牛低温' AND i.period_id=19").fetchone()[0]
print("   蒙牛鲜奶 商品数=%s（其中在本期清单 %s）｜蒙牛低温 在本期清单 %s" % (n_mx, n_mx19, n_md19))
print("   product_change_logs 行数: 改前 %s → 改后 %s" % (
    b.execute("SELECT COUNT(*) FROM product_change_logs").fetchone()[0],
    c.execute("SELECT COUNT(*) FROM product_change_logs").fetchone()[0]))
c.close(); b.close()
print()
print("   PASS=%d FAIL=%d  %s" % (len(PASSES), len(FAILS), ("FAILS=" + str(FAILS)) if FAILS else "ALL GREEN"))
