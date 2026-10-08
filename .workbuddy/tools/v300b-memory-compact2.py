#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MEMORY.md 压缩 · 第二轮（按唯一子串替换 + count==1 断言，免受行号漂移影响）。"""
import sys

P = "/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/memory/MEMORY.md"
bfr = open(P, "rb").read()
txt = bfr.decode("utf-8")

PAIRS = [
    # T1 幽灵 inode（全文在 backend-invariants.md）
    ("🔴 **幽灵 inode**：换库文件 + 连接缓存 ⇒ 句柄仍指已删 inode ⇒ 必**先删后重启**；"
     "🔴 **DB_PATH 有两份**（`erp_db.DB_PATH` ＋ `db/connection.py:11`）⇒ 影子库验收须**两处都 patch**（v289 真踩）",
     "🔴 **幽灵 inode**：换库 + 连接缓存 ⇒ 句柄仍指已删 inode ⇒ 必**先删后重启**；"
     "🔴 **DB_PATH 有两份**（`erp_db.DB_PATH`＋`db/connection.py:11`）⇒ 影子库验收须**两处都 patch**（v289）"),
    # T2 v292 重号的后缀名（已逐字登记在同日号表里 ⇒ 由该表承载）
    ("⚠️ `v292` **重号**（`-权限联动`/`-返利冲刺口径`）⇒ 引用必带后缀；"
     "**登记表 = `version-history.md` 尾「同日号表」**。",
     "⚠️ `v292` **重号** ⇒ 引用必带后缀；**登记表 = `version-history.md` 尾「同日号表」**（含后缀名）。"),
    # T3 凭据清单（全文在 deploy-ops / pitfalls）
    ("🔴 仓内含**生产凭据明文**（Bearer / 提审账号 / 手机号均**已入库**）⇒ 远端必须 private",
     "🔴 仓内含**生产凭据明文**（**均已入库**）⇒ 远端必须 private"),
    # T4 §8.4 的后果（全文在 hergent-parallel-session-safety）
    ("**§8.4 前提 = 线上==HEAD，否则回退别人功能**",
     "**§8.4 前提 = 线上==HEAD**"),
]

plan = []
for old, new in PAIRS:
    n = txt.count(old)
    assert n == 1, "命中 %d 次（要求 1）：%s" % (n, old[:50])
    plan.append((old, new))

for old, new in plan:
    txt = txt.replace(old, new, 1)
    print("%+5d B   %s" % (len(new.encode()) - len(old.encode()), new[:52]))

out = txt.encode("utf-8")
assert len(out) <= len(bfr)
open(P, "wb").write(out)
print("")
print("改前 %d B → 改后 %d B（净 %+d）；红线 14848 ⇒ 余量 %d B"
      % (len(bfr), len(out), len(out) - len(bfr), 14848 - len(out)))
