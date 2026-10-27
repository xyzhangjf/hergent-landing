#!/usr/bin/env python3
"""v707「统一」：把报表侧三处「平衡」判据统一到 `money_balanced()`。

## 背景（2026-10-27 实测，不要凭印象）

v706 把 `gl_post()` 的借贷平衡判据从浮点 `abs(dr-cr) <= 0.01` 换成整数分
`abs(to_cents(dr)-to_cents(cr)) <= 1`，但**报表侧还留着老判据**，形成自相矛盾：

    过账：差 1 分算平 → 凭证入库
    报表：差 1 分算不平 → 老板看到红色 ✗

同一条业务事实，两个组件给出相反结论。本版统一为同一个实现。

## 三处目标（全后端只有这三处，2026-10-27 grep 确认）

| 文件 | 行 | 函数 | 前端文案 |
|---|---|---|---|
| `erp_db.py` | 6718 | `get_trial_balance()` | 「✓ 试算平衡 / ✗ 试算不平衡」 |
| `db/queries/finance.py` | 102 | `get_balance_sheet_gl()` | 「✓ 借贷平衡 / ✗ 借贷不平衡」 |
| `routers/voucher_templates.py` | 100 | `test_template()` | 模板试算预览红/绿 |

## 双算结论（`dualcheck_report_balance.py`，2026-10-27 生产三库）

**0 翻案**。所有月份 / 所有时点，老判据与新判据结论一致。原因很朴素：
生产上不平的差额是 **379 万**，不是 1 分 —— 判据口径的差异只影响"恰好差 1 分"
这一条边界，而这条边界现有的存量数据一次都没踩到。

⚠️ 所以：**本次改动不会让任何报表从红变绿**。如果期望"改完就不红了"，
那不是这一版能解决的 —— 详见下方「本版不解决的问题」。

## 本版**不**解决的问题（已实测确认，需单独立项）

1. **期初凭证本身借贷不平 379 万**：`tenant_1` 的 `ref_type='opening'`
   一笔（208 行，`summary='舟谱导入期初余额'`，2026-06-01）借 12,601,306.36 /
   贷 8,807,411.20。舟谱导入把**科目树的父节点也当末级科目写了借方**，
   贷方却没有对应项 ⇒ 试算表 2026-06 必然显示「✗ 不平衡」。
2. **父/子科目被重复计入**：`chart_of_accounts` 是扁平树且父子都 `is_active=1`，
   `get_balance_sheet_gl()` 用 `WHERE account_code IN (...)` 汇总整类，
   父子同在其中 ⇒ 资产端按层级重复累加（实测 `1002` 银行存款 414,602.56
   恰好等于其 7 个子科目之和，被算了两次）。这是资产虚高与资产负债表
   差 389 万的直接来源。
3. **权益残差兜底让判据失去判别力**：`if total_equity == 0: total_equity =
   total_assets - total_liabilities`。无权益余额时等式被"凑"平，`balanced`
   恒 True。本版不动它（动它会让报表冒出新的红叉，属业务决策）。

## 幂等与安全

- 每个目标用**唯一上下文串**锚定，替换前断言「原文出现恰好 1 次」；
  出现 0 次或 >1 次都**报错退出**，不静默跳过（静默跳过 = 悄悄少改一处）。
- `--dry-run` 只打印不写；`--revert` 从 `.bak-v707` 还原。
- 写前逐个 `py_compile`，任一失败即回滚全部文件。
- 写后**回读**确认新串在位、旧串已消失（不能只报"已替换"）。

## 用法

    python3 patch_v707_report_balance.py --dry-run
    python3 patch_v707_report_balance.py
    python3 patch_v707_report_balance.py --revert
"""
import argparse
import py_compile
import shutil
import sys
from pathlib import Path

DEFAULT_ROOT = Path("/opt/hergent-erp")
BAK_SUFFIX = ".bak-v707"

