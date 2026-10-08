# -*- coding: utf-8 -*-
"""v364 生产接口层真机探针（只读为主 + 一次可完全复原的写循环）。

为什么必须做这一层：影子库验收脚本是**直接调函数**的，绕过了 FastAPI 路由注册
与 nginx 转发 —— 而本项目反复栽在「路由遮蔽 / 方法不放行」上（如 /arrival-preview
被 /{rule_id} 抢走）。这一段专门补这个缺口。
"""
import json
import re
import sys
import urllib.error
import urllib.request

BASE = "https://hergent.cn"
RULES = "/api/rebate-rules"

_P, _F = [], []


def ok(name, cond, detail=""):
    (_P if cond else _F).append(name)
    print(("  PASS  " if cond else "  🔴FAIL ") + name + ((" | " + str(detail)) if detail else ""))


def sec(t):
    print("\n" + "=" * 74 + "\n" + t + "\n" + "=" * 74)


def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    r.add_header("X-Client", "web")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except Exception:
            return e.code, {"_raw": raw[:300]}
    except Exception as e:
        return 0, {"_err": str(e)}


# 凭据从既有工具文件里读，避免在本脚本里再抄一遍明文
def creds():
    src = open("/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/"
               "hergent-forecast-smoke.mjs", encoding="utf-8").read()
    u = re.search(r"HG_USER \|\| '([^']*)'", src).group(1)
    p = re.search(r"HG_PASS \|\| '([^']*)'", src).group(1)
    return u, p


U, P = creds()
sec("0. 登录（拿真 token）")
st, d = req("POST", "/api/auth/login", body={"username": U, "password": P})
TOK = d.get("access_token") or d.get("token") or ""
ok("0.1 登录成功", st == 200 and bool(TOK), "status=%s user=%s" % (st, U))
if not TOK:
    print(json.dumps(d, ensure_ascii=False)[:400]); sys.exit(2)

sec("1. 列表接口：arrival_ym 按月取数（冲刺看板口径）")
st10, d10 = req("GET", RULES + "?arrival_ym=2026-10", TOK)
st11, d11 = req("GET", RULES + "?arrival_ym=2026-11", TOK)
ok("1.1 GET /api/rebate-rules?arrival_ym=2026-10 通", st10 == 200, st10)
am10 = {}
if st10 == 200:
    am10 = {i["id"]: i.get("arrival_month") for i in d10.get("data", [])}
ok("1.2 三条品牌规则都带回 arrival_month",
   all(am10.get(i) for i in (9, 10, 11)),
   {k: (v or {}).get("ym") for k, v in am10.items()})
ok("1.3 10 月：蒙牛鲜奶系统推算 16 / 实到 16",
   am10.get(11, {}).get("system_count") == 16 and am10[11]["count"] == 16,
   am10.get(11))
ok("1.4 🔴 迁移后的不一致**被显式回传**：蒙牛低温日历 16、次数 15",
   am10.get(10, {}).get("count") == 16 and am10[10]["effective_count"] == 15
   and am10[10]["count_mismatch"] is True, am10.get(10))
am11 = {}
if st11 == 200:
    am11 = {i["id"]: i.get("arrival_month") for i in d11.get("data", [])}
ok("1.5 🔴 换月即换口径：arrival_ym=2026-11 ⇒ ym=2026-11、次数 15（不是 10 月的 16）",
   am11.get(11, {}).get("ym") == "2026-11" and am11[11]["count"] == 15,
   am11.get(11))

sec("2. 新路由是否被 /{rule_id} 遮蔽（GET，只读）")
st, s11 = req("GET", RULES + "/11/arrival-skips?year=2026&month=10", TOK)
ok("2.1 GET /{id}/arrival-skips 返回 200（没被 /{rule_id} 抢走）", st == 200, st)
data = s11.get("data") or {}
ok("2.2 是到货排程的返回体（不是「规则详情」：有 system_dates / ym）",
   isinstance(data, dict) and "system_dates" in data and data.get("ym") == "2026-10",
   list(data.keys())[:8])
ok("2.3 原样回读字段在（表单往返用）", data.get("skip_dates_stored") == "",
   repr(data.get("skip_dates_stored")))
ok("2.4 10 月：系统 16 / 实到 16 / 覆盖 16（迁移来的值原样在）",
   data.get("system_count") == 16 and data.get("count") == 16
   and data.get("count_override") == 16,
   (data.get("system_count"), data.get("count"), data.get("count_override")))
