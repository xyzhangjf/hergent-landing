# -*- coding: utf-8 -*-
"""v279f 清理：孤儿库 tenant_9.db（含 -wal/-shm）+ 空壳 db/tenant_1.db。
顺序：备份 → 删文件 → （root 侧）重启。遵循「先删后重启」的幽灵 inode 纪律。"""
import os, shutil, sqlite3, time, hashlib
BASE = "/opt/hergent-erp"
BK = os.path.join(BASE, "backups/2026-09-26")
TS = time.strftime("%Y%m%d-%H%M%S")

TARGETS = [
    os.path.join(BASE, "tenant_9.db"),
    os.path.join(BASE, "tenant_9.db-wal"),
    os.path.join(BASE, "tenant_9.db-shm"),
    os.path.join(BASE, "db", "tenant_1.db"),
]

def md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()

print("=== 备份 ===")
os.makedirs(BK, exist_ok=True)
# tenant_9.db：用 SQLite 原生 backup()（读得动 WAL 里未 checkpoint 的部分）
src = sqlite3.connect("file:%s?mode=ro" % os.path.join(BASE, "tenant_9.db"), uri=True)
dstp = os.path.join(BK, "tenant_9.db.bak-v279f-orphan-%s" % TS)
dst = sqlite3.connect(dstp)
src.backup(dst); dst.close(); src.close()
n = sqlite3.connect(dstp).execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
print("   %-60s %d B  tables=%d" % (dstp, os.path.getsize(dstp), n))
assert n > 100, "备份表数异常"

# 空壳：0 字节，直接拷
p = os.path.join(BASE, "db", "tenant_1.db")
dstp2 = os.path.join(BK, "db-tenant_1.db.bak-v279f-shell-%s" % TS)
shutil.copy2(p, dstp2)
print("   %-60s %d B" % (dstp2, os.path.getsize(dstp2)))

print()
print("=== 删除前状态 ===")
for p in TARGETS:
    if os.path.exists(p):
        print("   %-46s %d B  md5=%s" % (p, os.path.getsize(p), md5(p)[:16]))
    else:
        print("   %-46s 不存在" % p)

print()
print("=== 删除 ===")
for p in TARGETS:
    if os.path.exists(p):
        os.remove(p)
        print("   removed", p, "-> 仍存在?", os.path.exists(p))
    else:
        print("   skip(不存在)", p)

print()
print("=== 残留复核 ===")
import glob
rest = glob.glob(os.path.join(BASE, "tenant_9.db*")) + glob.glob(os.path.join(BASE, "db", "tenant_*.db*"))
print("   tenant_9 / db 目录残留:", rest or "无")
m = sqlite3.connect(os.path.join(BASE, "erp.db"))
print("   tenants:", m.execute("SELECT id,name FROM tenants ORDER BY id").fetchall())
print("   tenant_id=9 成员行:", m.execute("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=9").fetchone()[0])
m.close()
print("   现役 tenant_*.db:", sorted(glob.glob(os.path.join(BASE, "tenant_*.db"))))
print()
print("BACKUP_tenant9=%s" % dstp)
print("BACKUP_shell=%s" % dstp2)
