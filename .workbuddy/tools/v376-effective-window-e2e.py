# -*- coding: utf-8 -*-
"""v376 端到端实算：走**真实 API 用的那条链**
`routers/rebate_rules.compute_rebate` → `domain.rebate_calc.compute_rule_rebate`
（= 先 monthly_view() 投影到当月，再 _build_spec，最后 compute_rebate_unified 做门禁+算式）。

⚠️ 探针自身踩过的坑（第一次跑出 6 个假 FAIL）：直接调 `compute_rebate_unified` 会
   **跳过 monthly_view 投影** ⇒ target_value 停在年度总额（838.4 万），于是 10 月达成率
   被算成 5.4% ⇒ 误判「10 月被生效期挡掉」。**投影是调用方的职责，不是内核的职责。**

输入 = 生产库 tenant_1.db 真实规则（只读导出）
源码 = 本地 domain/（md5 已核 == 生产）
"""
import json, sys

SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server"
sys.path.insert(0, SRC)
from domain.rebate_calc import compute_rule_rebate       # noqa: E402

with open("/tmp/v376-rules.json", "rb") as f:
    rules = json.loads(f.read().decode("utf-8"))
by_id = {r["id"]: r for r in rules}
R9, R10 = by_id[9], by_id[10]          # 简爱9月目标；蒙牛低温2026年目标

PASS = FAIL = 0

def ck(desc, got, exp):
    global PASS, FAIL
    ok = (got == exp)
    PASS, FAIL = PASS + ok, FAIL + (not ok)
    print("  [%s] %-56s 实测=%-12s 期望=%s" % ("PASS" if ok else "FAIL", desc, got, exp))


def run(rule, basis, as_of):
    # 真实入口：amount 维度传 achieved_amount，qty 传 0（与 simulate-batch 一致）
    return compute_rule_rebate(rule, basis, 0.0, ref_date=as_of)

print("=== 1. 蒙牛低温2026年目标（12 月分解齐全，生效期 09-01~09-30）===")
r = run(R10, 450000.0, "2026-10-15")
print("    as_of=2026-10-15  触发=%s  目标=%.0f  达成率=%.2f%%  返利=%.2f"
      % (r.get("triggered"), r.get("target_value") or 0,
         (r.get("achievement_pct") or 0) * 100, r.get("rebate") or 0))
ck("10月 触发", r.get("triggered"), True)
ck("10月 目标值=400000（来自月度分解，非年度总额）", r.get("target_value"), 400000.0)
ck("10月 返利 = 45万 × 15% = 67500", round(r.get("rebate") or 0, 2), 67500.0)

r9 = run(R10, 700000.0, "2026-09-30")
print("    as_of=2026-09-30  触发=%s  目标=%.0f  返利=%.2f"
      % (r9.get("triggered"), r9.get("target_value") or 0, r9.get("rebate") or 0))
ck("9月 目标值=674000", r9.get("target_value"), 674000.0)
ck("9月 返利 = 70万 × 10% = 70000", round(r9.get("rebate") or 0, 2), 70000.0)

print("\n=== 2. 反例：简爱9月目标（分解只有 09/10）===")
r_oct = run(R9, 90000.0, "2026-10-15")
print("    as_of=2026-10-15  触发=%s  目标=%s  返利=%s"
      % (r_oct.get("triggered"), r_oct.get("target_value"), r_oct.get("rebate")))
ck("10月 有分解 ⇒ 正常触发（目标 8 万）", r_oct.get("target_value"), 80000.0)
ck("10月 返利 = 9万 × 10% = 9000", round(r_oct.get("rebate") or 0, 2), 9000.0)

r_nov = run(R9, 90000.0, "2026-11-15")
print("    as_of=2026-11-15  触发=%s  返利=%s  detail=%r"
      % (r_nov.get("triggered"), r_nov.get("rebate"), r_nov.get("detail") or ""))
ck("11月 无分解 ⇒ 不触发（门禁有效，不是恒放行）", r_nov.get("triggered"), False)
ck("11月 返利为 0", r_nov.get("rebate") or 0, 0.0)

print("\n=== 3. 判别力自证：把停用日放宽到 12-31，11 月会放行吗？===")
R9_wide = dict(R9, effective_end="2026-12-31")
rn = run(R9_wide, 90000.0, "2026-11-15")
ck("11月 即便停用日放宽到 12-31 仍不触发（分解里没有 11 月）",
   rn.get("triggered"), False)
print("    ⇒ 证明：裁不裁剪**只看月度分解**，生效期改大改小都不影响 —— "
      "这是「生效期不是月份门禁」的运行时证据。")

print("\n结果: %d 通过 / %d 失败" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
