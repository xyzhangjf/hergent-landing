#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v279 DDL 迁移链本地验证 —— 不碰任何生产/沙箱，纯内存 SQLite。

验证三场景：
  新库    : v277 建表(含旧索引) -> v279 加列+换索引  => 终态正确
  老库    : 已是 v277 终态 -> v279                     => 终态正确（等价于生产升级）
  幂等    : 在终态上再跑一遍 v279                       => 零异常（重复启动必须无害）

外加一条**行为对照**（这才是本次修的实质）：
  旧唯一索引 UNIQUE(period_start, period_end, product_id, employee_id)
    会拒掉「同一期次、窗口被改过」的第二行；新键 UNIQUE(period_id, …) 允许。
"""
import sqlite3
import sys

V277 = """
    CREATE TABLE IF NOT EXISTS forecast_extra_alloc (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start  TEXT    NOT NULL DEFAULT '',
      period_end    TEXT    NOT NULL DEFAULT '',
      product_id    INTEGER NOT NULL DEFAULT 0,
      employee_id   INTEGER NOT NULL DEFAULT 0,
      employee_name TEXT    DEFAULT '',
      ratio         REAL    DEFAULT 0,
      reported_box  REAL    DEFAULT 0,
      alloc_box     REAL    DEFAULT 0,
      final_box     REAL    DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fea_period_prod_emp
      ON forecast_extra_alloc(period_start, period_end, product_id, employee_id);
    CREATE INDEX IF NOT EXISTS idx_fea_period
      ON forecast_extra_alloc(period_start, period_end, product_id);
    CREATE INDEX IF NOT EXISTS idx_fea_emp
      ON forecast_extra_alloc(employee_id);
"""

V279_ALTER = ("ALTER TABLE forecast_extra_alloc "
              "ADD COLUMN period_id INTEGER NOT NULL DEFAULT 0")

V279_IDX = """
    DROP INDEX IF EXISTS uq_fea_period_prod_emp;
    DROP INDEX IF EXISTS idx_fea_period;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fea_periodid_prod_emp
      ON forecast_extra_alloc(period_id, product_id, employee_id);
    CREATE INDEX IF NOT EXISTS idx_fea_periodid_prod
      ON forecast_extra_alloc(period_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_fea_emp
      ON forecast_extra_alloc(employee_id);
"""

PASS, FAIL = [], []


def ok(cond, label, detail=''):
    (PASS if cond else FAIL).append(label)
    print(('  [OK]   ' if cond else '  [FAIL] ') + label + (('  ' + detail) if detail else ''))
    return bool(cond)


def state(db):
    cols = [r[1] for r in db.execute("PRAGMA table_info(forecast_extra_alloc)")]
    idx = sorted(r[1] for r in db.execute("PRAGMA index_list(forecast_extra_alloc)"))
    return cols, idx


def fresh():
    db = sqlite3.connect(':memory:')
    db.executescript(V277)
    return db


print('=' * 72)
print('场景 1 — 老库升级（生产形态：已是 v277 终态）')
print('=' * 72)
db = fresh()
cols0, idx0 = state(db)
ok('period_id' not in cols0, 'v277 终态不含 period_id', str(cols0[-2:]))
ok('uq_fea_period_prod_emp' in idx0 and 'idx_fea_period' in idx0,
   'v277 终态含两个窗口索引', str(idx0))

db.execute(V279_ALTER)
db.executescript(V279_IDX)
cols1, idx1 = state(db)
ok('period_id' in cols1, 'v279 后含 period_id', str(cols1[-1:]))
ok('uq_fea_periodid_prod_emp' in idx1, '新唯一索引已建')
ok('idx_fea_periodid_prod' in idx1, '新复合索引已建')
ok('idx_fea_emp' in idx1, 'idx_fea_emp 保留（未被误删）')
ok('uq_fea_period_prod_emp' not in idx1, '旧唯一索引已删')
ok('idx_fea_period' not in idx1, '旧复合索引已删')

print()
print('=' * 72)
print('场景 2 — 全新库（v277 建表 + v279 升级，同一启动内）')
print('=' * 72)
db2 = fresh()
db2.execute(V279_ALTER)
db2.executescript(V279_IDX)
cols2, idx2 = state(db2)
ok(cols2 == cols1, '新库终态列 == 老库终态列', str(cols2 == cols1))
ok(idx2 == idx1, '新库终态索引 == 老库终态索引', str(idx2 == idx1))
ok('period_id' in cols2 and 'uq_fea_periodid_prod_emp' in idx2, '新库终态正确')

print()
print('=' * 72)
print('场景 3 — 幂等（第二次启动必须无害）')
print('=' * 72)
try:
    db.execute(V279_ALTER)
    ok(False, '重复 ALTER 未抛错（不该走到这里）')
except sqlite3.OperationalError as e:
    msg = str(e).lower()
    ok('duplicate column name' in msg, '重复 ALTER 抛 duplicate column name（会被记为已应用）',
       repr(str(e)))
    # 复刻 erp_db._is_idempotent_migration_error 的判据
    idem = ('duplicate column name' in msg or 'already exists' in msg
            or 'duplicate index' in msg)
    ok(idem, '_is_idempotent_migration_error 判据命中 => 不记 failed、不打 FAILED')
try:
    db.executescript(V279_IDX)
    ok(True, '重复执行索引脚本零异常（全 IF EXISTS / IF NOT EXISTS）')
except Exception as e:
    ok(False, '重复执行索引脚本抛错', repr(str(e)))
cols3, idx3 = state(db)
ok((cols3, idx3) == (cols1, idx1), '幂等后终态不变')

print()
print('=' * 72)
print('场景 4 — 行为对照：窗口被改过的第二行（本次修复的实质）')
print('=' * 72)


def try_insert(db_, label, pid, ps, pe, prod, emp, legacy=False):
    """legacy=True 用 v277 的列集（无 period_id），用于「旧索引」对照组。"""
    try:
        if legacy:
            db_.execute(
                "INSERT INTO forecast_extra_alloc (period_start, period_end, "
                "product_id, employee_id, employee_name, ratio, reported_box, alloc_box, final_box) "
                "VALUES (?,?,?,?,'甲',10,5,6,11)", (ps, pe, prod, emp))
        else:
            db_.execute(
                "INSERT INTO forecast_extra_alloc (period_id, period_start, period_end, "
                "product_id, employee_id, employee_name, ratio, reported_box, alloc_box, final_box) "
                "VALUES (?,?,?,?,?,'甲',10,5,6,11)", (pid, ps, pe, prod, emp))
        return True
    except sqlite3.IntegrityError as e:
        print('       (%s) IntegrityError: %s' % (label, e))
        return False


# 4a — 旧索引形态：同一窗口同商品同人 => 第二行被拒（旧键的唯一性仍然有效）
dbold = fresh()
try_insert(dbold, 'old-A', 0, '2026-09-24', '2026-09-25', 1556, 6, legacy=True)
dup_old = try_insert(dbold, 'old-B', 0, '2026-09-24', '2026-09-25', 1556, 6, legacy=True)
ok(not dup_old, '旧索引：同窗口同商品同人 第二行被拒（旧键的唯一性）')

# 4b — 新索引形态：同一 period_id 下，窗口列不再参与唯一性
dbnew = fresh()
dbnew.execute(V279_ALTER)
dbnew.executescript(V279_IDX)
try_insert(dbnew, 'new-A', 18, '2026-09-24', '2026-09-25', 1556, 6)
dup_new = try_insert(dbnew, 'new-B', 18, '2026-09-24', '2026-09-25', 1556, 6)
ok(not dup_new, '新索引：同一 period_id 同商品同人 第二行被拒（幂等写仍受保护）')
# 同一 period_id、不同商品 => 允许
ok(try_insert(dbnew, 'new-C', 18, '2026-09-24', '2026-09-25', 1449, 6),
   '新索引：同期次不同商品 允许')
# 不同 period_id、窗口列**完全相同** => 允许（旧键会误拒！）
ok(try_insert(dbnew, 'new-D', 19, '2026-09-24', '2026-09-25', 1556, 6),
   '新索引：不同期次、窗口列相同 允许（旧键会误拒）')
dbold2 = fresh()
try_insert(dbold2, 'old-C', 0, '2026-09-24', '2026-09-25', 1556, 6, legacy=True)
ok(not try_insert(dbold2, 'old-D', 0, '2026-09-24', '2026-09-25', 1556, 6, legacy=True),
   '旧索引：另一期次的同窗口行 被误拒（旧键的病）')

print()
print('=' * 72)
print('汇总：通过 %d / 失败 %d' % (len(PASS), len(FAIL)))
if FAIL:
    for f in FAIL:
        print('  FAILED:', f)
print('=' * 72)
sys.exit(1 if FAIL else 0)
