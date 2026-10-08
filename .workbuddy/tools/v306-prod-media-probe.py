#!/usr/bin/env python3
"""v301 线上验收：`/api/ai/media` 鉴权、租户隔离、真实下载。

🔴 凭据**不落盘**：账号与密码从环境变量 `MP_USER` / `MP_PASS` 取，本文件里没有明文。
🔴 只读：只 GET / 一次 POST 登录，不改任何数据。
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("ERP_BASE", "http://127.0.0.1:8700")
USER = os.environ.get("MP_USER", "mptest")
PASS = os.environ.get("MP_PASS", "")
OUT = "/opt/hermes-tenants/hergent_t1/output/"


def req(path, method="GET", body=None, token=None, tenant=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    if tenant is not None:
        r.add_header("X-Tenant-Id", str(tenant))
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:                                    # noqa: BLE001
        return -1, {}, str(e).encode()


def q(path):
    return "/api/ai/media?path=" + urllib.parse.quote(path, safe="")


if not PASS:
    print("[中止] 缺 MP_PASS"); sys.exit(2)

print("=" * 74)
print("① 登录（%s）" % USER)
st, _, raw = req("/api/auth/login", "POST", {"username": USER, "password": PASS})
print("   HTTP %s" % st)
try:
    d = json.loads(raw.decode())
except Exception:
    d = {}
tok = d.get("token") or d.get("access_token") or (d.get("data") or {}).get("token") or ""
print("   token 拿到 = %s   角色 = %s" % (bool(tok), (d.get("user") or {}).get("role") or d.get("role")))
if not tok:
    print("   返回键 = %s" % sorted(d.keys()))
    print("   正文前 200 字 = %s" % raw.decode("utf-8", "replace")[:200])
    sys.exit(1)

print("\n② 正例：本租户 hergent_t1 产物（期望 200 + 字节与磁盘一致）")
target = OUT + "BP-想法梳理与开发计划-v1.docx"
st, hd, body = req(q(target), token=tok, tenant=1)
disk = hashlib.md5(open(target, "rb").read()).hexdigest()
got = hashlib.md5(body).hexdigest() if st == 200 else "-"
print("   HTTP %s  大小=%s  磁盘=%s  下发=%s  %s"
      % (st, hd.get("content-length"), os.path.getsize(target), len(body),
         "✅ 逐字节一致" if got == disk else "❌ 不一致"))
print("   Content-Disposition = %s" % hd.get("content-disposition"))
print("   Content-Type        = %s" % hd.get("content-type"))
print("   X-Content-Type-Options = %s" % hd.get("x-content-type-options"))

print("\n③ 反例清单（期望值写在括号里）")
CASES = [
    ("系统文件 /etc/passwd", "/etc/passwd", 403),
    ("穿越 /opt/hermes-tenants/hergent_t1/output/../../erp.db",
     "/opt/hermes-tenants/hergent_t1/output/../../erp.db", 403),
    ("别的租户 hergent_t2", "/opt/hermes-tenants/hergent_t2/output/x.docx", 403),
    ("不在产物子树（家目录根部 .env）", "/opt/hermes-tenants/hergent_t1/.env", 403),
    ("允许根内但不存在", OUT + "查无此件.docx", 404),
    ("目录本身", OUT.rstrip("/"), 404),
    ("空路径", "", 400),
]
bad = 0
for desc, p, want in CASES:
    st, _, b = req(q(p), token=tok, tenant=1)
    ok = st == want
    bad += 0 if ok else 1
    print("   %s  %-44s 期望 %s 实际 %s" % ("✅" if ok else "❌", desc, want, st))

print("\n④ 无 token（期望 401）")
st, _, _ = req(q(target))
print("   %s  实际 %s" % ("✅" if st == 401 else "❌", st))
bad += 0 if st == 401 else 1

print("\n⑤ 回归：同一账号的既有接口（会话列表 / 首页）")
st, _, b = req("/api/ai/sessions", token=tok, tenant=1)
print("   /api/ai/sessions → %s %s" % (st, "✅" if st == 200 else "❌"))
bad += 0 if st == 200 else 1
st, _, _ = req("/api/health")
print("   /api/health      → %s %s" % (st, "✅" if st == 200 else "❌"))
bad += 0 if st == 200 else 1

print("\n" + ("🟢 线上验收通过（失败 %d）" % bad if not bad else "🔴 有 %d 项失败" % bad))
sys.exit(1 if bad else 0)
