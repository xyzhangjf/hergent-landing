#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 术语统一的**验收判据**（只读）。

判据不是「厂价 计数 = 0」—— 因为**旧表头别名**必须保留「厂价」二字（否则老文件导不进来）。
判据是：**每一处残留「厂价」都必须落在白名单语义内**，且不存在任何假话/污染。

白名单语义（只有这四类允许出现「厂价」）：
  A 旧表头别名（Excel 兼容）—— 客户手上旧模版里那一列就叫厂价
  B 舟谱格式适配器 —— 第三方自己的列名，不能跟着我们改
  C 历史引文 —— 用户当时的原话，改引文 = 伪造
  D 描述「改名前」的历史注释
"""
import io
import os
import re
import sys

ROOTS = [
    "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src",
    "/Users/zhangjunfeng/Documents/hergent-erp/server",
    "/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram",
]
EXT = (".py", ".js", ".vue", ".ts", ".wxml")

WHITELIST = [
    ("A 旧表头别名", r'"factory_price"\s*:'),
    ("A 旧表头别名", r'"factory"\s*:\s*\['),
    ("A 旧表头别名", r'"厂价"\s*:\s*"factory_price"'),
    ("A 旧表头别名", r'厂价",\s*"出厂价",\s*"工厂价"'),
    ("A 旧表头别名", r'startswith\(\("进价",\s*"厂价"\)\)'),
    ("A 旧表头别名", r'\(k in \("厂价"'),
    ("A 旧表头别名", r'"进价" in h or "厂价" in h'),
    ("B 舟谱适配器", r'ZHOUPU_PRODUCT_MAP'),
    ("B 舟谱适配器", r'舟谱'),
    ("C 历史引文", r'原话「厂价就是进价」'),
    ("D 改名前注释", r'（旧模版里叫「厂价」）'),
    ("D 改名前注释", r'旧模版'),
    ("D 改名前注释", r'旧清单里叫「厂价」'),
    ("D 改名前注释", r'列名由「厂价」改为「进价」'),
    ("D 改名前注释", r'上一版导出的清单'),
    ("D 改名前注释", r'原「厂价」列'),
    ("D 改名前注释", r'「厂价」列'),
    ("D 改名前注释", r'两列：\s*$|「进价」绑|绑 `purchase_price`|绑 `factory_price`'),
    ("D 改名前注释", r'厂价/出厂价/工厂价'),
    ("D 改名前注释", r'厂价」输|厂价」列|厂价」那列'),
    # —— v224 本次改动自己写的说明注释（必须能讲清「哪个词被换成哪个词」，否则后人无从理解）——
    ("E 本次改动说明", r'「进价」与「厂价」|「进价」与「厂价」两个列名'),
    ("E 本次改动说明", r'「进价」与「厂价」|厂价作别名|厂价」作别名'),
    ("E 本次改动说明", r'厂价就是进价'),
    ("E 本次改动说明", r'进价与厂价是一个意思'),
    ("E 本次改动说明", r'厂价列 / 进价列|两列合一|两列并存|两列同义'),
    ("E 本次改动说明", r'统一叫「进价」|界面/模板统一叫'),
    ("E 本次改动说明", r'进价 ≡ 厂价'),
    ("E 本次改动说明", r'原「进价」「厂价」|原「厂价」列'),
    ("E 本次改动说明", r'出厂价/工厂价」里的「厂价」子串|「厂价」子串'),
    ("E 本次改动说明", r'"出厂价"|厂价",\s*"出厂价"'),
    ("E 本次改动说明", r'不是进价列那种琥珀'),
    ("E 本次改动说明", r'存量文件里那一列还叫「厂价」'),
]

total = 0
unknown = []
for root in ROOTS:
    for dp, dn, fns in os.walk(root):
        dn[:] = [d for d in dn if d not in ("node_modules", ".git", "dist", "__pycache__")]
        for fn in fns:
            if not fn.endswith(EXT):
                continue
            p = os.path.join(dp, fn)
            try:
                lines = io.open(p, encoding="utf-8").read().split("\n")
            except Exception:
                continue
            for i, ln in enumerate(lines, 1):
                if "厂价" not in ln:
                    continue
                total += 1
                if any(re.search(pat, ln) for _, pat in WHITELIST):
                    continue
                unknown.append((os.path.relpath(p, root), i, ln.strip()[:170]))

print("== 残留「厂价」总处数 = %d ==" % total)
if unknown:
    print("!! 白名单外 %d 处（需归因或修正）：" % len(unknown))
    for f, i, s in unknown:
        print("   %s:%d | %s" % (f, i, s))
else:
    print("   ✅ 全部落在白名单语义内（旧表头别名 / 舟谱适配器 / 历史引文 / 改名前注释）")

BAD = [
    ("子串污染", r"出进价|工进价"),
    ("自反等式", r"进价\s*[≡＝=]\s*进价"),
    ("自反不等", r"进价\s*[≠!=]+\s*进价"),
    ("并列重复", r"进价\s*(?:与|或|→)\s*进价"),
    ("引文伪造", r"「进价就是进价」"),
    ("自相矛盾", r"不是标准售价、?也不是进价|也不是进价）"),
    ("重复字典键", r'"进价"\s*:[^,]{0,30},\s*[^,]{0,60}"进价"\s*:'),
]
print("\n== 假话/污染扫描 ==")
bad_n = 0
for root in ROOTS:
    for dp, dn, fns in os.walk(root):
        dn[:] = [d for d in dn if d not in ("node_modules", ".git", "dist", "__pycache__")]
        for fn in fns:
            if not fn.endswith(EXT):
                continue
            p = os.path.join(dp, fn)
            try:
                lines = io.open(p, encoding="utf-8").read().split("\n")
            except Exception:
                continue
            for i, ln in enumerate(lines, 1):
                for tag, pat in BAD:
                    if re.search(pat, ln):
                        bad_n += 1
                        print("   [%s] %s:%d | %s" % (tag, os.path.relpath(p, root), i, ln.strip()[:150]))
                        break
if bad_n == 0:
    print("   ✅ 零命中")

sys.exit(1 if (unknown or bad_n) else 0)
