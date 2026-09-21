#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 真机取证（HTTP 层）：一店一期一单 + 原位替换（单号稳定）+ created 标志。

为什么要单独做这一层：本轮改的是**服务端语义**（幂等键去掉 user_id、覆盖改原位 UPDATE）。
  数据库层的单测（tools/v224-replace-semantics-test.py）证明了函数语义，
  但**路由是怎么把它们接起来的**（分支是否走对、`created` 是否反了、`uid` 删掉后有没有
  残留引用导致 NameError→500）只有真发请求才看得见。

判据三纪律（沿用 v210/v213/v219）：
  · 每个正例配一个**反例** —— 否则「单号恒定」这种断言在"后端永远返回同一个 id"时也全绿；
  · 每条断言能**独立失败**，不依赖前一步副作用；
  · 前置不成立时**显式记红**，不静默跳过。

用法：python3 v224-prod-http-verify.py <sandbox_token> [tenant_id]
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "https://hergent.cn/api"
TOK = sys.argv[1]
TID = sys.argv[2] if len(sys.argv) > 2 else "9997"

# 禁掉一切代理：本机 HTTP_PROXY 会劫持请求（skill 里的经典坑）
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

R = []


def ok(cond, label, extra=""):
    R.append((bool(cond), label))
    print(("%s %s" % ("✅" if cond else "❌", label)) + ("   <- %s" % extra if extra else ""))


def call(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOK)
    req.add_header("X-Tenant-Id", str(TID))
    req.add_header("Content-Type", "application/json")
    try:
        with _OPENER.open(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"_err": str(e)}


def post(body):
    return call("POST", "/forecast-submissions", body)


