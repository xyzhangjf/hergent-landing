#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v392b 护栏：**模板里用到的标识符必须在同一文件的 script 段里有来源**。

为什么要有这条（真实事故）
  2026-10-07 上线后真机验收抓到：`InvPurchaseNew.vue` 的模板写了
      `<td>¥{{ fmtMoney(rowAmount(row)) }}</td>`
  而 script 段**既没定义 `fmtMoney`、也没 import 它** ⇒ 运行期
      `TypeError: fmtMoney is not a function`
  ⇒ 整页被 ErrorBoundary 兜底替换，**连带父容器的页签一起消失**。
  而：`vite build` 绿、ESLint 无、路由探针绿、英文枚举检查绿 —— **四道全绿**。
  根因是「模板是运行期求值，构建期不校验标识符可达性」。

判据（只查**共享工具/常量**这类跨页复用符号，避免 v-for 局部变量的误报）
  在 `<template>` 段里出现 `{{ fmtMoney(...) }}` 之类的调用
  ⇒ 同一文件的 `<script>` 段里必须有 `import { fmtMoney ... }` 或 `function fmtMoney`
    或 `const fmtMoney`。

判别力自证：内置正反两侧用例（反例必须红、正例不许误伤）。
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", "hergent-cn-v2", "src")

# 只查这一族「跨页共享、且模板里以「函数调用」形式出现」的符号。
# 它们最危险：漏 import = 运行期崩，且构建期零提示。
SHARED = ["fmtMoney"]

PLAIN = re.compile(r"\{\{(.*?)\}\}", re.S)
TPL = re.compile(r"<template>(.*?)</template>", re.S)
SCR = re.compile(r"<script[^>]*>(.*?)</script>", re.S)


def check_source(src):
    """返回 [(符号, 证据)] —— 模板用了但 script 无来源的符号。"""
    tpl, scr = TPL.search(src), SCR.search(src)
    if not tpl or not scr:
        return []
    body, script = tpl.group(1), scr.group(1)
    bad = []
    for name in SHARED:
        # 模板里以 `<name>(` 形式调用（插值或 :attr 都覆盖，直接全文扫模板段）
        if not re.search(r"\b%s\s*\(" % re.escape(name), body):
            continue
        # script 段里必须有来源
        has = (re.search(r"import\s*\{[^}]*\b%s\b[^}]*\}" % re.escape(name), script)
               or re.search(r"function\s+%s\s*\(" % re.escape(name), script)
               or re.search(r"(const|let|var)\s+%s\s*=" % re.escape(name), script))
        if not has:
            bad.append((name, "模板调用但 script 无 import/定义"))
    return bad


# ── 判别力自证 ──────────────────────────────────────────────
BAD_SAMPLE = """<template><div>{{ fmtMoney(x) }}</div></template>
<script setup>import { ref } from 'vue'; const x = ref(1)</script>"""
GOOD_SAMPLE = """<template><div>{{ fmtMoney(x) }}</div></template>
<script setup>import { fmtMoney } from '../../constants/psiLabels'; import { ref } from 'vue'; const x = ref(1)</script>"""
LOCAL_SAMPLE = """<template><div>{{ fmtMoney(x) }}</div></template>
<script setup>function fmtMoney(n){return n}</script>"""
LOCAL_SAMPLE2 = """<template><div>{{ fmtMoney(x) }}</div></template>
<script setup>const fmtMoney = (n) => String(n)</script>"""
UNUSED_SAMPLE = """<template><div>{{ other(x) }}</div></template>
<script setup>import { ref } from 'vue'; const x = ref(1)</script>"""


def main():
    print("── 判别力自证 ──")
    self_pass = True
    for label, sample, want in (
        ("反例：模板用 fmtMoney 但 script 无来源（必须红）", BAD_SAMPLE, True),
        ("正例：import 自 psiLabels（不许误伤）", GOOD_SAMPLE, False),
        ("正例：本地 function 定义（不许误伤）", LOCAL_SAMPLE, False),
        ("正例：本地 const 箭头函数（不许误伤）", LOCAL_SAMPLE2, False),
        ("正例：模板没用它（不许误伤）", UNUSED_SAMPLE, False),
    ):
        got = bool(check_source(sample))
        good = got == want
        self_pass &= good
        print(("  PASS  " if good else "  FAIL  ") + label + f"  (检出={got})")
    if not self_pass:
        print("🔴 护栏自身判别力不足 ⇒ 结论作废")
        return 2

    print("\n── 全量扫描 src/**/*.vue ──")
    n_file, n_bad = 0, 0
    for dirpath, _dirs, files in os.walk(ROOT):
        for f in sorted(files):
            if not f.endswith(".vue"):
                continue
            p = os.path.join(dirpath, f)
            n_file += 1
            for name, why in check_source(open(p, encoding="utf-8").read()):
                n_bad += 1
                print("  🔴 %s : %s —— %s" % (os.path.relpath(p, ROOT), name, why))
    print(f"\n扫描 {n_file} 个 .vue，违规 {n_bad} 处")
    print("✅ 通过" if n_bad == 0 else "❌ 存在违规")
    return 0 if n_bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
