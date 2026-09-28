# -*- coding: utf-8 -*-
"""用正解 reset_dimensions() 读三份舟谱财务单据的表头与样本行。

目的：为 zhoupu_documents.py 新增 SPECS 提供**逐字**列名（不许凭记忆写）。
产出：每个文件 -> sheet 名 / 表头行号 / 全部列名 / 前 3 行样本 / 末行 / 行数。
"""
import os
import sys

import openpyxl

D = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"
FILES = [
    "20260801-20260831采购单明细.xlsx",
    "2026年8月收入明细表.xlsx",
    "2026年8月费用明细表.xlsx",
]


def norm(s):
    import re
    return re.sub(r"[\s（）()（）+到货发货单号下单，,：:、·*×xX\-—]", "", str(s or ""))


def main():
    for fn in FILES:
        fp = os.path.join(D, fn)
        if not os.path.exists(fp):
            print("!! 缺失:", fp)
            continue
        print("=" * 78)
        print("文件:", fn)
        wb = openpyxl.load_workbook(fp, read_only=True, data_only=True)
        try:
            for sn in wb.sheetnames:
                ws = wb[sn]
                ws.reset_dimensions()
                rows = []
                for i, r in enumerate(ws.iter_rows(values_only=True)):
                    rows.append((i, list(r)))
                print("  sheet「%s」 总行数=%d" % (sn, len(rows)))

                # 找表头行：命中「单据」+ 列数最多的那一行算表头候选，人工再看
                best = None
                for i, vals in rows[:12]:
                    nonempty = len([v for v in vals if v not in (None, "")])
                    if best is None or nonempty > best[0]:
                        best = (nonempty, i, vals)
                print("  表头候选: R%d （非空列 %d）" % (best[1] + 1, best[0]))
                hdr = best[2]
                hdr_row = best[1]
                for j, h in enumerate(hdr):
                    if h in (None, ""):
                        continue
                    print("     col[%2d] = %r   (norm=%r)" % (j, h, norm(h)))
                print("  --- 前 3 行数据 ---")
                shown = 0
                for i, vals in rows[hdr_row + 1:]:
                    if all(v in (None, "") for v in vals):
                        continue
                    print("   R%d: %s" % (i + 1, [v for v in vals][:12]))
                    shown += 1
                    if shown >= 3:
                        break
                print("  --- 末 3 行 ---")
                for i, vals in rows[-3:]:
                    print("   R%d: %s" % (i + 1, [v for v in vals][:12]))
        finally:
            wb.close()
        print()


if __name__ == "__main__":
    main()
