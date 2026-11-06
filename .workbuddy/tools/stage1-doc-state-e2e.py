#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 3 项 · 状态跃迁端到端演练（**零生产写入**）

在内核单测之外，把**真实业务函数**跑一遍，确认三件事：

  ① 白名单没有误伤：正常链路（草稿 → 发货 → 签收、草稿 → 入库）照旧走得通；
  ② 非法跃迁在**业务函数这一层**就被拦下，且给的是中文原因；
  ③ 守卫是**两层**：状态校验 + 写入守卫。只绕过一层仍然拦得住 ——
     这条判据是防「以后有人把 check 删了，还以为写入守卫在」的那种静默退化。

沙箱复用 `stage1-demo-e2e.py`（库副本 + 源码副本，硬断言不指向生产）。
用法：/usr/bin/python3 .workbuddy/tools/stage1-doc-state-e2e.py
退出码：0 = 全通过；2 = 有判据未通过；1 = 环境/导入错误。
"""
import importlib.util
import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / '.workbuddy/tools'

PASS, FAIL = [], []


def ok(cond, name, detail=''):
    if cond:
        PASS.append(name)
        print('  ✅ %s' % name, flush=True)
    else:
        FAIL.append((name, detail))
        print('  ❌ %s%s' % (name, ('  ← ' + detail) if detail else ''), flush=True)


def load_demo():
    spec = importlib.util.spec_from_file_location(
        'stage1_demo_e2e', TOOLS / 'stage1-demo-e2e.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def q(db, sql, p=()):
    return db.execute(sql, p).fetchone()[0]


def main():
    demo = load_demo()
    demo.build_sandbox(reset=True, with_fix=True)

    # 🔴 必须在 import 后端模块**之前**落库路径：`db/connection.py` 在模块加载时
    # 就把 `ERP_DB_PATH` 读成常量，晚一步设就会连到 src/erp.db（一个空库），
    # 表现为「所有表都不存在」的 migration 噪音 —— 踩过一次。
    os.environ['ERP_DB_PATH'] = str(demo.DB)
    os.environ.setdefault('ERP_SECRET', 'stage1-demo-only-not-a-secret')
    os.environ.setdefault('DEEPSEEK_API_KEY', 'stage1-demo-dummy-never-used')
    sys.path.insert(0, str(demo.SRC))

    try:
        import db.connection as conn
        from db.queries.sales import (
            sale_order_create, sale_order_deliver, sale_order_sign,
            sale_order_cancel, sale_order_reject,
        )
        from db.queries.purchases import purchase_order_create, purchase_order_confirm
        from db.queries import doc_state as ds
        from db.queries import approvals as appr
        print('[env] ERP_DB_PATH=%s（副本）' % conn.DB_PATH, flush=True)
    except Exception as e:
        print('[import] ❌ 后端模块 import 失败：%s' % e, flush=True)
        traceback.print_exc()
        return 1

    assert '/opt/hergent-erp' not in str(conn.DB_PATH), '拒绝：库路径指向生产'
    assert Path(conn.DB_PATH).resolve() == demo.DB.resolve(), '拒绝：DB_PATH 未指向副本库'

    pid, sid, cid, wh = demo.seed_demo()

    # 副本库是**本地开发库**的拷贝，schema 落后于生产：审批流用到的三列在生产有、
    # 本地没有。不补会在 `approvals._row()` 直接 `no such column: approval_node`。
    # 🔴 只补副本库。
    _db = demo.connect()
    _have = {r[1] for r in _db.execute('PRAGMA table_info(sale_orders)').fetchall()}
    for _col, _ddl in (('approval_node', 'INTEGER NOT NULL DEFAULT 0'),
                       ('approval_chain', 'TEXT'),
                       ('reject_reason', 'TEXT'),
                       ('auditor_id', "TEXT DEFAULT ''"),
                       ('audit_time', "TEXT DEFAULT ''")):
        if _col not in _have:
            _db.execute('ALTER TABLE sale_orders ADD COLUMN %s %s' % (_col, _ddl))
    _db.commit()
    _db.close()

    # 先入一批货，后面才有可售库存（发货会走 FEFO 扣减，0 库存时直接返回「库存不足」）
    _po = purchase_order_create(
        sid, [{'product_id': pid, 'quantity': 20, 'unit_price': 5.0, 'unit': '件'}],
        warehouse_id=wh, status='draft', operator_id='demo', note='阶段1-状态跃迁演练-铺货')
    _r = purchase_order_confirm(_po['order_id'], 'demo')
    if 'error' in _r:
        print('[seed] ❌ 铺货失败：%s' % _r, flush=True)
        return 1

    def new_sale(status='draft'):
        r = sale_order_create(
            cid, [{'product_id': pid, 'quantity': 1, 'unit_price': 15.0, 'unit': '件'}],
            warehouse_id=wh, status=status, skip_credit_check=True,
            note='阶段1-状态跃迁演练', operator_id='demo')
        return r['order_id']

    def status_of(oid):
        db = demo.connect()
        try:
            return q(db, 'SELECT status FROM sale_orders WHERE id=?', (oid,))
        finally:
            db.close()

    # ── A. 销售单正常链路不受影响 ─────────────────────────
    print('\n── A. 销售单正常链路（白名单不许误伤）──', flush=True)
    o1 = new_sale()
    ok(status_of(o1) == 'draft', '建单是草稿')
    r = sale_order_deliver(o1)
    ok('error' not in r and status_of(o1) == 'delivered', '草稿 → 已发货 成功', str(r)[:120])
    r = sale_order_sign(o1)
    ok('error' not in r and status_of(o1) == 'signed', '已发货 → 已签收 成功', str(r)[:120])

    # ── B. 非法跃迁在业务函数层被拦 ───────────────────────
    print('\n── B. 非法跃迁必须被拦（中文原因）──', flush=True)
    r = sale_order_deliver(o1)
    e = str(r.get('error', ''))
    ok('error' in r and '已签收' in e, '已签收再发货被拦，且点名当前状态', e)

    r = sale_order_sign(o1)
    e = str(r.get('error', ''))
    ok('error' in r and '签收' in e, '已签收再签收被拦', e)

    r = sale_order_cancel(o1, 'demo')
    e = str(r.get('error', ''))
    ok('error' in r and '已签收' in e and '退货' in e,
       '已签收走「取消」被拦，并指向销售退货', e)

    r = sale_order_reject(o1, 'demo')
    e = str(r.get('error', ''))
    ok('error' in r and '已签收' in e, '已签收被「驳回」拦下', e)

    # ── C. 拣货中能发货（修掉的死路）───────────────────────
    print('\n── C. 拣货中 → 已发货（本次修掉的死路）──', flush=True)
    o2 = new_sale()
    db = demo.connect()
    db.execute("UPDATE sale_orders SET status='picking' WHERE id=?", (o2,))
    db.commit(); db.close()
    r = sale_order_deliver(o2)
    ok('error' not in r and status_of(o2) == 'delivered',
       '拣货中 → 已发货 成功（原先路由层与 db 层都拦死）', str(r)[:120])

    # 反证：修复前的写死集合确实会拦掉它
    ok('picking' not in ('draft', 'confirmed', 'approved'),
       '对照：修复前守卫集合确实不含 picking（说明这条不是空判据）')

    # ── D. 采购单入库与重复入库 ───────────────────────────
    print('\n── D. 采购单入库 ──', flush=True)
    po = purchase_order_create(
        sid, [{'product_id': pid, 'quantity': 2, 'unit_price': 10.0, 'unit': '件'}],
        warehouse_id=wh, status='draft', operator_id='demo', note='阶段1-状态跃迁演练')
    poid = po['order_id']
    r = purchase_order_confirm(poid, 'demo')
    ok('error' not in r, '草稿 → 已入库 成功', str(r)[:120])
    r2 = purchase_order_confirm(poid, 'demo')
    e = str(r2.get('error', ''))
    ok('error' in r2 and '已入库' in e, '已入库再入库被拦，提示含「已入库」', e)

    # 未审批的单不许整单入库（集合刻意不放宽）
    po2 = purchase_order_create(
        sid, [{'product_id': pid, 'quantity': 1, 'unit_price': 10.0, 'unit': '件'}],
        warehouse_id=wh, status='pending_approval', operator_id='demo')
    r = purchase_order_confirm(po2['order_id'], 'demo')
    e = str(r.get('error', ''))
    ok('error' in r and '待审批' in e,
       '未审批单整单入库仍被拦（行为未放宽），提示含「待审批」', e)

    # ── E. 审批引擎接同一份白名单 ─────────────────────────
    print('\n── E. 审批引擎 ──', flush=True)
    o3 = new_sale()
    r = appr.submit_for_approval('sale', o3, 'demo', 'demo')
    ok(r.get('ok') and status_of(o3) == 'pending_approval', '草稿 → 待审批 成功', str(r)[:120])
    r = appr.approve_step('sale', o3, 'demo', 'boss', 'demo')
    ok(r.get('ok') and status_of(o3) == 'approved', '待审批 → 审批通过（终审）', str(r)[:120])

    r = appr.submit_for_approval('sale', o1, 'demo', 'demo')   # o1 已签收
    e = str(r.get('error', ''))
    ok('error' in r and '已签收' in e, '已签收单提交审批被拦，中文原因', e)

    r = appr.approve_step('sale', o1, 'demo', 'boss', 'demo')
    e = str(r.get('error', ''))
    ok('error' in r and '已签收' in e, '已签收单走审批通过被拦，中文原因', e)

    # ── F. 两层守卫：只绕过一层仍然拦得住 ─────────────────
    print('\n── F. 守卫是两层（不是「有一层就够了」）──', flush=True)
    from db.queries import sales as sales_mod

    o4 = new_sale()
    sale_order_deliver(o4)                      # → delivered
    db = demo.connect()
    db.execute("UPDATE sale_orders SET status='signed' WHERE id=?", (o4,))
    db.commit(); db.close()

    _orig_check, _orig_guard = sales_mod.check_transition, sales_mod.guard_sql
    try:
        # 只废掉第一层（状态校验）
        sales_mod.check_transition = lambda *a, **k: True
        try:
            r = sale_order_deliver(o4)
            detail = '返回=%s 状态=%s' % (str(r)[:80], status_of(o4))
            ok(status_of(o4) == 'signed' and 'error' in r,
               '只绕过状态校验：仍被写入守卫拦下（两层里还有一层）', detail)
        except Exception as ex:
            ok(status_of(o4) == 'signed',
               '只绕过状态校验：写入守卫抛错、状态未变', repr(ex)[:100])

        # 两层都废掉 ⇒ 真的改成功（证明前面拦得住确实来自这两层）
        sales_mod.guard_sql = lambda *a, **k: ('', [])
        try:
            sale_order_deliver(o4)
        except Exception:
            pass
        ok(status_of(o4) == 'delivered',
           '两层都绕过 ⇒ 状态真的被改写（反证：拦截确实来自这两层，不是巧合）',
           '实际状态=%s' % status_of(o4))
    finally:
        sales_mod.check_transition, sales_mod.guard_sql = _orig_check, _orig_guard

    # ── G. 内核口径在真实库上仍然成立 ─────────────────────
    print('\n── G. 内核与真实单据一致性 ──', flush=True)
    db = demo.connect()
    try:
        bad = []
        for t, sp in ds.DOC_SPECS.items():
            rows = db.execute('SELECT status, COUNT(*) FROM %s GROUP BY status' % sp['table']).fetchall()
            for st, n in rows:
                if st not in sp['statuses']:
                    bad.append('%s 出现未登记状态 %s(%d 条)' % (t, st, n))
        ok(not bad, '副本库里所有单据状态都在词表内（无历史脏值）', '; '.join(bad))
    finally:
        db.close()

    # ── 汇总 ──────────────────────────────────────────────
    print('\n' + '=' * 74, flush=True)
    print('合计 %d/%d 通过' % (len(PASS), len(PASS) + len(FAIL)), flush=True)
    print('通过 %d 项，失败 %d 项' % (len(PASS), len(FAIL)), flush=True)
    if FAIL:
        for n, d in FAIL:
            print('  ❌ %s%s' % (n, ('  ← ' + d) if d else ''), flush=True)
        return 2
    print('全部通过', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
