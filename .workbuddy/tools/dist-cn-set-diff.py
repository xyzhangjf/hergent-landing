#!/usr/bin/env python3
"""产物「中文字符串集合差」—— 证明「我这轮构建没有夹带别人的在途改动」。

为什么需要它（`dist_normalized_diffcheck.py` 不够用的地方）：
  归一化差集能抹平 chunk 名 / scopeId / scoped keyframes 三类派生噪声，
  但**抹不平 esbuild 的短名重分配**（源码任何变化 ⇒ 字符频次变 ⇒ `So`/`Uo`、`Mn`/`On` 互换）。
  于是一个"只改了自家页面"的构建，在差集报告里仍会显示成
  「真变化 N 项，首个差异 @12: import{_ as So,… → _ as Uo,…」——
  **看得见差异、看不见它是不是你的**。
  对单行 minified JS 用 difflib 又会因为"插一个字符整体错位"吐出一堆不可读的假差异。

这里换一个**与压缩噪声正交**的判据：**Hergent 的中文 UI 文案**。
  - 别人的改动必然带来新中文串（这正是他们的功能可见面）；
  - 压缩器**不会**改写字符串字面量 ⇒ 中文串集合是构建噪音下的不变量。
  ⇒ 「仅新增 / 仅删除」两个集合为空或只含本轮文案，就等于零夹带。

判据：只看「仅新增 / 仅删除」。**不要**去比共有集合（噪音大、无信息量）。
若两个集合里出现任何与本轮无关的业务词 ⇒ 就是夹带，停手查 ``git status``。

用法: python3 dist-cn-set-diff.py <改前目录> <改后目录> [期望新增词 …]
  例: python3 .workbuddy/tools/dist-cn-set-diff.py /tmp/prod_now_v205 hergent-cn-v2/dist 行未计入
  给了期望词时，会对「仅新增」逐词判定并给出退出码（0 = 全部可归因）。
"""
import pathlib
import re
import sys

CN = re.compile(r'[\u4e00-\u9fa5]{2,}')      # 连续 ≥2 个汉字的串
EXTS = ('*.js', '*.css')


def cnset(root):
    s = set()
    counts = 0
    for ext in EXTS:
        for p in pathlib.Path(root).rglob(ext):
            try:
                txt = p.read_text(encoding='utf-8', errors='replace')
            except OSError:
                continue
            counts += 1
            s.update(CN.findall(txt))
    return s, counts


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    before_dir, after_dir = sys.argv[1], sys.argv[2]
    expect = sys.argv[3:]

    a, na = cnset(before_dir)      # 改前（线上）
    b, nb = cnset(after_dir)       # 改后（本地 dist）
    added, removed = sorted(b - a), sorted(a - b)

    print(f'改前 {before_dir}：{na} 个文件 / {len(a)} 个中文串')
    print(f'改后 {after_dir}：{nb} 个文件 / {len(b)} 个中文串')
    print()
    print('仅新增（改后独有）:', added if added else '（无）')
    print('仅删除（改前独有）:', removed if removed else '（无）')

    if not expect:
        return 0

    unexplained = [w for w in added if w not in expect]
    missing = [w for w in expect if w not in added]
    print()
    print('期望新增词核对：')
    for w in expect:
        print(f'  {"✅" if w in added else "❌"} {w}')
    for w in unexplained:
        print(f'  ⚠️ 未归因的新增串：{w}')
    for w in missing:
        print(f'  ⚠️ 期望出现却没出现：{w}')
    # 🔴 删除侧必须**单独判定并如实打印** —— 早先这里无条件写「仅删除为空」，
    #    在 removed 非空时照样打印，等于给了一句假结论（差集工具自己也踩「打印≠判据」这个坑）。
    if removed:
        print(f'  ⚠️ 仅删除 {len(removed)} 项 —— 必须逐条确认是**本轮有意删掉的旧文案**，'
              f'而不是别人的功能被误删：{removed}')
    else:
        print('  ✅ 仅删除为空')
    if unexplained or missing:
        print('\n❌ 存在未归因差异 —— 先查清来源再决定是否部署')
        return 1
    print('\n✅ 新增串全部可归因于本轮改动；删除侧见上方清单（须人工确认）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
