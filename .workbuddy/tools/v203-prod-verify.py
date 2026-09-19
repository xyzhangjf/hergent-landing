#!/usr/bin/env python3
"""v203 生产只读验证：报单配置「对象类型」收敛为 门店 / 本人仓。

只读 —— 不写任何一行生产数据。
必须带 ERP_SECRET 跑：`set -a && . /opt/hergent-erp/.env && set +a && python3 ...`
否则 `employee_account_map()` 抛错被外层 try 静默吞掉，`employee_list()` 不返回 store_ids，
看起来像「代码没生效」（上轮踩过）。

🔴 还**必须** `set_tenant_context(1)` —— 见下。
"""
import sys
sys.path.insert(0, "/opt/hergent-erp")

# 🔴 2026-09-19 踩坑：裸脚本调后端业务函数时，租户上下文是 ContextVar（默认 None）——
#    不设它，`get_db()` 会落到「非租户库」，于是 `report_mapping_list()` 返回 0 条、
#    `employee_stores_get(7)` 返回 []。症状与「代码没生效 / 数据被删光」**一模一样**，
#    极易误判成回归（本轮就先把这条当成 2 个 BAD 报了出来）。
#    凡在服务进程之外直调业务函数，**第一件事就是设租户**。
from db.connection import set_tenant_context   # noqa: E402
set_tenant_context(1)                          # 租户 1 = 永诺（真实数据所在）

import erp_db                                  # noqa: E402

bad = 0
def chk(ok, label, extra=""):
    global bad
    bad += 0 if ok else 1
    print("  %s %s%s" % ("ok " if ok else "BAD", label, ("  " + extra) if extra else ""))

print("=" * 78)
print("A 归一函数（生产环境真值表）")
print("=" * 78)
CASES = [("store", "store"), ("customer", "store"), ("  customer  ", "store"),
         ("self_warehouse", "self_warehouse"), ("", None), (None, None), ("customerX", None)]
for inp, want in CASES:
    got = erp_db.normalize_report_cp_type(inp)
    chk(got == want, "normalize(%r) -> %r" % (inp, want), "得到 %r" % got)

print()
print("=" * 78)
print("B 常量已随部署上线")
print("=" * 78)
chk(erp_db.REPORT_CP_TYPES == ("store", "self_warehouse"), "REPORT_CP_TYPES 正确")
chk(erp_db.REPORT_CP_ALIASES == {"customer": "store"}, "REPORT_CP_ALIASES 正确")
chk(hasattr(erp_db, "normalize_report_cp_type"), "归一函数存在")

print()
print("=" * 78)
print("C 现有映射未被改动（收敛是写端行为，存量不动）")
print("=" * 78)
rows = erp_db.report_mapping_list(include_inactive=1)
print("  映射总数: %d" % len(rows))
for r in rows:
    print("    · type=%-15s 简称=%-10s 全称=%s active=%s"
          % (r["counterparty_type"], r["report_alias"], r["system_name"], r.get("is_active")))
n_customer = sum(1 for r in rows if r["counterparty_type"] == "customer")
chk(n_customer == 0, "存量 customer 行为 %d（预期 0 —— 本轮无数据迁移）" % n_customer)
chk(len(rows) == 3, "映射总数仍为 3（未被本轮改动增删）", "实为 %d" % len(rows))

print()
print("=" * 78)
print("D 小程序可见门店（回归：本轮不应改变可见范围）")
print("=" * 78)
try:
    stores = erp_db.employee_stores_get(7)
    print("  员工 7 可见门店: %s" % stores)
    chk(len(stores) == 3, "仍为 3 家（与 v200 收敛后一致）", "实为 %d" % len(stores))
except Exception as e:
    chk(False, "employee_stores_get(7) 抛错", str(e))

print()
print("=" * 78)
print("E 配置体检口径未被波及")
print("=" * 78)
try:
    h = erp_db.report_mapping_health()
    print("  未配置门店=%s 别名冲突=%s 未分配员工=%s"
          % (h["unmapped_count"], len(h["alias_conflicts"]), h["unassigned_count"]))
    chk(isinstance(h["unmapped_count"], int), "health 正常返回")
except Exception as e:
    chk(False, "report_mapping_health 抛错", str(e))

print()
print("=" * 78)
print("BAD=%d  %s" % (bad, "全部通过" if not bad else "有失败项"))
print("=" * 78)
sys.exit(1 if bad else 0)
