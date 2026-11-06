"""Inventory queries."""
from datetime import datetime, timedelta
from db.connection import get_db, get_db_tx
import logging

# G8 (2026-07-25): saleable stock excludes expired batches.
# Expired stock stays in physical inventory until written off via 报损 (wastage),
# but must never be deducted for sales. Undated batches remain saleable (data issue, not spoilage).
# Keep this condition in sync wherever "sellable quantity" is computed
# (fefo_deduct, batch_out_fefo, sale_order_deliver shortage check).
SALEABLE_BATCH_COND = "(expiry_date='' OR expiry_date IS NULL OR date(expiry_date) >= date('now','localtime'))"

# 效期状态档位（天）：原先 30/90 直接内联在三元表达式里，与文件内其它口径不好对齐，
# 提为常量以便二次判断时有唯一出处。
EXPIRY_CRITICAL_DAYS = 30   # <= 该天数 → critical
EXPIRY_WARNING_DAYS = 90    # <= 该天数 → warning


def _allow_neg_inv(dbc, warehouse_id):
    """该仓是否允许负库存 —— 读 `warehouses.allow_neg_inv`。

    🔴 v719 之前**没有任何代码读过这一列**（全后端 0 处引用），而它自建库起就在
       DDL 里、生产 11 个仓全是 `'允许'`。于是「配置说允许、代码硬拦」——
       业务员仓（刘小顶仓/刘善涛仓，`inventory` 0 行）的销售单一张也发不出去。

    🔴 **fail-closed**：仓不存在、列读不到、值不认识 ⇒ 一律当「不允许」。
       宁可拦住让人改配置，也不能让一个拼错的值悄悄放开负库存。
    """
    try:
        r = dbc.execute("SELECT allow_neg_inv FROM warehouses WHERE id=?",
                        (warehouse_id,)).fetchone()
        if not r:
            return False
        v = r["allow_neg_inv"] if hasattr(r, "keys") else r[0]
        return str(v or "").strip() in ("允许", "是", "1", "true", "True", "allow", "yes")
    except Exception:
        return False



def inventory_query(keyword='', brand='', warehouse_id=1, low_stock_only=False, limit=200, offset=0):
    with get_db() as db:
        where = ["p.is_active=1"]; params = [warehouse_id]
        if keyword: where.append("(p.name LIKE ? OR p.barcode LIKE ?)"); k=f"%{keyword}%"; params.extend([k,k])
        if brand: where.append("p.brand=?"); params.append(brand)
        if low_stock_only: where.append("COALESCE(inv.quantity,0) <= p.safety_stock")
        params.extend([limit, offset])
        rows = [dict(r) for r in db.execute(f"""
            SELECT p.*, COALESCE(inv.quantity,0) as quantity, COALESCE(inv.cost_price,p.purchase_price) as cost_price,
                   COALESCE(inv.stock_value,0) as stock_value, inv.batch_no, inv.expiry_date, p.expiry_days
            FROM products p LEFT JOIN inventory inv ON p.id=inv.product_id AND inv.warehouse_id=?
            WHERE {' AND '.join(where)} ORDER BY p.name LIMIT ? OFFSET ?
        """,params).fetchall()]
        # Add expiry status
        today = datetime.now().date()
        for r in rows:
            if r.get('expiry_date'):
                try:
                    exp = datetime.strptime(r['expiry_date'], '%Y-%m-%d').date()
                    days = (exp - today).days
                    r['expiry_days_left'] = days
                    r['expiry_status'] = (
                        'expired' if days < 0
                        else 'critical' if days <= EXPIRY_CRITICAL_DAYS
                        else 'warning' if days <= EXPIRY_WARNING_DAYS
                        else 'ok'
                    )
                except (ValueError, TypeError):
                    # 收窄：旧的裸 `except:` 会把 KeyError/KeyboardInterrupt 一并当成脏日期吞掉
                    r['expiry_days_left'] = None; r['expiry_status'] = 'unknown'
            else:
                r['expiry_days_left'] = None; r['expiry_status'] = 'none'
        return rows

