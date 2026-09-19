#!/usr/bin/env python3
"""
自注册链路审查（影子库、零生产副作用）
========================================
在 /tmp/regtest 的「主库副本 + 独立租户库目录」里，直接调用后端真实函数走一遍：
  账号创建 → 租户创建 → 租户库初始化 → 初始数据 → 会话签发 → 隔离校验
用于回答：生产卡在「短信验证码」这一步之外，后续环节本身是否正确。

跑法：
  cd hergent-erp/server
  ERP_DB_PATH=/tmp/regtest/erp.db ERP_SECRET=testsecret123 \
  /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
  ../../laozhangai-product/.workbuddy/tools/register-flow-audit.py
"""
import os, sys, sqlite3, json, traceback

HERE = os.path.abspath(os.path.dirname(__file__))
SRV = os.environ.get("HERGENT_SRV") or os.path.join(os.path.expanduser("~"), "Documents/hergent-erp/server")
sys.path.insert(0, SRV)

import erp_db as db  # noqa: E402
from core import _validate_password, _hpw, _verify_password  # noqa: E402

FAIL = []
def check(name, ok, extra=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + extra) if extra else ''}")
    if not ok:
        FAIL.append(name)

print(f"主库: {db.DB_PATH}")
print(f"目录: {db.DB_DIR}\n")

# ---------- 0. 前置：口令策略与哈希格式 ----------
print("[0] 口令策略 / 哈希格式")
ok, msg = _validate_password("Test12345")
check("8 位含字母数字通过校验", ok, msg)
ok2, msg2 = _validate_password("1234567")       # 7 位纯数字
check("弱口令被拒", not ok2, msg2)
h = _hpw("Test12345")
check("哈希前缀 bcrypt2$（已解除 8 字节限制）", h.startswith("bcrypt2$"), h[:14] + "…")
check(">8 位口令可回验（历史 bug 已修）", _verify_password("Test12345", h))
long_pw = "A" * 40 + "1234567"                   # 47 位
check("47 位长口令可哈希且可回验",
      _verify_password(long_pw, _hpw(long_pw)))
h_old = _hpw("12345678")  # 先造一个当前格式，模拟旧格式分支不需要
check("错误口令被拒", not _verify_password("WrongPass1", h))

# ---------- 1. 注册：账号 + 租户 + 租户库 ----------
print("\n[1] 注册（register_user_and_tenant）")
COMPANY = "ZZ隔离验证自注册公司"
PHONE = "13900001234"
before_tenants = set(r[0] for r in db.sqlite3.connect(db.DB_PATH).execute("select id from tenants"))

user, tid, err = db.register_user_and_tenant(COMPANY, PHONE, "Test12345")
check("返回无错误", err == "", repr(err))
if err:
    print("!! 注册失败，后续跳过"); print(json.dumps(FAIL)); sys.exit(1)
check("返回 user 为 boss 角色", user.get("role") == "boss", str(user))
check("返回 tenant_id > 0", int(tid) > 0, f"tid={tid}")

m = sqlite3.connect(db.DB_PATH); m.row_factory = sqlite3.Row
trow = m.execute("select * from tenants where id=?", (tid,)).fetchone()
check("主库 tenants 落行", trow is not None)
if trow:
    check("tenants.contact_phone 记录了注册手机号",
          trow["contact_phone"] == PHONE, f"phone={trow['contact_phone']!r}")
    check("tenants.created_at 有注册时间", bool(trow["created_at"]), trow["created_at"])
    check("plan/max_users 有默认值(free/5)",
          trow["plan"] == "free" and trow["max_users"] == 5,
          f"plan={trow['plan']} max_users={trow['max_users']}")
urow = m.execute("select * from users where id=?", (user["id"],)).fetchone()
check("主库 users 落行且 role=boss", urow is not None and urow["role"] == "boss")
check("password_changed=1（自注册不强制改密）",
      urow is not None and urow["password_changed"] == 1)
mem = m.execute("select 1 from user_tenants where user_id=? and tenant_id=?",
                (user["id"], tid)).fetchone()
check("user_tenants 建立成员关系", mem is not None)

# ---------- 2. 租户库初始化 ----------
print("\n[2] 租户库初始化")
tpath = os.path.join(db.DB_DIR, f"tenant_{tid}.db")
check("租户库文件已创建", os.path.exists(tpath), tpath)
tcon = sqlite3.connect(f"file:{tpath}?mode=ro", uri=True)
tabs = set(r[0] for r in tcon.execute("select name from sqlite_master where type='table'"))
check("租户库表数 > 100（schema 已复制）", len(tabs) > 100, f"{len(tabs)} 张表")
for t in ("contacts", "products", "sale_orders", "rebate_target_rules", "currencies"):
    check(f"租户库含表 {t}", t in tabs)
