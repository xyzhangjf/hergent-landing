#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 术语统一 pass-B：把剩余「厂价」全部改成「进价」。

承接 pass-A（等价式折叠已完成）。本步是**全量盲替换**，因此：
  · 替换后「厂价」只应作为**别名**存在（Excel 旧表头兼容、舟谱列名兼容），
    这些点由 pass-C 用 Edit 显式补回，并有 allowlist 收口（见 verify 脚本）。
默认 dry-run；--apply 才落盘。
"""
import io
import os
import sys

APPLY = "--apply" in sys.argv
ROOTS = [
    "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src",
    "/Users/zhangjunfeng/Documents/hergent-erp/server",
    "/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram",
]
FILE_EXT = (".py", ".js", ".vue", ".ts", ".wxml")

tot_lines = 0
tot_files = 0
report = []
for root in ROOTS:
    for dp, dn, fns in os.walk(root):
        dn[:] = [d for d in dn if d not in ("node_modules", ".git", "dist", "__pycache__")]
        for fn in fns:
            if not fn.endswith(FILE_EXT):
                continue
            p = os.path.join(dp, fn)
            try:
                src = io.open(p, encoding="utf-8").read()
            except Exception:
                continue
            if "厂价" not in src:
                continue
            n = src.count("厂价")
            out = src.replace("厂价", "进价")
            report.append((p, n))
            tot_lines += n
            tot_files += 1
            if APPLY:
                io.open(p, "w", encoding="utf-8").write(out)

report.sort(key=lambda x: -x[1])
for p, n in report:
    print("  %-78s %d 处" % (p.replace("/Users/zhangjunfeng/Documents/", ""), n))
print("\n文件数 = %d   替换处数 = %d" % (tot_files, tot_lines))
print("[APPLIED]" if APPLY else "[DRY-RUN] 未写入")
