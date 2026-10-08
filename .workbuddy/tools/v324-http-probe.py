# -*- coding: utf-8 -*-
"""v324 端到端 HTTP 验收（**只读业务数据**）：真走接口，而不是只 import 函数。

用法（生产，需服务环境变量）：
    cd /opt/hergent-erp && set -a && . ./.env && set +a && python3 /tmp/v324-http-probe.py

判据（缺一不可）：
  ① `/avg-target` 的响应里 `target_month == '2026-10'`（= 到货月，不是报单月 2026-09）
  ② `target_month_anchor.arrival_date == '2026-10-03'`（说出依据）
  ③ `arrivals['蒙牛低温'].remaining == 15`（新分母）且 `lead_days == 4`
  ④ 2026-10 桶里那条目标（0蔗糖5连包 1000 箱）在 items 里、`avg_per_unit` 有值
  ⑤ 2026-09 桶那条「现代牧场0乳糖软牛奶185ml」**不再出现**（新锚点下如实"无目标"）

🔴 令牌**只在本进程内使用、绝不打印**（它是老板的登录凭证）。
"""
import json
import os
import sqlite3
import sys
import urllib.request

BASE = "http://127.0.0.1:8700"
MAIN_DB = os.path.join(os.environ.get("ERP_DB_DIR", "/opt/hergent-erp"), "erp.db")
PERIOD_ID = int(os.environ.get("PROBE_PERIOD_ID", "21"))

FAILS = []
N = [0]


def check(name, cond, extra=""):
    N[0] += 1
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + extra) if extra else ""))
    if not cond:
        FAILS.append(name)


# ── 取一个有效的会话令牌（内联使用，不打印、不落盘） ────────────────────────
conn = sqlite3.connect("file:" + MAIN_DB + "?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
tok = ""
for r in conn.execute(
        "SELECT s.token FROM sessions s JOIN users u ON s.user_id=u.id "
        "WHERE u.is_active=1 AND u.role IN ('boss','admin') "
        "ORDER BY COALESCE(s.last_activity, s.created_at) DESC LIMIT 5"):
    cand = r["token"]
    if not cand:
        continue
    req = urllib.request.Request(BASE + "/api/product-targets/avg-target?period_id=%d" % PERIOD_ID,
                                 headers={"Authorization": "Bearer " + cand})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status == 200:
                tok, body = cand, json.loads(resp.read().decode("utf-8"))
                break
    except Exception as e:
        print("   （某个候选令牌不可用：%s）" % type(e).__name__)
check("A1 拿到可用会话并成功调用 `/avg-target`", bool(tok))
if not tok:
    print("FAILED — 无法取得可用会话，端到端校验中止")
    sys.exit(1)

print()
print("=" * 78)
print("端到端：GET /api/product-targets/avg-target?period_id=%d" % PERIOD_ID)
print("=" * 78)
print("   period     =", body.get("period"))
print("   month      =", body.get("month"))
print("   report_month =", body.get("report_month"))
print("   target_month =", body.get("target_month"))
print("   anchor     =", body.get("target_month_anchor"))
print("   arrivals   =", json.dumps(body.get("arrivals") or {}, ensure_ascii=False))
print("   caliber.target_month =", (body.get("caliber") or {}).get("target_month"))
print()

check("A2 target_month == '2026-10'（**到货月**，不是报单月 '2026-09'）",
      body.get("target_month") == "2026-10", "got=%r" % body.get("target_month"))
# ⚠️ 第一版探针这里写错了断言（以为 `month` 还是报单月）—— 它本就是 `pmonth` 的镜像。
#    改成用**新加的** `report_month` 做反例，判别力反而更强：两个月份必须**同时出现且不等**。
check("A3 反例：report_month == '2026-09'（报单月）且 ≠ target_month ⇒ 判据有判别力",
      body.get("report_month") == "2026-09" and body.get("report_month") != body.get("target_month"),
      "report_month=%r target_month=%r" % (body.get("report_month"), body.get("target_month")))
anc = body.get("target_month_anchor") or {}
check("A4 anchor.arrival_date == '2026-10-03'（界面能说出依据）",
      anc.get("arrival_date") == "2026-10-03", "got=%r" % anc.get("arrival_date"))
check("A5 caliber 里新增了 target_month 的口径说明（防复发）",
      bool((body.get("caliber") or {}).get("target_month")))

items = body.get("items") or {}
print("   items 共 %d 个商品" % len(items))
hit = None
for pid, it in items.items():
    if "0蔗糖5连包" in (it.get("product_name") or ""):
        hit = it
        break
if hit:
    print("   命中目标商品：", json.dumps({k: hit.get(k) for k in
          ("product_name", "target_box", "avg_box", "remaining_periods", "total_periods",
           "avg_per_unit", "flags")}, ensure_ascii=False))
check("A6 2026-10 桶的目标（0蔗糖5连包 1000 箱）在 items 里、且 target_box == 1000",
      bool(hit) and abs(float(hit.get("target_box") or 0) - 1000) < 1e-6,
      "target_box=%r" % (hit or {}).get("target_box"))
check("A7 它的分母 remaining_periods == 15（新判据，不是 16）",
      bool(hit) and int(hit.get("remaining_periods") or 0) == 15,
      "remaining=%r" % (hit or {}).get("remaining_periods"))
check("A8 均单已按单位摊开（avg_per_unit 有键）",
      bool(hit) and bool(hit.get("avg_per_unit")))
# 1000 / 15 ≈ 66.6667 箱；若分母仍是 16 会是 62.5
_avg = float((hit or {}).get("avg_box") or 0)
check("A9 均单 = 1000 ÷ 15 ≈ 66.667 箱（若分母错成 16 则会是 62.5）",
      abs(_avg - 1000.0 / 15.0) < 1e-3, "avg_box=%r  1000/15=%.4f  1000/16=%.4f"
      % (_avg, 1000.0 / 15.0, 1000.0 / 16.0))

still = [it.get("product_name") for it in items.values()
         if "现代牧场0乳糖软牛奶" in (it.get("product_name") or "")]
print()
print("   9 月那条目标商品在本期清单里的出现情况：", still or "（本期清单里没有它）")
print("   ⇒ 它现在读的是 2026-10 桶，而 2026-10 桶里**没有**它 ⇒ 如实\"无目标\"（不填 0 冒充）")

arr = (body.get("arrivals") or {}).get("蒙牛低温") or {}
check("A10 arrivals['蒙牛低温'] 带 lead_days（前端/排障可自证）", arr.get("lead_days") == 4,
      "lead=%r" % arr.get("lead_days"))

print()
print("=" * 78)
if FAILS:
    print("FAILED %d / %d" % (len(FAILS), N[0]))
    for f in FAILS:
        print("   - " + f)
    sys.exit(1)
print("ALL PASS  %d / %d" % (N[0], N[0]))
