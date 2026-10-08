#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v396 · 把图片某个区域转成字符画 —— 模型读不了 PNG，但读得了字符。

用途：确认舟谱标签栏里每个标签的**控件构成**（左侧图标？刷新 ⟳？关闭 ×？）。
整图 OCR 只能给文本，图形控件要靠这个看轮廓。

用法：python3 v396-ascii-view.py <图片> x0 y0 x1 y1 [宽度]
"""
import sys, os
import numpy as np
from PIL import Image

src = sys.argv[1]
x0, y0, x1, y1 = (float(v) for v in sys.argv[2:6])
WIDTH = int(sys.argv[6]) if len(sys.argv) > 6 else 200

im = Image.open(src).convert('L')
W, H = im.size
box = (int(W * x0), int(H * y0), int(W * x1), int(H * y1))
crop = im.crop(box)
print('原图 %dx%d ｜ 裁剪 %s → %dx%d' % (W, H, box, crop.width, crop.height))

# 压到目标宽度；行数按比例（终端字符高≈宽的 2 倍，故 y 再乘 0.5 防拉伸）
tw = WIDTH
th = max(1, int(crop.height * tw / crop.width * 0.5))
small = crop.resize((tw, th), Image.LANCZOS)
a = np.asarray(small).astype(float)

# 反相 + 归一：白底 255 → 空格
lo, hi = a.min(), a.max()
if hi - lo < 1:
    print('（整块纯色，无内容）'); sys.exit(0)
norm = (a - lo) / (hi - lo)
RAMP = ' .:-=+*#%@'
print('灰度范围 %d–%d' % (lo, hi))
print('+' + '-' * tw + '+')
for row in norm:
    print('|' + ''.join(RAMP[min(len(RAMP) - 1, int((1 - v) * (len(RAMP) - 1)))] for v in row) + '|')
print('+' + '-' * tw + '+')
