#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v292 双侧校验：把本地 `dist/` 的**每个文件**与线上 `/opt/hergent-cn-v2/` 同名文件做 md5 对比。

⚠️ 双侧 md5 一致**只证明传输没坏**，不证明产物是新的 —— 所以本脚本末尾额外给两件事：
   ① 线上入口 chunk 名是否 == 本地 `dist/index.html` 里引用的；
   ② 线上入口 bundle 里能不能 grep 到 v292 的特征串（`perms-rev` / `customRoles`）。

用法：python3 perms-v292-dual-md5.py
"""
import hashlib
import os
import re
import subprocess
import sys

REPO = "/Users/zhangjunfeng/Documents/laozhangai-product"
DIST = os.path.join(REPO, "hergent-cn-v2/dist")
HOST = "root@47.113.224.140"
PROD = "/opt/hergent-cn-v2"


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    files = []
    for root, _dirs, fns in os.walk(DIST):
        for fn in fns:
            p = os.path.join(root, fn)
            files.append(os.path.relpath(p, DIST))
    files.sort()

    lines = []
    for rel in files:
        lines.append("%s  %s" % (md5(os.path.join(DIST, rel)), rel))
    print("本地 md5 清单（%d 项）:" % len(lines))
    print("\n".join(lines))

    # 线上同名文件
    remote = subprocess.run(
        ["ssh", HOST, "cd %s && md5sum %s" % (PROD, " ".join(sorted(files)))],
        capture_output=True, text=True).stdout
    rmap = {}
    for line in remote.splitlines():
        parts = line.split()
        if len(parts) == 2:
            rmap[parts[1]] = parts[0]

    ok_n = bad = miss = 0
    for rel in files:
        key = rel
        l = md5(os.path.join(DIST, rel))
        r = rmap.get(key)
        if r is None:
            miss += 1
            print("  ❌ 线上缺文件: %s" % key)
        elif r == l:
            ok_n += 1
        else:
            bad += 1
            print("  ❌ md5 不一致: %s  本地=%s 线上=%s" % (key, l, r))
    print("")
    print("双侧 md5 结果：%d 项 OK / %d 项不一致 / %d 项缺失（共 %d 项）" % (ok_n, bad, miss, len(files)))

    # ① 入口一致
    lentry = re.search(r"index-[A-Za-z0-9_-]+\.js", open(os.path.join(DIST, "index.html"), encoding="utf-8").read())
    rentry = subprocess.run(["ssh", HOST, "grep -oE 'assets/index-[A-Za-z0-9_-]+\\.js' %s/index.html" % PROD],
                            capture_output=True, text=True).stdout.strip()
    print("① 本地入口 = %s ／ 线上入口 = %s  ⇒ %s"
          % (lentry.group(0) if lentry else "?", rentry, "一致" if lentry and rentry.endswith(lentry.group(0)) else "🔴 不一致"))

    # ② 特征串在线上
    for s in ("perms-rev", "customRoles"):
        n = subprocess.run(["ssh", HOST, "grep -c '%s' %s/%s" % (s, PROD, rentry)],
                           capture_output=True, text=True).stdout.strip()
        print("② 线上入口 bundle 含 `%s`：%s 处 ⇒ %s" % (s, n, "在" if n not in ("", "0") else "🔴 不在"))

    return 0 if (bad == 0 and miss == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
