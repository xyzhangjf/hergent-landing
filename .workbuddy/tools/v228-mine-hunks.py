#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按「判别串」找出**属于本轮**的 hunk，报出 old_start（供 scoped commit 的 own_hunks 用）。

用法:
  python3 v228-mine-hunks.py <repo> <relpath> <判别串1> [判别串2 ...]

为什么需要它（v228 实测）：
  `hergent-erp` 的工作区长期含**别人的在途改动** —— 本轮我只改了 4 个文件、共约 150 行，
  但 `git diff HEAD` 显示 `erp_db.py` +627/-31（45 个 hunk）、`import_router.py` +316/-65（64 个 hunk）
  ⇒ **95% 的 hunk 不是我的**。直接 scp 工作区文件到生产 = 把别人的在途改动一起推上线。

判据：
  取每个 hunk 的「+/- 行正文」拼成一个 blob，含任一判别串即判为「我的」。
  ⚠️ 判别串要挑**有区分度**的（别用 `def ` / `import` 这种满仓都是的）。

输出：每个命中 hunk 的 old_start + 增删行数 + 命中的串；末尾给总 hunk 数。
"""
import re
import subprocess
import sys


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    repo, path = sys.argv[1], sys.argv[2]
    marks = sys.argv[3:]
    out = subprocess.run(["git", "-C", repo, "diff", "-U0", "HEAD", "--", path],
                         capture_output=True, text=True).stdout
    if not out.strip():
        print("(无差异)")
        return 0
    cur = None
    hunks = []
    for ln in out.split("\n"):
        m = re.match(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
        if m:
            cur = {"os": int(m.group(1)), "ol": int(m.group(2) or 1),
                   "adds": [], "dels": []}
            hunks.append(cur)
            continue
        if cur is None:
            continue
        if ln.startswith("+++") or ln.startswith("---"):
            continue
        if ln.startswith("+"):
            cur["adds"].append(ln[1:])
        elif ln.startswith("-"):
            cur["dels"].append(ln[1:])
    mine = []
    for h in hunks:
        blob = "\n".join(h["adds"] + h["dels"])
        hit = [mk for mk in marks if mk in blob]
        if hit:
            mine.append(h["os"])
            print("  os=%-6d +%-4d -%-4d  ← %s" % (h["os"], len(h["adds"]), len(h["dels"]),
                                                  " | ".join(hit)))
    print("  命中 %d / 总 hunk %d" % (len(mine), len(hunks)))
    print("  own_hunks =", mine)


if __name__ == "__main__":
    sys.exit(main())
