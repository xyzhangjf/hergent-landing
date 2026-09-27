#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v289：在**生产环境 + 真实 schema + 真实数据快照**上，端到端验证密码门槛。

★ 为什么不在真库上验
    三个写入口都会改数据（建账号 / 改密码哈希）。为了验证而改真实账号会污染生产。
    这里用 SQLite 官方在线备份 API（`Connection.backup`）复制**真实数据快照**，
    再把 `erp_db.DB_PATH` 指过去 —— 跑的是**生产同一份代码**、**同一份 schema**、
    **同一批真实行**，但**一个字节都没写进生产库**。

★ 要验什么（单测覆盖不到的部分）
    单测只证明「`_validate_password` 对 4 位返回 False」＋「端点源码里调了它」。
    这里补上**端点的真实执行**：把请求真的送进 `create_staff_account` /
    `reset_user_password`，看它到底拒没拒 —— 也就是用户报的那个现场。

★ 反例对照法（关键）
    只证明"4 位被拒"是不够的 —— 端点可能因**任何**原因报错（权限、参数、库故障），
    恰好也返回 400，看起来就"对了"。所以必须同时给**合法密码**，证明：
      · 4 位       → 报「密码至少需要8位」        （被拒的原因**是**密码）
      · 8 位纯字母 → 报「密码需要同时包含数字和字母」
      · 合法 8 位   → **不再**报任何密码相关错误     （被拒的原因**确实是**密码）
