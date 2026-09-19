#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生产真机验证：邀请码注册链路（https://hergent.cn）。

为什么要有「生产」这一遍：影子库只能证明代码对不对，证明不了**线上配置**对
（ENV=production 的 cookie 策略、nginx 透传的真实 IP、限流键、以及最关键的
——注册写的是不是生产主库）。这里用一次真实注册把它走通。

限流注意：`register:ip:<ip>` 是 60s 冷却，且**时间戳在校验之前记录**（打错码也算）。
所以顺序必须是「先成功注册 → 睡 62s → 再测非法码」，否则非法码会先吃掉冷却窗口，
成功的那次反而变成 429。
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("BASE", "https://hergent.cn")

# 凭据不入库：本脚本在生产上自建测试租户所用的密码（会成为该租户管理员密码）
# 跑法：HG_TEST_PW='<任意≥8位>' INVITE='<联调码>' python3 register-invite-prod-verify.py
TPW = os.environ.get("HG_TEST_PW", "")
if not TPW:
    print("需要环境变量 HG_TEST_PW（本脚本自建测试租户的密码，任意 ≥8 位）")
    sys.exit(1)
INVITE = os.environ["INVITE"]          # 单次联调码
OUT = os.environ.get("OUT", "/tmp/regtest2/prod.json")

PASS, FAIL, EVID = [], [], {}


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    mark = "✅" if ok else "❌"
    print(f"  {mark} {name}" + (f"  —— {detail}" if detail else ""))
    return ok


