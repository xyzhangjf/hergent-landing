#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v402 侦察：扫描 hergent-cn-v2 所有页面的 <table>，提取 class / 列数 / 表头文本 /
是否已有序号列 / 是否已有齿轮，用于按 UI-SPEC §2.6.1 判据决定各页接入什么。

只读。放在 .workbuddy/tools/（不放 /tmp —— 本机坑 §..「探针别放 /tmp」）。
"""
import io, os, re, json, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'hergent-cn-v2', 'src', 'pages')

def find_tables(src):
    """返回 [(行号, class串, 表头th文本列表, 是否含 v-for 行)]"""
    out = []
    for m in re.finditer(r'<table\b([^>]*)>', src):
        attrs = m.group(1)
        line = src[:m.start()].count('\n') + 1
        cm = re.search(r'class="([^"]*)"', attrs)
        cls = cm.group(1) if cm else ''
        # 向后找该 table 的第一个 </table>，截出片段
        end = src.find('</table>', m.end())
        seg = src[m.end(): end if end > 0 else m.end() + 4000]
        # 取 thead 里的 th（含 v-for 生成的）
        thead_m = re.search(r'<thead\b.*?</thead>', seg, re.S)
        head_seg = thead_m.group(0) if thead_m else seg[:1500]
        ths = re.findall(r'<th\b[^>]*>(.*?)</th>', head_seg, re.S)
        # 清洗文本
        clean = []
        for t in ths:
            t = re.sub(r'<[^>]+>', '', t)
            t = re.sub(r'\{\{[^}]*\}\}', '{{}}', t)
            t = re.sub(r'\s+', ' ', t).strip()
            clean.append(t)
        has_vfor = bool(re.search(r'<tr[^>]*v-for', seg))
        out.append((line, cls, clean, has_vfor))
    return out

def main():
    rows = []
    for dirpath, _, files in os.walk(ROOT):
        for f in sorted(files):
            if not f.endswith('.vue'):
                continue
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, os.path.join(ROOT, '..', '..'))
            src = io.open(p, encoding='utf-8').read()
            for (line, cls, ths, vfor) in find_tables(src):
                rows.append({
                    'file': rel,
                    'line': line,
                    'cls': cls,
                    'ncol': len(ths),
                    'head': ' | '.join(ths)[:150],
                    'has_seq': ('序号' in ''.join(ths)),
                    'vfor': vfor,
                })
    # 输出
    print('共 %d 张表\n' % len(rows))
    cur = None
    for r in rows:
        if r['file'] != cur:
            cur = r['file']
            print('\n=== %s ===' % cur)
        flag = []
        if r['has_seq']: flag.append('已有序号')
        if not r['vfor']: flag.append('无v-for行')
        print('  L%-5d [%-18s] %2d列 %s' % (r['line'], r['cls'][:18], r['ncol'],
              (' <' + ','.join(flag) + '>') if flag else ''))
        print('           %s' % r['head'])

if __name__ == '__main__':
    main()
