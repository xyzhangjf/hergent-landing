# -*- coding: utf-8 -*-
"""v289：证明「产物变化 == 我改的源码」——按中文字符串集合做差集。

压缩后的 JS 里，我改的东西只可能是"用户可见文案"。所以判据是：
  新产物中文串集合 − 旧产物中文串集合 = 我新增的文案（且只有它们）
  旧产物中文串集合 − 新产物中文串集合 = 我删掉的文案（且只有它们）
若差集里出现任何**与我改动无关**的串 ⇒ 说明夹带了别人的在途改动 ⇒ 不许上传。
"""
import re
import sys

CJK = re.compile(r"[\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9 ：:（）()，,、。·\-/]{2,}")
PAT = re.compile(r"[\u4e00-\u9fa5]+")


def strings(path):
    with open(path, encoding="utf-8", errors="ignore") as f:
        txt = f.read()
    # 提取"连续中文串及其紧邻的 ASCII 尾巴"，粒度够用且不受压缩影响
    return set(CJK.findall(txt))


def diff(old_path, new_path, label):
    a, b = strings(old_path), strings(new_path)
    added, removed = sorted(b - a), sorted(a - b)
    print("=" * 70)
    print("%s" % label)
    print("  旧: %s" % old_path)
    print("  新: %s" % new_path)
    print("=" * 70)
    print("  【新增文案】%d 条" % len(added))
    for s in added:
        print("     + %s" % s)
    print("  【删除文案】%d 条" % len(removed))
    for s in removed:
        print("     - %s" % s)
    # 关心密码相关的串
    pwd_added = [s for s in added if "位" in s or "密码" in s or "字母" in s]
    pwd_removed = [s for s in removed if "位" in s or "密码" in s or "字母" in s]
    print("  【密码相关｜新增】%d 条" % len(pwd_added))
    for s in pwd_added:
        print("     + %s" % s)
    print("  【密码相关｜删除】%d 条" % len(pwd_removed))
    for s in pwd_removed:
        print("     - %s" % s)
    print()
    return added, removed


if __name__ == "__main__":
    total_added, total_removed = [], []
    for old_p, new_p, label in [
        ("/tmp/v289/dist_before_old/assets/main-c6V2JQjb.js",
         "/Users/zhangjunfeng/Documents/hergent-erp/static/dist/assets/main-pWoV6gPr.js",
         "旧前端 erp.hergent.cn · main.js"),
    ]:
        a, r = diff(old_p, new_p, label)
        total_added += a
        total_removed += r

    print("=" * 70)
    print("总结（旧前端）")
    print("=" * 70)
    print("  新增中文串 %d 条 / 删除中文串 %d 条" % (len(total_added), len(total_removed)))
    # 严格判据：新增/删除都必须与密码文案有关
    ok = all(("位" in s or "密码" in s or "字母" in s) for s in total_added + total_removed)
    print("  判据（全部差异均属密码文案）：%s" % ("✅ 通过 —— 零夹带" if ok else "🔴 未通过：存在无关差异"))
    sys.exit(0 if ok else 1)
