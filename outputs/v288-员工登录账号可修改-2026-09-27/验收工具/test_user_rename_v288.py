# -*- coding: utf-8 -*-
"""v288（2026-09-27）改登录账号名（users.username）的离线单测。

用法：
  cd server && ERP_SECRET=unit-test-only /usr/bin/python3 tests/test_user_rename_v288.py

⚠️ 本文件**不连生产、不写任何真实库**：
   · `validate_username` 是纯函数
   · `user_rename` 的数据库依赖用「临时文件库 + 替换 `_open_master`」注入，
     真实主库连接**一次都不会被打开**。

为什么要这么测（而不是只测"能改名"）：
   改账号名有 **3 处必须跟着动/不能动** 的副作用，漏任一条都是"看起来成功、留了半截"：
     ① `phone`      —— 只在它等于旧账号名（= 只是拷贝）时跟随，真实手机号不动
     ② 未用重置码    —— 必须同步，否则员工手里那张码当场失效
     ③ 历史日志      —— log/attempt/audit 里的旧名**绝不能动**（那是历史事实）
   外加一条安全判据：`admin` 不可改名（core 启动时按用户名找不到就**再建一个**随机密码管理员）。
"""
import os
import sys
import sqlite3
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
os.environ.setdefault("ERP_SECRET", "unit-test-only")

import core                 # noqa: E402
import erp_db               # noqa: E402
from core import validate_username  # noqa: E402

_PASS, _FAIL = [], []


def ck(name, cond, extra=""):
    (_PASS if cond else _FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name
          + (("  <<< " + str(extra)) if (extra and not cond) else ""))


# ============================================================
# 测试夹具：临时文件库（不用 :memory: —— user_rename 自开连接会 close 它）
# ============================================================
_USERS_DDL = """
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  role TEXT DEFAULT 'user',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  phone TEXT DEFAULT '',
  employee_code TEXT DEFAULT '',
  pinyin TEXT DEFAULT '',
  department_id INTEGER DEFAULT 0,
  mfa_secret TEXT DEFAULT '',
  mfa_enabled INTEGER DEFAULT 0,
  recovery_codes TEXT DEFAULT '',
  password_changed INTEGER DEFAULT 0,
  employee_id INTEGER DEFAULT 0,
  roles TEXT DEFAULT ''
);
CREATE TABLE password_reset_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT DEFAULT '',
  code_hash TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL,
  used_at TEXT DEFAULT '',
  created_by TEXT DEFAULT ''
);
"""

_FD, _PATH = tempfile.mkstemp(prefix="v288-rename-", suffix=".db")
os.close(_FD)

# 真实连接只在这一处被打开，且指向临时文件
_conn0 = sqlite3.connect(_PATH)
_conn0.executescript(_USERS_DDL)
_conn0.commit()
_conn0.close()

# 🔴 关键替身：把「开主库连接」换成「开这个临时库」。
#    点替换模块全局名，`user_rename` 内部按名查找 ⇒ 生效。
#    ⚠️ 必须设 row_factory —— 真实的两条路（`core._master_db()` 与 `get_db()`→
#    `_sqlite_connect`）**都**设了 `sqlite3.Row`，替身不设就是"替身比真实更弱"，
#    一旦生产代码用了 `row["col"]` 就会在替身上假失败（正是本轮踩到的）。
def _fake_master():
    c = sqlite3.connect(_PATH)
    c.row_factory = sqlite3.Row
    return c


erp_db._open_master = _fake_master


def q(sql, params=()):
    c = sqlite3.connect(_PATH)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, params)]
    finally:
        c.close()


def seed():
    """重建 2 个账号 + 2 张重置码（未用 / 已用各一）。"""
    c = sqlite3.connect(_PATH)
    c.executescript("DELETE FROM users; DELETE FROM password_reset_codes;")
    c.execute("INSERT INTO users (id,username,password_hash,display_name,role,is_active,phone,employee_id) "
              "VALUES (999900,'liushantao','h','刘善涛','sales',1,'liushantao',6)")
    c.execute("INSERT INTO users (id,username,password_hash,display_name,role,is_active,phone,employee_id) "
              "VALUES (2,'boss','h','张俊峰','boss',1,'',7)")
    c.execute("INSERT INTO users (id,username,password_hash,display_name,role,is_active,phone,employee_id) "
              "VALUES (1,'admin','h','管理员','admin',1,'',1)")
    c.execute("INSERT INTO password_reset_codes (user_id,username,code_hash,expires_at,used_at) "
              "VALUES (999900,'liushantao','HASH1','2099-01-01 00:00:00','')")
    c.execute("INSERT INTO password_reset_codes (user_id,username,code_hash,expires_at,used_at) "
              "VALUES (999900,'liushantao','HASH2','2020-01-01 00:00:00','2026-09-01 10:00:00')")
    c.commit()
    c.close()


