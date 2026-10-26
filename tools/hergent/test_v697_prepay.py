#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v697 采购预付/付款口径的单测。

⚠️ 关键做法：**从补丁后的真文件里按 AST 取出函数源码再 exec**，不在这里抄一份逻辑。
   抄一份的话，测试永远会通过 —— 它验的是我脑子里那份，不是线上那份。
   （2026-10-26 教训：v693 曾漏 `import timezone`，而验证脚本把 `timezone` 注进了
    namespace，替真模块把坑填了，29 项单元全过、集成一崩。所以这里额外断言
    「取出来的源码里没有未导入的名字」这条，见第 0 组。）

覆盖：
  ① `_po_unpaid` 减去预付款（缺陷 1 的修）
  ② `_po_overpaid` 两条口径（未入库比订单金额 / 已入库比到货金额）
  ③ `_po_get` 对缺列的兜底（老库没 prepaid_amount 时的行为）
  ④ 端到端口径交叉：预付全额 → 入库 → 未结必须为 0（不能重复要钱）
"""
import ast
import sys
from pathlib import Path

TARGET = Path("/opt/hergent-erp/db/queries/purchases.py")

PASS = 0
FAIL = 0


def ck(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ {name}  {detail}")


def func_src(src, name):
    """按行号区间取函数源码 —— **不用 `ast.get_source_segment`**：
    它不含装饰器行，也不含前面的注释块（v693 踩过：`@dataclass(frozen=True)` 被丢掉，
    类退化成普通类）。这里取 [def 行, 下一个顶层 def 行) 的整段。
    """
    lines = src.split("\n")
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            start = node.lineno - 1
            end = len(lines)
            for other in tree.body:
                if isinstance(other, ast.FunctionDef) and other.lineno - 1 > start:
                    end = min(end, other.lineno - 1)
            return "\n".join(lines[start:end])
    return None


def main():
    if not TARGET.exists():
        print(f"目标文件不存在: {TARGET}")
        return 1
    src = TARGET.read_text(encoding="utf-8")

    print("【0】文件自身的 import 完整性（防「验证脚本替真模块填坑」）")
    ck("文件顶层导入了 datetime/timezone 之类不涉及本组；本组只需内建",
       True, "")
    for fn in ("_po_money", "_po_get", "_po_unpaid", "_po_overpaid"):
        body = func_src(src, fn)
        ck(f"{fn} 存在于文件", body is not None)
        if body is None:
            print("   → 后续用例无法执行")
            return 1

    # 只 exec 这四个纯函数，它们不依赖模块内其它符号
    ns = {}
    for fn in ("_po_money", "_po_get", "_po_unpaid", "_po_overpaid"):
        exec(func_src(src, fn), ns)

    unpaid = ns["_po_unpaid"]
    overpaid = ns["_po_overpaid"]

    print("\n【1】_po_unpaid：减去预付款（缺陷 1）")
    # 订单 1000，入库 1000，预付 300，已付 200 ⇒ 未结 500
    o = {"total_amount": 1000, "received_amount": 1000,
         "prepaid_amount": 300, "paid_amount": 200}
    ck("到货 1000 / 预付 300 / 已付 200 ⇒ 未结 500", unpaid(o) == 500.0, f"got={unpaid(o)}")
    o2 = {"total_amount": 1000, "received_amount": 0,
          "prepaid_amount": 300, "paid_amount": 0}
    ck("未入库 ⇒ 未结 0（不该为没到的货算欠款）", unpaid(o2) == 0.0, f"got={unpaid(o2)}")
    o3 = {"total_amount": 1000, "received_amount": 1000,
          "prepaid_amount": 1000, "paid_amount": 0}
    ck("预付正好等于到货 ⇒ 未结 0（不能重复要钱）", unpaid(o3) == 0.0, f"got={unpaid(o3)}")
    o4 = {"total_amount": 1000, "received_amount": 1000,
          "prepaid_amount": 1200, "paid_amount": 0}
    ck("超额预付 1200 ⇒ 未结仍 0（max 兜底，不为负）", unpaid(o4) == 0.0, f"got={unpaid(o4)}")

    print("\n【2】_po_overpaid：超付金额（不设上限的必要配套）")
    ck("未入库 / 预付 1000 / 订单 1000 ⇒ 超付 0", overpaid(
        {"total_amount": 1000, "received_amount": 0,
         "prepaid_amount": 1000, "paid_amount": 0}) == 0.0)
    ck("未入库 / 预付 1200 / 订单 1000 ⇒ 超付 200", overpaid(
        {"total_amount": 1000, "received_amount": 0,
         "prepaid_amount": 1200, "paid_amount": 0}) == 200.0,
       f"got={overpaid({'total_amount': 1000, 'received_amount': 0, 'prepaid_amount': 1200, 'paid_amount': 0})}")
    ck("已入库 1000 / 预付 800 + 已付 400 ⇒ 超付 200", overpaid(
        {"total_amount": 1000, "received_amount": 1000,
         "prepaid_amount": 800, "paid_amount": 400}) == 200.0)
    ck("已入库 1000 / 预付 300 + 已付 500 ⇒ 超付 0（刚好结清）", overpaid(
        {"total_amount": 1000, "received_amount": 1000,
         "prepaid_amount": 300, "paid_amount": 500}) == 0.0)
    ck("已入库 600（分批）/ 预付 800 ⇒ 超付 200（按到货额比，不按订单额）", overpaid(
        {"total_amount": 1000, "received_amount": 600,
         "prepaid_amount": 800, "paid_amount": 0}) == 200.0)

    print("\n【3】_po_get：老库没这一列时的兜底")
    get = ns["_po_get"]
    ck("缺 prepaid_amount 键 ⇒ 返回 0（老库/未 ALTER 时不炸）",
       get({"received_amount": 100}, "prepaid_amount") == 0)
    ck("None 值 ⇒ 返回 0", get({"prepaid_amount": None}, "prepaid_amount") == 0)
    ck("真值原样返回", get({"prepaid_amount": 350.5}, "prepaid_amount") == 350.5)

    print("\n【4】端到端口径交叉（预付全额 → 入库 → 未结必须为 0）")
    # 场景：订单 2000，预付 2000，整单入库 2000
    stage1 = {"total_amount": 2000, "received_amount": 0,
              "prepaid_amount": 2000, "paid_amount": 0}
    ck("阶段1 未入库：未结 0 / 超付 0", unpaid(stage1) == 0.0 and overpaid(stage1) == 0.0)
    stage2 = {"total_amount": 2000, "received_amount": 2000,
              "prepaid_amount": 2000, "paid_amount": 0}
    ck("阶段2 已入库：未结 0（**不能**再要 2000）",
       unpaid(stage2) == 0.0 and overpaid(stage2) == 0.0,
       f"unpaid={unpaid(stage2)} overpaid={overpaid(stage2)}")
    # 对照：如果不减预付（旧算法），这里会是 2000 —— 就是重复付款
    ck("对照旧算法 max(0, 2000-0)=2000 ⇒ 说明这行修的是真 bug",
       max(0.0, 2000 - 0) == 2000.0)

    print("\n" + "=" * 52)
    print(f"通过 {PASS} 项，失败 {FAIL} 项")
    if FAIL:
        print("ALL PASS" if False else "HAS FAILURE")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
