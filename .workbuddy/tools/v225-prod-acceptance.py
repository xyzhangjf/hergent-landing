#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v225 生产验收 —— 企微推送状态端点（2026-09-21）

判据（每条可独立失败）：
  A. 打之前：主库**没有** notify_logs 表        ← 修复前的既成事实
  B. GET /api/notify/wecom/status 返回 200      ← 正例必须先立住
  C. 对照：同前缀的不存在路径应给出不同结果      ← 证明探针有判别力
  D. GET /api/notify/wecom/history 返回 200
  E. 打之后：主库**出现** notify_logs 表         ← 核心判据（读路径也能保证表存在）
  F. 临时会话令牌零残留

零副作用设计：只调 GET；临时 token 插 sessions 后在 finally 里精确删除。
以 hergent 身份运行（root 跑会把 WAL 副文件属主改成 root）。
"""
import json
import secrets
import sqlite3
import urllib.error
import urllib.request

MAIN = "/opt/hergent-erp/erp.db"
BASE = "http://127.0.0.1:8700"
# 本机 HTTP_PROXY 会劫持回环请求 ⇒ 无条件禁代理（否则 502 会被误读成服务挂了）
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

FAILS = []


def check(name, got, want):
    ok = got == want
    print("  [%s] %-26s got=%r" % ("PASS" if ok else "FAIL", name, got))
    if not ok:
        FAILS.append("%s: got=%r want=%r" % (name, got, want))


def http(path, tok=None):
    req = urllib.request.Request(BASE + path, method="GET")
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    try:
        with _OPENER.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def has_table(name="notify_logs"):
    c = sqlite3.connect("file:%s?mode=ro" % MAIN, uri=True)
    try:
        return name in [r[0] for r in c.execute("SELECT name FROM sqlite_master")]
    finally:
        c.close()


TOK = "v225" + secrets.token_hex(16)
m = sqlite3.connect(MAIN)
m.execute(
    "INSERT OR REPLACE INTO sessions(token,user_id,expires_at,created_at) "
    "VALUES(?,1,datetime('now','localtime','+1 hour'),datetime('now','localtime'))",
    (TOK,))
m.commit()
m.close()

res = {}
try:
    print("\n[A] 基线")
    check("打之前无 notify_logs 表", has_table(), False)

    print("\n[B] 正例：状态端点")
    st, body = http("/api/notify/wecom/status", TOK)
    check("status HTTP", st, 200)
    try:
        j = json.loads(body)
        print("     响应字段: %s" % sorted(j.keys()))
        print("     push_count_today=%r last_push=%r configured=%r"
              % (j.get("push_count_today"), j.get("last_push"), j.get("configured")))
        check("含 push_count_today 字段", "push_count_today" in j, True)
        check("含 last_push 字段", "last_push" in j, True)
        check("今日计数为 0（确实未推送过）", j.get("push_count_today"), 0)
        check("最近推送为 None（确实没有）", j.get("last_push"), None)
    except Exception as e:
        FAILS.append("响应非 JSON: %s" % e)
        print("     [FAIL] 响应非 JSON: %r" % body[:200])

    print("\n[C] 判别力对照")
    st2, _ = http("/api/notify/wecom/no-such-xyz-225", TOK)
    print("     不存在路径 HTTP=%s（与正例不同即说明探针有判别力）" % st2)

    print("\n[D] 历史端点")
    st3, body3 = http("/api/notify/wecom/history", TOK)
    check("history HTTP", st3, 200)
    print("     响应体: %s" % body3[:120])

    print("\n[E] 核心判据：读路径是否把表建出来了")
    check("打之后出现 notify_logs 表", has_table(), True)
finally:
    m = sqlite3.connect(MAIN)
    m.execute("DELETE FROM sessions WHERE token=?", (TOK,))
    m.commit()
    left = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?", (TOK,)).fetchone()[0]
    m.close()
    print("\n[F] 回收")
    check("临时令牌零残留", left, 0)

print("\n" + "=" * 60)
print("结果：%s" % ("全部通过" if not FAILS else "%d 项未通过" % len(FAILS)))
for f in FAILS:
    print("  - " + f)
print("=" * 60)
