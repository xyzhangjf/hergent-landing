#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读侦察：列出若干文件在「HEAD vs 工作区」之间的全部 hunk，并按版本标记预判归属。

用途（配合技能 hergent-scoped-commit）：
  提交前先看清楚「这个文件里到底有几个 hunk、哪些像是本轮的、哪些像是别人的」，
  再决定走 keep_all / markers / exclude_hunks 哪种归属模式。

用法：
    python3 hunk-attribution-report.py <repo路径> <文件1> [<文件2> ...]

输出：每文件每 hunk 一行 ——
    @@ 头 / 删增行数 / 命中的版本标记 / 首行内容预览
⚠️ 只读：不写索引、不碰工作区。判断仍须人工核对 hunk 全文（标记只是线索）。
"""
import re
import subprocess
import sys

MARKS = ["v365", "v364", "v363", "v362", "v361", "v360", "v359", "v358",
         "v357", "v356", "v355", "v354", "v353", "v352", "v351", "v350",
         "v349", "v348", "v347", "v346", "v345"]

HUNK_RE = re.compile(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def git(repo, *a):
    return subprocess.run(["git", "-C", repo] + list(a),
                          capture_output=True, text=True).stdout


def main():
    repo = sys.argv[1]
    files = sys.argv[2:]
    if not files:
        print("用法：hunk-attribution-report.py <repo> <file...>")
        sys.exit(2)
    total = 0
    for f in files:
        d = git(repo, "diff", "-U0", "--", f)
        hunks = []
        cur = None
        for ln in d.split("\n"):
            m = HUNK_RE.match(ln) if ln.startswith("@@") else None
            if m:
                cur = {"os": int(m.group(1)), "old": int(m.group(2) or 1),
                       "ns": int(m.group(3)), "new": int(m.group(4) or 1),
                       "minus": [], "plus": []}
                hunks.append(cur)
            elif cur is not None:
                if ln.startswith("-"):
                    cur["minus"].append(ln[1:])
                elif ln.startswith("+"):
                    cur["plus"].append(ln[1:])
        total += len(hunks)
        print("=" * 80)
        print("%s   (%d hunk)" % (f, len(hunks)))
        for i, h in enumerate(hunks):
            body = h["plus"] + h["minus"]
            hits = [mk for mk in MARKS if any(mk in b for b in body)]
            preview = ""
            for b in (h["plus"] or h["minus"]):
                if b.strip():
                    preview = b.strip()[:64]
                    break
            print("  #%-3d @@ -%-6d,%-4d +%-6d,%-4d  -%-4d/+%-4d  [%-14s] %s"
                  % (i, h["os"], h["old"], h["ns"], h["new"],
                     len(h["minus"]), len(h["plus"]),
                     ",".join(hits) or "-", preview))
    print("=" * 80)
    print("合计 %d hunk" % total)


main()
