#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小程序报单页关键部件：改前 / 改后 等比还原图（v736）
数值全部取自 pages/*.wxss 的真实声明，rpx 按 375 视口折半（1rpx = 0.5px）。
⚠️ 这是按样式值画的示意图，不是真机/模拟器截图 —— 用于确认配色关系，不用于验证布局。
"""
import os
from PIL import Image, ImageDraw, ImageFont

PF = '/System/Library/Fonts/PingFang.ttc'
SONG = '/System/Library/Fonts/Supplemental/Songti.ttc'


def font(sz, bold=False):
    for p in (PF, SONG):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz, index=(1 if bold else 0))
            except Exception:
                try:
                    return ImageFont.truetype(p, sz)
                except Exception:
                    pass
    return ImageFont.load_default()


S = 1.6                      # 放大倍数
PW = int(375 * S)            # 手机宽度（px 实际尺寸 × S）
RPX = 0.5 * S                # 1rpx 对应像素

BRAND_OLD = '#06b6d4'
SUB_OLD = '#0891b2'
BRAND_NEW = '#0e7490'
TINT = '#ecfeff'
TINT_BD = '#a5f3fc'
PAGE_BG = '#f5f5f7'
INK = '#1d1d1f'
GRAY = '#8e8e93'
OK = '#0f7b3f'
BAD = '#c02626'

F_TAG = font(int(17 * S / 1.6), True)
F_NAV = font(int(17 * S / 1.6), True)
F_CHIP = font(12)
F_TITLE = font(13, True)
F_SUB = font(11)
F_LINK = font(13, True)
F_BTN = font(16, True)
F_TAB = font(10)
F_NOTE = font(12)
F_SMALL = font(11)

ICON_H = int(28 * S)         # 图标显示尺寸（rpx 56）


def paste_icon(canvas, path, cx, cy, h):
    im = Image.open(path).convert('RGBA')
    r = h / im.height
    im = im.resize((int(im.width * r), int(im.height * r)), Image.LANCZOS)
    canvas.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)), im)


def draw_phone(d, canvas, x, y, brand, sub, icon_paths, note_rows):
    """从 (x,y) 起画一屏，返回占用高度"""
    cur = 0
    # ── 导航栏：navigationBarBackgroundColor + 白字 ──
    nav_h = int(44 * S)
    d.rectangle([x, y, x + PW, y + nav_h], fill=brand)
    t = '小赫智体报单助手'
    tw = d.textlength(t, font=F_NAV)
    d.text((x + (PW - tw) / 2, y + nav_h / 2 - 10), t, font=F_NAV, fill='#ffffff')
    cur += nav_h

    # ── 页面底 ──
    body_top = y + cur
    body_h = int(268 * S)
    d.rectangle([x, body_top, x + PW, body_top + body_h], fill=PAGE_BG)
    by = body_top + int(10 * S)

    # 频率芯片 .fchip-freq-on{background:brand;border-color:brand;color:#fff}
    chip = '两天一次'
    cw = d.textlength(chip, font=F_CHIP) + 24
    d.radius_rectangle = None
    d.rounded_rectangle([x + int(16 * S), by, x + int(16 * S) + cw, by + 22],
                        radius=11, fill=brand)
    d.text((x + int(16 * S) + 12, by + 5), chip, font=F_CHIP, fill='#ffffff')
    by += 22 + int(10 * S)

    # 消息条 .msg-bar：底 #ecfeff、1rpx 边 #a5f3fc、左 6rpx 实心条
    mb_h = int(62 * S)
    mx0 = x + int(16 * S)
    mx1 = x + PW - int(16 * S)
    d.rounded_rectangle([mx0, by, mx1, by + mb_h], radius=7, fill=TINT, outline=TINT_BD, width=1)
    d.rectangle([mx0, by + 1, mx0 + int(6 * RPX) - 0, by + mb_h - 1], fill=brand)
    d.text((mx0 + int(14 * S), by + int(9 * S)), '待报 3 个门店', font=F_TITLE, fill=brand)
    d.text((mx0 + int(14 * S), by + int(30 * S)), '今天 17:00 截止 · 还有 2 小时', font=F_SUB, fill=sub)
    # 右侧箭头 .msg-go{font-size:36rpx;color:brand}
    d.text((mx1 - int(20 * S), by + mb_h / 2 - 14), '›', font=font(int(22 * S), True), fill=brand)
    by += mb_h + int(10 * S)

    # 可点文字：查看上期
    d.text((mx0, by + 2), '查看上期清单', font=F_LINK, fill=brand)
    d.text((mx1 - d.textlength('复制', font=F_LINK), by + 2), '复制', font=F_LINK, fill=brand)
    by += int(26 * S) + int(10 * S)

    # 主按钮 .submit-btn{background:brand;color:#fff;height:88rpx;radius:16rpx}
    bh = int(88 * RPX)
    d.rounded_rectangle([mx0, by, mx1, by + bh], radius=int(16 * RPX), fill=brand)
    t = '提交预报'
    tw = d.textlength(t, font=F_BTN)
    d.text(((mx0 + mx1 - tw) / 2, by + bh / 2 - 11), t, font=F_BTN, fill='#ffffff')
    cur += body_h

    # ── tabBar：白底、selectedColor 管文字、图标色在 PNG 里 ──
    ty = y + cur
    tb_h = int(50 * S)
    d.rectangle([x, ty, x + PW, ty + tb_h], fill='#ffffff')
    d.line([x, ty, x + PW, ty], fill='#e5e5ea', width=1)
    for i, (label, icon) in enumerate(zip(('填报', '我的提交'), icon_paths)):
        cx = x + PW * (0.25 + 0.5 * i)
        paste_icon(canvas, icon, cx, ty + int(15 * S), ICON_H)
        tw = d.textlength(label, font=F_TAB)
        d.text((cx - tw / 2, ty + int(33 * S)), label, font=F_TAB, fill=brand)
    cur += tb_h
    d.rectangle([x, y, x + PW - 1, y + cur - 1], outline='#d8d8dd', width=1)
    return cur


NAV_H = int(44 * S)
BODY_H = int(268 * S)
TB_H = int(50 * S)
PHONE_H = NAV_H + BODY_H + TB_H
COL_GAP = 60
MARGIN = 40
W = MARGIN * 2 + PW * 2 + COL_GAP
Y0 = 124
NOTE_BLOCK = 80          # 每列下方三行说明
RULE_Y = Y0 + PHONE_H + NOTE_BLOCK + 20
H = RULE_Y + 96

img = Image.new('RGB', (W, H), '#ffffff')
d = ImageDraw.Draw(img)

d.text((40, 26), '小程序报单页 · 品牌色统一前后（按 wxss 真实数值等比还原，非真机截图）', font=font(24, True), fill=INK)
d.text((40, 58), '报单助手 v393 → v736：亮青 #06B6D4 当主色 → 深青 #0E7490（与 Web 端 --p-solid 同值）',
       font=F_NOTE, fill='#6a6a70')

col_x = [MARGIN, MARGIN + PW + COL_GAP]
heads = ['改前 · v393', '改后 · v736']
for i, hx in enumerate(col_x):
    d.text((hx, 96), heads[i], font=F_TAG, fill=INK)

y0 = Y0
for i, hx in enumerate(col_x):
    before = (i == 0)
    brand = BRAND_OLD if before else BRAND_NEW
    sub = SUB_OLD if before else BRAND_NEW
    icons = (['/tmp/icon-before-fill.png', '/tmp/icon-before-mine.png'] if before else
             ['forecast-order-miniprogram-20260812T023419087Z/miniprogram/assets/tab-fill-active.png',
              'forecast-order-miniprogram-20260812T023419087Z/miniprogram/assets/tab-mine-active.png'])
    hgt = draw_phone(d, img, hx, y0, brand, sub, icons, None)
    # 页脚注
    if before:
        txt = '白字 2.43:1 ×    副标题压浅青底 3.54:1 ×'
        col = BAD
    else:
        txt = '白字 5.36:1 √    副标题 5.15:1 √'
        col = OK
    d.text((hx, y0 + hgt + 12), txt, font=F_SMALL, fill=col)
    d.text((hx, y0 + hgt + 30), f'导航栏 / 按钮 / 芯片 / 箭头 / 链接 = {brand.upper()}', font=F_SMALL, fill='#6a6a70')
    d.text((hx, y0 + hgt + 48), f'tabBar 图标 = {brand.upper()}（藏在 PNG 里，与文字色同批改）', font=F_SMALL, fill='#6a6a70')

# 结论条
by = RULE_Y
d.line([MARGIN, by, W - MARGIN, by], fill='#e5e5ea', width=1)
d.text((40, by + 16), '改的是同一个语义位置，不是「换了个好看的青」：白字压在亮青上 2.43:1，远低于 AA 4.5，',
       font=F_NOTE, fill=INK)
d.text((40, by + 38), '所以「看起来不一样」里有一半其实是「看不清」。改后 5.36:1，与 Web 端实心底完全同值。',
       font=F_NOTE, fill=INK)

img.save('docs/assets/v736/小程序报单页-改前改后.png')
print('saved', img.size)