stm, sm = req("GET", RULES + "/10/arrival-skips?year=2026&month=10", TOK)
dm = sm.get("data") or {}
ok("2.5 蒙牛低温：日历 16 天 vs 迁移来的 15 次 ⇒ mismatch 被标出（界面据此告警）",
   dm.get("count") == 16 and dm.get("count_override") == 15
   and dm.get("count_mismatch") is True, dm.get("count_mismatch"))

sec("3. 写路径真机循环（PUT 是可完全复原的：改完立刻改回）")
st, r1 = req("PUT", RULES + "/11/arrival-skips",
             TOK, {"year": 2026, "month": 10, "skip_dates": "2026-10-05"})
d1 = r1.get("data") or {}
ok("3.1 PUT 放行（nginx/路由都不拦，200）", st == 200, st)
ok("3.2 🔴 停 10-05 ⇒ 实到 16→15，且**不改节奏**（10-07 仍在日历里）",
   d1.get("count") == 15 and "2026-10-05" not in (d1.get("dates") or [])
   and "2026-10-07" in (d1.get("dates") or []),
   (d1.get("count"), d1.get("dates", [])[:3]))
ok("3.3 🔴 哨兵生效：没传 count_override ⇒ 迁移来的 16 **仍在**（没被顺手抹掉）",
   d1.get("count_override") == 16, d1.get("count_override"))
# 3.4 这里断言的是**设计语义**而不是「分母一定等于日历」：
#   该月存在显式次数（16，迁移来的）时，按 `eff = 显式次数 else 日历` 取 16，
#   同时把「次数 16 vs 日历 15」的冲突**显式回传**（count_mismatch）⇒ 界面据此告警并给
#   「按日历对齐」一键收敛。绝不静默取其中一个 —— 这正是本项目反复栽的坑的正面做法。
#   （「无显式次数时分母跟随日历」由影子库验收 D5 / H2 覆盖：19.6万÷15=1.3067。）
ok("3.4 有显式次数时它优先（eff=16），但冲突被显式标出（不静默）",
   d1.get("effective_count") == 16 and d1.get("count_mismatch") is True
   and d1.get("count_source") == "override",
   (d1.get("effective_count"), d1.get("count_mismatch"), d1.get("count_source")))
ok("3.4b 而**日历本身**确实少了那一天（停单在日期级真的生效）",
   len(d1.get("system_dates") or []) == 16 and len(d1.get("dates") or []) == 15,
   (len(d1.get("system_dates") or []), len(d1.get("dates") or [])))

st, r2 = req("PUT", RULES + "/11/arrival-skips",
             TOK, {"year": 2026, "month": 10, "skip_dates": "2026-10-05,2026-10-07"})
d2 = r2.get("data") or {}
ok("3.5 再停一天 ⇒ 14（停单可累加）", d2.get("count") == 14, d2.get("count"))

st, r3 = req("PUT", RULES + "/11/arrival-skips",
             TOK, {"year": 2026, "month": 10, "skip_dates": ""})
d3 = r3.get("data") or {}
ok("3.6 复原：清空停单 ⇒ 回到 16，且覆盖值仍是 16（= 与上线前**逐字段一致**）",
   d3.get("count") == 16 and d3.get("count_override") == 16
   and d3.get("skipped") == [], (d3.get("count"), d3.get("count_override")))

sec("4. 按月作用域自证：11 月完全不受影响（= 下月自动回系统推算）")
st, sn = req("GET", RULES + "/11/arrival-skips?year=2026&month=11", TOK)
dn = sn.get("data") or {}
ok("4.1 11 月：无停单、无覆盖、次数 15 = 系统推算（反例对照）",
   dn.get("skipped") == [] and dn.get("count_override") is None
   and dn.get("count") == dn.get("system_count") == 15,
   (dn.get("count"), dn.get("system_count"), dn.get("count_override")))
st, sr = req("GET", RULES + "/11/arrival-skips?year=2026&month=10", TOK)
dr = sr.get("data") or {}
ok("4.2 10 月记录已复原（停单为空）", dr.get("skipped") == [] and dr.get("count") == 16,
   (dr.get("count"), dr.get("skipped")))

sec("5. 文案与只读保护（抽查）")
st, _ = req("GET", RULES + "/11/arrival-skips?year=2026&month=10")
ok("5.1 未带 token ⇒ 401/403（不是 200）", st in (401, 403), st)

sec("汇总")
print("  合计 %d 项：PASS %d / FAIL %d" % (len(_P) + len(_F), len(_P), len(_F)))
if _F:
    print("  🔴 失败项：")
    for f in _F:
        print("     -", f)
sys.exit(1 if _F else 0)
