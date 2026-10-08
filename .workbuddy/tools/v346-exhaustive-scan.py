#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v346 穷举扫描（一次性排查用）：所有真实列名 × 所有类目 ⇒ 列出全部触发点。

判据：「列名」取自 COLUMN_PATTERNS 的全部关键词 + 常见复合列名。
人工逐条判读「这是真危险还是误报」。
"""
import ast
import os

SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py"
WANT_CONSTS = ["COLUMN_PATTERNS", "FIELD_LABELS", "_PAY_NAME_HINTS", "_PAY_AMOUNT_HINTS",
               "_UNAMBIGUOUS_LABELS", "_FIELD_FAMILY", "_DANGER_FAMILIES"]
WANT_FUNCS = ["_dedup_payment_mapping", "_guess_mapping", "_build_unambiguous_labels",
              "_family_of", "_label_of"]
WANT_AFTER = ["_annotate_column_risks"]

src = open(SRC, encoding="utf-8").read()
tree = ast.parse(src)
picked = {}
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in WANT_FUNCS + WANT_AFTER:
        picked[node.name] = node
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in WANT_CONSTS:
                picked[t.id] = node
ns = {"re": __import__("re")}
for n in WANT_FUNCS:
    exec(compile(ast.Module(body=[picked[n]], type_ignores=[]), SRC, "exec"), ns)
for n in WANT_CONSTS:
    if isinstance(picked[n], ast.Assign):
        exec(compile(ast.Module(body=[picked[n]], type_ignores=[]), SRC, "exec"), ns)
for n in WANT_AFTER:
    exec(compile(ast.Module(body=[picked[n]], type_ignores=[]), SRC, "exec"), ns)

CP = ns["COLUMN_PATTERNS"]
guess = ns["_guess_mapping"]
annotate = ns["_annotate_column_risks"]

# 候选列名 = 所有关键词 + 复合（前缀+关键词）
names = set()
for cat, pat in CP.items():
    for f, kws in pat.items():
        for k in kws:
            names.add(str(k))
prefixes = ["商品", "产品", "客户", "厂家", "门店", "供应商", "应收", "应付", "回款", "库存"]
for p in prefixes:
    for n in list(names):
        if len(n) <= 4:
            names.add(p + n)

print("候选列名 %d 个 × 类目 %d 个 = %d 组" % (len(names), len(CP), len(names) * len(CP)))
trig = []
for cat in CP:
    for h in sorted(names):
        headers = [h]
        m = guess(headers, cat)
        ss = [{"index": 0, "header": h, "suggested_field": m.get(0, ""),
               "confidence": "high" if 0 in m else "low"}]
        if not ss[0]["suggested_field"]:
            continue
        annotate(ss, headers, cat)
        if ss[0]["risk"]:
            trig.append((cat, h, ss[0]["suggested_field"], ss[0]["risk"], ss[0]["risk_reason"]))

print("\n触发 %d 处：\n" % len(trig))
for cat, h, f, r, reason in trig:
    print("[%s] %-12s → %-16s (%s)" % (cat, h, f, r))
    print("        %s" % reason)
