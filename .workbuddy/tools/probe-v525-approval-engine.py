# -*- coding: utf-8 -*-
"""v525 审批流引擎进程内全流程探针（临时库，零生产写入）。

正确断言（关键修正）：
- admin/boss 对任意节点恒可审（设计如此，不是 bug）。
- 非 admin/boss 角色只能审「当前节点 role == 自己 role」的节点，否则被拒。
- 末节点通过 → approved；中途节点通过 → node+1。
- 驳回 → draft，并记录 reject_reason。
"""
import sqlite3, tempfile, os
from unittest.mock import patch
import db.queries.approvals as a
import erp_db

td = tempfile.mkdtemp()
dbp = os.path.join(td, 'test.db')
c = sqlite3.connect(dbp)
_TBL = ("id INTEGER PRIMARY KEY, status TEXT, approval_node INTEGER DEFAULT 0, "
         "approval_chain TEXT, reject_reason TEXT, auditor_id TEXT, audit_time TEXT")
c.executescript(f'''
CREATE TABLE purchase_orders({_TBL});
CREATE TABLE sale_orders({_TBL});
CREATE TABLE transfer_orders({_TBL});
CREATE TABLE return_orders({_TBL});
CREATE TABLE approval_flows(id INTEGER PRIMARY KEY, doc_type TEXT UNIQUE, nodes TEXT, updated_at TEXT);
INSERT INTO purchase_orders(id,status) VALUES(1,'draft'),(2,'draft'),(3,'draft');
''')
c.commit(); c.close()


def fake():
    cc = sqlite3.connect(dbp); cc.row_factory = sqlite3.Row; return cc


def fake_tx():
    return fake()


ok = True
def check(label, cond):
    global ok
    print(('PASS' if cond else 'FAIL'), label)
    if not cond:
        ok = False


with patch.object(a, 'get_db', fake), patch.object(a, 'get_db_tx', fake_tx), \
     patch.object(erp_db, 'audit_log', lambda *x, **k: None):
    r = a.set_flow('purchase', [{'role': 'supervisor', 'name': '主管审'}, {'role': 'boss', 'name': '老板终审'}])
    check('set_flow ok', r.get('ok'))
    check('flow = 2 nodes', len(a.get_flow('purchase')) == 2)

    # 提交
    r = a.submit_for_approval('purchase', 1, 'u1', '张会计')
    check('submit -> pending_approval node0', r.get('status') == 'pending_approval' and r.get('node') == 0)

    # 错误角色（收银）不能审 node0（主管节点）
    r = a.approve_step('purchase', 1, 'ux', 'cashier', '收银')
    check('cashier rejected @node0', 'error' in r)

    # 主管审 node0 -> node1
    r = a.approve_step('purchase', 1, 'u3', 'supervisor', '主管')
    check('supervisor @node0 -> node1', r.get('status') == 'pending_approval' and r.get('node') == 1 and r.get('final') is False)

    # 主管不能审 node1（老板节点）
    r = a.approve_step('purchase', 1, 'u3', 'supervisor', '主管')
    check('supervisor rejected @node1', 'error' in r)

    # 待审清单（此时 #1 停在 node1=boss 节点，尚未终审）
    check('boss pending 含 #1', any(x['id'] == 1 for x in a.pending_for_user('boss')))
    check('supervisor pending 不含 #1（已推进）', not any(x['id'] == 1 for x in a.pending_for_user('supervisor')))

    # boss（恒可审）终审 node1 -> approved
    r = a.approve_step('purchase', 1, 'u2', 'boss', '老板')
    check('boss final -> approved', r.get('status') == 'approved' and r.get('final') is True)

    # 驳回流程（#2）
    a.submit_for_approval('purchase', 2, 'u1', '张会计')
    r = a.reject_step('purchase', 2, 'u3', 'supervisor', '主管', '价格不对')
    check('reject -> draft', r.get('status') == 'draft')
    c2 = sqlite3.connect(dbp)
    row = c2.execute('SELECT status,reject_reason FROM purchase_orders WHERE id=2').fetchone()
    check('reject_reason 已记录', row[0] == 'draft' and row[1] == '价格不对')
    c2.close()

    # 错误角色不能驳回（#3）
    a.submit_for_approval('purchase', 3, 'u1', '张会计')
    r = a.reject_step('purchase', 3, 'ux', 'cashier', '收银')
    check('cashier cannot reject', 'error' in r)

print('=== 引擎全流程', 'OK' if ok else 'FAILED', '（临时库，未触碰生产数据）===')