def main():
    # ---- 前置：开放期次 / 门店 / 本期清单 ----
    st, d = call("GET", "/forecast-submissions/open-periods")
    periods = [p for p in (d.get("periods") or []) if p.get("in_window") is not False]
    if not periods:
        ok(False, "前置：存在开放窗口内的期次", "open-periods -> %s" % json.dumps(d)[:200])
        return 1
    P = periods[0]
    PID = int(P["id"])
    print("期次：id=%s name=%s 窗口 %s~%s" % (PID, P.get("name"), P.get("order_start"), P.get("order_end")))

    st, d = call("GET", "/forecast-submissions/stores")
    stores = d.get("stores") or []
    if not stores:
        ok(False, "前置：该账号有可报单门店", json.dumps(d)[:200])
        return 1
    S = stores[0]
    print("门店：id=%s name=%s（共 %d 个）" % (S.get("id"), S.get("name"), len(stores)))

    st, d = call("GET", "/products/fill-search?period_id=%d&limit=200" % PID)
    items = d.get("items") or []
    print("本期清单：scope=%s 商品 %d 个" % (d.get("scope"), len(items)))
    if len(items) < 2:
        ok(False, "前置：本期清单至少 2 个商品", json.dumps(d)[:200])
        return 1
    A, B = items[0], items[1]

    def mk(it, q):
        return {"product_id": it["id"], "product_name": it.get("name", ""),
                "spec": it.get("spec", ""), "unit": it.get("unit", "件"), "quantity": q}

    # ---- 正例 1：新建 ----
    s1, d1 = post({"store": {"id": S["id"], "name": S["name"]}, "period_id": PID,
                   "items": [mk(A, 5)]})
    ok(s1 == 200 and d1.get("ok"), "第一次提交 200/ok", "HTTP %s %s" % (s1, json.dumps(d1)[:160]))
    sid1 = d1.get("submission_id")
    ok(bool(sid1), "返回 submission_id", "sid=%s" % sid1)
    ok("created" in d1, "响应含新增字段 created（v224 部署生效的判别串）", "created=%r" % d1.get("created"))
    ok(d1.get("created") is True, "首次提交 created=True", "实得 %r" % d1.get("created"))

    # ---- 正例 2：改同一单 ⇒ 单号必须不变（本轮核心） ----
    s2, d2 = post({"store": {"id": S["id"], "name": S["name"]}, "period_id": PID,
                   "items": [mk(A, 9), mk(B, 4)]})
    ok(s2 == 200 and d2.get("ok"), "第二次提交（改单）200/ok", "HTTP %s %s" % (s2, json.dumps(d2)[:160]))
    ok(d2.get("submission_id") == sid1,
       "🔴 单号稳定：第二次仍是同一单（v224 核心）", "sid1=%s sid2=%s" % (sid1, d2.get("submission_id")))
    ok(d2.get("created") is False, "改单 created=False", "实得 %r" % d2.get("created"))
    ok(d2.get("total_qty") == 13, "合计按新明细重算（9+4=13）", "实得 %s" % d2.get("total_qty"))

    # ---- 反例 1：换一个 key（另一期/另一店）必须产生**不同**单号 ----
    # 没有这条，「单号稳定」在"后端永远返回同一个 id"时也会全绿 ⇒ 该断言毫无判别力。
    alt = None
    if len(periods) > 1:
        alt = ("另一期次", {"store": {"id": S["id"], "name": S["name"]}, "period_id": int(periods[1]["id"]),
                          "items": [mk(A, 1)]})
    elif len(stores) > 1:
        alt = ("另一门店", {"store": {"id": stores[1]["id"], "name": stores[1]["name"]}, "period_id": PID,
                          "items": [mk(A, 1)]})
    if alt:
        s3, d3 = post(alt[1])
        ok(s3 == 200 and d3.get("ok"), "反例：换 key 提交成功（%s）" % alt[0])
        ok(d3.get("submission_id") != sid1,
           "反例：不同 key ⇒ 不同单号（证明单号不是恒定的）",
           "sid_alt=%s vs sid1=%s" % (d3.get("submission_id"), sid1))
    else:
        ok(False, "反例：无法构造不同 key（只有一期一店）—— 该断言本轮未取得判别力", "")

    # ---- 正例 3：一店一期只有一条（/my 里该 key 只出现一次） ----
    st, d = call("GET", "/forecast-submissions/my?limit=100")
    recs = d.get("records") or []
    hit = [r for r in recs if int(r.get("store_id") or 0) == int(S["id"])
           and int(r.get("period_id") or 0) == PID]
    ok(len(hit) == 1, "🔴 一店一期只剩一条单（/%s 期%s）" % (S["id"], PID),
       "命中 %d 条：%s" % (len(hit), [r.get("id") for r in hit]))
    ok(bool(hit) and int(hit[0]["id"]) == int(sid1), "该单就是刚才那一单（单号对得上）")
    ok(bool(hit) and int(hit[0]["total_qty"]) == 13, "列表里的件数=最后一次提交的 13")

    # ---- 反例 2：不存在的期次 ⇒ 400 + 新文案（证明 400 通路仍然会把输入挡下） ----
    s4, d4 = post({"store": {"id": S["id"], "name": S["name"]}, "period_id": 987654321,
                   "items": [mk(A, 1)]})
    ok(s4 == 400, "反例：不存在的期次被拒（400）", "HTTP %s" % s4)
    ok("期次" in json.dumps(d4, ensure_ascii=False), "反例文案含「期次」",
       json.dumps(d4, ensure_ascii=False)[:160])

    # ---- 反例 3：数量全 0 ⇒ 400（不能让「空单」也 200 而覆盖掉真数据） ----
    s5, d5 = post({"store": {"id": S["id"], "name": S["name"]}, "period_id": PID,
                   "items": [mk(A, 0)]})
    ok(s5 == 400, "反例：全 0 明细被拒（400，不会把已有单覆盖成空）", "HTTP %s" % s5)

    # ---- 反例 4：改单被拒之后，原单必须还在（v158 纪律：要么完整覆盖、要么原样不动） ----
    st, d = call("GET", "/forecast-submissions/my?limit=100")
    recs = d.get("records") or []
    hit = [r for r in recs if int(r.get("store_id") or 0) == int(S["id"])
           and int(r.get("period_id") or 0) == PID]
    ok(len(hit) == 1 and int(hit[0]["total_qty"]) == 13,
       "被拒之后原单完好（件数仍 13、仍只有一条）",
       "实得 %s" % [(r.get("id"), r.get("total_qty")) for r in hit])

    print("\n" + "=" * 64)
    bad = [l for c, l in R if not c]
    print("通过 %d / %d" % (len(R) - len(bad), len(R)))
    for l in bad:
        print("  ✗ " + l)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
