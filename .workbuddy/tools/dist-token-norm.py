#!/usr/bin/env python3
"""零夹带判据②：**全 token 归一化**比对 —— 不猜 hash 形态、不要求等长。

## 为什么需要它（v378 实测，2026-10-05）

已有三件工具，各有一个盲区：

| 工具 | 判据 | 盲区 |
|---|---|---|
| `dist-pair-check.py` | 去 hash 基名配对 + **字节数** | 只能告诉你「哪几个基名变了」，不能说「变的是不是只有 hash」 |
| `dist-invariant-diff.py` | 正则归一 `data-v-<8>` 等 | 🔴 **靠猜 hash 形态** ⇒ 漏 `cellFlash-<scopeId>` 一类**自定义**名 ⇒ **误报「需人工归因」** |
| `dist-token-align.py` | JS 词法切分 + 一对一性 | 🔴 只吃 JS；`SCOPE`/`ASSET` 两个正则同样是**猜形态**；不覆盖 CSS 的自定义 keyframe 名 |
| `hash-only-diff.py` | 差异区间**全是 hex** | ✅ 形态无关，但 **要求两份等长** ⇒ 长度变了（真改动）就用不了 |

v378 现场：`Forecast.css` **Δ+197 B**、`Forecast.js` **Δ+207 B**（不等长 ⇒ `hash-only-diff.py` 不适用），
而 `dist-invariant-diff.py` 报 ❌「存在需要人工归因的差异」—— 差异是 `cellFlash-29804117 → cellFlash-bc491277`，
`data-v-[0-9a-z]{8}` 这条正则**看不见**它。**假警报。**

## 本脚本的判据（形态无关 + 允许不等长）

把两份文本里**一切 `[A-Za-z0-9_-]{8,}` 的 token 折叠成 `#`**，再逐字节比对：

- 归一后**相同** ⇒ 该文件的差异**全部**落在长 token 上 ⇒ 只能是构建期派生名
  （`data-v-*`、自定义 `@keyframes` 名的 `<名>-<scopeId>`、`<基名>-<hash>.<ext>`、esbuild 短名……）
  ⇒ **零语义改动**。
- 归一后**仍不同** ⇒ 存在非 token 差异 ⇒ **真实内容改动，必须逐个归因**。

⚠️ 代价：把 8+ 位**真实标识符 / 字面量**也一起折掉了 ⇒ 若有人把常量改名或改了 8 位以上的中文串以外内容，
可能被掩盖。**所以本判据不单独使用**，必须与「归一后仍不同的文件清单 == 你本轮改的源文件所对应的 chunk」
这条**数量级/归属**判据配合（见下 `--expect`）。

## 用法

    python3 .workbuddy/tools/dist-token-norm.py \\
        --base <基准dist目录> --new <对比dist目录> \\
        [--assets]                    # 传的是站点根时自动加 assets/
        [--expect Forecast.js,Forecast.css]   # 预期真改的逻辑名（不给则只报告）

退出码：0 = 零夹带（无 chunk 增删 且 真改集 == --expect）；1 = 需人工归因。
"""
import argparse
import os
import re
import sys

# 「按构造必然变」的长 token：8 位以上的字母数字下划线连字符
# 🔴 故意不限定形态（不加 data-v- 前缀、不限定 hex）—— 这就是本脚本区别于其它三件的地方
TOK = re.compile(r'[A-Za-z0-9_-]{8,}')
# 去 hash 的逻辑名：<基名>-<8位>.<ext> → <基名>.<ext>
TAIL = re.compile(r'-[A-Za-z0-9_-]{8}$')


def logical(name):
    stem, ext = os.path.splitext(name)
    return (TAIL.sub('', stem) if TAIL.search(stem) else stem) + ext


def index(d):
    out = {}
    if not os.path.isdir(d):
        print('🔴 目录不存在：%s' % d)
        sys.exit(2)
    for fn in os.listdir(d):
        if os.path.splitext(fn)[1] in ('.js', '.css'):
            out[logical(fn)] = os.path.join(d, fn)
    return out


