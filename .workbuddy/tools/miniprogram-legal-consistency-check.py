#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
miniprogram-legal-consistency-check.py
======================================
小程序协议合规静态核对（P0 整改验收用，**只读**，不写任何文件）

背景：微信审核员会点开小程序内的协议入口，再对照公众平台后台申报的《用户隐私保护指引》。
两者口径不一致 = 「双版本」问题，是高频驳回点。同时，小程序与网页端是**两个不同产品**，
把网页端政策照搬过来会声明本程序不具备的处理行为 = 「多申报」。

本脚本核对六组共 26 项：
  A 协议页存在性 + app.json 注册
  B 登录页常驻入口（关键：入口不得位于隐私弹窗内部）+ 弹窗样式是否真的定义
  C 协议页正文 vs 平台申报版 md 同源（逐句包含）
  D 多申报检测（否定句豁免，否则「不收集设备型号」这类句子会误报）
  E PIPL 第 17 条必告知要素
  F 非必要项是否真的可控（开关 + 撤回同意）

用法：
    python3 .workbuddy/tools/miniprogram-legal-consistency-check.py
退出码：0 = 全绿；1 = 有失败项
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MP_DIR = os.path.join(ROOT, 'forecast-order-miniprogram-20260812T023419087Z')
MINI = os.path.join(MP_DIR, 'miniprogram')
PAGES = os.path.join(MINI, 'pages')
GUIDE = os.path.join(MP_DIR, '隐私保护指引.md')

RESULTS = []  # (group, name, ok, detail)


def check(group, name, ok, detail=''):
    RESULTS.append((group, name, bool(ok), detail))
    return bool(ok)


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def norm(text):
    """归一化：剥 wxml 注释与标签、统一引号与空白，用于跨文件文本比对。"""
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)   # 注释里含说明性文字，必须剥离
    text = re.sub(r'<[^>]+>', '', text)                   # 剥标签
    text = text.replace('「', '"').replace('」', '"')
    text = text.replace('“', '"').replace('”', '"')
    text = text.replace('`', '').replace('**', '')
    text = text.replace('本指引', '本政策')
    text = re.sub(r'\s+', '', text)
    return text


