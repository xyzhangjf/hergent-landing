#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
miniprogram-legal-consistency-check.py
======================================
小程序协议合规静态核对（P0 整改验收用，**只读**，不写任何文件）

背景：微信审核员会点开小程序内的协议入口，再对照公众平台后台申报的《用户隐私保护指引》。
两者口径不一致 = 「双版本」问题，是高频驳回点。同时，小程序与网页端是**两个不同产品**，
把网页端政策照搬过来会声明本程序不具备的处理行为 = 「多申报」。

本脚本核对八组（A–H）：
  A 协议页存在性 + app.json 注册
  B 登录页常驻入口（关键：入口不得位于隐私弹窗内部）+ 弹窗样式是否真的定义
  C 协议页正文 vs 平台申报版 md 同源（逐句包含）
  D 多申报检测（否定句豁免，否则「不收集设备型号」这类句子会误报）
  E PIPL 第 17 条必告知要素
  F 非必要项是否真的可控（开关 + 撤回同意）
  G 全部 wxml 标签配平
  H 登录页「使用范围说明」（微信《账号登录规范》对「体验范围特定」类小程序的硬要求）

用法：
    python3 .workbuddy/tools/miniprogram-legal-consistency-check.py
    python3 .workbuddy/tools/miniprogram-legal-consistency-check.py --self-test
        （H 组坏样本自证：往副本注入 8 种错误写法，每种必须被判红。
          「真源码全绿」不等于「断言在检查」——本仓已多次踩过空白支票。）
退出码：0 = 全绿 / 自检通过；1 = 有失败项 / 自检失败
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

# v761（2026-11-04）：小程序新增「扫一扫报单」(`wx.scanCode`) ⇒ 摄像头/相册从
#   "不做的事"变成了**真的要做的事**，如实申报反而会被上面这张禁用词表打红。
#   修法不是把词删掉（那样以后有人多申报摄像头就没人拦），而是给一个**窄豁免**：
#   只有当句子同时说到「扫码」和「条码」——即明确了用途与范围——才允许出现这两个词。
#   另由 `group_d` 末尾的正向断言兜底：代码里调了 wx.scanCode 就必须有这条申报。
CAMERA_WORDS = ('相册', '摄像头')


def _is_scan_scope(sent):
    return '扫码' in sent and '条码' in sent


def scan_overclaim(path):
    text = norm(read(path))
    hits = []
    for sent in re.split(r'[。；;]', text):
        if not sent:
            continue
        if any(n in sent for n in NEG):
            continue
        # v761 窄豁免：明确写了"扫码识别条码"的句子，申报摄像头/相册是**合规**的
        if _is_scan_scope(sent):
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

    # ---- v761 正向断言：代码只要调了 wx.scanCode，隐私页就必须有**明确用途**的申报句 ----
    # 为什么要有这一条：`FORBIDDEN` 那张表是"小程序不做这些"的清单，它的盲区正是
    #   「功能加了、文档没跟上」—— 后台《用户隐私保护指引》没声明摄像头时，
    #   真机上 wx.scanCode 会被隐私校验直接拦下（用户看到的是"点了没反应"，不是报错）。
    uses_scan = False
    for root, _dirs, files in os.walk(MINI):
        for fn in files:
            if fn.endswith('.js') and 'wx.scanCode' in read(os.path.join(root, fn)):
                uses_scan = True
    priv = norm(read(os.path.join(PAGES, 'legal', 'privacy.wxml')))
    declared = any(_is_scan_scope(s) and '摄像头' in s and '相册' in s
                   for s in re.split(r'[。；;]', priv))
    check(g, '调用了 wx.scanCode ⇒ 隐私页申报摄像头/相册（用途限定扫码识别条码）',
          (not uses_scan) or declared,
          '代码里调了 wx.scanCode，但隐私页没有「扫码识别条码 + 摄像头/相册」的申报句'
          '（真机会被隐私校验拦；后台指引不同步还会构成未申报）')

    # 同一条纪律反向：申报了摄像头就必须真有扫码入口，否则是"多申报"
    ok_scan_entry = 'onScanTap' in read(os.path.join(PAGES, 'fill', 'fill.wxml'))
    check(g, '申报了摄像头 ⇒ 填报页确实有扫码入口（反之即多申报）',
          (not declared) or ok_scan_entry,
          '隐私页申报了摄像头，但 fill.wxml 里找不到 onScanTap 入口')


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
    # 「撤回后清登录态」有两种合规形态，两路都认：
    #   ① 本页直接清（本文件出现字面 fs_token）
    #   ② 委托 utils/session.js 的 logout()——2026-09-20 P1-1 起改为此形态，除本机清态外
    #      还会通知服务端销毁会话（比 ① 更强），但本文件里因此不再有 fs_token 字样。
    # 旧判据只认 ① ⇒ 代码改进后变成**假阴性**（工具失灵，不是代码漏了）。真正的判据应是
    # 「本页触发了清态，且被委托方确实清了 fs_token」。
    sess = read(os.path.join(MINI, 'utils', 'session.js'))
    clears_locally = 'fs_token' in ps
    delegates_ok = ('logout' in ps and 'removeStorageSync' in sess
                    and "removeStorageSync('fs_token')" in sess)
    check(g, '隐私设置页撤回后清登录态',
          (clears_locally or delegates_ok) and 'reLaunch' in ps)

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


