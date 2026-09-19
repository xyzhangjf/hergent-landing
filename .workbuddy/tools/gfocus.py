#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只把「本次改动」的 hunk 提交进索引 —— 跳过工作区里其它在途改动。

## 为什么需要它

Hergent 两个仓库（hergent-erp / laozhangai-product）长期处于「工作区整体即在途」的
状态：`git status` 常有 20~30 个改动文件，且同一文件里既有本次改动、也有上一轮没提交
的改动（例如 core.py 里既有本次的邀请码建表，也有更早的 bcrypt2$ 口令哈希重写）。
直接 `git add <file>` 会把无关改动一起打包，提交信息与内容不符，日后无法据此审计。

## 原理

`git diff` 的输出天然按 hunk 切分。本脚本：
  1. 取指定文件的完整 diff（逐文件，避免跨文件 hunk 混淆）；
  2. 按 hunk 粒度过滤 —— 只保留**内容命中关键字**的 hunk；
  3. 重组为合法 patch，`git apply --cached` 进索引（只动索引，不动工作区）；
  4. 打印已暂存 hunk 的摘要供人工复核。

⚠️ 放宽点：若命中行与无关改动**落在同一个 hunk 内**（上下文 3 行内相邻），该无关改动
会被一并带入。所以跑完务必用 `git diff --cached` 复核。

用法：
    gfocus.py --repo DIR --file a.py --file b.py --kw invite_codes --kw REGISTER_MODE
    gfocus.py --repo DIR --file a.py --kw X --check      # 只显示将要暂存的 diff
"""
import argparse
import re
import subprocess
import sys
import tempfile

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", re.M)


def run(repo, *args, **kw):
    r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True, **kw)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + r.stderr)
    return r


def split_diff(diff):
    """→ (header_lines, [(hunk_text, kw_hits)])"""
    lines = diff.splitlines(keepends=True)
    head, hunks, cur = [], [], None
    for ln in lines:
        if HUNK_RE.match(ln):
            if cur is not None:
                hunks.append("".join(cur))
            cur = [ln]
        elif cur is None:
            head.append(ln)
        else:
            cur.append(ln)
    if cur is not None:
        hunks.append("".join(cur))
    return head, hunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--file", action="append", required=True, dest="files")
    ap.add_argument("--kw", action="append", default=[], dest="kws")
    ap.add_argument("--check", action="store_true", help="只打印，不写入索引")
    a = ap.parse_args()

    total_kept = total_skip = 0
    for f in a.files:
        d = run(a.repo, "diff", "--", f).stdout
        if not d.strip():
            print(f"· {f}: 无改动")
            continue
        head, hunks = split_diff(d)
        keep = []
        for h in hunks:
            body = h.split("\n", 1)[1] if "\n" in h else ""
            added = "\n".join(l[1:] for l in body.splitlines() if l.startswith("+"))
            hits = [k for k in a.kws if k in added]
            if hits:
                keep.append(h)
                st = HUNK_RE.match(h).group(0)
                print(f"  ✅ {f} {st}  ← {', '.join(hits)}")
            else:
                total_skip += 1
        total_kept += len(keep)
        if not keep:
            print(f"· {f}: 无命中 hunk（全部跳过，共 {len(hunks)} 个）")
            continue
        patch = "".join(head) + "".join(keep)
        if not patch.endswith("\n"):
            patch += "\n"
        if a.check:
            print("\n" + "=" * 70)
            print(patch)
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False) as t:
            t.write(patch)
            p = t.name
        r = run(a.repo, "apply", "--cached", "--unidiff-zero" if False else "--recount", p)
        if r.returncode != 0:
            r = run(a.repo, "apply", "--cached", p)
        print(f"   → git apply --cached: {'OK' if r.returncode == 0 else 'FAILED'}")
        if r.returncode != 0:
            sys.exit(1)

    print(f"\n暂存 {total_kept} 个 hunk，跳过 {total_skip} 个（其它在途改动）")
    if not a.check:
        print("\n=== 请复核 git diff --cached ===")


if __name__ == "__main__":
    main()
