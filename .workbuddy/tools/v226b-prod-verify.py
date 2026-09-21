#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v226b 上线后验收（接口级，只读）—— 收紧与一致化是否真的到了生产。

判据分四组：
  A 触达性：health / 关键端点无 5xx
  B 缺价计数一致化：`factory-price-gate.missing_count` 与「前端 fpEff 口径复算」必须相等
    —— 诉求 1 的修法就是让徽标 / 导出清单 / 补价面板三处同源于 `fpEff`，
       所以本组同时验后端计数与前端口径能否对上（脚本按前端规则复算）
  C 字段下发完整性：`factory_price` 必须出现在 products 列表与 grid 里
    （否则前端 Forecast 金额、ProductArchive 的进价列拿了也白拿）
  D 金额链口径：`payments/preview` 可用且回传新 caliber 文案（含「只取商品档案的「进价」」）
只读，零写入。
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "https://hergent.cn"
USER, PASS = "mptestsp", "Mpsup@1"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

_ok = _bad = 0


def assert_(name, cond, extra=""):
    global _ok, _bad
    if cond:
        _ok += 1
        print("  PASS  %s" % name)
    else:
        _bad += 1
        print("  FAIL  %s   %s" % (name, extra))


def req(path, token=None, timeout=30):
    r = urllib.request.Request(BASE + path)
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with OPENER.open(r, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)


print("=== A. 触达性 ===")
st, _ = req("/api/health")
assert_("health 200", st == 200, st)

print("\n=== 登录 ===")
data = json.dumps({"username": USER, "password": PASS}).encode()
r = urllib.request.Request(BASE + "/api/auth/login", data=data,
                           headers={"Content-Type": "application/json"})
try:
    with OPENER.open(r, timeout=30) as resp:
        token = json.loads(resp.read().decode("utf-8", "replace")).get("token")
except Exception as e:
    token = None
    print("  登录异常：%s" % e)
assert_("登录成功", bool(token), USER)

print("\n=== B. 缺价计数一致化（124 那件事）===")
st, body = req("/api/forecast/factory-price-gate", token)
gate_count = None
if st == 200:
    try:
        gate_count = int(json.loads(body).get("missing_count"))
    except Exception as e:
        print("  解析异常：%s  body=%s" % (e, body[:200]))
assert_("进价闸门端点 200", st == 200, st)
assert_("missing_count 可读", gate_count is not None, body[:160])
print("  后端 missing_count = %s" % gate_count)

# 按前端 fpEff 规则复算：启用 且 (factory_price>0 或 purchase_price>0) 之外的商品
st, body = req("/api/products?include_inactive=1&limit=5000", token)
fe_none = fe_purchase = fe_factory = None
if st == 200:
    try:
        items = json.loads(body).get("items", [])
        act = [p for p in items if p.get("is_active") != 0]
        fe_factory = sum(1 for p in act if float(p.get("factory_price") or 0) > 0)
        fe_purchase = sum(1 for p in act
                          if float(p.get("factory_price") or 0) <= 0
                          and float(p.get("purchase_price") or 0) > 0)
        fe_none = sum(1 for p in act
                      if float(p.get("factory_price") or 0) <= 0
                      and float(p.get("purchase_price") or 0) <= 0)
    except Exception as e:
        print("  复算异常：%s" % e)
assert_("products 列表可读", st == 200, st)
print("  前端口径复算：启用 %s 个 = 有进价 %s + 仅历史列 %s + 都没有 %s"
      % ((fe_factory or 0) + (fe_purchase or 0) + (fe_none or 0),
         fe_factory, fe_purchase, fe_none))
if gate_count is not None and fe_none is not None:
    assert_("后端 missing_count == 前端口径「都没有」", gate_count == fe_none,
            "后端 %s vs 前端 %s" % (gate_count, fe_none))
    # 诉求 1 的关键断言：面板改前用的是 134（只看 factory_price），必须**不再等于**它
    strict = (fe_purchase or 0) + (fe_none or 0)
    assert_("计数已不是「只看 factory_price」的旧口径", gate_count != strict,
            "旧口径会是 %s" % strict)

print("\n=== C. 字段下发完整性 ===")
if st == 200:
    items = json.loads(body).get("items", [])
    assert_("products 列表逐行下发 factory_price",
            bool(items) and all("factory_price" in p for p in items[:50]),
            "缺字段的商品：%s" % [p.get("id") for p in items[:50] if "factory_price" not in p][:5])
    assert_("products 列表仍下发 purchase_price（fpEff 回退需要）",
            bool(items) and all("purchase_price" in p for p in items[:50]), "")

st, body = req("/api/products/grid?limit=5", token)
if st != 200:
    st, body = req("/api/products/grid", token)
grid_ok = False
if st == 200:
    try:
        g = json.loads(body)
        rows = g.get("items") or g.get("rows") or g.get("products") or []
        grid_ok = bool(rows) and all("factory_price" in r for r in rows[:5])
    except Exception as e:
        print("  grid 解析异常：%s" % e)
assert_("products/grid 下发 factory_price", grid_ok, "status=%s body=%s" % (st, body[:160]))

print("\n=== D. 金额链口径 ===")
st, body = req("/api/forecast/payments/preview/2026-01-01/2026-01-05", token)
assert_("payments/preview 非 5xx", st < 500, "%s %s" % (st, body[:200]))
if st == 200:
    try:
        js = json.loads(body)
        cal = str(js.get("price_stat", {}).get("caliber") or "")
        assert_("新 caliber 文案已生效（只取进价/不拿历史列当箱价）",
                "金额基准只取商品档案" in cal and "不作为箱价参与金额" in cal, cal[:120])
        assert_("purchase_rows 字段保留（向后兼容）",
                "purchase_rows" in js.get("price_stat", {}), "")
        print("  caliber = %s" % cal[:110])
    except Exception as e:
        print("  preview 解析异常：%s" % e)

print("\n===== 结果：%d 通过 / %d 失败 =====" % (_ok, _bad))
sys.exit(1 if _bad else 0)
