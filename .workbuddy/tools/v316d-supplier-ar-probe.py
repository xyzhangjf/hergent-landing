#!/usr/bin/env python3
"""v316d 追加核查：供应商列表里那 1 个「有应收」的档案是什么性质。

只打印 id / type / 金额 / 计数，不打印名称与电话。
"""
import sqlite3

DB = '/tmp/v316d-shadow/tenant_1-snapshot.db'
con = sqlite3.connect('file:' + DB + '?immutable=1', uri=True)
con.row_factory = sqlite3.Row

AR = "COALESCE((SELECT SUM(amount-paid_amount) FROM receivables WHERE contact_id=c.id AND type='ar' AND status!='paid'),0)"

print('== 供应商侧（type in supplier/both）中有应收的行 ==')
for r in con.execute(
        "SELECT c.id, c.type, %s AS ar FROM contacts c WHERE c.is_active=1 "
        "AND c.type IN ('supplier','both') AND %s > 0.005" % (AR, AR)).fetchall():
    print('   id=%d type=%s ar=%.2f' % (r['id'], r['type'], r['ar']))

print('')
print('== 供应商 38 行的 type 构成 ==')
for r in con.execute(
        "SELECT type, COUNT(*) n FROM contacts WHERE is_active=1 "
        "AND type IN ('supplier','both') GROUP BY type").fetchall():
    print('   type=%-10s n=%d' % (r['type'], r['n']))

print('')
print('== 全库 type 构成 ==')
for r in con.execute("SELECT type, COUNT(*) n FROM contacts GROUP BY type ORDER BY n DESC").fetchall():
    print('   type=%-12s n=%d' % (str(r['type']), r['n']))

print('')
print('== 那 1 个档案的 receivables 明细（按 type/status 汇总）==')
tgt = con.execute(
    "SELECT c.id FROM contacts c WHERE c.is_active=1 AND c.type IN ('supplier','both') "
    "AND %s > 0.005 LIMIT 1" % AR).fetchone()
if tgt:
    print('   目标 id=%d' % tgt['id'])
    for r in con.execute(
            "SELECT type, status, COUNT(*) n, SUM(amount-paid_amount) amt FROM receivables "
            "WHERE contact_id=? GROUP BY type, status ORDER BY type, status", (tgt['id'],)).fetchall():
        print('     type=%-4s status=%-10s n=%-3d 未付=%.2f' % (str(r['type']), str(r['status']), r['n'], r['amt'] or 0))
    n_so = con.execute("SELECT COUNT(*) FROM sale_orders WHERE customer_id=?", (tgt['id'],)).fetchone()[0]
    print('     它在 sale_orders 里的单数 = %d' % n_so)
    # 它是否也落入「客户」列表（both 会两边都在）
    in_cust = con.execute(
        "SELECT COUNT(*) FROM contacts WHERE id=? AND is_active=1 AND type IN ('customer','both')",
        (tgt['id'],)).fetchone()[0]
    print('     它是否同时出现在客户列表 = %s' % ('是' if in_cust else '否'))

print('')
print('== 全体供应商里 last_order 非空的行数（证明供应商不写 sale_orders）==')
LO = "COALESCE((SELECT MAX(order_date) FROM sale_orders WHERE customer_id=c.id),'')"
n = con.execute("SELECT COUNT(*) FROM contacts c WHERE c.is_active=1 AND c.type IN ('supplier','both') "
                "AND %s <> ''" % LO).fetchone()[0]
print('   n=%d / 38' % n)
