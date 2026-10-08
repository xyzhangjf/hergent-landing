#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v335 页内按钮级门禁静态护栏（hergent-cn-v2）。

## 为什么需要这个脚本（本轮唯一的自动化防线）

v335 把 `canDo(module, action)` 挂到了业务页面的写按钮上。判据链是：

    后端 `rbac_middleware` 推模块(_PATH_MODULE_MAP 首个 startswith) + 推动作(HTTP 方法)

前端 `canDo` 的语义是 **fail-closed**：
  · 模块键在 `permissions_detail` 里**不存在** ⇒ 返回 False ⇒ 按钮**消失**
  · `permActs` 为 null（后端没下发）⇒ 返回 True ⇒ 不隐藏（fail-open）

⇒ 最大风险不是"门禁漏了"，而是 **模块名写错导致整页写按钮全部消失**，而且
   这类错误**构建通过、运行期不报错**（只是按钮没了），人工点检极难发现。
   所以必须有静态护栏，把「前端写的模块名」与「后端真实模块值域」对齐。

## 五条判据

  C1  动作 ∈ {create, update, delete}  —— 写按钮不存在 'read' 门禁（门禁读 = 把界面藏坏）
  C2  模块 ∈ 后端 `_PATH_MODULE_MAP` 的**值域**（AST 直接从 server.py 读，不维护第二份清单）
  C3  逐文件**模块白名单** —— 防「把 crm 写进客户档案」这类"门禁用的不是接口模块"的错
  C4  用了 `canDo(` 的文件必须真的把它引入作用域（import 或 store.xxx），否则运行期崩
  C5  逐文件门禁计数写死 —— 防止一次误操作把某页的门禁整批删掉（数量对不上即转红）
  C6  **非字面量调用必须显式登记** —— 例如 `canDo('sales', editingContractId ? 'update' : 'create')`
      （同一按钮两种动作）。C1/C2 只能判字面量，非字面量对它们**天然不可见**；
      不单列这一条，护栏就会有"看不见的角落"，而那正是错误最容易藏的地方。

## 反例自证（C2/C1 必须能被证伪，否则本脚本只是"总是绿"的装饰）

脚本会把 `canDo('sale', 'create')`（错模块）与 `canDo('data', 'read')`（错动作）
注入一份**临时副本**，断言 C2/C1 各自转红；注入正确写法时必须转绿。

用法：
    python3 .workbuddy/tools/v335-button-gate-check.py            # 检查当前工作区
    python3 .workbuddy/tools/v335-button-gate-check.py --root X   # 指定前端仓根