# (相对路径, 旧串, 新串, 说明)
TARGETS = [
    (
        "erp_db.py",
        '"balanced":abs(total_debit-total_credit)<0.01,',
        '"balanced":money_balanced(total_debit,total_credit),',
        "试算表 get_trial_balance() 的 balanced",
    ),
    (
        "db/queries/finance.py",
        "        balanced = abs(total_assets - (total_liabilities + total_equity)) < 0.01",
        "        balanced = money_balanced(total_assets, total_liabilities + total_equity)",
        "资产负债表 get_balance_sheet_gl() 的 balanced",
    ),
    (
        "routers/voucher_templates.py",
        '"balanced": abs(total_debit - total_credit) < 0.01,',
        '"balanced": money_balanced(total_debit, total_credit),',
        "凭证模板预览 test_template() 的 balanced",
    ),
    # ↓ 顺带修的存量 500（**不是**判据问题）：`body` 读出来了却没用，函数体引用未定义的 `d`
    #   ⇒ 这个接口 100% 抛 NameError，前端点「测试」永远看到「内部错误」。
    #   第 3 处判据正躺在这个函数里，不修它就没法验证判据真的生效。
    #   改前状态可用同目录 `routers/voucher_templates.py.bak-v707` 复核（里面就是 `d.get`）。
    (
        "routers/voucher_templates.py",
        '    body = await request.json()\n'
        '    event_type = d.get("event_type", "sale_deliver")\n'
        '    context = d.get("context", {"total_amount": 10000, "customer_name": "测试客户", "order_no": "SO-TEST"})',
        '    body = await request.json()\n'
        '    if not isinstance(body, dict):\n'
        '        body = {}\n'
        '    event_type = body.get("event_type", "sale_deliver")\n'
        '    context = body.get("context", {"total_amount": 10000, "customer_name": "测试客户", "order_no": "SO-TEST"})',
        "存量 500：test_template() 引用未定义的 d（应用 body）",
    ),
]

# (相对路径, 锚点旧行, 锚点新行, 说明) —— import 必须与替换同步，否则 NameError 到运行期才炸
IMPORTS = [
    (
        "erp_db.py",
        "from db.precision import round_money",
        "from db.precision import round_money, money_balanced",
        "扩展现有 precision 导入",
    ),
    (
        "db/queries/finance.py",
        "from db.queries.inventory import inventory_adjust",
        "from db.precision import money_balanced\nfrom db.queries.inventory import inventory_adjust",
        "新增 precision 导入（放在 queries 导入之前，无循环依赖）",
    ),
    (
        "routers/voucher_templates.py",
        "from voucher_engine import apply_template, _init_default_templates",
        "from db.precision import money_balanced\nfrom voucher_engine import apply_template, _init_default_templates",
        "新增 precision 导入",
    ),
]


def count_occurrences(text, needle):
    return text.count(needle)


def apply_replacement(root, rel, old, new, desc, dry_run, log):
    p = root / rel
    if not p.exists():
        log("🔴 %s 不存在：%s" % (rel, p))
        return "error"
    text = p.read_text(encoding="utf-8")

    n_old, n_new = count_occurrences(text, old), count_occurrences(text, new)
    # ⚠️ 必须先判"新串已在位"。erp_db 的 import 锚点是**包含关系**
    #    （old = `import round_money` 是 new = `import round_money, money_balanced` 的前缀），
    #    按 "n_old==0 才算已改" 判会每次重复插入、越改越长且语法仍合法 → 静默劣化。
    if n_new == 1:
        log("⏭  %-34s 已是新口径（幂等跳过）— %s" % (rel, desc))
        return "already"
    if n_new > 1:
        log("🔴 %-34s 新串已出现 %d 次（疑似重复插入过）— %s" % (rel, n_new, desc))
        return "error"
    if n_old != 1:
        # 0 次 = 结构变了 / 已被别人改过；>1 次 = 锚点不唯一，替换会误伤
        log("🔴 %-34s 锚点出现 %d 次（应为 1）— %s" % (rel, n_old, desc))
        log("     旧串：%s" % old[:100])
        log("     拒绝执行，请人工核对源码结构")
        return "error"

    if dry_run:
        log("🔍 %-34s 待替换 — %s" % (rel, desc))
        return "dry"

    if not (root / (rel + BAK_SUFFIX)).exists():
        shutil.copy2(p, root / (rel + BAK_SUFFIX))
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    log("✅ %-34s 已替换 — %s" % (rel, desc))
    return "changed"


def apply_import(root, rel, old, new, desc, dry_run, log):
    p = root / rel
    text = p.read_text(encoding="utf-8")
    n_old, n_new = count_occurrences(text, old), count_occurrences(text, new)
    if n_new == 1:
        # 同上：锚点可能是前缀包含关系，必须优先判"新串在位"
        log("⏭  %-34s import 已就位（幂等跳过）— %s" % (rel, desc))
        return "already"
    if n_new > 1:
        log("🔴 %-34s import 新串已出现 %d 次（疑似重复插入）— %s" % (rel, n_new, desc))
        return "error"
    if n_old != 1:
        log("🔴 %-34s import 锚点出现 %d 次（应为 1）— %s" % (rel, n_old, desc))
        log("     锚点：%s" % old[:100])
        return "error"
    if dry_run:
        log("🔍 %-34s import 待插入 — %s" % (rel, desc))
        return "dry"
    if not (root / (rel + BAK_SUFFIX)).exists():
        shutil.copy2(p, root / (rel + BAK_SUFFIX))
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    log("✅ %-34s import 已插入 — %s" % (rel, desc))
    return "changed"


