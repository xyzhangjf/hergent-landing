#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v204 真机 E2E：多批导入「后一批直接覆盖整期顺序」。

在**隔离沙箱租户**上跑（脚本自带硬断言：租户号必须 >= 9997，绝不碰 tenant_1 / tenant_10）。

为什么必须走真机：离线脚本切片的是「源码文本 + 内存 SQLite」，它能证明算法对，
但证明不了「服务真的调到了这条路径、且读端真的按它返回」。这里全部走真实 HTTP：
  · POST /api/import/preview   （真解析）
  · POST /api/import/execute   （真落库）
  · GET  /api/forecast-submissions/summary?period_id=N
        ← 这就是**读端**，`imported_products` 数组的顺序即前端行底顺序的来源

三条断言轴（每批导入后都查）：
  A. 本批商品占据整期最前，且批内顺序 == 模板行序
  B. 其余商品**保持上一轮的相对顺序**接在其后
  C. sort_no 收敛成连续 1..M（无 0 / 无重号 / 无空洞）

用法：python3 v204-sandbox-order-e2e.py
"""
import json
import os
import subprocess
import sys

import openpyxl

BASE = 'https://hergent.cn'
TOK = os.environ.get('V204_TOK', '')
TENANT = int(os.environ.get('V204_TENANT', '9999'))
PERIOD = int(os.environ.get('V204_PERIOD', '14'))
OD = '2026-09-19'
TMP = '/tmp/v204-e2e'
os.makedirs(TMP, exist_ok=True)

assert TENANT >= 9997, '沙箱租户号必须 >= 9997（绝不碰生产租户）'
assert TOK, '需要 V204_TOK 环境变量（沙箱 token）'

# 期次 14 的**存量登记序**（= 生产上 sort_no 全 0 时的读端口径：按登记 r.id 升序）
# 取前 12 条真实商品，作为模板的素材。
POOL = [
    (1166, '6934665099984', '冠益乳大果粒水蜜桃草莓桑葚风味发酵乳利乐冠250g*24瓶', '250g*24瓶', '瓶'),
    (1168, '6923644200923', '蒙牛云上有机鲜牛奶', '12', '瓶'),
    (1189, '6934665099991', '冠益乳大果粒青提芦荟风味发酵乳利乐冠250g*24瓶', '250g*24瓶', '瓶'),
    (1190, '6978929200310', '冠益乳果蔬冠冠莲雾红甜菜树莓混合口味利乐冠200g×24瓶（零食）', '200g×24瓶（零食）', '瓶'),
    (1191, '6978929200303', '冠益乳果蔬冠冠紫甘蓝黑莓黑加仑混合口味利乐冠200g×24瓶（零食）', '200g×24瓶（零食）', '瓶'),
    (1201, '6970618572869', '简爱原味酸奶吸吸乐100g*40袋', '100g*40袋', '袋'),
    (1202, '6934665010323', '蒙牛优益C乳酸菌味活菌型乳酸菌风味饮品330ml*24瓶', '330ml*24瓶', '瓶'),
    (1205, '6970618570070', '简爱0%蔗糖原味135g*24杯', '135g*24杯', '杯'),
    (1208, '6934665099724', '蒙牛消健青柑柠檬风味爱克林180g×24袋', '180g×24袋', '袋'),
    (1209, '6934665099748', '蒙牛消健荔枝蜜瓜风味爱克林180g×24袋', '180g×24袋', '袋'),
    (1451, '6934665093555', '蒙牛阿慕乐黄桃味酸奶210g*12瓶', '210g*12瓶', '瓶'),
    (1227, '6970618570582', '父爱配方吸吸酸奶2%蔗糖（复合葡萄）100g*36袋', '100g*36袋', '袋'),
]
BY_ID = {p[0]: p for p in POOL}
HEAD = ['商品条码', '商品名称', '规格', '单位', '厂价', '品牌', '分销价', '东津']
MAP = json.dumps({'0': 'barcode', '1': 'name', '2': 'spec', '3': 'unit',
                  '4': 'factory', '5': 'brand', '6': 'dist', '7': 'customer'})

PASS, FAIL = [], []


def chk(cond, label, detail=''):
    (PASS if cond else FAIL).append(label)
    tail = ('   [' + str(detail) + ']') if (detail and not cond) else ''
    print(('  PASS  ' if cond else '  FAIL  ') + label + tail)


def build_template(path, pids):
    """按 pids 给定的顺序写一份模板（顺序 = 商品在文件里的物理行序）。"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(HEAD)
    for i, pid in enumerate(pids):
        _, bc, nm, spec, unit = BY_ID[pid]
        row = [None] * len(HEAD)
        row[0] = bc
        row[1] = nm
        row[2] = spec
        row[3] = unit
        row[4] = 5.0            # 厂价（条件必填）
        row[5] = '蒙牛'
        row[6] = 6.0
        row[7] = i + 1          # 报单量（只为让行看起来正常，登记不依赖它）
        ws.append(row)
        ws.cell(row=i + 2, column=1).number_format = '@'   # 条码文本，防科学计数法
    wb.save(path)
    return path


