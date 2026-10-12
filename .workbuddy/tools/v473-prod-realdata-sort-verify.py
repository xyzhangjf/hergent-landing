#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v473 生产**真实数据**（22505 行）排序验证 —— 只读（`mode=ro`，只 SELECT）。

## 为什么还要这一支
本地那支（`v473-so-order-sort-probe.py`）跑在**本地开发库副本**上（8 行 + 自造 300 行），
并且自己诚实标注了「F.3 本地未复现 tiebreaker 的必要性」。
而 tiebreaker 的风险恰恰在**大规模同值**上 —— 生产 `sale_orders` **22505 行**、
`status` **全部是 `signed`**（同一个值）⇒ 这才是同值分页的**最坏情况**，必须在这上面验。

## 判据
  ① 25 键 × ASC/DESC 在生产 schema 上都可执行（错 = 生产缺列 ⇒ 线上 500）
  ② ASC 与 DESC 的首页 id 序列必须不同（**全同值列除外**，会显式标 `全同值=True`）
  ③ 反例 `so.this_col_does_not_exist` **必须抛错** ⇒ 否则本探针没有判别力
  ④ 前端 `SORT_KEY` 的 7 个后端键全部在白名单里（少一个 = 点了没反应、零报错）
  ⑤ tiebreaker：全同值列上 `LIMIT/OFFSET` 分页逐页拼接 == 全集（**无重无漏**）
     + 反例对照：去掉 `, so.id DESC` 的写法对比（判别力自证）

## ⚠️ 白名单取自**本地**源码
生产还没部署 v473 ⇒ 生产 `sales.py` 里**取不到** `_SO_ORDER_SQL`（已核实：grep 计数 0）。
所以这份白名单是**本地源码**抽出来、用**生产数据**去跑的 —— 两者各自的权威性互补，
但**不等于**"生产已具备该能力"。这一条必须写清楚，否则取证就成了自欺。

## 用法（不在生产留任何文件）
  python3 .workbuddy/tools/v473-prod-realdata-sort-verify.py
