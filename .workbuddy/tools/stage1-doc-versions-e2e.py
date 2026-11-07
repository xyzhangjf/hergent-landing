#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 5 项 · C 函数级 e2e（**零生产写入**，本地副本沙箱）

搭真实业务函数链路验证 doc_versions 时间线：
  ① `purchase_order_create` 建单 → 写一条 `create` 版本（状态线第一条）；
  ② `doc_state.set_doc_status` 改状态 → 写一条 `status_change`（对全部单据类型通用）；
  ③ `purchase_order_update_header` 改安全字段 → 写一条 `field_edit`（逐列记录）；
  ④ 时间线 3 条、version 1/2/3 升序、action/actor/fields_changed 正确；
  ⑤ `set_doc_status` 同状态（unchanged）→ 不写新版本（早返，不污染时间线）。

源码副本由 `stage1-demo-e2e.build_sandbox(with_fix=True)` 搭建（含第 5 项修改）。

用法：/usr/bin/python3 .workbuddy/tools/stage1-doc-versions-e2e.py
退出码：0 = 全通过；2 = 有判据未通过；1 = 环境/导入错误。
"""
import importlib.util
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / '.workbuddy/tools'

PASS, FAIL, N = 0, 0, 0


def ok(cond, name, detail=''):
    global PASS, FAIL, N
    N += 1
    if cond:
        PASS += 1
        print('  ✅ %s' % name)
    else:
        FAIL += 1
        print('  ❌ %s%s' % (name, ('  ← ' + detail) if detail else ''))


def load_demo():
    spec = importlib.util.spec_from_file_location(
        'stage1_demo_e2e', TOOLS / 'stage1-demo-e2e.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    demo = load_demo()
    demo.build_sandbox(reset=True, with_fix=True)

    os.environ['ERP_DB_PATH'] = str(demo.DB)
    os.environ.setdefault('ERP_SECRET', 'stage1-demo-only-not-a-secret')
    os.environ.setdefault('DEEPSEEK_API_KEY', 'stage1-demo-dummy-never-used')
    sys.path.insert(0, str(demo.SRC))

    try:
        import db.connection as conn
        from db.queries import purchases as po
        from db.queries import doc_state as ds
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('  ❌ 导入失败：%r' % e)
        return 1

    assert Path(conn.DB_PATH).resolve() == demo.DB.resolve(), '拒绝：DB_PATH 未指向副本库'

    # 最小数据（与字段锁 e2e 同口径）
    c = sqlite3.connect(demo.DB)
    c.executescript("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY, name TEXT, unit TEXT, medium_unit TEXT,
            large_unit TEXT, medium_ratio REAL, large_ratio REAL, order_unit TEXT
        );
        CREATE TABLE IF NOT EXISTS purchase_order_items (
            order_id INTEGER, product_id INTEGER, quantity REAL, unit_price REAL,
            amount REAL, unit TEXT, base_ratio REAL, base_qty REAL
        );
    """)
    if not c.execute("SELECT 1 FROM products WHERE id=1").fetchone():
        c.execute("INSERT INTO products VALUES (1,'测试商品','箱','瓶','件',0.1,0.01,'箱')")
    if not c.execute("SELECT 1 FROM warehouses WHERE id=2").fetchone():
        c.execute("INSERT INTO warehouses (id, name) VALUES (2,'演示仓B')")
    c.commit(); c.close()

    # ① 建单（带 order_no + status 减少外围依赖，专测 create 钩子）
    r1 = po.purchase_order_create(
        supplier_id=2, items=[{'product_id': 1, 'quantity': 10, 'unit_price': 5, 'unit': '箱'}],
        warehouse_id=1, operator_id='alice', order_no='DV-1', status='draft')
    ok(r1.get('order_id'), '① purchase_order_create 建单成功', repr(r1))
    oid = r1['order_id']

    # ② 改状态（draft → pending_approval），走 set_doc_status 通用钩子
    c = sqlite3.connect(demo.DB)
    res = ds.set_doc_status(c, 'purchase_order', oid, 'pending_approval', operator_id='bob')
    c.commit(); c.close()
    ok(res.get('to') == 'pending_approval', '② set_doc_status 改状态成功', repr(res))

    # ③ 改安全字段（note），走 update_header 钩子
    r3 = po.purchase_order_update_header(oid, note='改了备注', operator_id='carol',
                                        expected_status='pending_approval')
    ok(r3.get('success') is True, '③ purchase_order_update_header 改备注成功', repr(r3))

    # ④ 时间线：3 条、version 升序、action 正确
    c = sqlite3.connect(demo.DB)
    c.row_factory = sqlite3.Row
    tl = ds.doc_version_timeline(c, 'purchase_order', oid)
    ok(len(tl) == 3, '④ 时间线共 3 条', repr(len(tl)))
    ok([t['version'] for t in tl] == [1, 2, 3], '④ version 升序 1/2/3', repr([t['version'] for t in tl]))
    ok(tl[0]['action'] == 'create' and tl[0]['status_to'] == 'draft', '④ ①=create(draft)')
    ok(tl[1]['action'] == 'status_change' and tl[1]['status_from'] == 'draft'
       and tl[1]['status_to'] == 'pending_approval', '④ ②=status_change(draft→pending_approval)')
    ok(tl[2]['action'] == 'field_edit' and tl[2]['actor'] == 'carol'
       and 'note' in (tl[2]['fields_changed'] or []), '④ ③=field_edit(note, by carol)')
    c.close()

    # ⑤ unchanged 不写新版本：同状态再调 set_doc_status 应早返
    c = sqlite3.connect(demo.DB)
    before = c.execute("SELECT COUNT(*) FROM doc_versions WHERE doc_type='purchase_order' "
                       "AND doc_id=?", (oid,)).fetchone()[0]
    res2 = ds.set_doc_status(c, 'purchase_order', oid, 'pending_approval', operator_id='bob')
    c.commit(); c.close()
    ok(res2.get('unchanged') is True, '⑤ 同状态 set_doc_status 早返 unchanged', repr(res2))
    c = sqlite3.connect(demo.DB)
    after = c.execute("SELECT COUNT(*) FROM doc_versions WHERE doc_type='purchase_order' "
                      "AND doc_id=?", (oid,)).fetchone()[0]
    c.close()
    ok(after == before, '⑤ unchanged 不新增版本行', 'before=%s after=%s' % (before, after))

    print('\n合计 %d/%d 通过' % (PASS, N))
    return 0 if FAIL == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
