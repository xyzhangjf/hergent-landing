#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 4 项 · 字段锁 + 乐观锁验收（**零生产写入**）

验四件事，缺一件这个字段锁就是装饰品：

  A. 字段锁相位正确：`_phase` 把状态归到 full / submitted / terminal；
  B. `editable_fields` 在「提交后」锁核心字段、仍放安全字段（备注/经手人/期望日期/单据日期）；
  C. `assert_no_locked_fields` 对锁死的字段给中文错误（含当前状态名），草稿态放行；
  D. 乐观锁 SQL 习语：`UPDATE … WHERE id=? AND status=?` 用错令牌 → rowcount=0（不静默覆盖）；
  E. 坏样本自证：把规则改坏，上面的判据必须随之翻转 —— 否则「全绿」只是因为没在读规则。

用法：/usr/bin/python3 .workbuddy/tools/stage1-field-lock-verify.py
退出码：0 = 全通过；2 = 有判据未通过；1 = 环境/导入错误。
"""
import importlib.util
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / '.workbuddy/stage1/dev-src/db/queries/doc_state.py'

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


def load(path=MODULE, name='doc_state'):
    spec = importlib.util.spec_from_file_location(name, str(path))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    try:
        ds = load()
    except Exception as e:
        print('  ❌ 导入 doc_state 失败：%r' % e)
        return 1

    editable = ds.editable_fields
    phase = ds._phase
    assert_locked = ds.assert_no_locked_fields
    token = ds.status_token_clause

    # ── A. 相位映射 ───────────────────────────────────────────────
    ok(phase('purchase_order', 'draft') == 'full', 'A1 采购单 draft → full')
    ok(phase('purchase_order', 'pending_approval') == 'submitted', 'A2 采购单 pending_approval → submitted（已提交锁核心）')
    ok(phase('purchase_order', 'received') == 'terminal', 'A3 采购单 received → terminal')
    ok(phase('purchase_order', 'cancelled') == 'full', 'A4 采购单 cancelled → full（既有怪癖）')
    ok(phase('sale_order', 'cancelled') == 'terminal', 'A5 销售单 cancelled → terminal（其余单据作废锁）')

    # ── B. editable_fields：提交后锁核心、放安全字段 ───────────────
    po_draft = editable('purchase_order', 'draft')
    po_sub = editable('purchase_order', 'pending_approval')
    po_term = editable('purchase_order', 'received')
    ok('supplier_id' in po_draft and 'note' in po_draft, 'B1 草稿态：核心+安全字段均可改')
    ok('supplier_id' not in po_sub, 'B2 待审批态：核心字段 supplier_id 已锁定')
    ok('items' not in po_sub, 'B3 待审批态：明细 items 已锁定')
    ok('note' in po_sub, 'B4 待审批态：安全字段 note 仍可改')
    ok('warehouse_id' in po_sub, 'B5 待审批态：仓库仍可改（同仓）')
    ok('warehouse_id' not in po_term, 'B6 已入库态：仓库也锁定')
    ok('note' in po_term, 'B7 已入库态：仅安全字段可改')
    so_sub = editable('sale_order', 'pending_approval')
    ok('customer_id' not in so_sub and 'note' in so_sub, 'B8 销售单待审批：核心锁、安全放')

    # ── C. assert_no_locked_fields：中文错误 + 草稿放行 ────────────
    err_sub = assert_locked('purchase_order', 'pending_approval', {'supplier_id', 'items'})
    ok(err_sub is not None and '待审批' in err_sub and ('supplier_id' in err_sub or 'items' in err_sub),
       'C1 待审批改核心字段 → 中文错误（含状态名+被锁字段）', repr(err_sub))
    err_draft = assert_locked('purchase_order', 'draft', {'supplier_id', 'note'})
    ok(err_draft is None, 'C2 草稿改核心字段 → 放行（None）')
    err_term = assert_locked('purchase_order', 'received', {'warehouse_id'})
    ok(err_term is not None and 'warehouse_id' in err_term, 'C3 已入库改仓库 → 拦下')
    err_safe = assert_locked('purchase_order', 'received', {'note', 'handler'})
    ok(err_safe is None, 'C4 已入库改安全字段 → 放行')

    # ── D. status_token_clause ────────────────────────────────────
    tsql, tpar = token('draft')
    ok(tsql.strip() == 'AND status=?' and tpar == ['draft'], 'D1 乐观锁片段 = (AND status=?, [token])')

    # ── E. 乐观锁 SQL 习语：错令牌 rowcount=0 ─────────────────────
    con = sqlite3.connect(':memory:')
    con.execute('CREATE TABLE purchase_orders (id INTEGER, status TEXT, note TEXT)')
    con.execute("INSERT INTO purchase_orders VALUES (1,'draft','x')")
    # 错令牌（客户端以为还是 draft，实际已被别人改成 pending_approval）
    cur = con.execute("UPDATE purchase_orders SET note=? WHERE id=? AND status=?",
                      ('y', 1, 'pending_approval'))
    ok(cur.rowcount == 0, 'E1 错令牌 → rowcount=0（不静默覆盖）')
    # 对令牌
    cur2 = con.execute("UPDATE purchase_orders SET note=? WHERE id=? AND status=?",
                       ('z', 1, 'draft'))
    ok(cur2.rowcount == 1, 'E2 对令牌 → rowcount=1（正常生效）')
    con.close()

    # ── E. 坏样本自证：规则改坏，判据必须翻转 ─────────────────────
    orig = ds._phase
    # 模拟「有人把 pending_approval 误标成 full（提交后还能整单改）」
    ds._phase = lambda dt, st: 'full' if st == 'pending_approval' else orig(dt, st)
    bad_unlocked = 'supplier_id' in editable('purchase_order', 'pending_approval')
    ds._phase = orig
    ok(bad_unlocked is True, 'E3 坏样本：规则改坏后核心字段变为可改（判据随规则翻转，非写死）')

    print('\n合计 %d/%d 通过' % (PASS, N))
    return 0 if FAIL == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