def inventory_adjust(product_id, warehouse_id, qty_change, cost_price=0, ref_type='', ref_id=0, db_conn=None):
    """Adjust inventory atomically. Uses atomic UPDATE with stock guard when deducting.
    If db_conn is provided, caller manages transaction."""
    if db_conn is not None:
        db = db_conn; own = False
    else:
        _cm = get_db(); db = _cm.__enter__(); own = True
    try:
        inv = db.execute("SELECT id,quantity,cost_price FROM inventory WHERE product_id=? AND warehouse_id=?",(product_id,warehouse_id)).fetchone()
        before = inv['quantity'] if inv else 0; after = before + qty_change
        # P0-S1：stock_value 必须用「新数量 × 新成本」。SQLite 的 SET 右侧读的是旧行值，
        #   若在同一 UPDATE 里改 quantity/cost_price，stock_value=quantity*COALESCE(cost_price,0)
        #   会拿到旧值算错。故在 Python 侧算好再绑定。
        _new_cp = cost_price if (cost_price and cost_price > 0) else (inv['cost_price'] if inv else 0)
        _new_sv = after * float(_new_cp or 0)
        if inv:
            if qty_change < 0:
                # Atomic guard: only update if enough stock (prevents overselling)
                # v719：仓库配了「允许负库存」就去掉该守卫 —— 配置本来就写着「允许」，
                #   此前却从不生效（业务员仓库存 0，一张单也发不出去）。
                if _allow_neg_inv(db, warehouse_id):
                    db.execute("UPDATE inventory SET quantity=quantity+?,cost_price=CASE WHEN ?>0 THEN ? ELSE cost_price END,stock_value=?,updated_at=datetime('now','localtime') WHERE id=?",(qty_change,cost_price,cost_price,_new_sv,inv['id']))
                else:
                    cur = db.execute("UPDATE inventory SET quantity=quantity+?,cost_price=CASE WHEN ?>0 THEN ? ELSE cost_price END,stock_value=?,updated_at=datetime('now','localtime') WHERE id=? AND quantity+?>=0",(qty_change,cost_price,cost_price,_new_sv,inv['id'],qty_change))
                    if cur.rowcount == 0:
                        if own: _cm.__exit__(None,None,None)
                        return {"error": f"库存不足：需要{-qty_change}，可用{before}"}
                after = db.execute("SELECT quantity FROM inventory WHERE id=?",(inv['id'],)).fetchone()['quantity']
            else:
                db.execute("UPDATE inventory SET quantity=?,cost_price=CASE WHEN ?>0 THEN ? ELSE cost_price END,stock_value=?,updated_at=datetime('now','localtime') WHERE id=?",(after,cost_price,cost_price,_new_sv,inv['id']))
        else:
            if qty_change < 0:
                # v719：允许负库存 ⇒ 没有库存记录也要能扣（下面直接建一行负的）
                if not _allow_neg_inv(db, warehouse_id):
                    if own: _cm.__exit__(None,None,None)
                    return {"error": "库存不足：无此商品库存记录"}
            db.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,stock_value) VALUES (?,?,?,?,?)",(product_id,warehouse_id,after,cost_price, after*(float(cost_price) or 0)))
        _cp = float(cost_price or 0)
        _after_qty = after if inv else after
        db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,cost_price,ref_type,ref_id,stock_value_before,stock_value_after,stock_value_difference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",(product_id,warehouse_id,ref_type,qty_change,before,_after_qty,cost_price,ref_type,ref_id, before*_cp, _after_qty*_cp, qty_change*_cp))
        if own: db.commit()
    finally:
        if own: _cm.__exit__(None,None,None)

def get_fefo_suggestions(product_id, warehouse_id=1):
    with get_db() as db:
        rows = db.execute("SELECT * FROM inventory WHERE product_id=? AND warehouse_id=? AND quantity>0 AND expiry_date!='' ORDER BY expiry_date ASC",
                          (product_id, warehouse_id)).fetchall()
        return [dict(r) for r in rows]

