#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 沙箱 tenant_9997 销毁 —— 顺序很重要。

🔴 为什么「先删文件、再重启服务」而不是反过来：
   本会话亲历的事故 —— `db/connection.py::_sqlite_connect()` 按
   `(threading.get_ident(), db_path)` 缓存连接。服务运行中 `os.remove` + 重建同一个
   库文件 ⇒ 缓存连接仍指向**已被删除的旧 inode**：写入落进幽灵文件、读取返回旧数据，
   且 `conn.execute("SELECT 1")` **测不出来**（它对已删句柄照样成功）。
   所以销毁后必须 `systemctl restart` 清空 `_sqlite_cache`，否则「9997」这个键会永久
   挂着一个野句柄 —— 万一将来真有租户拿到这个 id，就会踩同一个坑。
"""
import os
import sqlite3
import subprocess

ROOT = "/opt/hergent-erp"
SBX = ROOT + "/tenant_9997.db"
TID = 9997

print("=" * 70)
print("0 · 销毁前")
print("=" * 70)
c = sqlite3.connect(ROOT + "/erp.db")
print("  tenants      :", c.execute("SELECT id,name FROM tenants ORDER BY id").fetchall())
print("  user_tenants :", c.execute("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (TID,)).fetchone()[0], "行(9997)")
print("  sbx 文件      :", [os.path.basename(p) for p in
                          [SBX, SBX + "-wal", SBX + "-shm"] if os.path.exists(p)])

print()
print("=" * 70)
print("1 · 注销租户（主库两处登记）")
print("=" * 70)
n1 = c.execute("DELETE FROM user_tenants WHERE tenant_id=?", (TID,)).rowcount
n2 = c.execute("DELETE FROM tenants WHERE id=?", (TID,)).rowcount
c.commit()
print("  user_tenants 删除 %d 行 / tenants 删除 %d 行" % (n1, n2))
print("  残留 user_tenants(9997) =",
      c.execute("SELECT COUNT(*) FROM user_tenants WHERE tenant_id=?", (TID,)).fetchone()[0])
print("  残留 tenants(9997)      =",
      c.execute("SELECT COUNT(*) FROM tenants WHERE id=?", (TID,)).fetchone()[0])
print("  tenants      :", c.execute("SELECT id,name FROM tenants ORDER BY id").fetchall())
c.close()

print()
print("=" * 70)
print("2 · 删除沙箱库文件")
print("=" * 70)
for p in (SBX, SBX + "-wal", SBX + "-shm"):
    if os.path.exists(p):
        os.remove(p)
        print("  rm", p)
    else:
        print("  (不存在)", p)
print("  残留同名文件:", [os.path.basename(p) for p in
                          [SBX, SBX + "-wal", SBX + "-shm"] if os.path.exists(p)] or "无 ✓")

print()
print("=" * 70)
print("3 · 重启服务（清 _sqlite_cache 里的野句柄）")
print("=" * 70)
r = subprocess.run(["systemctl", "restart", "hergent-erp"], capture_output=True, text=True)
print("  restart 退出码 =", r.returncode, r.stderr.strip()[:200])
r2 = subprocess.run(["systemctl", "is-active", "hergent-erp"], capture_output=True, text=True)
print("  is-active =", r2.stdout.strip())
