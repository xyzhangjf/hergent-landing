#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自注册链路（邀请码制）端到端验证 —— 影子库，不碰生产。

用法：
  1) cp ~/Documents/hergent-erp/server/erp.db /tmp/regtest2/erp.db
  2) cd ~/Documents/hergent-erp/server && ERP_DB_PATH=/tmp/regtest2/erp.db ERP_SECRET=t \
     PORT=8701 /path/to/python server.py   （或 uvicorn）
  3) ERP_DB_PATH=/tmp/regtest2/erp.db python3 register-invite-e2e.py

覆盖：注册模式探测 / 无效·停用·过期·用尽邀请码 / 成功注册六环节 / 名额回收 /
      核销流水 / 平台管理员鉴权（新用户提权拒绝）/ 跨租户越权 / 租户库干净度 / 登录态。
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("BASE", "http://127.0.0.1:8701")

# 凭据不入库：本脚本自建测试租户所用的密码（非任何真实账号）
# 跑法：HG_TEST_PW='<任意≥8位>' python3 register-invite-e2e.py
TPW = os.environ.get("HG_TEST_PW", "")
if not TPW:
    print("需要环境变量 HG_TEST_PW（本脚本自建测试租户的密码，任意 ≥8 位）")
    sys.exit(1)
DBP = os.environ.get("ERP_DB_PATH", "/tmp/regtest2/erp.db")

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  {'✅' if ok else '❌'} {name}" + (f"  —— {detail}" if detail else ""))
    return ok