def fefo_deduct(product_id, warehouse_id, qty_needed, ref_type='sale', ref_id=0, db_conn=None):
    """FEFO deduction: deduct from earliest-expiring batches first.
    Returns list of batches used with quantities deducted.
    If db_conn is provided, uses it directly without commit (caller manages transaction).

    G4/P4 fixes (2026-07-25):
    - Pre-check total stock BEFORE any UPDATE: insufficient stock => no partial deduction
      (previously batches were deducted then error returned, and finally-block committed them).
    - Unified FEFO sort key: batches WITHOUT expiry_date sort LAST ('9999-12-31'),
      consistent with batch_out_fefo (previously this fn sorted them FIRST '0000-00-00').
    - Atomic per-batch guard (UPDATE ... WHERE quantity>=?) + SAVEPOINT rollback,
      so a concurrent depletion never leaves half-deducted state.
    Contract unchanged: returns {'success':True,'used':[...]} or {'error':..., 'used':[]}."""
    if db_conn is not None:
        db = db_conn; own = False
    else:
        _cm = get_db(); db = _cm.__enter__(); own = True
    try:
        # Pre-check: never start deducting what we cannot fully satisfy.
        # Count only SALEABLE stock (G8: expired batches are not sellable).
        total_row = db.execute(
            f"SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE product_id=? AND warehouse_id=? AND quantity>0 AND {SALEABLE_BATCH_COND}",
            (product_id, warehouse_id)).fetchone()
        total = total_row['t'] if total_row else 0
        # v719：仓库配了「允许负库存」就不再因为可售不足直接拒绝 —— 差额交给下方
        #   `remaining > 0` 分支扣进「未分批次」行（允许为负）。该配置列自建库起就
        #   存在、生产 11 个仓全配「允许」，但此前**没有一行代码读它**。
        allow_neg = _allow_neg_inv(db, warehouse_id)
        if total < qty_needed and not allow_neg:
            return {'error': f'库存不足：需要{qty_needed}，可售{int(total)}（过期批次须报损，不可销售）', 'used': []}

        # Get all SALEABLE batches with stock, ordered by expiry (FEFO = First Expired First Out).
        # Undated batches are treated as "never expires" and ship LAST.
        batches = db.execute(
            f"SELECT * FROM inventory WHERE product_id=? AND warehouse_id=? AND quantity>0 AND {SALEABLE_BATCH_COND} "
            "ORDER BY CASE WHEN expiry_date='' OR expiry_date IS NULL THEN '9999-12-31' ELSE expiry_date END ASC, id ASC",
            (product_id, warehouse_id)).fetchall()

        remaining = qty_needed
        used = []
        db.execute("SAVEPOINT fefo_sp")
        try:
            for b in batches:
                if remaining <= 0:
                    break
                take = min(b['quantity'], remaining)
                # Atomic guard: only deduct if this batch still has enough (prevents oversell races)
                cur = db.execute(
                    "UPDATE inventory SET quantity=quantity-?,stock_value=(quantity-?)*COALESCE(cost_price,0),updated_at=datetime('now','localtime') WHERE id=? AND quantity>=?",
                    (take, take, b['id'], take))
                if cur.rowcount == 0:
                    db.execute("ROLLBACK TO fefo_sp")
                    db.execute("RELEASE fefo_sp")
                    return {'error': f'库存不足：批次扣减冲突（并发），请重试。需要{qty_needed}', 'used': []}
                new_qty = b['quantity'] - take
                _cp = float(b['cost_price'] or 0)
                db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,cost_price,ref_type,ref_id,stock_value_before,stock_value_after,stock_value_difference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (product_id, warehouse_id, ref_type, -take, b['quantity'], new_qty, b['cost_price'], ref_type, ref_id, b['quantity']*_cp, new_qty*_cp, -take*_cp))
                used.append({'batch_no': b['batch_no'], 'expiry_date': b['expiry_date'], 'quantity': take, 'batch_id': b['id']})
                remaining -= take
            if remaining > 0:
                # v719：可售批次扣尽仍有缺口 ⇒ 只有「允许负库存」的仓能走到这里。
                #   差额扣进「未分批次」行（batch_no=''），允许数量为负；没有就建一行。
                #   🔴 不能「只记流水不扣数」：那样 inventory 与 inventory_logs 对不上，
                #      等于把一个静默失效换成另一个静默失效。
                #   🔴 cost_price 必须取 products.purchase_price —— 写 0 会让
                #      domain/profit_reporter.py 按 change_type='sale' 聚合时成本低估。
                neg = db.execute(
                    "SELECT id, quantity, cost_price FROM inventory WHERE product_id=? AND warehouse_id=? "
                    "AND (batch_no='' OR batch_no IS NULL) ORDER BY id ASC LIMIT 1",
                    (product_id, warehouse_id)).fetchone()
                _pr = db.execute("SELECT COALESCE(purchase_price,0) AS p FROM products WHERE id=?",
                                 (product_id,)).fetchone()
                _pcost = float((_pr['p'] if _pr else 0) or 0)
                if neg:
                    _before = float(neg['quantity'] or 0)
                    _cp = float(neg['cost_price'] or 0) or _pcost
                    db.execute("UPDATE inventory SET quantity=quantity-?,stock_value=(quantity-?)*COALESCE(cost_price,0),updated_at=datetime('now','localtime') "
                               "WHERE id=?", (remaining, remaining, neg['id']))
                else:
                    _before = 0.0
                    _cp = _pcost
                    db.execute("INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date,stock_value) "
                               "VALUES (?,?,?,?,'','',?)", (product_id, warehouse_id, -remaining, _pcost, -remaining*_pcost))
                db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,"
                           "before_qty,after_qty,cost_price,ref_type,ref_id,stock_value_before,stock_value_after,stock_value_difference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (product_id, warehouse_id, ref_type, -remaining, _before,
                            _before - remaining, _cp, ref_type, ref_id, _before*_cp, (_before-remaining)*_cp, -remaining*_cp))
                used.append({'batch_no': '', 'expiry_date': '', 'quantity': remaining,
                             'batch_id': 0, 'cost_price': _cp, 'negative': True})
                remaining = 0
            db.execute("RELEASE fefo_sp")
        except Exception:
            try:
                db.execute("ROLLBACK TO fefo_sp")
                db.execute("RELEASE fefo_sp")
            except Exception as e:
                logging.getLogger("hergent").debug(f"savepoint rollback failed: {e}")
            raise

        if own:
            db.commit()
        return {'success': True, 'used': used}
    finally:
        if own:
            # get_db().__exit__ rolls back anything uncommitted — no unconditional commit here
            _cm.__exit__(None, None, None)

