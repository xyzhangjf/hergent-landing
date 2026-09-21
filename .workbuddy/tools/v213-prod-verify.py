#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v213 第三批 · **生产真机取证**（在隔离沙箱租户内，绝不碰真实租户）。

用法：
    python3 v213-prod-verify.py <沙箱token> [--base https://hergent.cn]

取证目标（离线已有 93/93，这里要在真实环境复现同样的结论）：
    R1  GET  /validation-spec              路由在线上真的存在且返回规格
    R2  规格里的五条文案与后端模块常量**逐字一致**（与本地源码比对）
    R3  GET  /summary                      增量下发 matrix_rev/at/by，且**既有键一个没动**
    R4  POST /save-matrix 过期 base_rev      → 409 + conflict（谁/何时/当前指纹），且**零写入**
    R5  POST /save-matrix 合法 + 正确 rev   → 200，且回执回传**新**指纹 = 重算值
    R6  同内容重复保存                        → 指纹**不变**（不误报冲突）
    R7  POST /save-matrix 脏载荷 "12箱"      → 400 + violations[kind=num] + 与 spec 同一句文案
    R8  POST /save-matrix 超上限              → 400 + violations[kind=over]，文案带当前上限
    R9  POST /save-matrix force=true         → 跳过冲突判定（用户显式覆盖）
    R10 POST 小程序入口 (POST "")  脏载荷    → 400 + violations（**与 Web 同一判据**）
    R11 删列名册（hidden_customers）变动      → 指纹变；复原 → 指纹回原值

🔴 沙箱的能力边界（见 tools/sandbox_tenant.py 顶部）：
   沙箱把全部 order_date 改成了今天 ⇒ **期次归属/时间窗口口径在沙箱里失真**。
   所以本脚本**不**验证「指纹只覆盖本期」这类作用域精确性（那由离线 93/93 的
   I10/I10b/I10c/Z3 用真实结构特征化）。本脚本验证的是**交互链与回执语义**：
   冲突判定、文案同源、状态码、回执字段 —— 这些与 order_date 无关。
"""
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime

BASE = "https://hergent.cn"
DAY = "2026-09-20"          # 沙箱把所有报单的 order_date 改成了今天；用单日窗口 ⇒ pid 解析为 0
CUST = "真机验证客户"
PROD = "真机验证商品"
RULES_SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server/db/queries/forecast_rules.py"

TOKEN = sys.argv[1] if len(sys.argv) > 1 else ""
if "--base" in sys.argv:
    BASE = sys.argv[sys.argv.index("--base") + 1]

PASS, FAILS = 0, []


def ok(cond, msg):
    global PASS
    if cond:
        PASS += 1
        print("  \u2705 " + msg)
    else:
        FAILS.append(msg)
        print("  \u274c " + msg)
    return bool(cond)


def call(method, path, body=None):
    """→ (status, body_dict)。HTTP 错误也返回 body（用于读 violations / conflict）。"""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except Exception:
            return e.code, {"_raw": raw[:400]}
    except Exception as e:
        return -1, {"_err": str(e)}


def summary():
    """⚠️ 参数名必须是 `start`/`end`/`period_id` —— 与路由签名 (date, start, end, period_id)
    以及前端 `forecastApproveApi.summary` 逐字一致。
    写错参数名的后果**不报错**：路由的 start/end 收不到 ⇒ 指纹拿不到窗口 ⇒ 返回 `rev=""`
    ⇒ fail-open ⇒ 乐观锁**静默失效**。R3c 就是专门拦这一个的。"""
    return call("GET", "/api/forecast-submissions/summary"
                       "?period_id=0&start=%s&end=%s" % (DAY, DAY))


def rev_of():
    st, b = summary()
    return st, (b.get("matrix_rev") or ""), b


def matrix_body(qty=12, **over):
    b = {
        "start": DAY, "end": DAY, "period_id": 0,
        "customers": [CUST], "hidden_customers": [],
        "rows": [{
            "product_id": 0, "product_name": PROD, "spec": "", "unit": "件", "price": 0,
            "qty_by_unit": {CUST: qty},
        }],
    }
    b.update(over)
    return b


print("=" * 78)
print("v213 第三批 · 生产真机取证   base=%s   day=%s" % (BASE, DAY))
print("=" * 78)

# ---------------------------------------------------------------- R1/R2 规格
print("\n\u2500\u2500 R1/R2  /validation-spec（两端唯一判据）\u2500\u2500")
st, spec_body = call("GET", "/api/forecast-submissions/validation-spec")
ok(st == 200, "R1  GET /validation-spec \u2192 200（实得 %s）" % st)
spec = (spec_body.get("spec") or {}) if isinstance(spec_body, dict) else {}
ok(isinstance(spec.get("qty_max"), int) and spec["qty_max"] > 0,
   "R1b 规格带 qty_max = %r" % spec.get("qty_max"))
ok(spec.get("name_required") in (True, False),
   "R1c 规格带 name_required = %r" % spec.get("name_required"))
kinds = spec.get("kinds") or []
ok(len(kinds) == 5 and sorted(k.get("k") for k in kinds) == ["int", "name", "neg", "num", "over"],
   "R1d 五类违规 kind 齐备 = %r" % sorted(k.get("k") for k in kinds))

# 从后端模块源码里提取文案常量（不 import —— 那会拉起 DB 连接）
try:
    src = open(RULES_SRC, encoding="utf-8").read()
except Exception as e:
    src = ""
    print("     （读不到后端模块源码：%s）" % e)
SRC_MSG = {}
for _k in ("NUM", "NEG", "INT", "OVER", "NAME"):
    m = re.search(r'^MSG_%s = "([^"]*)"' % _k, src, re.M)
    if m:
        SRC_MSG[_k.lower()] = m.group(1)
ok(len(SRC_MSG) == 5, "R2  读到后端五条文案常量（实得 %d 条）" % len(SRC_MSG))
_spec_msg = {k.get("k"): k.get("msg") for k in kinds}
for _k in ("num", "neg", "int", "over", "name"):
    ok(_spec_msg.get(_k) == SRC_MSG.get(_k),
       "R2.%s 线上 spec 文案 == 后端模块常量：%r" % (_k, _spec_msg.get(_k)))
QMAX_LIVE = spec.get("qty_max")

# ---------------------------------------------------------------- R3 summary
print("\n\u2500\u2500 R3  /summary 增量下发指纹（小程序共用该接口）\u2500\u2500")
st, b0 = summary()
ok(st == 200, "R3  GET /summary \u2192 200（实得 %s）" % st)
_miss = [k for k in ("date", "rows", "all_units", "confirmed", "imported_products") if k not in b0]
ok(not _miss, "R3b 既有 5 个键**一个没动**（缺：%r）" % _miss)
rev0 = b0.get("matrix_rev") or ""
ok(len(rev0) == 16 and all(c in "0123456789abcdef" for c in rev0),
   "R3c 带 matrix_rev = %r（16 位 hex）" % rev0)
_at0 = b0.get("matrix_at") or ""
ok(len(_at0) >= 16 and _at0[4] == "-" and _at0[10] == " ",
   "R3d 带 matrix_at = %r（YYYY-MM-DD HH:MM:SS）" % _at0)
ok("matrix_by" in b0, "R3e 带 matrix_by = %r" % b0.get("matrix_by"))

# 稳定性：连续两次读应一致（证明指纹是内容函数、无随机成分）
st2, rev0b, _ = rev_of()
ok(rev0b == rev0, "R3f 两次读指纹一致（%s vs %s）" % (rev0[:8], rev0b[:8]))

# ---------------------------------------------------------------- R5 合法保存（建立基线）
print("\n\u2500\u2500 R5  合法保存 + 回执带新指纹 \u2500\u2500")
st, r5 = call("POST", "/api/forecast-submissions/save-matrix", matrix_body(12, base_rev=rev0))
ok(st == 200, "R5  带正确 base_rev 保存 \u2192 200（实得 %s）" % st)
if st == 409:
    print("     ⚠️ 收到 409（pid 未对齐？）conflict=%r" % (r5.get("conflict"),))
revA_receipt = r5.get("matrix_rev") or ""
ok(bool(revA_receipt), "R5b 回执回传保存后的矩阵指纹 = %r" % revA_receipt)
stA, revA, _bA = rev_of()
# R5e 🔴 **时区**：保存**刚刚**发生 ⇒ 此刻的 matrix_at 必须是**本地 now**（差 < 300 秒）。
#   生产库的 `created_at` 存的是 UTC（表默认值 CURRENT_TIMESTAMP），不做转换这里会差约 28800 秒。
#   这是真机侧**唯一**能抓到「时区错位」的位置 —— 离线沙箱的 schema 与生产不同（本机快照的
#   默认值恰是 localtime），离线测出来的方向甚至是**反的**，必须靠真机钉住。
_atA = _bA.get("matrix_at") or ""
try:
    _dA = abs((datetime.now() - datetime.strptime(_atA, "%Y-%m-%d %H:%M:%S")).total_seconds())
except Exception:
    _dA = 1e9
ok(_dA < 300,
   "R5e 🔴 matrix_at 是**本地时间**：与 now() 差 %.0f 秒（直发 UTC 会差约 28800 秒）—— 实得 %r"
   % (_dA, _atA))
ok(revA == revA_receipt, "R5c 回执的新指纹 == 保存后重算的指纹（%s vs %s）"
   % (revA[:8], revA_receipt[:8]))
ok(revA != rev0, "R5d 内容变了 ⇒ 指纹变了（%s \u2192 %s）" % (rev0[:8], revA[:8]))

# ---------------------------------------------------------------- R4 过期指纹 → 409
print("\n\u2500\u2500 R4  过期 base_rev \u2192 409 且零写入 \u2500\u2500")
st, r4 = call("POST", "/api/forecast-submissions/save-matrix", matrix_body(99, base_rev=rev0))
ok(st == 409, "R4  过期 base_rev \u2192 409（实得 %s）" % st)
conf = r4.get("conflict") or {}
ok(conf.get("current_rev") == revA, "R4b 冲突回执带**当前**指纹 = %r" % conf.get("current_rev"))
ok(bool(conf.get("by")), "R4c 冲突回执带「谁改的」= %r" % conf.get("by"))
ok(bool(conf.get("at")), "R4d 冲突回执带「何时改的」= %r" % conf.get("at"))
ok(bool(r4.get("detail")) and "没有执行" in str(r4.get("detail")),
   "R4e 文案说清「这次保存没有执行」= %r" % str(r4.get("detail"))[:60])
stX, revX, bX = rev_of()
ok(revX == revA, "R4f \U0001f534 409 之后指纹**一字未变**（%s）\u21d2 门禁在任何写之前" % revX[:8])
# 幂等：同一个过期 rev 再试一次，仍应 409（证明第一次真的什么都没写）
st4b, _ = call("POST", "/api/forecast-submissions/save-matrix", matrix_body(98, base_rev=rev0))
ok(st4b == 409, "R4g 同一过期 rev 再试仍 409（幂等，未产生\"写过一次\"的副作用）")

# ---------------------------------------------------------------- R6 同内容重复保存
print("\n\u2500\u2500 R6  同内容重复保存 \u2192 指纹不变（不误报冲突）\u2500\u2500")
st, r6 = call("POST", "/api/forecast-submissions/save-matrix", matrix_body(12, base_rev=revA))
ok(st == 200, "R6  拿回执指纹再保存 \u2192 200（实得 %s）" % st)
st6, rev6, _ = rev_of()
ok(rev6 == revA, "R6b \U0001f534 同一内容重复保存 \u21d2 指纹**不变**（%s）" % rev6[:8])
ok((r6.get("matrix_rev") or "") == revA, "R6c 回执指纹同样不变")

# ---------------------------------------------------------------- R7 脏载荷
print("\n\u2500\u2500 R7  脏载荷 \"12箱\" \u2192 400（两端同一判据）\u2500\u2500")
st, r7 = call("POST", "/api/forecast-submissions/save-matrix", matrix_body("12箱", base_rev=rev6))
ok(st == 400, "R7  脏载荷 \u2192 400（实得 %s）" % st)
v7 = r7.get("violations") or []
ok(len(v7) >= 1, "R7b 回执带 violations 清单（%d 条）" % len(v7))
if v7:
    ok(v7[0].get("kind") == "num", "R7c 首处 kind = %r" % v7[0].get("kind"))
    ok(v7[0].get("msg") == SRC_MSG.get("num"),
       "R7d 文案与后端常量逐字一致：%r" % v7[0].get("msg"))
    ok(v7[0].get("row") == 1 and v7[0].get("col") == CUST,
       "R7e 定位到具体行列 row=%r col=%r（前端才能点一行跳一格）"
       % (v7[0].get("row"), v7[0].get("col")))
stY, revY, _ = rev_of()
ok(revY == revA, "R7f 400 时指纹未变（脏载荷没写进库）")

# ---------------------------------------------------------------- R8 超上限
print("\n\u2500\u2500 R8  超上限 \u2192 400（文案带当前上限）\u2500\u2500")
_over = int(QMAX_LIVE) + 1
st, r8 = call("POST", "/api/forecast-submissions/save-matrix", matrix_body(_over, base_rev=revA))
ok(st == 400, "R8  数量 %d（上限 %s）\u2192 400（实得 %s）" % (_over, QMAX_LIVE, st))
v8 = r8.get("violations") or []
ok(bool(v8) and v8[0].get("kind") == "over", "R8b kind = %r" % (v8[0].get("kind") if v8 else None))
ok(bool(v8) and str(QMAX_LIVE) in str(v8[0].get("msg")),
   "R8c 文案带**当前**上限 %s：%r" % (QMAX_LIVE, v8[0].get("msg") if v8 else None))
# 恰好等于上限 = 合法（真实业务最大 360，不能误拒）
st, r8b = call("POST", "/api/forecast-submissions/save-matrix",
               matrix_body(int(QMAX_LIVE), base_rev=revA))
ok(st == 200, "R8d 恰好等于上限 %s \u2192 200（边界不误拒，实得 %s）" % (QMAX_LIVE, st))
st8c, rev8c, _ = rev_of()

# ---------------------------------------------------------------- R9 force 覆盖
print("\n\u2500\u2500 R9  force=true \u2192 用户显式覆盖 \u2500\u2500")
st, r9 = call("POST", "/api/forecast-submissions/save-matrix",
              matrix_body(7, base_rev=rev0, force=True))   # rev0 已过期
ok(st == 200, "R9  过期 rev + force=true \u2192 200（实得 %s）" % st)
st9, rev9, _ = rev_of()
ok(rev9 != rev8c, "R9b 覆盖真的写库了（指纹 %s \u2192 %s）" % (rev8c[:8], rev9[:8]))
ok((r9.get("matrix_rev") or "") == rev9, "R9c 覆盖后回执带新指纹")

# ---------------------------------------------------------------- R11 删列名册
print("\n\u2500\u2500 R11  删列名册计入指纹 \u2500\u2500")
st, r11 = call("POST", "/api/forecast-submissions/save-matrix",
               matrix_body(7, base_rev=rev9, hidden_customers=[CUST]))
ok(st == 200, "R11  保存 hidden_customers=[%s] \u2192 200（实得 %s）" % (CUST, st))
st11, rev11, _ = rev_of()
ok(rev11 != rev9, "R11b 只改删列名册 \u21d2 指纹也变（%s \u2192 %s）" % (rev9[:8], rev11[:8]))
st, r11c = call("POST", "/api/forecast-submissions/save-matrix",
                matrix_body(7, base_rev=rev11, hidden_customers=[]))
st11c, rev11c, _ = rev_of()
ok(rev11c == rev9, "R11c 名册复原 \u21d2 指纹回到原值（可逆、无残留：%s）" % rev11c[:8])

# ---------------------------------------------------------------- R10 小程序入口同判据
print("\n\u2500\u2500 R10  小程序入口（POST \"\"）与 Web **同一判据** \u2500\u2500")
st, r10 = call("POST", "/api/forecast-submissions", {
    "store": {"id": 1, "name": "真机验证门店"}, "note": "",
    "items": [{"product_id": 1, "product_name": "真机验证商品", "spec": "", "unit": "件",
               "quantity": "12箱"}],
})
if st == 403:
    print("     （门店越权先返回 403 —— 门禁顺序符合设计：授权先于数据。此项跳过）")
else:
    ok(st == 400, "R10  脏载荷 \u2192 400（实得 %s）" % st)
    v10 = r10.get("violations") or []
    ok(bool(v10) and v10[0].get("kind") == "num",
       "R10b kind = %r" % (v10[0].get("kind") if v10 else None))
    ok(bool(v10) and v10[0].get("col") == "报单数量",
       "R10c 小程序列名固定「报单数量」= %r" % (v10[0].get("col") if v10 else None))
    ok(bool(v10) and v10[0].get("msg") == _spec_msg.get("num"),
       "R10d \U0001f534 与 Web 端**同一句文案**（两端同源）")

# ---------------------------------------------------------------- 汇总
print("\n" + "=" * 78)
print("判据 %d 条通过 · %d 条失败" % (PASS, len(FAILS)))
for f in FAILS:
    print("   \u274c " + f)
print("VERDICT: %s" % ("PASS" if not FAILS else "FAIL"))
print("=" * 78)
sys.exit(0 if not FAILS else 1)
