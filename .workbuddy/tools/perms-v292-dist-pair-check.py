#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v292 产物差集核查：按「**逻辑名（剥 hash）+ 字节大小**」比 `dist/` ↔ 线上 `assets/`。

为什么不用 hash 名比：rollup 的 chunk hash 对**模块遍历顺序**敏感 ⇒ 改一两个源文件
可能让几十个 chunk **级联换名**（v282 实测 29/53），单看 hash 名无法归因到"我改了什么"。
按逻辑名 + 字节数比，差集才会**精确等于我改的源文件对应产物**。

为什么不用 `file count` 比：线上 `assets/` 是**历次构建的并集**（本轮实测 483 个物理文件 /
53 个逻辑名）⇒ 文件数早已不是判据，只有**逻辑名集合**是。

用法：python3 perms-v292-dist-pair-check.py
"""
import os
import re
import subprocess
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
DIST = os.path.join(REPO, "hergent-cn-v2/dist/assets")
HOST = "root@47.113.224.140"
PROD = "/opt/hergent-cn-v2"
HASH_RE = re.compile(r"^(.*)-([A-Za-z0-9_-]{8})\.(js|css)$")

# 本轮改动的源文件 → 期望变化的产物逻辑名（用于反查差集是否"恰好等于我改的"）
EXPECTED_SUBSTR = ("Settings", "Shell", "index")


def logical(fn):
    m = HASH_RE.match(fn)
    return (m.group(1) + "." + m.group(3)) if m else fn


def local_map():
    out = {}
    for fn in os.listdir(DIST):
        p = os.path.join(DIST, fn)
        if os.path.isfile(p):
            out[logical(fn)] = os.path.getsize(p)
    return out


def remote_map():
    raw = subprocess.run(
        ["ssh", HOST, "ls -l " + PROD + "/assets"],
        capture_output=True, text=True, check=True).stdout
    out = {}
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) < 9:
            continue
        size, fn = int(parts[4]), parts[-1]
        out.setdefault(logical(fn), set()).add(size)
    # 同一逻辑名在线上可能有多代（并集）⇒ 取「有一代与本地同尺寸」优先，否则取最大
    return out


def main():
    lm, rm = local_map(), remote_map()
    only_local = sorted(set(lm) - set(rm))
    only_remote = sorted(set(rm) - set(lm))
    same = sorted(k for k in lm if k in rm and lm[k] in rm[k])
    diff = sorted(k for k in lm if k in rm and lm[k] not in rm[k])

    print("本地逻辑名 %d / 线上逻辑名 %d" % (len(lm), len(rm)))
    print("")
    print("① 仅本地有的逻辑名（应为空 = 没新增 chunk）：%s" % (only_local or "（空）"))
    print("② 仅线上有的逻辑名（应为空 = 没删除 chunk）：%s" % (only_remote or "（空）"))
    print("③ 同名 **且** 同字节：%d / %d" % (len(same), len(lm)))
    print("④ 同名**但字节不同**（= 真正变化的产物）：")
    for k in diff:
        print("     %-28s 本地=%-8d 线上=%s" % (k, lm[k], sorted(rm[k])))
    if not diff:
        print("     （空）")
    print("")
    unexpected = [k for k in diff if not any(s in k for s in EXPECTED_SUBSTR)]
    print("⑤ ④中**无法用本轮 5 个源文件解释**的项（应为空 = 零夹带）：%s" % (unexpected or "（空）"))
    print("")
    ok = (not only_local) and (not only_remote) and (not unexpected)
    print("结论：%s" % ("零夹带（差集 = 本轮改动面）" if ok else "🔴 有未归因差异，禁止据此宣称零夹带"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
