#!/usr/bin/env python3
"""
visual-diff.py —— 视觉回归像素比对（只读，不改任何源文件）

配合 visual-baseline.mjs 使用。**阈值来自实测底噪，不是拍脑袋**：
    先跑 A/A（同一构建连抓两次）→ visual-diff.py --baseline a --candidate b
    得到的读数就是这台机器 + 这个网络的**噪声下限**；正常改动应当明显高于它。
    v724 实测底噪 = **24 张全部 0 像素**（连抓两次字节完全相同），所以阈值可以压得很紧。

🔴🔴 但必须分清两种噪声，否则会误判这个工具的能力：
    · **渲染噪声**（字体回退、滚动条宽度、动画中间态、焦点环）—— 这就是阈值管的东西，
      实测为 0，所以 px=800 / pct=0.05 已经很宽松。
    · **数据噪声**（表格多一行、金额变了）—— **阈值管不住，也没有上界**：
      一行表格是 1440×40 ≈ 57600 像素 = 4.4%，比任何阈值都大。
    ⇒ 真正的控制点是**抓图时间窗**：基线要在改完之后、部署之前抓，候选在部署后立刻抓，
      两趟间隔控制在几分钟内。白天有单进来时，列表页的差异不能归咎于样式。

灵敏度实测（在 inv-purchase 首屏上合成纯色块）：
    40×20 = 861px / 0.07% → 报「变化」（刚好压线）
    60×30 = 1891px / 0.15% → 报「变化」
    ⇒ 一个徽标/按钮换色这种量级就能抓到。

用法：
    python3 .workbuddy/tools/visual-diff.py \\
        --baseline .workbuddy/visual-run/a \\
        --candidate .workbuddy/visual-run/b

    # 灵敏度调节（默认 tol=3 抗抗锯齿，pct=0.10 / px=1500 双条件）
    ... --tol 3 --pct 0.10 --px 1500
    # 只看某几个主题
    ... --themes light
    # 输出 diff 图（红标变化处，未变区域压淡）
    ... --out .workbuddy/visual-run/diff

退出码：0=无显著变化；1=有页面超过阈值（可用于 pre-commit / CI 闸门）
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageChops


def load(path):
    return Image.open(path).convert('RGB')


def diff_masks(a, b, tol):
    """返回 (变化掩膜 L 图, 变化像素数, 变化区域 bbox)。逐通道容差抗抗锯齿/次像素。"""
    d = ImageChops.difference(a, b)
    bands = [band.point(lambda v: 255 if v > tol else 0) for band in d.split()]
    m = ImageChops.lighter(ImageChops.lighter(bands[0], bands[1]), bands[2])
    hist = m.histogram()
    n = hist[255] if len(hist) > 255 else 0
    return m, n, (m.getbbox() if n else None)


def make_diff_image(a, m, out_path):
    """未变区域压成淡底，变化处涂红 —— 一眼看出改在哪儿。"""
    faded = Image.blend(a, Image.new('RGB', a.size, (255, 255, 255)), 0.72)
    out = Image.composite(Image.new('RGB', a.size, (220, 30, 30)), faded, m)
    out.save(out_path, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True)
    ap.add_argument('--candidate', required=True)
    ap.add_argument('--out', default='')
    ap.add_argument('--tol', type=int, default=3, help='单通道色差容忍（0-255），默认 3')
    ap.add_argument('--pct', type=float, default=0.05, help='判「有变化」的最小面积占比%%，默认 0.05')
    ap.add_argument('--px', type=int, default=800, help='判「有变化」的最小像素数，默认 800')
    ap.add_argument('--themes', default='', help='逗号分隔，只比某几个主题')
    ap.add_argument('--json', default='', help='把结果另存为 JSON')
    args = ap.parse_args()

    only = [t.strip() for t in args.themes.split(',') if t.strip()]
    themes = sorted(
        d for d in os.listdir(args.baseline)
        if os.path.isdir(os.path.join(args.baseline, d)) and (not only or d in only)
    )
    if not themes:
        print('基线目录里没有主题子目录：' + args.baseline)
        return 2

    base_manifest, cand_manifest = {}, {}
    for root, sink in ((args.baseline, base_manifest), (args.candidate, cand_manifest)):
        p = os.path.join(root, 'manifest.json')
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                sink.update(json.load(f))

    if args.out:
        os.makedirs(args.out, exist_ok=True)

    rows, changed, missing = [], [], []
    for theme in themes:
        tdir_b = os.path.join(args.baseline, theme)
        tdir_c = os.path.join(args.candidate, theme)
        if not os.path.isdir(tdir_c):
            missing.append(f'{theme}（候选目录缺失）')
            continue
        for fn in sorted(os.listdir(tdir_b)):
            if not fn.endswith('.png'):
                continue
            pb, pc = os.path.join(tdir_b, fn), os.path.join(tdir_c, fn)
            if not os.path.exists(pc):
                missing.append(f'{theme}/{fn}')
                continue
            a, b = load(pb), load(pc)
            if a.size != b.size:
                rows.append((theme, fn[:-4], -1, 100.0, '尺寸不同 %s→%s' % (a.size, b.size)))
                changed.append((theme, fn[:-4]))
                continue
            m, n, bbox = diff_masks(a, b, args.tol)
            total = a.size[0] * a.size[1]
            pct = 100.0 * n / total
            hit = n >= args.px and pct >= args.pct
            rows.append((theme, fn[:-4], n, pct, bbox))
            if hit:
                changed.append((theme, fn[:-4]))
            if args.out and n:
                make_diff_image(a, m, os.path.join(args.out, f'{theme}__{fn[:-4]}.diff.png'))

    print('基线 %s  (构建 %s)' % (args.baseline, base_manifest.get('build') or '?'))
    print('候选 %s  (构建 %s)' % (args.candidate, cand_manifest.get('build') or '?'))
    if base_manifest.get('build') and cand_manifest.get('build') \
            and base_manifest['build'] != cand_manifest['build']:
        print('  构建号不同：%s → %s' % (base_manifest['build'], cand_manifest['build']))
    print('判据：单通道色差 > %d 且 变化面积 ≥ %.2f%% 且 ≥ %d 像素\n' % (args.tol, args.pct, args.px))

    head = '%-6s %-20s %10s %8s  %s' % ('主题', '页面', '变化像素', '占比', '变化区域')
    print(head)
    print('-' * len(head))
    for theme, slug, n, pct, bbox in rows:
        flag = '  ← 变化' if (theme, slug) in changed else ''
        b = '' if n == -1 else (str(bbox) if bbox else '-')
        print('%-6s %-20s %10s %7.2f%%  %s%s'
              % (theme, slug, n if n >= 0 else 'SIZE', pct, b, flag))

    print()
    if missing:
        print('⚠️ 缺图 %d 张：%s' % (len(missing), ', '.join(missing[:6])))
    if changed:
        print('🔴 有显著变化的页面 %d 张：' % len(changed))
        for t, s in changed:
            print('   %s / %s' % (t, s))
        if args.out:
            print('   diff 图：' + args.out)
        rc = 1
    else:
        print('✅ 全部页面在阈值内（%d 张）' % len(rows))
        rc = 0

    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump({
                'baseline': args.baseline, 'candidate': args.candidate,
                'tol': args.tol, 'pct_min': args.pct, 'px_min': args.px,
                'rows': [{'theme': t, 'slug': s, 'px': n, 'pct': round(p, 3),
                          'bbox': list(bb) if bb else None, 'changed': (t, s) in changed}
                         for t, s, n, p, bb in rows],
                'changed': [f'{t}/{s}' for t, s in changed],
                'missing': missing,
            }, f, ensure_ascii=False, indent=2)
    return rc


if __name__ == '__main__':
    sys.exit(main())
