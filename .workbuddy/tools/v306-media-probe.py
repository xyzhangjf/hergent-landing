#!/usr/bin/env python3
"""v301 只读探针：在生产 Hermes 租户 state.db 里取出所有 MEDIA: 引用的真实路径分布。

用途：为「Web 端 MEDIA: 文件卡」的下载端点确定**必须放行的目录白名单**。
🔴 只读：活库用 `mode=ro`（**不带** immutable）。
🔴 不改任何数据、不写任何文件。
"""
import os
import re
import sqlite3
import sys
from collections import Counter

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/hermes-tenants/hergent_t1/state.db"

MEDIA_RE = re.compile(
    r"""MEDIA:\s*(?P<q>["'`]?)(?P<path>(?:/|~/|[A-Za-z]:[/\\])\S+?)(?P=q)(?=\s|$)""",
    re.M,
)

c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=5)
c.row_factory = sqlite3.Row

print("== 会话（按 source 计数）==")
for r in c.execute("SELECT source, COUNT(*) n, SUM(message_count) mc FROM sessions GROUP BY source"):
    print("   source=%-12s 会话=%-3s 消息数合计=%s" % (r["source"], r["n"], r["mc"]))

print("\n== 含 MEDIA: 的消息 ==")
dirs = Counter()
exts = Counter()
total = 0
for r in c.execute(
    "SELECT session_id, role, content FROM messages "
    "WHERE content LIKE '%MEDIA:%' ORDER BY id"
):
    hits = MEDIA_RE.findall(r["content"])
    if not hits:
        continue
    total += len(hits)
    for _q, p in hits:
        dirs[os.path.dirname(p)] += 1
        exts[os.path.splitext(p)[1].lower() or "(无扩展名)"] += 1
    print("   [%s] %s … 命中 %d 个 MEDIA" % (r["session_id"][:26], r["role"], len(hits)))

print("\n== 合计 MEDIA 引用 = %d ==" % total)
print("\n-- 目录分布 --")
for d, n in dirs.most_common():
    print("   %5d  %s" % (n, d))
print("\n-- 扩展名分布 --")
for e, n in exts.most_common():
    print("   %5d  %s" % (n, e))

print("\n== 被引用的文件是否真实存在 / 可读 ==")
for d in dirs:
    if not os.path.isdir(d):
        print("   [目录不存在] %s" % d)
        continue
    files = sorted(os.listdir(d))
    print("   [目录] %s  条目=%d  可读=%s" % (d, len(files), os.access(d, os.R_OK | os.X_OK)))
    for fn in files[:30]:
        fp = os.path.join(d, fn)
        print("        %-46s %8d B  readable=%s" % (fn[:46], os.path.getsize(fp), os.access(fp, os.R_OK)))

c.close()
