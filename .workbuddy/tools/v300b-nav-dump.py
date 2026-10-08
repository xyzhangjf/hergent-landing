#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读：列出 SKILL.md 导航表每一行（含序号与「跳到」列），供机械改列时对齐。"""
import os

SK = os.path.expanduser("~/.workbuddy/skills/hergent-scoped-commit/SKILL.md")
lines = open(SK, "r", encoding="utf-8").read().split("\n")

# 导航段 = 第 9 行到下一个 `## ` 之前
start = next(i for i, l in enumerate(lines) if l.startswith("## 🧭"))
end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith("## "))

rows = []
for i in range(start, end):
    if lines[i].startswith("| "):
        rows.append((i + 1, lines[i]))

print("导航段：行 %d..%d，其中表格行 %d 条" % (start + 1, end, len(rows)))
print("")
n = 0
for ln_no, ln in rows:
    cells = ln.split("|")
    # cells[0]='' cells[1]=你要做什么 cells[2]=跳到 cells[3]=物理位置 cells[4]=''
    if len(cells) < 5 or set(cells[1].strip()) <= set("-: "):
        print("  [表头/分隔] 行%d" % ln_no)
        continue
    target = cells[2].strip()
    print("%2d  行%-5d 跳到=%-46s | 提示=%s" % (n, ln_no, target[:46], cells[3].strip()[:40]))
    n += 1
print("")
print("数据行数 = %d" % n)