# ============ H 登录页「使用范围说明」（微信登录规范硬要求） ==================
# 依据：微信《小程序帐号登录规范要求与修改指引》把小程序分两类，本程序属
#   **「体验范围特定」**（仅给本企业员工用、对外无开放注册流程），其整改建议第①条 =
#   「首页有明显的使用范围（特定范围）说明」。官方给出的**合规案例原话**即
#   「一进入页面即说明提示仅限内部员工可使用，并已进行账号鉴权」。
# 反面：社区置顶驳回回复「小程序为服务范围特定类，但页面无相关说明以及使用范围提示，
#   暂未符合登录规范要求」；2026-05-25 真人申诉「我的小程序是内部使用的，不需要公开的」
#   仍被要求按登录规范整改 ⇒ **「内部使用」不是豁免理由，恰恰是必须写说明的理由**。
# 🔴 本组存在的理由：这条文案在此前**没有任何护栏**。删掉它 `npm test` 照样全绿，
#    要等提审被驳回才发现 —— 与「判据缺失 = 空白支票」同族。
def _css_hex_map(wxss_path):
    """从 app.wxss 抽 `--name:#hex` 映射，用于把 var(--x) 还原成可算对比度的值。"""
    txt = re.sub(r'/\*.*?\*/', '', read(wxss_path), flags=re.S)
    return {n.lower(): v.lower() for n, v in re.findall(r'(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b', txt)}


def _resolve_paint(val, tokens):
    """把 `var(--brand-bg)` / `#ECF4F3` 统一成小写 `#rrggbb`；取不到返回 None。"""
    if not val:
        return None
    m = re.search(r'var\(\s*(--[\w-]+)\s*\)', val)
    if m:
        return tokens.get(m.group(1).lower())
    m = re.search(r'#[0-9a-fA-F]{6}\b', val)
    return m.group(0).lower() if m else None


