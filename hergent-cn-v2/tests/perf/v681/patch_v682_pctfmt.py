#!/usr/bin/env python3
"""v682: 修 extra_alloc_override 的 %-格式化崩（`100%（` 里的 `%（` 被当成格式符 ⇒ 500）。"""
import re, shutil, py_compile, sys

P = "/opt/hergent-erp/routers/product_targets.py"
OLD = 'raise HTTPException(422, "占比合计必须等于 100%（当前 %.2f%%）" % _tot)'
NEW = 'raise HTTPException(422, "占比合计必须等于 100%%（当前 %.2f%%）" % _tot)'

src = open(P, encoding="utf-8").read()
if NEW in src:
    print("SKIP already-patched")
    sys.exit(0)
n = src.count(OLD)
if n != 1:
    print("ABORT anchor-count=%d" % n)
    sys.exit(2)

bak = P + ".bak-20261025-v682-pctfmt"
shutil.copy2(P, bak)
open(P, "w", encoding="utf-8").write(src.replace(OLD, NEW, 1))

new = open(P, encoding="utf-8").read()
assert new.count(NEW) == 1 and OLD not in new
py_compile.compile(P, doraise=True)

# 判别力自证：旧写法确实会崩、新写法不会
try:
    "占比合计必须等于 100%（当前 %.2f%%）" % 90.0
    print("!! 旧写法没崩（自证失败）")
except ValueError as e:
    print("旧写法复现崩溃: ValueError: %s" % e)
print("新写法输出: %s" % ("占比合计必须等于 100%%（当前 %.2f%%）" % 90.0))
print("OK patched bak=%s py_compile=PASS" % bak)
