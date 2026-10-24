#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
列设置与序号组件 · 全站合规排查工具（UI-SPEC §2.6.1 的可执行判据）
=====================================================================
用法：
    python3 tests/spec/seq-colcfg-audit.py            # 人读表格
    python3 tests/spec/seq-colcfg-audit.py --json     # 机器读

设计纪律（踩过的坑，别踩第二次）：
  1. 扫模板 / 扫样式前**先剥注释** —— HTML 注释、CSS 注释、JS 行注释里出现
     `col-cfg` / `.seq-th` 全是噪声（历史教训：契约测试把注释里的文案当实现，误报）。
     剥注释时用「等长空白替换」而不是删除，保证**行号仍对得上源码**。
  2. 「搜不到」不等于「没有」：本机 shell 里 grep 的多模式写法 `A\|B` 会静默失效
     （返回空却 exit 1，看着像"没有匹配"）。本脚本统一用 Python `re`，无此坑。
  3. 本工具只**报事实**（每条带文件:行号 + 实测片段），不做主观判定；
     是否违规由规范文档 §2.6.1「七、判定标准」逐条对照。
"""
import os
import re
import sys
import json
import argparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SRC = os.path.join(ROOT, 'src')
STYLES = os.path.join(SRC, 'styles')

# ── 注释剥离（等长替换，保行号） ────────────────────────────────
def blank(m):
    # 保留换行，其余换成空格
    return re.sub(r'[^\n]', ' ', m.group(0))

def strip_comments(text):
    """按 <template> / <style> / <script> 分段剥离各自注释。"""
    out = text
    # HTML 注释（可能跨行）
    out = re.sub(r'<!--[\s\S]*?-->', blank, out)
    # CSS / JS 块注释
    out = re.sub(r'/\*[\s\S]*?\*/', blank, out)
    # JS 行注释（避开 URL 里的 //）
    out = re.sub(r'(?<![:\w])//[^\n]*', blank, out)
    return out

# ── 收集文件 ────────────────────────────────────────────────────
def vue_files():
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'dist', '.git')]
        for fn in filenames:
            if fn.endswith('.vue') or fn.endswith('.js'):
                yield os.path.join(dirpath, fn)

def rel(p):
    return os.path.relpath(p, ROOT)

def lineno_of(text, idx):
    return text.count('\n', 0, idx) + 1

# ── 检测项 ──────────────────────────────────────────────────────
GEAR_RE = re.compile(r'<button[^>]*class="[^"]*\bcol-cfg\b[^"]*"[^>]*>[\s\S]{0,240}?</button>')
GEAR_OPEN_RE = re.compile(r'<button[^>]*class="[^"]*\bcol-cfg\b[^"]*"[^>]*>')
EMOJI_GEAR = '\u2699'          # ⚙
EMOJI_GEAR_VS = '\uFE0F'       # 变体选择符

SEQ_TH_RE = re.compile(r'<th[^>]*class="[^"]*\bseq-th\b[^"]*"[^>]*>')
SEQ_CELL_RE = re.compile(r'<td[^>]*class="[^"]*\bseq-cell\b[^"]*"[^>]*>')
SEQ_NUM_RE = re.compile(r'\bseq-num\b')
SEQ_HOST_RE = re.compile(r'class="[^"]*\bseq-host\b')
TBL_CLASS_RE = re.compile(r'<table[^>]*class="([^"]*)"')
# 私有序号样式（页面 / 组件私有 CSS 里出现 .seq-th/.seq-cell/.seq-num 选择器）
PRIV_SEQ_CSS_RE = re.compile(r'(^|[\s,{}])\.seq-(th|cell|num)\b')
PRIV_SEQ_RULE_RE = re.compile(r'[^\n{}]*\.seq-(?:th|cell|num)\b[^\n{}]*\{[^\n{}]*\}', re.M)
# 序号取值表达式：td.seq-cell / span.seq-num 内的 {{ }}
SEQ_EXPR_RE = re.compile(r'<td[^>]*\bseq-cell\b[^>]*>([\s\S]{0,220}?)</td>', re.M)
MUSTACHE_RE = re.compile(r'\{\{([\s\S]{0,120}?)\}\}')
# 分页补偿特征
PAGE_AWARE_RE = re.compile(r'offset|\bpage\b|pageSize|currentPage|\bpg\b')
# 列菜单实现
COL_PANEL_RE = re.compile(r'<ColMenuPanel|ColMenuPanel\.vue')
COL_MENU_RE = re.compile(r'class="[^"]*\bcol-menu\b')
CLICK_PREVENT_RE = re.compile(r'@click\.prevent\s*=\s*"[^"]*(?:toggleCol|toggle|openCol)[^"]*"')
CHANGE_RE = re.compile(r'@change\s*=\s*"[^"]*"')
CHECKBOX_RE = re.compile(r'<input[^>]*type="checkbox"[^>]*>')
WRITE_BACK_RE = re.compile(r'\.checked\s*=')

def style_block(text):
    m = re.search(r'<style[^>]*>([\s\S]*?)</style>', text)
    return m.group(1) if m else ''

def template_block(text):
    m = re.search(r'<template>([\s\S]*?)</template>', text)
    return m.group(1) if m else ''

def script_block(text):
    m = re.search(r'<script[^>]*>([\s\S]*?)</script>', text)
    return m.group(1) if m else ''

def audit_file(path):
    raw = open(path, encoding='utf-8', errors='replace').read()
    code = strip_comments(raw)
    rec = {
        'file': rel(path),
        'gears': [],            # 齿轮实例
        'emoji_gear': [],       # emoji 齿轮（违规）
        'seq_th': 0, 'seq_cell': 0, 'seq_num': 0,
        'seq_exprs': [],        # 序号取值表达式
        'tables': [],           # (class串, 是否 seq-host, 是否 tbl)
        'priv_seq_css': [],     # 私有序号样式
        'col_menu': [],         # 列菜单实例
        'col_panel_use': [],    # 用共享 ColMenuPanel
        'click_prevent': [],    # @click.prevent=toggleCol（v669 已禁）
        'checkboxes': [],       # 清单里复选框
        'change_handlers': [],  # @change
        'write_back': [],       # nextTick 回写 el.checked
    }
    # 齿轮
    for m in GEAR_RE.finditer(code):
        rec['gears'].append({'line': lineno_of(code, m.start()), 'html': ' '.join(m.group(0).split())})
    for i, line in enumerate(code.split('\n'), 1):
        if EMOJI_GEAR in line:
            rec['emoji_gear'].append({'line': i, 'txt': line.strip()[:120]})
    # 序号三件套
    rec['seq_th'] = len(SEQ_TH_RE.findall(code))
    rec['seq_cell'] = len(SEQ_CELL_RE.findall(code))
    rec['seq_num'] = len(SEQ_NUM_RE.findall(code))
    # 表类 —— 🔴 只取「确实含序号格的那张表」：
    # 一个页面里常有多张表（阶梯表 / 说明表 / 弹窗表），若把文件内所有 <table> 都报出来，
    # 会得到一屏噪声、真正漏 `seq-host` 的那张反被淹掉（与「扫模板别扫全文」同族）。
    # 做法：从每个 seq-th / seq-cell 的位置**向上**找最近的 `<table` 开标签。
    for m in list(SEQ_TH_RE.finditer(code)) + list(SEQ_CELL_RE.finditer(code)):
        tpos = code.rfind('<table', 0, m.start())
        if tpos < 0:
            continue
        tseg = code[tpos:tpos + 300]
        cm = re.search(r'<table[^>]*class="([^"]*)"', tseg)
        cls = cm.group(1) if cm else ''
        # 动态 class（:class / v-bind）单独标出来，不做判定
        dynamic = bool(re.search(r':class|v-bind:class', tseg[: tseg.find('>') + 1])) if '>' in tseg else False
        rec['tables'].append({
            'line': lineno_of(code, tpos), 'class': cls,
            'tbl': bool(re.search(r'\btbl\b', cls)),
            'seq_host': bool(re.search(r'\bseq-host\b', cls)),
            'dynamic': dynamic,
        })
    # 序号取值
    for m in SEQ_EXPR_RE.finditer(code):
        inner = m.group(1)
        for mm in MUSTACHE_RE.finditer(inner):
            expr = ' '.join(mm.group(1).split())
            if re.search(r'\bseq\b|\bi\b|\bri\b|\bindex\b|\bidx\b|\+ 1|\+1', expr):
                rec['seq_exprs'].append({
                    'line': lineno_of(code, m.start() + mm.start()),
                    'expr': expr,
                    'page_aware': bool(PAGE_AWARE_RE.search(expr)),
                })
    # 私有序号 CSS（只看 <style> 段，且排除注释已剥）
    st = style_block(code)
    for m in PRIV_SEQ_RULE_RE.finditer(st):
        # 行号要映射回全文：<style> 起点 + style 内偏移
        sidx = code.find(st)
        rec['priv_seq_css'].append({
            'line': lineno_of(code, sidx + m.start()) if sidx >= 0 else -1,
            'rule': ' '.join(m.group(0).split()),
        })
    # 列菜单
    for m in COL_MENU_RE.finditer(code):
        rec['col_menu'].append({'line': lineno_of(code, m.start())})
    for m in COL_PANEL_RE.finditer(code):
        rec['col_panel_use'].append({'line': lineno_of(code, m.start())})
    for m in CLICK_PREVENT_RE.finditer(code):
        rec['click_prevent'].append({'line': lineno_of(code, m.start()), 'txt': ' '.join(m.group(0).split())})
    for m in CHANGE_RE.finditer(code):
        rec['change_handlers'].append({'line': lineno_of(code, m.start()), 'txt': ' '.join(m.group(0).split())})
    for m in CHECKBOX_RE.finditer(code):
        rec['checkboxes'].append({'line': lineno_of(code, m.start()), 'txt': ' '.join(m.group(0).split())})
    for m in WRITE_BACK_RE.finditer(code):
        rec['write_back'].append({'line': lineno_of(code, m.start()), 'txt': ' '.join(
            code[max(0, m.start() - 60):m.end() + 20].split())})
    return rec

def has_any(rec):
    return any([rec['gears'], rec['emoji_gear'], rec['seq_th'], rec['seq_cell'], rec['seq_num'],
                rec['priv_seq_css'], rec['col_menu'], rec['col_panel_use'], rec['click_prevent']])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    recs = []
    for p in sorted(vue_files()):
        r = audit_file(p)
        if has_any(r):
            recs.append(r)
    if args.json:
        print(json.dumps(recs, ensure_ascii=False, indent=1))
        return
    print('=' * 78)
    print('列设置与序号组件 · 全站排查（UI-SPEC §2.6.1）')
    print('=' * 78)
    # 1) 齿轮
    print('\n【1】齿轮实例（col-cfg）共 %d 处' % sum(len(r['gears']) for r in recs))
    for r in recs:
        for g in r['gears']:
            icon = re.search(r'<Icon[^>]*>', g['html'])
            icon = ' '.join(icon.group(0).split()) if icon else '(无Icon)'
            host = 'seq-th' if SEQ_TH_RE.search(g['html']) else '?'
            print('  %-46s L%-5d %s' % (r['file'], g['line'], icon))
    # 2) emoji 齿轮
    tot = sum(len(r['emoji_gear']) for r in recs)
    print('\n【2】emoji 齿轮（⛔ 规范禁止）共 %d 处' % tot)
    for r in recs:
        for e in r['emoji_gear']:
            print('  ❌ %-44s L%-5d %s' % (r['file'], e['line'], e['txt']))
    # 3) 序号三件套
    print('\n【3】序号列三件套（seq-th / seq-cell / seq-num）')
    for r in recs:
        if r['seq_th'] or r['seq_cell'] or r['seq_num']:
            flag = ''
            if r['seq_th'] and not r['seq_cell']: flag = ' ❌ 缺 seq-cell'
            if r['seq_cell'] and not r['seq_th']: flag = ' ❌ 缺 seq-th'
            if r['seq_cell'] and not r['seq_num']: flag += ' ❌ 缺 seq-num'
            print('  %-46s th=%-3d cell=%-3d num=%-3d%s' % (
                r['file'], r['seq_th'], r['seq_cell'], r['seq_num'], flag))
    # 4) 表类：非 tbl 且未加 seq-host
    print('\n【4】表类归属（含序号格的表：非 tbl 必须带 seq-host / 动态 class 需人工看）')
    seen = set()
    for r in recs:
        for t in r['tables']:
            key = (r['file'], t['line'])
            if key in seen:
                continue
            seen.add(key)
            if t['tbl'] or t['seq_host']:
                continue
            why = 'class 是动态绑定' if t['dynamic'] else '既无 tbl 也无 seq-host'
            print('  ❌ %-44s L%-5d class="%s"  ← %s' % (r['file'], t['line'], t['class'][:40], why))
    # 5) 序号取值 + 分页
    print('\n【5】序号取值（分页表必须跨页连续）')
    for r in recs:
        for e in r['seq_exprs']:
            mark = '' if e['page_aware'] else '  ⚠ 未见 offset/page 补偿'
            print('  %-46s L%-5d %-42s%s' % (r['file'], e['line'], e['expr'][:42], mark))
    # 6) 私有序号 CSS
    print('\n【6】页面/组件私有 .seq-* 样式（规范：序号 CSS 只此一份）')
    for r in recs:
        for c in r['priv_seq_css']:
            print('  %-46s L%-5d %s' % (r['file'], c['line'], c['rule'][:90]))
    # 7) 列菜单 / 面板
    print('\n【7】列菜单实现方式')
    for r in recs:
        if r['col_panel_use']:
            print('  ✅ 共享 ColMenuPanel  %-40s L%d' % (r['file'], r['col_panel_use'][0]['line']))
        elif r['col_menu']:
            print('  ⚠ 自写 .col-menu      %-40s L%d' % (r['file'], r['col_menu'][0]['line']))
    # 8) 复选框写法
    print('\n【8】列清单复选框写法（v669：禁 @click.prevent，须 @change + 回写）')
    for r in recs:
        for c in r['click_prevent']:
            print('  ❌ @click.prevent  %-40s L%-5d %s' % (r['file'], c['line'], c['txt'][:60]))
        if r['col_panel_use'] or r['col_menu']:
            ch = [c for c in r['change_handlers'] if re.search(r'Col|col', c['txt'])]
            wb = len(r['write_back'])
            print('     %-43s @change(Col)=%d  checked回写=%d' % (r['file'], len(ch), wb))

if __name__ == '__main__':
    main()
