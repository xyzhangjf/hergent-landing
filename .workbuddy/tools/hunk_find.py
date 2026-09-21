#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按关键字在 `git diff -U0` 里定位 hunk —— 给 scoped 提交的 `own_hunks` 提供精确清单。

为什么需要它（而不是直接看 `hunk_index.py` 的索引表）：
  `hunk_index.py` 只打**首条**新增行，一个 hunk 里除了首行还可能有别的语义；
  本工具把**命中关键字的那几行**打出来，可以直接肉眼判归属（skill hergent-scoped-commit
  §5.10：「归属判定的正确姿势是『逐 hunk 读正文』，标记串只作辅助」）。

用法：
  python3 hunk_find.py <仓库路径> <文件相对路径> <关键字1> [关键字2 ...]
  # 例：python3 hunk_find.py /path/to/repo server/erp_db.py v219 forecast_period_reopen

输出：
  每个命中 hunk 打印 `os`（旧侧起始行 = own_hunks/exclude_hunks 要填的数）、
  旧/新行数、以及命中的行（含 `+`/`-` 前缀，便于区分新增还是删除）。
  末尾打印**命中 os 清单**（可直接粘贴进 spec）与**未命中 hunk 总数**（用于交叉核对）。
"""
import re
import subprocess
import sys


def parse(path, diff_text):
    hunks, cur = [], None
    for ln in diff_text.splitlines():
        if ln.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            if not m:
                continue
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "ns": int(m.group(3)), "nc": int(m.group(4) or 1), "lines": []}
            hunks.append(cur)
        elif cur is not None:
            if ln[:1] in "+-":
                cur["lines"].append(ln)
    return hunks


def main():
    repo, path = sys.argv[1], sys.argv[2]
    kws = sys.argv[3:]
    if not kws:
        sys.exit("至少给一个关键字")

    diff = subprocess.run(["git", "-C", repo, "diff", "-U0", "--", path],
                          capture_output=True, text=True).stdout
    hunks = parse(path, diff)
    if not hunks:
        print("（该文件无 diff —— 可能未跟踪，见 skill §10.9）")
        return

    hit = []
    for h in hunks:
        matched = [l for l in h["lines"] if any(k in l for k in kws)]
        if matched:
            hit.append(h)
            print("── os=%-6d oc=%-4d nc=%-4d 命中 %d 行" % (h["os"], h["oc"], h["nc"], len(matched)))
            for l in matched[:8]:
                print("     %s" % l[:160])
            if len(matched) > 8:
                print("     …（另 %d 行）" % (len(matched) - 8))
            print()

    print("命中 os 清单 = %s" % sorted(h["os"] for h in hit))
    print("命中 %d / 总 %d 个 hunk" % (len(hit), len(hunks)))


if __name__ == "__main__":
    main()