def gross_deduct(db, product_id, warehouse_id, qty_needed, ref_type="", ref_id=0, batch_no=None):
    """**不过滤效期**的批次扣减：过期批次优先，其次最早到期，最后无到期日。

    与 `fefo_deduct` 的唯一差别就是**不套 `SALEABLE_BATCH_COND`** —— 这正是
    「报损 / 领用 / 其它出库 / 盘亏 / 组拆消耗」与「销售出库」的语义分界：
    报损的对象**就是**过期品，套上可售条件会让过期奶永远报不掉。

    `batch_no`（可选，v465i 新增）：
      · `None`（默认）→ 过期优先、逐批扣、可跨批次。
      · `'B01'`       → **只扣该批次**；该批次不存在或不足 ⇒ 报错，**不跨批次补**。
        用途：报损单 / 盘点单明确写了「报哪一批」时，扣到别的批次上等于账实不符，
        宁可报错让人改单，也不能悄悄地挪到别的批次。

    🔴 为什么不能用 `inventory_adjust(-qty)`：它是**批次盲**的 ——
       `SELECT ... WHERE product_id=? AND warehouse_id=?` 取第一条就改，压根不看批次。
       多批次时会误报库存不足（第一条批次不够就说没有）或扣错批次（扣到还没过期的那批上）。
       本函数逐批扣减、每批带 `quantity>=?` 原子守卫，与 `fefo_deduct` 同一套骨架。

    ⚠️ 调用方**必须先**开写事务（`_begin_write(db)` 或已在 `get_db_tx()` 内）：
       本函数不自开事务、不 commit，出错时只返回 `{'error': ...}` —— 与 `fefo_deduct` 契约一致。
       返回形状也保持一致：`{'success': True, 'used': [...]}` 或 `{'error': ..., 'used': []}`。

    📌 出处：本函数是 P1 仓配模块 `db/queries/wh.py::_gross_deduct` 的**提升** ——
       v465i 清欠账时，报损单（`domain/wastage_tracker`）与组拆单（`erp_db._asm_apply_inventory`）
       各自都被「批次盲」咬了一口，若再各写一份就变成第四、第五份重复骨架。
       故提到共享层，与 `fefo_deduct` 成对（一个管销售、一个管非销售）。
    """
    need = abs(float(qty_needed or 0))
    if need <= 0:
        return {"error": "数量必须大于 0", "used": []}

    # 排序键与 fefo_deduct **逐字相同**（无到期日排最后），只是不加效期过滤。
    # ⇒ 「过期优先」是从这里自然得到的：过期批次的 expiry_date 更早 ⇒ 排在最前。
    sql = ("SELECT id, quantity, batch_no, expiry_date, cost_price FROM inventory "
           "WHERE product_id=? AND warehouse_id=? AND quantity>0 ")
    params = [product_id, warehouse_id]
    if batch_no:
        sql += "AND batch_no=? "
        params.append(batch_no)
    sql += ("ORDER BY CASE WHEN expiry_date='' OR expiry_date IS NULL THEN '9999-12-31' "
            "              ELSE expiry_date END ASC, id ASC")
    rows = db.execute(sql, params).fetchall()

    total = sum(float(r["quantity"] or 0) for r in rows)
    if total < need:
        scope = f"（指定批次 {batch_no}）" if batch_no else ""
        return {"error": f"库存不足{scope}：需要{need:g}，可用{int(total)}", "used": []}

    remaining = need
    used = []
    for r in rows:
        if remaining <= 0:
            break
        avail = float(r["quantity"] or 0)
        if avail <= 0:
            continue
        take = min(avail, remaining)
        cur = db.execute(
            "UPDATE inventory SET quantity=quantity-?,stock_value=(quantity-?)*COALESCE(cost_price,0),updated_at=datetime('now','localtime') "
            "WHERE id=? AND quantity>=?",
            (take, take, r["id"], take))
        if cur.rowcount == 0:
            return {"error": f"批次扣减冲突（并发），请重试。需要{need:g}", "used": []}
        db.execute(
                "INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,"
                "before_qty,after_qty,cost_price,ref_type,ref_id,stock_value_before,stock_value_after,stock_value_difference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (product_id, warehouse_id, ref_type, -take, avail, avail - take,
                 r["cost_price"], ref_type, ref_id, avail*float(r["cost_price"] or 0), (avail-take)*float(r["cost_price"] or 0), -take*float(r["cost_price"] or 0)))
        # `cost_price` 带上：调用方（报损单）要按**实际扣掉的批次成本**入账，
        # 而不是拿任意一行的成本顶替 —— 多批次进价不同时这两者差得不是一点半点。
        used.append({"batch_id": r["id"], "batch_no": r["batch_no"] or "",
                     "expiry_date": r["expiry_date"] or "", "quantity": take,
                     "cost_price": float(r["cost_price"] or 0)})
        remaining -= take
    return {"success": True, "used": used}

