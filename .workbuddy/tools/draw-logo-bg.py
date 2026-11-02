from PIL import Image, ImageDraw, ImageFont
import colorsys
import os

ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product'


def font(sz, bold=False):
    for p in ('/System/Library/Fonts/PingFang.ttc',
              '/System/Library/Fonts/Supplemental/Songti.ttc'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz, index=1 if bold else 0)
            except Exception:
                try:
                    return ImageFont.truetype(p, sz)
                except Exception:
                    pass
    return ImageFont.load_default()


def hue(h):
    h = h.lstrip('#')
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, ss * 100, ll * 100


F_T, F_H, F_B, F_S, F_SS = font(29, True), font(21, True), font(18), font(15), font(13)
INK, GRAY, LINE = '#1d1d1f', '#6a6a70', '#e5e5ea'

W, H = 1160, 584
img = Image.new('RGB', (W, H), '#ffffff')
d = ImageDraw.Draw(img)

d.text((40, 26), '品牌 Logo 的底：一支横跨两代青色的渐变', font=F_T, fill=INK)
d.text((40, 66), 'erp.hergent.cn 与小程序的 logo 是同一支（favicon.svg = brand-logo.png）',
       font=F_B, fill=GRAY)

# ---- 左：真实 logo ----
logo = Image.open(f'{ROOT}/forecast-order-miniprogram-20260812T023419087Z/miniprogram/assets/brand-logo.png').convert('RGB')
logo_big = logo.resize((196, 196), Image.LANCZOS)
img.paste(logo_big, (40, 116))
d.rectangle([40, 116, 40 + 195, 116 + 195], outline=LINE)

d.text((40, 322), '256×256 原图 · 白色 H 字压在渐变上', font=F_SS, fill=GRAY)

# 渐变条
grad = Image.new('RGB', (196, 26))
for x in range(196):
    t = x / 195
    r = int(0x0d + (0x06 - 0x0d) * t)
    g = int(0x94 + (0xb6 - 0x94) * t)
    b = int(0x88 + (0xd4 - 0x88) * t)
    for y in range(26):
        grad.putpixel((x, y), (r, g, b))
img.paste(grad, (40, 348))
d.text((40, 378), '#0d9488', font=F_S, fill='#0d9488')
d.text((176, 378), '#06b6d4', font=F_S, fill='#06b6d4')

# ---- 右：三支色 ----
rows = [
    ('#0d9488', 'Logo 渐变起点（青绿 teal）', '主应用令牌里没有它 —— 只在 logo 与 legal 页'),
    ('#0e7490', 'Web 主色 / 实心底  --p-solid', '按钮、选中底；小程序目前还没用上'),
    ('#06b6d4', '品牌青  --p（只做装饰）', 'Logo 渐变终点；小程序却拿它当主色'),
]
y = 116
for hx, label, note in rows:
    hh, ss, ll = hue(hx)
    d.rectangle([470, y, 470 + 96, y + 62], fill=hx, outline=LINE)
    d.text((470 + 104, y + 2), label, font=F_B, fill=INK)
    d.text((470 + 104, y + 26), hx.upper(), font=F_S, fill=GRAY)
    d.text((470 + 104, y + 44), note, font=F_SS, fill=GRAY)
    d.text((W - 132, y + 14), '%d°' % round(hh), font=F_H, fill=INK)
    d.text((W - 132, y + 40), '色相', font=F_SS, fill=GRAY)
    y += 84

# 实测小样本
sm = logo.resize((22, 22), Image.LANCZOS)
img.paste(sm, (40, 424))
d.rectangle([40, 424, 61, 445], outline=LINE)
d.text((72, 424), '22px（侧栏实际尺寸）→ 压缩后落到 #0AA3A9 附近，既不绿也不青',
       font=F_SS, fill=GRAY)
sm48 = logo.resize((48, 48), Image.LANCZOS)
img.paste(sm48, (40, 462))
d.rectangle([40, 462, 87, 509], outline=LINE)
d.text((99, 474), '48px（登录页）→ 两端才分得出来', font=F_SS, fill=GRAY)

# 底部结论
d.rectangle([40, 526, W - 40, 527], fill=LINE)
d.text((40, 540), '色相从 175° 跨到 189°：logo 左上是「青绿」、全站主色是「青」—— 并列时能看出不是一支',
       font=F_SS, fill=GRAY)

out = f'{ROOT}/docs/assets/v736/品牌logo底色-渐变.png'
img.save(out)
print('saved', out, img.size)
