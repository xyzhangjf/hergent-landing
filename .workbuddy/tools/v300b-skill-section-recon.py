#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""侦察 hergent-scoped-commit/SKILL.md 的 `## ` 章节边界与字节量（只读，不改任何文件）。"""
import os, re, sys

SK = os.path.expanduser("~/.workbuddy/skills/hergent-scoped-commit/SKILL.md")
raw = open(SK, "rb").read()
text = raw.decode("utf-8")
lines = text.split("\n")   # 保留结构；末尾换行会多出一个空元素
total_bytes = len(raw)

# 找所有 `## ` 标题的字节偏移
starts = []   # (byte_offset_of_line_start, 行号(1-based))
boff = 0
for i, ln in enumerate(lines):
    if ln.startswith("## "):
        starts.append((boff, i + 1, ln))
    boff += len(ln.encode("utf-8")) + 1   # +1 = 换行

print("文件 = %s" % SK)
print("字节 = %d  行 = %d  章节(## )数 = %d" % (total_bytes, len(lines), len(starts)))
print("")
print("%-4s %-5s %-6s %-8s %s" % ("#", "起行", "终行", "字节", "标题"))
print("-" * 100)
head_bytes = starts[0][0]
print("(前置) 1..%d  %d 字节   [frontmatter + 标题 + 导航]" % (starts[0][1] - 1, head_bytes))
for n, (off, ln_no, title) in enumerate(starts):
    end_off = starts[n + 1][0] if n + 1 < len(starts) else total_bytes
    end_line = (starts[n + 1][1] - 1) if n + 1 < len(starts) else len(lines)
    sz = end_off - off
    print("%-4d %-5d %-6d %-8d %s" % (n, ln_no, end_line, sz, title[:88]))

# 汇总账
sum_sec = sum((starts[n + 1][0] if n + 1 < len(starts) else total_bytes) - starts[n][0]
              for n in range(len(starts)))
print("")
print("账：前置 %d + 各章节 %d = %d  （应等于 %d）  差 = %d"
      % (head_bytes, sum_sec, head_bytes + sum_sec, total_bytes,
         total_bytes - head_bytes - sum_sec))
