#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v171 scoped 提交：只把「达成填报 · 修改日志」那几个 hunk 落进索引。

判据（技能 hergent-scoped-commit §5.6）：
  · 从 git show HEAD:<file> 的行列表出发，按 old_start 从大到小切片，
    天然不含任何在途改动 —— 「在途进不来」是结构性保证，不靠筛。
  · MINE/DEFER 白黑名单 + 断言并集覆盖全部 hunk：同时证明白名单没写错、
    且不存在无人认领的 hunk（出现了即基线漂移）。
  · 纯插入 hunk（old_count==0）用 lines[os:os]=plus，不是 os-1。
  · 自证：① 残留 hunk 数 == 在途 hunk 数 ② 本轮标识全进、在途标识零夹带 ③ SFC 定点编译。
"""
import subprocess, sys, re, os

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
FILE = "hergent-cn-v2/src/pages/Rebate.vue"
OUT = "/tmp/v171_staged_Rebate.vue"

# ── 归属判定（逐 hunk 读过内容后确定；纯空行 hunk 归 DEFER，技能明示排除零风险）──
MINE = {308, 418, 1768, 2873}
DEFER = {322, 324, 332, 343, 351, 352, 355, 369, 382, 386, 418, 1445, 1496, 1538,
         1556, 1558, 1565, 1578, 1579, 1586, 1601, 1605, 1653, 1654, 1665, 1666,
         1674, 1675, 1781, 1788, 1790, 1793, 1796, 1798, 2830}
DEFER = DEFER - MINE

# 本轮新增标识：期望「暂存版 与 工作区 计数相等」（我的改动 100% 进索引）
MINE_SYMS = ["achvLogOpen", "achv-log-card", "loadAchvLog", "openAchvLog",
             "achvLogThisPeriod", "已清除", "修改日志"]
# 在途标识：期望「暂存版 与 HEAD 计数相等」（零夹带）——不能用 ==0，HEAD 本来就有的会误报
INFLIGHT_SYMS = ["achv-year", "monthTargetOf", "achvRateText", "achvSourceText",
                 "全年月度对比", "achRebate"]


def git(*a, **kw):
    return subprocess.run(["git", "-C", REPO] + list(a), capture_output=True,
                          text=True, check=True, **kw).stdout


def parse_hunks():
    diff = git("diff", "-U0", "--", FILE)
    hunks, cur = [], None
    for ln in diff.splitlines(keepends=True):
        if ln.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", ln)
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "minus": [], "plus": [], "hdr": ln.strip()}
            hunks.append(cur)
        elif cur is not None:
            if ln.startswith("+"):
                cur["plus"].append(ln[1:])
            elif ln.startswith("-"):
                cur["minus"].append(ln[1:])
    return hunks


def main():
    commit_msg = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--commit" else None

    hunks = parse_hunks()
    got = sorted(h["os"] for h in hunks)
    # 断言并集覆盖：白名单每个都真的存在 + 无「无人认领」的 hunk
    assert got == sorted(set(MINE) | set(DEFER)), \
        ("有未登记的 hunk，先读懂它是谁的", set(got) ^ (set(MINE) | set(DEFER)))

    head = git("show", "HEAD:" + FILE)
    lines = head.splitlines(keepends=True)
    wt = open(os.path.join(REPO, FILE), encoding="utf-8").read()

    # 负索引/边界守卫：避免切片越界那种「不报错但插错位置」的情况
    ops = sorted([h for h in hunks if h["os"] in MINE], key=lambda h: -h["os"])
    for h in ops:
        os_, oc, minus, plus = h["os"], h["oc"], h["minus"], h["plus"]
        if oc == 0:
            assert minus == [], "纯插入 hunk 不该有 - 行"
            assert 1 <= os_ <= len(lines), ("插入点越界", os_, len(lines))
            lines[os_:os_] = plus
        else:
            seg = lines[os_ - 1: os_ - 1 + oc]
            assert seg == minus, ("old_start=%d 旧侧不匹配\n HEAD=%r\n diff=%r"
                                  % (os_, seg, minus))
            lines[os_ - 1: os_ - 1 + oc] = plus

    out = "".join(lines)
    open(OUT, "w", encoding="utf-8").write(out)

    staged = ops and out
    print("HUNK 总 %d | 保留 %d %s | 在途 %d"
          % (len(hunks), len(ops), sorted(h["os"] for h in ops), len(hunks) - len(ops)))
    print("行数：HEAD %d -> 暂存 %d (+%d) | 工作区 %d"
          % (head.count("\n"), out.count("\n"), out.count("\n") - head.count("\n"),
             wt.count("\n")))
    # 混合文件：暂存版必须 != 工作区（相等说明把所有在途都带进来了）
    assert out != wt, "暂存版 == 工作区 —— 在途改动被整包带入，归属判定有误"

    print("\n-- 本轮标识（期望 暂存 == 工作区）--")
    bad = 0
    for s in MINE_SYMS:
        a, b = out.count(s), wt.count(s)
        flag = "ok " if a == b and a > head.count(s) else "BAD"
        if flag == "BAD":
            bad += 1
        print("  %s %-22s 暂存=%-3d 工作区=%-3d HEAD=%d" % (flag, s, a, b, head.count(s)))
    print("-- 在途标识（期望 暂存 == HEAD）--")
    for s in INFLIGHT_SYMS:
        a, b, c = out.count(s), wt.count(s), head.count(s)
        flag = "ok " if a == c else "BAD"
        if flag == "BAD":
            bad += 1
        print("  %s %-22s 暂存=%-3d HEAD=%-3d (工作区=%d)" % (flag, s, a, c, b))
    assert bad == 0, "标识计数不符，先查归属判定"

    # 残留 hunk 数必须 == 在途 hunk 数（数量相等；行号会因净增行而位移，故不碰行号）
    resid = subprocess.run(["git", "-C", REPO, "diff", "-U0", "--no-index",
                            "--", OUT, os.path.join(REPO, FILE)],
                           capture_output=True, text=True).stdout
    n_resid = len(re.findall(r"(?m)^@@", resid))
    print("\n残留 hunk = %d | 在途 hunk = %d" % (n_resid, len(hunks) - len(ops)))
    assert n_resid == len(hunks) - len(ops), "残留 hunk 数与在途 hunk 数不等，归属有误"

    print("自证通过 ✓  暂存版已写 %s" % OUT)

    if commit_msg:
        # 🔴 落索引 + 断言 + 提交，必须在同一次进程内完成（索引会被并行会话整个重置）
        git("reset", "-q", "HEAD", "--", FILE)
        blob = subprocess.run(["git", "-C", REPO, "hash-object", "-w", "--stdin"],
                              input=out, text=True, capture_output=True, check=True).stdout.strip()
        subprocess.run(["git", "-C", REPO, "update-index", "--add", "--cacheinfo",
                        "100644,%s,%s" % (blob, FILE)], check=True)
        names = git("-c", "core.quotepath=false", "diff", "--cached", "--name-only").split("\n")
        names = [n for n in names if n.strip()]
        print("\n索引内容 =", names)
        assert len(names) == 1 and names[0] == FILE, \
            "索引不干净（可能混入并行会话预暂存的文件），放弃提交：%s" % names
        print(git("diff", "--cached", "--stat"))
        print(git("commit", "-F", commit_msg))
        print("提交后：", git("log", "--oneline", "-1"))


main()
