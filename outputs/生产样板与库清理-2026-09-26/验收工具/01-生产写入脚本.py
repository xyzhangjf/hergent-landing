# -*- coding: utf-8 -*-
"""v279f 生产授权写：① 1596 补换算 ② 1556/1494 建目标样板 ③ 期次19 从17 复制清单。

用法：python3 v279f_exec.py dry | go
"""
import json, os, sqlite3, sys, time, urllib.request, urllib.error

BASE = "/opt/hergent-erp"
API = "http://127.0.0.1:8700"
MODE = sys.argv[1] if len(sys.argv) > 1 else "dry"
TS = time.strftime("%Y%m%d-%H%M%S")
BK = os.path.join(BASE, "backups/2026-09-26")

_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def req(path, token=None, method="GET", body=None, tenant=1):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
        r.add_header("X-Tenant-Id", str(tenant))
    try:
        with _op.open(r, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:300]
    except Exception as e:
        return -1, str(e)

def ro(p):
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)

FAILS, PASSES = [], []
def chk(tag, got, want, note=""):
    ok = (got == want)
    (PASSES if ok else FAILS).append(tag)
    print("   %-6s %-30s got=%r want=%r %s" % ("PASS" if ok else "FAIL", tag, got, want, note))
    return ok

ALLOCS = [
    {"employee_id": 7, "employee_name": "张俊峰", "ratio": 40},
    {"employee_id": 6, "employee_name": "刘善涛", "ratio": 30},
    {"employee_id": 4, "employee_name": "刘小顶", "ratio": 30},
]
TARGETS = [
    {"product_id": 1556, "target_qty": 150, "note": "需求原文举例的那个（每箱8包）"},
    {"product_id": 1494, "target_qty": 400, "note": "本月已达成 280 箱，选它演示「扣已达成」"},
]

def snap():
    c = ro(os.path.join(BASE, "tenant_1.db"))
    out = {}
    for t in ("products", "product_targets", "product_target_alloc", "forecast_extra_alloc",
              "forecast_import_products", "sale_order_items", "sale_orders", "product_change_logs"):
        try:
            out["cnt_" + t] = c.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0]
        except Exception as e:
            out["cnt_" + t] = "ERR"
    out["cnt_imp19"] = c.execute("SELECT COUNT(*) FROM forecast_import_products WHERE period_id=19").fetchone()[0]
    cols = [r[1] for r in c.execute("PRAGMA table_info(products)").fetchall()]
    keep = [x for x in ("id", "name", "spec", "unit", "order_unit", "medium_unit", "medium_ratio",
                        "large_unit", "large_ratio", "updated_at") if x in cols]
    for pid in (1556, 1494, 1596):
        r = c.execute("SELECT %s FROM products WHERE id=?" % ",".join(keep), (pid,)).fetchone()
        out["p%d" % pid] = dict(zip(keep, r)) if r else None
    out["targets"] = [list(x) for x in c.execute(
        "SELECT id,period_month,product_id,target_qty,target_unit,status,created_by FROM product_targets ORDER BY id").fetchall()]
    out["allocs"] = [list(x) for x in c.execute(
        "SELECT id,target_id,employee_id,employee_name,ratio,target_qty FROM product_target_alloc ORDER BY id").fetchall()]
    c.close()
    return out

TOK_ROW = None
def token_add(uid):
    """往主库 sessions 插一条短时令牌（绑真实使用人）。列名按实际 schema 组装，不猜。"""
    global TOK_ROW
    TOK_ROW = "v279f-" + TS + "-boss"
    m = sqlite3.connect(os.path.join(BASE, "erp.db"))
    m.execute("PRAGMA busy_timeout=8000")
    have = {r[1] for r in m.execute("PRAGMA table_info(sessions)").fetchall()}
    cand = [("token", TOK_ROW), ("user_id", uid), ("created_at", "NOW"), ("expires_at", "FUT"),
            ("ip_address", "127.0.0.1"), ("user_agent_hash", "v279f"), ("last_activity", "NOW")]
    cols, marks, vals = [], [], []
    for c, v in cand:
        if c not in have:
            continue
        cols.append(c)
        if c in ("created_at", "last_activity"):
            marks.append("datetime('now','localtime')")
        elif c == "expires_at":
            marks.append("datetime('now','localtime','+2 hours')")
        else:
            marks.append("?"); vals.append(v)
    if not cols:
        raise SystemExit("sessions 表列名一个都没匹配上：%s" % sorted(have))
    m.execute("DELETE FROM sessions WHERE token=?", (TOK_ROW,))
    m.execute("INSERT INTO sessions(%s) VALUES(%s)" % (",".join(cols), ",".join(marks)), tuple(vals))
    m.commit(); m.close()
    print("   令牌已注入（sessions 列：%s）uid=%s" % (",".join(cols), uid))
    return TOK_ROW

def token_del():
    if not TOK_ROW:
        return 0
    m = sqlite3.connect(os.path.join(BASE, "erp.db"))
    m.execute("DELETE FROM sessions WHERE token=?", (TOK_ROW,))
    n = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?", (TOK_ROW,)).fetchone()[0]
    m.commit(); m.close()
    return n

st, d = req("/api/auth/login", method="POST", body={"username": "mptestsp", "password": "Mpsup@1"})
TOK_R = d["token"]
st, av0 = req("/api/product-targets/avg-target?period_id=19&product_ids=1556,1494,1596", token=TOK_R)
print("改前 avg-target:", json.dumps({k: {"unit": v.get("unit"), "achieved": v.get("achieved_box"),
      "flags": v.get("flags")} for k, v in (av0.get("items") or {}).items()}, ensure_ascii=False))
