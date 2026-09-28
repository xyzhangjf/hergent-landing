# -*- coding: utf-8 -*-
"""采购明细全列核查（M0 前置）：
① 采购入库数量 是否有值（用户指定用它核对）；
② 三个「单位名称」列（订单/入库/退货）取值是否一致；
③ 采购价 的量级（判断是元/大单位还是元/小单位）；
④ 单据 → 供应商 是否一对一；单号前缀与单据类型是否一致。
"""
import os
from collections import Counter, OrderedDict

import openpyxl

D = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"
FP = os.path.join(D, "20260801-20260831采购单明细.xlsx")


def main():
    wb = openpyxl.load_workbook(FP, read_only=True, data_only=True)
    ws = wb["采购明细"]
    ws.reset_dimensions()
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()
    hdr = rows[4]
    print("表头(R5):", [h if h not in (None, "") else "·" for h in hdr])
    print()
    idx = {h: i for i, h in enumerate(hdr) if h}
    print("同名列索引:")
    for name in ("单据", "单位名称", "采购入库数量", "订单数量", "采购退货数量", "采购价", "参考成本价"):
        pos = [i for i, h in enumerate(hdr) if h == name]
        print("   %-12s -> %s" % (name, pos))
    print()

    data = [r for r in rows[5:] if r and str(r[0] or "") not in ("合计", "")]
    print("明细行数:", len(data))
    print()

    i_no, i_prod, i_sup = 0, 1, 3
    i_ordq, i_inq, i_retq = 8, 13, 18
    i_u_ord, i_u_in, i_u_ret = 9, 14, 19
    i_price = 23
    i_status = 25

    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    zero_in = sum(1 for r in data if not num(r[i_inq]))
    nz_in = [r for r in data if num(r[i_inq])]
    print("采购入库数量: 为空/0 的行 = %d / %d ; 有值 = %d" % (zero_in, len(data), len(nz_in)))
    print("  有值样本（前 6 行）:")
    for r in nz_in[:6]:
        print("    单=%s 商品=%s 订单q=%s(%s) 入库q=%s(%s) 退货q=%s(%s) 采购价=%s"
              % (r[i_no], str(r[i_prod])[:22], r[i_ordq], r[i_u_ord],
                 r[i_inq], r[i_u_in], r[i_retq], r[i_u_ret], r[i_price]))
    print()

    print("三个单位列取值一致性（订单 vs 入库 vs 退货）:")
    mism = 0
    for r in data:
        a, b, c = r[i_u_ord], r[i_u_in], r[i_u_ret]
        if not (a == b == c):
            mism += 1
            if mism <= 8:
                print("   不一致: 单=%s 商品=%s 订单单位=%r 入库单位=%r 退货单位=%r"
                      % (r[i_no], str(r[i_prod])[:24], a, b, c))
    print("   ⇒ 不一致行数 = %d / %d" % (mism, len(data)))
    print()

    print("订单数量 vs 采购入库数量 是否相同:")
    same = differ = 0
    for r in data:
        a, b = num(r[i_ordq]), num(r[i_inq])
        if a == b:
            same += 1
        else:
            differ += 1
    print("   相同 = %d ; 不同 = %d" % (same, differ))
    print()

    print("采购价 量级抽样（前 10 个非空）:")
    shown = 0
    for r in data:
        p = num(r[i_price])
        if p and shown < 10:
            print("   单=%s 商品=%-30s 订单数量=%s %s 采购价=%s"
                  % (r[i_no], str(r[i_prod])[:30], r[i_ordq], r[i_u_ord], p))
            shown += 1
    print()

    print("单号 → 供应商 是否一对一:")
    no2sup = OrderedDict()
    bad = 0
    for r in data:
        n, s = r[i_no], r[i_sup]
        if n in no2sup and no2sup[n] != s:
            bad += 1
        no2sup.setdefault(n, s)
    print("   单据数 = %d ; 一单多供应商 = %d" % (len(no2sup), bad))
    print("   供应商取值分布:", Counter(r[i_sup] for r in data).most_common())
    print()

    print("单号前缀分布:", Counter(str(r[i_no])[:4] for r in data).most_common())
    print("单据状态分布:", Counter(r[i_status] for r in data).most_common())
    print()
    print("单号 → 单据时间 是否一对一（同单同日期）:")
    no2d = OrderedDict()
    bad2 = 0
    for r in data:
        n, d = r[i_no], str(r[7])[:10]
        if n in no2d and no2d[n] != d:
            bad2 += 1
        no2d.setdefault(n, d)
    print("   一单多日期 = %d" % bad2)
    ds = sorted(no2d.values())
    print("   日期范围: %s .. %s" % (ds[0] if ds else "-", ds[-1] if ds else "-"))
    print("   单据时间 vs 单号内日期 抽样:")
    for n, d in list(no2d.items())[:6]:
        print("     %s 单据时间=%s  单号内=%s" % (n, d, str(n)[2:8]))


if __name__ == "__main__":
    main()