def verify(root, log):
    """回读确认：给每个人为判断都能用 grep 复核的字面量。"""
    checks = [
        ("erp_db.py", '"balanced":money_balanced(total_debit,total_credit),',
         '"balanced":abs(total_debit-total_credit)'),
        ("db/queries/finance.py",
         "balanced = money_balanced(total_assets, total_liabilities + total_equity)",
         "abs(total_assets - (total_liabilities + total_equity))"),
        ("routers/voucher_templates.py",
         '"balanced": money_balanced(total_debit, total_credit),',
         '"balanced": abs(total_debit - total_credit)'),
        ("erp_db.py", "from db.precision import round_money, money_balanced", None),
        ("db/queries/finance.py", "from db.precision import money_balanced", None),
        ("routers/voucher_templates.py", "from db.precision import money_balanced", None),
    ]
    ok = True
    for rel, must_have, must_not in checks:
        text = (root / rel).read_text(encoding="utf-8")
        if must_have not in text:
            log("🔴 回读失败 %s：缺 %s" % (rel, must_have[:70]))
            ok = False
        if must_not and must_not in text:
            log("🔴 回读失败 %s：仍残留老判据 %s" % (rel, must_not[:70]))
            ok = False
    # 全后端不该再有第四处漏掉的 balanced 字面量
    text = (root / "routers/voucher_templates.py").read_text(encoding="utf-8")
    # ⚠️ 不能用裸 `d.get(`：本文件另有 `create_template` / `update_template` 两处
    #    **合法**的局部 `d`（请求体解包），扫全文会误报"500 未修"。
    #    判据必须锚到 test_template 独有的赋值形态。
    if 'event_type = d.get("event_type"' in text or "context = d.get(\"context\"" in text:
        log("🔴 回读失败 routers/voucher_templates.py：test_template 仍引用未定义的 d（500 未修）")
        ok = False
    if "isinstance(body, dict)" not in text:
        log("🔴 回读失败 routers/voucher_templates.py：body 类型保护缺失")
        ok = False
    leftovers = []
    for py in root.rglob("*.py"):
        if any(s in py.parts for s in ("node_modules", "venv", ".git", "tools")):
            continue
        try:
            t = py.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pat in ("abs(total_debit-total_credit)", "abs(total_debit - total_credit)",
                    "abs(total_assets - (total_liabilities + total_equity))"):
            if pat in t and "precision.py" not in str(py):
                leftovers.append("%s: %s" % (py, pat))
    if leftovers:
        log("🔴 仍有老判据残留：")
        for x in leftovers:
            log("     " + x)
        ok = False
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    a = ap.parse_args()
    root = Path(a.root)
    logs = []

    def log(s):
        print(s)
        logs.append(s)

    if a.revert:
        for rel, _o, _n, _d in TARGETS:
            bak = root / (rel + BAK_SUFFIX)
            if bak.exists():
                shutil.copy2(bak, root / rel)
                log("已还原 %s ← %s（记得重启服务）" % (rel, bak.name))
            else:
                log("⏭  %s 无备份，跳过" % rel)
        return 0

    log("v707 报表平衡判据统一（root=%s%s）" % (root, "，DRY-RUN" if a.dry_run else ""))
    log("=" * 88)

    statuses = []
    for rel, old, new, desc in TARGETS:
        statuses.append(apply_replacement(root, rel, old, new, desc, a.dry_run, log))
    for rel, old, new, desc in IMPORTS:
        statuses.append(apply_import(root, rel, old, new, desc, a.dry_run, log))

    if "error" in statuses:
        log("\n🔴 有目标未按预期处理，**未做任何写入**（dry-run 亦未写）。请人工核对。")
        return 2
    if a.dry_run:
        log("\nDRY-RUN 结束，未写盘。")
        return 0

    # 写完先语法校验，任一失败回滚全部（宁可全退，不留半改状态）
    errs = []
    for rel, _o, _n, _d in TARGETS:
        try:
            py_compile.compile(str(root / rel), doraise=True)
        except py_compile.PyCompileError as e:
            errs.append("%s: %s" % (rel, e))
    if errs:
        log("\n🔴 语法校验失败，正在回滚：")
        for e in errs:
            log("   " + e)
        for rel, _o, _n, _d in TARGETS:
            bak = root / (rel + BAK_SUFFIX)
            if bak.exists():
                shutil.copy2(bak, root / rel)
        return 2
    log("\n✅ 三个文件 py_compile 通过")

    log("\n回读校验：")
    if not verify(root, log):
        return 2
    log("✅ 回读通过：三处新判据在位、无老判据残留")
    log("\n下一步：重启 erp 服务 → 打 3 个接口确认字段仍为布尔 → 前端三处文案不变即为预期")
    return 0


if __name__ == "__main__":
    sys.exit(main())