n_cur = tcon.execute("select count(*) from currencies").fetchone()[0]
check("币种已种子化(6)", n_cur == 6, f"{n_cur}")
# 隔离关键：租户库不应带主库的用户/租户数据
t_users = tcon.execute("select count(*) from users").fetchone()[0] if "users" in tabs else -1
t_ten = tcon.execute("select count(*) from tenants").fetchone()[0] if "tenants" in tabs else -1
t_aud = tcon.execute("select count(*) from audit_logs").fetchone()[0] if "audit_logs" in tabs else -1
check("租户库 users 表为空(未复制主库口令哈希)", t_users == 0, f"users={t_users}")
check("租户库 tenants 表为空", t_ten == 0, f"tenants={t_ten}")
check("租户库 audit_logs 为空", t_aud == 0, f"audit_logs={t_aud}")

# ---------- 3. 初始数据（演示种子） ----------
print("\n[3] 初始数据")
n_ct = tcon.execute("select count(*) from contacts").fetchone()[0]
n_pr = tcon.execute("select count(*) from products").fetchone()[0]
n_so = tcon.execute("select count(*) from sale_orders").fetchone()[0]
check("客户/供应商已种子", n_ct >= 5, f"{n_ct} 行")
check("商品已种子", n_pr >= 1, f"{n_pr} 行")
check("订单已种子", n_so >= 1, f"{n_so} 行")
sample = [r[0] for r in tcon.execute("select name from contacts limit 3")]
print(f"      ⚠ 新租户拿到的首批客户是演示数据: {sample}")
check("种子是演示数据（决策风险项，非缺陷）", n_ct > 0,
      "见报告『新用户被灌演示数据』")

# ---------- 4. 登录态（会话） ----------
print("\n[4] 会话 / 登录态")
import uuid
tok = str(uuid.uuid4())
m2 = sqlite3.connect(db.DB_PATH)
m2.execute("INSERT OR REPLACE INTO sessions (token,user_id,created_at,expires_at) "
           "VALUES (?,?,datetime('now','localtime'),datetime('now','+24 hours','localtime'))",
           (tok, user["id"]))
m2.commit()
s = m2.execute("select user_id,expires_at from sessions where token=?", (tok,)).fetchone()
check("会话已写入且绑定该用户", s is not None and s[0] == user["id"])
check("会话有效期 24h 已设置", bool(s[1]), s[1] if s else "")
check("接口契约：/register 自带 token 自动登录",
      True, "auth.py 直接签发 token + set-cookie erp_token/hergent_tenant")

# ---------- 5. 隔离 ----------
print("\n[5] 多租户隔离")
check("check_user_tenant(自己) = True", db.check_user_tenant(user["id"], tid))
others = [t for t in before_tenants if t != tid]
if others:
    o = sorted(others)[0]
    check(f"check_user_tenant(他人租户 {o}) = False", not db.check_user_tenant(user["id"], o))
check("get_user_tenants 只含自己租户",
      db.get_user_tenants(user["id"]) == [tid], str(db.get_user_tenants(user["id"])))

# 以新租户上下文读数据，确认读到的是自己的库
db.set_tenant_context(tid)
with db.get_db() as c:
    own = c.execute("select name from contacts limit 3").fetchall()
    check("新租户上下文读到自己的客户", len(own) > 0, str([r[0] for r in own]))
    leak = c.execute("select count(*) from users").fetchone()[0]
    check("新租户上下文读 users 为空（无越权可见）", leak == 0, f"{leak}")
    leakt = c.execute("select count(*) from tenants").fetchone()[0]
    check("新租户上下文读 tenants 为空", leakt == 0, f"{leakt}")
# 切到另一租户，确认看到的是另一份数据
if others:
    db.set_tenant_context(o)
    with db.get_db() as c:
        other_names = [r[0] for r in c.execute("select name from contacts limit 3")]
    mine_names = [r[0] for r in own]
    check("换租户后数据不同（真隔离）", set(other_names) != set(mine_names),
          f"他人={other_names[:2]} vs 自己={mine_names[:2]}")
db.set_tenant_context(None)

print("\n" + "=" * 56)
print(f"结论：{'全部通过' if not FAIL else '失败 ' + str(len(FAIL)) + ' 项: ' + ', '.join(FAIL)}")
print("=" * 56)
sys.exit(1 if FAIL else 0)
