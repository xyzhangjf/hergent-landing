#!/usr/bin/env python3
"""生产环境「忘记密码」全链路 E2E（在服务器上运行）。

为什么必须在生产跑：`password_reset_codes` 是**新建的表**，本地 mock 验证
（password-reset-verify.py，27/27）只能证明业务规则对，证明不了：
  · 真实 erp.db 上 DDL 的列名/类型无误；
  · SQLite 的 CAS（`UPDATE ... WHERE used_at=''` 的 rowcount）在实际库上的行为；
  · 生产 Python 3.10 环境下 bcrypt/哈希链路正常。

数据安全：只创建一个**可识别、无租户绑定**的临时账号 `zz_e2e_pwreset`
（不绑 user_tenants ⇒ 它登不进任何租户、看不到任何业务数据），
跑完彻底删除并做零残留核查。
"""
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request


def _load_env():
    """core.py 在 import 阶段就要求 ERP_SECRET。它配在 /opt/hergent-erp/.env
    （systemd 的 EnvironmentFile=/opt/hergent-erp/.env），普通 shell 没有，
    所以不先注入就一定会 RuntimeError。"""
    try:
        with open("/opt/hergent-erp/.env", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception as e:
        print("warn: 读取 .env 失败:", e)


_load_env()

sys.path.insert(0, "/opt/hergent-erp")
os.chdir("/opt/hergent-erp")
import password_reset as pr  # noqa: E402

DB = "/opt/hergent-erp/erp.db"
U = "zz_e2e_pwreset"
NEW_PW = "E2epass123"
PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  | " + str(extra)) if extra else ""))


def post(path, body):
    """调本机后端。显式禁用代理 —— 本机若有 HTTP_PROXY 会劫持回环请求。"""
    # 后端对 forgot-reset 有 IP 级 3 秒冷却（auth.py 的 `_rate_limited`），
    # 连发会被 429 挡掉（首次实测就撞上了）→ 每次调用前主动让过冷却窗口。
    if path == "/api/auth/forgot-reset":
        time.sleep(3.2)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(
        "http://127.0.0.1:8700" + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener.open(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def q(sql, args=()):
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


def login_ok(username, password):
    """用真实登录接口验证新密码是否生效 —— 比比对哈希更端到端。
    只做正向验证：连续 5 次失败会触发 15 分钟账号锁定，不要拿它试错密码。"""
    st, _ = post("/api/auth/login", {"username": username, "password": password})
    return st == 200


def cleanup():
    c = sqlite3.connect(DB)
    c.execute("DELETE FROM password_reset_codes WHERE username=?", (U,))
    c.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username=?)", (U,))
    c.execute("DELETE FROM users WHERE username=?", (U,))
    c.commit()
    c.close()


print("=" * 68)
print("T0 准备临时账号（可识别、无租户绑定）")
cleanup()
c = sqlite3.connect(DB)
c.execute(
    "INSERT INTO users (username,password_hash,display_name,role,is_active,password_changed) "
    "VALUES (?,?,?,?,1,0)",
    (U, "bcrypt2$placeholder-never-valid", "E2E临时账号", "sales"),
)
uid = c.execute("SELECT id FROM users WHERE username=?", (U,)).fetchone()[0]
c.execute("INSERT INTO sessions (token,user_id,created_at) VALUES ('zz_e2e_tok',?,?)",
          (uid, "2026-09-19 08:00:00"))
c.commit()
c.close()
check("临时账号已建", uid > 0, "uid=%d" % uid)
check("已造 1 条会话用于验证改密后清空",
      len(q("SELECT 1 FROM sessions WHERE user_id=?", (uid,))) == 1)
check("绑定租户数为 0（登不进任何租户）",
      len(q("SELECT 1 FROM user_tenants WHERE user_id=?", (uid,))) == 0)

print("T1 生成重置码（真实主库）")
res = pr.issue_code_for_user(uid, created_by="e2e")
code = res["code"]
check("生成 6 位数字码", len(code) == 6 and code.isdigit(), "code=%s" % code)
check("主库表可写（count_open_codes=1）", pr.count_open_codes(uid) == 1)

print("T2 用错码（HTTP，真实接口）")
st, body = post("/api/auth/forgot-reset",
                {"username": U, "code": "000000", "new_password": NEW_PW})
check("错码返回 400", st == 400, "HTTP=%s" % st)
check("错码文案含剩余次数", "还可尝试" in body, body[:90])
check("错码不消耗码", pr.count_open_codes(uid) == 1)

print("T3 用正确码改密（HTTP，真实接口）")
st, body = post("/api/auth/forgot-reset",
                {"username": U, "code": code, "new_password": NEW_PW})
check("改密成功返回 200", st == 200, "HTTP=%s %s" % (st, body[:90]))
row = q("SELECT password_hash, password_changed FROM users WHERE id=?", (uid,))[0]
hash_after = row["password_hash"]
check("password_changed 置 1", int(row["password_changed"]) == 1, row["password_changed"])
check("密码哈希已改变", hash_after != "bcrypt2$placeholder-never-valid")
check("该账号全部会话被清空（忘记密码场景防账号被他人掌握）",
      len(q("SELECT 1 FROM sessions WHERE user_id=?", (uid,))) == 0)
# 放在会话检查之后：登录本身会新建一条 session
check("新密码能用真实登录接口登进去（核心证据）", login_ok(U, NEW_PW))

print("T4 码一次性")
st, body = post("/api/auth/forgot-reset",
                {"username": U, "code": code, "new_password": "Another123"})
check("同一张码第二次使用被拒", st == 400, "HTTP=%s" % st)
check("被拒后密码未被二次改写",
      q("SELECT password_hash FROM users WHERE id=?", (uid,))[0]["password_hash"] == hash_after)

print("T5 大小写容错（HTTP）")
res2 = pr.issue_code_for_user(uid, created_by="e2e")
st, body = post("/api/auth/forgot-reset",
                {"username": U.upper(), "code": res2["code"], "new_password": "Newpass456"})
check("用户名大写也能重置", st == 200, "HTTP=%s %s" % (st, body[:90]))

print("T6 弱密码被后端拦（HTTP）")
res3 = pr.issue_code_for_user(uid, created_by="e2e")
st, body = post("/api/auth/forgot-reset",
                {"username": U, "code": res3["code"], "new_password": "12345678"})
check("纯数字密码被拒", st == 400, "HTTP=%s %s" % (st, body[:90]))

print("T7 清理与零残留")
cleanup()
check("临时账号已删除", len(q("SELECT 1 FROM users WHERE username=?", (U,))) == 0)
check("重置码无残留", len(q("SELECT 1 FROM password_reset_codes WHERE username=?", (U,))) == 0)
left = q("SELECT COUNT(*) AS n FROM password_reset_codes")
print("  （全库剩余重置码行数：%d —— 若为 0 说明本次所有测试码都已随账号清理）" % left[0]["n"])
check("全库无遗留测试码", left[0]["n"] == 0, left[0]["n"])
check("生产真实账号数未变（admin/boss/mptest 等仍在）",
      len(q("SELECT 1 FROM users WHERE username IN ('admin','boss','mptest','mptestsp')")) == 4)

print("=" * 68)
print("PASS %d / FAIL %d" % (len(PASS), len(FAIL)))
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("  -", f)
sys.exit(1 if FAIL else 0)