def batch_in(product_id, warehouse_id, quantity, cost_price=0, batch_no='', expiry_date='', db_conn=None, production_date=''):
    """入库时记录批次和效期。已有同批次则累加，否则新建。

    v789：新增 `production_date`（末尾关键字参数，既有按位置调用零影响）。
    是否录由上游按用户偏好决定 —— 空串合法，**绝不强制必录**。
    """
    if db_conn is not None:
        db = db_conn; own = False
    else:
        _cm = get_db(); db = _cm.__enter__(); own = True
    try:
        if batch_no:
            existing = db.execute(
                "SELECT id,quantity FROM inventory WHERE product_id=? AND warehouse_id=? AND batch_no=?",
                (product_id, warehouse_id, batch_no)).fetchone()
            if existing:
                new_qty = existing['quantity'] + quantity
                db.execute("UPDATE inventory SET quantity=?,cost_price=?,stock_value=?,updated_at=datetime('now','localtime') WHERE id=?",
                           (new_qty, cost_price, new_qty*(float(cost_price) or 0), existing['id']))
                if own: db.commit()
                return {'batch': batch_no, 'quantity': new_qty, 'action': 'updated'}
        # New batch record
        # v789：production_date 如实落库 —— 此前 confirm 只传 batch_no/expiry_date，
        #   前端录了生产日期、purchase_order_items 也存了，但 inventory 永远是空，
        #   「录生产日期」等于白录。空串照写（不强制），不传时与改动前逐字一致。
        db.execute(
                "INSERT INTO inventory (product_id,warehouse_id,quantity,cost_price,batch_no,expiry_date,stock_value,production_date) VALUES (?,?,?,?,?,?,?,?)",
                (product_id, warehouse_id, quantity, cost_price, batch_no, expiry_date,
                 quantity*(float(cost_price) or 0), production_date or ''))
        db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,cost_price,ref_type,ref_id,stock_value_before,stock_value_after,stock_value_difference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (product_id,warehouse_id,'batch_in',quantity,0,quantity,cost_price,'batch_in',0, 0, quantity*(float(cost_price) or 0), quantity*(float(cost_price) or 0)))
        if own: db.commit()
        return {'batch': batch_no, 'quantity': quantity, 'action': 'created'}
    finally:
        if own:
            try: db.commit()
            except Exception as e: logging.getLogger("hergent").debug(f"optional step failed: {e}")
            _cm.__exit__(None, None, None)

