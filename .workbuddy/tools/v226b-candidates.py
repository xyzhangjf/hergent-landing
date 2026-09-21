#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v226/v226b 候选 hunk 枚举器（**判据式**，取代 vs-classify 的两分类）。

为什么另写：v226b-hunk-classify.py 只认「等长术语替换」与「含标记串的行」两分类，
实测**双向都错**：
  · 少判（把自己的判成在途）：`return Number(r?.factory_price || 0)`（os=2692）、
    `.filter(p => fpEff(p).from === 'none')`（ProductArchive os=723）、
    `customer_prices` 式的 `purchase_price → factory_price` 单词对换（os=3362/3859/3867/3872/4043/4143）
  · 多判：纯插入的**空行**会命中「纯插入+标记」分支（os=115/9188）
⇒ 改为「列出**所有可能属于我**的 hunk，再由人逐条读正文裁定」。
   候选判据（任一成立即入列，宁多勿少）：
     ① `-` 侧含「厂价」 —— v226 是**全系统删「厂价」**，凡 HEAD 有厂价处被我改名都会命中
     ② `+` 侧含 `v226` / `v226b` 标记
     ③ `+` 侧含 `factory_price`（v226b 新增/改名的物理列引用）
     ④ `+` 侧出现 `purchase_price` 与 `factory_price` 的**对换**（进价列合一的连带修改）
   输出每条附「-首行 / +首行 / 行数」，供人 30 秒裁定。
只读。
"""
import re
import subprocess
import sys


def hunks_of(repo, path):
    txt = subprocess.run(["git", "-C", repo, "diff", "-U0", "--", path],
                         capture_output=True, text=True).stdout
    hs, cur = [], None
    for ln in txt.split("\n"):
        if ln.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "ns": int(m.group(3)), "nc": int(m.group(4) or 1),
                   "minus": [], "added": []}
            hs.append(cur)
        elif cur is not None and ln.startswith("+") and not ln.startswith("+++"):
            cur["added"].append(ln[1:])
        elif cur is not None and ln.startswith("-") and not ln.startswith("---"):
            cur["minus"].append(ln[1:])
    return hs


def why(h):
    m, p = "\n".join(h["minus"]), "\n".join(h["added"])
    w = []
    if "厂价" in m:
        w.append("①-m厂价")
    if "v226" in p:
        w.append("②+v226")
    if "factory_price" in p:
        w.append("③+factory_price")
    if "purchase_price" in m and "factory_price" in p:
        w.append("④purchase→factory")
    return w


def main():
    repo, paths = sys.argv[1], sys.argv[2:]
    for path in paths:
        hs = hunks_of(repo, path)
        cand = [(h, why(h)) for h in hs]
        cand = [(h, w) for h, w in cand if w]
        print("=" * 100)
        print("%s：hunk 总 %d，候选 %d" % (path, len(hs), len(cand)))
        for h, w in cand:
            ms = (h["minus"][0] if h["minus"] else "").strip()[:78]
            ps = (h["added"][0] if h["added"] else "").strip()[:78]
            print("os=%-6d oc=%-3d -%-3d +%-3d %-26s M|%s" %
                  (h["os"], h["oc"], len(h["minus"]), len(h["added"]), ",".join(w), ms))
            print("%-46s P|%s" % ("", ps))
        print("-- 候选 os: %s" % [h["os"] for h, _ in cand])


main()
