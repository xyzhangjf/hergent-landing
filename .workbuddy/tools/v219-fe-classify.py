#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v219 · Forecast.vue hunk 归属分类器。

为什么需要专门写一个：`hunk_find.py` 只回答「哪些 hunk 含某关键字」，而本文件有 **191 个 hunk**
（HEAD 9015 行 → 工作区 10883 行，+1868 行），其中同时混着 v196/v197/v199/v201/v202/v207/
v208/v209/v210/v211/v212/v213/v222 等**十几轮**别人（或历轮）的在途工作。
真正危险的是**混合 hunk** —— 首行挂着别人的版本号，尾部却有我的行（skill §10.10 的漏判形态）。

分类规则（判据只有两条，且都能独立失败）：
  · MINE_MARK：hunk 的 `+` 侧出现任一「只可能是本轮的标识符 / 中文串」⇒ 判为**含我**。
  · FOREIGN_TAG：hunk 的 `+` 侧出现任一「别的轮次的版本号」⇒ 判为**含别人**。
  ⇒ 含我 & 不含别人 = PURE_MINE（可整 hunk 认领）
     含我 & 含别人   = MIXED（🔴 必须人工逐行读，决定 trim 还是放弃）
     不含我          = FOREIGN（在途，排除）

⚠️ 分类结果**只作候选**，MIXED 一律人工过（这是本工具存在的理由，不是它的结论）。
用法：python3 v219-fe-classify.py
"""
import re
import subprocess
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
FILE = "hergent-cn-v2/src/pages/Forecast.vue"

# 本轮（v219）独有的标识符 / 类名 / 中文串。全部**只在本轮新增行里出现**。
MINE_MARK = [
    # 定稿管控
    "periodClosed", "reopenPeriod", "onHistoryReopen", "forecast_period_reopen",
    "已定稿（关闭）", "不可改单；如需改动请到「往期预报」里先点「重开」",
    # 打磨① 跳最后一处有数据 / Ctrl+End
    "lastDataPos", "已用区域",
    # 打磨② 撤销栈可见
    "undoPanelOpen", "undoShown", "undoUpto", "undoLabel", "pushBatchSnap",
    "改动记录", "撤销栈可见",
    # 打磨③ Ctrl+Shift 扩展选区
    "数据边界",
    # 打磨④ 错误跳转后闪烁
    "flashCell", "isFlash", "flashAt", "cell-flash", "flash",
    # 打磨⑤ 预检一键修复
    "fixCandidate", "cellNumericMeta", "fixables", "manualErrs",
    "openFixPreview", "applyFixes", "fixPreviewOpen", "err-fixbar", "err-fixhint",
    "一键修复", "预检",
    # 打磨⑥ 列上限可配
    "canEditRules", "openRuleEdit", "saveRuleEdit", "ruleEditOpen", "ruleQtyMax",
    "ruleSaving", "err-rulebtn", "rule-dlg", "rule-input",
    "setValidationRules", "数量上限", "数量录入上限",
]

# 别人的轮次标记（出现在 `+` 侧即说明该 hunk 含别人的工作）
FOREIGN_TAG = [
    "v196", "v197", "v199", "v201", "v202", "v207", "v208", "v209", "v210",
    "v211", "v212", "v213", "v222", "v184e", "v178", "v197b", "v199b",
]

RE_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def main():
    diff = subprocess.run(["git", "-C", REPO, "diff", "-U0", "--", FILE],
                          capture_output=True, text=True).stdout
    hunks, cur = [], None
    for ln in diff.splitlines():
        m = RE_HUNK.match(ln)
        if m:
            cur = {"os": int(m.group(1)), "oc": int(m.group(2) or 1),
                   "nc": int(m.group(4) or 1), "plus": [], "minus": []}
            hunks.append(cur)
        elif cur is not None:
            if ln.startswith("+"):
                cur["plus"].append(ln[1:])
            elif ln.startswith("-"):
                cur["minus"].append(ln[1:])

    pure, mixed, foreign = [], [], []
    for h in hunks:
        plus = "\n".join(h["plus"])
        minus = "\n".join(h["minus"])
        mk = [k for k in MINE_MARK if k in plus]
        if not mk:
            foreign.append(h)
            continue
        ft = [t for t in FOREIGN_TAG if t in plus or t in minus]
        (mixed if ft else pure).append((h, mk, ft))

    print("总 hunk %d | PURE_MINE %d | MIXED %d | FOREIGN %d"
          % (len(hunks), len(pure), len(mixed), len(foreign)))
    print()
    print("══ PURE_MINE（可直接整 hunk 认领）══")
    for h, mk, _ in pure:
        print("  os=%-6d oc=%-4d nc=%-4d  %s" % (h["os"], h["oc"], h["nc"], ", ".join(mk[:4])))
    print()
    print("══ MIXED（🔴 必须人工逐行读）══")
    for h, mk, ft in mixed:
        print("  os=%-6d oc=%-4d nc=%-4d  我的=%s | 别人的=%s"
              % (h["os"], h["oc"], h["nc"], ",".join(mk[:3]), ",".join(ft[:3])))
        print("      首行: %s" % (h["plus"][0][:110] if h["plus"] else ""))
    print()
    print("纯我的 os = %s" % sorted(h["os"] for h, _, _ in pure))
    print("混合 os   = %s" % sorted(h["os"] for h, _, _ in mixed))
    # 疑似漏判自检：FOREIGN 里含「本轮独有中文串」的（MINE_MARK 写漏了会在这里冒出来）
    print()
    print("── 防漏自检：FOREIGN 里含 v219 字样的（应为空）──")
    leak = [h["os"] for h in foreign if "v219" in "\n".join(h["plus"])]
    print("  %s" % (leak if leak else "（无）"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
