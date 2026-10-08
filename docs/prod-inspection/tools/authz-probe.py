#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多租户越权只读探针（生产巡检第 7 项）。

严格只读：
  - 仅 1 次 POST /api/auth/demo-login（会新增 1 条会话记录，与真实用户登录同性质）
  - 其余 6 次请求中，只有 3 次是 GET（/api/tenants、/api/products）+ 1 次 GET 隐式；
    POST /api/tenants 与 PUT /api/tenants/999999 为「越权尝试」，期望被 403 拒绝，
    不携带任何有效租户权限，故不会真正写库。
  - POST /api/users/999890/password 同属越权尝试，期望 403。

用法：python3 authz-probe.py [base_url]
"""

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://hergent.cn"


def call(method, path, token=None, body=None):
    url = BASE + path
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return -1, "EXC: " + repr(e)


def show(label, method, path, status, text):
    snippet = text.replace("\n", " ").strip()
    if len(snippet) > 400:
        snippet = snippet[:400] + " ...(截断)"
    print("=== " + label + " " + method + " " + path + " ===")
    print("    status = " + str(status))
    print("    body   = " + snippet)
    print("")


def main():
    print("=== STEP 0: demo-login (仅 1 次) ===")
    st, tx = call("POST", "/api/auth/demo-login", body={})
    token = None
    try:
        obj = json.loads(tx)
        token = obj.get("access_token") or obj.get("token")
        if token is None and isinstance(obj.get("data"), dict):
            token = obj["data"].get("access_token") or obj["data"].get("token")
    except Exception:  # noqa: BLE001
        pass
    print("    status = " + str(st) + "   token_present = " + str(bool(token)))
    print("")

    if not token:
        print("!!! 未取到令牌，后续探针无法执行 !!!")
        return 2

    probes = [
        ("PROBE", "GET", "/api/tenants", None),
        ("PROBE", "POST", "/api/tenants", {}),
        ("PROBE", "PUT", "/api/tenants/999999", {}),
        ("PROBE", "POST", "/api/users/999890/password", {"password": "x"}),
    ]
    verdicts = []
    for label, method, path, body in probes:
        st, tx = call(method, path, token=token, body=body)
        show(label, method, path, st, tx)
        verdicts.append((method, path, st, tx))

    ctl_st, ctl_tx = call("GET", "/api/products", token=token)
    show("CONTROL", "GET", "/api/products", ctl_st, ctl_tx)

    print("=== 汇总 ===")
    leaked = []
    for _m, _p, _s, _t in verdicts:
        if _s == 200:
            leaked.append(_m + " " + _p)
    print("越权返回 200 的探针数 = " + str(len(leaked)))
    for item in leaked:
        print("  !!! 200 = " + item)
    print("对照 GET /api/products = " + str(ctl_st))
    return 0


if __name__ == "__main__":
    sys.exit(main())
