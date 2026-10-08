#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v380 进销存能力闸门 · 真机探针（只读）。

判据（三条，缺一即闸门未生效）：
  ① 未登录        → GET /api/psi/meta = 401
  ② demo 会话     → 记录 status / role / user_id（用于确认"到底是谁、什么身份"）
  ③ 对照组        → GET /api/products（`data` 模块，人人可读）应 = 200，
                    用来证明"不是全站 403 的假安全"

副作用：仅 1 次 POST /api/auth/demo-login（新增 1 条会话记录，与真实登录同性质）。
用法：python3 v380-gate-probe.py [base_url]
"""
import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://hergent.cn"


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return -1, "EXC: " + repr(e)


def brief(tx, n=300):
    s = tx.replace("\n", " ").strip()
    return s[:n] + (" …(截断)" if len(s) > n else "")


print("=== ① 未登录 GET /api/psi/meta （期望 401）===")
st, tx = call("GET", "/api/psi/meta")
print("    status =", st)
print("    body   =", brief(tx))
r1 = (st == 401)

print("\n=== ② demo-login（仅 1 次）===")
st, tx = call("POST", "/api/auth/demo-login", body={})
token = None
try:
    obj = json.loads(tx)
    token = obj.get("access_token") or obj.get("token")
    if token is None and isinstance(obj.get("data"), dict):
        token = obj["data"].get("access_token") or obj["data"].get("token")
except Exception:
    pass
print("    status =", st, " token_present =", bool(token))

print("\n=== ③ 带会话 GET /api/psi/meta ===")
if token:
    st2, tx2 = call("GET", "/api/psi/meta", token)
    print("    status =", st2)
    print("    body   =", brief(tx2))
else:
    st2, tx2 = -1, "(无 token)"
    print("    跳过（未取到 token）")

print("\n=== ④ 对照组 GET /api/products （期望 200，证明不是全站 403）===")
st3, tx3 = call("GET", "/api/products", token)
print("    status =", st3)
print("    body   =", brief(tx3, 160))

print("\n=== 汇总 ===")
print("  ① 未登录 401      :", "✅" if r1 else "❌ (status=%s)" % st)
print("  ② demo 会话 psi   :", st2)
print("  ④ 对照 products   :", st3)
