#!/usr/bin/env python3
"""重置码链路本地语义验证（不碰生产库）。

做法：把 `core` 与 `fastapi` 两个依赖 mock 掉，指向一个临时 sqlite 库，
然后直接调 `password_reset` 的真实函数。这样能验证**业务规则**，
而不需要起服务、也不需要生产数据。

覆盖的规则（每条都对应模块 docstring 里的一个安全约束）：
  1  生成码 -> 用码改密成功，返回 6 位数字
  2  成功后 users.password_changed 置 1
  3  成功后该用户全部会话被删除（忘记密码场景下账号可能已被他人掌握）
  4  码一次性：同一张码第二次用失败
  5  密码策略：弱密码（不足 8 位 / 无字母数字组合）被拒，且**不消耗**码
  6  错码：返回剩余次数
  7  错 5 次：码作废，第 6 次提示重新索取
  8  过期码：被拒
  9  生成新码自动作废旧码
 10  禁用账号：不能生成码、也不能用码
 11  不存在的用户名：不泄露"用户不存在"（与码错同一句文案）
 12  用户名大小写容错（COLLATE NOCASE）
 13  count_open_codes 统计正确
"""
import hashlib
import os
import sqlite3
import sys
import tempfile
import types
from datetime import datetime, timedelta

SERVER_DIR = "/Users/zhangjunfeng/Documents/hergent-erp/server"
TMP = tempfile.mkdtemp(prefix="pr-verify-")
DB = os.path.join(TMP, "master.db")

# ---- mock core（真实 core 会拉起 FastAPI/多租户，与本验证无关）----
fake_core = types.ModuleType("core")
fake_core.SECRET = "unit-test-secret"


class _FakeDB:
    DB_PATH = DB


fake_core.db = _FakeDB()


def _validate_password(pw):
    if not pw or len(pw) < 8:
        return False, "密码至少需要8位"
    if not (any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw)):
        return False, "密码需要同时包含数字和字母"
    return True, ""


def _hpw(pw):
    return "bcrypt2$fake$" + hashlib.sha256(str(pw).encode()).hexdigest()


fake_core._validate_password = _validate_password
fake_core._hpw = _hpw
sys.modules["core"] = fake_core

# ---- mock fastapi.HTTPException ----
fake_fastapi = types.ModuleType("fastapi")


class HTTPException(Exception):
    def __init__(self, status_code, detail=""):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


fake_fastapi.HTTPException = HTTPException
sys.modules["fastapi"] = fake_fastapi

sys.path.insert(0, SERVER_DIR)
import password_reset as pr  # noqa: E402

# ---- 建"主库"骨架 ----
c = sqlite3.connect(DB)
c.executescript("""
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  display_name TEXT DEFAULT '',
  role TEXT DEFAULT 'user',
  is_active INTEGER DEFAULT 1,
  password_changed INTEGER DEFAULT 0
);
CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT);
""")
c.execute("INSERT INTO users (username,password_hash,display_name,role,is_active,password_changed) "
          "VALUES ('bossy','old-hash','张老板','boss',1,1)")
c.execute("INSERT INTO users (username,password_hash,display_name,role,is_active,password_changed) "
          "VALUES ('sales01','old-hash','李业务','sales',1,0)")
c.execute("INSERT INTO users (username,password_hash,display_name,role,is_active,password_changed) "
          "VALUES ('disabled1','old-hash','停用的人','sales',0,1)")
c.execute("INSERT INTO sessions (token,user_id,created_at) VALUES ('tok-a',2,'2026-09-18 10:00:00')")
c.execute("INSERT INTO sessions (token,user_id,created_at) VALUES ('tok-b',2,'2026-09-18 11:00:00')")
c.commit()
c.close()

pr.ensure_tables()

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  | " + str(extra)) if extra else ""))


def uid_of(username):
    conn = sqlite3.connect(DB)
    r = conn.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    return r[0] if r else 0


def pchg_of(username):
    conn = sqlite3.connect(DB)
    r = conn.execute("SELECT password_changed, password_hash FROM users WHERE username=?",
                     (username,)).fetchone()
    conn.close()
    return (r[0], r[1]) if r else (None, None)


def sessions_of(username):
    conn = sqlite3.connect(DB)
    r = conn.execute("SELECT COUNT(*) FROM sessions s JOIN users u ON u.id=s.user_id "
                     "WHERE u.username=?", (username,)).fetchone()[0]
    conn.close()
    return r


