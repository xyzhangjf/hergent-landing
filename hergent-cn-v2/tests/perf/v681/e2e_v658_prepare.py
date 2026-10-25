#!/usr/bin/env python3
"""v681 / Task#41 e2e 环境准备：建隔离租户 tenant_99（只复制 schema，不复制任何业务数据）。

安全边界：
  · 只 READ tenant_1.db 的 schema（sqlite_master），不读任何行；
  · 只 WRITE /opt/hergent-erp/tenant_99.db（新文件）+ 主库 tenants/user_tenants 各一行；
  · 不动 tenant_1 / tenant_10 的任何数据行。
"""
import os, sqlite3, sys

DB_DIR = "/opt/hergent-erp"
MASTER = os.path.join(DB_DIR, "erp.db")
SRC = os.path.join(DB_DIR, "tenant_1.db")
DST = os.path.join(DB_DIR, "tenant_99.db")
TID = 99
BOSS_UID = 2

if os.path.exists(DST):
    print("ABORT tenant_99.db 已存在，先跑 teardown")
    sys.exit(2)

# ── 1. 复制 schema（无数据）────────────────────────────────────────────────
src = sqlite3.connect(SRC)
dst = sqlite3.connect(DST)
objs = src.execute(
    "select type, sql from sqlite_master where sql is not null "
    "and type in ('table','index') and name not like 'sqlite_%' "
    "and tbl_name not like 'sqlite_%'"
).fetchall()
src.close()
ok = skip = 0
for _type, sql in objs:
    try:
        dst.execute(sql)
        ok += 1
    except Exception as e:
        skip += 1
        if skip <= 3:
            print("  skip:", str(e)[:90])
dst.commit()

tbl = dst.execute("select count(*) from sqlite_master where type='table'").fetchone()[0]
print("schema copied: ok=%d skip=%d tables=%d" % (ok, skip, tbl))

# ── 2. fixture ────────────────────────────────────────────────────────────
cur = dst.cursor()
cur.execute("insert into forecast_periods(id,name,order_start_date,order_end_date,arrival_date,"
            "status,order_start,order_end) values(1,'E2E-v658期次','2026-10-20','2026-10-24',"
            "'2026-10-26','open','2026-10-20','2026-10-24')")
cur.execute("insert into products(id,name,spec,unit,large_unit,large_ratio,medium_unit,"
            "medium_ratio,order_unit,barcode,status,is_active,can_sale) "
            "values(1001,'E2E低温酸奶','1*12','包','箱',12,'',0,'箱','E2E1001','active',1,1)")
cur.execute("insert into hr_employees(id,employee_no,name,is_active) values(3,'E2E03','柏万红(E2E)',1)")
cur.execute("insert into hr_employees(id,employee_no,name,is_active) values(5,'E2E05','停用员工(E2E)',0)")
# 同一员工(eid=3) 挂两个门店；外部客户(eid=0)；停用别名
for al, eid, ext, act in (("E2E东津", 3, 0, 1), ("E2E吾悦", 3, 0, 1),
                          ("E2E外部客户", 0, 999908, 1), ("E2E停用店", 5, 0, 0)):
    cur.execute("insert into report_mapping(tenant_id,employee_id,counterparty_type,"
                "counterparty_id,system_name,report_alias,is_active,external_user_id) "
                "values(?,?,'store',0,'',?,?,?)", (TID, eid, al, act, ext))
dst.commit()

# ── 3. 主库登记租户 + 成员关系 ─────────────────────────────────────────────
m = sqlite3.connect(MASTER)
m.execute("insert into tenants(id,name,subdomain,contact_name,contact_phone,plan,max_users,"
          "is_active,readonly) values(?,?,?,?,?,?,?,1,0)",
          (TID, "E2E隔离租户（临时）", "e2e-v658", "e2e", "", "free", 5))
m.execute("insert into user_tenants(user_id,tenant_id) values(?,?)", (BOSS_UID, TID))
m.commit()
print("tenants:", m.execute("select id,name from tenants order by id").fetchall())
print("user_tenants(boss):", m.execute(
    "select tenant_id from user_tenants where user_id=?", (BOSS_UID,)).fetchall())
m.close()
dst.close()
print("PREPARE OK -> %s" % DST)
