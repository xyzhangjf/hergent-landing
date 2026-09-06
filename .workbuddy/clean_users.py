import sqlite3, os, datetime
BASE = "/opt/hergent-erp"
BACKUP = os.path.join(BASE, "backups")
os.makedirs(BACKUP, exist_ok=True)
now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

def backup(db):
    src = os.path.join(BASE, db)
    dst = os.path.join(BACKUP, "clean_" + now + "_" + db)
    s = sqlite3.connect(src); d = sqlite3.connect(dst)
    s.backup(d); s.close(); d.close()
    return dst, os.path.getsize(dst)

for db in ["erp.db", "tenant_1.db"]:
    p, sz = backup(db)
    print("BACKUP", db, "->", p, sz)

# 1) 主库 erp.db 才是登录认证库：真正修复显示名
c = sqlite3.connect(os.path.join(BASE, "erp.db"))
b = c.execute("SELECT id,username,display_name FROM users WHERE id=2").fetchone()
print("ERP BEFORE", tuple(b))
c.execute("UPDATE users SET display_name=? WHERE id=? AND username=?", ("张俊峰", 2, "boss"))
c.commit()
a = c.execute("SELECT id,username,display_name FROM users WHERE id=2").fetchone()
print("ERP AFTER", tuple(a))
c.close()

# 2) tenant_1.db 清理测试残留账号 id=5,6,7
ids = [5, 6, 7]
c = sqlite3.connect(os.path.join(BASE, "tenant_1.db")); c.row_factory = sqlite3.Row
tabs = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
refs = {}
for t in tabs:
    try:
        cols = [d[1] for d in c.execute("PRAGMA table_info(" + t + ")")]
    except Exception:
        continue
    for col in cols:
        if col in ("user_id", "created_by", "employee_id", "updated_by"):
            try:
                n = c.execute("SELECT COUNT(*) FROM " + t + " WHERE " + col + " IN (?,?,?)", ids).fetchone()[0]
                if n > 0:
                    refs[t + "." + col] = n
            except Exception:
                pass
print("TENANT_1 refs for 5,6,7:", refs)

rows = c.execute("SELECT id,username,display_name FROM users WHERE id IN (?,?,?)", ids).fetchall()
print("TENANT_1 DELETE TARGETS:", [tuple(r) for r in rows])
for t in ("user_tenants", "sessions", "audit_log"):
    if t in tabs:
        n = c.execute("DELETE FROM " + t + " WHERE user_id IN (?,?,?)", ids).rowcount
        print("  deleted", n, "from", t)
dn = c.execute("DELETE FROM users WHERE id IN (?,?,?)", ids).rowcount
c.commit()
print("TENANT_1 deleted users:", dn)
rem = c.execute("SELECT id,username,display_name,role FROM users WHERE role='boss' ORDER BY id").fetchall()
print("TENANT_1 remaining boss:", [tuple(r) for r in rem])
c.close()
print("DONE")
