# -*- coding: utf-8 -*-
"""收入/费用「供应商侧」单据精确读数（列索引逐字对齐表头，不用记忆的下标）。

表头（两文件同为 R5）：
  收入 0单据时间 1单据类型 2单据号 3往来单位 4结算单位 5收入类别 6员工 7部门 8品牌 9单据状态 10单据金额(元) 11制单时间
  费用 0单据时间 1客户对账时间 2单据类型 3单据号 4往来单位 5结算单位 6费用类别 7员工 8部门 9品牌 10单据状态 11单据金额
"""
import os
from collections import OrderedDict

import openpyxl

D = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"

CASES = [
    ("2026年8月收入明细表.xlsx", "收入单明细表", {"dt": 0, "kind": 1, "no": 2, "contact": 3,
                                             "cat": 5, "emp": 6, "brand": 8, "status": 9, "amount": 10}),
    ("2026年8月费用明细表.xlsx", "费用单明细表", {"dt": 0, "kind": 2, "no": 3, "contact": 4,
                                             "cat": 6, "emp": 7, "brand": 9, "status": 10, "amount": 11}),
]
HEADER_ROW = 4   # R5


def main():
    total_orders = 0
    for fn, sn, B in CASES:
        wb = openpyxl.load_workbook(os.path.join(D, fn), read_only=True, data_only=True)
        ws = wb[sn]
        ws.reset_dimensions()
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
        print("=" * 78)
        print(fn, " 表头核对:", [rows[HEADER_ROW][i] for i in sorted(B.values())])
        data = [r for r in rows[HEADER_ROW + 1:]
                if B["no"] < len(r) and r[B["no"]] and str(r[B["no"]]).strip() not in ("", "合计")]
        sup = [r for r in data if str(r[B["kind"]]).startswith("供应商")]
        print("  全部明细行=%d ; 供应商侧行=%d" % (len(data), len(sup)))
        orders = OrderedDict()
        for r in sup:
            no = str(r[B["no"]]).strip()
            e = orders.setdefault(no, {"kind": r[B["kind"]], "contact": r[B["contact"]],
                                       "dt": r[B["dt"]], "amount": 0.0, "status": r[B["status"]],
                                       "brand": r[B["brand"]], "cats": []})
            e["amount"] += float(r[B["amount"]] or 0)
            e["cats"].append(str(r[B["cat"]]))
        print("  ⇒ 供应商侧**单据数** = %d ; 金额合计 = %.2f" % (
            len(orders), sum(o["amount"] for o in orders.values())))
        for no, o in orders.items():
            print("     %-18s %-16s %s  %10.2f  行数=%d 状态=%s" % (
                no, o["contact"], str(o["dt"])[:19], o["amount"], len(o["cats"]), o["status"]))
            print("        类别: %s" % " | ".join(o["cats"]))
        total_orders += len(orders)
        # 日期边界：供应商侧单据的业务日期是否都在 8 月
        aug = sum(1 for o in orders.values() if str(o["dt"]).startswith("2026-08"))
        print("  业务日期在 2026-08 的供应商单 = %d / %d" % (aug, len(orders)))
    print()
    print("两个文件供应商侧单据合计 = %d 张" % total_orders)


if __name__ == "__main__":
    main()
