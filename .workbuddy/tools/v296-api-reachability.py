#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v296 接口可达性正反例（生产 · 只读 GET）。

判据设计（为什么这几条一起跑才有判别力）：
  · 正例 `/api/cron/jobs`、`/api/bid-radar`：拆模块后 sales **应当**能调（迁移补了 cron/bid）。
  · 反例 `/api/bi/summary`、`/api/reports/export`：sales 没有 `reports` ⇒ **必须仍 403**。
    —— 这一条是「遮蔽已被解除、而 `reports` 域没有被顺手放宽」的**唯一证据**：
       若把 `/api/bid-radar` 提前时误改了 `/api/bi`，反例就会变成 200。
  · 用 mptest（sales / tenant 1）的身份，不触碰任何写接口。
"""
import json
import urllib.request

BASE = "https://hergent.cn"
USER, PASS = "mptest", "Mptest@1"

CASES = [
    ("/api/cron/jobs", "正例：cron 模块（迁移补上了）"),
    ("/api/bid-radar", "正例：bid 模块（原本因被 /api/bi 吞掉而恒 403 ⇒ 假入口）"),
    ("/api/bi/summary", "反例：reports 域，sales 无此模块 ⇒ 必须仍 403"),
    ("/api/reports/export", "反例：reports 域，同上"),
    ("/api/auth/perms-rev", "未认证访问 ⇒ 必须 401"),
]


def req(url, data=None, token=None):
    r = urllib.request.Request(BASE + url, method="POST" if data else "GET")
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    body = json.dumps(data).encode() if data else None
    try:
        with urllib.request.urlopen(r, body, timeout=25) as resp:
            # 🔴 必须读**全量**：上一版 `resp.read(400)` 把 JSON 截断在字符串中间，
            #    `json.loads` 直接抛 Unterminated string（探针的错，不是产品的错）。
            #    截断只该发生在**打印**时。
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main():
    st, body = req("/api/auth/login", {"username": USER, "password": PASS})
    if st != 200:
        print("!! 登录失败 %s %s" % (st, body)); return 1
    d = json.loads(body) if body.strip().startswith("{") else {}
    token = d.get("token")
    print("登录 %s ⇒ HTTP=%s role=%s tenant_id=%s" % (USER, st, (d.get("user") or {}).get("role"), d.get("tenant_id")))
    print("=" * 70)
    bad = 0
    for path, note in CASES:
        t = None if "perms-rev" in path else token
        s, b = req(path, None, t)
        expect = 401 if "perms-rev" in path else (200 if path in ("/api/cron/jobs", "/api/bid-radar") else 403)
        flag = "OK " if s == expect else "!!!"
        if s != expect:
            bad += 1
        print("%s %-24s HTTP=%-4s (期望 %s)  %s" % (flag, path, s, expect, note))
        print("      body=%s" % (b[:160].replace("\n", " ")))
    print("=" * 70)
    print(("✅ 全部符合预期" if not bad else "❌ %d 条不符预期" % bad))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
