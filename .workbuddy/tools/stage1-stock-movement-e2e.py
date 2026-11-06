#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 1 项 · 统一库存写入口演示数据验证（**零生产写入**）

验证 `db/queries/stock_movement.py` 的「同事务三写」是不是真的：
  ① 正常链路（采购入库 + 销售发货）后，台账 / 流水 / 余额三项对得上；
  ② 同批次累加分支**也写流水**（生产现状的脱钩缺口）；
  ③ 库存不足、中途抛错时，三写**一起回滚**，不留半成品；
  ④ 余额行不覆盖 `reserved_qty`（预留量是 reserve.py 的地盘）；
  ⑤ 四种脏数据必须让对账判据变红（防止「怎么查都绿」的空白支票）。

沙箱复用 `stage1-demo-e2e.py` 的副本库 + 源码副本，硬断言不指向生产。
用法：/usr/bin/python3 .workbuddy/tools/stage1-stock-movement-e2e.py
退出码：0 = 全通过；2 = 有判据未通过；1 = 环境/依赖错误。
"""
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / '.workbuddy/tools'


def load_demo():
    spec = importlib.util.spec_from_file_location(
        'stage1_demo_e2e', TOOLS / 'stage1-demo-e2e.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def triple(db, pid, wh):
    """三写可读快照，用于「失败前后必须逐字相同」的原子性断言。"""
    q = lambda sql, p_: db.execute(sql, p_).fetchone()[0]
    bal = db.execute(
        "SELECT actual_qty,stock_value,reserved_qty FROM inventory_balance "
        "WHERE product_id=? AND warehouse_id=?", (pid, wh)).fetchone()
    return {
        'inv_qty': q("SELECT COALESCE(SUM(quantity),0) FROM inventory WHERE product_id=? AND warehouse_id=?", (pid, wh)),
        'log_qty': q("SELECT COALESCE(SUM(change_qty),0) FROM inventory_logs WHERE product_id=? AND warehouse_id=?", (pid, wh)),
        'log_cnt': q("SELECT COUNT(*) FROM inventory_logs WHERE product_id=? AND warehouse_id=?", (pid, wh)),
        'bal_qty': (bal[0] if bal else None),
        'bal_val': (bal[1] if bal else None),
        'reserved': (bal[2] if bal else None),
    }


def main():
    demo = load_demo()
    demo.build_sandbox(reset=True, with_fix=True)

    os.environ['ERP_DB_PATH'] = str(demo.DB)
    os.environ.setdefault('ERP_SECRET', 'stage1-demo-only-not-a-secret')
    os.environ.setdefault('DEEPSEEK_API_KEY', 'stage1-demo-dummy-never-used')
    sys.path.insert(0, str(demo.SRC))

    try:
        from db.queries.stock_movement import write_stock_movement, assert_triple_in_sync
        from db.queries.purchases import purchase_order_create, purchase_order_confirm
        from db.queries.sales import sale_order_create, sale_order_deliver
        from db.queries.inventory import batch_in
        import db.connection as conn
    except Exception as e:
        print('[import] ❌ 后端模块 import 失败：%s' % e, flush=True)
        import traceback
        traceback.print_exc()
        return 1
    assert '/opt/hergent-erp' not in str(demo.DB), '拒绝：库路径指向生产'
    assert Path(conn.DB_PATH).resolve() == demo.DB.resolve(), '拒绝：DB_PATH 未指向副本库'
    print('[env] ERP_DB_PATH=%s（副本）' % demo.DB, flush=True)

    pid, sid, cid, wh = demo.seed_demo()
    checks = []

    def add(name, ok, detail=''):
        checks.append((name, bool(ok), str(detail)))

    # ── ① 正常链路：采购入库 → 销售发货 ──────────────────────────
    today = date.today()
    expiry = (today + timedelta(days=20)).isoformat()
    batch = 'SM%sA' % today.strftime('%Y%m%d')
    po = purchase_order_create(
        sid, [{'product_id': pid, 'quantity': 12, 'unit_price': 10.0,
               'unit': '件', 'batch_no': batch, 'expiry_date': expiry}],
        warehouse_id=wh, status='draft', note='阶段1-写入点收敛演示', operator_id='demo')
    ok_po = bool(po and 'order_id' in po)
    add('建采购单成功', ok_po, str(po)[:120])
    if not ok_po:
        return finish(demo, checks, pid, wh)

    purchase_order_confirm(po['order_id'], operator_id='demo')
    c = demo.connect()
    r1 = assert_triple_in_sync(c, pid, wh)
    c.close()
    add('入库后三项对账全绿', r1['ok'],
        '；'.join('%s=%s' % (x['name'], x['ok']) for x in r1['checks']))
    add('入库后余额行已接线', r1['balance_qty'] is not None,
        'actual_qty=%s' % r1['balance_qty'])

    so = sale_order_create(
        cid, [{'product_id': pid, 'quantity': 5, 'unit_price': 15.0, 'unit': '件'}],
        warehouse_id=wh, status='draft', skip_credit_check=True,
        note='阶段1-写入点收敛演示', operator_id='demo')
    ok_so = bool(so and 'order_id' in so)
    add('建销售单成功', ok_so, str(so)[:120])
    if ok_so:
        sale_order_deliver(so['order_id'])
    c = demo.connect()
    r2 = assert_triple_in_sync(c, pid, wh)
    c.close()
    add('发货后三项对账全绿', r2['ok'],
        '；'.join('%s=%s' % (x['name'], x['ok']) for x in r2['checks']))
    add('发货后台账数量下降', r2['inventory_qty'] < r1['inventory_qty'],
        '%.2f → %.2f' % (r1['inventory_qty'], r2['inventory_qty']))

    # 流水链自洽：before + change = after
    c = demo.connect()
    broken = c.execute(
        "SELECT COUNT(*) FROM inventory_logs WHERE product_id=? AND warehouse_id=? "
        "AND ABS((before_qty+change_qty)-after_qty)>0.0001", (pid, wh)).fetchone()[0]
    c.close()
    add('流水链自洽（前值+变动=后值）', broken == 0, '断裂 %d 条' % broken)

    # ── ② 同批次累加分支也写流水（原本的静默脱钩点）────────────
    c = demo.connect()
    before_acc = triple(c, pid, wh)
    c.close()
    batch_in(pid, wh, 3, cost_price=10.0, batch_no='SM-ACC', db_conn=None)
    batch_in(pid, wh, 4, cost_price=10.0, batch_no='SM-ACC', db_conn=None)
    c = demo.connect()
    after_acc = triple(c, pid, wh)
    r3 = assert_triple_in_sync(c, pid, wh)
    c.close()
    add('同批次累加写出 2 条流水', after_acc['log_cnt'] - before_acc['log_cnt'] == 2,
        '%d → %d 条' % (before_acc['log_cnt'], after_acc['log_cnt']))
    add('同批次累加后台账 +7', abs((after_acc['inv_qty'] - before_acc['inv_qty']) - 7) < 0.0001,
        '%.2f → %.2f' % (before_acc['inv_qty'], after_acc['inv_qty']))
    add('同批次累加后余额同步 +7',
        after_acc['bal_qty'] is not None and
        abs((after_acc['bal_qty'] - before_acc['bal_qty']) - 7) < 0.0001,
        '%s → %s' % (before_acc['bal_qty'], after_acc['bal_qty']))
    add('累加后三项对账仍全绿', r3['ok'],
        '；'.join('%s=%s' % (x['name'], x['ok']) for x in r3['checks']))

    # ── ③ 失败时三写一起回滚 ──────────────────────────────────
    c = demo.connect()
    rows = c.execute(
        "SELECT id FROM inventory WHERE product_id=? AND warehouse_id=? ORDER BY id LIMIT 1",
        (pid, wh)).fetchall()
    row_id = rows[0][0] if rows else None
    c.close()

    # 3a 库存不足：返回 error，且台账/流水/余额都没动
    db1 = demo.connect()
    b1 = triple(db1, pid, wh)
    rv = write_stock_movement(
        db1, product_id=pid, warehouse_id=wh, delta_qty=-99999,
        row_id=row_id, change_type='shortage_probe', allow_negative=False)
    a1 = triple(db1, pid, wh)
    db1.rollback()
    db1.close()
    add('库存不足返回中文 error', bool(rv.get('error')), str(rv)[:120])
    add('库存不足时三写均未落地', b1 == a1,
        'before=%s after=%s' % (b1, a1))

    # 3b 中途抛错：在流水表上挂一个必失败触发器，台账已写也必须一起回滚
    ctl = demo.connect()
    ctl.execute("CREATE TRIGGER stage1_fail_log BEFORE INSERT ON inventory_logs "
                "BEGIN SELECT RAISE(ABORT, 'forced stage1 atomicity failure'); END")
    ctl.commit()
    db2 = demo.connect()
    b2 = triple(db2, pid, wh)
    raised = False
    try:
        write_stock_movement(
            db2, product_id=pid, warehouse_id=wh, delta_qty=2,
            row_id=row_id, change_type='atomicity_probe')
    except Exception:
        raised = True
    a2 = triple(db2, pid, wh)
    db2.rollback()
    db2.close()
    ctl.execute("DROP TRIGGER stage1_fail_log")
    ctl.commit()
    ctl.close()
    add('写流水失败确实抛异常', raised, 'raised=%s' % raised)
    add('中途抛错三写全回滚', raised and b2 == a2,
        'before=%s after=%s' % (b2, a2))

    # ── ④ 余额行不覆盖预留量 ──────────────────────────────────
    ctl = demo.connect()
    ctl.execute("UPDATE inventory_balance SET reserved_qty=3 "
                "WHERE product_id=? AND warehouse_id=?", (pid, wh))
    ctl.commit()
    ctl.close()
    db3 = demo.connect()
    write_stock_movement(db3, product_id=pid, warehouse_id=wh, delta_qty=1,
                         row_id=row_id, change_type='reserved_probe')
    db3.commit()
    reserved = db3.execute(
        "SELECT reserved_qty FROM inventory_balance WHERE product_id=? AND warehouse_id=?",
        (pid, wh)).fetchone()[0]
    r4 = assert_triple_in_sync(db3, pid, wh)
    db3.close()
    add('统一入口不覆盖 reserved_qty', abs(float(reserved) - 3) < 0.0001,
        'reserved_qty=%s' % reserved)
    add('预留量探针后对账仍全绿', r4['ok'],
        '；'.join('%s=%s' % (x['name'], x['ok']) for x in r4['checks']))

    # ── ⑤ 坏样本自证：四种脏数据必须判红 ──────────────────────
    fixture = demo.SAND / 'guard-fixture.db'
    corruption = {
        '只改台账 +3 不写流水':
            "UPDATE inventory SET quantity=quantity+3 WHERE product_id=? AND warehouse_id=?",
        '只改余额 +3':
            "UPDATE inventory_balance SET actual_qty=actual_qty+3 WHERE product_id=? AND warehouse_id=?",
        '删掉一条流水':
            "DELETE FROM inventory_logs WHERE id=(SELECT MIN(id) FROM inventory_logs "
            "WHERE product_id=? AND warehouse_id=?)",
        '删掉余额行':
            "DELETE FROM inventory_balance WHERE product_id=? AND warehouse_id=?",
    }
    for name, sql in corruption.items():
        shutil.copy2(demo.DB, fixture)
        fc = sqlite3.connect(fixture)
        fc.execute(sql, (pid, wh))
        fc.commit()
        rr = assert_triple_in_sync(fc, pid, wh)
        fc.close()
        add('坏样本判红：' + name, not rr['ok'],
            '判为绿即失去判别力；实际=%s' % rr['ok'])
    fixture.unlink(missing_ok=True)

    return finish(demo, checks, pid, wh)


def finish(demo, checks, pid, wh):
    print('\n' + '=' * 76)
    print('阶段 1 第 1 项 · 统一库存写入口演示数据判定')
    print('=' * 76)
    for name, ok, detail in checks:
        print('  %s %-34s %s' % ('✅' if ok else '❌', name, detail))
    passed = sum(1 for _, ok, _ in checks if ok)
    print('\n合计 %d/%d 通过' % (passed, len(checks)))
    report = {
        'generated_at': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
        'product_id': pid, 'warehouse_id': wh,
        'checks': [{'name': n, 'ok': bool(o), 'detail': d} for n, o, d in checks],
        'passed': passed, 'total': len(checks),
    }
    (demo.SAND / 'stock-movement-e2e-result.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('[out] %s' % (demo.SAND / 'stock-movement-e2e-result.json'))
    return 0 if passed == len(checks) else 2


if __name__ == '__main__':
    sys.exit(main())
