#!/usr/bin/env python3
"""2026-10-21 封堵 P0：nginx hergent 站点 .git/备份/内部文档公网泄露。

幂等：若已含本次 deny 标记则跳过。只改 sites-enabled/hergent 一个文件，不 reload。
"""
import sys

P = "/etc/nginx/sites-enabled/hergent"

MARK = "# 🔴 2026-10-21 封堵：.git/备份/内部文档公网泄露（审计 P0）"
RULES = (
    "    location /hermes/ {\n"
    "        return 403;\n"
    "    }\n"
    "\n"
    + MARK + "\n"
    "    location ~ /\\.(git|env|svn|hg)  { deny all; }\n"
    "    location ~* \\.(db|sqlite|sqlite3|sql|pem|key|tar\\.gz|tgz)$ { deny all; }\n"
    "    location ~* \\.md$               { deny all; }\n"
)
ANCHOR = (
    "    location /hermes/ {\n"
    "        return 403;\n"
    "    }\n"
)

s = open(P).read()

if MARK in s:
    print("ALREADY_PATCHED: mark exists, skip")
    sys.exit(0)

n = s.count(ANCHOR)
if n != 1:
    print("ANCHOR_NOT_UNIQUE: count=%d" % n)
    sys.exit(2)

s = s.replace(ANCHOR, RULES, 1)
open(P, "w").write(s)
print("PATCHED_OK")
