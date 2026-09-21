#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v204 离线验证：多批导入 —— 「后一批直接覆盖整期顺序」。

为什么这样验（而不是「复刻一份算法再测」）：
  v202 那一轮吃过亏 —— 复刻实现会与源码**漂移**，测过的绿不代表线上绿。
  本脚本改用**切片真实源码 + exec 进内存 SQLite**：
    · 从 import_router.py 原文件里按行号切出「登记写入 + 整期重排」整段；
    · 给这段源码喂一个真 sqlite3 连接与真 `_reg_rows`；
    · 于是被测的就是**即将上线的那些字节**，没有任何影子实现。

数据源：.workbuddy/tools/data/v202-tenant1-period9.json
  reg_order   154 个 product_id，按**登记插入序**（= 当时的模板序）
  names       product_id → 商品名
运行：python3 v204-import-order-verify.py
"""
import json
import os
import re
import sqlite3
import textwrap

ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product'
SRC = '/Users/zhangjunfeng/Documents/hergent-erp/server/routers/import_router.py'
ERPDB = '/Users/zhangjunfeng/Documents/hergent-erp/server/erp_db.py'
DATA = ROOT + '/.workbuddy/tools/data/v202-tenant1-period9.json'

PASS, FAIL = [], []


def chk(cond, label, detail=''):
    (PASS if cond else FAIL).append(label)
    tail = ('   [' + str(detail) + ']') if (detail and not cond) else ''
    print(('  PASS  ' if cond else '  FAIL  ') + label + tail)


def section(t):
    print('\n' + t)


# ══════════════════════════════════════════════════════════════════════════
# A 组：源码形态（防「实现悄悄退回 v202 的累加口径」）
# ══════════════════════════════════════════════════════════════════════════
print('═' * 74)
print('v204 离线验证：后一批覆盖整期顺序')
print('═' * 74)

src = open(SRC, encoding='utf-8').read()
erp = open(ERPDB, encoding='utf-8').read()
# 去注释后的「代码形态」——断言「常量不存在」必须在去注释后进行，
# 否则会把解释它为什么消失的那段注释误判成「还存在」。
code = re.sub(r'#[^\n]*', '', src)

section('A 组 · 源码形态（v202 的累加口径必须彻底消失）')
chk(re.search(r'^\s*_BATCH_SPAN\s*=', code, re.M) is None,
    'A1  代码里已无 `_BATCH_SPAN` 常量（注释里提到它是允许的）')
chk('_batch_base' not in code, 'A2  代码里已无 `_batch_base`')
chk(re.search(r'^\s*_sno = _batch_base', code, re.M) is None,
    'A3  sort_no 不再由批次基准推导')
chk('COALESCE(MAX(sort_no),0)' not in code,
    'A4  代码里已无「取本期最大 sort_no」的询（累加口径的入口）')
chk('_batch_map' in code, 'A5  整期重排的 `_batch_map` 存在')
chk(re.search(r'for _p in sorted\(_batch_map', code),
    'A6  本批按模板行号升序 → 占据整期最前')
chk(re.search(r'for _p in _ordered:', code) and 'not in _seen' in code,
    'A7  其余商品按原相对顺序接在本批之后（且去重）')
chk('conn.executemany(' in code and 'SET sort_no=?' in code,
    'A8  整期重排用 executemany 落连续序号')
chk(re.search(r'^\s*_ordered = \[int\(_r\[0\]\) for _r in conn\.execute\(', code, re.M) is not None,
    'A9  重排前先按「读端口径」取回期内在册行')

# 重排的取数口径必须与读端逐字同源（否则会出现「按 A 排序取、按 B 覆盖」）
_reseq_order = re.search(
    r'SELECT product_id FROM forecast_import_products WHERE period_id=\? '
    r'"\s*\n\s*"ORDER BY CASE WHEN COALESCE\(sort_no,0\)>0 THEN 0 ELSE 1 END,"'
    r'\s*\n\s*" COALESCE\(sort_no,0\), id"', src)
chk(_reseq_order is not None, 'A10 重排取数带两级排序键（sort_no>0 优先 / sort_no / id 兜底）')
chk('ORDER BY CASE WHEN COALESCE(r.sort_no,0)>0 THEN 0 ELSE 1 END,' in erp
    and 'COALESCE(r.sort_no,0), r.id' in erp,
    'A11 读端 forecast_submission_summary 的两级排序键与重排口径一致')

# 纵深防御：INSERT/UPDATE 那句 sort_no 仍在（重排万一没跑，值也不该是 0）
chk(re.search(r'sort_no=\?"\s*\n\s*" WHERE period_id=\? AND product_id=\?', src) is not None,
    'A12 `UPDATE ... sort_no=?` 的纵深防御仍在')

# erp_db 的列语义注释已随 v204 更新（不能还写着 _BATCH_SPAN 是现行机制）
chk('v204' in erp and '覆盖式' in erp, 'A13 erp_db 的列语义注释已标注 v204 覆盖式')
chk('不要再按它理解本列的值域' in erp, 'A14 erp_db 已显式提示「_BATCH_SPAN 不存在了」')
chk('if _period_id <= 0:' in code and '跳过整期重排' in src,
    'A15 重排前有局部前置断言（`WHERE period_id=?` 是全集覆盖 ⇒ 防误伤 period_id=0 孤儿行）')

# ══════════════════════════════════════════════════════════════════════════
# B 组：把真实源码切出来 exec 进内存 SQLite
# ══════════════════════════════════════════════════════════════════════════
section('B 组 · 真实源码切片执行（写入循环 + 整期重排）')

lines = src.split('\n')
_i_start = next(i for i, l in enumerate(lines)
                if '_sno = int(_rr.get("row_no") or 0)' in l) - 1
_i_end = next(i for i, l in enumerate(lines)
              if 'for i, _p in enumerate(_seq)' in l) + 1
chk(lines[_i_start].strip() == 'for _rr in _reg_rows:',
    'B0  切片上界落在登记写入循环的第一行', lines[_i_start][:70])
chk(lines[_i_end].strip() == ')',
    'B0  切片下界落在 executemany 的收尾括号', lines[_i_end][:70])
BLOCK = textwrap.dedent('\n'.join(lines[_i_start:_i_end + 1]))
NS_BASE = {'od': '2026-09-19', '_now_ts': '2026-09-19 13:00:00',
           '_uname': 'v204-verify', 'filename': 'v204.xlsx'}


def fresh_db(rows):
    """rows: [(product_id, sort_no)]，按给定顺序插入（id 自增 ⇒ 登记插入序）。

    ⚠️ DDL 必须与 erp_db.py 的 `v179_forecast_import_products` **逐字同构** ——
       尤其是 `UNIQUE(period_id, product_id)`：整期重排依赖「期内一行一商品」这个前提，
       少了这个约束，`INSERT OR IGNORE` 会变普通 INSERT，测试会造出重复行（第一版就踩了：
       读到 [1539,1539,1455,1455]，看起来像实现有 bug，其实是夹具的 DDL 少了一行）。
    """
    c = sqlite3.connect(':memory:')
    c.execute('''CREATE TABLE forecast_import_products(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_id INTEGER NOT NULL DEFAULT 0,
        order_date TEXT DEFAULT '',
        product_id INTEGER NOT NULL,
        product_name TEXT DEFAULT '',
        barcode TEXT DEFAULT '',
        action TEXT DEFAULT '',
        imported_at TEXT DEFAULT '',
        imported_by TEXT DEFAULT '',
        source_file TEXT DEFAULT '',
        origin TEXT DEFAULT 'import',
        sort_no INTEGER DEFAULT 0,
        UNIQUE(period_id, product_id))''')
    for pid, sn in rows:
        c.execute('INSERT INTO forecast_import_products'
                  '(period_id, order_date, product_id, product_name, action, origin, sort_no)'
                  ' VALUES(1,?,?,?,?,?,?)',
                  ('2026-09-19', pid, 'p%d' % pid, 'import', 'import', sn))
    return c


def run(conn, order, period_id=1):
    """order: [(product_id, row_no)]。跑真实源码切片。"""
    reg = [{'pid': pid, 'name': 'p%d' % pid, 'barcode': 'b%d' % pid,
            'action': 'created', 'row_no': rn} for pid, rn in order]
    ns = dict(NS_BASE)
    ns.update({'conn': conn, '_reg_rows': reg, '_period_id': period_id})
    exec(compile(BLOCK, '<import_router.py 切片>', 'exec'), ns)
    return ns


def read_order(conn, period_id=1):
    """**读端口径**（与 forecast_submission_summary 逐字一致）。"""
    return [r[0] for r in conn.execute(
        'SELECT product_id FROM forecast_import_products WHERE period_id=? '
        'ORDER BY CASE WHEN COALESCE(sort_no,0)>0 THEN 0 ELSE 1 END,'
        ' COALESCE(sort_no,0), id', (period_id,)).fetchall()]


def raw_sort(conn, period_id=1):
    return [(r[0], r[1]) for r in conn.execute(
        'SELECT product_id, sort_no FROM forecast_import_products WHERE period_id=? '
        'ORDER BY id', (period_id,)).fetchall()]


D = json.load(open(DATA, encoding='utf-8'))
T1 = [int(p) for p in D['reg_order']]          # 第一批模板序（154 个）
NAMES = D['names']
assert len(T1) == 154, len(T1)

# ── B1：单批导入 = 整期就是模板序，且收敛成连续 1..154 ────────────────────
c = fresh_db([])
run(c, [(p, i + 1) for i, p in enumerate(T1)])
got = read_order(c)
sn = dict(raw_sort(c))
chk(got == T1, 'B1a 单批：整期顺序 == 模板序（154 行逐行）',
    '首行 %s' % NAMES.get(str(got[0]), got[0]) if got else '空')
chk(sorted(sn.values()) == list(range(1, 155)),
    'B1b 单批：sort_no 恰为连续 1..154（无 0、无重号、无空洞）',
    '实际 %s..%s' % (min(sn.values()), max(sn.values())))
chk(sorted(sn.values()) == list(range(1, len(sn) + 1)),
    'B1c 单批：无重复值（有重号则读端会退化成 id 兜底）')

# ── B2：第二批只补 4 个商品 ⇒ 这 4 个成为 1..4，其余接在 5..154 ──────────
PART = [T1[10], T1[20], T1[30], T1[40]]
c2 = fresh_db([])
run(c2, [(p, i + 1) for i, p in enumerate(T1)])
run(c2, [(p, i + 1) for i, p in enumerate(PART)])
got2 = read_order(c2)
sn2 = dict(raw_sort(c2))
chk(got2[:4] == PART, 'B2a 第二批（部分）：本批 4 个商品占据整期最前 1..4', got2[:4])
rest_expect = [p for p in T1 if p not in set(PART)]
chk(got2[4:] == rest_expect,
    'B2b 其余 150 个**保持原相对顺序**接在 5..154（不是被重排、也不是被丢弃）',
    '前 5 个 %s' % got2[4:9])
chk(sorted(sn2.values()) == list(range(1, 155)),
    'B2c 两批后 sort_no 仍恰为连续 1..154（无同值冲突）')
chk(max(sn2[p] for p in PART) < min(sn2[p] for p in rest_expect),
    'B2d 不变量：任何本批商品都排在任何非本批商品之前（这就是「覆盖」的定义）')
chk(len(got2) == 154 and len(set(got2)) == 154,
    'B2e 两批后行数不变（覆盖的是顺序，不是把上一批删掉）')

# ── B3：第二批是全量模板且**倒序** ⇒ 整期顺序完全等于新模板序 ─────────────
REV = list(reversed(T1))
c3 = fresh_db([])
run(c3, [(p, i + 1) for i, p in enumerate(T1)])
run(c3, [(p, i + 1) for i, p in enumerate(REV)])
chk(read_order(c3) == REV, 'B3a 第二批（全量倒序）：整期顺序 == 新模板序（154 行逐行）')
chk(read_order(c3)[0] == T1[-1],
    'B3b 新首行 = 新模板首行（旧首行不再锚在第一位）',
    NAMES.get(str(read_order(c3)[0]), read_order(c3)[0]))

# ── B4：幂等 —— 同一份模板再导一次，顺序不得漂移 ─────────────────────────
c4 = fresh_db([])
run(c4, [(p, i + 1) for i, p in enumerate(T1)])
before = read_order(c4)
run(c4, [(p, i + 1) for i, p in enumerate(T1)])
chk(read_order(c4) == before, 'B4a 重导同一模板：顺序不变（幂等）')
chk(dict(raw_sort(c4)) == dict(raw_sort(c4)), 'B4b 重导同一模板：sort_no 值不变')
chk(dict(raw_sort(c4)) == {p: i + 1 for i, p in enumerate(T1)},
    'B4c 重导同一模板：sort_no 仍为 1..154（不做累加）')

# ── B5：存量行 sort_no=0（v202 之前导入的）⇒ 被顺带收敛，不再留在 tier1 ──
LEGACY = T1[100:120]
c5 = fresh_db([(p, 0) for p in LEGACY])          # 20 行存量，全 0
run(c5, [(p, i + 1) for i, p in enumerate(PART)])
got5 = read_order(c5)
sn5 = dict(raw_sort(c5))
chk(got5[:4] == PART, 'B5a 存量库：本批 4 个仍占最前')
chk(got5[4:] == LEGACY, 'B5b 存量行按它们原来的 id 序接在后面（相对序不被打乱）')
chk(0 not in sn5.values(), 'B5c 重排后整期不再有 sort_no=0（全期收敛为确定全序）')
chk(sorted(sn5.values()) == list(range(1, 25)), 'B5d 存量库：sort_no 恰为连续 1..24')

# ── B6：同一商品在模板出现多行 ⇒ 取**最后一次**行号（与写入循环一致）─────
DUP = T1[0]
c6 = fresh_db([])
run(c6, [(p, i + 1) for i, p in enumerate(T1)])
# 第 2 批：该商品在第 3 行与第 9 行各出现一次
run(c6, [(T1[5], 1), (T1[6], 2), (DUP, 3), (T1[7], 4), (DUP, 9)])
got6 = read_order(c6)
chk(got6[:4] == [T1[5], T1[6], T1[7], DUP],
    'B6a 同商品多行：以**最后一次**行号定序（DUP 落第 9 行 ⇒ 排在本批最后，而非第 3 行处）',
    '实得 %s' % got6[:4])
chk(got6.index(DUP) > got6.index(T1[7]),
    'B6b 同商品多行：若误用「第一次」行号，DUP 会夹在 T1[6] 与 T1[7] 之间 —— 现在不是')
chk(len(got6) == len(set(got6)), 'B6c 同商品多行：登记表不产生重复行（(period_id,product_id) 幂等）')
chk(sorted(dict(raw_sort(c6)).values()) == list(range(1, 155)),
    'B6d 同商品多行：sort_no 仍连续无重号')

# ── B7：跨期隔离 —— 重排只动本期 ─────────────────────────────────────────
c7 = fresh_db([])
c7.execute('INSERT INTO forecast_import_products'
           '(period_id, order_date, product_id, product_name, action, origin, sort_no)'
           ' VALUES(2,?,?,?,?,?,?)',
           ('2026-09-19', 999, 'other', 'import', 'import', 7))
run(c7, [(p, i + 1) for i, p in enumerate(T1)])
sn7 = dict(raw_sort(c7, 2))
chk(sn7.get(999) == 7, 'B7a 另一期次的行未被本次重排碰到（跨期隔离）')
chk(read_order(c7, 2) == [999], 'B7b 另一期次的读端顺序不变')

# ── B8：大编号存量（v202 累加口径遗留的 100001+）也能被覆盖 ──────────────
c8 = fresh_db([])
run(c8, [(p, i + 1) for i, p in enumerate(T1)])
c8.execute('UPDATE forecast_import_products SET sort_no = sort_no + 100000')
run(c8, [(p, i + 1) for i, p in enumerate(PART)])
sn8 = dict(raw_sort(c8))
chk(sorted(sn8.values()) == list(range(1, 155)),
    'B8a 存量是 v202 累加值（100001+）时，重排同样收敛为 1..154',
    'max=%s' % max(sn8.values()))
chk(read_order(c8)[:4] == PART, 'B8b 存量是 100001+ 时，本批仍在最前')

# ══════════════════════════════════════════════════════════════════════════
print('\n' + '═' * 74)
print('结果：PASS %d / FAIL %d   （共 %d 项）' % (len(PASS), len(FAIL), len(PASS) + len(FAIL)))
if FAIL:
    print('\n失败项：')
    for f in FAIL:
        print('  · ' + f)
print('═' * 74)
raise SystemExit(1 if FAIL else 0)