# ----------------------------------------------------------------------------
# 极简 wxml 结构分析：判断某个 class 是否落在 `wx:if="{{showPrivacy}}"` 块内
# ----------------------------------------------------------------------------
class StructureProbe(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []          # 每层：bool（是否处于 showPrivacy 块内）
        self.class_pos = {}      # class 名 -> 首次出现时是否在 showPrivacy 块内
        self.unbalanced = []

    def _mark(self, attrs, push):
        d = dict(attrs)
        parent = self.stack[-1] if self.stack else False
        inside = parent or any('showPrivacy' in str(v or '') for v in d.values())
        for c in str(d.get('class', '')).split():
            self.class_pos.setdefault(c, inside)
        if push:
            self.stack.append(inside)

    def handle_starttag(self, tag, attrs):
        self._mark(attrs, True)

    def handle_startendtag(self, tag, attrs):
        self._mark(attrs, False)

    def handle_endtag(self, tag):
        if self.stack:
            self.stack.pop()
        else:
            self.unbalanced.append(tag)


def probe(path):
    p = StructureProbe()
    p.feed(read(path))
    return p


# ============================== A 页面与注册 ==================================
def group_a():
    g = 'A 页面与注册'
    need = {
        'pages/legal/privacy.wxml': '隐私政策页',
        'pages/legal/privacy.js': '隐私政策页',
        'pages/legal/privacy.json': '隐私政策页',
        'pages/legal/privacy.wxss': '隐私政策页',
        'pages/legal/terms.wxml': '用户服务协议页',
        'pages/legal/terms.js': '用户服务协议页',
        'pages/legal/terms.json': '用户服务协议页',
        'pages/legal/terms.wxss': '用户服务协议页',
        'pages/legal/legal.wxss': '协议页共享样式（被两个页面 @import）',
        'pages/privacy-settings/privacy-settings.wxml': '隐私设置页',
        'pages/privacy-settings/privacy-settings.js': '隐私设置页',
        'pages/privacy-settings/privacy-settings.json': '隐私设置页',
        'pages/privacy-settings/privacy-settings.wxss': '隐私设置页',
    }
    missing = [p for p in need if not os.path.isfile(os.path.join(MINI, p.replace('/', os.sep)))]
    check(g, '协议页与隐私设置页共 13 个文件齐全', not missing,
          '缺失: ' + ', '.join(missing) if missing else '')

    app = json.loads(read(os.path.join(MINI, 'app.json')))
    pages = app.get('pages', [])
    want = ['pages/legal/privacy', 'pages/legal/terms', 'pages/privacy-settings/privacy-settings']
    miss = [w for w in want if w not in pages]
    check(g, 'app.json 已注册 3 个新页面', not miss, '未注册: ' + ', '.join(miss) if miss else '')

    # 两个协议页须共用 legal.wxss（否则长文排版样式要维护两份）
    imp = [p for p in ('privacy', 'terms')
           if '@import "./legal.wxss"' not in read(os.path.join(PAGES, 'legal', p + '.wxss'))]
    check(g, '两个协议页均 @import legal.wxss', not imp, '未引入: ' + ', '.join(imp) if imp else '')

    check(g, '协议页正文为非空（wxml 有实质文本）',
          len(norm(read(os.path.join(PAGES, 'legal', 'privacy.wxml')))) > 800
          and len(norm(read(os.path.join(PAGES, 'legal', 'terms.wxml')))) > 600, '')


# ========================= B 常驻入口与弹窗样式 ===============================
def group_b():
    g = 'B 登录页常驻入口'
    login_wxml = os.path.join(PAGES, 'login', 'login.wxml')
    login_wxss = os.path.join(PAGES, 'login', 'login.wxss')
    probe_login = probe(login_wxml)
    src = read(login_wxml)

    # 本项是原缺陷的核心判据：协议入口必须在弹窗**之外**，否则同意过一次就再无入口。
    inside = probe_login.class_pos.get('legal-links')
    check(g, '常驻入口 legal-links 位于隐私弹窗之外', inside is False,
          'legal-links 未找到' if inside is None else 'legal-links 落在 showPrivacy 块内（同意后再不可见）')

    check(g, '常驻入口含《用户服务协议》与《隐私政策》两个可点链接',
          'goTerms' in src and 'goPrivacy' in src and '《用户服务协议》' in src and '《隐私政策》' in src)

    check(g, '弹窗内部也提供完整版协议链接（.pz-more）',
          probe_login.class_pos.get('pz-more') is True)

    # 🔴 回归断言：本轮发现 privacy-mask / privacy-box / privacy-body / p-btn
    #    全仓只有 wxml 引用、没有任何 CSS 定义 —— 弹窗没有遮罩与卡片外观，
    #    只会渲染成登录卡片下方的一坨裸文字，用户根本认不出那是隐私协议弹窗。
    wxss = read(login_wxss)
    need_css = ['privacy-mask', 'privacy-box', 'privacy-body', 'p-btn', 'legal-links', 'lk']
    absent = [c for c in need_css if not re.search(r'\.' + re.escape(c) + r'\s*[,{:]', wxss)]
    check(g, '弹窗与入口样式均已定义（防"类名只存在于 wxml"回归）', not absent,
          '未定义: ' + ', '.join(absent) if absent else '')

    check(g, '非必要项区块 .pz-opt 在弹窗内且已样式化',
          probe_login.class_pos.get('pz-opt') is True and '.pz-opt' in wxss)

    # 入口必须不依赖 showPrivacy 之外的条件（不能又藏进别的 wx:if）
    links_seg = re.search(r'<view class="legal-links".*?</view>', src, re.S)
    check(g, '常驻入口自身不带任何 wx:if 条件',
          bool(links_seg) and 'wx:if' not in links_seg.group(0))


# ======================== C 协议页 vs 平台申报版同源 ==========================
def group_c():
    g = 'C 与平台申报版同源'
    guide = read(GUIDE)
    page = norm(read(os.path.join(PAGES, 'legal', 'privacy.wxml')))

    sentences = []
    for line in guide.splitlines():
        s = line.strip()
        if not s or s.startswith('#') or s.startswith('>') or s.startswith('---'):
            continue
        s = re.sub(r'^[-*]\s+', '', s)
        s = re.sub(r'^\d+\.\s+', '', s)
        if len(s) >= 12:                     # 太短的片段没有比对价值
            sentences.append(s)

    miss = []
    for s in sentences:
        key = norm(s)
        if len(key) >= 10 and key not in page:
            miss.append(s[:44])
    check(g, '平台申报版每一句都能在隐私政策页找到（逐句同源）', not miss,
          '缺失 %d 句: %s' % (len(miss), ' | '.join(miss[:5])) if miss else '')

    # 反向：协议页不得出现申报版完全没有的"新收集行为"
    # （只做提示级：协议页允许补充 PIPL 要素，但不应多出信息收集种类）
    check(g, '协议页声明了与申报版一致的收集种类（账号/业务数据/剪切板）',
          all(k in page for k in ('登录账号、密码', '你填报的业务数据', '剪切板（写入）')))

    check(g, '协议页未把"本程序"误写成网页端产品名',
          'Hergent·AI经营副驾' not in page.replace('配套移动端报单工具', ''))


# ============================ D 多申报检测 ====================================
# 网页端（hergent.cn）确实做、但小程序**不做**的处理行为。
# 一旦出现在小程序协议页里 = 多申报（申报了并未发生的收集行为）。
# ⚠️ 用词组而非裸词：`Excel` 单独出现不构成多申报 ——
#    「便于你粘贴到微信或 Excel」讲的是用户把复制结果粘到哪去，是申报版原文。
#    真正的多申报特征是「你上传」「连接器同步」这类**我们收集**的动作。
FORBIDDEN = [
    '连接器', 'Excel上传', '上传Excel', '你上传或', '由连接器同步',
    '大模型', 'DeepSeek', 'Hermes', 'AI引擎', '受托处理者',
    '登录IP', '设备型号', '浏览器类型', '系统版本', '崩溃日志',
    '相册', '摄像头', '麦克风', '通讯录', '蓝牙', 'OpenID', '一键登录',
    '广告SDK', '第三方统计',
]

# 否定句豁免词：出现这些词的句子是在"声明不做什么"，不是在"申报做什么"
NEG = ['不收集', '不使用', '不获取', '不接入', '不上传', '不存储', '不读取', '不向', '不会', '未使用']


def scan_overclaim(path):
    text = norm(read(path))
    hits = []
    for sent in re.split(r'[。；;]', text):
        if not sent:
            continue
        if any(n in sent for n in NEG):
            continue
        for w in FORBIDDEN:
            if w in sent:
                hits.append('%s ← 「%s…」' % (w, sent[:30]))
    return hits


def group_d():
    g = 'D 多申报检测'
    for page, label in (('privacy', '隐私政策'), ('terms', '用户服务协议')):
        hits = scan_overclaim(os.path.join(PAGES, 'legal', page + '.wxml'))
        check(g, '%s页无小程序不做的处理行为（多申报）' % label, not hits,
              '命中: ' + ' | '.join(hits[:4]) if hits else '')

    def scan_text(text):
        out = []
        for sent in re.split(r'[。；;]', text):
            if not sent or any(n in sent for n in NEG):
                continue
            for w in FORBIDDEN:
                if w in sent:
                    out.append(w)
        return out

    # 双向自检：负样本不得误报（原缺陷：裸词 `Excel` 命中「粘贴到微信或 Excel」）
    neg_sample = norm('不收集设备型号、系统版本与崩溃日志；不获取位置、相册、摄像头、麦克风。'
                      '剪切板（写入）：仅当你主动点击复制时把汇总结果写入剪切板，便于你粘贴到微信或 Excel。')
    false_pos = scan_text(neg_sample)
    check(g, '扫描器不误报（否定句与"粘贴去向"均豁免）', not false_pos,
          '误报: ' + str(false_pos) if false_pos else '')

    # 正样本必须命中，否则"没命中"可能只是扫描器失灵
    pos_sample = norm('你主动上传或由连接器同步的 Excel / 数据；使用与设备信息：登录 IP、'
                      '设备与浏览器类型、操作日志；数据会传输至我们集成的大模型服务。')
    must_hit = scan_text(pos_sample)
    check(g, '扫描器对真实多申报有判别力（正样本必须命中）',
          len(must_hit) >= 4, '仅命中 %d 项: %s' % (len(must_hit), must_hit))


# ========================= E PIPL 第 17 条要素 ===============================
def group_e():
    g = 'E PIPL 第17条要素'
    page = norm(read(os.path.join(PAGES, 'legal', 'privacy.wxml')))
    items = [
        ('处理者名称', '湖北省小赫智体数字科技有限公司'),
        ('统一社会信用代码', '91420606MAKF1YPG5Y'),
        ('联系方式', 'postmaster@hergent.cn'),
        ('处理目的', '信息的使用目的'),
        ('信息种类', '我们收集的信息'),
        # 🔴 保存期限：本轮整改前平台申报版/弹窗版/网页版**三份都没有**，
        #    而它是 PIPL 第 17 条明文列举的必告知项（只有"注销后删除"是删除触发条件，不是保存期限）。
        ('保存期限', '保存期限'),
        ('保存期限具体时长', '30日'),
        ('权利行使方式', '行使方式'),
        ('未成年人条款', '未成年人保护'),
        ('更新机制', '本政策的更新'),
    ]
    for name, key in items:
        check(g, '告知' + name, key in page)


# ====================== F 非必要项是否真的可控 ===============================
def group_f():
    g = 'F 非必要项可控性'
    track = read(os.path.join(MINI, 'utils', 'track.js'))
    check(g, 'track.js 提供 statDisabled 判断', 'function statDisabled' in track)
    check(g, 'track() 上报前先查开关（否则开关形同虚设）',
          re.search(r'function track\(event.*?\n(?:.*\n){0,8}?\s*if \(statDisabled\(\)\)', track) is not None)
    check(g, 'track.js 导出开关常量供设置页复用', 'OPT_OUT_KEY' in track)

    ps = read(os.path.join(PAGES, 'privacy-settings', 'privacy-settings.js'))
    check(g, '隐私设置页可写入统计开关', 'OPT_OUT_KEY' in ps and 'setStorageSync' in ps)
    check(g, '隐私设置页可撤回同意（清除 fs_privacy_agreed）',
          'fs_privacy_agreed' in ps and 'removeStorageSync' in ps)
    check(g, '隐私设置页撤回后清登录态', "fs_token" in ps and 'reLaunch' in ps)

    check(g, '隐私设置页有统计开关（switch 组件）',
          '<switch' in read(os.path.join(PAGES, 'privacy-settings', 'privacy-settings.wxml')))

    mine = read(os.path.join(PAGES, 'mine', 'mine.wxml'))
    check(g, '「我的」页有隐私设置入口', 'goPrivacySettings' in mine)


# ============================== 标签配平 ======================================
def group_g():
    g = 'G wxml 结构'
    files = []
    for root, _dirs, names in os.walk(PAGES):
        for n in sorted(names):
            if n.endswith('.wxml'):
                files.append(os.path.join(root, n))
    bad = []
    for f in files:
        p = probe(f)
        if p.unbalanced or p.stack:
            bad.append('%s (残留深度 %d, 未配对闭合 %s)'
                       % (os.path.relpath(f, MINI), len(p.stack), p.unbalanced[:3]))
    check(g, '全部 %d 个 wxml 标签配平' % len(files), not bad, ' | '.join(bad[:4]) if bad else '')


def main():
    for fn in (group_a, group_b, group_c, group_d, group_e, group_f, group_g):
        fn()

    groups = {}
    for grp, name, ok, detail in RESULTS:
        groups.setdefault(grp, []).append((name, ok, detail))

    total = len(RESULTS)
    passed = sum(1 for _g, _n, ok, _d in RESULTS if ok)

    print('=' * 74)
    print('小程序协议合规静态核对（P0 2026-09-19）')
    print('=' * 74)
    for grp in sorted(groups):
        rows = groups[grp]
        gok = sum(1 for _n, ok, _d in rows if ok)
        print('\n【%s】 %d/%d' % (grp, gok, len(rows)))
        for name, ok, detail in rows:
            mark = 'PASS' if ok else 'FAIL'
            print('  [%s] %s' % (mark, name))
            if not ok and detail:
                print('         ↳ %s' % detail)

    print('\n' + '=' * 74)
    print('总计 %d/%d' % (passed, total))
    if passed == total:
        print('RESULT: ALL GREEN')
    else:
        print('RESULT: %d 项未通过' % (total - passed))
    print('=' * 74)
    return 0 if passed == total else 1


if __name__ == '__main__':
    sys.exit(main())
