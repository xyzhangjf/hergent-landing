---
name: excel-data
description: Excel 数据处理 — 透视表、公式、图表、数据清洗、批量处理
tags: [data, excel, analysis, automation]
---

# Excel 数据处理指南

## 核心原则

- 能用 Python 批量处理的优先用 Python (pandas/openpyxl)
- 简单操作给 Excel 公式方案
- 处理后说明文件位置和结果摘要
- 保留原始数据，输出到新文件/新sheet

## 常见任务

### 数据清洗
1. 去重: 按关键列删除重复行
2. 缺失值: 删除/填充均值/前值填充
3. 格式统一: 日期/数字/文本格式标准化
4. 异常值: IQR或Z-score检测

### 数据汇总
- VLOOKUP/XLOOKUP: 跨表匹配
- SUMIFS/COUNTIFS: 条件求和/计数
- 数据透视表: 多维度汇总
- GROUPBY (Python): df.groupby().agg()

### 图表制作
- 趋势: 折线图
- 对比: 柱状图/条形图
- 占比: 饼图/环形图
- 关系: 散点图
- 用 openpyxl 设置图表样式: 标题/数据标签/颜色

### 常用 Excel 公式速查
- `=VLOOKUP(A2, Sheet2!A:B, 2, FALSE)` → 跨表查找
- `=SUMIFS(C:C, A:A, "条件1", B:B, "条件2")` → 多条件求和
- `=IFERROR(A1/B1, 0)` → 安全除法
- `=TEXT(A1, "yyyy-mm-dd")` → 日期格式化
