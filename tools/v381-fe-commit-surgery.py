#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v381 前端受控提交 —— blob 手术（EmployeeArchive.vue）

背景：工作区 EmployeeArchive.vue 里除了我本轮 v381 的改动（撤「个人仓」列 +
撤「报单身份」分区 + 删 warehouseApi/warehouses 整块），还混着**另一个会话**的
深色模式适配 2 行（硬编码灰 → CSS 变量）。整文件提交会冒认别人的改动。

做法：把工作区内容回退那 2 行为 HEAD 版 → 得到「HEAD + 仅我的改动」的干净版本，
      交给 git hash-object -w 生成 blob，再用临时索引 --cacheinfo 写入提交。
      **不动工作区文件本身**（工作区保持含别人改动的原样）。

本脚本只做「生成干净版本 + 自证」，不碰 git。
自证三面（缺一不可）：
  (1) 干净版 vs HEAD  = 我的改动（应恰好 9 处 hunk，且**不含** --st-draft-bg）
  (2) 干净版 vs 工作区 = **恰好 2 行**，且都含 --st-draft-bg
  (3) 干净版里 --st-draft-bg 计数 = 0，工作区里 = 2
"""
import pathlib
import subprocess
import sys
import difflib

REPO = pathlib.Path("/Users/zhangjunfeng/Documents/laozhangai-product")
REL = "hergent-cn-v2/src/pages/EmployeeArchive.vue"
SRC = REPO / REL
OUT = pathlib.Path("/tmp/v381-EA.mine.vue")

# 别人的改动（工作区）→ HEAD 原状。左=工作区，右=HEAD。
SURGERY = [
    (
        ".df-role.stopped{background:var(--st-draft-bg) !important;color:var(--st-draft-txt) !important}",
        ".df-role.stopped{background:#e5e7eb !important;color:#9aa0a6 !important}",
    ),
    (
        ".stopped-tag{display:inline-block;margin-left:6px;font-size:11px;padding:1px 7px;border-radius:8px;background:var(--st-draft-bg);color:var(--st-draft-txt)}",
        ".stopped-tag{display:inline-block;margin-left:6px;font-size:11px;padding:1px 7px;border-radius:8px;background:#e5e7eb;color:#6b7280}",
    ),
]

FATAL = []


def die(msg):
    FATAL.append(msg)
    print("  ❌ " + msg)


print("=" * 78)
print("v381 前端 blob 手术 —— EmployeeArchive.vue")
print("=" * 78)

work = SRC.read_text(encoding="utf-8")
head = subprocess.run(
    ["git", "-C", str(REPO), "show", f"HEAD:{REL}"],
    capture_output=True, text=True,
).stdout
if not head:
    print("❌ 取不到 HEAD 版内容，中止")
    sys.exit(2)

print(f"\n[读数] 工作区 {len(work)} 字符 / HEAD {len(head)} 字符 / 差 {len(work)-len(head):+d}")

# --- 手术 ---
mine = work
for i, (new, old) in enumerate(SURGERY, 1):
    n = mine.count(new)
    print(f"\n[手术 {i}] 目标串出现 {n} 次（应为 1）")
    if n != 1:
        die(f"手术 {i} 目标串出现 {n} 次，非 1 —— 拒绝盲目替换")
        continue
    mine = mine.replace(new, old)
    print(f"         {new[:70]}…")
    print(f"      →  {old[:70]}…")

if FATAL:
    print("\n❌ 有致命问题，未写盘")
    sys.exit(3)

OUT.write_text(mine, encoding="utf-8")
print(f"\n[写盘] {OUT}  ({len(mine)} 字符)")

# ============ 自证 ============
print("\n" + "=" * 78)
print("自证（三面）")
print("=" * 78)


def unified(a, b, la, lb):
    return list(
        difflib.unified_diff(
            a.splitlines(), b.splitlines(), la, lb, lineterm="", n=1
        )
    )


# (1) 干净版 vs HEAD
d1 = unified(head, mine, "HEAD", "MINE")
hunks1 = [l for l in d1 if l.startswith("@@")]
plus1 = [l for l in d1 if l.startswith("+") and not l.startswith("+++")]
minus1 = [l for l in d1 if l.startswith("-") and not l.startswith("---")]
print(f"\n(1) 干净版 vs HEAD : {len(hunks1)} 个 hunk, +{len(plus1)} -{len(minus1)} 行")
for h in hunks1:
    print("      " + h)
leak = [l for l in plus1 if "--st-draft-bg" in l or "--st-draft-txt" in l]
if leak:
    for l in leak:
        die("干净版的**新增行**里仍含 --st-draft-bg（= 别人的改动没退干净）")
else:
    print("      ✅ 新增行里 --st-draft-bg/--st-draft-txt 计数 = 0")

# 反向判别力：HEAD 版本里也不该有 --st-draft-bg
print(f"      [判别力对照] HEAD 版里 --st-draft-bg 计数 = {head.count('--st-draft-bg')}（应为 0）")
if head.count("--st-draft-bg") != 0:
    die("HEAD 版本本身就含 --st-draft-bg —— 说明这两行早已提交，手术前提不成立")

# (2) 干净版 vs 工作区 —— 应恰好 2 行差异，且都含 --st-draft-bg
d2 = unified(mine, work, "MINE", "WORK")
plus2 = [l for l in d2 if l.startswith("+") and not l.startswith("+++")]
minus2 = [l for l in d2 if l.startswith("-") and not l.startswith("---")]
print(f"\n(2) 干净版 vs 工作区 : +{len(plus2)} -{len(minus2)} 行（应 +2 -2）")
for l in minus2:
    print("      " + l)
for l in plus2:
    print("      " + l)
if len(plus2) != 2 or len(minus2) != 2:
    die(f"干净版与工作区的差异不是恰好 2 行（+{len(plus2)} -{len(minus2)}）")
else:
    # 方向要认清：- 侧 = MINE（回退后，应**不含** --st-draft）；+ 侧 = WORK（应**含**）
    if any("--st-draft" in l for l in minus2):
        die("MINE 侧的删除行里含 --st-draft —— 方向反了或退不干净")
    elif not all("--st-draft" in l for l in plus2):
        die("WORK 侧的保留行里有不含 --st-draft 的 —— 说明手术动到了别人的东西以外")
    elif not all((".df-role.stopped" in l or ".stopped-tag" in l) for l in plus2):
        die("这 2 行不是 .df-role.stopped / .stopped-tag —— 手术动错了地方")
    else:
        print("      ✅ 差异恰好 2 行、方向正确（MINE 硬编码灰 / WORK 变量），"
              "且就是 .df-role.stopped 与 .stopped-tag 这两条")

# (3) 计数
print(f"\n(3) 计数对照 : MINE={mine.count('--st-draft-bg')}  WORK={work.count('--st-draft-bg')}  HEAD={head.count('--st-draft-bg')}")
if mine.count("--st-draft-bg") != 0 or work.count("--st-draft-bg") != 2:
    die("计数不符合预期（MINE 应 0 / WORK 应 2）")
else:
    print("      ✅ 一致")

print("\n" + "=" * 78)
if FATAL:
    print(f"❌ {len(FATAL)} 项失败，**不要**用这个 blob 提交")
    sys.exit(4)
print("✅ 三面自证通过 —— /tmp/v381-EA.mine.vue 是「HEAD + 仅 v381 改动」的干净版本")
print("=" * 78)
