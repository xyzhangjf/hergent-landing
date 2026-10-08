#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v402 侦察②：对每个目标列表页的 <table>，提取「v-for 变量 / 分页标识符 / colspan 值」，
用来决定序号列取值（i+1 / offset+i+1 / (page-1)*pageSize+i+1）。只读。"""
import io, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'hergent-cn-v2', 'src', 'pages')

# (相对路径, 表所在行)
TARGETS = [
    ('BrandArchive.vue', 24),
    ('CustomerArchive.vue', 44),
    ('EmployeeArchive.vue', 37),
    ('EmployeeArchive.vue', 81),
    ('ForecastHistory.vue', 19),
    ('LossWorkflow.vue', 145),
    ('PayrollWorkflow.vue', 140),
    ('ProductArchive.vue', 46),
    ('Rebate.vue', 276),
    ('Rebate.vue', 354),
    ('Rebate.vue', 425),
    ('Rebate.vue', 713),
    ('Rebate.vue', 985),
    ('ReportMapping.vue', 142),
    ('SupplierArchive.vue', 37),
    ('WarehouseArchive.vue', 28),
    ('inventory/InvStock.vue', 65),
    ('CronJobs.vue', 56),
    ('PriceChannels.vue', 112),
    ('ProductTarget.vue', 81),
    ('BidRadar.vue', 101),
    ('LossAccounting.vue', 70),
    ('Workbench.vue', 89),
    ('Workbench.vue', 121),
    ('Workbench.vue', 188),
]

for rel, line in TARGETS:
    p = os.path.join(ROOT, rel)
    src = io.open(p, encoding='utf-8').read()
    lines = src.split('\n')
    # 从该行起找 </table>
    seg_lines = []
    for i in range(line - 1, min(len(lines), line + 400)):
        seg_lines.append(lines[i])
        if '</table>' in lines[i]:
            break
    seg = '\n'.join(seg_lines)
    vfors = re.findall(r'<tr[^>]*v-for="([^"]*)"', seg)
    cols = re.findall(r'colspan="([^"]*)"', seg)
    # 分页标识符（全文件层面看该页用的分页变量）
    whole = src
    paging = [v for v in ['offset', 'pageSize', 'currentPage', 'const page', 'page =', 'paginate', 'slice(']
              if v in whole]
    print('=== %s : L%d ===' % (rel, line))
    print('  v-for     :', vfors[:3])
    print('  colspan   :', sorted(set(cols)))
    print('  本文件分页 :', paging)
    # 表头首 th 与表体首 td 的原样文本（各 1 行）
    m = re.search(r'<thead[^>]*>(.*?)</thead>', seg, re.S)
    if m:
        th = re.search(r'<th\b[^>]*>', m.group(1))
        print('  首 th 标签:', th.group(0) if th else '(none)')
    print()
