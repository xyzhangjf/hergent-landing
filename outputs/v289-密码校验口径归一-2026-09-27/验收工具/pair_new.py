# -*- coding: utf-8 -*-
"""v289：新前端产物「按逻辑名前缀比字节」——hash 文件名不可信（会级联改名）。

判据（MEMORY 里 v282 的教训）：只改 2 个源文件，可能让一批 chunk **改名**；
所以唯一可靠判据是「同一逻辑名前缀（去掉 hash）的产物，字节数是否变化」。
"""
import os
import re
import sys

PRE = re.compile(r"^(.*)-([A-Za-z0-9_-]{8})\.(js|css)$")


def load(path):
    """{'<前缀>.<ext>': 字节数}"""
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            size, _, p = line.partition(" ")
            base = os.path.basename(p.strip())
            m = PRE.match(base)
            key = ("%s.%s" % (m.group(1), m.group(3))) if m else base
            out[key] = int(size)
    return out


before = load("/tmp/v289/dist_before_new.txt")
after = load("/tmp/v289/dist_after_new.txt")

keys = sorted(set(before) | set(after))
changed, same, new, gone = [], [], [], []
for k in keys:
    b, a = before.get(k), after.get(k)
    if b is None:
        new.append((k, a))
    elif a is None:
        gone.append((k, b))
    elif b != a:
        changed.append((k, b, a))
    else:
        same.append(k)

print("=" * 72)
print("新前端产物：按逻辑名前缀比字节（hash 名字不作数）")
print("=" * 72)
print("  共同产物 %d 项：其中 %d 项字节一致 / %d 项有变化" % (len(same) + len(changed), len(same), len(changed)))
print()
print("  【有变化】%d 项" % len(changed))
for k, b, a in changed:
    print("     %-26s %8d → %8d  (%+d)" % (k, b, a, a - b))
if new:
    print("  【新增】%d 项" % len(new))
    for k, a in new:
        print("     %-26s %8d" % (k, a))
if gone:
    print("  【消失】%d 项" % len(gone))
    for k, b in gone:
        print("     %-26s %8d" % (k, b))
print()
print("  ⬛ 判据：有变化的应当**只**是我改的那 2 个源文件对应的 chunk")
print("     （EmployeeArchive.vue → Archive.*  /  Login.vue → Login.*）")
ok = all(k.startswith("Archive") or k.startswith("Login") for k, _, _ in changed) and not (
    new or gone
)
print("     ⇒ %s" % ("✅ 通过：变化范围精确等于我改的源文件" if ok
                     else "🔴 未通过：存在无关 chunk 变化 ⇒ 可能夹带"))
sys.exit(0 if ok else 1)
