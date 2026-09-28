# -*- coding: utf-8 -*-
"""收入/费用明细核查（M0 前置）：类型↔前缀映射、一单几行、金额列、往来单位、类别取值、日期范围。"""
import os
from collections import Counter, OrderedDict

import openpyxl

D = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"

CASES = [
    ("2026年8月收入明细表.xlsx", "收入单明细表", 4,  # 表头在 R5 -> index 4
     {"dt": 0, "kind": 1, "no": 2, "contact": 3, "settle": 4, "cat": 5,
      "emp": 6, "dept": 7, "brand": 8, "status": 9, "amount": 10, "made": 11}),
    ("2026年8月费用明细表.xlsx", "费用单明细表", 4,
     {"dt": 0, "check": 1, "kind": 2, "no": 3, "contact": 4, "settle": 5, "cat": 6,
      "emp": 7, "dept": 8, "brand": 9, "status": 10, "amount": 11}),
]


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    for fn, sn, hr, B in CASES:
        fp = os.path.join(D, fn)
        wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
        ws = wb[sn]
        ws.reset_dimensions()
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
        hdr = rows[hr]
        print("=" * 78)
        print("文件:", fn, " sheet:", sn)
        print("表头(R%d):" % (hr + 1), [h for h in hdr])
        # 数据行：单号非空且 != 合计
        data = [r for r in rows[hr + 1:]
                if B["no"] < len(r) and r[B["no"]] and str(r[B["no"]]).strip() not in ("", "合计")]
        print("数据行数:", len(data))
        print()

        print("① 单据类型 ↔ 单号前缀 双源互校:")
        pair = Counter((r[B["kind"]], str(r[B["no"]])[:4]) for r in data)
        for (k, p), c in pair.most_common():
            print("     %-14s | %-6s | %d 行" % (k, p, c))
        print()

        print("② 单据号唯一性（一单几行）:")
        c = Counter(str(r[B["no"]]) for r in data)
        multi = {k: v for k, v in c.items() if v > 1}
        print("     单数 = %d ; 一单多行 = %d %s" % (len(c), len(multi), list(multi.items())[:5]))
        print()

        print("③ 金额:")
        amts = [num(r[B["amount"]]) for r in data]
        nn = [a for a in amts if a is not None]
        print("     有值 = %d / %d ; 负值 = %d ; 0 值 = %d"
              % (len(nn), len(data), sum(1 for a in nn if a < 0), sum(1 for a in nn if a == 0)))
        print("     合计 = %.2f" % sum(nn))
        print("     按类型合计:", {k: round(sum(num(r[B["amount"]]) or 0 for r in data
                                              if r[B["kind"]] == k), 2)
                                    for k in set(r[B["kind"]] for r in data)})
        print()

        print("④ 往来单位（对账时的供应商）分布:")
        for k, v in Counter(r[B["contact"]] for r in data).most_common():
            print("     %-40s %d" % (k, v))
        print()

        print("⑤ 类别取值:")
        for k, v in Counter(r[B["cat"]] for r in data).most_common(12):
            print("     %-44s %d" % (str(k)[:44], v))
        print()

        print("⑥ 单据状态:", Counter(r[B["status"]] for r in data).most_common())
        print("⑦ 单据时间范围:",
              min(str(r[B["dt"]]) for r in data), "..", max(str(r[B["dt"]]) for r in data))
        print("⑧ 员工:", Counter(r[B["emp"]] for r in data).most_common(8))
        print("⑨ 品牌:", Counter(r[B["brand"]] for r in data).most_common(8))
        print()

        print("⑩ 按类型全样本行（每类最多 3 行）:")
        seen = {}
        for r in data:
            k = r[B["kind"]]
            seen[k] = seen.get(k, 0) + 1
            if seen[k] <= 3:
                print("     %-14s %-18s %-16s 金额=%s 往来=%s 类别=%s 时间=%s"
                      % (k, r[B["no"]], str(r[B["contact"]])[:16],
                         r[B["amount"]], r[B["contact"]], str(r[B["cat"]])[:20], r[B["dt"]]))
        print()


if __name__ == "__main__":
    main()
