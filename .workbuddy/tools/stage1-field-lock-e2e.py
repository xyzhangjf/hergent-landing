#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 4 项 · 字段锁 + 乐观锁 函数级 e2e（**零生产写入**，本地副本沙箱）

直接调真实业务函数 `purchase_order_update` / `purchase_order_update_header`，验证：
  ① 草稿态整单编辑正常生效；
  ② 提交后（pending_approval）整单编辑被字段锁拦下；
  ③ 乐观锁：客户端带旧令牌（expected_status 与库里不一致）→ 整单编辑被拦「已被他人改」；
  ④ 已入库态 update_header 改备注放行、改仓库拦截。

源码副本由 `stage1-demo-e2e.build_sandbox(with_fix=True)` 搭建（本地 dev-src 覆盖到快照上），
库是本地 erp.db 的副本 —— 不碰生产。

用法：/usr/bin/python3 .workbuddy/tools/stage1-field-lock-e2e.py
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
    demo.build_sandbox(reset=True, with_fix=True)  # 含第 4 项修改的完整源码副本

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

    # 自备最小数据（副本库是本地开发库拷贝，可能缺 products / items 表或行）
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
    # 清理并写入测试采购单
    c.execute("DELETE FROM purchase_orders WHERE id=90001")
    c.execute("DELETE FROM purchase_order_items WHERE order_id=90001")
    c.execute("INSERT INTO purchase_orders (id, order_no, status, supplier_id, warehouse_id, "
              "total_amount, order_date, note, handler, department_id, mark, extra_json) "
              "VALUES (90001,'DEMO-90001','draft',2,1,0,'2026-11-07','','',0,'','{}')")
    c.commit()
    c.close()

    ITEMS = [{'product_id': 1, 'quantity': 10, 'unit_price': 5, 'unit': '箱'}]

    # ① 草稿态整单编辑正常
    r1 = po.purchase_order_update(90001, supplier_id=2, items=ITEMS, warehouse_id=1,
                                  order_date='2026-11-07')
    ok(r1.get('ok') is True, '① 草稿态整单编辑生效', repr(r1))
    c = sqlite3.connect(demo.DB)
    ok(c.execute("SELECT supplier_id FROM purchase_orders WHERE id=90001").fetchone()[0] == 2,
       '① 表头 supplier_id 已写入')
    c.close()

    # ② 提交后（pending_approval）整单编辑被字段锁拦
    c = sqlite3.connect(demo.DB)
    c.execute("UPDATE purchase_orders SET status='pending_approval' WHERE id=90001")
    c.commit(); c.close()
    r2 = po.purchase_order_update(90001, supplier_id=3, items=ITEMS, warehouse_id=1)
    ok(r2.get('ok') is False and '不能整单编辑' in r2.get('error', ''),
       '② 待审批态整单编辑被字段锁拦下', repr(r2))

    # ③ 乐观锁：把状态设回 draft（满相位才走得到 UPDATE），客户端带旧令牌 pending_approval
    #    ⇒ UPDATE … WHERE id=? AND status='pending_approval' 与库里 draft 不符 → rowcount=0。
    c = sqlite3.connect(demo.DB)
    c.execute("UPDATE purchase_orders SET status='draft' WHERE id=90001")
    c.commit(); c.close()
    r3 = po.purchase_order_update(90001, supplier_id=3, items=ITEMS, warehouse_id=1,
                                  expected_status='pending_approval')
    ok(r3.get('ok') is False and '刚被别人改过状态' in r3.get('error', ''),
       '③ 乐观锁：令牌过期被拦「已被他人改」', repr(r3))

    # ④ 已入库态 update_header：改备注放行、改仓库拦截
    c = sqlite3.connect(demo.DB)
    c.execute("UPDATE purchase_orders SET status='received', warehouse_id=1 WHERE id=90001")
    c.commit(); c.close()
    r4 = po.purchase_order_update_header(90001, note='入库后补备注', expected_status='received')
    ok(r4.get('success') is True, '④ 已入库改备注放行', repr(r4))
    r5 = po.purchase_order_update_header(90001, warehouse_id=2, expected_status='received')
    ok(r5.get('success') is not True and '已经入库' in r5.get('error', ''),
       '④ 已入库改仓库被拦', repr(r5))

    # 顺带确认 doc_state 字段锁单一源对采购单的相位判定（与内核脚本交叉印证）
    ok(ds._phase('purchase_order', 'pending_approval') == 'submitted', '⑤ 单一源相位：待审批→submitted')

    print('\n合计 %d/%d 通过' % (PASS, N))
    return 0 if FAIL == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