退出码：0 = 全通过；1 = 有失败项。
"""

import argparse
import ast
import os
import re
import shutil
import sys
import tempfile

# ---------------------------------------------------------------- 路径

DEFAULT_ROOT = "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2"
BACKEND_SERVER = "/Users/zhangjunfeng/Documents/hergent-erp/server/server.py"

ALLOWED_ACTIONS = {"create", "update", "delete"}

# C3：逐文件**允许出现的模块**白名单。
# 判据 = 「该页面的写入口，落到的**接口模块**」（不是 pages.js 里那个页面模块！）
# 🔴 本项目铁律：`pages.js` 的 `module` 只决定"入口显不显示"，与接口归属经常不同。
#    实测三例：客户档案页 module='crm' 而 /api/contacts 归 data；渠道与价格页 module=null
#    而写接口归 data；员工档案页 module='hr' 而账号六件套 /api/users/* 归 data。
#    按页面模块写门禁 = 造出新的"假入口"（按钮亮着，一点 403）。
# 每项格式：'相对路径': (模块集合, 该文件的 canDo 调用数)
#   计数口径 = 该文件里 `canDo(` 的**总出现次数**（含非字面量；非字面量另见 NON_LITERAL_ALLOW）
FILE_RULES = {
    "src/pages/Rebate.vue": ({"sales"}, 33),
    "src/pages/Forecast.vue": ({"data", "forecast-audit"}, 44),
    "src/pages/ForecastHistory.vue": ({"data"}, 7),
    "src/pages/EmployeeArchive.vue": ({"data", "hr"}, 23),
    "src/pages/BrandArchive.vue": ({"data"}, 8),
    "src/pages/CustomerArchive.vue": ({"data"}, 4),
    "src/pages/ProductArchive.vue": ({"data"}, 5),
    "src/pages/PriceChannels.vue": ({"data"}, 7),
    "src/pages/ProductTarget.vue": ({"data"}, 4),
    "src/pages/ReportMapping.vue": ({"data"}, 7),
    "src/pages/WarehouseArchive.vue": ({"stock"}, 3),
    "src/pages/LossAccounting.vue": ({"stock"}, 7),
    "src/pages/DataFill.vue": ({"data"}, 2),
    "src/components/ImportReceipt.vue": ({"data"}, 1),
    "src/components/forecast/AutoPeriodBlock.vue": ({"data"}, 1),
    "src/components/forecast/ReminderConfig.vue": ({"data"}, 1),
}

# C6：允许存在的**非字面量** canDo 调用（原样登记，改一个字符就会失配 ⇒ 强制复核）。
# Rebate.vue 的年度合同弹窗「保存」按钮：新建走 POST（create）、编辑走 PUT（update），
# 同一按钮两种 HTTP 方法 ⇒ 动作只能在运行期由 `editingContractId` 决定。
# 这条不能改成一个固定动作 —— 只判其中一个方向都必然在另一半场景里撒谎。
NON_LITERAL_ALLOW = {
    "canDo('sales', editingContractId ? 'update' : 'create')",
}

# 不参与 C3/C5 的文件（门禁机制的**定义处**，不是使用处）
SKIP_FILES = {"src/store/index.js"}

CALL_RE = re.compile(r"""canDo\(\s*['"]([A-Za-z0-9_\-*]+)['"]\s*,\s*['"]([A-Za-z0-9_\-*]+)['"]""")
# 非字面量形态：`canDo(` 后面第一段里带了变量 / 三元 / 模板串。用于 C6 甄别。
ANY_CALL_RE = re.compile(r"canDo\(([^()]*)\)")
SCAN_EXT = (".vue", ".js")

# store/index.js 里 canDo 的定义/导出——不计入统计，但要在（否则前端根本没有这个函数）
STORE_MARKERS = ("function canDo(module, action)", "canDo,")


# ---------------------------------------------------------------- 后端真值


def backend_truth(server_path):
    """从 server.py 用 AST 取 `_PATH_MODULE_MAP` 的模块值域 + `_READ_ONLY_POST`。

    为什么必须 AST 而不是正则：该文件里有大量注释举例（含带引号的路径字面量），
    正则会把注释里的例子吃进来 —— 那是"凭想象维护第二份清单"的另一种写法。
    """
    src = open(server_path, encoding="utf-8").read()
    tree = ast.parse(src)

    modmap, readonly_post = None, None
    for node in tree.body:  # 只要顶层赋值（模块级字面量）
        if not isinstance(node, ast.Assign):
            continue
        for t in node.targets:
            if not isinstance(t, ast.Name):
                continue
            if t.id == "_PATH_MODULE_MAP":
                modmap = ast.literal_eval(node.value)
            elif t.id == "_READ_ONLY_POST":
                readonly_post = ast.literal_eval(node.value)
    if not isinstance(modmap, dict) or not modmap:
        raise SystemExit("无法从 %s 提取 _PATH_MODULE_MAP（是否被改成了非字面量？）" % server_path)
    if not readonly_post:
        raise SystemExit("无法从 %s 提取 _READ_ONLY_POST" % server_path)
    return modmap, readonly_post


def order_sensitive_pairs(modmap):
    """返回「键 A 是键 B 的前缀」的对 —— 这些对的动作归属由**插入顺序**决定。

    为什么要单独列：匹配是 `for prefix, mod in _PATH_MODULE_MAP.items(): if path.startswith(prefix): break`
    ⇒ 前缀对之间存在**遮蔽**。`/api/forecast-audit` 归 forecast-audit 而不是 data，唯一原因
    就是它在 dict 里排在 `/api/forecast` 前面。改顺序会静默改归属。
    """
    keys = list(modmap.keys())
    pairs = []
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            if a.startswith(b) or b.startswith(a):
                pairs.append((a, modmap[a], b, modmap[b]))
    return pairs


# ---------------------------------------------------------------- 扫描


def scan(root):
    """扫 `src/` 下所有 .vue/.js（排除 SKIP_FILES）。

    返回 (hits, totals, nonlit)：
      hits   = [(rel, lineno, module, action, raw)]  —— **字面量**调用（C1/C2/C3 用）
      totals = {rel: `canDo(` 出现总次数}            —— C5 计数用（含非字面量）
      nonlit = [(rel, lineno, snippet)]              —— C6 用：字面量正则看不见的调用
    """
    hits, totals, nonlit = [], {}, []
    for dirpath, _dirnames, filenames in os.walk(os.path.join(root, "src")):
        for fn in sorted(filenames):
            if not fn.endswith(SCAN_EXT):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root)
            if rel in SKIP_FILES:
                continue
            with open(full, encoding="utf-8", errors="replace") as fh:
                for i, line in enumerate(fh, 1):
                    n = line.count("canDo(")
                    if not n:
                        continue
                    totals[rel] = totals.get(rel, 0) + n
                    lit_starts = set()
                    for m in CALL_RE.finditer(line):
                        lit_starts.add(m.start())
                        hits.append((rel, i, m.group(1), m.group(2), m.group(0)))
                    for m in ANY_CALL_RE.finditer(line):
                        if m.start() in lit_starts:
                            continue
                        nonlit.append((rel, i, m.group(0)))
    return hits, totals, nonlit


def file_has_intro(root, rel):
    """C4：该文件是否把 canDo 引入作用域（`import { ..., canDo }` 或 `store.canDo`）。"""
    src = open(os.path.join(root, rel), encoding="utf-8", errors="replace").read()
    m = re.search(r"import\s*\{([^}]*)\}\s*from\s*['\"][./]*store['\"]", src)
    if m and re.search(r"\bcanDo\b", m.group(1)):
        return True
    if re.search(r"\bstore\.canDo\s*\(", src):
        return True
    return False


# ---------------------------------------------------------------- 检查器（可对任意 root 复用，故反例自证能真调它）


def check(root, modmap, readonly_post, verbose=True):
    modules_ok = set(modmap.values())
    hits, totals, nonlit = scan(root)
    fails = []

    per_file = {}
    for rel, lineno, mod, act, raw in hits:
        per_file.setdefault(rel, []).append((lineno, mod, act, raw))
        # C2
        if mod not in modules_ok:
            fails.append(("C2", rel, lineno,
                          "模块 `%s` 不在后端 _PATH_MODULE_MAP 值域内 %s" % (mod, sorted(modules_ok))))
        # C1
        if act not in ALLOWED_ACTIONS:
            fails.append(("C1", rel, lineno,
                          "动作 `%s` 不是写动作（只能是 %s）—— 门禁读会把界面藏坏" % (act, sorted(ALLOWED_ACTIONS))))
        # C3
        rule = FILE_RULES.get(rel)
        if rule is not None and mod not in rule[0]:
            fails.append(("C3", rel, lineno,
                          "该文件白名单是 %s，出现了 `%s`" % (sorted(rule[0]), mod)))

    # C6：非字面量调用必须**原样登记**（改一个字符即失配 ⇒ 强制人工复核）
    for rel, lineno, snippet in nonlit:
        if snippet not in NON_LITERAL_ALLOW:
            fails.append(("C6", rel, lineno,
                          "非字面量 canDo 未登记：`%s`（C1/C2 对它不可见 ⇒ 必须登记并复核动作来源）"
                          % snippet))

    # C5：计数（口径 = `canDo(` 总出现次数，含非字面量）
    for rel, (mods, want) in FILE_RULES.items():
        got = totals.get(rel, 0)
        if got != want:
            fails.append(("C5", rel, 0, "门禁计数 %d ≠ 写死的 %d（少=被误删，多=未登记）" % (got, want)))
        if not os.path.exists(os.path.join(root, rel)):
            fails.append(("C5", rel, 0, "文件不存在（改名/删除后必须同步本表）"))

    # C5b：出现了 FILE_RULES 之外的新文件（新页面挂门禁后必须登记模块白名单）
    for rel in sorted(totals):
        if rel not in FILE_RULES:
            fails.append(("C5", rel, 0, "新挂门禁的文件未登记（缺模块白名单 ⇒ C3 对它失效）"))

    # C4
    for rel in sorted(set(list(totals.keys()) + [r for r in FILE_RULES if os.path.exists(os.path.join(root, r))])):
        if totals.get(rel) and not file_has_intro(root, rel):
            fails.append(("C4", rel, 0, "用了 canDo 但没有引入作用域（import/store.canDo）⇒ 运行期崩"))

    if verbose:
        print("== 后端真值 ==")
        print("  _PATH_MODULE_MAP 条目 %d，模块值域 %d 个：%s"
              % (len(modmap), len(modules_ok), " ".join(sorted(modules_ok))))
        print("  _READ_ONLY_POST 白名单 %d 条" % len(readonly_post))
        osp = order_sensitive_pairs(modmap)
        print("  顺序敏感（互为前缀）的键对 %d 对" % len(osp))
        for a, ma, b, mb in osp:
            if {ma, mb} & {"data", "forecast-audit", "sales", "stock", "hr"}:
                print("    %s→%s  vs  %s→%s" % (a, ma, b, mb))
        print()
        print("== 前端门禁落点 ==")
        total = 0
        for rel in sorted(totals):
            mods = sorted({m for _l, m, _a, _r in per_file.get(rel, [])})
            acts = sorted({a for _l, _m, a, _r in per_file.get(rel, [])})
            nl = len([1 for n_rel, _l, _s in nonlit if n_rel == rel])
            total += totals[rel]
            print("  %-52s %3d 处  模块 %-24s 动作 %-24s 非字面量 %d"
                  % (rel, totals[rel], ",".join(mods) or "-", ",".join(acts) or "-", nl))
        print("  合计 %d 处（字面量 %d + 非字面量 %d），覆盖 %d 个文件"
              % (total, len(hits), len(nonlit), len(totals)))
        print()
        print("== 反例自证 ==")

    return fails, per_file


def self_proof(modmap, readonly_post):
    """把错写法注入临时副本，断言 C2/C1 会转红；注入正确写法时转绿。

    🔴 探针必须先自证判别力（本机铁律 §12）：一个"总是绿"的检查器等于没有检查器。
    """
    results = []
    tmp = tempfile.mkdtemp(prefix="v335gate-")
    try:
        target = os.path.join(tmp, "src", "pages", "ZZProbe.vue")
        os.makedirs(os.path.dirname(target), exist_ok=True)

        def run(snippet, code_filter=("C1", "C2"), literal=True):
            """把片段写进临时 probe 文件后跑检查器，只回看指定类别的失败项。

            probe 走 `src/pages/ZZProbe.vue`（FILE_RULES 之外）⇒ 必然同时触发 C5b（未登记），
            但那不是被验证的目标，故用 code_filter 过滤。
            """
            os.makedirs(os.path.join(tmp, "src", "pages"), exist_ok=True)
            with open(target, "w", encoding="utf-8") as fh:
                fh.write("<template><button v-if=\"canDo(%s)\">x</button></template>\n" % snippet)
            fails, _ = check(tmp, modmap, readonly_post, verbose=False)
            return [f for f in fails if f[0] in code_filter]

        bad_mod = run("'sale', 'create'")
        bad_act = run("'data', 'read'")
        good = run("'data', 'create'")
        star = run("'*', 'create'")
        nonlit = run("'data', someVar ? 'update' : 'create'", code_filter=("C6",))

        ok1 = bool(bad_mod) and all(f[0] == "C2" for f in bad_mod)
        ok2 = bool(bad_act) and all(f[0] == "C1" for f in bad_act)
        ok3 = not good
        # `'*'`（通配键）：后端 permissions_detail 确实用 `"*"` 表示通配模块，
        # 但前端**页面里**不该出现 —— 页面门禁写 `*` 等于不门禁。故 C2 应转红。
        ok4 = bool(star) and all(f[0] == "C2" for f in star)
        # C6：非字面量必须被抓到（未登记 ⇒ 失败）
        ok5 = bool(nonlit) and all(f[0] == "C6" for f in nonlit)

        results.append(("C2 能证伪：错模块 `sale` 被拦截", ok1, bad_mod))
        results.append(("C1 能证伪：错动作 `read` 被拦截", ok2, bad_act))
        results.append(("正确写法 `data/create` 放行（不过敏）", ok3, good))
        results.append(("页面里写通配 `*` 被拦截", ok4, star))
        results.append(("C6 能证伪：非字面量（三元）被拦截", ok5, nonlit))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return results


# ---------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--server", default=BACKEND_SERVER)
    args = ap.parse_args()

    modmap, readonly_post = backend_truth(args.server)

    # store/index.js 的 canDo 定义必须在（否则前端没有这个函数，全部门禁是空调用）
    store_path = os.path.join(args.root, "src", "store", "index.js")
    store_src = open(store_path, encoding="utf-8", errors="replace").read()
    store_ok = [m for m in STORE_MARKERS if m in store_src]

    fails, per_file = check(args.root, modmap, readonly_post)

    proves = self_proof(modmap, readonly_post)
    for name, ok, detail in proves:
        print("  [%s] %s%s" % ("✓" if ok else "✗", name, "" if ok else "  ← %s" % detail))
        if not ok:
            fails.append(("SELF", "(反例自证)", 0, name))

    print()
    print("  store/index.js 定义标记：%s" % (", ".join(store_ok) if store_ok else "缺失！"))
    if len(store_ok) < len(STORE_MARKERS):
        fails.append(("C4", "src/store/index.js", 0, "canDo 定义/导出标记缺失"))

    print()
    if fails:
        print("===== 失败 %d 项 =====" % len(fails))
        for code, rel, line, msg in fails:
            print("  [%s] %s:%s  %s" % (code, rel, line, msg))
        return 1
    print("===== 全通过：门禁模块名/动作/白名单/计数/自证 五条判据无一失败 =====")
    return 0


if __name__ == "__main__":
    sys.exit(main())