def read(p):
    with open(p, encoding='utf-8', errors='replace') as f:
        return f.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True, help='基准 dist 目录（= 已上线那版）')
    ap.add_argument('--new', required=True, help='对比 dist 目录（= 本次构建）')
    ap.add_argument('--assets', action='store_true', help='入参是站点根 ⇒ 自动进 assets/')
    ap.add_argument('--expect', default='', help='预期真改的逻辑名（逗号分隔）')
    args = ap.parse_args()

    A = os.path.join(args.base, 'assets') if args.assets else args.base
    B = os.path.join(args.new, 'assets') if args.assets else args.new

    mapA, mapB = index(A), index(B)
    onlyA = sorted(set(mapA) - set(mapB))
    onlyB = sorted(set(mapB) - set(mapA))

    print('判据：把一切 [A-Za-z0-9_-]{8,} 折叠成 # 后逐字节比对（形态无关、允许不等长）')
    print('基准目录：%s' % A)
    print('对比目录：%s' % B)
    print('逻辑名配对：基准 %d / 对比 %d' % (len(mapA), len(mapB)))

    # 🔴 护栏：配对为 0 时本判据**没有判别力**，绝不能报「无 ✅」蒙混过关
    #（同族教训：恒真/恒零判据比没有判据更危险。现场真踩过 —— 忘了 --assets，两边都是 0 项。）
    if not mapA or not mapB:
        print('🔴 **本判据无判别力**：一侧逻辑名数为 0 —— 路径给错了？'
              '（站点根请加 --assets；目录里应含 *.js / *.css）')
        print('结论: ⛔ 中止，不得据此下结论')
        return 2
    print('  仅基准有（将被下架）:', onlyA if onlyA else '无 ✅')
    print('  仅对比有（新增 chunk）:', onlyB if onlyB else '无 ✅')
    print()

    same, diff = [], []
    for k in sorted(set(mapA) & set(mapB)):
        a, b = mapA[k], mapB[k]
        ra, rb = read(a), read(b)
        ta, tb = TOK.sub('#', ra), TOK.sub('#', rb)
        renamed = os.path.basename(a) != os.path.basename(b)
        if ta == tb:
            same.append((k, renamed, len(ta)))
        else:
            i = next((j for j in range(min(len(ta), len(tb))) if ta[j] != tb[j]),
                     min(len(ta), len(tb)))
            diff.append((k, renamed, len(ta), len(tb),
                         ta[max(0, i - 40):i + 60], tb[max(0, i - 40):i + 60]))

    print('=== 归一后逐字节相同：%d 项（差异全部落在长 token 上 ⇒ 仅 hash 级联）===' % len(same))
    print('  其中「改过名」的：%d 项 —— 正是 hash 级联的证据' % len([1 for _, r, _ in same if r]))
    print()
    print('=== 归一后仍不同：%d 项（真实内容改动，必须逐个归因）===' % len(diff))
    for k, r, la, lb, ca, cb in diff:
        print('  ❌ %-18s 归一后 %d → %d (Δ%+d)%s' % (k, la, lb, lb - la, '  [改名]' if r else ''))
        print('      基准: …%s…' % ca.replace('\n', ' '))
        print('      对比: …%s…' % cb.replace('\n', ' '))
    print()

    got = {k for k, *_ in diff}
    ok = (not onlyA) and (not onlyB)
    if args.expect:
        want = {x.strip() for x in args.expect.split(',') if x.strip()}
        print('预期真改 chunk =', sorted(want))
        print('实际真改 chunk =', sorted(got))
        ok = ok and (got == want)
        print('结论:', '✅ 完全吻合，零夹带' if ok else '⚠️ 不符，需人工归因')
    else:
        print('（未给 --expect，只报告不判定）')
        print('结论:', '✅ 无 chunk 增删（真改集见上）' if ok else '⚠️ 有 chunk 增删，需人工确认')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
