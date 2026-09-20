#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v213-A1 离线自测 + 反证 —— 后端「数量录入规则」唯一判据 `forecast_rules.py`。

跑法：
    /Users/zhangjunfeng/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
        .workbuddy/tools/v213-rules-selftest.py

判据（不碰任何数据库、不发任何请求）：
  A. 归一化表：**每一行都给期望值**，正向（该收的收）与反向（该拒的拒）同时断言。
     只断言「合法的不被拒」= 恒真的绿；反向缺一不可（本项目吃过「漏订判据没有行前提」的亏）。
  B. 规则边界：qty_max 的**临界值**必须逐点验（`>` 还是 `>=` 只能靠这一点区分）。
  C. 两个写入口适配器：行号 / 列名 / 去重 / 作用域。
  D. 文案模板与前端 Forecast.vue 的**逐字一致**（防我抄错；#546 落地后这条继续守）。
  E. 反证：把源码按 12 处**变异**逐个改坏 → 上面任意一条必须变红。
     变异全部通过 = 判据根本没在被测（红框不红比不红更危险）。
  F. 读路径 fail-safe：无数据库时必须回落 RULES_DEFAULTS 而不是抛异常。
"""
import json
import os
import re
import sys
import types

SRC = "/Users/zhangjunfeng/Documents/hergent-erp/server/db/queries/forecast_rules.py"
VUE = "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue"

FAILS = []
CHECKS = [0]


def ok(cond, label):
    CHECKS[0] += 1
    if not cond:
        FAILS.append(label)
    return bool(cond)


def load(src_text, name="forecast_rules_under_test"):
    """把源码 exec 成一个模块；`db.connection.get_db` 换成会抛错的桩。"""
    if "db" not in sys.modules:
        pkg = types.ModuleType("db")
        pkg.__path__ = []
        cmod = types.ModuleType("db.connection")

        def get_db():
            raise RuntimeError("offline selftest: no database")

        cmod.get_db = get_db
        pkg.connection = cmod
        sys.modules["db"] = pkg
        sys.modules["db.connection"] = cmod
    mod = types.ModuleType(name)
    mod.__file__ = SRC
    exec(compile(src_text, SRC, "exec"), mod.__dict__)
    return mod


# ─────────────────────────── 判据表 ───────────────────────────
# (输入, 期望 qty, 期望 kind)  —— qty 为 None 表示非法（kind 必填）
NORM_TABLE = [
    # —— 空 = 未填 = 0（稀疏矩阵语义；前端 raw==='' → 合法）——
    (None, 0, None), ("", 0, None), ("   ", 0, None), (0, 0, None), ("0", 0, None),
    (0.0, 0, None), ("-0.0", 0, None),
    # —— 正整数各种合法写法 ——
    (12, 12, None), ("12", 12, None), (" 12 ", 12, None), ("+12", 12, None),
    ("0012", 12, None), ("12.0", 12, None), (12.0, 12, None),
    (1200, 1200, None), ("1,200", 1200, None), ("1,2,0,0", 1200, None),
    # —— 记数法：Excel 里 `1e3` 就是 1000，前端 Number("1e3") 也认 ⇒ 必须收 ——
    ("1e3", 1000, None), ("1E3", 1000, None), ("1e+3", 1000, None), ("1.5e2", 150, None),
    ("0.15e1", 1.5, "int"), ("1e-3", None, "int"), ("1e3箱", None, "num"),
    ("1e", None, "num"), ("e3", None, "num"), ("1e3.5", None, "num"),
    # —— 全角（NFKC 归一；Python 的 int() 本来就吃全角，这里让规则可枚举）——
    ("１２", 12, None), ("１，２００", 1200, None), ("１２．０", 12, None),
    # —— 非数字：**前缀数字串必须拒**（这就是 parseFloat 的老 bug）——
    ("12箱", None, "num"), ("12 箱", None, "num"), ("12件", None, "num"),
    ("箱12", None, "num"), ("abc", None, "num"), ("--1", None, "num"),
    ("1.2.3", None, "num"), ("1,2.3.4", None, "num"),
    ("nan", None, "num"), ("inf", None, "num"), ("Infinity", None, "num"),
    ("1_000", None, "num"),          # Python float() 吃下划线分隔符 ⇒ 必须由正则挡掉
    ("0x10", None, "num"),           # JS Number() 吃十六进制 ⇒ 后端不受影响（前端更严，安全方向）
    (True, None, "num"), (False, None, "num"),   # bool 是 int 子类，不挡会变 1/0
    ([], None, "num"), ({}, None, "num"),
    (float("inf"), None, "num"), (float("nan"), None, "num"),
    # —— 负数 ——
    (-3, None, "neg"), ("-3", None, "neg"), ("- 3", None, "num"),
    # —— 非整数（含「差一点点」的浮点尾巴）——
    ("1.5", None, "int"), (1.5, None, "int"), ("3.0000001", None, "int"),
    ("0.5", None, "int"),
]

RULES = {"qty_max": 99999, "name_required": True}

# qty_max 临界：(输入, qty_max, 期望 kind)
BOUND_TABLE = [
    (99999, 99999, None), (100000, 99999, "over"), (99999.0, 99999, None),
    (360, 360, None), (361, 360, "over"),
    (1, 1, None), (2, 1, "over"),
    # 巨大值走 float 路径也必须判准（10**20 超出 float 精确整数范围，但 int(float(...)) 仍精确）
    (999999999, 999999999, None),
]


def run_judgement(mod, fails_prefix=""):
    """跑 A/B/C/D/F 全部判据；返回 (通过数, 失败标签列表)。"""
    global FAILS, CHECKS
    keep_fails, keep_checks = FAILS, CHECKS[0]
    FAILS, CHECKS[0] = [], 0

    for raw, want_qty, want_kind in NORM_TABLE:
        got_qty, got_kind = mod.normalize_qty(raw)
        lab = "%snormalize_qty(%r)" % (fails_prefix, raw)
        ok(got_kind == want_kind, lab + " kind=%r 期望 %r" % (got_kind, want_kind))
        if want_kind is None:
            ok(got_qty == want_qty, lab + " qty=%r 期望 %r" % (got_qty, want_qty))

    for raw, qmax, want_kind in BOUND_TABLE:
        qty, v = mod.qty_violation(raw, {"qty_max": qmax, "name_required": True})
        got = v["kind"] if v else None
        ok(got == want_kind, "%sqty_violation(%r, max=%d) kind=%r 期望 %r"
           % (fails_prefix, raw, qmax, got, want_kind))

    # 文案里的上限必须跟着规则走（不是写死 99999）
    qty, v = mod.qty_violation(10 ** 7, {"qty_max": 360, "name_required": True})
    ok(v and v["msg"] == "数量过大（上限 360）", "%s超限文案要带当前上限: %r" % (fails_prefix, v and v["msg"]))

    # C1 小程序适配器：行号=数组序，列名固定
    vs = mod.violations_for_items([
        {"product_name": "甲", "quantity": "12箱"},
        {"product_name": "", "quantity": 5},
        {"product_name": "乙", "quantity": "-1"},
        {"product_name": "丙", "quantity": 0},
        {"product_name": "", "quantity": 0},      # 全 0 且无名 ⇒ **不该报**名字必填
    ], RULES)
    got = [(x["row"], x["col"], x["kind"]) for x in vs]
    ok(got == [(1, "报单数量", "num"), (2, "报单数量", "name"), (3, "报单数量", "neg")],
       "%s小程序适配器 (row,col,kind)=%r" % (fails_prefix, got))

    # C2 Web 交叉表适配器
    vs = mod.violations_for_matrix(
        [{"product_name": "甲", "qty_by_unit": {"A店": "3", "B店": "1.5", "C店": ""}},
         {"product_name": "乙", "qty_by_unit": {"A店": 200000, "B店": 0, "C店": 0}}],
        ["A店", "B店", "C店"], RULES)
    got = [(x["row"], x["col"], x["kind"]) for x in vs]
    ok(got == [(1, "B店", "int"), (2, "A店", "over")], "%s交叉表适配器 =%r" % (fails_prefix, got))

    # C3 名字必填**按行只报一次**（一行在 3 个客户列都有数量）
    vs = mod.violations_for_matrix(
        [{"product_name": "", "qty_by_unit": {"A店": 1, "B店": 2, "C店": 3}}],
        ["A店", "B店", "C店"], RULES)
    ok(len(vs) == 1 and vs[0]["kind"] == "name" and vs[0]["col"] == "A店",
       "%s名字必填去重/落点 =%r" % (fails_prefix, vs))

    # C4 作用域：customers 之外的键不判（保存逻辑根本不会读它们）
    vs = mod.violations_for_matrix(
        [{"product_name": "甲", "qty_by_unit": {"没这一列": "12箱"}}], ["A店"], RULES)
    ok(vs == [], "%scustomers 之外的列不判 =%r" % (fails_prefix, vs))

    # C5 关掉名字必填 ⇒ 不报该错，但数量错照报
    vs = mod.violations_for_matrix(
        [{"product_name": "", "qty_by_unit": {"A店": "x"}}], ["A店"],
        {"qty_max": 99999, "name_required": False})
    ok(len(vs) == 1 and vs[0]["kind"] == "num", "%sname_required=False =%r" % (fails_prefix, vs))

    # C6 顺序 = 行→列（前端清单行优先，两端同序才能「点一跳一格」）
    vs = mod.violations_for_matrix(
        [{"product_name": "甲", "qty_by_unit": {"A店": "x", "B店": "0.5"}},
         {"product_name": "", "qty_by_unit": {"A店": 1}}],
        ["A店", "B店"], RULES)
    ok([(x["row"], x["col"]) for x in vs] == [(1, "A店"), (1, "B店"), (2, "A店")],
       "%s顺序 =%r" % (fails_prefix, [(x["row"], x["col"]) for x in vs]))

    # C7 rules=None 走 get_rules()（离线 = 默认规则），且不抛
    try:
        vs = mod.collect_violations([{"row": 1, "col": "X", "name": "甲", "qty": 100000}])
        ok(len(vs) == 1 and vs[0]["kind"] == "over", "%srules=None 回落默认 (99999) =%r" % (fails_prefix, vs))
    except Exception as e:
        ok(False, "%srules=None 不应抛异常: %s" % (fails_prefix, e))

    # F 读路径 fail-safe：无库时 get_rules() 回落默认而不是抛
    try:
        r = mod.get_rules()
        ok(r == mod.RULES_DEFAULTS, "%s无库时 get_rules 回落默认 =%r" % (fails_prefix, r))
    except Exception as e:
        ok(False, "%s无库时 get_rules 不应抛: %s" % (fails_prefix, e))

    # D 文案模板必须与前端 Forecast.vue 逐字一致（防抄错；#546 后继续守）
    try:
        vue = open(VUE, encoding="utf-8").read()
    except Exception as e:
        ok(False, "%s读不到 Forecast.vue: %s" % (fails_prefix, e))
        vue = ""
    # D（#546 后**加强**，不是放松）：五条文案全部逐字对齐。
    #   形态变了：`MSG_OVER` 从 `${QTY_MAX}` 内插模板 → 同占位符 `{max}` 的兜底文案。
    #   为什么这么变：前端已不再各写一份模板，改为 `SPEC_MSG_FALLBACK`（**取不到
    #   /validation-spec 时的兜底**）+ 运行时由 spec 下发的 `kinds[].msg` 覆盖。
    #   ⇒ 兜底值必须与后端逐字相同，否则「后端读不到配置」这一种故障下，同一个错误
    #     会在两端显示成两句话 —— 那正是本模块要消灭的「同一规则多处实现」。
    #   加守一条：`${QTY_MAX}` 必须已从源码里清除（防有人又抄回一份本地模板）。
    for label, lit in (("MSG_NUM", mod.MSG_NUM), ("MSG_NEG", mod.MSG_NEG),
                       ("MSG_INT", mod.MSG_INT), ("MSG_NAME", mod.MSG_NAME),
                       ("MSG_OVER", mod.MSG_OVER)):
        ok(lit in vue, "%s前端 Forecast.vue 里找不到逐字一致的 %s：%r" % (fails_prefix, label, lit))
    ok(mod.MSG_OVER == "数量过大（上限 {max}）" and "{max}" in mod.MSG_OVER,
       "%s超限模板占位符 = 后端唯一口径 {max}（与前端 SPEC_MSG_FALLBACK.over 同形）" % fails_prefix)
    ok("${QTY_MAX}" not in vue,
       "%s前端不再各写一份超限模板（${QTY_MAX} 已清除 ⇒ 文案单源）" % fails_prefix)
    # 「单源」不能只是声明：前端必须**真的调用**并**真的采纳**下发的模板。
    ok("validationSpec(" in vue, "%s前端确实调用了 /validation-spec" % fails_prefix)
    ok("sp.kinds" in vue, "%s前端采纳了 spec 下发的文案模板（kinds[].msg）" % fails_prefix)

    # ── E 输入法容错表：与前端 `HALF_MAP` **逐字同源**（v214 A）──
    #   为什么值得单独立一条：这张表的**唯一价值**就是「用户按什么键都能被认出来」，
    #   而它天然会被写成两份（后端 Python 字典 + 前端 JS 对象字面量）。两侧一旦漂移，
    #   症状是「某个全角字符在某一端被拒」，而**两端各自的自测都还是绿的** ——
    #   用户端表现为「同样的输入，网页能过、小程序报错」。
    def _js_unesc(s):
        import re as _re
        return _re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)
    try:
        _blk = re.search(r"const HALF_MAP\s*=\s*\{(.*?)\n\}", vue, re.S)
        js_map = {}
        if _blk:
            for _k, _v in re.findall(r"'((?:\\.|[^'\\])*)'\s*:\s*'((?:\\.|[^'\\])*)'", _blk.group(1)):
                js_map[_js_unesc(_k)] = _js_unesc(_v)
        ok(bool(_blk), "%s前端 HALF_MAP 可解析（得 %d 条）" % (fails_prefix, len(js_map)))
        py_map = dict(mod._HALF_MAP)
        _only_py = sorted(set(py_map) - set(js_map))
        _only_js = sorted(set(js_map) - set(py_map))
        ok(not _only_py and not _only_js,
           "%s两侧**字符集逐字相同**（只后端有 %r / 只前端有 %r）"
           % (fails_prefix, [hex(ord(c)) for c in _only_py], [hex(ord(c)) for c in _only_js]))
        _diff = sorted(k for k in set(py_map) & set(js_map) if py_map[k] != js_map[k])
        ok(not _diff, "%s同一字符的转换结果一致（不一致：%r）"
           % (fails_prefix, [(hex(ord(k)), py_map[k], js_map[k]) for k in _diff]))
        # ⚠️ 不能只断言「两侧相同」：把表清空后「空 vs 空」也相同 ⇒ 判据会被绕过。
        #    必须锚定**核心字符确实在位**。
        ok(chr(0x3002) in py_map and py_map[chr(0x3002)] == ".",
           "%s核心字符 U+3002 `。` → `.` 在位（中文输入法打小数点，**NFKC 不转**）" % fails_prefix)
        ok(chr(0x2212) in py_map and py_map[chr(0x2212)] == "-",
           "%s核心字符 U+2212 数学减号 → `-` 在位（从公式复制来的负号）" % fails_prefix)
    except Exception as e:
        ok(False, "%s容错表同源断言抛异常: %s" % (fails_prefix, e))

    # ── E2 归一化行为样例：容错表**真的被 `normalize_qty` 用上**，且**不放松**原判据 ──
    _samples = (
        ("\u3000" + "12" + "\u3000", 12, None, "表意空格包围 → 12（空格被删，不是被拒）"),
        ("\uff11\uff12", 12, None, "全角数字 １２ → 12（NFKC）"),
        ("1\uff0c200", 1200, None, "全角逗号 1，200 → 1200（NFKC + 去千分位）"),
        ("1\u3001200", 1200, None, "顿号 1、200 → 1200（容错表，NFKC 不认顿号）"),
        ("\uff0d3", None, mod.VK_NEG, "全角负号 －3 → 判负数（**归一后再判**，不是判「非数字」）"),
        ("\u22123", None, mod.VK_NEG, "数学减号 −3 → 判负数（同上）"),
        ("12\u7bb1", None, mod.VK_NUM, "🔴 `12箱` 仍必须是 VK_NUM（容错表**不得**变成「把脏数据洗干净」）"),
        ("abc", None, mod.VK_NUM, "🔴 `abc` 仍必须是 VK_NUM"),
        # 两端字符集一致（由变异体 M6「全绿」牵出）：`\d` 在 Python 是 Unicode 感知、
        # 在 JS 是 ASCII-only ⇒ 若后端用 `\d`，这类数字后端收货、前端标红。必须两端都拒。
        ("\u0661\u0662", None, mod.VK_NUM, "阿拉伯-印度数字 ١٢ 判非数字（`\\d` 的 Unicode 宽严不得替判据背书）"),
        ("\u0967\u0968", None, mod.VK_NUM, "天城文数字 १२ 判非数字（同上）"),
    )
    for _raw, _exp_n, _exp_k, _why in _samples:
        _got = mod.normalize_qty(_raw)
        ok(_got == (_exp_n, _exp_k), "%s%s（实得 %r）" % (fails_prefix, _why, _got))

    n, f = CHECKS[0], list(FAILS)
    FAILS, CHECKS[0] = keep_fails, keep_checks
    return n, f


# ─────────────────────────── 变异体（反证）───────────────────────────
# 每项：(名字, old, new, 一句话说明这处改坏会放过什么)
MUTANTS = [
    ("M1 空串不再当未填",
     '        s = str(raw).strip()\n        if s == "":\n            return 0, None',
     '        s = str(raw).strip()',
     '空串变「非数字」⇒ 没填过的格子全表标红，用户根本存不下去'),
    ("M2 数字判据退回前缀匹配（parseFloat 老 bug）",
     '+)?(?:[eE][+-]?[0-9]+)?$")',
     '+")',
     '"12箱" 被认成 12 ⇒ 前端判合法、后端 int() 抛错 → 静默丢弃（本轮要修的原缺陷）'),
    ("M3 负数不拦",
     '    if n < 0:\n        return None, VK_NEG',
     '    if False:\n        return None, VK_NEG',
     '负数量落库 ⇒ 汇总/金额被算成负'),
    ("M4 非整数不拦",
     '    if n != int(n):\n        return None, VK_INT',
     '    if False:\n        return None, VK_INT',
     '1.5 件落库 ⇒ int() 截断成 1，用户看到的和存的不一样'),
    ("M5 bool 不挡",
     '    if isinstance(raw, bool):\n        return None, VK_NUM\n',
     '',
     'JSON 里一个 true 静默变成「1 件」'),
    ("M6 去掉 NFKC 归一",
     '    t = unicodedata.normalize("NFKC", str(s))',
     '    t = str(s)',
     '全角「１２」变非数字 ⇒ 与后端 int() 的历史能力不一致'),
    ("M7 不去千分位逗号",
     '    return t.replace(",", "").strip()',
     '    return t.strip()',
     '"1,200" 变非数字 ⇒ 前端支持、后端拒收'),
    ("M8 上限判据从 > 变 >=",
     '    if n > qmax:',
     '    if n >= qmax:',
     '恰好等于上限（真实业务最大 360）被误拒'),
    ("M9 上限写死不跟规则走",
     '        return n, {"kind": VK_OVER, "msg": MSG_OVER.replace("{max}", str(qmax))}',
     '        return n, {"kind": VK_OVER, "msg": MSG_OVER.replace("{max}", "99999")}',
     '租户把上限调小以后，提示还在说 99999（用户照提示改都改不对）'),
    ("M10 名字必填不做行级去重",
     '            if not row_name.get(row):',
     '            if True:',
     '一行 3 个客户列 ⇒ 同一件事报 3 遍，清单里全是噪音'),
    ("M11 名字必填的行前提丢掉",
     '        elif qty > 0 and row not in row_anchor:',
     '        elif qty >= 0 and row not in row_anchor:',
     '整行没填数量的空行也报「商品名称必填」⇒ 满屏假错'),
    ("M12 非有限值不挡",
     '    if not math.isfinite(n):\n        return None, VK_NUM',
     '    if False:\n        return None, VK_NUM',
     'JSON 里的 Infinity 会走到 int(inf) → OverflowError → 500'),
    ("M13 正则丢掉记数法",
     '(?:[eE][+-]?[0-9]+)?$")',
     '$")',
     'Excel 里合法的 1e3 被拒收（前端放行、后端拒收）—— 本模块自测第一跑就抓到过这条'),
    ("M14 适配器不按 customers 限定作用域",
     '        for cname in cs:\n            if not cname:\n                continue\n            entries.append({"row": ri + 1, "col": cname, "name": name, "qty": qb.get(cname)})',
     '        for cname, qv in qb.items():\n            entries.append({"row": ri + 1, "col": cname, "name": name, "qty": qv})',
     '对根本不会被写库的多余键报错 ⇒ 造出「报了但改不了」的假违规'),
]


def main():
    import logging
    logging.disable(logging.WARNING)   # 静音「读不到库回落默认」的预期告警（约 130 行噪音）
    src = open(SRC, encoding="utf-8").read()
    mod = load(src)
    n, f = run_judgement(mod)
    print("=" * 78)
    print("A1 forecast_rules.py 离线自测 —— 基线")
    print("=" * 78)
    if f:
        print("  ❌ 基线就有 %d 条红：%s" % (len(f), f[:6]))
    else:
        print("  ✅ 基线 %d 条判据全绿" % n)

    total_mut_red = 0
    mut_ok = 0
    mut_missing = 0
    print("\n" + "=" * 78)
    print("反证：逐个变异源码 → 必须至少让一条判据变红")
    print("=" * 78)
    for name, old, new, why in MUTANTS:
        if old not in src:
            # ⚠️ 锚点找不到**必须计入失败**，不能只打印一行就跳过 ——
            #    否则「变异没跑」会和「变异被抓住」在汇总里长得一样（本项目的「静默跳过」老账）。
            mut_missing += 1
            print("  ❌ %-40s 变异锚点没找到（源码变了？）← 未验证，按失败计" % name)
            continue
        mut_src = src.replace(old, new, 1)
        try:
            m2 = load(mut_src, "mut_" + str(abs(hash(name))))
            _, mf = run_judgement(m2, fails_prefix="[变异] ")
            red = len(mf)
        except Exception as e:
            red = 1
            mf = ["变异体自身抛错: %s" % e]
        if red:
            mut_ok += 1
            total_mut_red += red
            print("  ✅ %-40s 变红 %2d 条  ← %s" % (name, red, why))
        else:
            print("  ❌ %-40s **仍然全绿** ← 这处判据根本没被测！" % name)

    total_checks = n * (1 + len(MUTANTS))
    print("\n" + "=" * 78)
    print("基线判据 %d 条 · 变异 %d/%d 变红 · 锚点缺失 %d · 累计 %d 条断言"
          % (n, mut_ok, len(MUTANTS), mut_missing, total_checks))
    print("=" * 78)
    bad = len(f) + (len(MUTANTS) - mut_ok)
    if bad:
        print("VERDICT: FAIL（%d 处问题）" % bad)
        for x in f[:8]:
            print("   - " + x)
        sys.exit(2)
    print("VERDICT: PASS —— 基线全绿、%d 个变异全部被抓" % len(MUTANTS))


if __name__ == "__main__":
    main()