print("=" * 68)
print("T1 生成码")
res = pr.issue_code_for_user(uid_of("sales01"), created_by="bossy")
code = res["code"]
check("生成 6 位纯数字码", len(code) == 6 and code.isdigit(), "code=%s" % code)
check("返回用户名与有效期", res["username"] == "sales01" and bool(res["expires_at"]))
check("有效期约 30 分钟后", res["expires_at"] > datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

print("T2 弱密码不消耗码")
ok, msg = pr.reset_password_with_code("sales01", code, "short1")
check("不足 8 位被拒", (not ok) and "8" in msg, msg)
ok, msg = pr.reset_password_with_code("sales01", code, "12345678")
check("纯数字被拒", (not ok) and "字母" in msg, msg)
check("弱密码失败后码仍有效", pr.count_open_codes(uid_of("sales01")) == 1)

print("T3 错码与剩余次数")
ok, msg = pr.reset_password_with_code("sales01", "000000", "Newpass123")
check("错码被拒且提示剩余次数", (not ok) and "4" in msg, msg)
for _ in range(3):
    ok, msg = pr.reset_password_with_code("sales01", "000000", "Newpass123")
ok, msg = pr.reset_password_with_code("sales01", "000000", "Newpass123")
check("第 5 次错码后作废", (not ok) and "作废" in msg, msg)
check("作废后无有效码", pr.count_open_codes(uid_of("sales01")) == 0)
ok, msg = pr.reset_password_with_code("sales01", code, "Newpass123")
check("已作废的码不能再用", not ok, msg)

print("T4 正确码改密成功")
res = pr.issue_code_for_user(uid_of("sales01"), created_by="bossy")
code = res["code"]
check("重新生成可用码", len(code) == 6 and code.isdigit())
check("会话此时为 2 条（用于验证改密后清空）", sessions_of("sales01") == 2)
ok, msg = pr.reset_password_with_code("sales01", code, "Newpass123")
check("用正确码改密成功", ok, msg)
pc, ph = pchg_of("sales01")
check("password_changed 置 1", pc == 1, "pc=%s" % pc)
check("密码哈希已更新", ph == _hpw("Newpass123"))
check("该用户全部会话被删除", sessions_of("sales01") == 0)

print("T5 一次性")
ok, msg = pr.reset_password_with_code("sales01", code, "Another123")
check("同一张码第二次使用被拒", not ok, msg)

print("T6 过期")
res = pr.issue_code_for_user(uid_of("sales01"), created_by="bossy")
code = res["code"]
conn = sqlite3.connect(DB)
past = (datetime.now() - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M:%S")
conn.execute("UPDATE password_reset_codes SET expires_at=? WHERE user_id=? AND used_at=''",
             (past, uid_of("sales01")))
conn.commit()
conn.close()
ok, msg = pr.reset_password_with_code("sales01", code, "Newpass456")
check("过期码被拒", (not ok) and "过期" in msg, msg)

print("T7 生成新码作废旧码")
old = pr.issue_code_for_user(uid_of("sales01"), created_by="bossy")["code"]
new = pr.issue_code_for_user(uid_of("sales01"), created_by="bossy")["code"]
check("两张码不同", old != new)
ok_old, _ = pr.reset_password_with_code("sales01", old, "Newpass789")
ok_new, m_new = pr.reset_password_with_code("sales01", new, "Newpass789")
check("旧码失效", not ok_old)
check("新码可用", ok_new, m_new)

print("T8 不存在的用户 / 禁用账号")
ok, msg = pr.reset_password_with_code("no_such_user", "123456", "Newpass999")
check("未知用户不泄露存在性", (not ok) and msg == "用户名或重置码不正确", msg)
ok, msg = pr.reset_password_with_code("disabled1", "123456", "Newpass999")
check("禁用账号用码被拒", (not ok) and "禁用" in msg, msg)
try:
    pr.issue_code_for_user(uid_of("disabled1"), created_by="bossy")
    check("禁用账号不能生成码", False, "未抛异常")
except HTTPException as e:
    check("禁用账号不能生成码", e.status_code == 400, e.detail)
try:
    pr.issue_code_for_user(999999, created_by="bossy")
    check("不存在的 uid 不能生成码", False, "未抛异常")
except HTTPException as e:
    check("不存在的 uid 不能生成码", e.status_code == 404, e.detail)

print("T9 大小写容错")
res = pr.issue_code_for_user(uid_of("sales01"), created_by="bossy")
ok, msg = pr.reset_password_with_code("SALES01", res["code"], "Newpass321")
check("用户名大写也能匹配", ok, msg)

print("T10 主库表位置")
conn = sqlite3.connect(DB)
tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
conn.close()
check("表建在传入的连接所指库（= 主库）", "password_reset_codes" in tables)

print("=" * 68)
print("PASS %d / FAIL %d" % (len(PASS), len(FAIL)))
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("  -", f)
print("临时库：", DB)
sys.exit(1 if FAIL else 0)
