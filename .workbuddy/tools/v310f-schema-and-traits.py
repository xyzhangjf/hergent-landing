# -*- coding: utf-8 -*-
"""v310f 落库可行性核查：
  ① 真实（含迁移后）列结构 vs 舟谱表能提供的列
  ② 采购明细的数据特征：单位种类 / 是否含小数数量 / 供应商取值 / 单号形态
"""
import os
import re
import sqlite3
import io
import warnings
import openpyxl

warnings.filterwarnings("ignore")

SRV = "/Users/zhangjunfeng/Documents/hergent-erp/server"
D = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"

print("=" * 78)
print("① 真实列结构（本地 erp.db，已含迁移）")
print("=" * 78)
c = sqlite3.connect("file:%s/erp.db?mode=ro" % SRV, uri=True)
for t in ("purchase_orders", "purchase_order_items", "income_orders",
          "expense_orders", "bank_statements", "bank_transactions"):
    try:
        cols = c.execute("PRAGMA table_info(%s)" % t).fetchall()
        if not cols:
            print("  %-22s (表不存在)" % t)
            continue
        desc = ", ".join("%s:%s%s" % (r[1], r[2],
                                     "" if not r[3] else "*NOTNULL") for r in cols)
        print("  %-22s %s" % (t, desc))
    except Exception as e:
        print("  %-22s ! %s" % (t, e))
c.close()

print()
print("=" * 78)
print("② 采购明细抽取数据特征")
print("=" * 78)
p = os.path.join(D, "20260801-20260831采购单明细.xlsx")
wb = openpyxl.load_workbook(p, data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
wb.close()
hdr = [("" if v is None else str(v).strip()) for v in rows[4]]
print("  表头行(第5行) %d 列:" % len(hdr))
for i, h in enumerate(hdr):
    print("    [%2d] %s" % (i, h))
idx = {h: i for i, h in enumerate(hdr) if h}


def col(name, r):
    i = idx.get(name)
    return r[i] if i is not None and i < len(r) else None


data = rows[5:]
data = [r for r in data if str(col("单据", r) or "").strip() not in ("", "合计")]
print()
print("  数据行数:", len(data))
no_re = re.compile(r"^([A-Za-z]+)(\d{6})(\d+)$")
kinds, dates, frac, units, sups, whs, sts = {}, {}, [], {}, {}, {}, {}
for r in data:
    no = str(col("单据", r) or "").strip()
    m = no_re.match(no)
    if m:
        kinds[m.group(1)] = kinds.get(m.group(1), 0) + 1
        dates[m.group(2)] = dates.get(m.group(2), 0) + 1
    else:
        kinds["异常:" + no[:14]] = kinds.get("异常:" + no[:14], 0) + 1
    for cn, box in (("订单数量", None), ("采购入库数量", None), ("采购退货数量", None)):
        v = col(cn, r)
        if isinstance(v, float) and abs(v - round(v)) > 1e-9:
            frac.append((no, cn, v))
    for cn, box in (("单位名称", units), ("供应商", sups), ("仓库", whs), ("订单状态", sts)):
        v = str(col(cn, r) or "").strip()
        if v:
            box[v] = box.get(v, 0) + 1
print("  单号前缀分布:", kinds)
print("  单号中段(YYMMDD)分布:", dict(sorted(dates.items())))
print("  ⚠️ 非整数数量行数:", len(frac), frac[:5])
print("  单位名称:", units)
print("  供应商:", sups)
print("  仓库:", whs)
print("  订单状态:", sts)
