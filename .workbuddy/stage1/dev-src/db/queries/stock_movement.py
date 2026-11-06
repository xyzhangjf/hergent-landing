#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 · 统一库存写入口（开发副本，未落地后端仓、未部署）

🔴 为什么要这个文件
--------------------
生产快照里 **没有** `stock_ledger.py`；`inventory_balance` 表由迁移 0012 建了，
但只有 `db/queries/reserve.py` 在维护 `reserved_qty`，`actual_qty` / `stock_value`
**从没被任何库存变动写过**（`reserve.py` 注释里写的 `stock_ledger._BALANCE_UPSERT`
是个从未实现的符号）。于是「台账 / 流水 / 余额」三者里，第三者是死的。

同时 `db/queries/inventory.py` 里 6 个函数各自内联「改数量 + 写流水」，其中：
  · `batch_in` 的**同批次累加分支**只 `UPDATE inventory` 就 return，**不写流水**；
  · `transfer_stock` 在 `inventory_adjust` 已写两条流水后又手写第三条，**重复记账**；
  · 全部 6 处都不更新 `inventory_balance`。

⇒ 本文件把「改台账 + 追加流水 + 滚动余额」收成**唯一**一个函数，调用方传入
   已在 `get_db_tx()` / `_begin_write()` 里的事务连接，三写在同一个 SAVEPOINT 内，
   任一失败整体回滚，不可能只成其一。

设计纪律（照抄 ERPNext 的骨架，不抄它的体量）：
  1. 流水**只追加**，永不 UPDATE / DELETE；
  2. 余额是**派生量**，每次由台账实时 SUM 重算，不靠增量累加（增量累加会漂移）；
  3. 金额口径唯一：`数量 × COALESCE(cost_price,0)`，与阶段 1 自动对账卡第③项一致；
  4. 不接管事务边界：不 commit、不 rollback 整个事务、不自建连接；
  5. 幂等建表：老开发库可能没跑过迁移 0012，函数自己 `CREATE TABLE IF NOT EXISTS`。

⚠️ 本文件是 `.workbuddy/stage1/dev-src/` 下的**开发副本**。落地到
   `~/Documents/hergent-erp/server/db/queries/` 需老张单独拍板（并行会话在途改动 +
   生产领先 git 仓 21 个文件），本轮不动、不部署。
