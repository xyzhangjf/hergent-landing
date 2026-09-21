#!/usr/bin/env python3
"""png-button-center-verify.py — 校验「按钮文字居中」对照图**本身没有说谎**

图是可交付物，图说错话比没有图更糟。本脚本直接解 PNG 像素，逐条核对：

  ① 每个青色按钮带的**中线**是否正好落在按钮几何中心（容差 1.5 图像像素）——
     这条查的是「图有没有画错基准线」（实测踩过：`.btn` 自带 margin-top:8rpx，
     用 `top:50%` 画线会偏高 4.5 图像像素，看上去像「文字没居中」其实是线画错了）。
  ② 按钮内白字墨迹的垂直中心，相对按钮几何中心的偏移（rpx）是否与探针实测一致 ——
     这条查的是「图有没有夸大/缩小差异」。

用法：python3 png-button-center-verify.py <png> <deviceScaleFactor> <期望偏移rpx,...,->
"""
import sys, zlib, struct


def read_png(p):
    d = open(p, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', '不是 PNG'
    i, idat = 8, b''
    w = h = ct = None
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        body = d[i + 8:i + 8 + ln]
        i += 12 + ln
        if typ == b'IHDR':
            w, h, _bd, ct = struct.unpack('>IIBB', body[:10])
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * ch
    out, prev, pos = bytearray(), bytearray(stride), 0
    for _y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        if f == 1:
            for x in range(ch, stride):
                line[x] = (line[x] + line[x - ch]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - ch] if x >= ch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - ch] if x >= ch else 0
                b = prev[x]
                c = prev[x - ch] if x >= ch else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, ch, bytes(out)


def main():
    png, dsf = sys.argv[1], float(sys.argv[2])
    expects = [float(x) for x in sys.argv[3].split(',')]
    tol_rpx = float(sys.argv[4]) if len(sys.argv) > 4 else 1.6
    w, h, ch, px = read_png(png)

    def at(x, y):
        o = (y * w + x) * ch
        return px[o], px[o + 1], px[o + 2]

    # 1) 青色按钮带
    rows = [y for y in range(h)
            if sum(1 for x in range(0, w, 4) if (lambda c: c[0] < 80 and c[1] > 150 and c[2] > 180)(at(x, y))) > 8]
    bands = []
    for y in rows:
        if bands and y == bands[-1][-1] + 1:
            bands[-1].append(y)
        else:
            bands.append([y])
    bands = [(g[0], g[-1]) for g in bands if len(g) > 20]

    # 2) 红虚线行（虚线覆盖率约 50%，阈值必须给宽：卡在 w//8 会整体漏检 —— 踩过）
    red = [y for y in range(h)
           if sum(1 for x in range(0, w, 4) if (lambda c: c[0] > 180 and c[1] < 110 and c[2] < 110)(at(x, y))) > 20]

    # 1 rpx 在图像里占多少像素：750 rpx = 整幅页宽
    px_per_rpx = w / 750.0
    print('图像 %dx%d  dsf=%g  1 rpx = %.2f 图像像素  按钮带 %d 个  红线行 %s'
          % (w, h, dsf, px_per_rpx, len(bands), red))
    fails = 0
    for k, (y0, y1) in enumerate(bands):
        # 白字墨迹：只取按钮**中间 50% 宽度** —— 否则四角露出的白色卡片底会被当成字
        x_lo, x_hi = int(w * 0.25), int(w * 0.75)
        ys = [y for y in range(y0 + 2, y1 - 1)
              for x in range(x_lo, x_hi) if all(v > 240 for v in at(x, y))]
        if not ys:
            print('  行%d：未找到白字' % (k + 1)); fails += 1; continue
        ink_c = (min(ys) + max(ys) + 1) / 2
        box_c = (y0 + y1 + 1) / 2
        off_rpx = (ink_c - box_c) / px_per_rpx
        rl = [y for y in red if y0 <= y <= y1]
        line_off = ((rl[0] + rl[-1] + 1) / 2 - box_c) if rl else None
        print('  行%d 按钮 y[%d,%d] 高%d | 墨迹中心 偏移 %+.2f rpx' % (k + 1, y0, y1, y1 - y0 + 1, off_rpx))
        if line_off is None:
            print('     ❌ 该按钮上没有红线，无法校验基准'); fails += 1
        else:
            okline = abs(line_off) <= 1.5
            print('     %s 基准线是否压在按钮几何中心：偏 %+.1f 图像像素' % ('✅' if okline else '❌', line_off))
            if not okline: fails += 1
        if k < len(expects):
            okoff = abs(off_rpx - expects[k]) <= tol_rpx
            print('     %s 墨迹偏移是否与探针实测一致：期望 %+.2f rpx（容差 ±%.1f）' % ('✅' if okoff else '❌', expects[k], tol_rpx))
            if not okoff: fails += 1
    print('=' * 60)
    print('✅ 对照图通过校验' if fails == 0 else '❌ 对照图有 %d 项不成立，禁止作为证据交付' % fails)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