"""
import ast
import json
import subprocess
import sys
from pathlib import Path

LOCAL_SALES = Path('/Users/zhangjunfeng/Documents/hergent-erp/server/db/queries/sales.py')
HOST = 'root@47.113.224.140'
REMOTE_DB = '/opt/hergent-erp/tenant_1.db'

tree = ast.parse(LOCAL_SALES.read_text(encoding='utf-8'))
wl = None
for node in tree.body:
    if isinstance(node, ast.Assign) and any(
            getattr(t, 'id', None) == '_SO_ORDER_SQL' for t in node.targets):
        wl = ast.literal_eval(node.value)
        break
if not wl:
    print('🔴 本地源码里找不到 `_SO_ORDER_SQL`')
    sys.exit(1)
print(f'本地白名单键数 = {len(wl)}（取自 {LOCAL_SALES}）')
print(f'目标             = {HOST}:{REMOTE_DB}（只读）\n')

REMOTE = '''
# -*- coding: utf-8 -*-
import sqlite3
import json

WL = __WL__
DB = __DB__
FE_KEYS = ['order_no', 'customer', 'total_amount', 'status', 'order_type', 'order_date', 'delivery_date']

c = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
SEL = ("SELECT so.*, c.name AS customer_name FROM sale_orders so "
       "LEFT JOIN contacts c ON so.customer_id = c.id")

TOTAL = c.execute('SELECT COUNT(*) FROM sale_orders').fetchone()[0]
print('生产 sale_orders 行数 =', TOTAL)
print('sale_orders 索引 =', [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sale_orders'").fetchall()])
print()

BAD = []
print('── ① 逐键 ASC/DESC 合法性 + ② 顺序翻转 ─────────────────────────')
for k in sorted(WL):
    expr = WL[k]
    seq = {}
    for d in ('ASC', 'DESC'):
        try:
            rows = c.execute(SEL + ' ORDER BY ' + expr + ' ' + d + ', so.id DESC LIMIT 5').fetchall()
            seq[d] = [r[0] for r in rows]
        except Exception as e:
            BAD.append('%s %s: %s' % (k, d, e))
            seq[d] = None
    same = seq['ASC'] == seq['DESC']
    allsame = None
    why = ''
    if same:
        try:
            # 🔴 必须给 `sale_orders` 起别名 `so`：白名单表达式一律写成 `so.xxx`
            #    （如 `so.status`），`FROM sale_orders` 没有别名会直接
            #    `no such column: so.status` —— 异常被吞掉 ⇒ `allsame=None` ⇒
            #    所有键都被误判成"排序没生效"（本轮踩过：13 个键全红，全是这个原因）。
            nd = c.execute('SELECT COUNT(DISTINCT ' + expr + ') FROM sale_orders so').fetchone()[0]
            nn = c.execute('SELECT COUNT(' + expr + ') FROM sale_orders so').fetchone()[0]
            # ⚠️ 全 NULL 列 `COUNT(DISTINCT x)` 返回 **0**（SQLite 不数 NULL），
            #    所以判据是 `<= 1`：0 = 全 NULL，1 = 全同值，两者 ASC/DESC 相等都是**预期**。
            allsame = nd <= 1
            why = '全NULL' if nn == 0 else ('全同值(%d 个不同值)' % nd)
        except Exception as e:
            allsame = None
            why = 'distinct 查询失败: %s' % str(e)[:40]
    flag = ''
    if seq['ASC'] is None or seq['DESC'] is None:
        flag = '  🔴SQL失败'
    elif same and allsame:
        flag = '  ⚪%s（ASC=DESC 属预期，顺序由 tiebreaker 决定）' % why
    elif same:
        flag = '  🔴ASC=DESC 但列非同值 ⇒ 排序未生效?'
        BAD.append('%s: ASC 与 DESC 相同但列并非全同值' % k)
    elif allsame is False and why:
        flag = '  ✅（%s）' % why
    print('  %-18s ASC=%-18s DESC=%-18s%s' % (k, seq['ASC'], seq['DESC'], flag))
print()

print('── ③ 反例（判别力自证）───────────────────────────────────────')
try:
    c.execute(SEL + ' ORDER BY so.this_col_does_not_exist ASC LIMIT 1')
    print('  🔴 坏列居然没抛错 ⇒ 本探针没有判别力')
    BAD.append('反例未抛错 ⇒ 探针无判别力')
except Exception as e:
    print('  ✅ 坏列抛错：', str(e)[:70])
print()

print('── ④ 前端 SORT_KEY 的 7 个键都在白名单里 ─────────────────────')
miss = [k for k in FE_KEYS if k not in WL]
print('  缺失 =', miss if miss else '无（7/7 覆盖）')
if miss:
    BAD.append('前端可排键缺失: %s' % miss)
print()

print('── ⑤ tiebreaker：全同值列（status）上 22505 行的分页拼接 ──────')
LIM = 1000


def page(order_expr):
    out = []
    off = 0
    while off < TOTAL:
        rows = c.execute(SEL + ' ORDER BY ' + order_expr + ' LIMIT ? OFFSET ?',
                         (LIM, off)).fetchall()
        out += [r[0] for r in rows]
        off += LIM
    return out


FULL = [r[0] for r in c.execute(
    SEL + ' ORDER BY so.status DESC, so.id DESC LIMIT 30000').fetchall()]
print('  全集（一次取全）行数 =', len(FULL))

for label, expr in (('带   tiebreaker（生产写法 `so.status DESC, so.id DESC`）',
                     'so.status DESC, so.id DESC'),
                    ('不带 tiebreaker（反例 `so.status DESC`）',
                     'so.status DESC')):
    got = page(expr)
    dup = len(got) - len(set(got))
    m = len(set(FULL) - set(got))
    print('  %s：拼接 %d 行 / 重复 %d / 漏 %d' % (label, len(got), dup, m))
    if '带' in label:
        if dup or m:
            BAD.append('带 tiebreaker 仍有重复 %d / 漏 %d' % (dup, m))
    else:
        if dup or m:
            print('     ⇒ ✅ 判别力自证：去掉 tiebreaker 确实产生重复/漏行 ⇒ tiebreaker 不是装饰')
        else:
            print('     ⇒ ⚪ 生产规模下仍未复现（诚实标注：SQL 不保证同值行顺序是**理论**风险，'
                  '本机 SQLite 计划恰好稳定）')
print()

print('─' * 62)
if BAD:
    print('VERDICT: HAS_FAIL  (%d 项)' % len(BAD))
    for b in BAD:
        print('  🔴', b)
else:
    print('VERDICT: ALL_PASS')
'''
# ⚠️ 用占位符替换而不是 `%` 格式化：脚本体内本身有大量 `%s` / `%-18s` / `%d`
#    （探针的表格输出），用 `%` 模板会直接 `TypeError: not enough arguments`。
REMOTE = (REMOTE
          .replace('__WL__', json.dumps(wl, ensure_ascii=False, indent=0))
          .replace('__DB__', json.dumps(REMOTE_DB)))

r = subprocess.run(['ssh', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes', HOST, 'python3 -'],
                   input=REMOTE.encode('utf-8'), capture_output=True)
out = r.stdout.decode('utf-8', 'replace')
err = r.stderr.decode('utf-8', 'replace')
print(out)
if err.strip():
    print('--- stderr ---')
    print(err[-1500:])
sys.exit(0 if ('ALL_PASS' in out) else 1)
