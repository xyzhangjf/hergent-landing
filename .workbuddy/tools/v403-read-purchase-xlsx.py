# -*- coding: utf-8 -*-
"""读舟谱导出的近30天采购订单.xlsx（非 read_only + XML 兜底）"""
import openpyxl
p = "/Users/zhangjunfeng/Documents/舟谱导入模版/舟谱导出的近30天采购订单.xlsx"
wb = openpyxl.load_workbook(p, data_only=True)   # 非 read_only
for sn in wb.sheetnames:
    ws = wb[sn]
    print(f"===== sheet={sn} 计算维度 rows={ws.max_row} cols={ws.max_column} 声明维度={ws.calculate_dimension()} =====")
    n = 0
    for row in ws.iter_rows(values_only=True):
        vals = [("" if c is None else str(c)) for c in row]
        if not any(v.strip() for v in vals):
            continue
        n += 1
        if n <= 6 or n % 20 == 0:
            print(f"[{n}] " + " | ".join(vals))
    print(f"===== 非空行总数 = {n} =====")
