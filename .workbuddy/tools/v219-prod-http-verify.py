#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v219 真机取证（HTTP 层）：定稿闸门 + 重开闭环 + 数量上限可配。

为什么单独做一层 HTTP 取证（而不是全塞进浏览器探针）：
  本轮三条改动的**真实行为**都在服务端 —— 409 闸门、reopen 解锁、上限落库并真的生效。
  浏览器层只能证明「UI 画出来了」。两层分工见 skill hergent-prod-deploy-e2e
  「部署后行为取证：离线判据 <-> 真机判据必须成对」。

判据三纪律（沿用 v210/v213）：
  · 每个正例配一个**反例** —— 否则「无差别 200 / 无差别拦」也能全绿；
  · 每条断言能**独立失败**，不依赖前一步副作用；
  · 前置不成立时**显式记红**，不静默跳过。

用法：python3 v219-prod-http-verify.py <sandbox_token> [tenant_id]
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
        with _OPENER.open(req, timeout=60) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, raw[:400]
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:400]
    except Exception as e:
        return 0, str(e)


def matrix_body(pid, qty, cname, pname):
    return {
        "start": "2026-09-21",
        "end": "2026-09-30",
        "period_id": pid,
        "customers": [cname],
        "hidden_customers": [],
        "rows": [{
            "product_id": 0,
            "product_name": pname,
            "spec": "1",
            "unit": "件",
            "price": 1,
            "qty_by_unit": {cname: qty},
        }],
    }


print("=" * 72)
print("v219 真机取证 · HTTP 层   tenant=%s" % TID)
print("=" * 72)

# ── R1 前置：沙箱令牌真的能用 ──────────────────────────────────────────────
st, j = call("GET", "/forecast/periods")
ok(st == 200, "R1 前置：沙箱令牌可用（GET /forecast/periods 200）", "status=%s" % st)
if st != 200:
    print("!! 前置失败，后续断言全部无意义 —— 停在这里")
    print(json.dumps(j, ensure_ascii=False)[:300])
    sys.exit(1)

