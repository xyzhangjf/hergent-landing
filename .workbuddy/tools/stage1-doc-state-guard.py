#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 3 项 · 状态写入静态护栏

`doc_state` 只解决「规则在哪」；这份护栏解决「有没有人绕开它」。

判据：
  1. 5 张单据表的每一处 `UPDATE … SET … status='x'`，必须**带来源守卫**
     （`guard_sql()` 产出、手写 `status IN (…)`、`status='x'` 条件、或
     `WHERE id=? AND status=?` 的乐观锁形态）；
  2. 确实拿不出通用守卫的写入点，必须登记在 `EXEMPT` 里并写明理由 ——
     **登记项必须仍然存在**，否则是过期借口（删了代码却留着豁免，未来新代码会蹭它）；
  3. 全仓不得再出现英文 `Invalid state transition`（那是第二套状态机的残迹）；
  4. 写业务表状态的四个入口文件都必须从 `doc_state` 取规则。

用法：/usr/bin/python3 .workbuddy/tools/stage1-doc-state-guard.py
退出码：0 = 通过；2 = 有违规。
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / '.workbuddy/stage1/dev-src'

TARGETS = {
    'purchase_orders': 'purchase_order',
    'sale_orders': 'sale_order',
    'transfer_orders': 'transfer_order',
    'purchase_returns': 'purchase_return',
    'return_orders': 'return_order',
}
# 独立 status 列（不能匹配 delivery_status / invoice_status / approval_status）
ST = r'(?<![_A-Za-z])status'

# 豁免**不写在这里**，而是写在代码的 UPDATE 上方：
#     # doc-state-exempt: 理由
# 🔴 为什么不做成脚本里的表：表是「行号/函数名」定位，改一次代码就失效，
#    失效后要么逼人删理由（下次再裸写就无记录），要么变成一句永远对的空话。
#    标记跟着代码走：代码删了标记一起没，不会过期。
EXEMPT_MARK = 'doc-state-exempt:'

violations = []
checked = 0
found_exempt = set()


def func_of(lines, idx):
    for j in range(idx, -1, -1):
        m = re.match(r'\s*(?:async\s+)?def\s+(\w+)', lines[j])
        if m:
            return m.group(1)
    return '?'


def _doc_lines(path):
    """返回所有 docstring 占用的行号集合。

    🔴 必须剥掉：本仓的注释里大量引用旧 SQL（「原写法是 `UPDATE … SET status='cancelled'`」），
       不剥就会把**讲解文字**当违规，最后只能靠往豁免表里堆借口来消音 —— 那等于没有护栏。
    """
    try:
        tree = ast.parse(path.read_text(encoding='utf-8', errors='ignore'))
    except SyntaxError:
        return set()
    spans = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, 'body', None)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                a = body[0].lineno
                b = getattr(body[0], 'end_lineno', a)
                spans.update(range(a, b + 1))
    return spans


def scan(path):
    global checked
    rel = str(path.relative_to(DEV))
    lines = path.read_text(encoding='utf-8', errors='ignore').split('\n')
    docs = _doc_lines(path)
    for i, ln in enumerate(lines):
        if (i + 1) in docs or ln.strip().startswith('#'):
            continue
        for table, dtype in TARGETS.items():
            if not re.search(r'UPDATE\s+' + table + r'\b', ln, re.I):
                continue
            # 往后找本条语句的结束：**遇到下一个 UPDATE 就截断**，否则相邻语句里的
            # `status='voided'` 会被当成本条语句的守卫（实测误判过 rollback_ai_operation）。
            end = min(len(lines), i + 22)
            for k in range(i + 1, end):
                if re.search(r'\bUPDATE\s+\w+', lines[k], re.I):
                    end = k
                    break
            win = '\n'.join(lines[max(0, i - 4):end])
            # ⚠️ 目标状态只从**本语句**（i 起）的 SET 段取：往前 4 行只是为了看守卫，
            # 若把它们也算进来，上一条语句的 WHERE 会污染 SET 段（实测导致漏扫）。
            setpart = '\n'.join(lines[i:end]).split('WHERE')[0]
            tos = re.findall(ST + r"\s*=\s*'([a-z_]+)'", setpart, re.I)
            if not tos:
                continue                      # 不动 status 的 UPDATE
            checked += 1
            fn = func_of(lines, i)
            # WHERE 也只取本语句（i 起）—— 连带前 4 行会让上一条语句的
            # `status='voided'` 冒充本条的守卫（实测漏判过 rollback_ai_operation）。
            _own = '\n'.join(lines[i:end])
            where = _own.split('WHERE', 1)[1] if 'WHERE' in _own else ''
            guarded = (
                re.search(r'\b(_?g\w*sql|guard_sql)\(', win)   # guard_sql / _gsql 别名
                or re.search(ST + r'\s+IN\s*\(', where, re.I)
                or re.search(ST + r"\s*=\s*'[a-z_]+'", where, re.I)
                or re.search(ST + r'\s*=\s*\?', where, re.I)
            )
            key = (rel, i + 1, tos[0])
            if EXEMPT_MARK in win:
                found_exempt.add(key)
                continue
            if guarded:
                continue
            violations.append('%s:%d  %s → %s  无来源守卫' % (rel, i + 1, fn, ','.join(tos)))


def main():
    files = sorted(list(DEV.glob('db/queries/*.py')) + list(DEV.glob('*.py'))
                   + list(DEV.glob('domain/*.py')))
    if not files:
        print('❌ 沙箱里没有源码：%s' % DEV)
        return 2
    for f in files:
        if f.name.startswith('__') or f.name == 'doc_state.py':
            continue        # doc_state 自己的 docstring 里就是规则说明与用法示例
        scan(f)

    print('扫描 %d 个文件，%d 处状态写入' % (len(files), checked))

    bad = list(violations)

    # 判据 2：豁免标记必须写明理由（光写标记不算）
    for f in files:
        for i, ln in enumerate(f.read_text(encoding='utf-8', errors='ignore').split('\n'), 1):
            if EXEMPT_MARK in ln and len(ln.split(EXEMPT_MARK, 1)[1].strip()) < 6:
                bad.append('%s:%d 豁免标记没写理由' % (f.relative_to(DEV), i))

    # 判据 3：英文报错残迹（剥掉 docstring —— 那里可能引用旧报错说明背景）
    for f in files:
        lines = f.read_text(encoding='utf-8', errors='ignore').split('\n')
        docs = _doc_lines(f)
        for i, ln in enumerate(lines):
            if (i + 1) in docs or ln.strip().startswith('#'):
                continue
            if 'Invalid state transition' in ln:
                bad.append('%s:%d 仍有英文报错 Invalid state transition'
                           % (f.relative_to(DEV), i + 1))

    # 判据 4：四个写业务表状态的入口都接上了 doc_state
    need = ['db/queries/sales.py', 'db/queries/purchases.py',
            'db/queries/approvals.py', 'server.py']
    for rel in need:
        p = DEV / rel
        if not p.is_file():
            bad.append('缺少入口文件 %s' % rel)
            continue
        txt = p.read_text(encoding='utf-8', errors='ignore')
        if 'doc_state import' not in txt:
            bad.append('%s 没有从 doc_state 取规则' % rel)

    if bad:
        print('\n合计 0/1 通过')
        print('❌ 违规 %d 条：' % len(bad))
        for b in bad:
            print('   · ' + b)
        return 2
    print('合计 1/1 通过')
    print('✅ 全部 %d 处写入都带守卫（%d 处登记为例外，理由均已记录）'
          % (checked, len(found_exempt)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
