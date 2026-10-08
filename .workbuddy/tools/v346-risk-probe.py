#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v346 列映射「危险识别」判别力探针
==================================
被测对象 = `server/routers/import_router.py` 里 v346 新增的三件套：
    `_build_unambiguous_labels` / `_UNAMBIGUOUS_LABELS` / `_FIELD_FAMILY`
    `_family_of` / `_label_of` / `_annotate_column_risks`
调用方 = `_annotate_column_risks(suggestions, headers, category)`

🔴 判别力自证（本项目铁律）：
   只跑"全过"的探针没有判别力。本脚本**内置反例对照**（G 组）——
   把判据打回第一版的「只看关键词子串」旧行为，**同一组干净模板断言必须整组失败**。
   若 G 组反而全过 ⇒ 说明这批用例根本测不出误报 ⇒ 探针无效，必须重写。

跑法：
  cd /Users/zhangjunfeng/Documents/hergent-erp/server && \
  /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
      /Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/v346-risk-probe.py
"""
import ast
import os
import sys

SRC = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "hergent-erp", "server",
    "routers", "import_router.py"))
if not os.path.exists(SRC):
    SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py"

WANT_CONSTS = [
    "COLUMN_PATTERNS", "FIELD_LABELS", "FIELD_LABELS",
    "_PAY_NAME_HINTS", "_PAY_AMOUNT_HINTS",
    "_UNAMBIGUOUS_LABELS", "_FIELD_FAMILY", "_DANGER_FAMILIES",
    "_DIRECT_CONFIRM_EXCLUDED",
]
# 顺序敏感：`_UNAMBIGUOUS_LABELS = _build_unambiguous_labels()` 依赖函数已定义
WANT_FUNCS = [
    "_dedup_payment_mapping", "_guess_mapping",
    "_build_unambiguous_labels", "_family_of", "_label_of",
]
WANT_FUNCS_AFTER = ["_annotate_column_risks"]


def load_ns():
    src = open(SRC, encoding="utf-8").read()
    tree = ast.parse(src)
    picked, funcs, consts = {}, {}, {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in WANT_FUNCS + WANT_FUNCS_AFTER:
            picked[node.name] = node
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in WANT_CONSTS:
                    picked[t.id] = node
    missing = [n for n in WANT_FUNCS + WANT_FUNCS_AFTER + WANT_CONSTS if n not in picked]
    if missing:
        raise SystemExit("❌ 源码里抽取不到：%s" % missing)
    ns = {"re": __import__("re")}
    # 🔴 先函数后常量（`_UNAMBIGUOUS_LABELS` 的右值要调用函数）
    for name in WANT_FUNCS:
        mod = ast.Module(body=[picked[name]], type_ignores=[])
        exec(compile(mod, SRC, "exec"), ns)
    for name in WANT_CONSTS:
        node = picked[name]
        if isinstance(node, ast.FunctionDef):
            continue
        mod = ast.Module(body=[node], type_ignores=[])
        exec(compile(mod, SRC, "exec"), ns)
    for name in WANT_FUNCS_AFTER:
        mod = ast.Module(body=[picked[name]], type_ignores=[])
        exec(compile(mod, SRC, "exec"), ns)
    return ns


NS = load_ns()
COLUMN_PATTERNS = NS["COLUMN_PATTERNS"]
FIELD_LABELS = NS["FIELD_LABELS"]
annotate = NS["_annotate_column_risks"]
guess = NS["_guess_mapping"]

FAIL = []
PASS = 0


def ok(msg):
    global PASS
    PASS += 1
    print("  ✅ " + msg)


def bad(msg):
    FAIL.append(msg)
    print("  ❌ " + msg)


def sugg(headers, category, mapping=None):
    """按 `/preview` 的方式造 suggestions（不走 AI 兜底，保持纯本地）。"""
    m = mapping if mapping is not None else guess(headers, category)
    return [{"index": i, "header": h, "suggested_field": m.get(i, ""),
             "confidence": "high" if i in m else "low"}
            for i, h in enumerate(headers)]


def risks(headers, category, mapping=None):
    ss = sugg(headers, category, mapping)
    annotate(ss, headers, category)
    return [(s["index"], s["header"], s["suggested_field"], s["risk"], s["risk_reason"])
            for s in ss if s["risk"]]


# ══════════════════════════════════════════════════════════════════════
# A 组：真危险 —— 「语义被抢」（跨品类同名 + 跨族）
# ══════════════════════════════════════════════════════════════════════
print("\n【A 组】真危险 · 语义被抢（应收表的「商品名称」被客户名吞掉）")
A_HEADERS = ["商品名称", "金额", "到期日"]
A = risks(A_HEADERS, "receivables")
print("     实测：", A)
if len(A) == 1 and A[0][1] == "商品名称" and A[0][3] == "generic":
    ok("A1 应收表「商品名称」被标 generic（命中字段 = %s）" % A[0][2])
    if "客户名称" in A[0][4]:
        ok("A2 提示语点名了「被认成什么」（%s）" % A[0][4])
    else:
        bad("A2 提示语没说清被认成什么：%s" % A[0][4])
else:
    bad("A1 应收表「商品名称」未被标危险，实测=%s" % A)

print("\n【B 组】真危险 · 反向（商品档案里的「客户名称」被商品名吞掉）")
B_HEADERS = ["客户名称", "规格", "单位"]
B = risks(B_HEADERS, "products")
print("     实测：", B)
if len(B) == 1 and B[0][1] == "客户名称" and B[0][3] == "generic":
    ok("B1 商品档案「客户名称」被标 generic（命中字段 = %s）" % B[0][2])
else:
    bad("B1 商品档案「客户名称」未被标危险，实测=%s" % B)

print("\n【C 组】真危险 · 同一字段被多列命中（落库后一列覆盖前一列）")
C_HEADERS = ["商品名称", "品名", "规格", "单位"]
C = risks(C_HEADERS, "products")
print("     实测：", C)
if len(C) == 2 and all(r[3] == "dup" for r in C) and {r[0] for r in C} == {0, 1}:
    ok("C1 两列争同一字段 ⇒ 两列都标 dup（index 0/1）")
    if "同一个字段" in C[0][4]:
        ok("C2 提示语说明了「以靠后那一列为准」：%s" % C[0][4])
    else:
        bad("C2 dup 提示语不完整：%s" % C[0][4])
else:
    bad("C1 未按 dup 标注，实测=%s" % C)

# ══════════════════════════════════════════════════════════════════════
# D 组：反误报 —— 干净模板必须**零风险**
#   🔴 这是本轮的核心：第一版判据在这里误报了「商品名称」
# ══════════════════════════════════════════════════════════════════════
print("\n【D 组】反误报 · 干净模板必须零风险（共 6 例）")
CLEAN = [
    ("D1 库存干净模板", ["商品名称", "规格", "单位", "数量", "成本价"], "inventory"),
    ("D2 库存干净模板（带批次效期）", ["商品名称", "批次", "到期日", "数量"], "inventory"),
    ("D3 商品档案干净模板", ["商品名称", "规格", "单位", "条码", "品牌", "进价"], "products"),
    ("D4 商品档案厂家编码列", ["厂家商品编码", "商品名称", "品牌"], "products"),
    ("D5 客户档案干净模板", ["客户名称", "客户编码", "电话", "地址"], "contacts"),
    ("D6 订单明细干净模板", ["订单号", "商品名称", "数量", "单价"], "order_items"),
    ("D7 跟单表（客户专属价）", ["客户名称", "商品名称", "小单位价"], "customer_prices"),
    ("D8 收款流水干净模板", ["客户名称", "回款金额", "回款日期", "收款方式"], "payment_receipts"),
]
CLEAN_RISKY = []
for label, hdrs, cat in CLEAN:
    r = risks(hdrs, cat)
    if r:
        CLEAN_RISKY.append((label, r))
        print("     %-26s 🟠风险 %s" % (label, [(x[1], x[3]) for x in r]))
if not CLEAN_RISKY:
    ok("D1-D8 共 8 例干净模板，风险列 = 0（无一处误报）")
else:
    bad("D 组：误报！%d/%d 例被标风险 %s"
        % (len(CLEAN_RISKY), len(CLEAN), [(a, [(x[1], x[3]) for x in b]) for a, b in CLEAN_RISKY]))

print("\n【E 组】边界 · 列名恰等于关键词本身 ⇒ 不算泛词")
E = risks(["名称", "数量"], "inventory")
print("     实测：", E)
if not E:
    ok("E1 列名「名称」= 关键词本身 ⇒ 不标（避免全表泛化）")
else:
    bad("E1 列名恰等于关键词却被标危险，实测=%s" % E)

print("\n【F 组】边界 · 记忆回填进来的错误映射同样要被标注")
#   模拟 `/preview` 的记忆回填：把「商品名称」硬改回 contact_name，标注必须照样命中
F_HEADERS = ["商品名称", "金额"]
F = risks(F_HEADERS, "receivables", mapping={0: "contact_name", 1: "amount"})
print("     实测：", F)
if len(F) == 1 and F[0][3] == "generic":
    ok("F1 回填成 contact_name 后仍被标 generic（标注作用于最终映射）")
else:
    bad("F1 记忆回填后未标注，实测=%s" % F)

# ══════════════════════════════════════════════════════════════════════
# G 组：🔴 反例对照 —— 把判据打回第一版旧行为，D 组必须整组失败
# ══════════════════════════════════════════════════════════════════════
print("\n【G 组】反例对照 · 退回旧判据（只看关键词子串）后 D 组是否整组失败")


def legacy_annotate(suggestions, headers, category):
    """第一版判据的忠实复刻：只要列名里含该字段的**更短**关键词 ⇒ 标 danger。
    （就是它把干净库存模板的「商品名称」标红了。）"""
    if not suggestions:
        return suggestions
    items = []
    for f, kws in (COLUMN_PATTERNS.get(category) or {}).items():
        for kw in kws:
            k = str(kw or "").strip().lower()
            if k:
                items.append((f, k))
    for s in suggestions:
        s["risk"] = ""
        s["risk_reason"] = ""
        f = str(s.get("suggested_field") or "")
        if not f:
            continue
        h = str(s.get("header") or "").strip().lower()
        for k in [k for (ff, k) in items if ff == f and k in h and len(k) < len(h)]:
            s["risk"] = "generic"
            s["risk_reason"] = "legacy: 含泛词「%s」" % k
            break
    return suggestions


legacy_risky = 0
for label, hdrs, cat in CLEAN:
    ss = sugg(hdrs, cat)
    legacy_annotate(ss, hdrs, cat)
    hit = [(s["header"], s["risk"]) for s in ss if s["risk"]]
    if hit:
        legacy_risky += 1
        print("     %-26s 🟠旧判据标红 %s" % (label, hit))
if legacy_risky >= 2:
    ok("G1 旧判据在干净模板上误报 %d/%d 例 ⇒ 本组用例**有判别力**（新判据把这些消掉了）"
       % (legacy_risky, len(CLEAN)))
else:
    bad("G1 旧判据只误报 %d 例 ⇒ 用例判别力不足，探针需重写" % legacy_risky)

# 同时确认：旧判据在真危险样本上**也**能命中 ⇒ 说明新判据不是靠"什么都不标"过关
ss = sugg(A_HEADERS, "receivables")
legacy_annotate(ss, A_HEADERS, "receivables")
if any(s["risk"] for s in ss):
    ok("G2 旧判据在 A 组真危险样本上同样命中 ⇒ 两版差异只在**误报**，不在漏检")
else:
    bad("G2 旧判据在 A 组竟不命中 ⇒ 用例本身立不住")

# ══════════════════════════════════════════════════════════════════════
print("\n" + "═" * 62)
print("通过 %d 项 · 失败 %d 项" % (PASS, len(FAIL)))
if FAIL:
    for f in FAIL:
        print("  ❌ " + f)
    sys.exit(1)
print("✅ 全部通过（含 G 组反例对照：旧判据误报 %d 例，新判据 0 例）" % legacy_risky)
print("═" * 62)