"""
import asyncio
import glob
import json
import os
import shutil
import sqlite3
import sys

sys.path.insert(0, "/opt/hergent-erp")
with open("/opt/hergent-erp/.env", encoding="utf-8") as _f:
    for _line in _f:
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

MAIN = "/opt/hergent-erp/erp.db"
SHADOW_DIR = "/tmp/v289-shadow"
SHADOW_MAIN = os.path.join(SHADOW_DIR, "shadow_erp.db")

_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)

_PASS, _FAIL = [], []


def ck(name, cond, extra=""):
    (_PASS if cond else _FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name
          + (("  <<< " + str(extra)) if (extra and not cond) else ""))


# ---------- 0. 快照（生产库只读） ----------
shutil.rmtree(SHADOW_DIR, ignore_errors=True)
os.makedirs(SHADOW_DIR, exist_ok=True)
print("=" * 74)
print("【0】复制真实数据快照（在线备份 API，生产库只读打开）")
print("=" * 74)
_prod_stat_before = (os.path.getsize(MAIN), os.path.getmtime(MAIN))
for src_path in [MAIN] + sorted(glob.glob("/opt/hergent-erp/tenant_*.db")):
    dst_path = os.path.join(SHADOW_DIR, "shadow_" + os.path.basename(src_path))
    s = sqlite3.connect("file:%s?mode=ro" % src_path, uri=True)   # 活库只读：mode=ro，不加 immutable
    d = sqlite3.connect(dst_path)
    s.backup(d)
    d.close()
    s.close()
    print("  %-46s → %10d 字节" % (os.path.basename(src_path), os.path.getsize(dst_path)))

# ---------- 1. 把「主库」指到影子 ----------
import erp_db                                    # noqa: E402
import db.connection as _dbc                     # noqa: E402
import core                                      # noqa: E402

# 🔴 v289 教训（本脚本第一次跑时真的踩了，把生产上提审账号的密码改了）：
#    这个项目里 **DB_PATH 有两份**，不是一个：
#      · `erp_db.DB_PATH`（能被 core._master_db() 读到）—— 只 patch 它 ⇒ **认证**走影子 ✅
#      · `db/connection.py:11` 自己又定义了一份 DB_PATH，`get_db()` / `_sqlite_connect()`
#        用的是**它自己那份** ⇒ 只 patch 上面那个 ⇒ **写库**仍落在生产 🔴
#    所以两处都要指过去，而且**必须自证**（见下面【1.5】），否则脚本会"看起来在影子库上跑"。
erp_db.DB_PATH = SHADOW_MAIN
_dbc.DB_PATH = SHADOW_MAIN
print("\n  主库已指向影子：")
print("    erp_db.DB_PATH        = %s" % erp_db.DB_PATH)
print("    db.connection.DB_PATH = %s" % _dbc.DB_PATH)

# ---------- 1.5 自证：确实连在影子上（不通过就中止，宁可不验也不能污染生产） ----------
_sh = sqlite3.connect(SHADOW_MAIN)
_sh.row_factory = sqlite3.Row
print()
print("=" * 74)
print("【1.5】自证：两条连接路径都必须落在影子库上")
print("=" * 74)
ok_shadow = True
with erp_db.get_db() as _c:                       # 写路径（端点就是这么拿连接的）
    _rows = {r[1]: r[2] for r in _c.execute("PRAGMA database_list")}
    _main = _rows.get("main", "")
    _same = os.path.realpath(_main) == os.path.realpath(SHADOW_MAIN)
    ok_shadow = ok_shadow and _same
    print("  get_db()       → %-46s %s" % (_main, "✅ 影子" if _same else "🔴 不是影子！"))
_m2 = erp_db._open_master()
_r2 = {r[1]: r[2] for r in _m2.execute("PRAGMA database_list")}
_m2.close()
_same2 = os.path.realpath(_r2.get("main", "")) == os.path.realpath(SHADOW_MAIN)
ok_shadow = ok_shadow and _same2
print("  _open_master() → %-46s %s" % (_r2.get("main", ""), "✅ 影子" if _same2 else "🔴 不是影子！"))
if not ok_shadow:
    print("\n  🔴 影子库 patch 未生效 —— **立即中止**，绝不拿生产库做验收。")
    sys.exit(2)
print("  ⇒ 两条路径都在影子库上，后续任何写入都不会碰生产。")

# ---------- 2. 在**影子库**里造一个管理员会话（不碰生产） ----------
print()
print("=" * 74)
print("【1】在影子库造一个管理员会话（只为本次验收；生产上不存在这个 token）")
print("=" * 74)
_boss = _sh.execute(
    "SELECT id, username, role FROM users WHERE role IN ('admin','boss') "
    "AND is_active=1 ORDER BY (role='admin') DESC, id LIMIT 1").fetchone()
if not _boss:
    print("  🔴 影子库里没有可用的 admin/boss 账号，无法继续")
    sys.exit(1)
PROBE_TOKEN = "V289-PROBE-TOKEN-NOT-REAL"
_sh.execute(
    "INSERT OR REPLACE INTO sessions (token, user_id, created_at, expires_at, ip_address, "
    "user_agent_hash, last_activity) VALUES (?,?,datetime('now','localtime'),"
    "datetime('now','localtime','+1 day'),'127.0.0.1','v289probe',"
    "datetime('now','localtime'))", (PROBE_TOKEN, _boss["id"]))
_sh.commit()
print("  以 users.id=%s（%s / %s）的身份发请求"
      % (_boss["id"], _boss["username"], _boss["role"]))

_target = _sh.execute(
    "SELECT id, username, password_hash FROM users WHERE username='liushantao'").fetchone()
if not _target:
    _target = _sh.execute(
        "SELECT id, username, password_hash FROM users WHERE id != ? AND is_active=1 "
        "ORDER BY id DESC LIMIT 1", (_boss["id"],)).fetchone()
print("  目标账号：users.id=%s（%s）" % (_target["id"], _target["username"]))

_users_before = _sh.execute("SELECT COUNT(*) FROM users").fetchone()[0]
_hash_before = _target["password_hash"]


# ---------- 3. 造一个「真实」的 Request ----------
def make_request(payload, path="/api/forecast-submissions/staff-accounts"):
    """构造 Starlette Request —— 让 `_resolve_auth` 能按正常路径认出上面那个会话。"""
    from starlette.requests import Request
    body = json.dumps(payload).encode("utf-8")

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http", "http_version": "1.1", "method": "POST", "scheme": "http",
        "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "",
        "headers": [(b"authorization", ("Bearer " + PROBE_TOKEN).encode()),
                    (b"content-type", b"application/json")],
        "client": ("127.0.0.1", 51234), "server": ("127.0.0.1", 8700), "state": {},
    }
    return Request(scope, receive)


async def call(fn, *args, payload=None, path=None):
    """调端点，把 HTTPException 变成 (status, detail)；正常返回 (200, None)。"""
    from fastapi import HTTPException
    req = make_request(payload, path or "/api/forecast-submissions/staff-accounts")
    try:
        await fn(*args, req)
        return 200, None
    except HTTPException as e:
        return e.status_code, str(e.detail)
    except Exception as e:                                   # noqa: BLE001
        return -1, "%s: %s" % (type(e).__name__, e)


print()
print("=" * 74)
print("【2】端点级验收 —— 开通员工账号 POST /api/forecast-submissions/staff-accounts")
print("     （改前这里是 `len(password) < 4`：4 位就能建号）")
print("=" * 74)
import routers.forecast_submissions as fs      # noqa: E402

EMP = _sh.execute("SELECT id FROM hr_employees ORDER BY id LIMIT 1").fetchone()
EMP_ID = int(EMP["id"]) if EMP else 999999999
print("  用于建号的 employee_id = %s%s" % (EMP_ID, "" if EMP else "（影子主库里没有 hr_employees 行 —— 员工档案在租户库）"))
print()


def _acc(pw):
    return {"employee_id": EMP_ID, "username": "__v289_probe__", "password": pw,
            "display_name": "v289 probes", "role": "staff"}


st, detail = _LOOP.run_until_complete(
    call(fs.create_staff_account, payload=_acc("abcd")))
ck("E1  4 位密码被拒（400）", st == 400, "实际 %s %s" % (st, detail))
ck("E2  拒因是「密码至少需要8位」", detail and "8" in detail, detail)

st, detail = _LOOP.run_until_complete(
    call(fs.create_staff_account, payload=_acc("abcdefgh")))
ck("E3  8 位纯字母被拒（须含数字）", st == 400, "实际 %s %s" % (st, detail))
ck("E4  拒因提到「数字和字母」", detail and "数字" in detail and "字母" in detail, detail)

st, detail = _LOOP.run_until_complete(
    call(fs.create_staff_account, payload=_acc("Sample1234")))
ck("E5  合法 8 位密码**不再报密码错**（反例对照）",
   not (detail and ("8" in detail and "密码" in detail)), "实际 %s %s" % (st, detail))

print()
print("=" * 74)
print("【3】端点级验收 —— 老板重置员工密码 POST /api/users/{uid}/password")
print("     （改前这条已走权威函数；本轮只是确认没被改坏）")
print("=" * 74)
import server as _srv                            # noqa: E402

st, detail = _LOOP.run_until_complete(
    call(_srv.reset_user_password, int(_target["id"]),
         payload={"password": "abcd"}, path="/api/users/%s/password" % _target["id"]))
ck("E6  4 位密码被拒（400）", st == 400, "实际 %s %s" % (st, detail))
ck("E7  拒因是「密码至少需要8位」", detail and "8" in detail, detail)

st, detail = _LOOP.run_until_complete(
    call(_srv.reset_user_password, int(_target["id"]),
         payload={"password": "Sample1234"}, path="/api/users/%s/password" % _target["id"]))
ck("E8  合法 8 位密码被接受（200，反例对照）", st == 200, "实际 %s %s" % (st, detail))

_sh2 = sqlite3.connect(SHADOW_MAIN)
_sh2.row_factory = sqlite3.Row
_hash_after = _sh2.execute("SELECT password_hash FROM users WHERE id=?",
                           (_target["id"],)).fetchone()["password_hash"]
ck("E9  合法密码**真的写进了影子库**（端点在做正事，不是一律 400）",
   _hash_after != _hash_before)
_sh2.close()

print()
print("=" * 74)
print("【4】零污染自证")
print("=" * 74)
_users_after = _sh.execute("SELECT COUNT(*) FROM users").fetchone()[0]
print("  影子库 users 行数：%d → %d（差额来自 E5 建号，全在影子库）"
      % (_users_before, _users_after))
_check = sqlite3.connect(SHADOW_MAIN)
_n = _check.execute("SELECT COUNT(*) FROM users WHERE username='__v289_probe__'").fetchone()[0]
_check.close()
print("  影子库里新建的探针账号：%d 个" % _n)

_prod_stat_after = (os.path.getsize(MAIN), os.path.getmtime(MAIN))
ck("Z1  生产库 erp.db 大小与 mtime 均未变（全程只读）",
   _prod_stat_before == _prod_stat_after,
   "%s → %s" % (_prod_stat_before, _prod_stat_after))

print()
print("=" * 74)
print("结果：通过 %d / 失败 %d" % (len(_PASS), len(_FAIL)))
print("=" * 74)
_sh.close()
if _FAIL:
    for n in _FAIL:
        print("  🔴 " + n)
    sys.exit(1)
print("  ✅ 全部通过")
