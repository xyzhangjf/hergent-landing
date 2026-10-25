# -*- coding: utf-8 -*-
"""v683 后端补丁 ②：销售/退货/调拨明细表补「单位三件套」并改扣减口径。

改动点：
  erp_db.py
    · 主库 9 条 ALTER（sale_order_items / return_order_items / transfer_order_items × unit/base_ratio/base_qty）
    · 租户列清单同步 9 条（两处都写：只写一处会有「当次启动就缺列」的窗口）
    · transfer_order_create 写三件套
    · transfer_order_complete 过账改用折小量
    · transfer_order_get 返回单位字段
  db/queries/sales.py
    · 顶部新增三个辅助（_row_get / _product_ratio / _qty_to_base / _unit_cols）
    · sale_order_create 写三件套
    · sale_order_deliver 库存校验与 FEFO 扣减改用折小量
    · return_order_create 写三件套
    · _sr_apply_effects 库存回增改用折小量
    · sale_order_get 返回 unit/unit_label/base_unit/base_qty/base_unit_price/unit_options/conv_text

幂等：每段替换都先判断"新代码是否已在"，在则跳过；每文件改前留 .bak。
"""
import os
import shutil
import subprocess
import sys

BASE = "/opt/hergent-erp"
SALES = os.path.join(BASE, "db/queries/sales.py")
ERPDB = os.path.join(BASE, "erp_db.py")
SUFFIX = ".bak-20261025-v683-units"

results = []


def _backup(path):
    if not os.path.exists(path + SUFFIX):
        shutil.copy2(path, path + SUFFIX)
        print("   备份 ->", path + SUFFIX)


def apply(path, label, old, new, marker=None):
    """把 old 换成 new。marker 用于幂等判断（默认取 new 的前 60 字符）。"""
    src = open(path, encoding="utf-8").read()
    mk = marker or new.strip()[:60]
    if mk and mk in src:
        results.append((label, "已存在，跳过"))
        return
    n = src.count(old)
    if n != 1:
        results.append((label, "!! 锚点命中 %d 次（要求 1）——已放弃" % n))
        return
    _backup(path)
    open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
    results.append((label, "已替换"))


# ============================ erp_db.py：主库 9 条 ALTER ============================
MIG_ANCHOR = '_safe_migrate("v409_poi_base_qty", "ALTER TABLE purchase_order_items ADD COLUMN base_qty REAL DEFAULT 0")'
MIG_NEW = MIG_ANCHOR + '''
# ===================== v683（2026-10-25）：销售 / 退货 / 调拨明细补「单位三件套」=====================
#   起因（老板口径）：「各类单据开单时的商品单位需支持手动选择，替代当前写死的箱」。
#   现状实测：只有采购明细存了 `unit` / `base_ratio` / `base_qty`；销售、销售退货、调拨
#   三张明细表**根本没有单位列** ⇒ 用户按「箱」开单，`sale_order_deliver` 拿 `quantity`
#   直接当小单位扣库存（生产 14.28 万条销售明细全在这个口径里），同一批货「1 箱」与
#   「40 瓶」在库里完全无法区分。补列只是让它**从此可复原**；历史行 `base_qty=0`，
#   读取侧一律回退原数量（`db/queries/sales._qty_to_base`），**行为零变化**。
#   🔴 与采购侧 `v409_poi_base_ratio/_qty` 是同一件事，列名逐字对齐，不许另立一套。
#   🔴 三条表 × 三条列，每条**独立** `_safe_migrate`：合成 executescript 时首条失败会
#      吃掉整块后续（本项目已踩过），且失败后无法逐条定位是哪张表缺哪一列。
_safe_migrate("v683_soi_unit", "ALTER TABLE sale_order_items ADD COLUMN unit TEXT DEFAULT ''")
_safe_migrate("v683_soi_base_ratio", "ALTER TABLE sale_order_items ADD COLUMN base_ratio REAL DEFAULT 0")
_safe_migrate("v683_soi_base_qty", "ALTER TABLE sale_order_items ADD COLUMN base_qty REAL DEFAULT 0")
_safe_migrate("v683_roi_unit", "ALTER TABLE return_order_items ADD COLUMN unit TEXT DEFAULT ''")
_safe_migrate("v683_roi_base_ratio", "ALTER TABLE return_order_items ADD COLUMN base_ratio REAL DEFAULT 0")
_safe_migrate("v683_roi_base_qty", "ALTER TABLE return_order_items ADD COLUMN base_qty REAL DEFAULT 0")
_safe_migrate("v683_toi_unit", "ALTER TABLE transfer_order_items ADD COLUMN unit TEXT DEFAULT ''")
_safe_migrate("v683_toi_base_ratio", "ALTER TABLE transfer_order_items ADD COLUMN base_ratio REAL DEFAULT 0")
_safe_migrate("v683_toi_base_qty", "ALTER TABLE transfer_order_items ADD COLUMN base_qty REAL DEFAULT 0")'''