def _lum(hex6):
    h = hex6.lstrip('#')
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def _contrast(a, b):
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def group_h():
    g = 'H 使用范围说明'
    login_wxml = os.path.join(PAGES, 'login', 'login.wxml')
    src = read(login_wxml)
    css = re.sub(r'/\*.*?\*/', '', read(os.path.join(PAGES, 'login', 'login.wxss')), flags=re.S)

    # ① 必须是**真实元素**。本仓注释极多，只查原始字符串会被注释里的一句话骗过
    #    （v762 就踩过：护栏锚点截到注释文字 ⇒ 假阴性）。
    el = re.search(r'<view[^>]*class="[^"]*\bscope-note\b[^"]*"[^>]*>(.*?)</view>', src, re.S)
    check(g, '登录页存在独立的「使用范围说明」元素 .scope-note', bool(el),
          '未找到 <view class="scope-note"> —— 微信要求该类别小程序「首页有明显使用范围说明」')

    text = norm(el.group(1)) if el else ''
    # ② 文案必须真的在限定范围。官方合规案例是「仅限内部员工可使用」；
    #    弱化成「欢迎使用」就等于没有说明。
    strong = bool(re.search(r'(仅限|仅面向|只面向|仅供)', text)) and \
             bool(re.search(r'(内部|本企业|本单位|本公司)', text))
    check(g, '文案含范围限定词（仅限/仅面向 + 内部/本企业）', strong,
          '当前文案「%s」不符合官方合规案例表述' % text)

    # ③ 不能在隐私弹窗里（未同意隐私时首页就看不到说明），也不能带条件渲染
    inside = probe(login_wxml).class_pos.get('scope-note')
    check(g, '说明位于隐私弹窗之外（首页静态可见）', inside is False,
          '未找到' if inside is None else '落在 showPrivacy 弹窗块内 ⇒ 首屏看不到说明')
    check(g, '说明元素自身不带 wx:if / wx:elif / wx:for',
          bool(el) and not re.search(r'wx:(if|elif|for)=', el.group(0)),
          '带条件渲染 ⇒ 某些状态下首页无使用范围说明')

    # ④ 样式存在且未被隐藏（元素在但 display:none = 等于没有）
    rule = re.search(r'\.scope-note\s*\{([^}]*)\}', css)
    check(g, '.scope-note 已定义样式', bool(rule), 'login.wxss 无该规则 ⇒ 元素在但无任何外观')
    body = rule.group(1) if rule else ''
    hidden = re.search(r'display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?!\.\d*[1-9])|font-size\s*:\s*0\b', body)
    check(g, '.scope-note 未被样式隐藏', not hidden,
          '出现「%s」⇒ 违反「首页有明显的使用范围说明」' % (hidden.group(0) if hidden else ''))

    # ⑤ 把「明显」拆成三个可量化代理：字号够读 / 有视觉容器 / 文字对比度 ≥ 4.5
    #    判据来源：2026-09-22 曾因「只有副标题里'内部使用'四个字算不算明显存疑」，
    #    才把它从副标题里拆出来做成独立胶囊。退回浅灰小字 = 回到被质疑的形态。
    fs = re.search(r'font-size\s*:\s*(\d+)rpx', body)
    fsz = int(fs.group(1)) if fs else 0
    check(g, '说明字号 ≥ 20rpx', fsz >= 20, '当前 %drpx：低于此审核员一瞥即判「不明显」' % fsz)

    tokens = _css_hex_map(os.path.join(MINI, 'app.wxss'))
    fg_m = re.search(r'(?<![-\w])color\s*:\s*([^;}]+)', body)
    bg_m = re.search(r'background(?:-color)?\s*:\s*([^;}]+)', body)
    fg = _resolve_paint(fg_m.group(1) if fg_m else '', tokens)
    bg = _resolve_paint(bg_m.group(1) if bg_m else '', tokens)
    check(g, '说明有视觉容器（底色或边框），与副标题可区分',
          bool(bg) or bool(re.search(r'border\s*:', body)),
          '既无底色也无边框 ⇒ 会与 .brand-sub 混成一行，「明显」不成立')

    if fg and bg:
        ratio = _contrast(fg, bg)
        check(g, '文字对比度 ≥ 4.5:1（%s on %s = %.2f）' % (fg, bg, ratio), ratio >= 4.5,
              '对比度 %.2f 过低 ⇒ 视觉上等同浅灰小字' % ratio)
    else:
        check(g, '文字色与底色可解析（供对比度校验）', False,
              '解析失败 fg=%s bg=%s —— 若改用新 var 令牌，确保 app.wxss 里有 #hex 定义' % (fg, bg))

    # ⑥ 不许回退到孤立橙：橙色在本系统是「撤回/待办」语义色（fill.wxss 15 处），
    #    拿它做中性的使用范围说明 = 把合规声明渲染成警告框（用户会以为页面出错）。
    orange = re.search(r'#c45500|#fff3e8|#ffd9b3', body, re.I)
    check(g, '未使用警示橙（#c45500/#fff3e8/#ffd9b3）', not orange,
          '橙色是「待办/撤回」语义色，用在说明上语义错位（v764 已改为品牌 tint）')


