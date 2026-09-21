#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 术语统一 pass-A：把「厂价 / 进价」同句共存造成的废话折叠掉。

为什么需要这一步：用户拍板「厂价与进价是一个意思，统一叫进价」。
但代码里有 76 行**同时**出现两个词（`厂价 ≡ 进价`、`厂价与进价都没有`、`厂价 → 进价 → 标准售价`…）。
直接 全局 厂价→进价 会产出 `进价 ≡ 进价`、`进价与进价都没有` 这类废话。

本步只做**等价式折叠**（语义不变），不做结构性改动。
默认 dry-run；--apply 才落盘。
"""
import io
import os
import re
import sys

APPLY = "--apply" in sys.argv

ROOTS = [
    "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src",
    "/Users/zhangjunfeng/Documents/hergent-erp/server",
    "/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram",
]

# 有序规则：先折叠等价式，再处理并列否定/顺承
RULES = [
    # 「厂价 ≡ 进价」/「厂价 ＝ 进价」/「厂价 = 进价」 —— 等价式整体折叠掉厂价那一端
    (r"厂价\s*[≡＝=]+\s*进价\s*[≡＝=]+\s*厂家(?:跟经销商)?结算价", "进价 ＝ 厂家结算价"),
    (r"厂价\s*[≡＝=]+\s*进价\s*[≡＝=]", "进价 ≡"),
    (r"厂价\s*[≡＝=]+\s*进价", "进价"),
    # 「厂价与进价都没有」→「连进价都没有」
    (r"厂价与进价(都|均)没有", r"连进价都没有"),
    (r"厂价与进价(都|均)为空", r"连进价都为空"),
    # 「厂价或进价任一有值」→「进价有值」
    (r"厂价或进价任一有值", "进价有值"),
    # 「厂价 → 进价」两档并列 → 只留进价
    (r"厂价\s*→\s*进价\s*→", "进价 →"),
    # 「厂价优先，缺则取进价」/「厂价优先、缺则进价」
    (r"厂价优先[，,、]缺则(?:取)?进价", "取档案的进价（原厂价列优先，缺则取原进价列）"),
    # 「未单独录厂价但进价有值」→「原厂价列未单独录但进价有值」
    (r"未单独录厂价但进价有值", "原厂价列未单独录但进价有值"),
]

FILE_EXT = (".py", ".js", ".vue", ".ts", ".wxml")

hits = []
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
            out = src
            for pat, rep in RULES:
                out = re.sub(pat, rep, out)
            if out != src:
                hits.append((p, src, out))

print("将有改动的文件 = %d" % len(hits))
tot = 0
for p, src, out in hits:
    s_lines = src.split("\n")
    o_lines = out.split("\n")
    n = sum(1 for a, b in zip(s_lines, o_lines) if a != b)
    tot += n
    print("  %-72s %d 行" % (p.replace("/Users/zhangjunfeng/Documents/", ""), n))
print("合计改动行 = %d" % tot)

print("\n--- 前 12 个文件的逐行前后对照 ---")
shown = 0
for p, src, out in hits:
    if shown >= 12:
        break
    s_lines = src.split("\n")
    o_lines = out.split("\n")
    for i, (a, b) in enumerate(zip(s_lines, o_lines), 1):
        if a != b:
            print("  %s:%d" % (p.split("/")[-1], i))
            print("     - %s" % a.strip()[:175])
            print("     + %s" % b.strip()[:175])
    shown += 1

if APPLY:
    for p, src, out in hits:
        io.open(p, "w", encoding="utf-8").write(out)
    print("\n[APPLIED] 已落盘 %d 个文件" % len(hits))
else:
    print("\n[DRY-RUN] 未写入。加 --apply 落盘。")