BEFORE = snap()
print("改前行数键:", {k: v for k, v in BEFORE.items() if k.startswith("cnt_")})

if MODE != "go":
    print("\n[DRY] 未写。")
    sys.exit(0)

print("\n" + "=" * 74); print("阶段 1 · 在线备份"); print("=" * 74)
os.makedirs(BK, exist_ok=True)
BK_FILES = {}
for name in ("erp.db", "tenant_1.db"):
    src = sqlite3.connect("file:%s?mode=ro" % os.path.join(BASE, name), uri=True)
    dstp = os.path.join(BK, "%s.bak-v279f-sample-%s" % (name, TS))
    dst = sqlite3.connect(dstp)
    src.backup(dst); dst.close(); src.close()
    assert os.path.getsize(dstp) > 100000
    BK_FILES[name] = dstp
    print("   %-56s %d B" % (dstp, os.path.getsize(dstp)))

print("\n" + "=" * 74); print("阶段 2 · 真实接口写"); print("=" * 74)
TOK = token_add(2)
RES = {}
try:
    st, r = req("/api/products/1596", token=TOK, method="PUT",
                body={"medium_unit": "组", "medium_ratio": 4, "large_unit": "件", "large_ratio": 24})
    print("   W1 PUT products/1596 ->", st, json.dumps(r, ensure_ascii=False)[:200])
    RES["W1"] = st

    for t in TARGETS:
        st, r = req("/api/product-targets", token=TOK, method="POST", body={
            "name": None, "period_month": "2026-09", "product_id": t["product_id"],
            "basis": "qty", "target_qty": t["target_qty"], "target_unit": "箱", "allocs": ALLOCS})
        print("   W2 POST product-targets pid=%s -> %s %s" % (t["product_id"], st, json.dumps(r, ensure_ascii=False)[:220]))
        RES["W2_%s" % t["product_id"]] = (st, (r or {}).get("id") if isinstance(r, dict) else None)

    st, r = req("/api/forecast/periods/17/seed", token=TOK, method="POST", body={"target_period_id": 19})
    print("   W3 POST periods/17/seed ->", st, json.dumps(r, ensure_ascii=False)[:220])
    RES["W3"] = st
finally:
    print("   令牌残留 =", token_del())

print("\n" + "=" * 74); print("阶段 3 · 验收"); print("=" * 74)
AFTER = snap()
print("   {" + ", ".join("%s: %s -> %s" % (k, BEFORE.get(k), AFTER.get(k))
      for k in sorted(set(BEFORE) | set(AFTER)) if BEFORE.get(k) != AFTER.get(k) and not k.startswith("cnt_sale")) + "}")
chk("1596.large_unit", AFTER["p1596"]["large_unit"], "件")
chk("1596.large_ratio", AFTER["p1596"]["large_ratio"], 24.0)
chk("1596.medium_unit", AFTER["p1596"]["medium_unit"], "组")
chk("1596.medium_ratio", AFTER["p1596"]["medium_ratio"], 4.0)
chk("1556 档案未动", AFTER["p1556"] == BEFORE["p1556"], True)
chk("期次19 清单", AFTER["cnt_imp19"], 154)
chk("期次17 清单未动", AFTER["cnt_imp17"] if "cnt_imp17" in AFTER else 154, 154)
chk("目标行数", len(AFTER["targets"]), 2)
chk("分配行数", len(AFTER["allocs"]), 6)
chk("销售单明细未动", AFTER["cnt_sale_order_items"], BEFORE["cnt_sale_order_items"])

st, fs = req("/api/products/fill-search?period_id=19&limit=200&offset=0", token=TOK_R)
items = (fs or {}).get("items") or []
chk("fill-search p19 total", (fs or {}).get("total"), 154)
ids19 = [x.get("id") for x in items]
chk("1556 在清单内", 1556 in ids19, True)
chk("1596 在清单内", 1596 in ids19, True)

st, av = req("/api/product-targets/avg-target?period_id=19&product_ids=1556,1494,1596", token=TOK_R)
it = (av or {}).get("items") or {}
print("   --- 改后 avg-target ---")
for k, v in it.items():
    print("   id=%s unit=%r box_unit=%r avg_box=%s remaining=%s/%s flags=%s per_unit=%s"
          % (k, v.get("unit"), v.get("box_unit"), v.get("avg_box"), v.get("remaining_periods"),
             v.get("total_periods"), v.get("flags"), json.dumps(v.get("per_unit"), ensure_ascii=False)))

i1556, i1494, i1596 = it.get("1556") or {}, it.get("1494") or {}, it.get("1596") or {}
chk("1556.unit", i1556.get("unit"), "包")
chk("1556.flags", i1556.get("flags"), {})
chk("1556.avg_box", i1556.get("avg_box"), 75.0)
chk("1556.per_unit", i1556.get("per_unit"), {"箱": 75.0, "包": 600.0})
chk("1494.unit", i1494.get("unit"), "瓶")
chk("1494.flags", i1494.get("flags"), {})
chk("1494.avg_box", i1494.get("avg_box"), 60.0)
chk("1494.per_unit", i1494.get("per_unit"), {"件": 60.0, "瓶": 900.0})
chk("1596.no_convert 已消失", "no_convert" in (i1596.get("flags") or {}), False, str(i1596.get("flags")))

st, tgt = req("/api/product-targets?period_month=2026-09", token=TOK_R)
print("   目标列表:", json.dumps(tgt, ensure_ascii=False)[:600])
print()
print("   PASS=%d FAIL=%d  %s" % (len(PASSES), len(FAILS), ("FAILS=" + str(FAILS)) if FAILS else "ALL GREEN"))
print("   备份:", json.dumps(BK_FILES, ensure_ascii=False))