apply(ERPDB, "erp_db 主库 9 条 ALTER", MIG_ANCHOR, MIG_NEW, marker="v683_soi_unit")


# ============================ erp_db.py：租户列清单 9 条 ============================
TEN_ANCHOR = '                    ("purchase_order_items.base_qty", "ALTER TABLE purchase_order_items ADD COLUMN base_qty REAL DEFAULT 0"),'
TEN_NEW = TEN_ANCHOR + '''
                    # v683：销售 / 退货 / 调拨明细「单位三件套」—— 与主库 9 条 `v683_*`
                    #   **逐条成对**。这里是「当次启动就生效」的那一路；只靠启动期列对账
                    #   （`_sync_tenant_columns_on`）会有一个"租户库还没有这列"的窗口，
                    #   窗口内建单会 `no such column: unit` ⇒ 直接 500（v408 已踩过并更正）。
                    #   🔴 列名必须与主库**逐字相同**：两路是同一个事实的两条通道，拼错一个
                    #      字符就变成"主库有、租户库没有"的偏科，且只在非默认租户才暴露。
                    ("sale_order_items.unit", "ALTER TABLE sale_order_items ADD COLUMN unit TEXT DEFAULT ''"),
                    ("sale_order_items.base_ratio", "ALTER TABLE sale_order_items ADD COLUMN base_ratio REAL DEFAULT 0"),
                    ("sale_order_items.base_qty", "ALTER TABLE sale_order_items ADD COLUMN base_qty REAL DEFAULT 0"),
                    ("return_order_items.unit", "ALTER TABLE return_order_items ADD COLUMN unit TEXT DEFAULT ''"),
                    ("return_order_items.base_ratio", "ALTER TABLE return_order_items ADD COLUMN base_ratio REAL DEFAULT 0"),
                    ("return_order_items.base_qty", "ALTER TABLE return_order_items ADD COLUMN base_qty REAL DEFAULT 0"),
                    ("transfer_order_items.unit", "ALTER TABLE transfer_order_items ADD COLUMN unit TEXT DEFAULT ''"),
                    ("transfer_order_items.base_ratio", "ALTER TABLE transfer_order_items ADD COLUMN base_ratio REAL DEFAULT 0"),
                    ("transfer_order_items.base_qty", "ALTER TABLE transfer_order_items ADD COLUMN base_qty REAL DEFAULT 0"),'''

apply(ERPDB, "erp_db 租户列清单 9 条", TEN_ANCHOR, TEN_NEW,
      marker='("sale_order_items.base_qty", "ALTER TABLE sale_order_items ADD COLUMN base_qty REAL DEFAULT 0")')


# ============================ erp_db.py：调拨建单写三件套 ============================
TC_OLD = """        if items:
            for it in items:
                db.execute("INSERT INTO transfer_order_items (transfer_id,product_id,product_name,quantity,unit_price,amount) VALUES (?,?,?,?,?,?)",
                    (oid, it.get('product_id') or 0, it.get('product_name') or '', it.get('quantity') or 0, it.get('unit_price') or 0, (it.get('quantity') or 0)*(it.get('unit_price') or 0)))"""