def curl(args, expect_json=True):
    r = subprocess.run(['curl', '-s', '--noproxy', '*', '-m', '120'] + args,
                       capture_output=True, text=True)
    if r.returncode != 0:
        return {'_curl_rc': r.returncode, '_stderr': r.stderr}
    if not expect_json:
        return {'_raw': r.stdout}
    try:
        return json.loads(r.stdout)
    except Exception:
        return {'_raw': r.stdout[:800]}


def api_get(path):
    return curl(['-H', 'Authorization: Bearer ' + TOK, '-H', 'X-Tenant-Id: %d' % TENANT,
                 BASE + path])


def do_import(path):
    """preview → execute，返回 execute 的回执。"""
    pv = curl(['-H', 'Authorization: Bearer ' + TOK, '-H', 'X-Tenant-Id: %d' % TENANT,
               '-F', 'file=@' + path, '-F', 'category=forecast_cross',
               BASE + '/api/import/preview'])
    if not isinstance(pv, dict) or pv.get('_raw') or pv.get('_curl_rc'):
        return {'_preview_failed': pv}
    ex = curl(['-H', 'Authorization: Bearer ' + TOK, '-H', 'X-Tenant-Id: %d' % TENANT,
               '-F', 'file=@' + path, '-F', 'category=forecast_cross',
               '-F', 'mapping=' + MAP, '-F', 'order_date=' + OD,
               BASE + '/api/import/execute'])
    return ex


def read_order():
    """读端：summary 的 imported_products，顺序即页面行底顺序。"""
    r = api_get('/api/forecast-submissions/summary?period_id=%d' % PERIOD)
    if not isinstance(r, dict) or 'imported_products' not in r:
        raise SystemExit('读端异常：%s' % json.dumps(r, ensure_ascii=False)[:600])
    return [(int(x['id']), int(x.get('sort_no') or 0)) for x in r['imported_products']]


def seq(lst):
    return [p for p, _ in lst]


print('═' * 74)
print('v204 真机 E2E：后一批覆盖整期顺序   （沙箱 tenant_%d / 期次 %d）' % (TENANT, PERIOD))
print('═' * 74)

# ── 基线：导入前的存量顺序（应为登记 r.id 升序，sort_no 全 0）───────────────
base = read_order()
chk(len(base) >= 154, 'P1 基线：读端返回 ≥154 行', len(base))
chk(all(sn == 0 for _, sn in base), 'P2 基线：存量行 sort_no 全为 0（v202 之前导入的）',
    sorted({sn for _, sn in base})[:6])
BASE_SEQ = seq(base)
chk(BASE_SEQ[:5] == [1166, 1168, 1189, 1190, 1191],
    'P3 基线：存量顺序 == 登记插入序（→ 老期次「不用重导也能改善」的前提）', BASE_SEQ[:5])

# ── 批 1：6 个商品，模板序 = 存量序的**倒序**（确保「发生了变化」可被判出）──
B1 = [1209, 1205, 1202, 1201, 1191, 1166]
f1 = build_template(TMP + '/b1.xlsx', B1)
r1 = do_import(f1)
chk(isinstance(r1, dict) and r1.get('success') is not None,
    'P4 批 1：execute 返回结构正常', json.dumps(r1, ensure_ascii=False)[:300])