print("=" * 72)
print("v288 改登录账号名 · 离线单测")
print("=" * 72)

# ============================================================
# A. core.validate_username —— 唯一校验实现
# ============================================================
print()
print("【A】core.validate_username（两个写入口共用的唯一校验）")

ok, msg = validate_username("")
ck("A1 空串被拒", not ok, msg)
ok, msg = validate_username("a")
ck("A2 仅 1 个字符被拒", not ok, msg)
ok, msg = validate_username("ab")
ck("A3 2 个字符通过（下界）", ok, msg)
ok, msg = validate_username("a" * 32)
ck("A4 32 个字符通过（上界）", ok, msg)
ok, msg = validate_username("a" * 33)
ck("A5 33 个字符被拒（超上界）", not ok, msg)
ok, msg = validate_username("admin")
ck("A6 「admin」被拒（否则重启会凭空多一个随机密码管理员）", not ok, msg)
ok, msg = validate_username("ADMIN")
ck("A7 「ADMIN」同样被拒（大小写不敏感）", not ok, msg)
ck("A8 纯空白被拒", not validate_username("   ")[0])
ck("A9 中文账号名可通过", validate_username("刘善涛")[0])
ck("A10 带点/下划线/数字可通过", validate_username("liu.shan_tao2")[0], validate_username("liu.shan_tao2")[1])

# ============================================================
# B. _conn_is_master —— 防「写进租户库那份 users 副本」
# ============================================================
print()
print("【B】erp_db._conn_is_master（连接是否指向主库）")

_mem = sqlite3.connect(":memory:")
ck("B1 内存库不被当成主库（file 为空）", erp_db._conn_is_master(_mem) is False)
_mem.close()

_real_db_path = erp_db.DB_PATH
erp_db.DB_PATH = _PATH          # 假扮"主库就是刚才那个临时文件"
ck("B2 指向主库路径的连接被认出（=True）", erp_db._conn_is_master(sqlite3.connect(_PATH)) is True)
erp_db.DB_PATH = _real_db_path
ck("B3 路径不匹配时不认（=False）", erp_db._conn_is_master(sqlite3.connect(_PATH)) is False)

# 🔴 C 段开始前把「主库」**持久**指向临时库。
#    不这么做的话 `_conn_is_master` 对临时库一律返回 False ⇒ 每个 conn 都被换成
#    `_open_master()` ⇒ **C21（复用调用方连接时不擅自提交）根本没测到那条路**
#    （本轮实测踩过：C21 假通过了一次，因为改动其实走的是另一条连接）。
erp_db.DB_PATH = _PATH

# ============================================================
# C. user_rename —— 改名本体与 3 处副作用
# ============================================================
print()
print("【C】erp_db.user_rename —— 改名 + phone 跟随 + 重置码同步")

seed()
r = erp_db.user_rename(999900, "liushantao2", actor="boss")
ck("C1 改名成功（success=True / changed=True）",
   r.get("success") and r.get("changed"), r)
ck("C2 返回值带 old→new", r.get("old") == "liushantao" and r.get("new") == "liushantao2", r)
row = q("SELECT username FROM users WHERE id=999900")[0]
ck("C3 库里 username 真的变了", row["username"] == "liushantao2", row["username"])
row = q("SELECT phone FROM users WHERE id=999900")[0]
ck("C4 phone 原本是账号名的拷贝 ⇒ 跟随更新", row["phone"] == "liushantao2", row["phone"])
ck("C5 返回值标了 phone_synced", r.get("phone_synced") is True, r)
codes = q("SELECT code_hash, username, used_at FROM password_reset_codes WHERE user_id=999900 ORDER BY id")
ck("C6 未用重置码同步到新名（否则员工手里那张码当场失效）",
   codes[0]["username"] == "liushantao2", codes[0])