TC_NEW = """        if items:
            # v683：明细带「单位 / 折算比 / 折小量」。单位为空 ⇒ 三列都不写
            #   ⇒ 与改动前逐字一致（老前端、舟谱导入零影响）。
            from db.queries.units import ratio_to_base as _r2b, base_qty_of as _bq_of
            for it in items:
                _cols = ["transfer_id", "product_id", "product_name", "quantity", "unit_price", "amount"]
                _vals = [oid, it.get('product_id') or 0, it.get('product_name') or '',
                         it.get('quantity') or 0, it.get('unit_price') or 0,
                         (it.get('quantity') or 0) * (it.get('unit_price') or 0)]
                _u = str(it.get('unit') or '').strip()
                if _u:
                    _cols.append("unit"); _vals.append(_u)
                    _pid = int(it.get('product_id') or 0)
                    _pd = db.execute(
                        "SELECT unit, medium_unit, medium_ratio, large_unit, large_ratio "
                        "  FROM products WHERE id=?", (_pid,)).fetchone() if _pid else None
                    _rr = float(_r2b(dict(_pd), _u) or 0) if _pd else 0.0
                    if _rr > 0:
                        _bq2 = _bq_of(it.get('quantity') or 0, _rr)
                        if _bq2 is not None:
                            _cols += ["base_ratio", "base_qty"]; _vals += [_rr, _bq2]
                    else:
                        # 🔴 换算比算不出 ⇒ 只留单位、不折算，并且**要留痕**：
                        #    拿 1 去顶会把「一箱」当「一个」，库存少一大截。
                        logging.getLogger("hergent").warning(
                            "[v683] 调拨明细单位换算不出：product_id=%s unit=%s —— 该行按原数量记账", _pid, _u)
                db.execute("INSERT INTO transfer_order_items (%s) VALUES (%s)" % (
                    ",".join(_cols), ",".join("?" * len(_vals))), _vals)"""
apply(ERPDB, "调拨建单写三件套", TC_OLD, TC_NEW, marker="v683：明细带「单位 / 折算比 / 折小量」")


# ============================ erp_db.py：调拨过账改用折小量 ============================
TP_OLD = """        if items:
            for it in items:
                _move(it["product_id"], d["from_warehouse_id"], d["to_warehouse_id"], it["quantity"])
        else:
            _move(d["product_id"], d["from_warehouse_id"], d["to_warehouse_id"], d["quantity"])"""
TP_NEW = """        # v683：过账数量用**折小单位量**（`base_qty`），不是明细行上的档位数量。
        #   🔴 这是本次改造真正的记账点：用户填「2 箱」而库存是瓶，按 2 扣就是把
        #      2 瓶搬过去。历史行 `base_qty=0` ⇒ 回退 `quantity`（旧口径零变化）。
        def _qty_of_row(row):
            try:
                _bq = float((row["base_qty"] if "base_qty" in row.keys() else 0) or 0)
            except Exception:
                _bq = 0.0
            if _bq > 0:
                return _bq
            return float(row["quantity"] or 0)

        if items:
            for it in items:
                _move(it["product_id"], d["from_warehouse_id"], d["to_warehouse_id"], _qty_of_row(it))
        else:
            _move(d["product_id"], d["from_warehouse_id"], d["to_warehouse_id"], float(d["quantity"] or 0))"""
apply(ERPDB, "调拨过账改折小量", TP_OLD, TP_NEW, marker="调拨过账数量用**折小单位量**")


