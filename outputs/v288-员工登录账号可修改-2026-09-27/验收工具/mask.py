#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""证据文件脱敏：把影子库验收输出里的个人 PII 打码后再归档。

为什么必须打码：`outputs/` 被 git 跟踪 ⇒ 个人 PII 不落盘是本项目的既有纪律
（见 `MEMORY.md` §四 主体/脱敏）。

保留什么、打掉什么：
  · 打掉：真实**姓名**、**手机号**（含「账号名恰好就是手机号」那种）
  · 保留：**登录账号名**（如 liushantao）—— 它是本轮功能的**操作对象**，
    证据必须能指向具体账号才有核对价值；且它是系统登录标识、非个人身份信息。
  · 保留：租户/公司名（如「张记乳品（演示）」）—— 组织名非个人 PII。
"""

import re

SRC = "/tmp/v288/shadow.out"
DST = "/tmp/v288/shadow.masked.txt"

RULES = [
    ("18671058882", "186****8882"),
    ("刘小顶", "刘**"),
    ("刘善涛", "刘**"),
    ("张俊峰", "张**"),
]

t = open(SRC, encoding="utf-8").read()
for a, b in RULES:
    t = t.replace(a, b)

# 兜底：任何 11 位「1 开头」的数字串都当作手机号打码（防漏网）
t = re.sub(r"(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)", r"\1****\3", t)

open(DST, "w", encoding="utf-8").write(t)

print("已写出 " + DST)
print("=" * 60)
print("脱敏自检（应全部 0 命中）：")
for a, _ in RULES:
    print("  %-14s 命中 %d" % (a, t.count(a)))
print("  11 位手机号形态   命中 %d" % len(re.findall(r"(?<!\d)1[3-9]\d{9}(?!\d)", t)))
