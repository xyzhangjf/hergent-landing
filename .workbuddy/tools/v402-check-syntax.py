#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v402 语法校验：抽出每个改动 .vue 的 <script setup> 段 → node --check。
输出目录放在 .workbuddy/tools/.v402-check/（不放 /tmp —— 本机坑）。"""
import io, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
PAGES = os.path.join(ROOT, 'hergent-cn-v2', 'src', 'pages')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.v402-check')
NODE = '/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node'

FILES = [
 'BidRadar.vue','BrandArchive.vue','CronJobs.vue','CustomerArchive.vue','EmployeeArchive.vue',
 'ForecastHistory.vue','LossAccounting.vue','LossWorkflow.vue','PayrollWorkflow.vue',
 'PriceChannels.vue','ProductArchive.vue','ProductTarget.vue','Rebate.vue','ReportMapping.vue',
 'SupplierArchive.vue','WarehouseArchive.vue',
 'inventory/InvPurchaseDetail.vue','inventory/InvPurchaseNew.vue','inventory/InvSaleDetail.vue',
 'inventory/InvSaleNew.vue','inventory/InvStock.vue',
]

os.makedirs(OUT, exist_ok=True)
bad = 0
for rel in FILES:
    src = io.open(os.path.join(PAGES, rel), encoding='utf-8').read()
    m = re.search(r'<script setup[^>]*>(.*?)</script>', src, re.S)
    if not m:
        print('SKIP %-40s （无 <script setup>）' % rel)
        continue
    js = m.group(1)
    flat = rel.replace('/', '__') + '.mjs'
    path = os.path.join(OUT, flat)
    io.open(path, 'w', encoding='utf-8').write(js)
    r = subprocess.run([NODE, '--check', path], capture_output=True, text=True)
    if r.returncode == 0:
        print('OK   %-40s (%d chars)' % (rel, len(js)))
    else:
        bad += 1
        print('BAD  %-40s\n%s' % (rel, r.stderr.strip()[:400]))
print('\n语法校验：%d 文件，失败 %d' % (len(FILES), bad))
sys.exit(1 if bad else 0)