# ============================ sales.py：辅助函数 ============================
HELP_OLD = '_logger = logging.getLogger(__name__)\n'
HELP_NEW = '''_logger = logging.getLogger(__name__)

# ===================== v683：明细「单位 / 折算比 / 折小量」三件套 =====================
# 🔴 为什么销售侧现在才补：`sale_order_items` 的原 DDL 里**没有 unit 列**，数量被
#    `sale_order_deliver` 直接当作小单位扣库存。于是「按箱卖 1 箱」与「按瓶卖 1 瓶」
#    在库里完全无法区分，而库存已经按不同量纲扣掉了。
# 🔴 三个辅助的**唯一职责**是让"折算"这件事只有一份实现。采购侧 `_poi_base_qty`
#    是同一件事的采购版本 —— 不要在两个文件里各写一份不同的边界处理。
from db.queries.units import ratio_to_base as _ratio_to_base, base_qty_of as _base_qty_of
from db.queries.units import unit_options as _unit_options, conversion_text as _conv_text


def _row_get(it, key, default=None):
    """从 sqlite3.Row / dict 里安全取名 —— 缺列返回默认值，绝不抛。

    🔴 为什么需要：`sqlite3.Row` 取不存在的列抛 `IndexError`/`KeyError`。迁移尚未下发到
       某个租户库时，直接取 `it['base_qty']` 会让整张单 500 —— 那是"少一个字段"
       变成"开不了单"。宁可少一个折算值，也不能开不了单。
    """
    try:
        return it[key]
    except (KeyError, IndexError, TypeError):
        return default


def _product_ratio(db, product_id, unit_name):
    """单位名 → 折小单位比。算不出返回 0.0（**绝不猜 1**：猜 1 = 把一箱当成一个）。"""
    u = str(unit_name or "").strip()
    if not u or not product_id:
        return 0.0
    r = db.execute(
        "SELECT unit, medium_unit, medium_ratio, large_unit, large_ratio, order_unit "
        "  FROM products WHERE id=?", (int(product_id),)).fetchone()
    if not r:
        return 0.0
    try:
        return float(_ratio_to_base(dict(r), u) or 0)
    except Exception:
        return 0.0


def _qty_to_base(db, pid, qty, it=None):
    """把一行的「用户填的数量」折成小单位数量。

    ① 行里已有 `base_qty > 0`（建单时算好并落库）⇒ 直接用 —— 它才是当时的事实；
    ② 否则按行的 `unit` 现查换算比折算（退货模板这类只带 unit 的通道）；
    ③ 单位为空 / 换算比算不出 ⇒ **原样返回**（= 历史口径，14 万行行为零变化）。
    """
    bq = 0.0
    if it is not None:
        try:
            bq = float(_row_get(it, "base_qty", 0) or 0)
        except (TypeError, ValueError):
            bq = 0.0
    if bq > 0:
        return bq
    u = str((_row_get(it, "unit", "") if it is not None else "") or "").strip()
    r = _product_ratio(db, pid, u) if u else 0.0
    if r > 0:
        conv = _base_qty_of(qty, r)
        if conv is not None:
            return conv
    try:
        return float(qty or 0)
    except (TypeError, ValueError):
        return 0.0


def _unit_cols(it, db, qty, pid):
    """返回 `(cols, vals)` —— 该行要写的三件套（可能为空）。

    🔴 空单位 ⇒ 三列都不写（与改动前逐字一致，老前端/小程序/舟谱导入零影响）。
    🔴 单位给了但换算比算不出 ⇒ 只写 `unit`，**不写** base_ratio/base_qty，并告警：
       宁可让这行"有单位、无折算"，也不能拿 1 去顶。
    """
    cols, vals = [], []
    u = str(_row_get(it, "unit", "") or "").strip()
    if not u:
        return cols, vals
    cols.append("unit"); vals.append(u)
    r = _product_ratio(db, pid, u)
    if r > 0:
        bq = _base_qty_of(qty, r)
        if bq is not None:
            cols += ["base_ratio", "base_qty"]; vals += [r, bq]
    else:
        _logger.warning("[v683] 销售明细单位换算不出：product_id=%s unit=%s —— 该行按原数量记账（未折算）",
                        pid, u)
    return cols, vals
'''
apply(SALES, "sales 辅助函数", HELP_OLD, HELP_NEW, marker="def _qty_to_base(db, pid, qty, it=None)")


