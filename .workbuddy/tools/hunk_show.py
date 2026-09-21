#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打印指定 hunk 的**完整正文**（`+`/`-` 两侧都打）—— 归属判定的最后一步。

为什么必须有它：skill hergent-scoped-commit §10.10 / §5.10 反复记着同一条教训 ——
**关键词法只能生成候选，不能当结论**。一个 hunk 里可能「首行是在途的、尾行是我的」
（或反之），只看索引表的首行必然判错。逐 hunk 读全文是唯一可靠手段，成本只有几十行输出。

用法：
  python3 hunk_show.py <仓库路径> <文件相对路径> <os1,os2,...>
  # 例：python3 hunk_show.py /path/to/repo server/routers/x.py 57,303,384
"""
import re
import subprocess
import sys


def main():
    repo, path, spec = sys.argv[1], sys.argv[2], sys.argv[3]
    want = {int(x) for x in spec.split(",") if x.strip()}
    diff = subprocess.run(["git", "-C", repo, "diff", "-U0", "--", path],
                          capture_output=True, text=True).stdout

    cur, hunks = None, []
    for ln in diff.splitlines():
        if ln.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "ns": int(m.group(3)), "nc": int(m.group(4) or 1), "body": []}
            hunks.append(cur)
        elif cur is not None:
            cur["body"].append(ln)

    found = 0
    for h in hunks:
        if h["os"] not in want:
            continue
        found += 1
        print("=" * 78)
        print("@@ -%d,%d +%d,%d @@   os=%d" % (h["os"], h["oc"], h["ns"], h["nc"], h["os"]))
        print("=" * 78)
        for l in h["body"]:
            print(l)
        print()

    missing = want - {h["os"] for h in hunks}
    if missing:
        print("⚠️ 找不到这些 os（基线漂移或号写错？）: %s" % sorted(missing))
    print("打印 %d 个 hunk（该文件共 %d 个）" % (found, len(hunks)))


if __name__ == "__main__":
    main()
