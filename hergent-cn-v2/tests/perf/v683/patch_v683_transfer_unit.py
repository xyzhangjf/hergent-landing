# -*- coding: utf-8 -*-
"""v683 后端补丁 ③：调拨端点把 `unit` 透传到 db 层（原先被丢弃）。"""
import os
import shutil
import subprocess
import sys

PSI = "/opt/hergent-erp/routers/psi.py"
SUFFIX = ".bak-20261025-v683-transfer-unit"

OLD = '''        items.append({"product_id": pid, "product_name": name, "quantity": q,
                      "unit_price": float(it.get("unit_price") or 0)})'''
NEW = '''        # v683：`unit` **必须透传**。原先这里只挑四个字段，`unit` 被静默丢弃
        #   ⇒ 用户在调拨页选了「箱」，db 层永远拿不到，明细表里这一列恒为空，
        #   过账按数量(当作小单位)搬货。前端加了单位下拉却不改这里 = 白改。
        items.append({"product_id": pid, "product_name": name, "quantity": q,
                      "unit_price": float(it.get("unit_price") or 0),
                      "unit": str(it.get("unit") or "").strip()})'''

src = open(PSI, encoding="utf-8").read()
# 幂等判据必须是**这一处**的特征串（整个文件另有多处 `"unit": str(it.get("unit")...)` 写法，
# 拿它当标志会误判"已改过" —— 实测第一次就误跳过了）。
MARK = '"unit_price": float(it.get("unit_price") or 0),\n                      "unit": str(it.get("unit") or "").strip()})'
if MARK in src:
    print("  已存在，跳过")
elif src.count(OLD) != 1:
    print("!! 锚点命中 %d 次（要求 1）—— 放弃" % src.count(OLD))
    sys.exit(1)
else:
    if not os.path.exists(PSI + SUFFIX):
        shutil.copy2(PSI, PSI + SUFFIX)
        print("  备份 ->", PSI + SUFFIX)
    open(PSI, "w", encoding="utf-8").write(src.replace(OLD, NEW, 1))
    print("  已替换")

r = subprocess.run([sys.executable, "-m", "py_compile", PSI], capture_output=True, text=True)
print("  py_compile psi.py", "PASS" if r.returncode == 0 else "FAIL\n" + r.stderr[:600])
sys.exit(0 if r.returncode == 0 else 2)