def self_test():
    """H 组坏样本自证（`--self-test`）。

    真源码 10/10 只能证明「通过」，不能证明「在检查」。本函数把三件文件复制到临时目录，
    注入 8 种错误写法，每种必须让**指定那条**断言变红；另设 1 组「原样不改」对照，
    证明副本机制本身没有把所有结果搞成全红（否则"全红"也能骗过自检）。
    """
    import shutil
    import tempfile

    global MINI, PAGES
    orig_mini, orig_pages = MINI, PAGES
    work = tempfile.mkdtemp(prefix='lc-hb-')
    try:
        os.makedirs(os.path.join(work, 'pages', 'login'))
        shutil.copy(os.path.join(MINI, 'app.wxss'), os.path.join(work, 'app.wxss'))
        for f in ('login.wxml', 'login.wxss'):
            shutil.copy(os.path.join(MINI, 'pages', 'login', f),
                        os.path.join(work, 'pages', 'login', f))
        MINI, PAGES = work, os.path.join(work, 'pages')

        wxml = os.path.join(work, 'pages', 'login', 'login.wxml')
        wxss = os.path.join(work, 'pages', 'login', 'login.wxss')
        orig = {p: read(p) for p in (wxml, wxss)}

        def restore():
            for p, s in orig.items():
                with open(p, 'w', encoding='utf-8') as fh:
                    fh.write(s)

        def patch(path, old, new):
            s = read(path)
            if old not in s:
                raise LookupError('锚点未命中，自检需要随样式更新：%r' % old[:48])
            with open(path, 'w', encoding='utf-8') as fh:
                fh.write(s.replace(old, new, 1))

        def run_h():
            del RESULTS[:]
            group_h()
            return {n: ok for _g, n, ok, _d in RESULTS}

        bad = []
        restore()
        base = run_h()
        if len(base) != 10 or any(not ok for ok in base.values()):
            bad.append('对照组异常：%d 项，红 %s' % (len(base), [n for n, o in base.items() if not o]))
        print('对照组（原样不改）  %d 项 / 红 %d  %s'
              % (len(base), sum(1 for o in base.values() if not o), 'OK' if not bad else 'FAIL'))

        # ⚠️ 锚点一律带上下文：login.wxss 里 `.brand-sub{font-size:24rpx;…}` 更靠前，
        #    只写 'font-size:24rpx' 会改到副标题上 ⇒ 坏样本改错对象 = 空白支票。
        cases = [
            ('删掉整行说明元素',
             lambda: patch(wxml, '<view class="scope-note">仅限本企业员工内部使用</view>', ''),
             '存在独立的「使用范围说明」元素'),
            ('文案弱化成「欢迎使用」',
             lambda: patch(wxml, '仅限本企业员工内部使用', '欢迎使用小赫智体'),
             '文案含范围限定词'),
            ('元素加 wx:if 条件',
             lambda: patch(wxml, '<view class="scope-note">', '<view wx:if="{{ready}}" class="scope-note">'),
             '不带 wx:if'),
            ('样式加 display:none',
             lambda: patch(wxss, '.scope-note{font-size:24rpx;', '.scope-note{display:none;font-size:24rpx;'),
             '未被样式隐藏'),
            ('文字改成最浅灰 #c7c7cc',
             lambda: patch(wxss, 'color:var(--brand-ink)', 'color:#c7c7cc'),
             '文字对比度 ≥ 4.5:1'),
            ('颜色回退到警示橙',
             lambda: patch(wxss,
                           'color:var(--brand-ink);background:var(--brand-bg);'
                           'border:1rpx solid var(--brand-border)',
                           'color:#c45500;background:#fff3e8;border:1rpx solid #ffd9b3'),
             '未使用警示橙'),
            ('字号降到 12rpx',
             lambda: patch(wxss, '.scope-note{font-size:24rpx', '.scope-note{font-size:12rpx'),
             '说明字号 ≥ 20rpx'),
            ('去掉底色与边框（只剩纯文字）',
             lambda: patch(wxss, 'background:var(--brand-bg);border:1rpx solid var(--brand-border);', ''),
             '说明有视觉容器'),
        ]

        for label, mutate, target in cases:
            restore()
            try:
                mutate()
            except LookupError as e:
                bad.append('%s：%s' % (label, e))
                print('坏样本 %-30s 锚点失效 <<<' % label)
                continue
            res = run_h()
            red = [n for n, ok in res.items() if not ok]
            hit = [n for n in red if target in n]
            print('坏样本 %-30s 红 %d 项  %s' % (label, len(red), 'OK' if hit else '未检出 <<<'))
            if not hit:
                bad.append('%s：期望含「%s」的断言变红，实际红=%s' % (label, target, red))

        restore()
        print('')
        if bad:
            print('SELF-TEST: FAIL')
            for b in bad:
                print('  - ' + b)
            return 1
        print('SELF-TEST: OK（对照全绿 + %d 个坏样本全部被检出）' % len(cases))
        return 0
    finally:
        MINI, PAGES = orig_mini, orig_pages


def main():
    for fn in (group_a, group_b, group_c, group_d, group_e, group_f, group_g, group_h):
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
    if '--self-test' in sys.argv:
        sys.exit(self_test())
    sys.exit(main())
