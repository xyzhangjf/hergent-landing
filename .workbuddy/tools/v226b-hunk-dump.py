#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按 old_start 打印 -U0 hunk 的**完整**正文（不截断），并把每行标上分类器的归属。

用途：REVIEW（混合）hunk 的归属必须**逐 hunk 读正文**判定。
  v226b-hunk-classify.py 只打印前 6/8 行，混合 hunk 恰恰是行数最多的那批 ⇒ 会读漏。

用法：python3 v226b-hunk-dump.py <repo> <path> <os1,os2,...>
只读。
"""
import re
import subprocess
import sys

SYM = {"M": "[我的]", "O": "[在途]", "?": "[未判]"}


def hunks_of(repo, path):
    txt = subprocess.run(["git", "-C", repo, "diff", "-U0", "--", path],
                         capture_output=True, text=True).stdout
    out, cur = [], None
    for ln in txt.split("\n"):
        if ln.startswith("@@"):
            if cur:
                out.append(cur)
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            cur = {"hd": ln, "os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "minus": [], "plus": []}
        elif cur is not None:
            if ln.startswith("-") and not ln.startswith("---"):
                cur["minus"].append(ln[1:])
            elif ln.startswith("+") and not ln.startswith("+++"):
                cur["plus"].append(ln[1:])
    if cur:
        out.append(cur)
    return out


MY_MARKS = ("v226b", "v226", "进价(元/箱)", "金额按标准售价估算", "本表只列",
            "不代表能算金额", "实测等于标准售价", "档案里有价", "元/箱 进价")


def term_equal(m, p):
    return p.replace("进价", "厂价") == m or m.replace("厂价", "进价") == p


def tag_lines(h):
    """按行给归属标签：借鉴 classify 但**把标签落到行上**，供人读。"""
    import difflib
    m, p = h["minus"], h["plus"]
    sm = difflib.SequenceMatcher(None, m, p, autojunk=False)
    mt, pt = ["?"] * len(m), ["?"] * len(p)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace" and (i2 - i1) == (j2 - j1):
            for k in range(i2 - i1):
                v = "M" if term_equal(m[i1 + k], p[j1 + k]) else "O"
                mt[i1 + k] = pt[j1 + k] = v
        else:
            for k in range(i1, i2):
                mt[k] = "M" if ("厂价" in m[k] and "进价" in "\n".join(p)) else "O"
            for k in range(j1, j2):
                pt[k] = "M" if any(x in p[k] for x in MY_MARKS) else "O"
    return mt, pt


def main():
    repo, path, ospec = sys.argv[1], sys.argv[2], sys.argv[3]
    want = set(int(x) for x in ospec.split(","))
    for h in hunks_of(repo, path):
        if h["os"] not in want:
            continue
        mt, pt = tag_lines(h)
        print("=" * 78)
        print("os=%d oc=%d  %s" % (h["os"], h["oc"], h["hd"]))
        for k, x in enumerate(h["minus"]):
            print(" %s M%d- |%s" % (SYM[mt[k]], k, x))
        for k, x in enumerate(h["plus"]):
            print(" %s P%d+ |%s" % (SYM[pt[k]], k, x))


main()
