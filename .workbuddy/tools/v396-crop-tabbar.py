#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v396 · 裁出舟谱标签栏区域并放大，便于 OCR 与人工核对。

背景：整图 OCR 把标签栏读成「C 商品档案 X」这类串 —— 前后的 `C`/`X` 到底是什么
（左侧页面图标？关闭 ×？刷新 ⟳？）在缩略尺度上分不清。这里把标签栏那条**裁出来放大 5×**，
再交给 ocrcli 读一遍，并另外导出一张 PNG 供人眼确认。

用法：python3 v396-crop-tabbar.py <图片> [y0] [y1]
"""
import sys, os
from PIL import Image

src = sys.argv[1]
y0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0.055
y1 = float(sys.argv[3]) if len(sys.argv) > 3 else 0.100

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'outputs', 'v396-舟谱标签栏-2026-10-08')
os.makedirs(OUT_DIR, exist_ok=True)

im = Image.open(src).convert('RGB')
W, H = im.size
print('原图 %d x %d' % (W, H))

top = int(H * y0)
bot = int(H * y1)
crop = im.crop((0, top, W, bot))
# 去掉左右纯白边（网页两侧留白），便于看清内容
import numpy as np
a = np.asarray(crop.convert('L'))
cols = np.where((a < 245).sum(axis=0) > 0)[0]
if len(cols):
    l, r = max(0, cols[0] - 8), min(W, cols[-1] + 8)
    print('  有效内容 x ∈ [%d, %d]（原图坐标）' % (l, r))
    crop = im.crop((l, top, r, bot))
else:
    print('  整条都是白的？y 区间选错了')

SCALE = 5
big = crop.resize((crop.width * SCALE, crop.height * SCALE), Image.LANCZOS)
out = os.path.join(OUT_DIR, '标签栏-放大5x.png')
big.save(out)
print('  裁剪 %d x %d → 放大 %d x %d' % (crop.width, crop.height, big.width, big.height))
print('  已存 %s' % out)
print('CROPPED_PATH=%s' % out)
