#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 · 演示数据端到端演练（**零生产写入**）

老张 2026-11-06 拍板：开发阶段不往进销存写真实数据，改用演示数据测。
本脚本用「本地开发库副本 + 生产源码快照的查询层」跑通真实业务函数：

    purchase_order_create → purchase_order_confirm（入库确认，写批次+流水）
    sale_order_create     → sale_order_deliver   （发货，FEFO 扣减）

🔴 隔离保证（脚本内硬断言）：
  · 库 = `~/Documents/hergent-erp/server/erp.db` 的**副本**，落在
    `.workbuddy/stage1/demo-sandbox/`，每次运行重建，绝不指向生产；
  · 源码 = 本地仓 server/ 的**副本**，再用阶段 0 生产快照覆盖
    db/queries/{inventory,purchases,sales}.py（核心链路按线上版本测）；
  · 不连生产 SSH、不写生产库、不改任何现有仓的工作树。

用法：
  /usr/bin/python3 .workbuddy/tools/stage1-demo-e2e.py
  /usr/bin/python3 .workbuddy/tools/stage1-demo-e2e.py --no-reset   # 复用上次沙箱

退出码：0 = 演练全通过；2 = 有判据未通过；1 = 环境/依赖错误。
"""
import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SAND = ROOT / '.workbuddy/stage1/demo-sandbox'
SRC = SAND / 'src'
DB = SAND / 'erp.db'
LOCAL_SERVER = Path('/Users/zhangjunfeng/Documents/hergent-erp/server')
PROD_SNAP = ROOT / '.workbuddy/stage0/prod-src-20261106'
CORE_QUERIES = ('inventory.py', 'purchases.py', 'sales.py')
# 阶段 1 第 1 项新增的统一写入内核。生产快照里没有这个文件，
# 所以「现状」演练时跳过、「收敛版」(--with-fix) 演练时一并复制。
EXTRA_QUERIES = ('stock_movement.py',)

# 演示数据统一前缀：与副本里已有的开发数据一眼可分
DEMO = '演示-阶段1'


def log(tag, msg):
    print('[%s] %s' % (tag, msg), flush=True)


DEV_SRC = ROOT / '.workbuddy/stage1/dev-src/db/queries'


def build_sandbox(reset=True, with_fix=False):
    if reset and SAND.exists():
        shutil.rmtree(SAND)
    SAND.mkdir(parents=True, exist_ok=True)

    # 源码副本（排除运行时产物与数据库，避免把本地真实数据带进沙箱）
    if not SRC.exists():
        shutil.copytree(LOCAL_SERVER, SRC, ignore=shutil.ignore_patterns(
            '__pycache__', '*.pyc', '*.db', '*.db-*', '*.db-wal', '*.db-shm',
            'backups', '_backup', '_rollback', '.pytest_cache', '*.log',
            '*.png', '*.jpg', '*.xlsx', '*.pdf', '.git', 'venv', '.venv'))
    # 核心查询层总是按所选来源覆盖（生产快照 / 打了修复补丁的开发副本）
    src_queries = DEV_SRC if with_fix else PROD_SNAP / 'db/queries'
    for name in CORE_QUERIES + EXTRA_QUERIES:
        p = src_queries / name
        if name in EXTRA_QUERIES and not p.is_file():
            continue  # 未收敛版本本来就没有统一内核
        if not p.is_file():
            raise RuntimeError('查询层来源缺少 %s' % p)
        shutil.copy2(p, SRC / 'db/queries' / name)
    log('build', '源码副本就绪，db/queries 来源=%s'
        % ('修复后开发副本' if with_fix else '生产快照'))

    # 库副本（每次重建，保证基线干净）
    if reset or not DB.is_file():
        for f in LOCAL_SERVER.glob('*.db*'):
            shutil.copy2(f, SAND / f.name)
        log('build', '库副本就绪：%s (%d 字节)' % (DB.name, DB.stat().st_size))

    # 🔴 硬断言：绝不能指向生产路径
    assert '/opt/hergent-erp' not in str(DB), '拒绝：库路径指向生产'
    assert DB.is_file(), '副本库不存在'
    assert (SRC / 'db/connection.py').is_file(), '源码副本不完整'
    patch_schema()


def patch_schema():
    """给**副本库**补上生产已有、本地开发库缺的列。

    本地 `~/Documents/hergent-erp/server/erp.db` schema 落后：inventory 没有
    `stock_value`，inventory_logs 没有 `stock_value_*` 三列；而生产版
    `db/queries/inventory.py` 的 `batch_in` / `inventory_adjust` 无条件写这些列。
    不补齐会在演练第一步就抛 `no column named stock_value`（实测踩到）。
    🔴 只改副本库，绝不碰本地开发库与生产库。
    """
    need = {
        'inventory': {'stock_value': 'REAL DEFAULT 0'},
        'inventory_logs': {
            'stock_value_before': 'REAL DEFAULT 0',
            'stock_value_after': 'REAL DEFAULT 0',
            'stock_value_difference': 'REAL DEFAULT 0',
        },
    }
    c = sqlite3.connect(DB)
    try:
        added = []
        for table, cols in need.items():
            have = {r[1] for r in c.execute('PRAGMA table_info(%s)' % table)}
            for name, ddl in cols.items():
                if name not in have:
                    c.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, name, ddl))
                    added.append('%s.%s' % (table, name))
        c.commit()
        log('build', '副本库补列：%s' % (', '.join(added) if added else '无需补齐'))
    finally:
        c.close()


def connect():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def seed_demo():
    """灌演示数据。全部带 DEMO 前缀，绝不复用副本里已有的开发数据。"""
    c = connect()
    try:
        c.execute("DELETE FROM products WHERE name LIKE ?", (DEMO + '%',))
        c.execute("DELETE FROM contacts WHERE name LIKE ?", (DEMO + '%',))
        c.execute("INSERT INTO products (name, unit, purchase_price, sale_price, expiry_days, source) "
                   "VALUES (?,?,?,?,?,?)",
                   (DEMO + '-低温奶A', '件', 10.0, 15.0, 30, 'stage1-demo'))
        pid = c.execute("SELECT id FROM products WHERE name=?", (DEMO + '-低温奶A',)).fetchone()['id']
        c.execute("INSERT INTO contacts (type, name) VALUES ('supplier',?)", (DEMO + '-供应商',))
        sid = c.execute("SELECT id FROM contacts WHERE name=?", (DEMO + '-供应商',)).fetchone()['id']
        c.execute("INSERT INTO contacts (type, name) VALUES ('customer',?)", (DEMO + '-客户',))
        cid = c.execute("SELECT id FROM contacts WHERE name=?", (DEMO + '-客户',)).fetchone()['id']
        c.execute("INSERT OR IGNORE INTO warehouses (id,name,is_default) VALUES (99,?,0)", (DEMO + '-仓库',))
        c.commit()
        log('seed', '演示商品#%d / 供应商#%d / 客户#%d / 仓库#99' % (pid, sid, cid))
        return pid, sid, cid, 99
    finally:
        c.close()


def snapshot():
    c = connect()
    try:
        return {
            'logs': c.execute("SELECT count(*) n FROM inventory_logs").fetchone()['n'],
            'max_log_id': c.execute("SELECT COALESCE(max(id),0) n FROM inventory_logs").fetchone()['n'],
            'inv': c.execute("SELECT count(*) n FROM inventory").fetchone()['n'],
            'qty': float(c.execute("SELECT COALESCE(sum(quantity),0) n FROM inventory").fetchone()['n'] or 0),
            'amount': float(c.execute("SELECT COALESCE(sum(quantity*cost_price),0) n FROM inventory").fetchone()['n'] or 0),
        }
    finally:
        c.close()


def recent_logs(after_id):
    c = connect()
    try:
        return [dict(r) for r in c.execute(
            "SELECT id,product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,"
            "cost_price,ref_type FROM inventory_logs WHERE id>? ORDER BY id", (after_id,))]
    finally:
        c.close()


def demo_batches(pid, wh):
    c = connect()
    try:
        return [dict(r) for r in c.execute(
            "SELECT id,product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date,production_date "
            "FROM inventory WHERE product_id=? AND warehouse_id=? ORDER BY id", (pid, wh))]
    finally:
        c.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-reset', action='store_true', help='复用上次沙箱（调试用）')
    ap.add_argument('--prod-date', action='store_true',
                     help='演示数据里录生产日期（验证「录了能不能落库」）')
    ap.add_argument('--with-fix', action='store_true',
                     help='把生产日期落库修复应用到沙箱源码副本（对照组：不打此参数=现状）')
    args = ap.parse_args()

    build_sandbox(reset=not args.no_reset, with_fix=args.with_fix)

    # 🔴 必须在 import 任何后端模块之前设置：db/connection.py 在 import 时读 DB_PATH
    os.environ['ERP_DB_PATH'] = str(DB)
    os.environ.setdefault('ERP_SECRET', 'stage1-demo-only-not-a-secret')
    os.environ.setdefault('DEEPSEEK_API_KEY', 'stage1-demo-dummy-never-used')
    sys.path.insert(0, str(SRC))

    log('env', 'ERP_DB_PATH=%s（副本）' % DB)
    try:
        from db.queries.purchases import purchase_order_create, purchase_order_confirm
        from db.queries.sales import sale_order_create, sale_order_deliver
        import db.connection as conn
    except Exception as e:
        log('import', '❌ 后端模块 import 失败：%s' % e)
        import traceback
        traceback.print_exc()
        return 1
    log('import', '后端查询层 import OK；DB_PATH=%s' % conn.DB_PATH)
    assert Path(conn.DB_PATH).resolve() == DB.resolve(), '拒绝：DB_PATH 未指向副本库'

    pid, sid, cid, wh = seed_demo()
    before = snapshot()
    log('baseline', json.dumps(before, ensure_ascii=False))

    today = date.today()
    expiry = (today + timedelta(days=20)).isoformat()
    prod_date = (today - timedelta(days=5)).isoformat() if args.prod_date else ''
    batch = 'DEMO%sA' % today.strftime('%Y%m%d')

    # ── 第 1 笔：采购入库 ────────────────────────────────────────────
    items = [{'product_id': pid, 'quantity': 12, 'unit_price': 10.0, 'unit': '件',
              'batch_no': batch, 'expiry_date': expiry, 'production_date': prod_date}]
    po = purchase_order_create(sid, items, warehouse_id=wh, status='draft',
                               note='阶段1演示数据-采购', operator_id='demo')
    if not po or 'order_id' not in po:
        log('po', '❌ 建采购单失败：%s' % po)
        return 2
    log('po', '建单 OK order_id=%s status=draft（草稿态不写库存，符合设计）' % po['order_id'])
    mid = snapshot()
    checks = []
    checks.append(('草稿态不写库存', mid['logs'] == before['logs'],
                   '流水 %d → %d' % (before['logs'], mid['logs'])))

    r = purchase_order_confirm(po['order_id'], operator_id='demo')
    log('po', '入库确认返回：%s' % str(r)[:200])
    after_po = snapshot()
    log('po', '入库后快照：%s' % json.dumps(after_po, ensure_ascii=False))

    new_logs_po = recent_logs(before['max_log_id'])
    checks.append(('入库确认写出流水', after_po['logs'] > before['logs'],
                   '新增 %d 条：%s' % (len(new_logs_po),
                                     [x['change_type'] for x in new_logs_po])))
    checks.append(('流水含非 opening 类型',
                   any(x['change_type'] != 'opening' for x in new_logs_po),
                   str(sorted(set(x['change_type'] for x in new_logs_po)))))
    batches = demo_batches(pid, wh)
    log('po', '演示批次：%s' % json.dumps(batches, ensure_ascii=False))
    checks.append(('批次号/到期日落库',
                   bool(batches) and any(x['batch_no'] == batch and x['expiry_date'] == expiry for x in batches),
                   str([(x['batch_no'], x['expiry_date']) for x in batches])))
    if args.prod_date:
        checks.append(('录了生产日期必须落库',
                       bool(batches) and any(x['production_date'] == prod_date for x in batches),
                       '期望=%s 实际=%s' % (prod_date, str([x['production_date'] for x in batches]))))

    # ── 第 2 笔：销售发货 ────────────────────────────────────────────
    so = sale_order_create(cid,
                           [{'product_id': pid, 'quantity': 5, 'unit_price': 15.0, 'unit': '件'}],
                           warehouse_id=wh, status='draft', skip_credit_check=True,
                           note='阶段1演示数据-销售', operator_id='demo')
    if not so or 'order_id' not in so:
        log('so', '❌ 建销售单失败：%s' % so)
        return 2
    log('so', '建单 OK order_id=%s' % so['order_id'])
    r2 = sale_order_deliver(so['order_id'])
    log('so', '发货返回：%s' % str(r2)[:200])
    after_so = snapshot()
    log('so', '发货后快照：%s' % json.dumps(after_so, ensure_ascii=False))
    new_logs_so = recent_logs(after_po['max_log_id'])
    checks.append(('发货写出库流水', after_so['logs'] > after_po['logs'],
                   '新增 %d 条：%s' % (len(new_logs_so),
                                     [x['change_type'] for x in new_logs_so])))
    checks.append(('发货后库存数量下降', after_so['qty'] < after_po['qty'],
                   '%.2f → %.2f' % (after_po['qty'], after_so['qty'])))
    batches_after = demo_batches(pid, wh)
    log('so', '发货后批次：%s' % json.dumps(batches_after, ensure_ascii=False))

    # ── 汇总 ─────────────────────────────────────────────────────────
    print('\n' + '=' * 72)
    print('阶段 1 · 演示数据链路演练判定（生产日期录=%s / 落库修复=%s）'
          % ('是' if args.prod_date else '否', '已应用' if args.with_fix else '未应用(现状)'))
    print('=' * 72)
    for name, ok, detail in checks:
        print('  %s %-28s %s' % ('✅' if ok else '❌', name, detail))
    passed = sum(1 for _, ok, _ in checks if ok)
    print('\n合计 %d/%d 通过' % (passed, len(checks)))
    print('最近流水：')
    for x in recent_logs(before['max_log_id'])[:12]:
        print('   #%-5d %-14s qty=%-8s %s→%s ref=%s'
              % (x['id'], x['change_type'], x['change_qty'], x['before_qty'],
                 x['after_qty'], x['ref_type']))

    report = {
        'generated_at': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
        'prod_date_recorded': args.prod_date,
        'fix_applied': args.with_fix,
        'baseline': before, 'after_purchase': after_po, 'after_delivery': after_so,
        'new_logs': recent_logs(before['max_log_id']),
        'batches_after': batches_after,
        'checks': [{'name': n, 'ok': bool(o), 'detail': d} for n, o, d in checks],
        'passed': passed, 'total': len(checks),
    }
    (SAND / 'demo-e2e-result.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('\n[out] %s' % (SAND / 'demo-e2e-result.json'))
    return 0 if passed == len(checks) else 2


if __name__ == '__main__':
    sys.exit(main())
