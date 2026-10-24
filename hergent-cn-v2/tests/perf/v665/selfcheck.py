#!/usr/bin/env python3
"""v665 判别力自证：把「库内水位」注回旧行为（每次从起始值重编），看自检是否抓红。

v664 的教训：**基线转绿前先自证判别力**。一个永远 PASS 的测试比没有测试更危险 ——
它会让人以为「这条已经防住了」。做法：只在内存里改、跑完写回，最后核对 md5 一致。

判据：注回旧行为后必须 exit != 0，且至少 FAIL 掉「号段唯一」那几条；恢复后 md5 不变。
"""
import hashlib
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, "../../../../.tmp-backend/forecast.py"))
SELFTEST = os.path.join(HERE, "docs-seq-selftest.py")

OLD = ('    if row and int(row["last_seq"] or 0) > 0:\n'
       '        base = int(row["last_seq"]) + 1\n'
       '    else:\n')
BAD = ('    if False:   # 注回 v664 行为：每次生成都从起始值重编\n'
       '        base = 0\n'
       '    else:\n')


def main():
    if not os.path.exists(SRC):
        print("SKIP: 找不到 %s" % SRC)
        return 0
    orig = open(SRC, encoding="utf-8").read()
    md5_before = hashlib.md5(orig.encode("utf-8")).hexdigest()
    assert orig.count(OLD) == 1, "锚点不唯一（%d 处）—— 源码已变，更新自证锚点" % orig.count(OLD)

    open(SRC, "w", encoding="utf-8").write(orig.replace(OLD, BAD))
    try:
        r = subprocess.run([sys.executable, SELFTEST], capture_output=True, text=True)
        print("注回旧行为后 exit = %s" % r.returncode)
        for ln in r.stdout.splitlines():
            if "FAIL" in ln or ln.startswith("PASS") or ln.startswith("FAILED"):
                print("   " + ln.strip())
    finally:
        open(SRC, "w", encoding="utf-8").write(orig)
    md5_after = hashlib.md5(open(SRC, encoding="utf-8").read().encode("utf-8")).hexdigest()
    print()
    print("恢复 md5 一致: %s (%s)" % (md5_before == md5_after, md5_before[:12]))
    caught = r.returncode != 0
    print("判别力自证: %s" % ("PASS —— 旧行为会被抓红" if caught else "FAIL —— 测试抓不到重号！"))
    return 0 if (caught and md5_before == md5_after) else 1


if __name__ == "__main__":
    sys.exit(main())