# ── R2 夹具：建一个测试期次 ────────────────────────────────────────────────
st, j = call("POST", "/forecast/periods", {
    "name": "v219验证期次-勿用",
    "order_start": "2026-09-21",
    "order_end": "2026-09-30",
    "arrival": "2026-10-02",
})
ok(st == 200 and isinstance(j, dict) and j.get("id"), "R2 夹具：新建测试期次成功", "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:160]))
pid = (j or {}).get("id") if isinstance(j, dict) else None
if not pid:
    print("!! 没有期次 id，后续无法进行")
    sys.exit(1)
print("   期次 id = %s" % pid)

# ── R3 正例：open 期次可以保存（证明闸门不是无差别拦） ─────────────────────
st, j = call("POST", "/forecast-submissions/save-matrix",
             matrix_body(pid, 5, "v219验证客户A", "v219验证商品A"))
ok(st == 200, "R3 正例：open 期次下 save-matrix 成功（闸门非无差别拦）", "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:160]))

# ── R4 夹具：关闭期次 ──────────────────────────────────────────────────────
st, j = call("POST", "/forecast/periods/%s/close" % pid)
ok(st == 200 and isinstance(j, dict) and j.get("success"), "R4 夹具：关闭期次成功", "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:120]))

# ── R5 ★核心：已关闭（定稿）期次的矩阵写入必须被 409 拦下 ─────────────────
st, j = call("POST", "/forecast-submissions/save-matrix",
             matrix_body(pid, 6, "v219验证客户A", "v219验证商品A"))
detail = ""
if isinstance(j, dict):
    detail = json.dumps(j, ensure_ascii=False)
else:
    detail = str(j)
ok(st == 409, "R5 ★核心：已定稿期次 save-matrix 被拦（期望 409）", "status=%s" % st)
ok("定稿" in detail and "重开" in detail,
   "R5b 拦截文案说清了「已定稿」并给出补救路径（提到重开）", detail[:200])

# ── R6 反例：force=true 也不该跳过定稿闸门（force 只跳乐观锁） ─────────────
_b = matrix_body(pid, 7, "v219验证客户A", "v219验证商品A")
_b["force"] = True
st, j = call("POST", "/forecast-submissions/save-matrix", _b)
ok(st == 409, "R6 反例：force=true 仍被拦（force 只跳乐观锁，不能跳定稿）", "status=%s" % st)

# ── R7 夹具：重开 ─────────────────────────────────────────────────────────
st, j = call("POST", "/forecast/periods/%s/reopen" % pid)
ok(st == 200 and isinstance(j, dict) and j.get("success"), "R7 夹具：重开期次成功（v219 新增端点）", "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:120]))

# ── R8 ★闭环：重开之后真的又能写了 ────────────────────────────────────────
st, j = call("POST", "/forecast-submissions/save-matrix",
             matrix_body(pid, 8, "v219验证客户A", "v219验证商品A"))
ok(st == 200, "R8 ★闭环：重开后 save-matrix 恢复可用（闸门可逆，不是永久锁死）", "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:160]))

# ── R9 反例：重开一个不存在的期次应 404（证明不是无差别 200） ─────────────
st, j = call("POST", "/forecast/periods/99999999/reopen")
ok(st == 404, "R9 反例：重开不存在的期次 -> 404（reopen 非无差别成功）", "status=%s" % st)

# ── R10 夹具：读当前数量上限 ──────────────────────────────────────────────
st, j = call("GET", "/forecast-submissions/validation-spec")
spec = (j or {}).get("spec") if isinstance(j, dict) else None
old_max = None
if isinstance(spec, dict):
    old_max = spec.get("qty_max")
ok(st == 200 and old_max is not None, "R10 前置：读到当前 qty_max", "status=%s qty_max=%s spec 键=%s" % (
    st, old_max, sorted(spec.keys())[:12] if isinstance(spec, dict) else spec))

# ── R11 改上限 ────────────────────────────────────────────────────────────
NEW_MAX = 33
st, j = call("PUT", "/forecast-submissions/validation-rules", {"qty_max": NEW_MAX})
ok(st == 200 and isinstance(j, dict) and (j.get("rules") or {}).get("qty_max") == NEW_MAX,
   "R11 数量上限可配：PUT validation-rules 改到 %s 成功" % NEW_MAX,
   "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:160]))

# ── R12 读回：真的落库了（不是只回显） ────────────────────────────────────
st, j = call("GET", "/forecast-submissions/validation-spec")
spec2 = (j or {}).get("spec") if isinstance(j, dict) else None
got_max = spec2.get("qty_max") if isinstance(spec2, dict) else None
ok(got_max == NEW_MAX, "R12 读回确认上限真的落库（GET spec qty_max == %s）" % NEW_MAX, "got=%s" % got_max)

# ── R13 ★上限真的生效：超限被拒且文案带新值 ───────────────────────────────
st, j = call("POST", "/forecast-submissions/save-matrix",
             matrix_body(pid, 500, "v219验证客户A", "v219验证商品A"))
d13 = json.dumps(j, ensure_ascii=False) if isinstance(j, (dict, list)) else str(j)
ok(st == 400, "R13 ★上限生效：qty=500 超过新上限 %s 被拒（期望 400）" % NEW_MAX, "status=%s" % st)
ok(str(NEW_MAX) in d13, "R13b 拒绝文案带的是**新**上限值 %s（证明读的是配置不是硬编码）" % NEW_MAX, d13[:220])

# ── R14 反例：非法上限必须 400，不许静默截断 ──────────────────────────────
st, j = call("PUT", "/forecast-submissions/validation-rules", {"qty_max": 0})
ok(st == 400, "R14 反例：qty_max=0 -> 400（非法值不静默截断成默认）", "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:140]))
st, j = call("GET", "/forecast-submissions/validation-spec")
spec3 = (j or {}).get("spec") if isinstance(j, dict) else None
still = spec3.get("qty_max") if isinstance(spec3, dict) else None
ok(still == NEW_MAX, "R14b 被拒后上限**未被改动**（仍是 %s）" % NEW_MAX, "got=%s" % still)

# ── R15 还原上限 ──────────────────────────────────────────────────────────
st, j = call("PUT", "/forecast-submissions/validation-rules", {"qty_max": old_max})
ok(st == 200, "R15 还原上限到原值 %s" % old_max, "status=%s" % st)

# ── R16 清理夹具期次（先关再删 —— open 期次不许删） ───────────────────────
call("POST", "/forecast/periods/%s/close" % pid)
st, j = call("DELETE", "/forecast/periods/%s" % pid)
ok(st == 200, "R16 清理：删除夹具期次", "status=%s resp=%s" % (st, json.dumps(j, ensure_ascii=False)[:120]))

# ── 汇总 ──────────────────────────────────────────────────────────────────
passed = sum(1 for c, _ in R if c)
print("-" * 72)
print("VERDICT: %d/%d PASS" % (passed, len(R)))
if passed != len(R):
    print("FAILED:")
    for c, lb in R:
        if not c:
            print("   - %s" % lb)
    sys.exit(1)
print("ALL GREEN")