o1 = read_order()
chk(seq(o1)[:6] == B1, 'P5 批 1：本批 6 个占据整期最前，且顺序 == 模板行序', seq(o1)[:6])
rest1 = [p for p in BASE_SEQ if p not in set(B1)]
chk(seq(o1)[6:] == rest1, 'P6 批 1：其余 148 个保持原相对顺序接在 7..154', seq(o1)[6:11])
chk(sorted(sn for _, sn in o1) == list(range(1, len(o1) + 1)),
    'P7 批 1：整期 sort_no 收敛为连续 1..M（无 0 / 无重号 / 无空洞）',
    'min=%d max=%d n=%d' % (min(s for _, s in o1), max(s for _, s in o1), len(o1)))
chk(0 not in [sn for _, sn in o1], 'P8 批 1：存量行不再停留在 sort_no=0（tier1 消失）')

# ── 批 2：只补 3 个**不在批 1 里**的商品 ⇒ 覆盖式：这 3 个成为 1..3 ────────
B2 = [1227, 1189, 1168]
f2 = build_template(TMP + '/b2.xlsx', B2)
r2 = do_import(f2)
o2 = read_order()
chk(seq(o2)[:3] == B2, 'P9 批 2（补录型）：本批 3 个覆盖为整期 1..3（不是接在末尾）', seq(o2)[:3])
prev2 = seq(o1)
rest2 = [p for p in prev2 if p not in set(B2)]
chk(seq(o2)[3:] == rest2, 'P10 批 2：其余 151 个保持批 1 之后的相对顺序', seq(o2)[3:8])
chk(sorted(sn for _, sn in o2) == list(range(1, len(o2) + 1)),
    'P11 批 2：sort_no 仍为连续 1..M', 'n=%d' % len(o2))
chk(max(s for p, s in o2 if p in set(B2)) < min(s for p, s in o2 if p not in set(B2)),
    'P12 批 2：不变量 —— 任何本批商品都排在任何非本批商品之前')

# ── 批 3：与批 1 同一批商品、模板序**倒过来** ⇒ 整期跟着倒 ────────────────
B3 = list(reversed(B1))
f3 = build_template(TMP + '/b3.xlsx', B3)
r3 = do_import(f3)
o3 = read_order()
chk(seq(o3)[:6] == B3, 'P13 批 3：同一批商品、模板行序倒置 ⇒ 整期最前 6 位跟着倒', seq(o3)[:6])
chk(seq(o3)[0] != seq(o2)[0], 'P14 批 3：新首行 ≠ 批 2 首行（顺序确实被后一批改写了）',
    '%s → %s' % (seq(o2)[0], seq(o3)[0]))
rest3 = [p for p in seq(o2) if p not in set(B3)]
chk(seq(o3)[6:] == rest3, 'P15 批 3：其余商品仍保持相对顺序')

# ── 幂等：同一份模板再导一次，顺序不得漂移 ───────────────────────────────
r4 = do_import(f3)
o4 = read_order()
chk(o4 == o3, 'P16 幂等：同一模板重导 ⇒ 读端顺序与 sort_no 逐行不变')
chk(sorted(sn for _, sn in o4) == list(range(1, len(o4) + 1)),
    'P17 幂等：重导不做累加（sort_no 未被推到 100001+ 一类区间）',
    'max=%d' % max(s for _, s in o4))

# ── 收尾：回执里没有「登记失败」类硬错误 ─────────────────────────────────
for tag, rr in (('批1', r1), ('批2', r2), ('批3', r3)):
    errs = (rr or {}).get('errors') or []
    chk(not [e for e in errs if 'readonly' in str(e) or 'locked' in str(e)],
        'P18 %s：回执无 readonly / locked 类基础设施错误' % tag, errs[:2])

print('\n' + '═' * 74)
print('结果：PASS %d / FAIL %d   （共 %d 项）' % (len(PASS), len(FAIL), len(PASS) + len(FAIL)))
if FAIL:
    print('\n失败项：')
    for f in FAIL:
        print('  · ' + f)
print('═' * 74)
sys.exit(1 if FAIL else 0)