def req(path, method="GET", body=None, token=None, tenant=None, cookies=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    if tenant is not None:
        r.add_header("X-Tenant-Id", str(tenant))
    if cookies:
        r.add_header("Cookie", cookies)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            raw = resp.read().decode()
            hd = dict(resp.headers)
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


def msg(d):
    return (d or {}).get("detail") or (d or {}).get("message") or (d or {}).get("error") or ""


print("=" * 78)
print(f"生产真机验证 · 邀请码注册链路 · {BASE}")
print("=" * 78)

# ─────────────────────────── A. 无需注册的检查（不消耗限流窗口）
print("\n【A】注册模式与越权面（零注册请求）")
st, d, _ = req("/api/auth/register-mode")
check("公开探测注册模式 → invite", st == 200 and d.get("mode") == "invite", f"HTTP {st} {d}")

st, d, _ = req("/api/tenants")
check("未登录读全量客户名单 → 401（原来返回全部客户）", st == 401, f"HTTP {st} {str(d)[:100]}")

st, d, _ = req("/api/auth/demo-login", "POST", {})
demo_tok = d.get("token") if isinstance(d, dict) else None
check("演示入口可用（公开，无凭据）", st == 200 and bool(demo_tok), f"HTTP {st}")
EVID["demo_tid"] = d.get("tenant_id") if isinstance(d, dict) else None

st, d, _ = req("/api/tenants", token=demo_tok)
check("演示账号读全量客户名单 → 403（原来可读）", st == 403, f"HTTP {st} {str(d)[:100]}")

st, d, _ = req("/api/tenants/1", token=demo_tok)
check("演示账号读他人租户详情 → 403", st == 403, f"HTTP {st}")

st, d, _ = req("/api/platform/whoami", token=demo_tok)
check("演示账号 platform_admin=false", st == 200 and d.get("platform_admin") is False, f"{d}")

st, d, _ = req("/api/platform/invite-codes", token=demo_tok)
check("演示账号读邀请码 → 403", st == 403, f"HTTP {st}")

st, d, _ = req("/api/platform/onboard", "POST",
               {"company_name": "ZZ提权", "admin_account": "zz_p", "admin_password": TPW},
               token=demo_tok)
check("演示账号开租户 → 403", st == 403, f"HTTP {st}")

# ─────────────────────────── B. 非法邀请码
print("\n【B】非法邀请码被拒")
# 限流键 `register:ip:<ip>` 是 60s 冷却且时间戳在**校验之前**记录 —— 即上一条注册请求
# （哪怕是被拒的）就会把窗口占掉。所以本段与 【C】 之间必须各留一个 62s 的窗口。
time.sleep(62)
bad = "HGNOSUCH99"
st, d, _ = req("/api/auth/register", "POST",
               {"company": "ZZ非法码-" + uuid.uuid4().hex[:6], "phone": "131" + str(uuid.uuid4().int)[:8],
                "password": TPW, "invite_code": bad})
check("不存在的邀请码 → 400", st == 400, f"HTTP {st} {msg(d)}")
print(f"     文案：{msg(d)}")

# ─────────────────────────── C. 有效邀请码 → 完整注册
print("\n【C】等待限流窗口（62s）后执行真实注册")
time.sleep(62)
company = "ZZ注册链路联调-" + uuid.uuid4().hex[:6]
ph = "131" + str(uuid.uuid4().int)[:8]
st, d, hd = req("/api/auth/register", "POST",
                {"company": company, "phone": ph, "password": TPW, "invite_code": INVITE})
check("真实注册 → 200（生产首次跑通）", st == 200, f"HTTP {st} {str(d)[:200]}")
d = d if isinstance(d, dict) else {}
tok, tid = d.get("token"), d.get("tenant_id")
check("下发登录 token", bool(tok))
check("下发 csrf_token（注册后写操作的前置）", bool(d.get("csrf_token")))
check("下发 tenant_id", bool(tid), f"tid={tid}")
check("账号信息含 role=boss", (d.get("user") or {}).get("role") == "boss", str(d.get("user")))
ck = hd.get("_set_cookie", "")
check("4 个 cookie 全下发（含 __Host-csrf）",
      all(x in ck for x in ("erp_token=", "hergent_tenant=", "__Host-csrf=")),
      f"{ck[:150]}")
EVID.update({"company": company, "phone": ph, "tenant_id": tid,
             "username": (d.get("user") or {}).get("username"), "token": tok,
             "csrf": d.get("csrf_token")})

# ─────────────────────────── D. 登录态 + 隔离
print("\n【D】登录态与数据隔离")
st, lg, _ = req("/api/auth/login", "POST",
                {"username": (d.get("user") or {}).get("username"), "password": TPW})
check("新账号可正常登录", st == 200 and bool(lg.get("token")), f"HTTP {st}")
newtok = lg.get("token") or tok
check("登录后 tenant_id 指向新租户", lg.get("tenant_id") == tid, f"{lg.get('tenant_id')} vs {tid}")

st, _, _ = req("/api/contacts", token=newtok, tenant=1)
check("新租户访问他人租户（X-Tenant-Id:1）→ 403", st == 403, f"HTTP {st}")
st, _, _ = req("/api/contacts?tenant_id=10", token=newtok)
check("新租户访问演示租户（?tenant_id=10）→ 403", st == 403, f"HTTP {st}")
st, dd, _ = req("/api/contacts", token=newtok)
names = [x.get("name") for x in ((dd or {}).get("items") or [])]
# ⚠️ 新租户**不是空的** —— register_user_and_tenant 会调 seed_demo_data 种入示例数据
# （实测：15 客户 / 15 商品 / 15 库存，无订单无账号）。这是既有行为、不是本次改动引入的，
# 但「读到的必须恰好等于自己库里的行数」是真正能证明隔离的断言，比「应为空」更可靠。
own = None
try:
    o = subprocess.run(
        ["ssh", "root@47.113.224.140",
         f"cd /opt/hergent-erp && python3 -c \"import sqlite3;"
         f"c=sqlite3.connect('file:tenant_{tid}.db?mode=ro',uri=True);"
         f"print(c.execute('select count(*) from contacts').fetchone()[0])\""],
        capture_output=True, text=True, timeout=60)
    own = int(o.stdout.strip().splitlines()[-1])
except Exception:
    own = None
check("新租户读到的条数 == 自己库里的条数（读的就是自己的数据）",
      st == 200 and own is not None and len(names) == own,
      f"API {len(names)} 条 / tenant_{tid}.db {own} 条 / 示例：{names[:4]}")
EVID["seeded_contacts"] = len(names)
st, dw, _ = req("/api/platform/whoami", token=newtok)
check("新注册账号 platform_admin=false（不能自己发码/开租户）",
      st == 200 and dw.get("platform_admin") is False, str(dw))
st, _, _ = req("/api/platform/invite-codes", token=newtok)
check("新注册账号读邀请码 → 403", st == 403, f"HTTP {st}")

# ─────────────────────────── E. 核销与流水（管理员视角）
print("\n【E】核销与注册流水（服务端核对）")
try:
    out = subprocess.run(
        ["ssh", "root@47.113.224.140",
         "cd /opt/hergent-erp && python3 -c \""
         "import sqlite3,json;"
         "con=sqlite3.connect('file:erp.db?mode=ro',uri=True); con.row_factory=sqlite3.Row;"
         "print(json.dumps({"
         "'code':[dict(r) for r in con.execute('select code,label,max_uses,used_count,is_active from invite_codes')],"
         "'use':[dict(r) for r in con.execute('select * from invite_uses order by id desc limit 3')]"
         "},ensure_ascii=False))\""],
        capture_output=True, text=True, timeout=90)
    j = json.loads(out.stdout.strip().splitlines()[-1])
    codes = {c["code"]: c for c in j["code"]}
    check("所用邀请码名额已核销（used_count ≥ 1）",
          (codes.get(INVITE, {}).get("used_count") or 0) >= 1, str(codes.get(INVITE)))
    print("     全部邀请码状态：" + str([(c["code"], c["label"],
                                        f"{c['used_count']}/{c['max_uses'] or '不限'}", c["is_active"])
                                       for c in j["code"]]))
    u = (j["use"] or [{}])[0]
    check("核销流水落库（company/phone/tenant_id）",
          u.get("company") == company and u.get("phone") == ph and u.get("tenant_id") == tid,
          str({k: u.get(k) for k in ("code", "company", "phone", "tenant_id")}))
    check("流水记录真实来源 IP（非 127.0.0.1 → proxy_headers 生效）",
          bool(u.get("client_ip")) and not str(u.get("client_ip")).startswith("127."),
          f"ip={u.get('client_ip')}")
    check("流水记录 User-Agent", bool(u.get("user_agent")), str(u.get("user_agent"))[:60])
    EVID["use_row"] = u
except Exception as e:
    check("服务端核对核销/流水", False, f"{type(e).__name__}: {e}")

with open(OUT, "w") as f:
    json.dump(EVID, f, ensure_ascii=False, indent=2)
print(f"\n证据已写 {OUT}")
print("=" * 78)
print(f"通过 {len(PASS)} / 共 {len(PASS)+len(FAIL)}")
if FAIL:
    print("失败项：")
    for x in FAIL:
        print("  ✗", x)
    sys.exit(1)
print("全部通过 ✅")
