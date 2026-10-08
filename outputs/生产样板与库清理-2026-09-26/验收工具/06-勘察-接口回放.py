# -*- coding: utf-8 -*-
"""v279f 勘察三：真实接口回放（只读）+ 到货日历 + 期次清单分布。"""
import json, sqlite3, os, urllib.request, urllib.error

BASE = "/opt/hergent-erp"
API = "http://127.0.0.1:8700"

def ro(p):
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)

def req(path, token=None, method="GET", body=None):
    u = API + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(u, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, (e.read().decode()[:400])
    except Exception as e:
        return -1, str(e)

print("=" * 72); print("0. 路由自证")
st, spec = req("/openapi.json")
paths = sorted((spec or {}).get("paths", {}).keys()) if st == 200 else []
for p in paths:
    if any(k in p for k in ("fill-search", "avg-target", "product-targets", "arrival")):
        print("   ", p)
if st != 200:
    print("   openapi 取不到:", st, spec)

print()
print("=" * 72); print("1. 登录（mptestsp）")
st, d = req("/api/auth/login", method="POST", body={"username": "mptestsp", "password": "Mpsup@1"})
tok = None
if isinstance(d, dict):
    tok = d.get("token") or (d.get("data") or {}).get("token")
print("   status:", st, " token:", (tok or "")[:18] + "..." if tok else d)

print()
print("=" * 72); print("2. 期次清单分布（tenant_1）")
t1 = ro(os.path.join(BASE, "tenant_1.db"))
try:
    rows = t1.execute("SELECT p.id, p.name, p.status, p.order_start, p.order_end, "
                      "(SELECT COUNT(*) FROM forecast_import_products i WHERE i.period_id=p.id) "
                      "FROM forecast_periods p ORDER BY p.id DESC LIMIT 12").fetchall()
    for r in rows:
        print("   period %-4s %-22s %-8s %s~%s  清单=%s" % r)
except Exception as e:
    print("   ERR", e)

print()
print("=" * 72); print("3. 到货规则（rebate_target_rules dimension=brand）")
try:
    cols = [x[1] for x in t1.execute("PRAGMA table_info(rebate_target_rules)").fetchall()]
    keep = [c for c in ("id", "dimension", "scope_key", "scope_name", "is_active", "priority",
                        "arrival_mode", "arrival_first_dom", "arrival_cadence_days", "arrival_weekdays",
                        "arrival_count_override", "order_first_date", "order_mode", "order_cadence_days",
                        "order_weekdays", "order_lead_days", "target_value", "target_unit") if c in cols]
    for r in t1.execute("SELECT %s FROM rebate_target_rules WHERE dimension='brand' ORDER BY is_active DESC, priority DESC LIMIT 15"
                        % ",".join(keep)).fetchall():
        print("   ", dict(zip(keep, r)))
    n_all = t1.execute("SELECT COUNT(*) FROM rebate_target_rules").fetchone()[0]
    print("   规则总数 =", n_all)
except Exception as e:
    print("   ERR", e)

print()
print("=" * 72); print("4. product_target_alloc 结构")
try:
    print("   cols:", [x[1] for x in t1.execute("PRAGMA table_info(product_target_alloc)").fetchall()])
    print("   n =", t1.execute("SELECT COUNT(*) FROM product_target_alloc").fetchone()[0])
except Exception as e:
    print("   ERR", e)

print()
print("=" * 72); print("5. 真实接口回放（period 19）")
if tok:
    st, d = req("/api/products/fill-search?period_id=19&limit=5&offset=0", token=tok)
    if isinstance(d, dict):
        its = d.get("items") or d.get("data") or []
        print("   fill-search status=%s scope=%s total=%s n=%s" % (st, d.get("scope"), d.get("total"), len(its)))
        for x in its[:5]:
            print("      id=%s unit=%r order_unit=%r name=%s" % (x.get("id"), x.get("unit"), x.get("order_unit"), (x.get("name") or "")[:26]))
    else:
        print("   fill-search status=%s %s" % (st, d))

    st, d = req("/api/product-targets/avg-target?period_id=19&product_ids=1596", token=tok)
    print("   avg-target status=%s" % st)
    if isinstance(d, dict):
        print("   keys:", list(d.keys()))
        print("   period:", {k: (d.get("period") or {}).get(k) for k in ("id", "order_start", "order_end")})
        print("   notes:", json.dumps(d.get("notes"), ensure_ascii=False)[:300])
        for k, v in (d.get("items") or {}).items():
            print("   item[%s]:" % k, json.dumps(v, ensure_ascii=False)[:900])
    else:
        print("   ", str(d)[:400])

    st, d = req("/api/product-targets/products?period_id=19&limit=3", token=tok)
    print("   product-targets/products status=%s" % st, json.dumps(d, ensure_ascii=False)[:500] if isinstance(d, dict) else str(d)[:300])
else:
    print("   跳过（无 token）")
t1.close()