def batch_out_fefo(product_id, warehouse_id, quantity_needed):
    """按FEFO原则出库：从最早到期的批次扣减。返回出库明细。

    G4/P4 fixes (2026-07-25):
    - Pre-check total BEFORE any UPDATE; commit only on full success
      (previously db.commit() ran before the shortage check, committing partial deductions).
    - Atomic per-batch guard (UPDATE ... WHERE quantity>=?) against concurrent depletion.
    - Undated batches sort LAST ('9999-12-31'), consistent with fefo_deduct."""
    with get_db() as db:
        total_row = db.execute(
            f"SELECT COALESCE(SUM(quantity),0) AS t FROM inventory WHERE product_id=? AND warehouse_id=? AND quantity>0 AND {SALEABLE_BATCH_COND}",
            (product_id, warehouse_id)).fetchone()
        total = total_row['t'] if total_row else 0
        if total < quantity_needed:
            return {'error': f'库存不足: 需要{quantity_needed}件, 可售{int(total)}件（过期批次须报损，不可销售）', 'used': []}

        batches = db.execute(
            f"SELECT * FROM inventory WHERE product_id=? AND warehouse_id=? AND quantity>0 AND {SALEABLE_BATCH_COND} "
            "ORDER BY CASE WHEN expiry_date='' OR expiry_date IS NULL THEN '9999-12-31' ELSE expiry_date END ASC, id ASC",
            (product_id, warehouse_id)).fetchall()
        remaining = quantity_needed
        used = []
        db.execute("SAVEPOINT batch_out_sp")
        try:
            for b in batches:
                if remaining <= 0: break
                b = dict(b)
                take = min(remaining, b['quantity'])
                cur = db.execute(
                    "UPDATE inventory SET quantity=quantity-?,stock_value=(quantity-?)*COALESCE(cost_price,0),updated_at=datetime('now','localtime') WHERE id=? AND quantity>=?",
                    (take, take, b['id'], take))
                if cur.rowcount == 0:
                    db.execute("ROLLBACK TO batch_out_sp")
                    db.execute("RELEASE batch_out_sp")
                    return {'error': f'库存不足: 批次扣减冲突（并发），请重试。需要{quantity_needed}件', 'used': []}
                new_qty = b['quantity'] - take
                _cp = float(b['cost_price'] or 0)
                db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,cost_price,ref_type,ref_id,stock_value_before,stock_value_after,stock_value_difference) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (product_id,warehouse_id,'batch_out',-take,b['quantity'],new_qty,b['cost_price'],'batch_out',0, b['quantity']*_cp, new_qty*_cp, -take*_cp))
                used.append({'batch_no': b['batch_no'], 'expiry_date': b['expiry_date'], 'quantity': take, 'cost_price': b['cost_price']})
                remaining -= take
            db.execute("RELEASE batch_out_sp")
        except Exception:
            try:
                db.execute("ROLLBACK TO batch_out_sp")
                db.execute("RELEASE batch_out_sp")
            except Exception as e:
                logging.getLogger("hergent").debug(f"savepoint rollback failed: {e}")
            raise
        db.commit()
        return {'success': True, 'used': used}

def get_expiry_alerts(days=30):
    """获取未来N天内到期的商品列表。"""
    with get_db() as db:
        cutoff = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d')
        rows = db.execute(
            "SELECT p.name,p.spec,p.unit,inv.batch_no,inv.expiry_date,inv.quantity,inv.warehouse_id "
            "FROM inventory inv JOIN products p ON inv.product_id=p.id "
            "WHERE inv.quantity>0 AND inv.expiry_date!='' AND inv.expiry_date<=? "
            "ORDER BY inv.expiry_date ASC", (cutoff,)).fetchall()
        return [dict(r) for r in rows]

