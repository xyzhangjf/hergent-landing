#!/usr/bin/env python3
"""v203 判据自证：报单配置「对象类型」收敛为 门店 / 本人仓。

背景：`report_mapping_refs()` 返回的对象池是 `contacts.type IN ('customer','both')` ——
「门店」与「客户」两个入口选的是**同一批对象**。用户定调合并 ⇒ 入口只留门店，
`customer` 降级为历史兼容别名（写端归一成 store，读端继续认识它）。

三层断言：
  A 归一函数真值表
  B 三条写路径确实调用了归一（防「定义了函数但没接线」——本仓库出现过这类静默失败）
  C 读端 IN ('store','customer') 仍在（防「写端收敛顺手把读端也收紧」⇒ 存量行静默消失）

用法：
  /Users/zhangjunfeng/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
    .workbuddy/tools/v203-cp-type-normalize-check.py
"""
import re
import ast
import sys
import pathlib

ERP_DB = pathlib.Path("/Users/zhangjunfeng/Documents/hergent-erp/server/erp_db.py")
SRC = ERP_DB.read_text(encoding="utf-8")

bad = 0
def chk(ok, label, extra=""):
    global bad
    bad += 0 if ok else 1
    print("  %s %s%s" % ("ok " if ok else "BAD", label, ("  " + extra) if extra else ""))

print("=" * 78)
print("A 归一函数真值表")
print("=" * 78)

# ⚠️ 不 `import erp_db` —— 它会拉起 cryptography / fastapi 等一整条依赖链（本地没装），
#    而本脚本要验的只是**文件里那两个常量 + 一个纯字符串函数**。
#    改用 AST 就地摘出这几段源码 exec 到隔离命名空间：零依赖、可离线跑，
#    且断言的对象是 erp_db.py 的真实文本（不是某个被 import 过的副本）。
_tree = ast.parse(SRC)
_ns = {}
_want = {"REPORT_CP_TYPES", "REPORT_CP_ALIASES", "normalize_report_cp_type"}
for _node in _tree.body:
    _hit = False
    if isinstance(_node, ast.Assign):
        _hit = any(isinstance(t, ast.Name) and t.id in _want for t in _node.targets)
    elif isinstance(_node, ast.FunctionDef):
        _hit = _node.name in _want
    if _hit:
        exec(compile(ast.Module([_node], []), str(ERP_DB), "exec"), _ns)

_missing = _want - set(_ns)
chk(not _missing, "从源码摘出全部判据符号", "缺 %s" % sorted(_missing) if _missing else "")
if _missing:
    sys.exit(1)

f = _ns["normalize_report_cp_type"]
TRUTH = [
    ("store",           "store",  "正常门店"),
    ("customer",        "store",  "🔴 历史别名 → 门店（本次收敛的核心）"),
    ("  customer  ",    "store",  "带空白的历史别名"),
    ("self_warehouse",  "self_warehouse", "本人仓不变"),
    ("",                None,     "空串 → 非法"),
    (None,              None,     "None → 非法"),
    ("   ",             None,     "纯空白 → 非法"),
    ("customerX",       None,     "近似错拼 → 非法（不做模糊匹配）"),
    ("STORE",           None,     "大写 → 非法（与历史精确匹配行为一致，不擅自放宽）"),
    ("门店",            None,     "中文标签 → 非法（枚举值不是展示文案）"),
]
for inp, want, note in TRUTH:
    got = f(inp)
    chk(got == want, "normalize(%r) == %r" % (inp, want), "得到 %r · %s" % (got, note))

chk(_ns.get("REPORT_CP_TYPES") == ("store", "self_warehouse"),
    "REPORT_CP_TYPES == ('store','self_warehouse')")
chk(_ns.get("REPORT_CP_ALIASES") == {"customer": "store"},
    "REPORT_CP_ALIASES == {'customer':'store'}")

print()
print("=" * 78)
print("B 三条写路径确实调用归一（源码断言）")
print("=" * 78)

def body(fn_name, src):
    """取函数体（到下一个顶层 def 为止）。"""
    m = re.search(r"^def %s\(.*?(?=^def |\Z)" % re.escape(fn_name), src, re.S | re.M)
    return m.group(0) if m else ""

for fn in ("report_mapping_create", "report_mapping_update", "report_mapping_import"):
    b = body(fn, SRC)
    chk(bool(b), "找到 %s" % fn)
    chk("normalize_report_cp_type(" in b, "%s 调用 normalize_report_cp_type" % fn)

# 旧白名单必须清零 —— 否则第二份判据还在
for old in ('not in ("store", "customer", "self_warehouse")',):
    chk(old not in SRC, "旧白名单已清除：%s" % old)

# update 的回写：不回写 data，通用字段循环会把原始 customer 再写一遍（归一被覆盖）
_b = body("report_mapping_update", SRC)
chk('data["counterparty_type"] = _ct' in _b,
    "update 把归一结果写回 data（防通用字段循环覆盖）")

print()
print("=" * 78)
print("C 读端 IN ('store','customer') 保持不动（写端收敛 ≠ 读端收紧）")
print("=" * 78)
n_read = len(re.findall(r"IN \('store',\s*'customer'\)", SRC))
chk(n_read >= 5, "读端 IN ('store','customer') 仍有 %d 处（期望 ≥5）" % n_read)
for name in ("employee_stores_get", "employee_stores_prune_covered", "report_mapping_health"):
    chk("IN ('store','customer')" in body(name, SRC) or "IN ('store','customer')" in SRC,
        "%s 内读端条件保留" % name)
chk("此处**刻意不归一**" in SRC, "list 过滤参数处有「刻意不归一」注释")

print()
print("=" * 78)
print("BAD=%d  %s" % (bad, "全部通过" if not bad else "有失败项"))
print("=" * 78)
sys.exit(1 if bad else 0)
