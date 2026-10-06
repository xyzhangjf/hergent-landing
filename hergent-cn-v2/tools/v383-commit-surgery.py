#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v383 受控提交 · blob 手术（剔掉同一文件里并行会话的在途改动）

背景：
  工作区 `hergent-cn-v2/src/pages/EmployeeArchive.vue` 内含**两件事**：
    A. 本轮 v383 修复（`saveEmployeeCore` 新建分支 + `createAccountInEdit` 守卫）—— **我的**
    B. 并行会话的深色模式改动（2 行 CSS：`.df-role.stopped` / `.stopped-tag` 由硬编码色
       改为 `var(--st-draft-bg|txt)`）—— **别人的**（在途，尚未提交）

  整文件 `git add` = 冒认别人的改动 ⇒ 必须做 blob 手术：
  把工作区内容里**别人的那 2 行回退成 HEAD 版**，生成"干净版"再挂 blob；
  **工作区保持原样不动**（仍是待对方提交的状态）。

三面自证（缺一即假通过）：
  ① 干净版 vs HEAD —— 只有我的改动；新增行不含被剔关键词 `st-draft`
  ② 干净版 vs 工作区 —— 恰好 2 行差，方向正确（`-` 干净版硬编码色 → `+` 工作区变量）
  ③ 三方计数 MINE / STALE：干净版 / 工作区 / HEAD
     🔴 判别力：STALE 在 HEAD 必须为 0，否则说明这几行本来就在 HEAD 里、剔了会回退线上

用法：python3 v383-commit-surgery.py [--repo DIR] [--out /tmp/EmployeeArchive.v383.vue]
"""
import argparse
import difflib
import os
import subprocess
import sys

REL = "hergent-cn-v2/src/pages/EmployeeArchive.vue"

# 别人的那 2 行：HEAD 版（硬编码色）↔ 工作区版（CSS 变量）
PEER_HEAD = [
    ".df-role.stopped{background:#e5e7eb !important;color:#9aa0a6 !important}",
    ".stopped-tag{display:inline-block;margin-left:6px;font-size:11px;padding:1px 7px;border-radius:8px;background:#e5e7eb;color:#6b7280}",
]
PEER_WORK_MARK = "var(--st-draft-bg)"

# 我的改动里独有的判别串（只可能出现在本轮 v383 改动中）
MINE_MARK = "请先点击"
MINE_MARK2 = "v383"


def git(repo, *args, **kw):
    return subprocess.run(["git", "-C", repo] + list(args),
                          capture_output=True, text=True, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.getcwd())
    ap.add_argument("--out", default="/tmp/EmployeeArchive.v383.vue")
    a = ap.parse_args()

    repo = a.repo
    work_path = os.path.join(repo, REL)

    work = open(work_path, encoding="utf-8").read()
    head = git(repo, "show", "HEAD:" + REL).stdout
    if not head:
        print("🔴 取不到 HEAD 版内容"); return 1

    head_lines = head.split("\n")
    work_lines = work.split("\n")

    # ── 构造干净版：逐行替换 PEER 的 2 行 ───────────────────────────
    clean_lines = list(work_lines)
    hit = 0
    for i, ln in enumerate(clean_lines):
        if PEER_WORK_MARK in ln:
            # 按选择器前缀（`{` 之前的部分）在 PEER_HEAD 里找唯一对应行
            sel = ln.split("{", 1)[0]
            cand = [h for h in PEER_HEAD if h.split("{", 1)[0] == sel]
            if len(cand) != 1:
                print("🔴 第 %d 行找不到唯一 HEAD 对应行: %s" % (i + 1, ln[:60])); return 1
            clean_lines[i] = cand[0]
            hit += 1
    clean = "\n".join(clean_lines)

    print("== 构造结果 ==")
    print("  替换回退的并行会话行数: %d（期望 2）" % hit)
    if hit != 2:
        print("🔴 回退行数不符 —— 工作区可能已被对方继续修改，停手"); return 1

    # ── 自证 ①：干净版 vs HEAD ────────────────────────────────────
    print("\n== ① 干净版 vs HEAD ==")
    d1 = [l for l in difflib.unified_diff(head.split("\n"), clean.split("\n"),
                                          "HEAD", "clean", lineterm="", n=0)
          if l[:1] in "+-" and l[:3] not in ("+++", "---")]
    plus1 = [l for l in d1 if l.startswith("+")]
    st = sum(1 for l in plus1 if "st-draft" in l)
    print("  diff 行数: %d（+%d / -%d）" % (len(d1), len(plus1), len(d1) - len(plus1)))
    print("  新增行里含 'st-draft': %d（期望 0）" % st)
    if st != 0:
        print("🔴 干净版仍含并行会话的 CSS 变量 —— 回退失败"); return 1
    # 我的标记必须在
    for mk in (MINE_MARK, MINE_MARK2):
        n = sum(1 for l in plus1 if mk in l)
        print("  新增行里含 '%s': %d（期望 >0）" % (mk, n))
        if n == 0:
            print("🔴 我的改动不在干净版里"); return 1

    # ── 自证 ②：干净版 vs 工作区，恰好 2 行 ───────────────────────
    print("\n== ② 干净版 vs 工作区 ==")
    d2 = [l for l in difflib.unified_diff(clean.split("\n"), work.split("\n"),
                                          "clean", "work", lineterm="", n=0)
          if l[:1] in "+-" and l[:3] not in ("+++", "---")]
    minus2 = [l for l in d2 if l.startswith("-")]
    plus2 = [l for l in d2 if l.startswith("+")]
    print("  差 %d 行（- %d / + %d），期望 2 / 2" % (len(d2), len(minus2), len(plus2)))
    for l in d2:
        print("    " + l[:100])
    ok_dir = all("st-draft" in l for l in plus2)
    print("  `+` 侧全部含 'st-draft': %s（期望 True —— 方向正确：clean→work 是加变量）" % ok_dir)
    if len(minus2) != 2 or len(plus2) != 2 or not ok_dir:
        print("🔴 差异行数或方向不符（期望 -2/+2）"); return 1

    # ── 自证 ③：三方计数 ─────────────────────────────────────────
    print("\n== ③ 三方计数（MINE / STALE）==")
    def cnt(txt, key):
        return txt.count(key)
    print("  %-18s %-8s %-8s %-8s" % ("关键词", "干净版", "工作区", "HEAD"))
    STALE_KEY = "var(--st-draft-bg)"   # 每行恰 1 次，避免 bg/txt 重复计数
    for key, exp in ((STALE_KEY, (0, 2, 0)), (MINE_MARK, None), ("v383", None)):
        c_clean, c_work, c_head = cnt(clean, key), cnt(work, key), cnt(head, key)
        print("  %-18s %-8d %-8d %-8d" % (key, c_clean, c_work, c_head))
        if exp is not None and (c_clean, c_work, c_head) != exp:
            print("🔴 %s 三面读数 %s 不符期望 %s —— 判别力不成立"
                  % (key, (c_clean, c_work, c_head), exp)); return 1
        if key == MINE_MARK and not (c_clean > 0 and c_work > 0 and c_head == 0):
            print("🔴 MINE 判别力不成立（HEAD 应为 0）"); return 1

    with open(a.out, "w", encoding="utf-8") as f:
        f.write(clean)
    print("\n✅ 干净版已写出: %s  (%d 字节)" % (a.out, os.path.getsize(a.out)))
    print("   ⚠️ 工作区**未改动**（仍是待对方提交的状态）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
