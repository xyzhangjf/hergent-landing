#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v344 表头行自动定位 + 汇总行剔除 —— 只读判别力探针（2026-09-30）。

设计纪律（本项目铁律「探针必须先自证判别力」）：
  · **正反两侧都跑**：既测「该找到表头的找到了」，也测「不该动的没动 / 不该选的没选中」。
  · **期望数写死在代码里**：不靠"看起来对"，靠 N/M 断言。
  · 🔴 **抽取源文件里的真实函数**（`ast` 解析 + exec），不是把算法照抄一遍 ——
       照抄只能证明"我抄得对"，证明不了"源文件里的代码对"。
  · 本探针**只读**：不写文件、不连网、不碰生产。

用法： python3 v344-header-detect-probe.py [源文件路径]
"""

import ast
import re  # 源文件里的 _CELL_ALL_WS_RE 用 re.compile(...) 赋值，exec 时需要它
import sys
import time

SRC = sys.argv[1] if len(sys.argv) > 1 else \
    "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py"

WANT_CONSTS = {
    "COLUMN_PATTERNS", "ZHOUPU_PRODUCT_MAP", "ZHOUPU_CONTACT_MAP",
    "_PAY_NAME_HINTS", "_PAY_AMOUNT_HINTS", "_CROSS_IDENTITY_FIELDS",
    "_HEADER_SCAN_ROWS", "_HEADER_MIN_HITS", "_HEADER_MAX_CELL_LEN",
    "_SUMMARY_ROW_WORDS", "_CELL_STRIP_CHARS", "_CELL_ALL_WS_RE",
}
WANT_FUNCS = {
    "_guess_mapping", "_dedup_payment_mapping", "_zhoupu_mapping",
    "_clean_cell_str", "_summary_key", "_norm_cells", "_is_summary_row",
    "_looks_like_column_label", "_row_header_score", "_detect_header_row",
}


def load_real_namespace(path):
    """从源文件里抽出真实常量与真实函数，exec 进一个命名空间（按源码顺序，保证依赖序）。"""
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    ns = {"re": re}     # 源文件在模块级用了 re.compile(...)，需预置同名符号
    got_f, got_c = set(), set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name in WANT_FUNCS:
                exec(compile(ast.Module(body=[node], type_ignores=[]), path, "exec"), ns)
                got_f.add(node.name)
        elif isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if names and names[0] in WANT_CONSTS:
                exec(compile(ast.Module(body=[node], type_ignores=[]), path, "exec"), ns)
                got_c.add(names[0])
    return ns, got_f, got_c


NS, GOT_F, GOT_C = load_real_namespace(SRC)
MISS_F = sorted(WANT_FUNCS - GOT_F)
MISS_C = sorted(WANT_CONSTS - GOT_C)

if MISS_F or MISS_C:
    print("[FATAL] 源文件里没找到这些定义，探针无法自证：")
    print("        函数缺失:", MISS_F)
    print("        常量缺失:", MISS_C)
    sys.exit(2)

detect = NS["_detect_header_row"]
is_sum = NS["_is_summary_row"]
score = NS["_row_header_score"]

# ── 用例电池 ────────────────────────────────────────────────────────────────
# 每例 = (编号, 说明, rows, category, 期望index, 期望detected, 是否关键例)
CASES = []


def case(no, desc, rows, cat, exp_idx, exp_det, key=True):
    CASES.append((no, desc, rows, cat, exp_idx, exp_det, key))


H_INV = ["商品名称", "规格", "单位", "数量", "成本价", "批次号", "到期日"]
H_PROD = ["商品名称", "规格", "单位", "商品条码", "品牌", "进价", "售价"]
H_CONTACT = ["客户名称", "老板姓名", "老板电话", "业态", "片区", "负责业务员", "客户编码"]
H_EMP = ["姓名", "工号", "岗位", "底薪", "社保基数", "银行账号"]
H_PAY = ["客户名称", "收款单号", "收款方式", "收款日期", "收款金额", "备注"]
H_RECV = ["客户名称", "应收金额", "已收金额", "未收金额", "单据日期"]

D_INV = [["蒙牛纯牛奶", "250ml*12", "件", "120", "45.5", "P20260901", "2026-10-15"],
         ["蒙牛酸牛奶", "100g*24", "件", "80", "38.0", "P20260902", "2026-10-20"]]
D_PROD = [["蒙牛纯牛奶", "250ml*12", "件", "6901234567890", "蒙牛", "45.5", "50"],
          ["蒙牛酸牛奶", "100g*24", "件", "6901234567891", "蒙牛", "38.0", "42"]]
D_CONTACT = [["永辉超市", "张老板", "13800138000", "20店", "武昌", "刘善涛", "C001"],
             ["美廉便利店", "李老板", "13900139000", "便利店", "汉口", "唐成", "C002"]]
D_EMP = [["张三", "E001", "司机", "5000", "3200", "6222001"],
         ["李四", "E002", "业务员", "4500", "3200", "6222002"]]
D_PAY = [["永辉超市", "SK001", "微信", "2026-09-29", "12000.00", ""],
         ["美廉便利店", "SK002", "银行转账", "2026-09-29", "8000.00", "已核对"]]
D_RECV = [["永辉超市", "50000", "30000", "20000", "2026-09-01"],
          ["美廉便利店", "30000", "10000", "20000", "2026-09-05"]]

# ── A 组：回归底线 —— 表头就在第 1 行，必须逐字保持改造前的行为（= 0）──────
case("A1", "商品模板（表头第1行）", [H_PROD] + D_PROD, "products", 0, True)
case("A2", "客户档案（表头第1行）", [H_CONTACT] + D_CONTACT, "contacts", 0, True)
case("A3", "库存模板（表头第1行）", [H_INV] + D_INV, "inventory", 0, True)
case("A4", "员工档案（表头第1行）", [H_EMP] + D_EMP, "employees", 0, True)
case("A5", "收款流水（表头第1行）", [H_PAY] + D_PAY, "payment_receipts", 0, True)
case("A6", "应收台账（表头第1行）", [H_RECV] + D_RECV, "receivables", 0, True)
case("A7", "预报交叉表（表头第1行）", [["商品名称", "规格", "单位", "进价", "刘善涛", "唐成"]] +
     [["蒙牛纯牛奶", "250ml*12", "件", "45.5", "10", "8"]], "forecast_cross", 0, True)

# ── B 组：真实导出件（带前置标题/说明行）—— 必须指向真正的表头行 ─────────────
case("B1", "舟谱库存导出：标题行 + 导出时间行 + 表头（第3行）",
     [["库存查询表"], ["导出时间：2026-09-30 08:00:00"], H_INV] + D_INV,
     "inventory", 2, True)
case("B2", "公司名 + 报表名 + 表头（第3行）",
     [["武汉小赫商贸有限公司"], ["库存报表", ""], H_INV] + D_INV,
     "inventory", 2, True)
case("B3", "标题 + 空行 + 公司名 + 表头（第4行）",
     [["商品资料导出"], [""], ["武汉小赫商贸有限公司", "2026-09-30"], H_PROD] + D_PROD,
     "products", 3, True)
case("B4", "标题行 + 两行说明 + 表头（第4行）",
     [["客户档案导出"], ["门店数：758"], ["导出人：admin"], H_CONTACT] + D_CONTACT,
     "contacts", 3, True)
case("B5", "两行说明 + 表头（第3行）：应收",
     [["应收对账单"], ["截止日期：2026-09-30"], H_RECV] + D_RECV,
     "receivables", 2, True)
case("B6", "单行标题 + 表头（第2行）：员工业绩",
     [["员工工资表 2026年9月"], H_EMP] + D_EMP, "employees", 1, True)
case("B7", "标题 + 表头（第2行）：收款流水",
     [["收款流水明细"], H_PAY] + D_PAY, "payment_receipts", 1, True)

# ── C 组：反向 —— 不得误判 ─────────────────────────────────────────────────
# C1：表头在第 12 行（超出 10 行扫描窗）⇒ 必须**退回第 1 行**并标 detected=False，
#     绝不能随手挑一行数据当表头。
_rows_c1 = [[str(i) for i in range(7)] for _ in range(11)] + [H_INV] + D_INV
case("C1", "表头在第12行（超出扫描窗）⇒ 退回第1行且 detected=False",
     _rows_c1, "inventory", 0, False)

# C2：表头在扫描窗内 → detected 必须为 True（证明 C1 的 False 是"窗口"造成的，不是永远 False）
_rows_c2 = [[str(i) for i in range(7)] for _ in range(4)] + [H_INV] + D_INV
case("C2", "表头在第5行（窗内）⇒ detected=True（C1 的对照）",
     _rows_c2, "inventory", 4, True)

# C3：数据行里含疑似关键字的取值（应收/已收），不得把数据行选成表头
case("C3", "数据行含「应收/已收」取值 ⇒ 仍选第1行",
     [H_RECV] + [["应收", "已收", "未收", "100", "2026-09-01"],
                 ["应付", "已付", "未付", "200", "2026-09-02"]],
     "receivables", 0, True)

# C4：表头列名全是陌生别名（畅捷通风格）⇒ 只要能认出 ≥2 个字段就应正常定位，不报错
case("C4", "畅捷通风格别名表头（第2行）",
     [["存货档案导出"], ["存货名称", "主计量单位", "结存数量", "存货编码"]],
     "inventory", 1, True)

# C5：整表只有一行（没有数据行）⇒ 不得崩。第 1 行**就是**表头 ⇒ detected=True 正确
#     （`detected` 的语义是"找到了一行像表头的"，不是"把它挪走了"）。
case("C5", "只有表头没有数据行 ⇒ 下标0 且 detected=True，不崩", [H_INV], "inventory", 0, True)

# C6：空行在前
case("C6", "前两行全空 + 表头第3行",
     [[], [None, None], H_INV] + D_INV, "inventory", 2, True)

# ── D 组：汇总行判定 ───────────────────────────────────────────────────────
SUM_CASES = [
    ("D1", ["合计", "", 12345], True, "标准合计行"),
    ("D2", ["合\u3000计", "12345"], True, "全角空格「合　计」"),
    ("D3", ["总计", "999"], True, "总计"),
    ("D4", ["小计", "10"], True, "小计"),
    ("D5", ["合计退回", "3"], False, "含「合计」但非整格相等 ⇒ 不算汇总行"),
    ("D6", ["小计金额", "5"], False, "含「小计」但非整格相等 ⇒ 不算汇总行"),
    ("D7", ["蒙牛纯牛奶", "250ml*12", "12"], False, "正常数据行"),
    ("D8", ["Total", "100"], True, "英文 Total"),
    ("D9", [None, None, ""], False, "全空行"),
    ("D10", ["客户名称", "应收金额"], False, "🔴 表头行本身绝不能被当汇总行"),
    ("D11", ["合计", "蒙牛纯牛奶", "12"], True, "首格合计（真实形态）"),
    ("D12", ["5", "合计"], True, "合计出现在非首格"),
    ("D13", ["合\t计", "5"], True, "制表符分隔的「合\\t计」"),
    ("D14", ["  合计  ", "5"], True, "两端有空格"),
    ("D15", ["合 计退回", "5"], False, "去空白后=「合计退回」⇒ **不**算（含≠等于）"),
    ("D16", ["合计（含税）", "5"], False, "带后缀 ⇒ 不算汇总行"),
]

# ── E 组：确定性与跨端点一致性（硬约束）────────────────────────────────────
CONSISTENCY = [
    ("E1", "同输入多次调用结果必须完全一致"),
    ("E2", "preview 只读前16行 vs execute 读全表 ⇒ 表头下标必须相同"),
]

# ── 执行 ────────────────────────────────────────────────────────────────────
fails = []
lines = []

lines.append("=" * 78)
lines.append("A/B/C 组：表头行定位（%d 例）" % len(CASES))
lines.append("=" * 78)
lines.append("%-4s %-46s %-16s %s" % ("编号", "说明", "实测(index/det)", "期望"))
lines.append("-" * 78)
for no, desc, rows, cat, exp_idx, exp_det, key in CASES:
    try:
        r = detect(rows, cat)
        got = (r["index"], bool(r["detected"]))
    except Exception as e:
        got = ("EXC:%s" % type(e).__name__, False)
    ok = (got == (exp_idx, exp_det))
    if not ok:
        fails.append("表头定位 %s (%s): 实测 %s 期望 %s" % (no, desc, got, (exp_idx, exp_det)))
    lines.append("%-4s %-46s %-16s %s  %s" % (
        no, desc[:44], "%s / %s" % got, "%s / %s" % (exp_idx, exp_det), "OK" if ok else "**FAIL**"))

lines.append("")
lines.append("=" * 78)
lines.append("D 组：汇总行判定（%d 例）" % len(SUM_CASES))
lines.append("=" * 78)
for no, row, exp, desc in SUM_CASES:
    try:
        got = is_sum(row)
    except Exception as e:
        got = "EXC:%s" % type(e).__name__
    ok = (got == exp)
    if not ok:
        fails.append("汇总行 %s (%s): 实测 %s 期望 %s" % (no, desc, got, exp))
    lines.append("%-4s %-44s 实测=%-6s 期望=%-6s %s" % (
        no, desc[:42], got, exp, "OK" if ok else "**FAIL**"))

lines.append("")
lines.append("=" * 78)
lines.append("E 组：确定性与跨端点一致性")
lines.append("=" * 78)
for no, desc in CONSISTENCY:
    if no == "E1":
        rows, cat = [["库存查询表"], H_INV] + D_INV, "inventory"
        seq = [detect(rows, cat)["index"] for _ in range(5)]
        ok = len(set(seq)) == 1
        detail = "5 次调用结果 = %s" % seq
    else:
        rows, cat = [["库存查询表"], ["导出时间：2026-09-30"], H_INV] + D_INV, "inventory"
        prev = detect(rows[:16], cat)["index"]          # 模拟 /preview 的 16 行窗口
        full = detect(rows, cat)["index"]               # 模拟 /execute 读全表
        ok = (prev == full == 2)
        detail = "preview(16行)=%s  execute(全表)=%s" % (prev, full)
    if not ok:
        fails.append("%s (%s): %s" % (no, desc, detail))
    lines.append("%-4s %-30s %-50s %s" % (no, desc[:28], detail, "OK" if ok else "**FAIL**"))

# ── F 组：性能（30 列 × 10 行，真实导出件的上限规模）────────────────────────
_wide = [["C%02d" % i for i in range(30)] for _ in range(9)]
_wide.append(["商品名称", "规格", "单位", "商品条码", "品牌", "进价", "售价"] +
             ["列%d" % i for i in range(23)])
_t0 = time.time()
for _ in range(5):
    detect(_wide, "products")
_ms = (time.time() - _t0) / 5 * 1000
lines.append("")
lines.append("=" * 78)
lines.append("F 组：性能 —— 30 列 × 10 行，单次耗时 %.1f 毫秒" % _ms)
lines.append("=" * 78)
if _ms > 300:
    fails.append("性能: 单次 %.1f 毫秒 > 300 毫秒上限" % _ms)

# ── G 组：反例对照 —— 探针必须**真的能失败** ────────────────────────────────
# 只跑"全过"的探针是没有判别力的（可能所有断言都是空的）。这里把定位函数**打回改造前的
# 行为**（恒取第 1 行 = `headers = rows[0]`），要求：
#   · A 组（表头本来就在第 1 行）必须**照旧全过** —— 证明"改造没有改变旧行为"
#   · B 组（真实导出件）必须**整组失败** —— 证明这些断言真的在测东西
_OLD_B_COUNT = sum(1 for c in CASES if c[0].startswith("B"))
_OLD_EXPECT_FAIL = sum(1 for c in CASES if (c[4], c[5]) != (0, True))
_OLD_EXPECT_PASS = len(CASES) - _OLD_EXPECT_FAIL


def _old_behavior(rows, category=""):
    """改造前的行为：恒把第 1 行当表头。"""
    return {"index": 0, "detected": True, "hits": 0, "non_empty": 0,
            "scanned": 0, "note": ""}


_old_fail, _old_pass, _old_b_fail = 0, 0, 0
for no, desc, rows, cat, exp_idx, exp_det, key in CASES:
    r = _old_behavior(rows, cat)
    hit = ((r["index"], r["detected"]) == (exp_idx, exp_det))
    if hit:
        _old_pass += 1
    else:
        _old_fail += 1
        if no.startswith("B"):
            _old_b_fail += 1

lines.append("")
lines.append("=" * 78)
lines.append("G 组：反例对照（把定位函数打回旧行为「恒取第1行」）")
lines.append("=" * 78)
lines.append("旧行为下：通过 %d 例 / 失败 %d 例（期望 %d 通过 / %d 失败）"
             % (_old_pass, _old_fail, _OLD_EXPECT_PASS, _OLD_EXPECT_FAIL))
lines.append("其中 B 组（真实导出件）失败 %d / %d 例（期望 %d）"
             % (_old_b_fail, _OLD_B_COUNT, _OLD_B_COUNT))
_neg_ok = (_old_pass == _OLD_EXPECT_PASS and _old_fail == _OLD_EXPECT_FAIL
           and _old_b_fail == _OLD_B_COUNT)
lines.append("⇒ 判别力自证：%s" % ("**成立**（探针确实能区分新旧行为）" if _neg_ok else "**不成立**"))
if not _neg_ok:
    fails.append("反例对照: 期望旧行为 %d 通过/%d 失败、B 组失败 %d，实测 %d 通过/%d 失败、B 组 %d"
                 % (_OLD_EXPECT_PASS, _OLD_EXPECT_FAIL, _OLD_B_COUNT,
                    _old_pass, _old_fail, _old_b_fail))
total_neg, passed_neg = 1, (1 if _neg_ok else 0)

# ── 汇总 ────────────────────────────────────────────────────────────────────
total = len(CASES) + len(SUM_CASES) + len(CONSISTENCY) + total_neg
passed = total - len(fails)
lines.append("")
lines.append("=" * 78)
lines.append("总判定：%d / %d 通过" % (passed, total))
lines.append("源文件：%s" % SRC)
lines.append("抽取到的真实函数 %d 个 / 真实常量 %d 个" % (len(GOT_F), len(GOT_C)))
if fails:
    lines.append("")
    lines.append("失败明细：")
    for f in fails:
        lines.append("  · " + f)
    lines.append("")
    lines.append("⇒ **未通过**：上表有 FAIL，不得据此交付。")
else:
    lines.append("")
    lines.append("⇒ **全部通过**（正反两侧都跑：A 组回归底线 / B 组真实导出件 / "
                 "C 组不得误判 / D 组汇总行 / E 组确定性 / F 组性能 / G 组反例对照）。")
lines.append("=" * 78)

print("\n".join(lines))
sys.exit(1 if fails else 0)
