#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v705 batch A：版本化迁移 + 精度常量（只动两处既有代码，其余全是新增文件）。

=====================================================================
这一版到底改了什么（别被"落地了架构改造"这种话骗过去）
=====================================================================
① 新增 `migrations/` 包（patch 登记表 schema_patches + 运行器 + 结构体检）
   —— **不执行任何业务变更**，只新建一张登记表 + 登记一条 0001 基线。
② 新增 `db/precision.py`：`MONEY_DECIMALS / MONEY_EPS / QTY_EPS` 与
   `round_money / money_eq / money_balanced / qty_eq`。
③ 既有代码只改**两处**，且都是"换成同名常量、行为逐位不变"：
   - `erp_db.py::money()`  → 委托 `db/precision.round_money()`（实现原样迁入）
   - `db/queries/gl.py::gl_post()` 的 `> 0.01` → `not money_balanced(...)`（同一判据）

=====================================================================
为什么只改这两处（而不是把 356 处 round(,2) 全换掉）
=====================================================================
batch A 的纪律是「只加常量、不换口径」。`round(,2)` 散布 356 处，逐处替换会
把一次可验证的改动变成一次不可验证的批量改写 —— 而金额口径改错的代价是账不平，
且**当时看不出来**（要等下个月对账）。全部替换属于 P0-4 主体，必须配双算脚本单独做。

`db/queries/finance.py:102` 的 `abs(...) < 0.01` 刻意**不动**：它是严格小于，
而 gl.py 是"大于才算错"。两者严格性不同（差额恰好 1 分时结论相反），
统一它是业务决策而不是重构，留给 P0-4。

用法：
    python3 patch_v705_batch_a.py [--root=/opt/hergent-erp] [--dry-run]
"""
import sys
import shutil
import py_compile
from datetime import datetime
from pathlib import Path

DEFAULT_ROOT = Path("/opt/hergent-erp")

# (相对路径, 旧串, 新串, 说明)
PATCHES = [
    (
        "erp_db.py",
        "import logging\nimport time\nimport threading\n",
        "import logging\nimport time\nimport threading\n"
        "# v705：金额精度口径的唯一实现在 db/precision.py（常量 MONEY_EPS 等）。\n"
        "# 这里只做门面转发，implementation 原样迁入，行为逐位不变。\n"
        "from db.precision import round_money\n",
        "1. erp_db.py 顶部引入 round_money",
    ),
    (
        "erp_db.py",
        'def money(x):\n'
        '    """将任意金额规整到分（两位小数），None/非法值视为 0。"""\n'
        '    try:\n'
        '        return round(float(x or 0), 2)\n'
        '    except (ValueError, TypeError):\n'
        '        return 0.0\n',
        'def money(x):\n'
        '    """将任意金额规整到分（两位小数），None/非法值视为 0。\n'
        '\n'
        '    v705：实现已迁到 `db/precision.round_money()`（精度口径的唯一常量来源），\n'
        '    本函数保留为**门面**以免全库 300+ 处调用点跟着改。\n'
        '    ⚠️ 行为必须逐位不变（仍是 round(float(x or 0), 2)，银行家舍入）——\n'
        '    金额口径一改，历史单据合计就会漂，且当场看不出来。\n'
        '    """\n'
        '    return round_money(x)\n',
        "2. erp_db.py::money() 委托 round_money（行为不变）",
    ),
    (
        "db/queries/gl.py",
        "from db.connection import get_db\n",
        "from db.connection import get_db\n"
        "from db.precision import money_balanced  # v705：借贷平衡容差取唯一常量\n",
        "3. gl.py 引入 money_balanced",
    ),
    (
        "db/queries/gl.py",
        "    if abs(total_dr - total_cr) > 0.01:\n",
        "    if not money_balanced(total_dr, total_cr):\n",
        "4. gl.py 借贷平衡改用 money_balanced（判据不变）",
    ),
]

# 必须先部署到位的新文件（本脚本不负责写它们，只负责自证）
REQUIRED_FILES = [
    "db/precision.py",
    "migrations/__init__.py",
    "migrations/runner.py",
    "migrations/doctor.py",
    "migrations/dbutil.py",
    "migrations/patches/0001_baseline.py",
    "migrations/platform_tables.txt",
]


def apply(text, old, new, label, results):
    if new in text:
        results.append(("SKIP", label, "已是新版，跳过"))
        return text
    if old not in text:
        results.append(("FAIL", label, "锚点未命中"))
        return text
    if text.count(old) != 1:
        results.append(("FAIL", label, "锚点出现 %d 次，不唯一" % text.count(old)))
        return text
    results.append(("OK", label, ""))
    return text.replace(old, new, 1)


def main():
    args = list(sys.argv[1:])
    dry = "--dry-run" in args
    root = DEFAULT_ROOT
    for a in args:
        if a.startswith("--root="):
            root = Path(a.split("=", 1)[1])
    if not root.exists():
        print("根目录不存在: %s" % root)
        return 1

    missing = [f for f in REQUIRED_FILES if not (root / f).exists()]
    if missing:
        print("❌ 以下新文件尚未部署，先传文件再打补丁：")
        for f in missing:
            print("   - %s" % (root / f))
        return 4

    # 按文件聚合，避免同一文件被反复读写
    files = {}
    for rel, old, new, label in PATCHES:
        files.setdefault(rel, []).append((old, new, label))

    results, outputs = [], {}
    for rel, items in files.items():
        p = root / rel
        if not p.exists():
            results.append(("FAIL", "%s 不存在" % rel, ""))
            continue
        src = p.read_text(encoding="utf-8")
        out = src
        for old, new, label in items:
            out = apply(out, old, new, label, results)
        outputs[rel] = (p, src, out)

    print("=" * 66)
    for st, label, note in results:
        mark = {"OK": "✅", "SKIP": "⏭ ", "FAIL": "❌"}[st]
        print("%s %s%s" % (mark, label, ("  ← " + note) if note else ""))
    print("=" * 66)

    if any(r[0] == "FAIL" for r in results):
        print("有锚点未命中，未写入任何文件。")
        return 2

    todo = [(p, src, out) for (p, src, out) in outputs.values() if out != src]
    if not todo:
        print("内容无变化（已是新版），未写入。")
        return 0
    if dry:
        print("--dry-run：未写入文件。")
        return 0

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    baks = []
    try:
        for p, src, out in todo:
            bak = p.with_suffix(p.suffix + ".bak-v705-%s" % ts)
            shutil.copy2(p, bak)
            baks.append((p, bak))
            p.write_text(out, encoding="utf-8")
            py_compile.compile(str(p), doraise=True)
            print("✅ 已写入 %s（备份 %s）" % (p, bak.name))
    except Exception as e:
        for p, bak in baks:
            shutil.copy2(bak, p)
        print("❌ 写入/语法检查失败，已全部回滚：%s" % e)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
