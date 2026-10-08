# -*- coding: utf-8 -*-
"""读取候选商品的 achieved_box（只读），用于定目标值。"""
import json, urllib.request, urllib.error
API = "http://127.0.0.1:8700"
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def req(path, tok=None, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if tok:
        r.add_header("Authorization", "Bearer " + tok); r.add_header("X-Tenant-Id", "1")
    try:
        with op.open(r, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]

st, d = req("/api/auth/login", method="POST", body={"username": "mptestsp", "password": "Mpsup@1"})
tok = d["token"]
st, av = req("/api/product-targets/avg-target?period_id=19&product_ids=1556,1510,1596,1315", tok=tok)
print("status", st)
print("arrivals:", json.dumps(av.get("arrivals"), ensure_ascii=False)[:400])
print("month/today:", av.get("month"), av.get("today"))
print("caliber:", json.dumps(av.get("caliber"), ensure_ascii=False)[:400])
for k, v in (av.get("items") or {}).items():
    print("id=%s unit=%r box_unit=%r achieved=%s(%s) flags=%s per_unit=%s"
          % (k, v.get("unit"), v.get("box_unit"), v.get("achieved_box"), v.get("achieved_unit"),
             v.get("flags"), v.get("per_unit")))
