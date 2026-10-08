#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 · 小程序切面（需求 2/3）数据面准备 + 真实响应取证。

只操作沙箱 tenant_9997。产出 /tmp/v279mp_resp.json，供本地 Node 用**真实 fill.js 代码**
（正则提取，不手抄）跑判据。

为什么要在沙箱里把 `order_unit` 改成「提」：
  生产 471 个商品里，唯一 `order_unit != unit` 的是 id=1596，而它**缺换算**
  （large_ratio=0）⇒ 走 flags.no_convert ⇒ 永远不显示均单目标。
  于是后端 `_per_unit_map()` 里那段「报单单位不在档案三级单位里 ⇒ 用权威 per_case 现算补键」
  的兜底逻辑，**在生产数据下从未被触发过** —— 清单里的 D20 因此无法验证。
  这里造一个「有换算 + 报单单位≠档案单位」的干净样本，让 D20 真的可判。
  ⚠️ 只改沙箱副本，生产档案一行不动。
"""
import json
import sqlite3
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8700"
TOKEN = sys.argv[1]
TID = "9997"
SBX = "/opt/hergent-erp/tenant_9997.db"
PID = 18
PMONTH = "2026-09"
PROD_ID = 1556          # 有换算：unit='包' / large_unit='箱' / large_ratio=8
NEW_ORDER_UNIT = "提"    # 故意选一个**不在**档案三级单位({'箱','包'})里的名字

_op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(method, path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("X-Tenant-Id", TID)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with _op.open(req, timeout=60) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return -1, str(e)


out = {}

# ── 1) 承接人 ────────────────────────────────────────────────────────────
st, emps = call("GET", "/api/product-targets/employees")
byname = {e.get("name"): e for e in ((emps or {}).get("items") or [])}
ALLOCS = []
for nm, ratio in (("刘善涛", 10), ("刘小顶", 30), ("张俊峰", 60)):
    if nm in byname:
        ALLOCS.append({"employee_id": byname[nm]["id"], "employee_name": nm, "ratio": ratio})
out["allocs"] = ALLOCS

# ── 2) 沙箱档案：把 1556 的报单单位改成「提」（造 D20 样本） ───────────────
c = sqlite3.connect(SBX)
c.execute("UPDATE products SET order_unit=? WHERE id=?", (NEW_ORDER_UNIT, PROD_ID))
c.commit()
arc = dict(zip(
    ["id", "name", "spec", "unit", "order_unit", "large_unit", "large_ratio",
     "medium_unit", "medium_ratio"],
    c.execute("SELECT id,name,COALESCE(spec,''),COALESCE(unit,''),COALESCE(order_unit,''),"
              "COALESCE(large_unit,''),COALESCE(large_ratio,0),COALESCE(medium_unit,''),"
              "COALESCE(medium_ratio,0) FROM products WHERE id=?", (PROD_ID,)).fetchone()))
out["product_arc"] = arc
c.close()

# ── 3) 建目标（150 箱 · 10/30/60） ───────────────────────────────────────
for t in ((call("GET", "/api/product-targets?month=" + PMONTH)[1] or {}).get("items") or []):
    if int(t.get("product_id") or 0) == PROD_ID:
        call("DELETE", "/api/product-targets/%s" % t["id"])
st, cr = call("POST", "/api/product-targets", {
    "name": "小程序切面验收·%s目标" % arc["name"], "period_month": PMONTH,
    "product_id": PROD_ID, "basis": "qty", "target_qty": 150, "target_unit": "箱",
    "allocs": ALLOCS})
out["create_target"] = {"http": st, "resp": cr}

# ── 4) 建报单（4 个客户列，刘善涛只报 5 箱 ⇒ 故意低于均单，供 D21 用） ───
PC = float(arc["large_ratio"] or 0) or 8.0
CUST = ["刘善涛", "美联保康", "东津", "永诺旗舰店"]
BOX0 = {"刘善涛": 5, "美联保康": 8, "东津": 12, "永诺旗舰店": 20}
st, pr = call("GET", "/api/forecast/periods")
prow = next((x for x in ((pr or {}).get("periods") or []) if int(x.get("id") or 0) == PID), None)
S, E = (prow or {}).get("order_start"), (prow or {}).get("order_end")
out["period"] = prow
st, sm = call("POST", "/api/forecast-submissions/save-matrix", {
    "period_id": PID, "start": S, "end": E, "customers": CUST,
    "rows": [{"product_id": PROD_ID, "product_name": arc["name"], "spec": arc["spec"],
              "unit": NEW_ORDER_UNIT, "price": 1.0,
              "qty_by_unit": {k: round(v * PC, 3) for k, v in BOX0.items()}}]})
out["save_matrix"] = {"http": st, "resp": sm}

# ── 5) 取真实响应：小程序用的正是这两个接口 ───────────────────────────────
st1, fill = call("GET", "/api/products/fill-search?limit=500&offset=0&period_id=%d" % PID)
out["fill_search"] = {"http": st1, "resp": fill}
st2, avg = call("GET", "/api/product-targets/avg-target?period_id=%d" % PID)
out["avg_target"] = {"http": st2, "resp": avg}

with open("/tmp/v279mp_resp.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print("product_arc =", arc)
print("create_target http =", st, "| period =", (S, E))
print("save_matrix http =", st, "| notified =", (sm or {}).get("notified"))
print("fill_search http =", st1, "| items =", len(((fill or {}).get("items") or [])),
      "| scope =", (fill or {}).get("scope"))
it = next((x for x in ((fill or {}).get("items") or []) if int(x.get("id") or 0) == PROD_ID), None)
print("  fill item(1556) =", {k: it.get(k) for k in ("id", "name", "spec", "unit", "order_unit")} if it else None)
ai = (((avg or {}).get("items") or {}).get(str(PROD_ID))) or {}
print("avg_target item(1556) =")
print("  unit=%s box_unit=%s avg_box=%s flags=%s" % (ai.get("unit"), ai.get("box_unit"),
                                                     ai.get("avg_box"), ai.get("flags")))
print("  per_unit      =", ai.get("per_unit"))
print("  avg_per_unit  =", ai.get("avg_per_unit"))
print("  prefill_per_unit=", ai.get("prefill_per_unit"))
print("written /tmp/v279mp_resp.json")
