import sqlite3, sys
for db in ['tenant_1.db', 'tenant_10.db', 'erp.db']:
    print('===', db, '===')
    try:
        c = sqlite3.connect(db)
        for t in ['purchase_orders', 'sale_orders', 'transfer_orders', 'return_orders']:
            try:
                r = c.execute(f"SELECT COUNT(*) FROM {t} WHERE status='pending_approval' OR approval_chain IS NOT NULL").fetchone()[0]
                print('  ', t, '污染行=', r)
                if r:
                    for row in c.execute(f"SELECT id,status,approval_chain FROM {t} WHERE status='pending_approval' OR approval_chain IS NOT NULL LIMIT 20"):
                        print('     id=%s status=%s chain=%s' % (row[0], row[1], (row[2] or '')[:60]))
            except Exception as e:
                print('  ', t, 'ERR', e)
        c.close()
    except Exception as e:
        print('  open ERR', e)
