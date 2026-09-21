#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v226b 本轮改动的**正向定位器**：按特征串扫全部 `+` 行，报出「哪个 hunk 含有我的改动」。

为什么必须另写一个（v226b-hunk-classify.py 不够）：
  · 分类器只认两类：① 等长术语替换（厂价↔进价）② 含 MY_MARKS 的行。
  · 而我 v226b 的**核心代码改动 `return Number(r?.factory_price || 0)`** 既不是术语替换、
    也不含任何标记串 ⇒ 被判在途（os=2692）⇒ 若照它给的名单提交，**最关键的那行不会进 HEAD**。
  · 「判据只看一侧、缺项就隐形」的又一例（§5.10）。
⇒ 判据改为：**我写过的每个特征串，必须至少命中 1 个 hunk**；命中为空 = 该类改动未落名单。
   每个串都要求命中数 >0（漏了会显式报出来），这才是「防少」。

用法：python3 v226b-mine-scan.py <repo> <path>
只读。
"""
import re
import subprocess
import sys

# 只列「**只有本轮 v226/v226b 才会出现**」的串（HEAD 里没有）。
# 逐条都是我在本会话写下的字面量，改完代码就变了 ⇒ 名单失效是**信号**，不是噪音。
PATTERNS = [
    # ---- v226b：注释块（四处） ----
    "v226b",
    # ---- v226b：Forecast.vue 的代码改动 ----
    r"return Number\(r\?\.factory_price \|\| 0\)",
    r"进价\(元/箱\)",
    r"金额按标准售价估算",
    r"'进价': 'factory_price'",
    r"\.\.\.\(Number\(x\.factory_price\) > 0 \? \{ factory_price",
    r"factory_price: Number\(src\.factory_price\)",
    r"sale_price: 1, factory_price: 1",
    r"factory_price: 0, product_code",
    r"'factory_price',\s*//|DRAFT_MASTER.*factory_price",
    # ---- v226b：ProductArchive.vue ----
    r"fpEff\(p\)\.from === 'none'",
    r"本表只列",
    r"不代表能算金额",
    r"禁止\*\*把本函数的返回值当作",
]
# 额外：v226b 的粘贴表头/数值列名单，用宽松串各自报计数（不为 0 即可）
SOFT = [
    r"factory_price",
]


def hunks_with_added(repo, path):
    txt = subprocess.run(["git", "-C", repo, "diff", "-U0", "--", path],
                         capture_output=True, text=True).stdout
    hs, cur = [], None
    for ln in txt.split("\n"):
        if ln.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "ns": int(m.group(3)), "added": []}
            hs.append(cur)
        elif cur is not None and ln.startswith("+") and not ln.startswith("+++"):
            cur["added"].append(ln[1:])
    return hs


def main():
    repo, path = sys.argv[1], sys.argv[2]
    hs = hunks_with_added(repo, path)
    print("%s：hunk 总 %d，新增行合计 %d" % (path, len(hs), sum(len(h["added"]) for h in hs)))
    hit_hunks = set()
    for pat in PATTERNS:
        rx = re.compile(pat)
        hits = [(h["os"], i, x.strip()[:96]) for h in hs
                for i, x in enumerate(h["added"]) if rx.search(x)]
        flag = "ok " if hits else "🔴0"
        print("%s %-58s 命中 %d 个 hunk" % (flag, pat[:58], len(set(h[0] for h in hits))))
        for os_, i, snip in hits[:4]:
            print("        os=%-6d +%-3d | %s" % (os_, i, snip))
        hit_hunks |= set(h[0] for h in hits)
    print("-- 特征串命中的 hunk（并入我的名单）: %s" % sorted(hit_hunks))
    for pat in SOFT:
        n = sum(1 for h in hs for x in h["added"] if re.search(pat, x))
        print("   参考计数 %-16s = %d" % (pat, n))


main()