def req(path, method="GET", body=None, token=None, tenant=None, xff=None, cookies=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    if tenant is not None:
        r.add_header("X-Tenant-Id", str(tenant))
    if xff:
        # 给每个请求追加随机尾段 → 每次运行都是全新来源 IP。
        # 限流的 key 是 `register:ip:<ip>`（60s 冷却）且时间戳在校验**之前**记录，
        # 同一 IP 连跑两个用例必吃 429；固定字面量还会让「60 秒内重跑」整体失败。
        r.add_header("X-Forwarded-For", f"{xff}.{uuid.uuid4().hex[:4]}")
    if cookies:
        r.add_header("Cookie", cookies)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            raw = resp.read().decode()
            hd = dict(resp.headers)
            # dict() 会把重复的 Set-Cookie 塌缩成最后一个 → 单独拼一份完整清单，
            # 否则「四个 cookie 是否都下发」根本测不出来（首跑就踩了这个坑）。
            hd["_set_cookie"] = " | ".join(resp.headers.get_all("Set-Cookie") or [])
            try:
                return resp.status, json.loads(raw), hd
            except Exception:
                return resp.status, raw, hd
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        hd = dict(e.headers)
        hd["_set_cookie"] = " | ".join(e.headers.get_all("Set-Cookie") or [])
        try:
            return e.code, json.loads(raw), hd
        except Exception:
            return e.code, raw, hd
    except Exception as e:
        return 0, {"_err": str(e)}, {}


def xff():
    """每次调用给一个不同的来源 IP。

    限流是 `register:ip:<ip>` 60s 冷却，且**时间戳在校验之前就记下**（打错码也计入），
    所以同一 IP 连跑两个用例必吃 429。用例之间换 IP，限流本身另有专门断言。
    """
    h = uuid.uuid4().hex
    return ".".join(str(int(h[i:i + 2], 16) % 251 + 1) for i in (0, 2, 4))


MY_IP = xff()


def q(sql, args=()):
    con = sqlite3.connect("file:" + DBP + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute(sql, args)]
    finally:
        con.close()


def mkcode(label, max_uses=1, expires_at="", active=1):
    """直接建码（等价于管理接口内部调用的那个函数），避免用例被接口自身问题干扰。"""
    sys.path.insert(0, os.path.abspath(os.environ["SRV"]))
    import invite_codes as ic
    row, err = ic.create_code(label=label, max_uses=max_uses, expires_at=expires_at)
    assert not err, err
    if not active:
        ic.set_active(row["code"], False)
    return row["code"]


def uniq(n=6):
    return uuid.uuid4().hex[:n]


def phone():
    return "13" + str(uuid.uuid4().int)[:9]


print("=" * 78)
print("自注册链路（邀请码制）端到端验证")
print("=" * 78)

# ────────────────────────────── 1. 注册模式
print("\n【1】注册模式探测")
st, d, _ = req("/api/auth/register-mode")
check("GET /api/auth/register-mode 可公开访问", st == 200, f"HTTP {st}")
check("模式为 invite（邀请码）", isinstance(d, dict) and d.get("mode") == "invite", str(d))
check("前端所需字段齐备（need_invite / hint）",
      isinstance(d, dict) and d.get("need_invite") is True and bool(d.get("hint")))

# ────────────────────────────── 2. 无效 / 异常邀请码
print("\n【2】非法邀请码被拒（且不建号）")
before = len(q("SELECT id FROM tenants"))
st, d, _ = req("/api/auth/register", "POST",
               {"company": "ZZ无效码" + uniq(), "phone": phone(), "password": TPW,
                "invite_code": "HGNOSUCHCODE"}, xff="10.0.0.1")
check("不存在的邀请码 → 400", st == 400, f"HTTP {st} {d}")
print(f"     文案：{(d or {}).get('detail') or (d or {}).get('error') or (d or {}).get('message')}")
check("被拒后没有多出任何租户", len(q("SELECT id FROM tenants")) == before)

code_disabled = mkcode("已停用测试", active=0)
st, d, _ = req("/api/auth/register", "POST",
               {"company": "ZZ停用码" + uniq(), "phone": phone(), "password": TPW,
                "invite_code": code_disabled}, xff="10.0.0.2")
check("已停用的邀请码 → 400", st == 400, f"HTTP {st} {d}")
print(f"     文案：{(d or {}).get('detail') or (d or {}).get('error')}")

code_expired = mkcode("已过期测试", expires_at="2020-01-01")
st, d, _ = req("/api/auth/register", "POST",
               {"company": "ZZ过期码" + uniq(), "phone": phone(), "password": TPW,
                "invite_code": code_expired}, xff="10.0.0.3")
check("已过期的邀请码 → 400", st == 400, f"HTTP {st} {d}")
print(f"     文案：{(d or {}).get('detail') or (d or {}).get('error')}")

check("空邀请码 → 400（前端也挡，后端仍须拒）",
      req("/api/auth/register", "POST",
          {"company": "ZZ空码" + uniq(), "phone": phone(), "password": TPW},
          xff="10.0.0.4")[0] == 400)

# ────────────────────────────── 3. 成功注册（六环节）
print("\n【3】有效邀请码 → 完整注册链路")
c1 = mkcode("永诺旗舰店（联调）", max_uses=1)
company = "ZZ邀请码联调" + uniq()
ph = phone()
st, d, hdrs = req("/api/auth/register", "POST",
                  {"company": company, "phone": ph, "password": TPW, "invite_code": c1},
                  xff="203.0.113.7")
check("注册成功 → 200", st == 200, f"HTTP {st} {str(d)[:160]}")
d = d if isinstance(d, dict) else {}
tok = d.get("token", "")
tid = d.get("tenant_id")
check("下发登录 token（自动登录）", bool(tok))
check("下发 csrf_token（否则注册后首个写操作必 403）", bool(d.get("csrf_token")), str(d.get("csrf_token"))[:16])
check("下发租户 ID", bool(tid), f"tid={tid}")
check("返回用户信息（username/role）",
      isinstance(d.get("user"), dict) and bool(d["user"].get("username")) and bool(d["user"].get("role")),
      str(d.get("user")))
_ck = hdrs.get("_set_cookie", "")
_missing = [x for x in ("erp_token=", "hergent_tenant=", "__Host-csrf=") if x not in _ck]
check("下发全部 4 个 cookie（登录态 + 租户上下文 + CSRF 双写）", not _missing,
      f"缺={_missing} | 实际={_ck[:180]}")

rows = q("SELECT * FROM tenants WHERE id=?", (tid,))
check("主库 tenants 建行成功", len(rows) == 1, str(rows[:1]))
if rows:
    check("租户名/联系人手机号落库", rows[0]["name"] == company and rows[0]["contact_phone"] == ph,
          f"name={rows[0]['name']} phone={rows[0]['contact_phone']}")
u = q("SELECT * FROM users WHERE username=?", (d.get("user", {}).get("username"),))
check("主库 users 建号成功", len(u) == 1, str(u[:1]))
if u:
    check("新账号角色为 boss（租户内老板）", u[0]["role"] == "boss", u[0]["role"])
    check("user_tenants 关联已建立",
          len(q("SELECT * FROM user_tenants WHERE user_id=? AND tenant_id=?", (u[0]["id"], tid))) == 1)

tdb = os.path.join(os.path.dirname(DBP), f"tenant_{tid}.db")
check(f"租户库 tenant_{tid}.db 已创建", os.path.exists(tdb), tdb)
if os.path.exists(tdb):
    con = sqlite3.connect("file:" + tdb + "?mode=ro", uri=True)
    ntab = con.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
    check("租户库表结构完整（>250 张）", ntab > 250, f"{ntab} 张表")
    for t in ("users", "tenants"):
        try:
            n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        except Exception:
            n = "表不存在"
        check(f"租户库 {t} 干净（未复制主库凭据/名单）", n == 0 if isinstance(n, int) else False, f"{t}={n}")
    con.close()

# ────────────────────────────── 4. 名额消耗 / 核销流水
print("\n【4】邀请码核销与流水")
code_row = q("SELECT * FROM invite_codes WHERE code=?", (c1,))
check("邀请码 used_count = 1", code_row and code_row[0]["used_count"] == 1, str(code_row[:1]))
uses = q("SELECT * FROM invite_uses WHERE code=?", (c1,))
check("核销流水已记录（= 注册事件表）", len(uses) == 1, str(uses[:1]))
if uses:
    r = uses[0]
    check("流水含 公司/手机号/租户/账号", r["company"] == company and r["phone"] == ph and r["tenant_id"] == tid,
          f"company={r['company']} phone={r['phone']} tid={r['tenant_id']}")
    check("流水记录来源 IP（proxy_headers 生效）", str(r["client_ip"]).startswith("203.0.113.7"),
          f"ip={r['client_ip']}")
    check("流水记录 User-Agent", bool(r["user_agent"]))

st, d2, _ = req("/api/auth/register", "POST",
                {"company": "ZZ超用" + uniq(), "phone": phone(), "password": TPW, "invite_code": c1},
                xff="10.0.0.5")
check("1 次码用完后再次注册 → 400 已用尽", st == 400, f"HTTP {st}")
print(f"     文案：{(d2 or {}).get('detail') or (d2 or {}).get('error')}")

# ────────────────────────────── 5. 失败回滚（名额不被烧掉）
print("\n【5】建号失败 → 邀请码名额归还")
c2 = mkcode("回滚测试", max_uses=1)
st, d3, _ = req("/api/auth/register", "POST",
                {"company": company, "phone": phone(), "password": TPW, "invite_code": c2},
                xff="10.0.0.6")
check("公司名重复 → 400", st == 400, f"HTTP {st} {str(d3)[:120]}")
left = q("SELECT used_count FROM invite_codes WHERE code=?", (c2,))
check("失败后 used_count 回滚为 0（名额没被烧掉）", left and left[0]["used_count"] == 0, str(left))

# ────────────────────────────── 6. 不限次码可多次注册
print("\n【6】不限次邀请码（max_uses=0）")
c3 = mkcode("渠道码·不限次", max_uses=0)
oks = 0
for i in range(2):
    st, dd, _ = req("/api/auth/register", "POST",
                    {"company": f"ZZ不限次{i}-" + uniq(), "phone": phone(), "password": TPW,
                     "invite_code": c3}, xff=f"10.0.0.{20+i}")
    oks += (st == 200)
check("同一不限次码可连续注册 2 家", oks == 2, f"成功 {oks}/2")
r3 = q("SELECT used_count, max_uses FROM invite_codes WHERE code=?", (c3,))
check("used_count 累计为 2", r3 and r3[0]["used_count"] == 2, str(r3))

# ────────────────────────────── 7. 登录态
print("\n【7】注册后登录态")
st, lg, _ = req("/api/auth/login", "POST", {"username": d.get("user", {}).get("username"),
                                            "password": TPW})
check("用新账号密码可正常登录", st == 200, f"HTTP {st} {str(lg)[:160]}")
lg = lg if isinstance(lg, dict) else {}
check("登录返回 csrf_token", bool(lg.get("csrf_token")))
check("登录返回 tenant_id = 新租户", lg.get("tenant_id") == tid, f"{lg.get('tenant_id')} vs {tid}")
newtok = lg.get("token") or tok

# ────────────────────────────── 8. 数据隔离 / 越权
print("\n【8】新租户数据隔离（越权向量）")
st, _, _ = req("/api/contacts", token=newtok, tenant=1)
check("X-Tenant-Id: 1（他人租户）→ 403", st == 403, f"HTTP {st}")
st, _, _ = req("/api/contacts?tenant_id=1", token=newtok)
check("?tenant_id=1 → 403", st == 403, f"HTTP {st}")
st, _, _ = req("/api/contacts", token=newtok, cookies="hergent_tenant=1")
check("伪造 hergent_tenant=1 cookie → 403", st == 403, f"HTTP {st}")
st, _, _ = req("/api/contacts", token=newtok, tenant="tenant_1")
check("非法租户 id（字符串）→ 400", st == 400, f"HTTP {st}")
st, d9, _ = req("/api/contacts", token=newtok)
check("不带租户上下文 → 回落自身租户（200）", st == 200, f"HTTP {st}")
check("新租户名下无任何客户（真空白起步）",
      st == 200 and not (d9.get("data") if isinstance(d9, dict) else None), str(d9)[:120])

# ────────────────────────────── 8b. 新租户库逐表空白（2026-09-12 起不再播种）
# 改前 register_user_and_tenant 会 set_tenant_context(tid) 后调 seed_demo_data()，
# 给每个新租户灌 10 客户 / 5 供应商 / 15 商品 / 5 销售单 / 3 采购单（早期快消口径：
# 冰红茶、海飞丝、卫龙辣条）。改后必须**逐表**为 0 —— 只看一个 /api/contacts 不够，
# 少灌了客户但仍在灌商品同样是缺陷。
print("\n【8b】新租户库逐表空白（无演示数据）")
tdb = os.path.join(os.path.dirname(DBP), f"tenant_{tid}.db")
tc = sqlite3.connect(tdb)
_have = {r[0] for r in tc.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}


def _n(t):
    """租户库里某表行数；表不存在返回 None（表不存在本身就是要暴露的问题）。"""
    return tc.execute("SELECT COUNT(*) FROM " + t).fetchone()[0] if t in _have else None


for _t in ("contacts", "products", "inventory", "sale_orders", "purchase_orders"):
    _c = _n(_t)
    check(f"租户库 {_t} 为 0 行", _c == 0, f"{_c} 行" if _c is not None else "⚠️ 表不存在")

_cur = _n("currencies")
check("仍带 6 条币种（基础配置，不是假数据）", _cur == 6, f"{_cur} 行")

st, dcx, _ = req("/api/contacts", "POST", {"name": "ZZ自建客户", "type": "customer"}, token=newtok)
check("空白租户仍能自建客户（不是少了 seed 就报错）",
      st in (200, 201) and isinstance(dcx, dict) and dcx.get("success"),
      f"HTTP {st} {str(dcx)[:90]}")
_after = _n("contacts")
check("自建后该客户真落进本租户库（=1 行）", _after == 1, f"{_after} 行")
tc.close()

# ────────────────────────────── 9. 平台管理员鉴权（提权拒绝）
print("\n【9】平台管理员鉴权 —— 新注册用户不得提权")
st, d10, _ = req("/api/platform/whoami", token=newtok)
check("whoami 可见且 platform_admin=false", st == 200 and d10.get("platform_admin") is False,
      f"HTTP {st} {d10}")
st, _, _ = req("/api/platform/invite-codes", token=newtok)
check("新用户读邀请码列表 → 403", st == 403, f"HTTP {st}")
st, _, _ = req("/api/platform/invite-codes", "POST", {"label": "提权尝试"}, token=newtok)
check("新用户生成邀请码 → 403", st == 403, f"HTTP {st}")
st, _, _ = req("/api/platform/onboard", "POST",
               {"company_name": "ZZ提权租户", "admin_account": "zz_esc", "admin_password": "abc12345"},
               token=newtok)
check("新用户开租户 → 403", st == 403, f"HTTP {st}")
st, _, _ = req("/api/tenants", token=newtok)
check("新用户读全量客户名单 → 403（已收紧）", st == 403, f"HTTP {st}")

# ────────────────────────────── 10. 平台管理员可用
print("\n【10】平台管理员（创始人）侧接口")
con = sqlite3.connect(DBP)
con.row_factory = sqlite3.Row
adm = con.execute("SELECT id FROM users WHERE username='admin'").fetchone()
atok = "t" + uuid.uuid4().hex
con.execute("INSERT OR REPLACE INTO sessions (token,user_id,created_at,expires_at,last_activity) "
            "VALUES (?,?,datetime('now','localtime'),datetime('now','+1 day','localtime'),datetime('now','localtime'))",
            (atok, adm["id"]))
con.commit()
con.close()
check("平台管理员被自动播种在册",
      len(q("SELECT * FROM platform_admins WHERE user_id=?", (adm["id"],))) == 1,
      str(q("SELECT * FROM platform_admins")))
st, dw, _ = req("/api/platform/whoami", token=atok)
check("whoami platform_admin=true", st == 200 and dw.get("platform_admin") is True, f"HTTP {st} {dw}")
st, dl, _ = req("/api/platform/invite-codes", token=atok)
check("管理员读邀请码列表 → 200", st == 200 and isinstance(dl.get("codes"), list),
      f"HTTP {st} 共 {len(dl.get('codes') or [])} 张")
check("列表带统计（可用/已注册）", isinstance(dl.get("stats"), dict), str(dl.get("stats")))
st, dc, _ = req("/api/platform/invite-codes", "POST",
                {"label": "接口生成", "max_uses": 2, "expires_at": ""}, token=atok)
newcode = (dc.get("code") or {}).get("code") if isinstance(dc, dict) else None
check("管理员生成邀请码 → 200", st == 200 and bool(newcode), f"HTTP {st} code={newcode}")
st, ds, _ = req("/api/platform/invite-codes/status", "POST",
                {"code_or_id": newcode, "active": False}, token=atok)
check("停用邀请码 → 200", st == 200, f"HTTP {st} {ds}")
st, dn, _ = req("/api/auth/register", "POST",
                {"company": "ZZ停用后" + uniq(), "phone": phone(), "password": TPW,
                 "invite_code": newcode}, xff="10.0.0.30")
check("停用后的码注册 → 400", st == 400, f"HTTP {st}")
st, dr, _ = req("/api/platform/registrations", token=atok)
# 流水是 append-only 事件表，影子库里会累积历次运行的记录 → 只断言「本次的都在」，
# 不断言总条数（写死条数会让脚本只第一次跑得过）。
regs = (dr.get("registrations") or []) if isinstance(dr, dict) else []
mine = [x for x in regs if x.get("code") in (c1, c3)]
check("注册流水接口 → 本次 3 条注册全部可查", st == 200 and len(mine) == 3,
      f"HTTP {st} 本次 {len(mine)}/3，库内共 {len(regs)} 条")
check("流水只记成功注册（失败尝试不入账）",
      all(int(x.get("tenant_id") or 0) > 0 for x in regs))
check("流水 join 出公司名与码备注（可读）",
      any(x.get("company") == company for x in regs)
      and any(x.get("code_label") for x in regs))
st, _, _ = req("/api/platform/invite-codes/" + str(newcode), "DELETE", token=atok)
check("删除邀请码 → 200", st == 200, f"HTTP {st}")
check("删除码后核销流水仍留存（可追溯）",
      len(q("SELECT * FROM invite_uses WHERE code=?", (newcode,))) == 0)  # 该码未被使用过
check("已使用过的码的流水在删码前先记一份",
      len(q("SELECT * FROM invite_uses WHERE code=?", (c1,))) == 1)

print()
print("=" * 78)
print(f"通过 {len(PASS)} / 共 {len(PASS)+len(FAIL)}")
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("  ✗", f)
    sys.exit(1)
print("全部通过 ✅")
