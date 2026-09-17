#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""「到货周期」列 —— 导入侧规则自检（真切片：用 AST 从源码取值，不复制规则）。

为什么必须真切片：本功能的核心承诺是「**页面显示与导入解析一致**」。
  · 页面显示 `+3天`（Forecast.vue 的 fmt）
  · 导入解析 `+3天`（import_router._re_rhythm）
两处一旦漂移，表现为「用户照模版填了 +3天，页面永远显示 —，且不报错」——
静默失败，只能靠断言挡住。

断言四组：
  A. 正则能认「+3天」等四种写法，且**不**认裸「+3」/「3天」/「-3天」（避免误吃别的语义）
  B. 模版列名「到货周期」能被识别的关键词表命中（模拟 `_detect_forecast_cross` 的
     子串包含 + dict 顺序优先，并验证它**不会**被其它字段抢先命中）
  C. 模版列存在、位置正确、**不是必填**
  D. 正则仍认历史写法「+3到货」（存量表格/老模版向后兼容）

用法: python3 forecast-arrival-rhythm-check.py [import_router.py 路径]
"""
import ast
import os
import re
import sys

DEFAULT_ROUTER = "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py"
PATH = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ROUTER

if not os.path.exists(PATH):
    print("文件不存在：%s" % PATH)
    sys.exit(2)
SRC = open(PATH, encoding="utf-8").read()
TREE = ast.parse(SRC)

PASS = FAIL = 0


def ok(cond, label, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok  %s%s" % (label, ("  [%s]" % extra) if extra else ""))
    else:
        FAIL += 1
        print("  BAD %s%s" % (label, ("  [%s]" % extra) if extra else ""))


# ---- 真切片：从 AST 取三样东西（都是 import_router.py 里的字面量/赋值） ----
def find_assign(name):
    for node in ast.walk(TREE):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == name:
                    return node.value
    return None


# ① _re_rhythm = re.compile(r"...")  （函数内局部变量，ast.walk 也能找到）
_rx_node = find_assign("_re_rhythm")
assert _rx_node is not None, "源码里找不到 _re_rhythm 赋值"
PATTERN = _rx_node.args[0].value
RE_RHYTHM = re.compile(PATTERN)

# ② COLUMN_PATTERNS["forecast_cross"] 各字段的关键词（dict 顺序即优先级）
CP = find_assign("COLUMN_PATTERNS")
assert CP is not None, "源码里找不到 COLUMN_PATTERNS 赋值"
cross_patterns = {}
for k, v in zip(CP.keys, CP.values):
    if getattr(k, "value", None) == "forecast_cross":
        for fk, fv in zip(v.keys, v.values):
            cross_patterns[fk.value] = [e.value for e in fv.elts]

# ③ _TEMPLATE_FIELDS["forecast_cross"] 的 (列名, 必填标记) 列表
TF = find_assign("_TEMPLATE_FIELDS")
assert TF is not None, "源码里找不到 _TEMPLATE_FIELDS 赋值"
tpl_cols = None
for k, v in zip(TF.keys, TF.values):
    if getattr(k, "value", None) == "forecast_cross":
        tpl_cols = [(e.elts[0].value, e.elts[1].value) for e in v.elts]
assert tpl_cols is not None, "模版定义里找不到 forecast_cross"

print("真切片自证 —— 源：%s" % PATH)
print("  正则 = %s" % PATTERN)
print("  rhythm 关键词 = %s" % cross_patterns.get("rhythm"))
print("  模版列 = %s" % [c[0] for c in tpl_cols])
print()

# ---- A. 正则：认四种写法 ----
print("A. 正则识别「+N天」（页面与模版教用户的写法）")
for raw, want in [("+3天", 3), ("+4天", 4), ("+3到货", 3), ("+3天到货", 3),
                  ("+ 3 天", 3), ("+12天", 12),
                  # 全角加号：中文输入法默认形态，实测必须认（否则整行静默算 0）
                  ("＋3天", 3), ("＋4到货", 4)]:
    m = RE_RHYTHM.search(raw)
    ok(bool(m) and int(m.group(1)) == want, "认 %-8s → %s" % (raw, want),
       "got=%s" % (m.group(1) if m else None))

print("\nA2. 反向：不该认的**必须不认**（防误吃别的语义）")
for raw in ["+3", "3天", "-3天", "随便", "", "＋3", "+", "3"]:
    ok(RE_RHYTHM.search(raw) is None, "不认 %-8s" % (raw or "(空)",
       ), "got=%s" % (RE_RHYTHM.search(raw).group(0) if RE_RHYTHM.search(raw) else None))

# ---- B. 列名能否被识别成 rhythm（模拟 _detect_forecast_cross） ----
print("\nB. 模版列名「到货周期」→ 识别为 rhythm（子串包含 + dict 顺序优先）")


def detect(headers):
    """复刻 _detect_forecast_cross 的归属循环：先命中者赢，列级唯一。"""
    assigned, ident = {}, {}
    for field, kws in cross_patterns.items():
        for idx, h in enumerate(headers):
            if idx in assigned:
                continue
            hh = str(h or "").strip().lower()
            if not hh:
                continue
            if any(str(kw).strip().lower() in hh for kw in kws):
                if field not in ident:
                    ident[field] = idx
                assigned[idx] = field
    return ident


# 用**真实模版表头**（含动态客户列）做整表归属，而不是只测单列 ——
# 单列测试会漏掉「被别的字段抢先命中」这类冲突。
headers = [c[0] for c in tpl_cols] + ["张老板", "永辉超市"]
ident = detect(headers)
rhythm_i = [i for i, c in enumerate(tpl_cols) if c[0] == "到货周期"]
ok(bool(rhythm_i), "模版里存在「到货周期」列")
if rhythm_i:
    ri = rhythm_i[0]
    ok(ident.get("rhythm") == ri, "「到货周期」归属 rhythm", "ident=%s" % ident)
    # 反向：不能同时被别的字段认领（列级唯一）
    others = [f for f, i in ident.items() if i == ri and f != "rhythm"]
    ok(not others, "未被其它字段重复认领", "others=%s" % others)
    # 客户列必须仍然识别为客户（不能被 rhythm 吞掉）
    ok(all(i not in ident for i in range(len(tpl_cols), len(headers))),
       "客户列未被误认成身份列")

# ---- C. 模版：列位置 + 非必填 ----
print("\nC. 模版列位置与必填标记")
if rhythm_i:
    ri = rhythm_i[0]
    ok(ri == 7, "位于第 %d 列（0-based=%d），紧接商品身份列之后、客户列之前" % (ri + 1, ri),
       "1-based=%d" % (ri + 1))
    rq = tpl_cols[ri][1]
    ok(rq is False, "**选填**（非必填）", "required=%r" % rq)

# ---- D. 历史写法向后兼容 ----
print("\nD. 向后兼容（存量模版/历史表格）")
ok(RE_RHYTHM.search("+3到货") is not None, "老写法「+3到货」仍可识别")
ok("订单排期" in cross_patterns.get("rhythm", []), "老列名「订单排期」仍在关键词表里")
ok("到货" in cross_patterns.get("rhythm", []), "兜底词「到货」仍在关键词表里")

print("\n结果：PASS %d / FAIL %d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