ck("C7 已用过的重置码**不动**（历史事实）",
   codes[1]["username"] == "liushantao", codes[1])
ck("C8 codes_synced 计数 = 1（只数未用的）", r.get("codes_synced") == 1, r)

seed()
r = erp_db.user_rename(2, "boss")
ck("C9 改成同名 = 空操作，不报错（changed=False）",
   r.get("success") and r.get("changed") is False, r)

seed()
r = erp_db.user_rename(999900, "boss")
ck("C10 撞已存在的账号名被拒", not r.get("success"), r)
ck("C11 拒绝理由里点名「已被占用」", "已被占用" in (r.get("detail") or ""), r.get("detail"))

seed()
r = erp_db.user_rename(999900, "Boss")
ck("C12 大小写不同也算冲突被拒（重置码是按 NOCASE 查的）", not r.get("success"), r)

seed()
r = erp_db.user_rename(1, "admin2")
ck("C13 「admin」本体不可改名", not r.get("success"), r)
ck("C14 提示说明是系统内置账号", "系统内置" in (r.get("detail") or ""), r.get("detail"))

seed()
r = erp_db.user_rename(424242, "someone")
ck("C15 目标账号不存在 ⇒ 明确报「账号不存在」", not r.get("success"), r)

seed()
c = sqlite3.connect(_PATH)
c.execute("UPDATE users SET phone='13800000001' WHERE id=999900")
c.commit()
c.close()
r = erp_db.user_rename(999900, "liushantao2", actor="boss")
row = q("SELECT phone FROM users WHERE id=999900")[0]
ck("C16 phone 是**真实手机号**时不动（不把手机号冲掉）", row["phone"] == "13800000001", row["phone"])
ck("C17 返回值 phone_synced=False", r.get("phone_synced") is False, r)

seed()
r = erp_db.user_rename(999900, "x")
ck("C18 过短的新账号名被拒（走 validate_username，不另写一份）", not r.get("success"), r)
ck("C19 被拒时库里没被改坏", q("SELECT username FROM users WHERE id=999900")[0]["username"] == "liushantao")

# ---- C20：传入一个**非主库**连接时，改动必须落到主库 ----
# 判据：调用方传了内存库连接，`user_rename` 应识破并改用 `_open_master()`（=临时文件库）。
seed()
_mem2 = sqlite3.connect(":memory:")
_mem2.executescript(_USERS_DDL)
_mem2.execute("INSERT INTO users (id,username,password_hash,role,is_active,phone) "
              "VALUES (999900,'liushantao','h','sales',1,'liushantao')")
_mem2.commit()
r = erp_db.user_rename(999900, "liushantao9", conn=_mem2)
_on_mem = _mem2.execute("SELECT username FROM users WHERE id=999900").fetchone()[0]
_mem2.close()
_on_main = q("SELECT username FROM users WHERE id=999900")[0]["username"]
ck("C20a 传进来的非主库连接未被写入（识别出了库不对）", _on_mem == "liushantao", _on_mem)
ck("C20b 改动落在主库上", _on_main == "liushantao9", _on_main)

# ---- C21：复用调用方连接（=profile 那条路）时**不自己提交**，交给调用方 ----
seed()
_own = sqlite3.connect(_PATH)
_own.row_factory = sqlite3.Row     # 真实调用方（get_db）也会设，替身保持一致
_own.execute("BEGIN")
erp_db.user_rename(999900, "liushantao3", conn=_own)
_own.rollback()          # 模拟调用方回滚
_own.close()
ck("C21 调用方回滚 ⇒ 改名一起回滚（复用连接时不擅自提交）",
   q("SELECT username FROM users WHERE id=999900")[0]["username"] == "liushantao",
   q("SELECT username FROM users WHERE id=999900")[0]["username"])

# ============================================================
print()
print("=" * 72)
print("合计 %d 项：通过 %d / 失败 %d" % (len(_PASS) + len(_FAIL), len(_PASS), len(_FAIL)))
if _FAIL:
    print("失败项：")
    for f in _FAIL:
        print("   - " + f)
print("=" * 72)
try:
    os.unlink(_PATH)
except Exception:
    pass
sys.exit(1 if _FAIL else 0)
