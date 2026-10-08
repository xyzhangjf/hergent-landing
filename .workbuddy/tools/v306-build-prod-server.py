#!/usr/bin/env python3
"""v301 上线前：把「我的改动」精确打到**生产当前版本**上，产出待上传文件。

🔴 铁律：生产 ≠ 本地工作区（本仓长期多会话并行）。**绝不直接上传本地文件** ——
   那会把别人未上线的在途改动一起带上去（本仓踩过：险把 v265 的 28KB 回退）。
做法：新块文本**从本地源码取**（不在这里重抄一遍，避免两处措辞漂移），
     只替换生产文件里的那一段；替换次数断言必须为 1。
"""
import os
import subprocess
import sys

LOCAL = "/Users/zhangjunfeng/Documents/hergent-erp/server/server.py"
PROD = "/tmp/v301-drift/prod-server.py"
OUT = "/tmp/v301-drift/new-server.py"

local = open(LOCAL, encoding="utf-8").read()
prod = open(PROD, encoding="utf-8").read()

OLD = ('    if path.startswith("/api/ai/sessions") or path.startswith("/api/ai/search-chat"):\n'
       "        return await call_next(request)\n")
NEW_START = "    # v301（2026-09-28）: `/api/ai/media` 一并豁免"
TAIL = "        return await call_next(request)\n"

n_old = prod.count(OLD)
print("① 生产文件里旧锚点出现次数 = %d（必须为 1）" % n_old)
assert n_old == 1, "❌ 锚点不唯一，拒绝盲改"

i = local.index(NEW_START)
j = local.index(TAIL, i) + len(TAIL)
NEW = local[i:j]
assert local.count(NEW) == 1, "❌ 本地新块不唯一"
print("② 从本地源码取到新块：%d 行 / %d 字节" % (NEW.count("\n"), len(NEW.encode())))

out = prod.replace(OLD, NEW)
open(OUT, "w", encoding="utf-8").write(out)
print("③ 已产出 %s（%d 字节；生产原件 %d 字节）" % (OUT, len(out.encode()), len(prod.encode())))

r = subprocess.run(["git", "diff", "--no-index", "--numstat", PROD, OUT],
                   capture_output=True, text=True)
print("④ 与生产原件的差异：%s" % (r.stdout.strip() or "(无)"))
r2 = subprocess.run(["git", "diff", "--no-index", "-U0", PROD, OUT],
                    capture_output=True, text=True)
print("--- 差异内容 ---")
print("\n".join(l for l in r2.stdout.split("\n") if l.startswith(("+", "-", "@@")))[:1200])

rc = subprocess.run([sys.executable, "-m", "py_compile", OUT], capture_output=True, text=True)
print("⑤ 语法校验：%s" % ("OK" if rc.returncode == 0 else "FAIL " + rc.stderr[:300]))
sys.exit(0 if rc.returncode == 0 else 1)
