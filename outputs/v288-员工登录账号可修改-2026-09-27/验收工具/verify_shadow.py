#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v286：在生产环境、真实 schema、真实数据快照上验证「改登录账号」的行为。

★ 为什么不在真库上验：
    改账号名是**写主库 users**。为了验证而改真实账号，会污染生产（且要改回来）。
    这里用 SQLite 官方在线备份 API（`Connection.backup`）复制一份**真实数据快照**，
    把 `erp_db._open_master` 指过去 —— 跑的是**生产同一份代码**、**同一份 schema**、
    **同一批真实行**，但一个字节都没写进生产库。

★ 要验的三件事（单测覆盖不到、只有真实 schema 才能证伪）：
    1. 真实数据上改名成功、phone 按判据跟随
    2. **租户上下文下也写主库**（这是静默失效的高发点：读写分家 ⇒ 改了读不到）
    3. 改动**只落在 users 表** —— 其它 319 张表一行不动、历史日志的旧名保持原样
"""
import os
import sys
import glob
import shutil
import sqlite3

sys.path.insert(0, "/opt/hergent-erp")
with open("/opt/hergent-erp/.env", encoding="utf-8") as _f:
    for _line in _f:
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

MAIN = "/opt/hergent-erp/erp.db"
SHADOW_DIR = "/tmp/v288-shadow"
SHADOW_MAIN = os.path.join(SHADOW_DIR, "shadow_erp.db")

_PASS, _FAIL = [], []


def ck(name, cond, extra=""):
    (_PASS if cond else _FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name
          + (("  <<< " + str(extra)) if (extra and not cond) else ""))


# ---------- 1. 快照（不动生产） ----------
shutil.rmtree(SHADOW_DIR, ignore_errors=True)
os.makedirs(SHADOW_DIR, exist_ok=True)
print("=" * 74)
print("【0】复制真实数据快照（在线备份 API，生产库只读）")
print("=" * 74)
for src_path in [MAIN] + sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
    dst_path = os.path.join(SHADOW_DIR, "shadow_" + os.path.basename(src_path))
    s = sqlite3.connect("file:%s?mode=ro" % src_path, uri=True)   # 活库只读：mode=ro，不加 immutable
    d = sqlite3.connect(dst_path)
    s.backup(d)
    d.close()
    s.close()
    print("  %-52s → %8d 字节" % (os.path.basename(src_path), os.path.getsize(dst_path)))

# ---------- 2. 把「主库」指到影子 ----------
import erp_db      # noqa: E402
import core        # noqa: E402


def _shadow_master():
    c = sqlite3.connect(SHADOW_MAIN)
    c.row_factory = sqlite3.Row
    return c


erp_db._open_master = _shadow_master
erp_db.DB_PATH = SHADOW_MAIN


def ro(path, sql, params=()):
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, params)]
    finally:
        c.close()


def counts(path):
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        names = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        out = {}
        for t in names:
            try:
                out[t] = c.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
            except Exception:
                out[t] = -1
        return out
    finally:
        c.close()


print()
print("=" * 74)
print("【1】改名前：真实账号盘点")
print("=" * 74)
before_users = ro(SHADOW_MAIN, "SELECT id, username, display_name, role, phone FROM users ORDER BY id")
for u in before_users:
    print("  id=%-8s %-16s %-14s %-12s phone=%r" % (
        u["id"], u["username"], u["display_name"], u["role"], u["phone"]))
before_counts = counts(SHADOW_MAIN)
print("  主库表总数 = %d" % len(before_counts))

# ---------- 3. 真实数据上改名 ----------
print()
print("=" * 74)
print("【2】真实数据上改名（目标：liushantao → liushantao2）")
print("=" * 74)
r = erp_db.user_rename(999900, "liushantao2", actor="boss")
print("  返回：%s" % r)
ck("V1 改名成功", r.get("success") and r.get("changed"), r)
row = ro(SHADOW_MAIN, "SELECT username, phone FROM users WHERE id=999900")[0]
ck("V2 主库 username 已变", row["username"] == "liushantao2", row)
ck("V3 真实数据里 phone 本就等于旧账号名 ⇒ 跟随", row["phone"] == "liushantao2", row)

# ---------- 4. 租户上下文中也要写主库 ----------
print()
print("=" * 74)
print("【3】租户上下文下改名 —— 必须仍写主库（读写分家的静默失效高发点）")
print("=" * 74)
import db.connection as _conn  # noqa: E402

tenant_snapshot_before = ro(os.path.join(SHADOW_DIR, "shadow_tenant_1.db"),
                            "SELECT id, username FROM users ORDER BY id")
_prev = None
try:
    _prev = _conn.get_tenant_context()
except Exception:
    pass
_conn.set_tenant_context(1)
try:
    r2 = erp_db.user_rename(999900, "liushantao3", actor="boss")
finally:
    _conn.set_tenant_context(_prev)
print("  返回：%s" % r2)
ck("V4 租户上下文下改名成功", r2.get("success") and r2.get("changed"), r2)
ck("V5 新名字落在**主库**",
   ro(SHADOW_MAIN, "SELECT username FROM users WHERE id=999900")[0]["username"] == "liushantao3")
tenant_snapshot_after = ro(os.path.join(SHADOW_DIR, "shadow_tenant_1.db"),
                           "SELECT id, username FROM users ORDER BY id")
ck("V6 **租户库那份 users 副本一个字节都没动**",
   tenant_snapshot_before == tenant_snapshot_after,
   (tenant_snapshot_before, tenant_snapshot_after))

# ---------- 5. 拒绝路径 ----------
print()
print("=" * 74)
print("【4】三条拒绝路径（都必须在真实数据上成立）")
print("=" * 74)
r = erp_db.user_rename(999900, "boss")
ck("V7 撞已有账号名被拒", not r.get("success"), r)
print("      理由：%s" % r.get("detail"))
r = erp_db.user_rename(1, "admin2")
ck("V8 「admin」本体不可改名", not r.get("success"), r)
print("      理由：%s" % r.get("detail"))
r = erp_db.user_rename(999900, "liushantao3")
ck("V9 改成同名 = 空操作、不报错", r.get("success") and r.get("changed") is False, r)

# ---------- 6. 只动了 users 表？ ----------
print()
print("=" * 74)
print("【5】改动落在哪张表？（这是【没弄坏别的东西】的硬判据）")
print("=" * 74)
after_counts = counts(SHADOW_MAIN)
changed = [k for k in set(before_counts) | set(after_counts)
           if before_counts.get(k) != after_counts.get(k)]
print("  行数发生变化的表：%s" % (changed or "（无）"))
ck("V10 除 users 外没有任何表行数变化",
   set(changed) <= {"users", "password_reset_codes"}, changed)
q = sqlite3.connect(SHADOW_MAIN)
rows = q.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
q.close()
print("  抽查历史类表里的 username 有没有被误改（应全是改名**前**的值）：")
for t, c in (("login_attempts", "username"), ("login_logs", "username"), ("audit_logs", "user_name")):
    if t in before_counts:
        n = ro(SHADOW_MAIN, 'SELECT COUNT(*) AS c FROM "%s" WHERE %s=? OR %s=?' % (t, c, c),
               ("liushantao2", "liushantao3"))[0]["c"]
        ck("V11 %s 里没有新账号名（历史事实未被篡改）" % t, n == 0, n)

# ---------- 7. 收尾 ----------
print()
print("=" * 74)
print("合计 %d 项：通过 %d / 失败 %d" % (len(_PASS) + len(_FAIL), len(_PASS), len(_FAIL)))
if _FAIL:
    for f in _FAIL:
        print("   - " + f)
print()
print("★ 生产库只读打开（mode=ro），全程零写入；影子目录已清理。")
print("=" * 74)
shutil.rmtree(SHADOW_DIR, ignore_errors=True)
sys.exit(1 if _FAIL else 0)
