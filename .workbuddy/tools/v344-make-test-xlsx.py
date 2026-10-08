#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 v344 验收用的两份 xlsx（本地，只写 /tmp）。

T1 = 带前置标题行 + 尾部合计行（模拟舟谱库存导出）
T2 = 裸模板（表头就在第 1 行，无前置行、无合计行）—— 回归对照，必须与改造前逐字一致
"""
import openpyxl

HDR = ["商品名称", "规格", "单位", "数量", "成本价", "批次号", "到期日"]
DATA = [
    ["蒙牛纯牛奶", "250ml*12", "件", 120, 45.5, "P20260901", "2026-10-15"],
    ["蒙牛酸牛奶", "100g*24", "件", 80, 38.0, "P20260902", "2026-10-20"],
]
SUMROW = ["合计", "", "", 200, "", "", ""]

# ── T1：标题行 + 导出时间行 + 表头（第3行）+ 2 数据行 + 合计行 ──────────────
wb = openpyxl.Workbook()
ws = wb.active
ws.append(["库存查询表"])
ws.append(["导出时间：2026-09-30 08:00:00"])
ws.append(HDR)
for r in DATA:
    ws.append(r)
ws.append(SUMROW)
wb.save("/tmp/v344-t1-inventory-preamble.xlsx")

# ── T2：裸模板（表头第 1 行）──────────────────────────────────────────────
wb2 = openpyxl.Workbook()
ws2 = wb2.active
ws2.append(HDR)
for r in DATA:
    ws2.append(r)
wb2.save("/tmp/v344-t2-inventory-plain.xlsx")

print("T1 rows=7（前2行标题、第3行表头、2 数据行、第7行合计）")
print("T2 rows=3（第1行表头、2 数据行）")
print("已写出：/tmp/v344-t1-inventory-preamble.xlsx  /tmp/v344-t2-inventory-plain.xlsx")
