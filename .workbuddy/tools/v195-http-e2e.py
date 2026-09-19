#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v195 后端修复的真实 HTTP 端到端验证（打真实端点，不直连函数）。

判据：
  ① 28 行带品牌（品牌不在 brands 表）的 POST /api/products/bulk-upsert
     → 改前 = 140 秒（客户端 20 秒就断）；改后应 < 2 秒
  ② 响应体结构不变（success/inserted/updated/skipped 四键齐全）
  ③ 品牌**真的登记进 brand_pending**（改前因自锁 3 个品牌一个都进不去）
  ④ 收尾清理干净

在服务器上跑：runuser -u hergent -- python3 /tmp/v195-http-e2e.py <token> <tenant>
"""
import json
import os
import sys
import time
import urllib.request

TOK = sys.argv[1]
TID = sys.argv[2] if len(sys.argv) > 2 else "9997"
BASE = "http://127.0.0.1:8700"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 无条件禁代理

N = 28
TAG = "v195http"
BRANDS = [TAG + "甲", TAG + "乙", TAG + "丙"]


def call(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method or ("POST" if data else "GET"))
    req.add_header("Authorization", "Bearer " + TOK)
    req.add_header("X-Tenant-Id", TID)
    req.add_header("Content-Type", "application/json")
    t0 = time.time()
    try:
        with OPENER.open(req, timeout=180) as r:
            return r.status, json.loads(r.read().decode() or "{}"), time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, (e.read().decode()[:200]), time.time() - t0


rows = [{
    "name": "%s商品%02d" % (TAG, i),
    "barcode": "%s%04d" % (TAG.upper(), i),
    "spec": "",
    "unit": "件",
    "brand": BRANDS[i % 3],
} for i in range(N)]

print("① 身份自检 GET /api/health")
st, _, _ = call("/api/health")
print("   health =", st)

print("")
print("② 发 %d 行带品牌的 bulk-upsert（真实端点）" % N)
st, body, el = call("/api/products/bulk-upsert", {"rows": rows})
print("   HTTP = %s    耗时 = %.3f 秒" % (st, el))
print("   响应体 =", json.dumps(body, ensure_ascii=False)[:200])

ok_shape = isinstance(body, dict) and all(k in body for k in ("success", "inserted", "updated", "skipped"))
print("")
print("③ 判据")
print("   [%s] 响应结构完整（success/inserted/updated/skipped）" % ("PASS" if ok_shape else "FAIL"))
print("   [%s] 耗时 < 2 秒（改前 140 秒）" % ("PASS" if el < 2 else "FAIL"))
print("   [%s] HTTP 200" % ("PASS" if st == 200 else "FAIL"))

# ④ 品牌是否真的登记进待审队列 —— 走接口，不直连库
print("")
print("④ 待审品牌是否真入队（走 GET /api/products/brand-pending 或等价端点）")
for path in ("/api/products/brand-pending", "/api/brands/pending", "/api/products/brands/pending"):
    st2, b2, _ = call(path)
    if st2 == 200:
        names = []
        if isinstance(b2, list):
            names = [x.get("raw_name") for x in b2]
        elif isinstance(b2, dict):
            names = [x.get("raw_name") for x in (b2.get("data") or b2.get("rows") or [])]
        hit = [n for n in names if n and n.startswith(TAG)]
        print("   %s → 200，命中本轮测试品牌 %d 个: %s" % (path, len(hit), hit))
        print("   [%s] 3 个测试品牌全部入队" % ("PASS" if len(hit) >= 3 else "FAIL"))
        break
    else:
        print("   %s → %s（不可用，试下一个）" % (path, st2))
else:
    print("   ⚠️ 未找到可读的待审队列端点，改用库内直查（见另一支脚本）")

# ⑤ 清理：把测试商品停用 + 清测试待审品牌（走 SQL 更可靠，这里只打印标记）
print("")
print("⑤ 清理标记：商品 source='%s' / 待审 raw_name LIKE '%s%%'" % (TAG, TAG))
print("   （清理由 /tmp/v195-http-cleanup.py 执行，避免本脚本持有写锁）")