"""
import itertools

# SAVEPOINT 名字必须唯一：`fefo_deduct` / `batch_out_fefo` 自己已经开了同名
# SAVEPOINT，嵌套时若复用固定名字，`ROLLBACK TO` 会命中最近一层而不是本层。
_SP_SEQ = itertools.count(1)

_BALANCE_DDL = """CREATE TABLE IF NOT EXISTS inventory_balance (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id     INTEGER NOT NULL,
    warehouse_id   INTEGER NOT NULL,
    actual_qty     REAL NOT NULL DEFAULT 0,
    reserved_qty   REAL NOT NULL DEFAULT 0,
    in_transit_qty REAL NOT NULL DEFAULT 0,
    stock_value    REAL NOT NULL DEFAULT 0,
    valuation_rate REAL NOT NULL DEFAULT 0,
    updated_at     TEXT,
    UNIQUE(product_id, warehouse_id)
)"""

# 与迁移 0012 的 DDL 逐字对齐（含 UNIQUE(product_id, warehouse_id)）。


def _val(row, key, idx, default=0):
    """兼容 sqlite3.Row 与裸 tuple 两种 row_factory。"""
    if row is None:
        return default
    try:
        v = row[key]
    except (TypeError, KeyError, IndexError):
        try:
            v = row[idx]
        except (TypeError, KeyError, IndexError):
            return default
    return default if v is None else v


def _ensure_balance_table(db):
    """幂等建表，不写任何业务数据；不碰已有行的 reserved_qty / in_transit_qty。"""
    db.execute(_BALANCE_DDL)


def _upsert_balance(db, product_id, warehouse_id):
    """按台账实时 SUM 重算「商品-仓」余额行。

    🔴 只更新 actual_qty / stock_value / valuation_rate 三列 —— `reserved_qty`
       是 `reserve.py` 的地盘，`in_transit_qty` 是采购在途的地盘，绝不能覆盖。
    """
    r = db.execute(
        "SELECT COALESCE(SUM(quantity),0) AS q, "
        "       COALESCE(SUM(quantity * COALESCE(cost_price,0)),0) AS v "
        "FROM inventory WHERE product_id=? AND warehouse_id=?",
        (product_id, warehouse_id)).fetchone()
    qty = float(_val(r, 'q', 0))
    value = float(_val(r, 'v', 1))
    rate = (value / qty) if qty else 0.0
    db.execute(
        "INSERT INTO inventory_balance "
        "(product_id,warehouse_id,actual_qty,reserved_qty,in_transit_qty,"
        " stock_value,valuation_rate,updated_at) VALUES (?,?,?,0,0,?,?,datetime('now','localtime')) "
        "ON CONFLICT(product_id,warehouse_id) DO UPDATE SET "
        " actual_qty=excluded.actual_qty, stock_value=excluded.stock_value, "
        " valuation_rate=excluded.valuation_rate, updated_at=excluded.updated_at",
        (product_id, warehouse_id, qty, value, rate))


def write_stock_movement(db, *, product_id, warehouse_id, delta_qty=0,
                         set_qty=None, cost_price=None, row_id=None,
                         batch_no='', expiry_date='', production_date='',
                         change_type='adjust', ref_type='', ref_id=0,
                         allow_negative=False, atomic_guard=True,
                         force_new=False):
    """一次库存数量变动 = 台账 + 流水 + 余额，同 SAVEPOINT 原子完成。

    参数
    ----
    db            : 调用方已开启写事务的连接（get_db_tx / _begin_write / 已有 db_conn）
    delta_qty     : 增减量（入库为正、出库为负）
    set_qty       : 不为 None 时按**绝对量**覆盖（数据同步/初始化用），忽略 delta_qty
    cost_price    : None = 保留台账原有成本；给了数值则一并更新
    row_id        : 指定台账行（逐批扣减用）；不指定则按 商品+仓+批次 定位，找不到就新建
    batch_no / expiry_date / production_date : 仅在**新建行**时写入
    change_type   : 流水类型，如 batch_in / sale / transfer_out
    ref_type / ref_id : 归因到单据
    allow_negative: False 时扣成负数直接判红
    atomic_guard  : 扣减时给 UPDATE 加 `AND quantity>=?` 并发守卫
    force_new     : 跳过定位直接新建行（`batch_in` 无批次号时保持「每次新开一行」原语义）

    返回
    ----
    {'ok':True, 'row_id', 'before_qty', 'after_qty', 'change_qty',
     'stock_value_before', 'stock_value_after', 'balance_qty', 'balance_value'}
    或 {'error': '中文原因'}（出错时 SAVEPOINT 已回滚，台账/流水/余额都没动）
    """
    sp = 'stock_mv_%d' % next(_SP_SEQ)
    db.execute('SAVEPOINT ' + sp)
    try:
        _ensure_balance_table(db)

        # ── ① 定位台账行 ──────────────────────────────────────────
        if force_new:
            inv = None
        elif row_id:
            inv = db.execute(
                "SELECT id,quantity,cost_price FROM inventory WHERE id=?",
                (row_id,)).fetchone()
        else:
            inv = db.execute(
                "SELECT id,quantity,cost_price FROM inventory "
                "WHERE product_id=? AND warehouse_id=? AND COALESCE(batch_no,'')=? "
                "ORDER BY id ASC LIMIT 1",
                (product_id, warehouse_id, batch_no or '')).fetchone()
        if inv is None:
            db.execute(
                "INSERT INTO inventory "
                "(product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date,"
                " production_date,stock_value,updated_at) "
                "VALUES (?,?,0,?,'','','',0,datetime('now','localtime'))",
                # 占位行先给 0；真正的批次字段在下面 UPDATE 里回填，
                # 避免「先 INSERT 带值、再 UPDATE」出现两处口径。
                (product_id, warehouse_id, float(cost_price or 0)))
            inv_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            db.execute(
                "UPDATE inventory SET batch_no=?,expiry_date=?,production_date=? WHERE id=?",
                (batch_no or '', expiry_date or '', production_date or '', inv_id))
            inv = db.execute(
                "SELECT id,quantity,cost_price FROM inventory WHERE id=?",
                (inv_id,)).fetchone()

        inv_id = int(_val(inv, 'id', 0))
        before = float(_val(inv, 'quantity', 1))
        old_cp = float(_val(inv, 'cost_price', 2))
        new_cp = old_cp if cost_price is None else float(cost_price or 0)

        if set_qty is not None:
            after = float(set_qty)
            change = after - before
        else:
            change = float(delta_qty or 0)
            after = before + change

        if change < 0 and after < 0 and not allow_negative:
            db.execute('ROLLBACK TO ' + sp)
            db.execute('RELEASE ' + sp)
            return {'error': '库存不足：需要 %.2f，可用 %.2f' % (-change, before)}

        sv_before = before * old_cp
        sv_after = after * new_cp

        # ── ② 改台账（原子守卫）──────────────────────────────────
        guard = ' AND quantity>=?' if (change < 0 and atomic_guard) else ''
        # 🔴 参数顺序必须严格按 SQL 里的 `?` 出现顺序：SET 三列 → WHERE id → 守卫。
        #   曾把守卫值排在 inv_id 前面，导致 `WHERE id=?` 绑成扣减量、
        #   发货流水写了但台账没扣（演示数据实测抓到），此处逐位对齐。
        params = [after, new_cp, sv_after, inv_id]
        if guard:
            params.append(-change)
        cur = db.execute(
            "UPDATE inventory SET quantity=?,cost_price=?,stock_value=?,"
            "updated_at=datetime('now','localtime') WHERE id=?" + guard,
            params)
        if cur.rowcount == 0:
            db.execute('ROLLBACK TO ' + sp)
            db.execute('RELEASE ' + sp)
            return {'error': '批次扣减冲突（并发），请重试'}

        # ── ③ 追加流水（只追加，永不改）──────────────────────────
        db.execute(
            "INSERT INTO inventory_logs "
            "(product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,"
            " cost_price,ref_type,ref_id,stock_value_before,stock_value_after,"
            " stock_value_difference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (product_id, warehouse_id, change_type or 'adjust', change,
             before, after, new_cp, ref_type or change_type, ref_id or 0,
             sv_before, sv_after, sv_after - sv_before))

        # ── ④ 滚动余额快照（派生重算，不累加）────────────────────
        _upsert_balance(db, product_id, warehouse_id)
        bal = db.execute(
            "SELECT actual_qty,stock_value FROM inventory_balance "
            "WHERE product_id=? AND warehouse_id=?",
            (product_id, warehouse_id)).fetchone()
        db.execute('RELEASE ' + sp)
        return {
            'ok': True,
            'row_id': inv_id,
            'before_qty': before,
            'after_qty': after,
            'change_qty': change,
            'stock_value_before': sv_before,
            'stock_value_after': sv_after,
            'balance_qty': float(_val(bal, 'actual_qty', 0)),
            'balance_value': float(_val(bal, 'stock_value', 1)),
        }
    except Exception:
        try:
            db.execute('ROLLBACK TO ' + sp)
            db.execute('RELEASE ' + sp)
        except Exception:
            pass
        raise


def assert_triple_in_sync(db, product_id, warehouse_id, eps=0.0001):
    """只读校验「台账 / 流水 / 余额」三者一致，供对账卡与沙箱验证调用。

    🔴 不检查 `inventory_balance` 是否存在旧行 —— 缺行本身就是失配（余额没接线）。
    """
    checks = []

    def close(a, b):
        return abs(float(a) - float(b)) <= eps

    inv = db.execute(
        "SELECT COALESCE(SUM(quantity),0) AS q, "
        "       COALESCE(SUM(quantity*COALESCE(cost_price,0)),0) AS v "
        "FROM inventory WHERE product_id=? AND warehouse_id=?",
        (product_id, warehouse_id)).fetchone()
    inv_q = float(_val(inv, 'q', 0))
    inv_v = float(_val(inv, 'v', 1))

    log_q = float(_val(db.execute(
        "SELECT COALESCE(SUM(change_qty),0) AS q FROM inventory_logs "
        "WHERE product_id=? AND warehouse_id=?",
        (product_id, warehouse_id)).fetchone(), 'q', 0))

    has_bal = db.execute(
        "SELECT 1 FROM inventory_balance WHERE product_id=? AND warehouse_id=?",
        (product_id, warehouse_id)).fetchone()
    bal_q = bal_v = None
    if has_bal:
        b = db.execute(
            "SELECT actual_qty,stock_value FROM inventory_balance "
            "WHERE product_id=? AND warehouse_id=?",
            (product_id, warehouse_id)).fetchone()
        bal_q = float(_val(b, 'actual_qty', 0))
        bal_v = float(_val(b, 'stock_value', 1))

    checks.append(('台账数量 = 流水累加', close(inv_q, log_q),
                   '台账 %.2f / 流水 %.2f' % (inv_q, log_q)))
    checks.append(('余额行存在', has_bal is not None,
                   '有' if has_bal else '缺（余额未接线）'))
    checks.append(('余额数量 = 台账数量', bal_q is not None and close(bal_q, inv_q),
                   '余额 %s / 台账 %.2f' % (bal_q, inv_q)))
    checks.append(('余额金额 = 数量×成本', bal_v is not None and close(bal_v, inv_v),
                   '余额 %s / 台账 %.2f' % (bal_v, inv_v)))
    return {
        'ok': all(ok for _, ok, _ in checks),
        'checks': [{'name': n, 'ok': ok, 'detail': d} for n, ok, d in checks],
        'inventory_qty': inv_q, 'log_qty': log_q,
        'balance_qty': bal_q, 'balance_value': bal_v,
    }


def rebuild_balances(db):
    """显式一次性重建全部余额行（只由运维/回放调用，不在迁移里自动跑）。

    保留已有 `reserved_qty` / `in_transit_qty`，只重算派生三列。
    """
    _ensure_balance_table(db)
    rows = db.execute(
        "SELECT product_id,warehouse_id,COALESCE(SUM(quantity),0) AS q, "
        "       COALESCE(SUM(quantity*COALESCE(cost_price,0)),0) AS v "
        "FROM inventory GROUP BY product_id,warehouse_id").fetchall()
    n = 0
    for r in rows:
        pid = int(_val(r, 'product_id', 0))
        wid = int(_val(r, 'warehouse_id', 1))
        q = float(_val(r, 'q', 2))
        v = float(_val(r, 'v', 3))
        db.execute(
            "INSERT INTO inventory_balance "
            "(product_id,warehouse_id,actual_qty,reserved_qty,in_transit_qty,"
            " stock_value,valuation_rate,updated_at) VALUES (?,?,?,0,0,?,?,datetime('now','localtime')) "
            "ON CONFLICT(product_id,warehouse_id) DO UPDATE SET "
            " actual_qty=excluded.actual_qty, stock_value=excluded.stock_value, "
            " valuation_rate=excluded.valuation_rate, updated_at=excluded.updated_at",
            (pid, wid, q, v, (v / q) if q else 0.0))
        n += 1
    return n