# ============================ sales.py：销售建单写三件套 ============================
SC_OLD = """            db.execute("INSERT INTO sale_order_items (order_id,product_id,quantity,unit_price,amount,note) VALUES (?,?,?,?,?,?)",(oid,pid,it['quantity'],it['unit_price'],it['quantity']*it['unit_price'],it.get('note')))"""
SC_NEW = """            # v683：单位三件套。空单位 ⇒ 列集合与改动前**逐字一致**。
            _ucols, _uvals = _unit_cols(it, db, it['quantity'], pid)
            _icols = ["order_id", "product_id", "quantity", "unit_price", "amount", "note"]
            _ivals = [oid, pid, it['quantity'], it['unit_price'],
                      it['quantity'] * it['unit_price'], it.get('note')]
            _icols += _ucols; _ivals += _uvals
            db.execute(
                "INSERT INTO sale_order_items (%s) VALUES (%s)" % (
                    ",".join(_icols), ",".join("?" * len(_ivals))), _ivals)"""
apply(SALES, "销售建单写三件套", SC_OLD, SC_NEW, marker="v683：单位三件套。空单位 ⇒ 列集合与改动前")


# ============================ sales.py：发货库存校验改折小量 ============================
SD_OLD = """            if available < it['quantity']:
                pname = it['product_name'] if it['product_name'] else f"商品#{it['product_id']}"
                shortage.append(f"{pname}: 需要{it['quantity']}件, 可售库存仅{int(available)}件(过期批次须报损)")"""
SD_NEW = """            # v683：校验与扣减都用**折小单位量**（`_qty_to_base`）。历史行 base_qty=0
            #   ⇒ 回退 quantity，与改动前逐字一致。
            _need = _qty_to_base(db, it['product_id'], it['quantity'], it)
            if available < _need:
                pname = it['product_name'] if it['product_name'] else f"商品#{it['product_id']}"
                shortage.append(f"{pname}: 需要{_need:g}件, 可售库存仅{int(available)}件(过期批次须报损)")"""
apply(SALES, "发货库存校验改折小量", SD_OLD, SD_NEW, marker="v683：校验与扣减都用**折小单位量**")


# ============================ sales.py：FEFO 扣减改折小量 ============================
SF_OLD = """            result = fefo_deduct(it['product_id'], o['warehouse_id'], it['quantity'], 'sale', oid, db_conn=db)"""
SF_NEW = """            # v683：扣库存的量 = 折小单位量（同上，base_qty 缺失则回退原数量）。
            _deduct_qty = _qty_to_base(db, it['product_id'], it['quantity'], it)
            result = fefo_deduct(it['product_id'], o['warehouse_id'], _deduct_qty, 'sale', oid, db_conn=db)"""
apply(SALES, "FEFO 扣减改折小量", SF_OLD, SF_NEW, marker="v683：扣库存的量 = 折小单位量")


# ============================ sales.py：退货建单写三件套 ============================
RC_OLD = """            db.execute(
                "INSERT INTO return_order_items (return_id,product_id,quantity,unit_price,amount) VALUES (?,?,?,?,?)",
                (oid, pid, qty, price, qty * price))"""
RC_NEW = """            # v683：单位三件套（与销售明细同款）。空单位 ⇒ 列集合与改动前逐字一致。
            _ucols, _uvals = _unit_cols(it, db, qty, pid)
            _icols = ["return_id", "product_id", "quantity", "unit_price", "amount"]
            _ivals = [oid, pid, qty, price, qty * price]
            _icols += _ucols; _ivals += _uvals
            db.execute(
                "INSERT INTO return_order_items (%s) VALUES (%s)" % (
                    ",".join(_icols), ",".join("?" * len(_ivals))), _ivals)"""
apply(SALES, "退货建单写三件套", RC_OLD, RC_NEW, marker="v683：单位三件套（与销售明细同款）")


