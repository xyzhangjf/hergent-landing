#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 1 项 · 库存写入点静态护栏（只读，不改任何仓）

防的是「收敛完以后，又有人新写一处裸 `UPDATE inventory` 把账弄脱钩」。

判据分三层，刻意做成**三态**，避免空白支票：
  A. 生产快照必须扫出**足够多**的裸写点（15～60 处）—— 正则抽空集也算失败；
     并抽出 `batch_in` 累加分支，证明它当年确实「改了台账就 return、没写流水」。
  B. 收敛后的开发副本里，带数量的裸写必须**恰好 0 处**（统一内核除外）；
     只改库位/批号/效期的元数据 UPDATE 走显式白名单。
  C. 统一内核必须三写齐全 + SAVEPOINT 原子回滚 + 参数顺序正确。

再用 4 种坏样本把文件改坏，断言护栏**必须判红**（自证有判别力，不是恒绿）。
样本全部造在临时副本里，绝不碰真实开发副本。

用法：/usr/bin/python3 .workbuddy/tools/stage1-stock-write-guard.py
退出码：0 = 全绿；2 = 有判据未通过；1 = 环境错误。
"""
import ast
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAP = ROOT / '.workbuddy/stage0/prod-src-20261106'
DEV = ROOT / '.workbuddy/stage1/dev-src'
KERNEL_REL = 'db/queries/stock_movement.py'

# 只看「运行时会真的改库存数量」的文件；迁移、测试 harness、备份、种子脚本一律排除。
RUNTIME = (
    'erp_db.py', 'sync_writer.py', 'domain/wastage_tracker.py',
    'db/queries/inventory.py', 'db/queries/purchases.py',
    'db/queries/sales.py', 'routers/forecast_config.py',
)
EXCLUDE_PARTS = ('/tools/', '/migrations/', '.bak', 'seed_demo.py')

QTY_UPDATE = re.compile(r'UPDATE\s+inventory\s+SET\s+(.+)', re.I | re.S)
QTY_INSERT = re.compile(r'INSERT\s+INTO\s+inventory\s*\(', re.I)
META_ONLY = re.compile(
    r'^UPDATE\s+inventory\s+SET\s+(location_id|bin_location|batch_no|expiry_date)\s*=', re.I)


def sql_strings(path):
    """只从 Python 字符串常量里取 SQL —— 注释里抄旧代码不会自撞（历史踩过）。"""
    try:
        tree = ast.parse(path.read_text(encoding='utf-8'))
    except (SyntaxError, UnicodeDecodeError) as e:
        return [(-1, 'PARSE_ERROR:' + str(e))]
    return [(n.lineno, n.value) for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def qty_writes(base, rel):
    """返回该文件里所有「改数量的裸写」(行号, SQL摘要)。"""
    p = base / rel
    if not p.is_file():
        return []
    out = []
    for lineno, s in sql_strings(p):
        flat = ' '.join(s.split())
        if flat.startswith('PARSE_ERROR:'):
            out.append((lineno, flat))
            continue
        if QTY_UPDATE.match(flat):
            if META_ONLY.match(flat):
                continue                       # 库位/批号/效期元数据，白名单
            if re.search(r'\b(quantity|stock_value)\b', flat, re.I):
                out.append((lineno, flat[:110]))
        elif QTY_INSERT.match(flat):
            # 预报配置补录批次号时顺带建一条 quantity=0 的空行，不改库存数量
            if 'forecast_config' in rel:
                continue
            if re.search(r'\bquantity\b', flat, re.I):
                out.append((lineno, flat[:110]))
    return out


def count_all(base, skip_kernel=True):
    total = 0
    detail = {}
    for rel in RUNTIME:
        if skip_kernel and rel == KERNEL_REL:
            continue
        p = base / rel
        if not p.is_file() or any(x in rel for x in EXCLUDE_PARTS):
            continue
        n = qty_writes(base, rel)
        if n:
            detail[rel] = n
            total += len(n)
    # 开发副本里可能出现 RUNTIME 之外的新文件，也一并扫（只扫 .py）
    if base == DEV:
        for p in sorted(base.rglob('*.py')):
            rel = str(p.relative_to(base))
            if rel in RUNTIME or rel == KERNEL_REL:
                continue
            if any(x in ('/' + rel) for x in EXCLUDE_PARTS):
                continue
            n = qty_writes(base, rel)
            if n:
                detail[rel] = n
                total += len(n)
    return total, detail


def kernel_checks(kernel_path):
    """统一内核自身的三写 / 原子性 / 参数顺序判据。"""
    if not kernel_path.is_file():
        return [('统一内核文件存在', False, '缺 ' + str(kernel_path))]
    src = kernel_path.read_text(encoding='utf-8')
    # 🔴 判据必须落在 `write_stock_movement` **函数体内**：扫整份文件会被
    #   `rebuild_balances` 里的另一处 INSERT 顶成恒绿（坏样本实测抓到这个漏洞）。
    m = re.search(r'^def write_stock_movement\b.*?(?=^def assert_triple_in_sync\b)',
                  src, re.S | re.M)
    body = m.group(0) if m else ''
    checks = [
        ('抽得到统一写入函数体', bool(body), '%d 字符' % len(body)),
        ('内核写台账数量', bool(re.search(r'UPDATE\s+inventory\s+SET\s+quantity=', body, re.I)), ''),
        ('内核追加流水', 'INSERT INTO inventory_logs ' in body,
         '坏样本改成 inventory_logs_DISABLED 也必须判红'),
        ('内核滚动余额快照', '_upsert_balance(db, product_id, warehouse_id)' in body
         and 'ON CONFLICT(product_id,warehouse_id)' in src, ''),
        ('内核用 SAVEPOINT', all(x in body for x in ('SAVEPOINT ', 'ROLLBACK TO ', 'RELEASE ')), ''),
        ('UPSERT 不覆盖预留量', 'reserved_qty=excluded' not in src
         and 'reserved_qty, in_transit_qty' not in src.replace(' ', ''), ''),
        ('扣减参数顺序按 SQL 占位符对齐',
         bool(re.search(r'params\s*=\s*\[after,\s*new_cp,\s*sv_after,\s*inv_id\]', src)),
         '曾把守卫值排在 inv_id 前，导致发货只写流水不扣台账'),
        ('余额按台账实时 SUM 派生', 'SUM(quantity)' in src and 'SUM(quantity * COALESCE(cost_price,0))' in src, ''),
    ]
    return [(n, ok, d) for n, ok, d in checks]


def batch_in_gap(src_path):
    """证明生产快照里 `batch_in` 的累加分支当年「改台账就 return、不写流水」。"""
    if not src_path.is_file():
        return False, '生产快照 inventory.py 不存在'
    src = src_path.read_text(encoding='utf-8')
    m = re.search(r'^def batch_in\b.*?(?=^def batch_out_fefo\b)', src, re.S | re.M)
    if not m:
        return False, '抽不到 batch_in 函数体'
    body = m.group(0)
    acc = re.search(r'if existing:.*?action.?: .updated.\}', body, re.S)
    if not acc:
        return False, '抽不到累加分支'
    return ('inventory_logs' not in acc.group(0),
           '累加分支长度 %d 字符，含流水写入=%s'
           % (len(acc.group(0)), 'inventory_logs' in acc.group(0)))


def evaluate(base, with_baseline=True):
    """对一份源码树跑全部静态判据，返回 (checks, ok)。"""
    checks = []
    if with_baseline:
        n, detail = count_all(SNAP, skip_kernel=True)
        checks.append(('生产快照扫出足够多裸写点（15～60，防正则抽空集）',
                       15 <= n <= 60, '实际 %d 处；文件=%s' % (n, sorted(detail))))
        gap, why = batch_in_gap(SNAP / 'db/queries/inventory.py')
        checks.append(('坐实 batch_in 累加分支当年不写流水', gap, why))

    n2, detail2 = count_all(base, skip_kernel=True)
    checks.append(('收敛后运行时带数量裸写恰好 0 处', n2 == 0,
                   '实际 %d 处；命中=%s' % (n2, json.dumps(detail2, ensure_ascii=False)[:300])))

    checks.extend(kernel_checks(base / KERNEL_REL))
    return checks, all(ok for _, ok, _ in checks)


def corrupt(base, kind):
    """在临时副本里造一种坏改动。"""
    if kind == 'inject_raw_write':
        p = base / 'erp_db.py'
        s = p.read_text(encoding='utf-8')
        s += '\n\ndef _stage1_bad_raw_write(db):\n    db.execute("UPDATE inventory SET quantity=quantity+1 WHERE id=1")\n'
        p.write_text(s, encoding='utf-8')
    elif kind == 'drop_log_write':
        p = base / KERNEL_REL
        s = p.read_text(encoding='utf-8')
        s = s.replace('"INSERT INTO inventory_logs "', '"INSERT INTO inventory_logs_DISABLED "')
        p.write_text(s, encoding='utf-8')
    elif kind == 'drop_balance':
        p = base / KERNEL_REL
        s = p.read_text(encoding='utf-8')
        s = s.replace('        _upsert_balance(db, product_id, warehouse_id)',
                      '        pass  # balance disabled')
        p.write_text(s, encoding='utf-8')
    elif kind == 'bad_param_order':
        p = base / KERNEL_REL
        s = p.read_text(encoding='utf-8')
        s = s.replace('params = [after, new_cp, sv_after, inv_id]',
                      'params = [after, new_cp, sv_after, -change, inv_id]')
        p.write_text(s, encoding='utf-8')


BAD_SAMPLES = {
    '新增一处裸 UPDATE inventory 数量': 'inject_raw_write',
    '内核不写流水': 'drop_log_write',
    '内核不更新余额': 'drop_balance',
    '扣减参数顺序被打乱': 'bad_param_order',
}


def main():
    checks, ok = evaluate(DEV, with_baseline=True)
    for name, bad_kind in BAD_SAMPLES.items():
        with tempfile.TemporaryDirectory(prefix='stage1-guard-') as td:
            tmp = Path(td) / 'dev-src'
            shutil.copytree(DEV, tmp, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            corrupt(tmp, bad_kind)
            _, still_ok = evaluate(tmp, with_baseline=False)
            checks.append(('坏样本判红：' + name, not still_ok,
                           '改坏后仍判绿 = 护栏失去判别力'))

    print('=' * 76)
    print('阶段 1 第 1 项 · 库存写入点静态护栏')
    print('=' * 76)
    for name, good, detail in checks:
        print('  %s %-42s %s' % ('✅' if good else '❌', name, detail))
    passed = sum(1 for _, good, _ in checks if good)
    print('\n合计 %d/%d 通过' % (passed, len(checks)))
    if '--json' in sys.argv:
        print(json.dumps({'checks': [{'name': n, 'ok': bool(o), 'detail': d}
                                     for n, o, d in checks],
                          'passed': passed, 'total': len(checks)},
                         ensure_ascii=False, indent=2))
    return 0 if passed == len(checks) else 2


if __name__ == '__main__':
    sys.exit(main())
