#!/usr/bin/env python3
"""btn-height-without-lineheight-scan.py — 普查小程序里「按钮文字会偏」的缺陷模式

缺陷模式（本次事故的成因，可复现的判据）：
    规则给 `<button>` 设了**显式 height**，却**既没设 line-height、也没设 flex 居中**
    ⇒ 该按钮沿用微信 button 组件内置的 `line-height:2.55555556`（无单位倍数，按自身
      font-size 计算），行高 ≠ 高度 ⇒ 文字垂直偏移 (height − line-height)/2。

    反例（都不算缺陷）：
      · 设了 `line-height` 且等于 height（本项目其它按钮的做法）
      · 设了 `display:flex` + `align-items:center`
      · 没设 height，靠**上下对称 padding** 撑高（内容盒 = 行盒 ⇒ 天然居中）

用法：python3 btn-height-without-lineheight-scan.py <miniprogram 根目录>
退出码：0 = 未发现缺陷；1 = 发现（会逐条列出，含页、文件、选择器、height）
"""
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'

BUTTON_RE = re.compile(r'<button\b[^>]*>', re.S)
CLASS_RE = re.compile(r'class\s*=\s*"([^"]*)"')
RULE_RE = re.compile(r'([^{}]+)\{([^{}]*)\}')


def button_classes(root):
    """→ {页面相对路径: {类名}}：只收「出现在 <button> 上」的类名。"""
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if not fn.endswith('.wxml'):
                continue
            p = os.path.join(dirpath, fn)
            m = CLASS_RE.findall(' '.join(BUTTON_RE.findall(open(p, encoding='utf-8').read())))
            cls = set()
            for group in m:
                cls.update(group.split())
            if cls:
                out[os.path.relpath(p, root)] = cls
    return out


def rules_of(wxss_path):
    """→ [(选择器, 声明块)]，跳过注释。"""
    txt = re.sub(r'/\*.*?\*/', '', open(wxss_path, encoding='utf-8').read(), flags=re.S)
    return [(s.strip(), b) for s, b in RULE_RE.findall(txt)]


def main():
    hits, checked = [], 0
    per_page = button_classes(ROOT)          # {wxml 相对路径: {该页 button 上的类名}}
    for wxml, cls in sorted(per_page.items()):
        wxss = os.path.splitext(os.path.join(ROOT, wxml))[0] + '.wxss'
        if not os.path.exists(wxss):
            print('  ℹ️ %s 无同名 wxss，跳过' % wxml)
            continue
        for sel, body in rules_of(wxss):
            if not (sel.startswith('.') or sel.startswith('button')):
                continue
            names = set(re.findall(r'\.([A-Za-z0-9_-]+)', sel))
            if not names or not (names & cls):
                continue
            d = dict((k.strip(), v.strip()) for k, v in
                     (part.split(':', 1) for part in body.split(';') if ':' in part))
            if 'height' not in d:
                continue
            checked += 1
            has_lh = 'line-height' in d
            is_flex = d.get('display') == 'flex' and 'center' in d.get('align-items', '')
            # line-height 与 height 数值是否相等（同单位才可比）
            lh_ok = False
            if has_lh:
                lh_ok = d['line-height'].replace(' ', '') == d['height'].replace(' ', '')
            if not lh_ok and not is_flex:
                hits.append((wxml, os.path.relpath(wxss, ROOT), sel,
                             d.get('height'), d.get('line-height', '(未设)'), d.get('padding', '(未设)')))
    print('扫描 %d 处「给 button 设了 height」的规则' % checked)
    if not hits:
        print('✅ 未发现「设了 height 却没设 line-height / flex 居中」的按钮')
        return 0
    print('❌ 发现 %d 处缺陷模式（文字会偏离中线 (height−line-height)/2）：' % len(hits))
    for wxml, wxss, sel, h, lh, pad in hits:
        print('   · %-34s %-16s height=%-8s line-height=%-9s padding=%s' % (wxml, sel, h, lh, pad))
    return 1


if __name__ == '__main__':
    sys.exit(main())
