# -*- coding: utf-8 -*-
"""v310g 全量 dump 收入明细（仅 16 行）与费用明细（抽 40 行）+ 类别聚合"""
import os
import warnings
import openpyxl

warnings.filterwarnings("ignore")
D = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"


def load(name):
    wb = openpyxl.load_workbook(os.path.join(D, name), data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    hdr = [("" if v is None else str(v).strip()) for v in rows[4]]
    data = [r for r in rows[5:] if any(v is not None and str(v).strip() for v in r)]
    return hdr, data


def show(name, limit=None):
    hdr, data = load(name)
    idx = {h: i for i, h in enumerate(hdr) if h}
    print("=" * 78)
    print(name, " 表头:", hdr)
    print("数据行:", len(data))
    print("=" * 78)
    keys = [k for k in ("单据号", "单据类型", "往来单位", "结算单位", "收入类别", "费用类别",
                        "单据状态", "单据金额(元)", "单据金额", "费用分摊状态", "费用分摊类型",
                        "品牌", "员工", "部门", "单据时间", "整单备注", "明细备注") if k in idx]
    print(" | ".join(keys))
    print("-" * 78)
    want = data if limit is None else data[:limit]
    for r in want:
        vals = []
        for k in keys:
            i = idx[k]
            v = r[i] if i < len(r) else None
            s = "" if v is None else str(v).strip()
            vals.append(s[:18])
        print(" | ".join(vals))
    print()
    # 聚合
    for k in ("单据类型", "往来单位", "收入类别", "费用类别", "单据状态",
              "费用分摊状态", "费用分摊类型", "品牌"):
        if k not in idx:
            continue
        box = {}
        amt = {}
        for r in data:
            v = str(r[idx[k]] or "").strip() or "(空)"
            box[v] = box.get(v, 0) + 1
            try:
                amt[v] = amt.get(v, 0) + float(r[idx.get("单据金额(元)", idx.get("单据金额"))] or 0)
            except Exception:
                pass
        top = sorted(box.items(), key=lambda x: -x[1])[:12]
        print("  %s: %s" % (k, ", ".join("%s×%d(¥%.2f)" % (a, b, amt.get(a, 0)) for a, b in top)))
    print()


show("2026年8月收入明细表.xlsx")
show("2026年8月费用明细表.xlsx", limit=40)
