# -*- coding: utf-8 -*-
"""v310h 切块连续性验证：同单据号的行是否连续？
现有 do_import 靠 `no != cur_no` 切块 ⇒ 若同单号的行被拆成多段，一张单会被拆成几张（或重复建单）。
判据：
  · blocks      = 顺序扫描里「单据号变化」的次数
  · uniq_orders = 去重后单据号个数
  · 两者相等 ⇒ 每张单恰好一段（连续，可安全切块）
  · 后者相等但出现重复段落 ⇒ 不连续，必须改成「先分组再落库」
"""
import os
import warnings
import openpyxl
from collections import Counter

warnings.filterwarnings("ignore")
D = "/Users/zhangjunfeng/Documents/流水对账/舟谱导出的单据"


def check(name, sheet_expect=5):
    wb = openpyxl.load_workbook(os.path.join(D, name), data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    sheet = ws.title
    wb.close()
    hdr = [("" if v is None else str(v).strip()) for v in rows[4]]
    idx = {h: i for i, h in enumerate(hdr) if h}
    ni = idx.get("单据号", idx.get("单据"))
    seq = []
    for r in rows[5:]:
        v = str(r[ni] or "").strip() if ni is not None and ni < len(r) else ""
        if v and v != "合计":
            seq.append(v)
    blocks, prev = [], None
    for v in seq:
        if v != prev:
            blocks.append(v)
            prev = v
    cnt = Counter(blocks)
    dup = {k: v for k, v in cnt.items() if v > 1}
    print("=" * 78)
    print("文件:", name, " sheet:", sheet)
    print("  表头行=第5行 ✓" if hdr[0] in ("单据", "单据时间") else "  ⚠️ 表头行不是第5行: %s" % hdr[:3])
    print("  明细行数: %d" % len(seq))
    print("  单据号出现顺序块数(blocks) = %d" % len(blocks))
    print("  去重单据号个数(uniq)       = %d" % len(set(blocks)))
    print("  结论: %s" % ("✅ 每单恰好一段（连续，可安全按块切）"
                       if len(blocks) == len(set(blocks))
                       else "🔴 同单号被拆成多段 ⇒ 必须先分组后落库"))
    if dup:
        print("  🔴 重复出现的单据号（前 8 个）:",
              dict(list(dup.items())[:8]))
    return len(blocks), len(set(blocks))


check("2026年8月收入明细表.xlsx")
check("2026年8月费用明细表.xlsx")

# 采购表也验一下（它的列名是「单据」）
wb = openpyxl.load_workbook(os.path.join(D, "20260801-20260831采购单明细.xlsx"), data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
wb.close()
hdr = [("" if v is None else str(v).strip()) for v in rows[4]]
idx = {h: i for i, h in enumerate(hdr) if h}
ni = idx["单据"]
seq = [str(r[ni]).strip() for r in rows[5:]
       if r[ni] is not None and str(r[ni]).strip() not in ("", "合计")]
blocks, prev = [], None
for v in seq:
    if v != prev:
        blocks.append(v)
        prev = v
print("=" * 78)
print("文件: 20260801-20260831采购单明细.xlsx  sheet:", ws.title)
print("  明细行数: %d" % len(seq))
print("  blocks = %d   uniq = %d" % (len(blocks), len(set(blocks))))
print("  结论: %s" % ("✅ 每单恰好一段" if len(blocks) == len(set(blocks))
                    else "🔴 不连续 ⇒ 必须先分组"))
