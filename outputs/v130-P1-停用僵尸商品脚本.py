# -*- coding: utf-8 -*-
"""P1-A 第二步：停用「不准备做」的品牌下的僵尸商品（is_active: 1 -> 0）。
可逆：随时可用 --undo 恢复为 1。走 PUT /api/products/{id} 以留下字段级变更日志。
"""
import json
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://hergent.cn"
TENANT = "1"
USER, PWD = "mptestsp", "Mpsup@1"

BRANDS = ['赠品', '君乐宝', '蒙牛常温', '友芝友', '蒙牛奶酪', '蒙牛乳饮',
          '妙可蓝多', '妙奇', '旭培', '光明', '测试品牌', '蒙牛']
TARGET = 0  # 0 = 停用, 1 = 恢复

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(m, p, b=None, t=None):
    d = json.dumps(b).encode() if b is not None else None
    r = urllib.request.Request(BASE + p, data=d, method=m)
    r.add_header("Content-Type", "application/json")
    r.add_header("X-Tenant-Id", TENANT)
    if t:
        r.add_header("Authorization", "Bearer " + t)
    with op.open(r, timeout=60) as resp:
        return json.loads(resp.read().decode() or "null")


def main():
    target = 1 if "--undo" in sys.argv else 0
    dry = "--dry-run" in sys.argv
    tok = call("POST", "/api/auth/login", {"username": USER, "password": PWD})["token"]

    todo = []
    for b in BRANDS:
        q = urllib.parse.urlencode({"brand": b, "include_inactive": 0, "limit": 100000})
        rows = call("GET", "/api/products?" + q, None, tok)
        items = rows.get("items", rows) if isinstance(rows, dict) else rows
        for it in items:
            todo.append((b, it["id"], it.get("name", "")))

    print("将把 %d 个商品 is_active -> %d" % (len(todo), target))
    for b in BRANDS:
        n = len([x for x in todo if x[0] == b])
        if n:
            print("   %-10s %d" % (b, n))
    if dry:
        print("[dry-run] 未写入")
        return

    ok = fail = 0
    for i, (b, pid, name) in enumerate(todo, 1):
        try:
            call("PUT", "/api/products/%d" % pid, {"is_active": target}, tok)
            ok += 1
        except Exception as e:
            fail += 1
            print("  !! %s #%s %s -> %s" % (b, pid, name, e))
        if i % 40 == 0:
            print("   ... %d/%d" % (i, len(todo)))
            time.sleep(0.3)
    print("完成: 成功 %d, 失败 %d" % (ok, fail))

    g = call("GET", "/api/products/grid", None, tok)
    print("grid 现在返回:", len(g.get("items", [])), "条商品")


if __name__ == "__main__":
    main()
