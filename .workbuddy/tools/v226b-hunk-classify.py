#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v226b 归属分类器：把工作区 diff 的每个 hunk 判成「我的 / 在途 / 待审」。

为什么需要它：
  本轮要提交的是 **v226（厂价→进价 术语统一）+ v226b（金额基准收紧）**，
  而这两个文件的 HEAD 落后于工作区很多轮（并发会话在途），`Forecast.vue` 的 -U0 hunk 有 200+ 个。

判据（机械可判，不靠关键词猜）：
  · 我的 v226 改动 **全部是等长术语替换**：「厂价」→「进价」都是 3 字节 / 2 个汉字
    ⇒ hunk 的 `-` 行把「厂价」还原成「进价」（或反向）后应当**逐字相等**。
  · 我的 v226b 改动带显式标记 `v226b` / `v226`，或含新文案「进价(元/箱)」「金额按标准售价估算」。
  · 其余一律判在途（宁可少认领，不可多认领 —— §5.10「present 只防少、不防多」的反面）。

输出：逐文件打印 MINE / INFLIGHT / REVIEW 三类，REVIEW 必须人工逐条读完再决定。
只读，不碰索引。
"""
import re
import subprocess
import sys

MY_MARKS = ("v226b", "v226", "进价(元/箱)", "金额按标准售价估算", "本表只列",
            "不代表能算金额", "实测等于标准售价", "档案里有价", "元/箱 进价")
# 术语词对：p 把右换成左后应与 m 相等（或反向）
PAIRS = [("厂价", "进价")]


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


def term_equal(m, p):
    """p 是否只是 m 的术语替换（任一方向）。"""
    for a, b in PAIRS:
        if p.replace(b, a) == m or m.replace(a, b) == p:
            return True
    return False


def classify(h):
    """行级判据：找出 hunk 里**属于我**的行（不靠行数相等的前提）。

    🔴 首版用「两侧行数相等 + 逐行 term_equal」判 MINE ⇒ 只要旁边夹了别人的一行就整块
    被判 INFLIGHT（`Forecast.vue` 因此把 191 个 hunk 判成在途）——**这是"漏判自己的"**，
    与 §5.10 那条「四条自证全在验'没多'」是同一类错误。改为行级配对后：
      · 用 difflib 把 minus/plus 对齐，只在 `replace` 等长块里找术语替换行；
      · `insert` 块里找带我的标记的行。
    """
    import difflib
    m, p = h["minus"], h["plus"]
    sm = difflib.SequenceMatcher(None, m, p, autojunk=False)
    mine_m, mine_p, other_m, other_p = [], [], [], []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace" and (i2 - i1) == (j2 - j1):
            for k in range(i2 - i1):
                if term_equal(m[i1 + k], p[j1 + k]):
                    mine_m.append(m[i1 + k]); mine_p.append(p[j1 + k])
                else:
                    other_m.append(m[i1 + k]); other_p.append(p[j1 + k])
        else:
            for k in range(i1, i2):
                (mine_m if "厂价" in m[k] and "进价" in str(p) else other_m).append(m[k])
            for k in range(j1, j2):
                if any(mk in p[k] for mk in MY_MARKS) or "进价(元/箱)" in p[k]:
                    mine_p.append(p[k])
                else:
                    other_p.append(p[k])
    h["_mm"], h["_mp"], h["_om"], h["_op"] = mine_m, mine_p, other_m, other_p
    if mine_p or mine_m:
        if not other_p and not other_m:
            return "MINE", "全我的（术语/标记）"
        return "REVIEW", "混我的 %d 行 + 在途 %d 行" % (
            len(mine_p) + len(mine_m), len(other_p) + len(other_m))
    # ② 纯插入且全部带我的标记
    if not m and p and all(any(k in x for k in MY_MARKS) or not x.strip() for x in p):
        return "MINE", "纯插入+标记"
    return "INFLIGHT", ""


def main():
    repo = sys.argv[1]
    paths = sys.argv[2:]
    for path in paths:
        hs = hunks_of(repo, path)
        buckets = {"MINE": [], "REVIEW": [], "INFLIGHT": []}
        for h in hs:
            k, why = classify(h)
            buckets[k].append((h, why))
        print("=" * 78)
        print("%s：hunk 总 %d = MINE %d + REVIEW %d + INFLIGHT %d"
              % (path, len(hs), len(buckets["MINE"]), len(buckets["REVIEW"]),
                 len(buckets["INFLIGHT"])))
        print("-- MINE os:", [h["os"] for h, _ in buckets["MINE"]])
        print("-- REVIEW os:", [h["os"] for h, _ in buckets["REVIEW"]])
        for h, why in buckets["REVIEW"]:
            print("   " + "─" * 66)
            print("   os=%d oc=%d  %s" % (h["os"], h["oc"], why))
            for x in h["minus"][:6]:
                print("     - %s" % x[:110])
            for x in h["plus"][:8]:
                print("     + %s" % x[:110])
        # 供 spec 使用
        print("-- 建议 own_hunks = %s" % sorted(h["os"] for h, _ in buckets["MINE"]))
        print("-- 在途 os = %s" % sorted(h["os"] for h, _ in buckets["INFLIGHT"]))


main()
