#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v396 · 从截图里裁出一小块 → 放大 N 倍 → 存 PNG（供 OCR 或人眼）。

与 v396-crop-tabbar.py 的区别：这个支持**任意矩形**（x/y 四值），
用于「只看某个标签内部有哪些控件」这种小范围取证。
"""
import sys, os
from PIL import Image

if len(sys.argv) < 6:
    print('用法: python3 v396-zoom.py <图片> x0 y0 x1 y1 [倍数] [输出名]')
    sys.exit(1)

src = sys.argv[1]
x0, y0, x1, y1 = (float(v) for v in sys.argv[2:6])
SCALE = int(sys.argv[6]) if len(sys.argv) > 6 else 6
NAME = sys.argv[7] if len(sys.argv) > 7 else 'zoom'

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'outputs', 'v396-舟谱标签栏-2026-10-08')
os.makedirs(OUT, exist_ok=True)

im = Image.open(src).convert('RGB')
W, H = im.size
box = (int(W * x0), int(H * y0), int(W * x1), int(H * y1))
crop = im.crop(box)
big = crop.resize((crop.width * SCALE, crop.height * SCALE), Image.LANCZOS)
out = os.path.join(OUT, NAME + '.png')
big.save(out)
print('裁剪 %s → %dx%d → 放大 %dx → %dx%d' % (box, crop.width, crop.height, SCALE, big.width, big.height))
print('OUT=%s' % out)