# ============================ sales.py：退货库存回增改折小量 ============================
RE_OLD = """        # 纳入同一事务：传 db_conn=db，库存回增失败不再静默吞错。
        r = inventory_adjust(pid, wh, qty,
                             ref_type='return', ref_id=rid, db_conn=db)"""
RE_NEW = """        # 纳入同一事务：传 db_conn=db，库存回增失败不再静默吞错。
        # v683：回增数量用**折小单位量** —— 退 1 箱要回 12 瓶，不能只回 1 瓶。
        _qty_base = _qty_to_base(db, pid, qty, it)
        if _qty_base <= 0:
            continue
        r = inventory_adjust(pid, wh, _qty_base,
                             ref_type='return', ref_id=rid, db_conn=db)"""
apply(SALES, "退货库存回增改折小量", RE_OLD, RE_NEW, marker="v683：回增数量用**折小单位量**")


# ============================ sales.py：销售详情回显 ============================
SG_OLD = """        items = [dict(r) for r in db.execute("SELECT soi.*,p.name as product_name,p.spec,p.unit FROM sale_order_items soi LEFT JOIN products p ON soi.product_id=p.id WHERE soi.order_id=?",(oid,)).fetchall()]
        return {'order':dict(o),'items':items}"""
SG_NEW = """        # v683：明细要能回答「当时按哪一档开的单」—— 单位 / 折小量 / 换算文案。
        #   `unit_label` 回退链与采购详情（`purchases.purchase_order_get`）**逐字同源**：
        #   行上单位 → 报单单位 → 档案小单位。历史行 `unit=''` ⇒ 显示与改动前一致。
        #   🔴 `p.unit` 必须起别名 `base_unit`：与 `soi.unit` 同名会让 `dict(row)` 只留一个，
        #      于是"行上单位"和"档案单位"静默混成一个值，且看不出出错。
        _rows = db.execute(
            "SELECT soi.*, p.name AS product_name, p.spec, "
            "       p.unit AS base_unit, p.medium_unit, p.medium_ratio, "
            "       p.large_unit, p.large_ratio, p.order_unit, "
            "       COALESCE(NULLIF(TRIM(COALESCE(soi.unit,'')),''), "
            "                NULLIF(p.order_unit,''), p.unit, '') AS unit_label "
            "  FROM sale_order_items soi LEFT JOIN products p ON soi.product_id=p.id "
            " WHERE soi.order_id=?", (oid,)).fetchall()
        items = []
        for _r in _rows:
            _it = dict(_r)
            _pd = {"unit": _it.get("base_unit") or "",
                   "medium_unit": _it.get("medium_unit") or "",
                   "medium_ratio": _it.get("medium_ratio"),
                   "large_unit": _it.get("large_unit") or "",
                   "large_ratio": _it.get("large_ratio"),
                   "order_unit": _it.get("order_unit") or ""}
            _it["unit_options"] = _unit_options(_pd)
            _it["conv_text"] = _conv_text(_pd)
            _it["base_qty"] = _qty_to_base(db, _it.get("product_id"), _it.get("quantity"), _it)
            _ratio = float(_it.get("base_ratio") or 0)
            _up = float(_it.get("unit_price") or 0)
            _it["base_unit_price"] = (round(_up / _ratio, 4) if _ratio > 0 and _up > 0 else _up)
            items.append(_it)
        return {'order':dict(o),'items':items}"""
apply(SALES, "销售详情回显", SG_OLD, SG_NEW, marker="v683：明细要能回答「当时按哪一档开的单」")


# ============================ 语法自检 ============================
for f in (SALES, ERPDB):
    r = subprocess.run([sys.executable, "-m", "py_compile", f], capture_output=True, text=True)
    results.append(("py_compile " + os.path.basename(f), "PASS" if r.returncode == 0 else "FAIL\n" + r.stderr[:900]))

print()
for k, v in results:
    print("  %-28s %s" % (k, v))
bad = [k for k, v in results if v.startswith("!!") or v.startswith("FAIL")]
sys.exit(1 if bad else 0)
