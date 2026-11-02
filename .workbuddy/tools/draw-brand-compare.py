from PIL import Image, ImageDraw, ImageFont
import os


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


F_T, F_H, F_B, F_S, F_M, F_SS = (font(30, True), font(22, True), font(19),
                                 font(16), font(21, True), font(14))

INK, GRAY, LINE = '#1d1d1f', '#6a6a70', '#e5e5ea'
GOOD, BAD = '#0f7b3f', '#c02626'

W, H = 1180, 566
img = Image.new('RGB', (W, H), '#ffffff')
d = ImageDraw.Draw(img)

d.text((40, 28), '同一品牌，两代取值', font=F_T, fill=INK)
d.text((40, 70), 'Web（erp.hergent.cn，v735）已按语义分三档；小程序（小赫智体报单助手，v393）一档全用',
       font=F_B, fill=GRAY)

colx, colw = [40, 620], 520
for x, h in zip(colx, ['Web · v735　三档分开用', '小程序 · v393　一档全用']):
    d.rectangle([x, 116, x + colw, 152], fill='#f5f5f7')
    d.text((x + 16, 124), h, font=F_H, fill=INK)


def block(x, y, color, label, sample, ratio, ok, note=''):
    sw_w, sw_h = 132, 58
    d.rectangle([x, y, x + sw_w, y + sw_h], fill=color, outline=LINE)
    f = font(19, True)
    tw = d.textlength(sample, font=f)
    d.text((x + (sw_w - tw) / 2, y + 16), sample, font=f, fill='#ffffff')
    d.text((x + sw_w + 16, y + 0), label, font=F_B, fill=INK)
    d.text((x + sw_w + 16, y + 28), color.upper(), font=F_S, fill=GRAY)
    rx = x + colw - 96
    if ratio is None:
        d.text((rx - 6, y + 4), '仅装饰', font=F_S, fill=GRAY)
    else:
        d.text((rx, y - 2), '%.2f:1' % ratio, font=F_M, fill=GOOD if ok else BAD)
        d.text((rx + 2, y + 28), ('✓ 达标' if ok else '✗ 不达标'), font=F_S, fill=GOOD if ok else BAD)
    if note:
        d.text((x, y + sw_h + 3), note, font=F_SS, fill=GRAY)


y0, gap = 176, 104
x = colx[0]
block(x, y0, '#0e7490', '主按钮 / 选中底', '提交', 5.36, True, '--p-solid　白字过 AA')
block(x, y0 + gap, '#0a5a6d', '链接 / 强调文字（压白底）', '查看', 7.79, True, '--p-ink　过 AAA')
block(x, y0 + gap * 2, '#06b6d4', '装饰（图标 / 线条 / 图表）', '●', None, True, '--p　只做装饰，不承字')

x = colx[1]
block(x, y0, '#06b6d4', '主按钮 / 选中底', '提交', 2.43, False, '.submit-btn / .btn / .dock-btn-main　16 处')
block(x, y0 + gap, '#06b6d4', '链接 / 强调文字（压白底）', '查看', 2.43, False, '.hact / .msg-go / .last-go　28 处')
block(x, y0 + gap * 2, '#06b6d4', '原生导航栏 / 标签栏', '报单', 2.43, False, 'app.json　navigationBar + tabBar.selectedColor')

by = y0 + gap * 2 + 90
d.rectangle([40, by, W - 40, by + 1], fill=LINE)
d.text((40, by + 14), '小程序把「装饰色」当成了「主色」—— 这正是 Web 端 v717 修掉的缺陷',
       font=F_B, fill=INK)
d.text((40, by + 44), '44 处样式 + 2 处原生配置；亮青 #06b6d4 压白底 2.43、压页底 #f5f5f7 仅 2.23，是全站最低的一档',
       font=F_S, fill=GRAY)

out = '/Users/zhangjunfeng/Documents/laozhangai-product/docs/assets/v736/品牌色对照-Webvs小程序.png'
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out)
print('saved', out, img.size)
