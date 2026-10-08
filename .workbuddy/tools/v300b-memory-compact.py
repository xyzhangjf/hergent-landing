#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""压缩 MEMORY.md 腾出安全余量（只减不加：保全部标识符/数字/触发词，删的是 topic 里已有全文的解释）。

安全设计：
  ① 按**行号**替换，并在替换前断言该行**以预期前缀开头**（若文件被别的会话改过 ⇒ 立刻报错，不盲改）；
  ② 每条改动都报**字节账**；
  ③ 结束时断言「新体 ≤ 旧体」且打印余量。
"""
import os
import sys

P = "/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/memory/MEMORY.md"
CAP = 14848   # 14.5 KB，超过则注入被截断

before_raw = open(P, "rb").read()
before = before_raw.decode("utf-8")
lines = before.split("\n")
old_total = len(before_raw)

# ---- 替换表：键 = 原始行号(1-based) 或 (起,止)；值 = (断言前缀, 新行列表) ----
REPL = {
    (3, 5): ("> **本页只回答", [
        "> **本页只回答「该读哪一份」**（判据全文在 `memory/topics/`；只留「路由 + 最热判据 + 触发词」）。",
        "> 🔴 **硬限额 %d B（超此值注入即被截断）** ⇒ 维护前先 `wc -c`；📏 **已到顶**：**任何新增都必须先把等量内容下沉进 topic**（只减不加）。" % CAP,
    ]),
    30: ("  · 🔴 **chunk 名什么都判不了**", [
        "  · 🔴 **chunk 名什么都判不了**（hash 级联；懒载名 ≠ 源文件名）⇒ 判据 = ①**按逻辑名前缀比字节** ②判别串 ③CSS 逐字节；构建前必存 `ls dist/assets > before.txt`",
    ]),
    32: ("  · 🔴 **沙箱挡住", [
        "  · 🔴 **沙箱挡住「服务内 sudo/exec 取数据」**：`ProtectHome=true` ⇒ **页面空、零报错**（mount ns **进程级继承**，`sudo` 不重置）；正解 `ProtectHome=read-only`＋`ReadWritePaths`（`BindPaths` 是错解）；🔴 **接口 200 ≠ 数据正常**（必读正文）→ `§v299`",
    ]),
    58: ("- **副驾 / AI**", [
        "- **副驾 / AI** → `topics/ai-copilot.md`（「AI智能建议」已正名「补货建议」；`ai_tools`=给 AI 用的只读 SQL；🔴 **数量类先 `GROUP BY`**：`ai_advice_log` 23 条**模型产出 0 条**；讲 AI 先核 `docs/AI能力对照表.md`）｜**通知 / 工资条** → `topics/notification-center.md`",
    ]),
    78: ("已用到 **v301**", [
        "已用到 **v301**。⚠️ `v292` **重号**（`-权限联动`/`-返利冲刺口径`）⇒ 引用必带后缀；**登记表 = `version-history.md` 尾「同日号表」**。🔴 起号**两步**：① 读号表 ② 实搜（`-e \"v20X\"` ＋ `memory/`/`tools/`/两仓）；⚠️ 实搜**必要不充分**（v296 撞别人、**v297–v300 撞本会话自己**）⇒ **号在落盘那刻才被占**。⚠️ 技能章节不得借版本号；零代码改动不占号。",
    ]),
    83: ("🔴 仓库内含生产凭据明文", [
        "🔴 仓内含**生产凭据明文**（Bearer / 提审账号 / 手机号均**已入库**）⇒ 远端必须 private；**入库新文件前先跑凭据扫描**。个人 PII 不落 `outputs/` ⇒ 环境变量＋打码＋`grep` 自证 0 命中；🔴 **自检件勿打印待查模式原文**（自检件=泄漏源，v297 踩）。",
    ]),
    88: ("🔴 **heredoc 经 `ssh` 传会吞引号**", [
        "🔴 **heredoc 经 `ssh` 传会吞引号** ⇒ 含引号脚本**本地写盘+`scp`**；服务器**无 `sqlite3` CLI**；无头 Chrome 须带 `--no-sandbox` 等四开关 → §10",
    ]),
}

# ---- 执行（先全部断言，再统一改写）----
plan = []   # (起行, 止行, 旧文本, 新行列表)
for key, (prefix, newlines) in REPL.items():
    a, b = key if isinstance(key, tuple) else (key, key)
    seg = lines[a - 1:b]
    joined = "\n".join(seg)
    assert joined.startswith(prefix), \
        "行 %d-%d 与预期不符（文件可能被别的会话改过）\n  期望前缀：%s\n  实际：%s" \
        % (a, b, prefix, joined[:60])
    plan.append((a, b, joined, newlines))

plan.sort()
out, cur = [], 1
for (a, b, old_seg, newlines) in plan:
    out.extend(lines[cur - 1:a - 1])
    out.extend(newlines)
    d = sum(len(x.encode()) + 1 for x in newlines) - (len(old_seg.encode()) + 1)
    print("行 %-3d..%-3d  %+5d B   %s" % (a, b, d, newlines[0][:58]))
    cur = b + 1
out.extend(lines[cur - 1:])

new = "\n".join(out)
new_raw = new.encode("utf-8")

assert len(new_raw) <= old_total, "净增了，违反只减不加"
open(P, "wb").write(new_raw)

print("")
print("改前 %d B → 改后 %d B  （净 %+d B）" % (old_total, len(new_raw), len(new_raw) - old_total))
print("红线 %d ⇒ 余量 %d B（原余量 %d B）" % (CAP, CAP - len(new_raw), CAP - old_total))
print("行数 %d → %d" % (len(lines), len(out)))
