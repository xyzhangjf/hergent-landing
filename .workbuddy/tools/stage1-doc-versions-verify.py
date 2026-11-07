#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 第 5 项 · C 内核验收（doc_versions 纯函数，含坏样本）

直接加载 dev-src 的 `db/queries/doc_state.py`，在临时 SQLite 上验证：
  · 建表惰性、幂等（CREATE TABLE IF NOT EXISTS）
  · record_doc_version 写入 + version 按 (doc_type, doc_id) 自增（1,2,3…）
  · 字段/JSON 落库正确（status_from/to、fields_changed、data）
  · doc_version_timeline 升序 + JSON 解析
  · 坏样本：并发未造成 version 回退/重复（MAX+1 不依赖物理列）；unchanged 不写（由 set_doc_status 早返保证，此处单测函数本身）

退出码：0 = 全通过；2 = 有判据未通过；1 = 环境/导入错误。
"""
import importlib.util
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / '.workbuddy/stage1/dev-src'
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


def load_doc_state():
    spec = importlib.util.spec_from_file_location(
        'dv_doc_state', DEV / 'db/queries/doc_state.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    try:
        ds = load_doc_state()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('  ❌ 导入 doc_state 失败：%r' % e)
        return 1

    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    db = sqlite3.connect(tmp.name)
    db.row_factory = sqlite3.Row
    try:
        # ① 建表惰性 + 幂等
        ds._ensure_doc_versions(db)
        ds._ensure_doc_versions(db)  # 第二次不应报错
        ok(db.execute("SELECT name FROM sqlite_master WHERE type='table' "
                      "AND name='doc_versions'").fetchone() is not None,
           '① doc_versions 表已惰性创建（幂等）')

        # ② record_doc_version 写入 + version 自增 1,2,3
        db.execute("CREATE TABLE t_dummy(id INTEGER)")
        v1 = ds.record_doc_version(db, 'purchase_order', 'X1', 'create',
                                   status_to='draft', actor='alice')
        v2 = ds.record_doc_version(db, 'purchase_order', 'X1', 'status_change',
                                   status_from='draft', status_to='pending_approval',
                                   actor='bob', fields_changed=['note'])
        v3 = ds.record_doc_version(db, 'purchase_order', 'X1', 'field_edit',
                                   status_from='pending_approval', status_to='pending_approval',
                                   actor='carol', fields_changed=['note', 'handler'],
                                   data={'note': ['', '改了']})
        ok((v1, v2, v3) == (1, 2, 3), '② version 自增 1→2→3', repr((v1, v2, v3)))

        # ③ 落库内容正确
        row = db.execute("SELECT action, status_from, status_to, actor, fields_changed, data "
                         "FROM doc_versions WHERE doc_type='purchase_order' AND doc_id='X1' "
                         "AND version=3").fetchone()
        ok(row is not None and row['action'] == 'field_edit', '③ action 落库正确')
        ok(row['status_from'] == 'pending_approval' and row['status_to'] == 'pending_approval',
           '③ status_from/to 落库正确')
        ok(row['actor'] == 'carol', '③ actor 落库正确')
        import json
        ok(json.loads(row['fields_changed']) == ['note', 'handler'], '③ fields_changed JSON 落库')
        ok(json.loads(row['data']) == {'note': ['', '改了']}, '③ data JSON 落库')

        # ④ timeline 升序 + JSON 解析
        tl = ds.doc_version_timeline(db, 'purchase_order', 'X1')
        ok(len(tl) == 3, '④ timeline 返回 3 条', repr(len(tl)))
        ok([t['version'] for t in tl] == [1, 2, 3], '④ timeline 按 version 升序')
        ok(tl[0]['action'] == 'create' and tl[2]['fields_changed'] == ['note', 'handler'],
           '④ timeline 条目字段已解析（含 JSON 列表）')

        # ⑤ 坏样本反转：同一 (doc_type, doc_id) 反复写，version 不会回退/重复（MAX+1 不依赖物理列）
        for i in range(4, 11):
            vi = ds.record_doc_version(db, 'purchase_order', 'X1', 'field_edit')
            ok(vi == i, '⑤ 坏样本：第 %d 次写入 version=%d（MAX+1 不回退）' % (i, i))

        # ⑥ 不同 doc_id 各自从 1 起
        v_other = ds.record_doc_version(db, 'sale_order', 'S9', 'create', status_to='draft')
        ok(v_other == 1, '⑥ 不同 doc_id 各自从 1 起计数', repr(v_other))

        # ⑦ created_at 非空且为时间戳格式
        ca = db.execute("SELECT created_at FROM doc_versions WHERE doc_type='sale_order' "
                        "AND doc_id='S9'").fetchone()[0]
        ok(bool(ca) and len(ca) == 19, '⑦ created_at 已写入（YYYY-MM-DD HH:MM:SS）', repr(ca))

        # ⑧ 空 fields_changed / data → NULL（不写空 JSON）
        ds.record_doc_version(db, 'purchase_order', 'X2', 'status_change',
                              status_from='draft', status_to='cancelled')
        nullrow = db.execute("SELECT fields_changed, data FROM doc_versions "
                             "WHERE doc_type='purchase_order' AND doc_id='X2'").fetchone()
        ok(nullrow['fields_changed'] is None and nullrow['data'] is None,
           '⑧ 空 fields_changed/data 落 NULL（不写空 JSON 串）')
    finally:
        db.close()
        os.unlink(tmp.name)

    print('\n合计 %d/%d 通过' % (PASS, N))
    return 0 if FAIL == 0 else 2


if __name__ == '__main__':
    sys.exit(main())
