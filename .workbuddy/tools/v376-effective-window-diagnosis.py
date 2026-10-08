# -*- coding: utf-8 -*-
"""v376 诊断：生效期止于 2026-09-30 是否挡掉 2026-10 的目标？

输入 = 生产库 tenant_1.db 真实 3 条规则（只读导出）
源码 = 本地 domain/rebate_period.py（md5 已核 == 生产 c27bc11917faaf65bd2abf1f0702a492）
"""
import json, sys, hashlib

SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server"
sys.path.insert(0, SRC)
from domain.rebate_period import (                      # noqa: E402
    covered_months, rule_covers_month, rule_covers_date, monthly_view,
    month_in_range, rule_year, parse_monthly,
)

with open("/tmp/v376-rules.json", "rb") as f:
    raw = f.read()
print("规则数据 md5 =", hashlib.md5(raw).hexdigest())
rules = json.loads(raw.decode("utf-8"))
print("规则条数 =", len(rules))

PASS = FAIL = 0

def ck(desc, got, exp):
    global PASS, FAIL
    ok = (got == exp)
    PASS, FAIL = PASS + ok, FAIL + (not ok)
    print("  [%s] %-52s 实测=%-28s 期望=%s" % ("PASS" if ok else "FAIL", desc, got, exp))

# ── 第 0 步：先自证判别力（否则"全 True"也能骗过后面所有断言）──────────
print("\n=== 0. 判别力自证（正反两侧，缺一不可）===")
single_sep = {"period_type": "month", "monthly_amounts": "", "monthly_rates": "",
              "effective_start": "2026-09-01", "effective_end": "2026-09-30"}
ck("反例① 无分解+生效期仅9月 ⇒ 不覆盖 10 月",
   rule_covers_month(single_sep, 2026, 10), False)
ck("反例② 同一条 ⇒ 覆盖 9 月",
   rule_covers_month(single_sep, 2026, 9), True)
ck("反例③ 无分解+生效期仅9月 ⇒ 不覆盖 11 月",
   rule_covers_month(single_sep, 2026, 11), False)
no_ma_year = dict(single_sep, period_type="year")
ck("反例④ period_type=year 但无分解+生效期仅9月 ⇒ 仅 1 个月",
   sorted(covered_months(no_ma_year)), ["2026-09"])
has10 = {"period_type": "year", "monthly_amounts": '{"09":100,"10":200}',
         "effective_start": "2026-09-01", "effective_end": "2026-09-30"}
ck("正例⑤ 有分解含10月+生效期仅9月 ⇒ 覆盖 10 月（待验主张）",
   rule_covers_month(has10, 2026, 10), True)
has10_no = {"period_type": "year", "monthly_amounts": '{"09":100}'}
ck("反例⑥ 有分解但不含10月 ⇒ 不覆盖 10 月",
   rule_covers_month(has10_no, 2026, 10), False)

# ── 1. 真实 3 条规则 ────────────────────────────────────────────────
print("\n=== 1. 生产真实规则：生效期 vs 实际覆盖月份 ===")
for r in rules:
    rn = r["rule_name"]
    am = parse_monthly(r.get("monthly_amounts"))
    cov = sorted(covered_months(r))
    oct_ok = rule_covers_month(r, 2026, 10)
    oct_date = rule_covers_date(r, "2026-10-15")
    v = monthly_view(r, "2026-10")
    # 旧口径（v186 之前）：covered ∩ month_in_range 取交集
    old_hit = month_in_range("2026-10", r.get("effective_start"), r.get("effective_end"))
    print("\n  ▸ %s  (id=%s)" % (rn, r["id"]))
    print("    生效期        = %s ~ %s   target_year=%s → rule_year=%s"
          % (r.get("effective_start"), r.get("effective_end"),
             r.get("target_year"), rule_year(r)))
    print("    月度分解键    = %s" % sorted(am.keys()))
    print("    covered_months()      = %s" % cov)
    print("    旧口径(交集)覆盖10月? = %s" % old_hit)
    ck("  %s / 覆盖 2026-10（月粒度）" % rn, oct_ok, "2026-10" in cov)
    ck("  %s / 覆盖 2026-10-15（日粒度）" % rn, oct_date, oct_ok)
    print("    monthly_view('2026-10') ⇒ target_value=%s  rebate_rate=%s"
          % (v.get("target_value"), v.get("rebate_rate")))

# ── 2. 口径差异统计 ────────────────────────────────────────────────
print("\n=== 2. 新旧口径对本租户 3 条规则的差异（本项是本轮的核心读数）===")
diff = 0
for r in rules:
    new = rule_covers_month(r, 2026, 10)
    old = ("2026-10" in covered_months(r)) and month_in_range(
        "2026-10", r.get("effective_start"), r.get("effective_end"))
    if new != old:
        diff += 1
        print("  ▸ 口径不同：%-28s 现行=%s  旧(交集)口径=%s" % (r["rule_name"], new, old))
ck("3 条规则里新老口径结论不同的条数", diff, 3)
print("  ⇒ 差异 3/3 = **全部 3 条**：现行实现放行 10 月，"
      "而 v186 之前的「交集」口径会把 10 月全部挡掉。")
print("     即：这个修复不是理论优化，是本租户每天在跑的业务正靠它成立。")

# ── 3. 任意抽查：11/12 月 ──────────────────────────────────────────
print("\n=== 3. 顺带抽查 2026-11 / 2026-12 ===")
for r in rules:
    for mm in (11, 12):
        print("  %-30s 2026-%02d ⇒ %s" % (r["rule_name"], mm,
                                          rule_covers_month(r, 2026, mm)))

print("\n结果: %d 通过 / %d 失败" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