def get_inventory_aging():
    """Get inventory aging by days-held buckets: 0-30/31-60/61-90/91-180/181-365/365+"""
    with get_db() as db:
        today = datetime.now().strftime('%Y-%m-%d')
        # Get all inventory with positive quantity, estimate age from inventory_logs creation
        rows = db.execute("""
            SELECT p.id, p.name, p.spec, p.brand, p.category,
                   inv.warehouse_id, w.name as warehouse_name,
                   inv.batch_no, inv.quantity, inv.cost_price, inv.updated_at,
                   (julianday(?) - julianday(COALESCE(
                       (SELECT created_at FROM inventory_logs WHERE product_id=inv.product_id AND warehouse_id=inv.warehouse_id AND change_type='batch_in' ORDER BY id DESC LIMIT 1),
                       inv.updated_at
                   ))) as days_held
            FROM inventory inv
            JOIN products p ON inv.product_id=p.id
            LEFT JOIN warehouses w ON inv.warehouse_id=w.id
            WHERE inv.quantity > 0 AND p.is_active=1
        """, (today,)).fetchall()

        buckets = {"0-30天": [], "31-60天": [], "61-90天": [], "91-180天": [], "181-365天": [], "365天以上": []}
        totals = {k: {"qty": 0, "value": 0.0} for k in buckets}

        for r in rows:
            d = dict(r)
            days = int(d.get('days_held', 0) or 0)
            qty = int(d.get('quantity', 0) or 0)
            val = qty * float(d.get('cost_price', 0) or 0)
            bk = ("0-30天" if days <= 30 else "31-60天" if days <= 60 else "61-90天" if days <= 90
                  else "91-180天" if days <= 180 else "181-365天" if days <= 365 else "365天以上")
            d['days_held'] = days
            buckets[bk].append(d)
            totals[bk]['qty'] += qty
            totals[bk]['value'] += val

        return {"buckets": [{k: buckets[k], "total_qty": totals[k]["qty"], "total_value": round(totals[k]["value"], 2)} for k in buckets]}

def transfer_stock(product_id, from_wh, to_wh, quantity, operator_id=''):
    """Atomic stock transfer: both out and in happen in one transaction."""
    with get_db_tx() as db:
        src = db.execute("SELECT * FROM inventory WHERE product_id=? AND warehouse_id=? AND quantity>=?",(product_id,from_wh,quantity)).fetchone()
        if not src: return {'error':'源仓库库存不足'}
        # Use shared db_conn so both adjusts run in the same transaction
        r1 = inventory_adjust(product_id, from_wh, -quantity, ref_type='transfer_out', ref_id=0, db_conn=db)
        if isinstance(r1, dict) and 'error' in r1:
            return r1
        r2 = inventory_adjust(product_id, to_wh, quantity, ref_type='transfer_in', ref_id=0, db_conn=db)
        if isinstance(r2, dict) and 'error' in r2:
            return r2
        db.execute("INSERT INTO inventory_logs (product_id,warehouse_id,change_type,change_qty,before_qty,after_qty,ref_type) VALUES (?,?,?,?,?,?,?)",
                   (product_id,from_wh,'transfer_out',-quantity,src['quantity'],src['quantity']-quantity,'transfer'))
        return {'success':True}

def stock_take_start():
    with get_db() as db:
        tid = db.execute("INSERT INTO stock_takes (status,created_at) VALUES ('in_progress',datetime('now','localtime'))").lastrowid
        items = db.execute("SELECT i.*,p.name FROM inventory i JOIN products p ON i.product_id=p.id WHERE i.quantity>0").fetchall()
        for it in items:
            db.execute("INSERT INTO stock_take_items (take_id,product_id,warehouse_id,system_qty) VALUES (?,?,?,?)",
                       (tid, it['product_id'], it['warehouse_id'], it['quantity']))
        db.commit()
        return {'take_id':tid,'items':len(items)}

def stock_take_update(take_id, product_id, actual_qty):
    with get_db() as db:
        db.execute("UPDATE stock_take_items SET actual_qty=? WHERE take_id=? AND product_id=?",(actual_qty,take_id,product_id))
        db.commit()

def stock_take_finalize(take_id, operator_id=''):
    with get_db() as db:
        items = db.execute("SELECT * FROM stock_take_items WHERE take_id=? AND actual_qty IS NOT NULL",(take_id,)).fetchall()
        for it in items:
            diff = it['actual_qty'] - it['system_qty']
            if diff != 0:
                inventory_adjust(it['product_id'], it['warehouse_id'], diff, ref_type='stock_take', ref_id=take_id)
        db.execute("UPDATE stock_takes SET status='completed',completed_at=datetime('now','localtime') WHERE id=?",(take_id,))
        db.commit()
        return {'adjusted':len([i for i in items if i['actual_qty']!=i['system_qty']])}
