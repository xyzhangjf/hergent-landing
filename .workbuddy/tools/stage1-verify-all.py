#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 · 演示数据验收入口（**显式注册，不自动扫描**）

🔴 纪律：本仓 `/usr/bin/python3` 下的 `*.py` 工具**不会**被任何 runner 自动发现。
   新增验证脚本必须在这张 `STEPS` 表里显式登记，否则会「永远不执行却全绿」。

用法：/usr/bin/python3 .workbuddy/tools/stage1-verify-all.py
退出码：0 = 全部步全绿；2 = 有步骤失败（打印失败步骤与日志尾部）。
"""
import re
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
PY = sys.executable

# 顺序有讲究：先「补丁↔dev-src 自证」（最便宜，且防测错对象）→ 静态护栏 → 内核演示
# → 上一轮链路对照 → 对账卡。
STEPS = [
    ('补丁↔开发副本自证', 'stage1-dev-src-rebuild.py', ['--check']),
    ('库存写入点静态护栏', 'stage1-stock-write-guard.py', []),
    ('状态写入点静态护栏', 'stage1-doc-state-guard.py', []),
    ('状态机内核验收（含坏样本）', 'stage1-doc-state-verify.py', []),
    ('字段锁 + 乐观锁内核验收（含坏样本）', 'stage1-field-lock-verify.py', []),
    ('字段锁 + 乐观锁 函数级 e2e（真实 purchase_order_update）', 'stage1-field-lock-e2e.py', []),
    ('doc_versions 时间线 内核验收（含坏样本）', 'stage1-doc-versions-verify.py', []),
    ('doc_versions 时间线 函数级 e2e（真实业务函数）', 'stage1-doc-versions-e2e.py', []),
    ('统一三写演示数据验证', 'stage1-stock-movement-e2e.py', []),
    ('状态跃迁端到端（真实业务函数）', 'stage1-doc-state-e2e.py', []),
    ('链路演练 C 组（录生产日期 + 收敛版）', 'stage1-demo-e2e.py', ['--with-fix', '--prod-date']),
    ('链路演练 D 组（不录 + 收敛版）', 'stage1-demo-e2e.py', ['--with-fix']),
    ('链路演练 A 组（生产快照现状，向后兼容）', 'stage1-demo-e2e.py', []),
    ('自动对账卡坏样本自证', 'stage1-reconcile.py', ['--self-test']),
]


def main():
    results = []
    for name, script, args in STEPS:
        p = TOOLS / script
        if not p.is_file():
            print('  ❌ %-38s 脚本不存在：%s' % (name, script))
            results.append((name, 1, '脚本不存在'))
            continue
        r = subprocess.run([PY, str(p)] + args, cwd=str(TOOLS.parents[1]),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           text=True, timeout=600)
        out = r.stdout or ''
        totals = re.findall(r'合计\s*(\d+)/(\d+)\s*通过', out)
        verdict = ('%s/%s' % totals[-1]) if totals else '-'
        print('  %s %-38s exit=%s  判据=%s' %
              ('✅' if r.returncode == 0 else '❌', name, r.returncode, verdict))
        results.append((name, r.returncode, out))
    bad = [(n, rc) for n, rc, _ in results if rc != 0]
    print('\n阶段 1 验收入口：%d/%d 步通过' % (len(results) - len(bad), len(results)))
    if bad:
        for name, rc, out in results:
            if rc != 0:
                print('\n--- 失败步骤：%s (exit=%s) 日志尾部 ---' % (name, rc))
                print('\n'.join(out.splitlines()[-25:]))
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
