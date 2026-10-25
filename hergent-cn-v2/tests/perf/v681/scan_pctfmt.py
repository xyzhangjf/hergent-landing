#!/usr/bin/env python3
"""扫同族缺陷：`"..." % args` 的 %-format 字符串里，出现「% 后跟全角/非 ASCII」⇒ ValueError→500。"""
import os, re, sys

ROOT = "/opt/hergent-erp"
PAT = re.compile(r'"((?:[^"\\]|\\.)*)"\s*%\s*[\(\[\{_\w]')
hits = []
for dp, dns, fns in os.walk(ROOT):
    dns[:] = [d for d in dns if d not in ("__pycache__", "backups", "_backup", "tools", "alembic", "node_modules")]
    for fn in fns:
        if not fn.endswith(".py"):
            continue
        p = os.path.join(dp, fn)
        try:
            lines = open(p, encoding="utf-8", errors="ignore").read().split("\n")
        except Exception:
            continue
        for i, ln in enumerate(lines, 1):
            s = ln.strip()
            if s.startswith("#"):
                continue
            for m in PAT.finditer(ln):
                body = m.group(1)
                # %-format 里合法的转换符只有 %s %d %f %% 等；% 后跟非 ASCII 即崩
                for mm in re.finditer(r"%(.)", body):
                    ch = mm.group(1)
                    if ord(ch) > 127:
                        hits.append((p, i, ch, s[:120]))

print("scanned root:", ROOT)
if not hits:
    print("同族缺陷: 0 处 ✅")
else:
    print("同族缺陷: %d 处" % len(hits))
    for h in hits:
        print("  %s:%d  %%%s  %s" % h)
