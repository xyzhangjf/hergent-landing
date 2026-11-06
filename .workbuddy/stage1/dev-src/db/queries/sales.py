"""Sales, quotations, returns, and product utility queries."""
from db.connection import get_db, get_db_tx, _gen_no, log_migration_warn
# v719：`_allow_neg_inv` —— 发货缺货是否降级为提醒，由仓库配置决定
from db.queries.inventory import inventory_adjust, fefo_deduct, SALEABLE_BATCH_COND, _allow_neg_inv
from db.queries.entity_logs import log_entity_changes
from contextlib import nullcontext
import logging
import time
_logger = logging.getLogger(__name__)

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

def sale_order_create(customer_id, items, warehouse_id=1, discount=0, note='', operator_id='', driver_id='', delivery_date='', delivery_address='', idempotency_key=None, order_date='', status='', delivery_time='', vehicle_id=0, attachments='', customer_po_no='', promise_date='', tax_rate=0, tax_amount=0, skip_credit_check=False, order_no='', order_type='', sub_order_no='', db_conn=None, skip_entity_log=False, department='', handler=''):
    # v449 (2026-10-11): +department —— 销售单的「部门」。
    #   🔴 为什么现在才加：`sale_orders.department` 列 **v88 迁移就有**（`erp_db.py` 的
    #      `v88_... ADD COLUMN department TEXT DEFAULT ''`），但本函数**从来没写过它**
    #      ⇒ 经本函数建的单这一列恒为空串。老板要的「按单据类型拆独立页面」里，
    #      舟谱建单头的 `*部门` 在销售侧一无处可落（采购侧早有 `department_id`）。
    #   ⚠️ 参数放在**签名最末**（`skip_entity_log` 之后）而不是中间：本函数被
    #      `routers/sales.py::create_sale` **位置传参**调用了前 20 个参数，中间插一个
    #      参数会让后面所有位置参数静默错位（v443 在 `list_sale` 上刚吃过这个亏）。
    #   ⚠️ 与 `order_type` 同一套「**有值才写进 INSERT**」写法：空串不写 ⇒ 不覆盖表默认值，
    #      也让「一个都不填」时 SQL 与改动前逐字一致（老前端 / 小程序 / 舟谱导入零影响）。
    # v107.146: +customer_po_no(客户PO号)/promise_date(承诺交期)/tax_rate(税率)/tax_amount(税额)
    #            +skip_credit_check — 信用管控开关(Agent/测试可跳过)
    # v268 (2026-09-25): +order_no / order_type / sub_order_no —— **外部单据导入**通道用。
    #   🔴 为什么必须加 `order_no`：本函数原先**只能**用 `_gen_no("SO")` 自造单号，外部系统
    #      （舟谱等）那张单的**原始单号无处可存** ⇒ 同一份文件传两次就会**再建一遍单**（重复计销量）。
    #      现在：`order_no` 非空 ⇒ 用它；且建单前先按 `order_no` 查重，**命中即直接返回已有单**
    #      （对应返回体里的 `'existed': True`，与 `idempotency_key` 的 `'idempotent': True` 分开表达，
    #       既有调用方都不读新键 ⇒ 零破坏）。
    #   🔴 为什么必须加 `order_type`：`sale_orders.order_type` 是 v88 迁移就有的列（默认 `'self_pickup'`），
    #      但**本函数从来没写过它** ⇒ 经本函数建的单**永远是默认值**，无法区分自提/车销。
    #      这里采用「**有值才写进 INSERT**」而不是「总是写」，避免把空串覆盖掉表默认值。
    #   `sub_order_no`：留原始单号（当 `order_no` 被本系统单号占用、需要另存来源号时用）。
    #   ⚠️ 已知边界（有意保留，改动前先想清楚）：本函数开头的 `check_period_open()` 用的是
    #      **当前月**而不是 `order_date` 的月份 ⇒ 导入历史单据时它检查的是「今天这个月有没有关账」。
    #      这与订单日期无关（是既有缺陷，不属本次改动范围），但意味着：**今天这个月一旦关账，
    #      导入任何月份的历史单据都会被拦**。真遇到再决定是否给导入侧开豁免开关。
    #   v269 (2026-09-25): +db_conn / +skip_entity_log —— **批量外部单据导入**用。
    #   🔴 为什么必须加 `db_conn`：本函数原先每建一张单就 `db.commit()` 一次。
    #      逐单 commit 对**人工下单**无感（一次一张），但对**舟谱单据批量导入**是致命的：
    #      一次要建 **2.2 万张单**，SQLite 每 commit 一次 fsync ⇒ 累计分钟级。
    #      实测口径本的考量已在 `zhoupu_documents.py` 里写明。
    #      传了 `db_conn` ⇒ 复用调用方连接、**不 commit**、由调用方控事务边界（同批要么全成要么全滚）。
    #      ⚠️ 这个范式不是我发明的：本文件下方的 `sale_order_item_create(order_id, …, db_conn=None)`
    #         早就是这个样子（注释原文 "If `db_conn` is supplied (e.g. the import transaction)…"）。
    #   🔴 为什么必须加 `skip_entity_log`：末尾 `log_entity_changes` 每张单写 5 条字段变更
    #      ⇒ 2.2 万张单 = **11 万行审计日志**，会把**真实的业务操作日志淹没在机器导入里**
    #      （以后谁改了一单就再也翻不到了）。批量导入传 True；单个业务动作保持 False 不动。
    from erp_db import money  # 惰性导入，避免与 erp_db 的相互 import 形成循环
    try: from erp_db import check_period_open; check_period_open()
    except Exception as e: logging.getLogger("hergent").debug(f"optional step failed: {e}")
    # v107.74: 新增字段全部走函数签名末尾(带默认值) — 既有调用方(报价转单/测试/种子)保持位置传参 0 破坏
    # 默认语义: status 空→草稿; order_date 空→当前本地时间(与表 DEFAULT datetime('now','localtime') 一致)
    if not status:
        status = 'draft'
    if not order_date:
        order_date = time.strftime('%Y-%m-%d %H:%M:%S')
    # Q3 (2026-07-25): client idempotency key — double-click / retry returns the
    # originally created order instead of a duplicate.
    if idempotency_key:
        from erp_db import idempotency_get, idempotency_put
        ex = idempotency_get(idempotency_key)
        if ex and ex[0] == 'sale_order':
            return {'order_id': ex[1], 'order_no': ex[2], 'total_amount': 0, 'idempotent': True}
    # v268: 外部单据号优先 —— 非空则以它为本单号，并**先按单号查重**（幂等）。
    #   命中即直接返回库里已存在的那张单，**不重复建单、不重复计销量**。
    #   为什么查重要放在信用校验/明细写入之前：重复导入时不该再跑一遍赊账额度校验
    #   （那会因「本次没建单」而给出误导性的超限报错），也不该产生半张单。
    no = str(order_no or '').strip()
    if no:
        # v269: 批量导入时**必须**在同一个连接上查重 —— 否则读不到本批未提交的已插单据，
        #   同一份文件里出现两次的同一个单号会各建一张单（正是本次要防的重复计销量）。
        try:
            _cm_x = nullcontext(db_conn) if db_conn is not None else get_db()
            with _cm_x as _dbq:
                _ex = _dbq.execute(
                    "SELECT id, order_no, total_amount FROM sale_orders WHERE order_no=? LIMIT 1",
                    (no,)).fetchone()
            if _ex:
                return {'order_id': _ex['id'], 'order_no': _ex['order_no'],
                        'total_amount': float(_ex['total_amount'] or 0), 'existed': True}
        except Exception as e:
            # 查重失败不阻断建单（与信用校验同纪律：校验异常不挡下单）；
            # 真撞上 UNIQUE 约束时由下面的 INSERT 兜底分支再处理一次。
            _logger.warning(f"sale_order_create 按 order_no 查重失败，继续建单: {e}")
    if not no:
        no = _gen_no("SO")
    total = money(sum(it['quantity']*it['unit_price'] for it in items) - discount)
    # v107.146: 信用管控 — 客户赊账额度+逾期拦截(Agent 或明确跳过时豁免)
    if not skip_credit_check and customer_id:
        try:
            cu = None
            with get_db() as dbq:
                cu = dbq.execute("SELECT name, credit_limit FROM contacts WHERE id=?", (customer_id,)).fetchone()
            if cu and cu['credit_limit'] and float(cu['credit_limit']) > 0:
                with get_db() as dbq2:
                    used = dbq2.execute("SELECT COALESCE(SUM(amount-paid_amount),0) FROM receivables WHERE type='ar' AND contact_id=? AND status IN ('unpaid','partial','overdue')", (customer_id,)).fetchone()[0]
                if float(used) + total > float(cu['credit_limit']):
                    return {'error': f"客户[{cu['name']}]赊账额度超限: 当前欠款 ¥{float(used):.2f} + 本单 ¥{total:.2f} > 信用额度 ¥{float(cu['credit_limit']):.2f}"}
        except Exception:
            pass  # 信用校验失败不阻断(兜底放行, 不因校验异常影响下单)
    # v268: 动态拼列 —— `order_type` / `sub_order_no` **只在有值时**进 INSERT。
    #   为什么不「总是写、空值落默认」：`order_type` 列的默认值是 `'self_pickup'`，
    #   写空串等于把「未指定」静默固化成「自提」，比不写更糟。
    _cols = ["order_no", "customer_id", "warehouse_id", "total_amount", "discount", "note",
             "operator_id", "driver_id", "delivery_date", "delivery_address", "order_date",
             "status", "delivery_time", "vehicle_id", "attachments", "customer_po_no",
             "promise_date", "tax_rate", "tax_amount"]
    _vals = [no, customer_id, warehouse_id, total, discount, note, operator_id, driver_id,
             delivery_date, delivery_address, order_date, status, delivery_time, vehicle_id,
             attachments, customer_po_no, promise_date, tax_rate, tax_amount]
    # v449: `department` 与上面两个同族 —— 有值才进 INSERT（空 ⇒ SQL 与改动前逐字一致）。
    # v686：`handler`（业务员）与上面三个同族 —— 有值才进 INSERT（空 ⇒ SQL 与改动前逐字一致）。
    #   ⚠️ 它是「业务归属」不是「创建人」：`operator_id` 由服务端从登录身份写死，
    #      `handler` 由建单人在「业务员」下拉里选，两者取值域相同但语义不同。
    for _k, _v in (("order_type", order_type), ("sub_order_no", sub_order_no),
                   ("department", department), ("handler", handler)):
        if str(_v or "").strip():
            _cols.append(_k)
            _vals.append(str(_v).strip())
    with (nullcontext(db_conn) if db_conn is not None else get_db()) as db:
        try:
            cur = db.execute(
                "INSERT INTO sale_orders (%s) VALUES (%s)" % (
                    ",".join(_cols), ",".join("?" * len(_cols))),
                _vals)
        except Exception as e:
            # v268 兜底：并发或查重漏网时撞上 `order_no` 的 UNIQUE 约束
            # ⇒ 视为幂等命中，返回库里那张单，而不是让整批导入失败。
            # 只认「唯一约束」这一类；其它异常原样抛出（不吞错）。
            _m = str(e).lower()
            if no and ("unique" in _m or "constraint" in _m):
                try:
                    with get_db() as _dbq2:
                        _ex2 = _dbq2.execute(
                            "SELECT id, order_no, total_amount FROM sale_orders WHERE order_no=? LIMIT 1",
                            (no,)).fetchone()
                    if _ex2:
                        return {'order_id': _ex2['id'], 'order_no': _ex2['order_no'],
                                'total_amount': float(_ex2['total_amount'] or 0), 'existed': True}
                except Exception as e2:
                    _logger.warning(f"sale_order_create UNIQUE 兜底查重失败: {e2}")
            raise
        oid = cur.lastrowid
        for it in items:
            pid = it.get('product_id')
            if not pid and it.get('product_name'):
                r = db.execute("SELECT id FROM products WHERE name=? LIMIT 1",(it['product_name'],)).fetchone()
                if not r:
                    # Q2 (2026-07-25): 不静默回退 pid=1（会把库存/应收/毛利错配到商品1）。
                    raise ValueError(f"商品不存在：{it.get('product_name')}，请先在商品档案建档")
                pid = r['id']
            if not pid:
                raise ValueError("销售明细缺少 product_id 且无法按 product_name 匹配")
            # v683：单位三件套。空单位 ⇒ 列集合与改动前**逐字一致**。
            _ucols, _uvals = _unit_cols(it, db, it['quantity'], pid)
            _icols = ["order_id", "product_id", "quantity", "unit_price", "amount", "note"]
            _ivals = [oid, pid, it['quantity'], it['unit_price'],
                      it['quantity'] * it['unit_price'], it.get('note')]
            _icols += _ucols; _ivals += _uvals
            db.execute(
                "INSERT INTO sale_order_items (%s) VALUES (%s)" % (
                    ",".join(_icols), ",".join("?" * len(_ivals))), _ivals)
        # v269: `db_conn` 模式下**不 commit** —— 事务边界归调用方（批量导入整批一次提交）。
        if db_conn is None:
            db.commit()
    if idempotency_key:
        from erp_db import idempotency_put
        idempotency_put(idempotency_key, 'sale_order', oid, no)
    # v107.116: 审计日志 — 记录创建操作
    #   v269: `skip_entity_log=True` 时跳过 —— 批量导入会写「单据数 × 5」行变更日志，
    #   把真实人工改动淹掉；且它走独立连接，会拖慢整批。**只有单笔业务动作才该留痕。**
    if skip_entity_log:
        return {'order_id':oid,'order_no':no,'total_amount':total,'idempotent': False}
    try:
        log_entity_changes('sale_order', oid, operator_id, [
            ('order_no', '', no),
            ('customer_id', '', str(customer_id)),
            ('total_amount', '', str(total)),
            ('item_count', '', str(len(items))),
            ('status', '', status),
        ], action='create')
    except Exception: pass
    return {'order_id':oid,'order_no':no,'total_amount':total,'idempotent': False}


def sale_order_item_create(order_id, product_id, quantity, unit_price, db_conn=None):
    """Append a line item to an existing sale order and recompute its total.

    If `db_conn` is supplied (e.g. the import transaction), the insert + total
    recompute run on that connection without committing — the caller controls the
    transaction boundary. Otherwise a standalone connection is used.
    """
    if db_conn is not None:
        db = db_conn
        own = False
    else:
        _cm = get_db()
        db = _cm.__enter__()
        own = True
    try:
        amount = float(quantity) * float(unit_price)
        db.execute(
            "INSERT INTO sale_order_items (order_id, product_id, quantity, unit_price, amount) "
            "VALUES (?,?,?,?,?)",
            (order_id, product_id, quantity, unit_price, amount),
        )
        # Recompute total_amount = SUM(line amount) - order discount (preserves original discount).
        db.execute(
            "UPDATE sale_orders SET total_amount = "
            "(SELECT COALESCE(SUM(amount),0) FROM sale_order_items WHERE order_id=?) "
            "- COALESCE(discount,0) WHERE id=?",
            (order_id, order_id),
        )
        if own:
            db.commit()
        return {"order_id": order_id, "product_id": product_id, "amount": amount}
    finally:
        if own:
            _cm.__exit__(None, None, None)


def sale_order_deliver(oid):
    try: from erp_db import check_period_open; check_period_open()
    except Exception as e: logging.getLogger("hergent").debug(f"optional step failed: {e}")

    with get_db_tx() as db:
        # v416 (P0-1): 放宽发货闸门 —— 状态机实际为 draft→confirmed→delivered→signed。
        # 上游「审核通过」(server.py:4357) 会把单置为 confirmed，原硬闸门只认 draft 会卡死
        # 「审核过的单反而发不出货」。故 draft 与 confirmed 均视为「已就绪、可发货」；
        # 已发货/签收(delivered/signed)、终态(cancelled/rejected) 仍拒绝。
        # v525d：审批流引入 `approved` 中间态 —— 终审批通过的销售单落到 `approved`，
        #   发货必须认这个态（否则审批通过的单永远发不了货）。原 `draft`/`confirmed` 一并保留。
        o = db.execute("SELECT * FROM sale_orders WHERE id=? AND status IN ('draft','confirmed','approved')",(oid,)).fetchone()
        if not o: return {'error':'状态错误：只有草稿或已确认状态的订单才能发货'}

        # Check inventory for each item before delivering.
        # Count only SALEABLE stock (G8: expired batches cannot ship — they must go to 报损).
        shortage = []
        for it in db.execute("SELECT soi.*, p.name as product_name, p.safety_stock FROM sale_order_items soi LEFT JOIN products p ON soi.product_id=p.id WHERE soi.order_id=?",(oid,)).fetchall():
            inv = db.execute(
                f"SELECT COALESCE(SUM(quantity),0) as qty FROM inventory WHERE product_id=? AND warehouse_id=? AND {SALEABLE_BATCH_COND}",
                (it['product_id'], o['warehouse_id']),
            ).fetchone()
            available = inv['qty'] if inv else 0
            # v683：校验与扣减都用**折小单位量**（`_qty_to_base`）。历史行 base_qty=0
            #   ⇒ 回退 quantity，与改动前逐字一致。
            _need = _qty_to_base(db, it['product_id'], it['quantity'], it)
            if available < _need:
                pname = it['product_name'] if it['product_name'] else f"商品#{it['product_id']}"
                shortage.append(f"{pname}: 需要{_need:g}件, 可售库存仅{int(available)}件(过期批次须报损)")

        # v719：缺货从「拦截」降级为「提醒」—— 但**只对配了「允许负库存」的仓**。
        #   业务事实：货已经送到客户手上（签收单），系统拦下来只会让账实分离更严重。
        #   未配「允许」的仓保持原有硬拦截，语义零变化。
        shortage_warnings = []
        if shortage:
            if not _allow_neg_inv(db, o['warehouse_id']):
                return {'error': '库存不足', 'detail': '; '.join(shortage), 'items': shortage}
            shortage_warnings = shortage

        # Deduct inventory (FEFO: First Expired First Out) — uses shared db connection
        fefo_details = []
        cust = db.execute("SELECT name FROM contacts WHERE id=?", (o['customer_id'],)).fetchone()
        cust_name = cust['name'] if cust else ''
        for it in db.execute("SELECT soi.*, p.name as product_name FROM sale_order_items soi LEFT JOIN products p ON soi.product_id=p.id WHERE soi.order_id=?",(oid,)).fetchall():
            # v683：扣库存的量 = 折小单位量（同上，base_qty 缺失则回退原数量）。
            _deduct_qty = _qty_to_base(db, it['product_id'], it['quantity'], it)
            result = fefo_deduct(it['product_id'], o['warehouse_id'], _deduct_qty, 'sale', oid, db_conn=db)
            if 'error' in result:
                return result  # triggers rollback via get_db_tx()
            # Record batch traces for each consumed batch — uses shared db connection
            for used in result.get('used', []):
                batch_no = used.get('batch_no', '')
                if batch_no:
                    try:
                        from erp_db import record_batch_trace
                        record_batch_trace(
                            batch_no, 'out', it['product_id'], it['product_name'] or '',
                            used.get('quantity', 0), 'sale_order', oid, o['order_no'], cust_name,
                            db_conn=db
                        )
                    except Exception as e:
                        logging.getLogger("hergent").debug(f"optional step failed: {e}")
            fefo_details.append({'product_id': it['product_id'], 'used': result.get('used', [])})
            # v107.146: 回写订单行批次(batch_id) — 批次追溯(P2-8)
            for used in result.get('used', []):
                try:
                    if used.get('batch_id'):
                        db.execute("UPDATE sale_order_items SET batch_id=? WHERE order_id=? AND product_id=? AND batch_id=0", (used['batch_id'], oid, it['product_id']))
                except Exception:
                    pass

        db.execute("UPDATE sale_orders SET status='delivered' WHERE id=?",(oid,))
        # v107.146: 出库单打通 — 发货即生成拣货波次记录(P2-10 最小版)
        try:
            from db.connection import _gen_no
            wno = _gen_no("PW")
            db.execute("INSERT INTO pick_waves (wave_no, warehouse_id, status) VALUES (?,?,?)", (wno, o['warehouse_id'], 'completed'))
            wid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            for it in db.execute("SELECT product_id, quantity FROM sale_order_items WHERE order_id=?", (oid,)).fetchall():
                db.execute("INSERT INTO pick_wave_items (wave_id, sale_order_id, product_id, quantity) VALUES (?,?,?,?)", (wid, oid, it['product_id'], it['quantity']))
        except Exception as e:
            logging.getLogger("hergent").debug(f"pick wave optional: {e}")
        # get_db_tx() commits here on clean exit

    # Auto-generate journal entry (idempotent — runs outside transaction, can be retried if fails)
    try:
        from erp_db import auto_journal_for_sale
        auto_journal_for_sale(oid)
    except Exception as e:
        _logger.error(f"auto_journal_for_sale({oid}) failed: {e}", exc_info=True)
    # Auto-generate COGS entry (Dr 6401/Cr 1405)
    try:
        from erp_db import auto_journal_for_cogs
        auto_journal_for_cogs(oid)
    except Exception as e:
        _logger.error(f"auto_journal_for_cogs({oid}) failed: {e}", exc_info=True)
    return {'order_id': oid, 'order_no': o['order_no'], 'status': 'delivered',
            'fefo_batches': fefo_details, 'shortage_warnings': shortage_warnings}


def sale_order_sign(oid):
    try: from erp_db import check_period_open; check_period_open()
    except Exception as e: logging.getLogger("hergent").debug(f"optional step failed: {e}")
    with get_db_tx() as db:
        o = db.execute("SELECT * FROM sale_orders WHERE id=? AND status='delivered'",(oid,)).fetchone()
        if not o: return {"error": "状态错误：只有已发货的订单才能签收"}

        # Update status
        db.execute("UPDATE sale_orders SET status='signed' WHERE id=?", (oid,))
        # v107.116: 审计日志
        try: log_entity_changes('sale_order', oid, '', [('status', 'delivered', 'signed')], action='sign')
        except Exception: pass

        # Generate receivable (AR) if not already paid in full
        unpaid = o["total_amount"] - o["received_amount"]
        if unpaid > 0:
            # Calculate due date based on customer's credit terms
            customer = db.execute("SELECT * FROM contacts WHERE id=?", (o["customer_id"],)).fetchone()
            credit_days = customer["credit_days"] if customer else 0
            due_date = ""
            if credit_days > 0:
                from datetime import datetime, timedelta
                due_date = (datetime.now() + timedelta(days=credit_days)).strftime("%Y-%m-%d")

            # Check if AR already exists for this order (avoid duplicates)
            existing = db.execute(
                "SELECT id FROM receivables WHERE ref_type='sale_order' AND ref_id=?",
                (oid,),
            ).fetchone()
            if not existing:
                db.execute(
                    "INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount,paid_amount,status,due_date) VALUES (?,?,?,?,?,?,?,?)",
                    ("ar", o["customer_id"], "sale_order", oid, unpaid, 0, "unpaid", due_date),
                )

        return {"order_id": oid, "order_no": o["order_no"], "status": "signed", "receivable": unpaid}


def sale_order_cancel(oid, operator_id=''):
    """Cancel a sale order — only draft/confirmed/pending_approval can be cancelled (v107.131)."""
    try:
        from erp_db import check_period_open
        check_period_open()
    except Exception as e:
        logging.getLogger("hergent").debug(f"optional step failed: {e}")
    with get_db_tx() as db:
        o = db.execute("SELECT * FROM sale_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {"error": "订单不存在"}
        if o["status"] not in ("draft", "confirmed", "pending_approval"):
            return {"error": "状态错误：只有草稿/已确认/待审批的订单才能取消"}
        db.execute("UPDATE sale_orders SET status='cancelled' WHERE id=?", (oid,))
        try:
            log_entity_changes('sale_order', oid, '', [('status', o["status"], 'cancelled')], action='cancel')
        except Exception:
            pass
        return {"order_id": oid, "order_no": o["order_no"], "status": "cancelled"}


# v473（2026-10-12）：销售单列表的**服务端排序白名单**（前端表头点击 → `?order_by=&order_dir=`）。
#   🔴 为什么排序必须在 SQL 里做：本列表是**服务端分页**（`LIMIT ? OFFSET ?`）。前端对当前页
#      50 行重排，看着"排好了"，一翻页就散架（第 2 页是另一批 50 行，排序基准不同）。
#      本机 tenant 1 有 22505 张已签收单 ⇒ 这个问题在销售单上比采购单更严重。
#   🔴 为什么必须是白名单：`order_by` 是**用户可控字符串**，直接拼进 SQL 就是注入面。
#      未登记的键一律**回落 `so.id DESC`**（= v473 之前的行为，老前端不传参时零观感变化）。
#   ⚠️ `customer` 指向 JOIN 进来的 `c.name`（不是 `so.customer_id`）—— 用户点「客户」列想按
#      **名字**排；按 id 排出来的顺序在界面上看就是乱的（id 序 ≠ 拼音序 ≠ 用户认知）。
#   ⚠️ `unpaid` 库里**没有这一列**，它是 `total_amount - received_amount` 的口径 ⇒ 这里写
#      **表达式**；写 `so.unpaid` 会直接 `no such column: so.unpaid` 报 500。
#   ⚠️ `operator` / `driver` / `warehouse` 库里只存 **id / 名称串**，只能按存储值排
#      （按人名排需要 join 主库 users，为一次排序把主库拖进这条热查询不划算）。
#   🔴 前端 `InvSaleList.vue` 的 `SORTABLE` 必须与本表**逐键一致**（前端 ⊆ 本表）。少登记一个
#      键的症状是「这一列点了没反应、零报错」，最难查的一类。取证脚本见
#      `.workbuddy/tools/v473-so-order-sort-probe.py`（逐键 SQL 合法性 + 前后端交叉校验）。
_SO_ORDER_SQL = {
    'id':              'so.id',
    'order_no':        'so.order_no',
    'customer':        'c.name',
    'total_amount':    'so.total_amount',
    'received_amount': 'so.received_amount',
    'unpaid':          '(COALESCE(so.total_amount,0) - COALESCE(so.received_amount,0))',
    'discount':        'so.discount',
    'status':          'so.status',
    'order_type':      'so.order_type',
    'order_date':      'so.order_date',
    'delivery_date':   'so.delivery_date',
    'created_at':      'so.created_at',
    'audit_time':      'so.audit_time',
    'sub_order_no':    'so.sub_order_no',
    'customer_po_no':  'so.customer_po_no',
    'promise_date':    'so.promise_date',
    'delivery_time':   'so.delivery_time',
    'operator':        'so.operator_id',
    'driver':          'so.driver_id',
    'warehouse':       'so.warehouse_id',
    'department':      'so.department',
    'approval_status': 'so.approval_status',
    'invoice_status':  'so.invoice_status',
    'delivery_status': 'so.delivery_status',
    'note':            'so.note',
}


def sale_order_list(status='', customer_id=0, date_from='', date_to='', operator_id='', driver_id='', limit=100, offset=0, order_type='', order_by='', order_dir='', exclude_status=''):
    """销售单列表。

    v392（2026-10-07，进销存批次 5）：+`order_type`（出货方式筛选：`self_pickup` 自提 /
    `transfer` 调拨 / `vehicle_sale` 车销）。
    🔴 为什么**追加在参数表末尾**而不是插在 `driver_id` 后面：本函数有 22+ 个调用方
       （hermes_core / accountant / ops_manager / today / meeting …），虽然实测全是关键字传参，
       但「插中间」一旦将来有人按位置传第 7 个参数，会**静默变成 order_type**（limit 仍 100）
       —— 症状是「筛选条件不生效 + 只返回 100 行」，最难查的一类。追加在末尾则
       「第 7 个位置参数」的语义**逐字不变**。
    ⚠️ 空串 = 不过滤（原行为，既有调用方零影响）。

    v473（2026-10-12）：+`order_by` / `order_dir`（服务端排序，白名单 `_SO_ORDER_SQL`）+
    `exclude_status`。三个都**追加在参数表末尾**，理由同 v392（见上）。

    🔴 `exclude_status` 为什么必须有：前端「销售订单」入口（`?kind=order`）原先是在**取回
       本页 50 行之后**用 `list.filter(r => r.status !== 'returned')` 剔行的 —— 那是**在前端
       分页之后**过滤，两个后果：① 每页显示不足 50 行，而 `total` 不减（用户按页数算总数
       会算错）；② v473 上了服务端排序后更糟 —— 一页里被剔掉几行，排序结果看着就是断的。
       交给 SQL 才符合「同一件事只有一个说法」；链路是 `psi.py` → `list_sale` → 本函数三层
       显式声明 + 透传（漏一层即被 FastAPI 静默丢弃）。
       ⚠️ 默认空串 = 不过滤（既有调用方逐字不变）。
    """
    with get_db() as db:
        # v498：拆 `base_where` / `where` —— `base_where` 收**除 status 外**的全部条件
        #   （含 `exclude_status`），`status` 单独拼在 `where` 上。为什么：
        #   销售列表页要上「状态页签 + 计数徽章」（v496 采购页已有，销售/调拨两页对齐），
        #   计数必须**忽略当前选中的状态、保留其余筛选** —— 否则切一个页签，其它页签的
        #   数字跟着漂移（每页只数当前页那种前端数法错得更早，v403 教训）。
        #   镜像 `purchases.py::purchase_order_list` v415 的既有范式。
        #   ⚠️ `exclude_status` 进 `base_where`：它是「订单入口剔除退货行」的**固有口径**，
        #      不是用户当下选的状态 —— 页签数字必须同样不含退货行，否则「全部」的
        #      计数会比各状态相加还大，看着就像 bug。
        base_where,base_params = [],[]
        if customer_id: base_where.append("so.customer_id=?"); base_params.append(customer_id)
        if date_from: base_where.append("date(so.order_date)>=?"); base_params.append(date_from)
        if date_to: base_where.append("date(so.order_date)<=?"); base_params.append(date_to)
        if operator_id: base_where.append("so.operator_id=?"); base_params.append(operator_id)
        if driver_id: base_where.append("so.driver_id=?"); base_params.append(driver_id)
        if order_type: base_where.append("so.order_type=?"); base_params.append(order_type)
        if exclude_status: base_where.append("so.status<>?"); base_params.append(exclude_status)
        where,params = list(base_where),list(base_params)
        if status: where.append("so.status=?"); params.append(status)
        w = " WHERE "+" AND ".join(where) if where else ""
        w_base = " WHERE "+" AND ".join(base_where) if base_where else ""
        # v473：排序片段（白名单见文件上方 `_SO_ORDER_SQL`）。
        #   非法 / 缺省键 ⇒ 回落 `so.id DESC`，与 v473 之前**逐字一致**。
        #   🔴 尾缀 `, so.id DESC` 是**决定性 tiebreaker**：排序列大量同值时（本库 tenant 1
        #      的 `status` 列**全是 `signed`**，22505 行同一个值），SQL 不保证同值行的相对
        #      顺序稳定 ⇒ 翻页会出现「同一单重复出现、另一单整页消失」。这不是理论问题，
        #      是分页表的经典事故（`purchases.py::purchase_order_list` v470 同款）。
        _order_expr = _SO_ORDER_SQL.get((order_by or '').strip())
        _order_dir = 'ASC' if str(order_dir or '').strip().lower() == 'asc' else 'DESC'
        _osql = (f" ORDER BY {_order_expr} {_order_dir}, so.id DESC"
                 if _order_expr else " ORDER BY so.id DESC")
        orders = [dict(r) for r in db.execute(f"SELECT so.*,c.name as customer_name FROM sale_orders so LEFT JOIN contacts c ON so.customer_id=c.id{w}{_osql} LIMIT ? OFFSET ?",params+[limit,offset]).fetchall()]
        total = db.execute(f"SELECT COUNT(*) FROM sale_orders so{w}",params).fetchone()[0]
        # v498：状态页签计数（口径见上方 `base_where` 注释）。
        #   🔴 `FROM sale_orders so` **不带** contacts JOIN：LEFT JOIN 是多对一，
        #      行数不变、GROUP BY 结果逐字相同；少一个 JOIN 少一份白扫。
        #   `counts['all']` = 各状态之和（与 `total` 在「无 status 筛选」时必然相等，
        #      有 status 筛选时 `total` 变而 `all` 不变 —— 这正是页签不漂移的判据）。
        counts = {r['status']: int(r['n'] or 0) for r in db.execute(
            f"SELECT so.status, COUNT(*) n FROM sale_orders so{w_base} GROUP BY so.status",
            base_params).fetchall()}
        counts['all'] = sum(counts.values())
        return {'orders':orders,'total':total,'counts':counts}


def sale_order_get(oid):
    with get_db() as db:
        o = db.execute("SELECT so.*,c.name as customer_name FROM sale_orders so LEFT JOIN contacts c ON so.customer_id=c.id WHERE so.id=?",(oid,)).fetchone()
        if not o: return None
        # v683：明细要能回答「当时按哪一档开的单」—— 单位 / 折小量 / 换算文案。
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
        return {'order':dict(o),'items':items}

# ============================================================
# 收支/应收应付
# ============================================================


def import_products(items):
    created = 0
    with get_db() as db:
        for it in items:
            if not it.get('name'): continue
            db.execute("INSERT INTO products (name,spec,unit,brand,category,purchase_price,sale_price,wholesale_price,safety_stock) VALUES (?,?,?,?,?,?,?,?,?)",
                       (it['name'],it.get('spec',''),it.get('unit','件'),it.get('brand',''),it.get('category',''),float(it.get('purchase_price',0)),float(it.get('sale_price',0)),float(it.get('wholesale_price',0)),int(it.get('safety_stock',0))))
            created += 1
        db.commit()
    return {'created':created}


# ────────────────────────────────────────────────────────────
# v441（2026-10-10）销售退货「可退预览」
#   镜像 `db/queries/purchases.py::purchase_order_return_preview`（v414 P2-6）。
#   上游：`GET /api/psi/sale-orders/{oid}/return-preview`（`?kind=return` 建单页读它）。
# ────────────────────────────────────────────────────────────

# `sale_order_deliver` 成功时置 `status='delivered'`，`sale_order_sign` 再置 `'signed'`
# ——只有这两个状态代表「货真的出库了」。其余（draft/confirmed/pending_approval/
# cancelled/rejected）都是「货还在自己仓里」，退货无从谈起。
_SALE_DELIVERED_STATUSES = ('delivered', 'signed')


def sale_order_return_preview(oid):
    """销售退货的**可退预览**：这张销售单每行还能退多少。

    🔴 **数量口径 = 原销售单行的数量口径**（就是 `sale_order_items.quantity`）。
       为什么不折小单位：销售明细表（DDL 实测：`id, order_id, product_id, quantity,
       unit_price, amount, batch_no, expiry_date, batch_id`）**没有** `base_qty` /
       `base_ratio` 列 —— 采购那条路线 v409 建单时把换算比**快照**下来了，销售这条
       路线从来没有、也不该在这里补一份（补了就是第二份换算实现，必然与建单路径分岔）。
       ⇒ 销售单的数量天生只有一个量纲（＝建单页上「单位」那一列），退货也只能用同一个
         量纲；**没有第二份实现可写**，这是与采购预览唯一的差别（那边要
         `received_qty × ratio`）。返回结构**逐字对齐**采购预览 —— 前端两个退货页
         共用同一套渲染。

    🔴 「已发货量」的判据是**状态**，不是 `delivery_status` 列：
       `sale_order_deliver` 写的是 `sale_orders.status='delivered'`，而 `delivery_status`
       这一列在本仓**没有任何代码路径写过**（实测租户库恒为空值）。拿它判「有没有发货」
       会恒判「没发」⇒ 可退量恒 0（**静默假否定**：界面看着像"退完了"，其实还能退）。

    🔴 「已退量」按 `product_id` 关联（**与采购不同**）：`return_order_items` 有
       `product_id` 列，而采购的 `purchase_return_items` 没有、只能拿 `product_name`
       当键。所以这里**不需要**「产品改名会让旧退货对不上」那条 note。
       ⚠️ 已作废的退货单（`return_orders.status='cancelled'`）**不计入**已退量 ——
          否则作废一张退货单会让余量**永久消失**（用户没有任何出路）。

    🔴 「不能退」的每一种都给**人话原因**（`reason`），界面照显 ——
       不许让用户对着一个点不动的按钮猜为什么。缺值一律空串（不编）。

    返回：
      `{order, can_return, reason, items[], total_amount, note}`
      · `items[].{product_id, product_name, unit, quantity, delivered_qty,
                  returned_qty, returnable_qty, unit_price, amount}`
      · `total_amount` = 可退金额（按原销售单价算）。**刻意不返回"可退总数量"**：
        不同行的单位不同（袋 / 瓶 / 盒），相加是一个**没有意义的伪指标**。
    """
    with get_db() as db:
        o = db.execute(
            "SELECT so.*, COALESCE(c.name,'') AS customer_name, "
            "       COALESCE(w.name,'') AS warehouse_name "
            "  FROM sale_orders so "
            "  LEFT JOIN contacts c ON so.customer_id=c.id "
            "  LEFT JOIN warehouses w ON so.warehouse_id=w.id "
            " WHERE so.id=?", (oid,)).fetchone()
        if not o:
            return None
        o = dict(o)
        items = [dict(r) for r in db.execute(
            "SELECT soi.*, COALESCE(p.name,'') AS product_name, "
            "       COALESCE(NULLIF(p.order_unit,''), p.unit, '') AS unit_label "
            "  FROM sale_order_items soi LEFT JOIN products p ON soi.product_id=p.id "
            " WHERE soi.order_id=? ORDER BY soi.id", (oid,)).fetchall()]
        # 已退量：一次 GROUP BY 拿全，**不要**每行一条 SQL（行数一多就是 N+1）。
        ret_map = {}
        try:
            for r in db.execute(
                    "SELECT roi.product_id AS pid, "
                    "       COALESCE(SUM(roi.quantity),0) AS q "
                    "  FROM return_order_items roi "
                    "  JOIN return_orders ro ON ro.id = roi.return_id "
                    " WHERE ro.sale_order_id=? AND COALESCE(ro.status,'')<>'cancelled' "
                    " GROUP BY roi.product_id", (oid,)).fetchall():
                try:
                    ret_map[int(r["pid"] or 0)] = float(r["q"] or 0)
                except (TypeError, ValueError):
                    continue
        except Exception as e:
            # 只读预览不该因为一张可选表的问题整体失败 —— 但**绝不能静默**：
            #   已退量读不到 ⇒ 可退量会被高估 ⇒ 可能重复退货。让调用方在 `note` 里看到。
            _logger.warning("sale_order_return_preview: 已退量读取失败 oid=%s: %s", oid, e)
            ret_map = None

        status = str(o.get("status") or '')
        delivered_all = status in _SALE_DELIVERED_STATUSES
        out_items, total_amount = [], 0.0
        for it in items:
            try:
                pid = int(it.get("product_id") or 0)
            except (TypeError, ValueError):
                pid = 0
            try:
                qty = float(it.get("quantity") or 0)
            except (TypeError, ValueError):
                qty = 0.0
            delivered = qty if delivered_all else 0.0
            returned = 0.0 if ret_map is None else ret_map.get(pid, 0.0)
            returnable = max(0.0, round(delivered - returned, 4))
            try:
                price = float(it.get("unit_price") or 0)
            except (TypeError, ValueError):
                price = 0.0
            amount = round(returnable * price, 2)
            out_items.append({
                "product_id": pid,
                "product_name": str(it.get("product_name") or '').strip(),
                "unit": it.get("unit_label") or "",
                "quantity": qty,
                "delivered_qty": delivered,
                "returned_qty": returned,
                "returnable_qty": returnable,
                "unit_price": price,
                "amount": amount,
            })
            total_amount += amount

        total_returnable = sum(float(x["returnable_qty"]) for x in out_items)
        can_return = total_returnable > 0 and bool(items) and ret_map is not None
        if ret_map is None:
            reason = "已退数量暂时读不到，为避免重复退货，先不能退。请稍后重试。"
        elif not items:
            reason = "这张单没有明细行，没有可退的货。"
        elif not delivered_all:
            reason = "这张单还没发货，没有货可退。"
        elif total_returnable <= 0:
            reason = "这张单的货已经全部退完了。"
        else:
            reason = ""

        note = ("数量按原销售单的单位填写（每行「单位」列）；提交后会回增库存、冲减客户应收，"
                "金额按原销售单价计算。源销售单状态**不回写**（退货事实以本预览的"
                "「已退 / 可退」两列为准）。")
        if ret_map is None:
            note = "（已退数量读取失败，本次预览的可退量可能偏大）" + note
        return {
            "order": {
                "id": o.get("id"),
                "order_no": o.get("order_no") or "",
                "customer_id": o.get("customer_id") or 0,
                "customer_name": o.get("customer_name") or "",
                "warehouse_id": o.get("warehouse_id") or 0,
                "warehouse_name": o.get("warehouse_name") or "",
                "order_type": o.get("order_type") or "",
                "status": status,
                "order_date": o.get("order_date") or "",
                "delivery_date": o.get("delivery_date") or "",
                "total_amount": o.get("total_amount") or 0,
            },
            "can_return": can_return,
            "reason": reason,
            "items": out_items,
            "total_amount": round(total_amount, 2),
            "note": note,
        }


def return_order_create(sale_order_id, items, reason='', operator_id='', idempotency_key=None,
                        customer_id=0, warehouse_id=0, order_type='', driver_id='', note='',
                        order_date='', draft=False, handler=''):
    """G5 (2026-07-25): 退货创建单事务化。

    原缺陷：用 get_db() 且 inventory_adjust 未传 db_conn，导致库存回增在循环里
    逐条独立 commit，而 return_orders/return_order_items/receivables 到最后才
    commit —— 中途失败即"库存已加、退货单不存在"的半提交。且 inventory_adjust
    的 {'error':...} 返回值被静默吞掉。

    现改为单一 get_db_tx()：库存回增(传 db_conn 纳入同事务) + 主单 + 明细 +
    AR冲减 全部原子化；任一库存回增失败即抛错触发整体回滚。
    注：本函数只做数量级库存回增（混批），批次级还原由 RMA disposition 负责；
    红线不动：不触碰定价链/FEFO原则/单据状态机语义。

    ── v449 (2026-10-11)：**支持不挂原单的退货** ──────────────────────────────
    老板口径（原话）：「退货单不需要选原采购单/销售单，退货仓库要可以指定」。
       · `sale_order_id` 为 0 ⇒ **独立退货单**：客户取 `customer_id`、退货仓库取
         `warehouse_id`（都由调用方给定），不再从原销售单推导。
       · `sale_order_id` 非 0 ⇒ **与改动前逐字同款**（从原单取客户与仓库）。
       🔴 为什么要新建这条通道而不是让调用方先随便挑一张原单：那样退货的仓库、
          客户都由那张单决定，老板要的「退货仓库可指定」根本落不了地；
          而且「挑一张不相干的单」会让 AR 冲减挂到错的单据上（`ref_id` 优先顺序
          里就有 `sale_order_id`）—— 是**静默错账**，比不做更糟。
       🔴 为什么必须显式校验「没原单就必须给客户 + 仓库」：缺任一项就直接
          `{'error': ...}`。少了这道，退货会落成一张 `contact_id=0` /
          库存加在仓 0 的孤儿单，而且**零报错**。
       ⚠️ 新增三列（`warehouse_id` / `order_type` / `driver_id` / `note`）一律
          「**列存在 且 有值**才写」：列由 `erp_db.py` 的 `v449_return_orders`
          迁移补上；老库/未迁移的测试库读到 `_have` 为空集 ⇒ 自动降级成
          与改动前逐字一致的 SQL，**不会**因缺列崩掉。    ── v500 (2026-10-15)：**草稿态**（`draft=True`）──────────────────────────────
    `draft=True` ⇒ **只落单，不落效果**：`status='draft'`，库存**不回增**、AR **不冲减**。
    审核走 `sale_return_post(rid)`（本文件下方），它与「建单即过账」共用同一个
    `_sr_apply_effects` —— 与采购侧 `erp_db.purchase_return_create` / `_pr_apply_effects`
    **同构**（v451 那套），不新发明第二套状态机。
      · 默认值 `False` ⇒ 既有调用方（旧端点 `/api/return-orders`、`/sale-orders/{oid}/return`、
        v449 端点 `/api/psi/sale-return-orders`、舟谱导入器）行为**逐字不变**。
      · 草稿**照样落明细**（`return_order_items`）—— 明细是过账时唯一能反读出
        "退了哪些货"的地方；不落明细的草稿审核后什么都不会发生（静默洞）。
      · `total_amount` 草稿也照算照存（列表要显示金额；过账时直接读回，不重算
        ⇒ 「建单时看到的金额」与「过账后账上的金额」必然相等）。
    ── v500：单据编号 `order_no` ────────────────────────────────────────────────
    列由 `erp_db.py` 的 `v500_return_orders_order_no` 迁移补上；老库没这列 ⇒ 跳过，
    INSERT 与改动前**逐字一致**。前缀 `SR`（销售退货），与采购退货 `PR` 区分。
    """
    with get_db_tx() as db:
        from erp_db import money, _gen_no  # 惰性导入，避免与 erp_db 循环 import
        # Q3 (2026-07-25): client idempotency key — a replay returns the original
        # return order instead of creating a second one (which would double AR冲减).
        if idempotency_key:
            from erp_db import idempotency_get, idempotency_put
            ex = idempotency_get(idempotency_key, conn=db)
            if ex and ex[0] == 'return_order':
                return {'return_id': ex[1], 'total_amount': 0, 'idempotent': True}
        # v449：两路取「客户 + 退货仓库」。`so_id` 为 0 = 独立退货单。
        so_id = int(sale_order_id or 0)
        so = None
        if so_id:
            so = db.execute("SELECT * FROM sale_orders WHERE id=?", (so_id,)).fetchone()
            if not so:
                return {'error': '订单不存在'}
            cid = so['customer_id']
            wh = int(so['warehouse_id'] or 0) or int(warehouse_id or 0)
        else:
            cid = int(customer_id or 0)
            wh = int(warehouse_id or 0)
            if not cid:
                return {'error': '请指定退货客户'}
            if not wh:
                return {'error': '请指定退货仓库'}
        total = 0
        # 先建主单拿到 return_id，库存回增与明细都挂到 return_id（而非 sale_order_id），
        # 保证 inventory_logs.ref_id 可追溯退货单。
        _cols = ["sale_order_id", "contact_id", "total_amount", "reason", "status",
                 "operator_id", "order_date"]
        _vals = [so_id, cid, 0, reason, ('draft' if draft else 'confirmed'), operator_id,
                 str(order_date or '').strip() or time.strftime('%Y-%m-%d %H:%M:%S')]
        # v449：新增列 —— 「列存在 且 有值」才写（见 docstring 末尾 ⚠️）。
        try:
            _have = {r[1] for r in db.execute("PRAGMA table_info(return_orders)").fetchall()}
        except Exception:
            _have = set()
        # v686：`handler`（业务员）—— 与上面四个同族（「列存在 且 有值」才写）。
        for _k, _v in (('warehouse_id', wh), ('order_type', order_type),
                       ('driver_id', driver_id), ('note', note), ('handler', handler)):
            if _k not in _have:
                continue
            _sv = str(_v if _v is not None else '').strip()
            if _k == 'warehouse_id':
                if int(_v or 0) <= 0:
                    continue
                _cols.append(_k); _vals.append(int(_v))
            elif _sv:
                _cols.append(_k); _vals.append(_sv)
        # v500：单据编号（缺列则跳过 ⇒ 老库 INSERT 与改动前逐字一致）。
        _sr_no = _gen_no("SR") if "order_no" in _have else ""
        if _sr_no:
            _cols.append("order_no"); _vals.append(_sr_no)
        oid = db.execute(
            "INSERT INTO return_orders (%s) VALUES (%s)" % (
                ",".join(_cols), ",".join("?" * len(_cols))),
            _vals).lastrowid
        for it in items:
            pid = it.get('product_id', 0)
            qty = it.get('quantity', 0)
            price = it.get('unit_price', 0)
            if not pid or qty <= 0:
                continue
            total += qty * price
            # v683：单位三件套（与销售明细同款）。空单位 ⇒ 列集合与改动前逐字一致。
            _ucols, _uvals = _unit_cols(it, db, qty, pid)
            _icols = ["return_id", "product_id", "quantity", "unit_price", "amount"]
            _ivals = [oid, pid, qty, price, qty * price]
            _icols += _ucols; _ivals += _uvals
            db.execute(
                "INSERT INTO return_order_items (%s) VALUES (%s)" % (
                    ",".join(_icols), ",".join("?" * len(_ivals))), _ivals)
        # 回填主单总额（建单时先写0，避免半提交时总额与明细不一致）。
        total = money(total)
        db.execute("UPDATE return_orders SET total_amount=? WHERE id=?", (total, oid))
        # v500：草稿 ⇒ **到此为止**（库存 / AR 一个都不动，押后到 `sale_return_post`）。
        #   🔴 明细与金额**照样落库** —— 见 docstring：不落明细的草稿审核后什么都不会发生。
        if draft:
            if idempotency_key:
                from erp_db import idempotency_put
                idempotency_put(idempotency_key, 'return_order', oid, '', conn=db)
            return {'return_id': oid, 'total_amount': total, 'idempotent': False,
                    'status': 'draft', 'order_no': _sr_no}
        _sr_apply_effects(db, oid, cid, so_id, total, wh, items)
        if idempotency_key:
            from erp_db import idempotency_put
            idempotency_put(idempotency_key, 'return_order', oid, '', conn=db)
        return {'return_id': oid, 'total_amount': total, 'idempotent': False,
                'status': 'confirmed', 'order_no': _sr_no}


def _sr_apply_effects(db, rid, cid, so_id, total, wh, items):
    """销售退货单的**效果落账唯一实现** —— 库存回增 + AR 冲减。

    🔴 为什么必须唯一：本单的效果有**两条触发路径**（建单即过账 `draft=False`、
       审核草稿 `sale_return_post`）。各写一份 ⇒ 改一处漏一处，漏掉的那处会让
       "审核过的单"和"直接建的单"账不一样，且**零报错**（本仓反复付学费那类）。
       ⇨ 与采购侧 `erp_db._pr_apply_effects` 是**同一个设计**，不要另发明一套。
    🔴 `items`：`[{product_id, quantity, unit_price, ...}]`（与 `return_order_items` 同量纲）。
       ⚠️ 数量 ≤ 0 / 无商品编号的行**跳过**（建单时已过滤，这里是第二道）。
    🔴 库存回增失败一律 `raise ValueError` ⇒ 调用方事务整体回滚
       （G5 修的就是"库存已加、退货单不存在"的半提交；不要退回静默吞错）。
    """
    for it in items:
        pid = it.get('product_id', 0)
        qty = it.get('quantity', 0)
        price = it.get('unit_price', 0)
        if not pid or qty <= 0:
            continue
        # 纳入同一事务：传 db_conn=db，库存回增失败不再静默吞错。
        # v683：回增数量用**折小单位量** —— 退 1 箱要回 12 瓶，不能只回 1 瓶。
        _qty_base = _qty_to_base(db, pid, qty, it)
        if _qty_base <= 0:
            continue
        r = inventory_adjust(pid, wh, _qty_base,
                             ref_type='return', ref_id=rid, db_conn=db)
        if isinstance(r, dict) and r.get('error'):
            raise ValueError(f"退货回增库存失败(商品{pid}): {r['error']}")
    # AR 冲减（G5 修正）：receivables 有 CHECK(amount>=0)，负值冲减会被约束拒绝。
    # 正确口径=冲减该客户该销售单的未付 AR 余额（amount/paid_amount 同减，保持
    # paid_amount<=amount 且净额=应收减少 total）。优先冲 ref_type='sale_order'
    # 且 ref_id=本单的 AR；无则冲该客户任意未付 AR；都没有则不建负 AR。
    if total > 0:
        remaining = total
        ars = db.execute(
            "SELECT id,amount,paid_amount FROM receivables WHERE contact_id=? AND type='ar' "
            "AND status!='paid' AND amount>0 ORDER BY (ref_type='sale_order' AND ref_id=?) DESC, id",
            (cid, so_id)).fetchall()
        for ar in ars:
            if remaining <= 0:
                break
            cut = min(remaining, ar['amount'])
            new_amount = ar['amount'] - cut
            new_paid = min(ar['paid_amount'], new_amount)  # paid 不超过新 amount
            new_status = 'paid' if new_amount <= 0 else ('partial' if new_paid > 0 else 'unpaid')
            db.execute(
                "UPDATE receivables SET amount=?,paid_amount=?,status=? WHERE id=?",
                (new_amount, new_paid, new_status, ar['id']))
            remaining -= cut


def sale_return_post(rid, operator_id=''):
    """v500：**审核 / 过账**一张草稿销售退货单 —— 库存回增 + AR 冲减，置 `confirmed`。

    🔴 与"建单即过账"走**同一个实现**（`_sr_apply_effects`）：一条业务规则一份代码。
    🔴 **幂等 + 并发安全**（与 `erp_db.purchase_return_post` 同款乐观锁）：
         · 先 SELECT 校验存在与状态（给人话原因）；
         · 再在**同一个事务**里用 `UPDATE … WHERE id=? AND status='draft'` 抢这次跃迁；
         · `rowcount=0` ⇒ 已被别的会话审过 ⇒ ValueError（**不重复加一次库存**）。
       ⚠️ 顺序要紧：**先抢占再落效果** —— 反过来的话两个并发请求都能通过状态检查、
          都跑一遍 `_sr_apply_effects`，库存被加两次。
    🔴 金额**从主单读回**（`total_amount`）而不是按明细重算：重算出来的数与
       建单时界面上显示的数可能因四舍五入差一分 ⇒ 两张"都对"的数打架。
    🔴 失败一律抛 `ValueError`（调用方转 400），**不 return 半成品**。
    """
    with get_db_tx() as db:
        h = db.execute("SELECT * FROM return_orders WHERE id=?", (int(rid),)).fetchone()
        if not h:
            raise ValueError("退货单不存在")
        h = dict(h)
        st = str(h.get("status") or "confirmed")
        if st != "draft":
            raise ValueError("这张单已经是「已确认」，不能重复审核")
        # ① 先抢占状态跃迁（乐观锁；rowcount=0 ⇒ 别人先审了）。
        cur = db.execute(
            "UPDATE return_orders SET status='confirmed' WHERE id=? AND status='draft'",
            (int(rid),))
        if not cur.rowcount:
            raise ValueError("这张单已被审核，请刷新后再看")
        # ② 抢占成功后才落效果（此刻本事务已"拥有"这张草稿）。
        items = [dict(r) for r in db.execute(
            "SELECT product_id, quantity, unit_price FROM return_order_items WHERE return_id=?",
            (int(rid),)).fetchall()]
        _sr_apply_effects(db, int(rid), int(h.get("contact_id") or 0),
                          int(h.get("sale_order_id") or 0), float(h.get("total_amount") or 0),
                          int(h.get("warehouse_id") or 0), items)
        return {"return_id": int(rid), "total_amount": float(h.get("total_amount") or 0),
                "status": "confirmed", "order_no": str(h.get("order_no") or "")}


def bulk_update_prices(brand, category, pct_increase):
    with get_db() as db:
        where,params = [],[]
        if brand: where.append("brand=?"); params.append(brand)
        if category: where.append("category=?"); params.append(category)
        w = " WHERE is_active=1" + (" AND "+" AND ".join(where) if where else "")
        cnt = db.execute(f"SELECT COUNT(*) FROM products{w}",params).fetchone()[0]
        factor = 1 + pct_increase / 100.0
        db.execute(f"UPDATE products SET sale_price=ROUND(sale_price*?,2),wholesale_price=ROUND(wholesale_price*?,2),updated_at=datetime('now','localtime'){w}",[factor,factor]+params)
        db.commit()
        return {'updated':cnt,'pct':pct_increase}


def quick_payment(contact_id, amount, account='现金', note=''):
    with get_db() as db:
        # Record payment
        balance = db.execute("SELECT current_balance FROM accounts WHERE name=?",(account,)).fetchone()
        bal = (balance['current_balance'] if balance else 0) + amount
        db.execute("INSERT INTO cash_flow (account,type,amount,balance_after,contact_id,note) VALUES (?,?,?,?,?,?)",
                   (account,'income',amount,bal,contact_id,note))
        db.execute("UPDATE accounts SET current_balance=? WHERE name=?",(bal,account))
        # Auto-match to receivables
        ars = db.execute("SELECT * FROM receivables WHERE contact_id=? AND type='ar' AND status!='paid' AND amount>paid_amount ORDER BY created_at",(contact_id,)).fetchall()
        remaining = amount
        for ar in ars:
            if remaining <= 0: break
            gap = ar['amount'] - ar['paid_amount']
            to_pay = min(remaining, gap)
            db.execute("UPDATE receivables SET paid_amount=paid_amount+?,status=CASE WHEN paid_amount+?>=amount THEN 'paid' ELSE 'partial' END WHERE id=?",
                       (to_pay, to_pay, ar['id']))
            remaining -= to_pay
        db.commit()
        return {'applied':amount-remaining,'remaining':remaining}

# Create order_templates tables
try:
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS order_templates (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,customer_id INTEGER DEFAULT 0,user_id TEXT DEFAULT '');
            CREATE TABLE IF NOT EXISTS order_template_items (id INTEGER PRIMARY KEY AUTOINCREMENT,template_id INTEGER,product_id INTEGER,quantity INTEGER DEFAULT 1);
        """)
        db.commit()
except Exception as _e:
    import sys; log_migration_warn(_e)

# ============================================================
# v8: 产品趋势、生日提醒、费用审批
# ============================================================

def get_product_trend(product_id, days=30):
    with get_db() as db:
        rows = db.execute(f"SELECT date(so.order_date) as day,SUM(soi.quantity) as qty,SUM(soi.amount) as amt FROM sale_order_items soi JOIN sale_orders so ON soi.order_id=so.id WHERE soi.product_id=? AND so.order_date>=date('now','-{days} days') AND so.status IN ('delivered','signed') GROUP BY date(so.order_date) ORDER BY day",(product_id,)).fetchall()
        return [dict(r) for r in rows]


def _ensure_product_change_logs(db):
    """幂等建表: 租户库/主库首次写或查时自动建表(租户库不走主库 init_db)。"""
    db.execute(
        "CREATE TABLE IF NOT EXISTS product_change_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "product_id INTEGER NOT NULL,user_name TEXT DEFAULT '',action TEXT DEFAULT 'update',"
        "field_name TEXT DEFAULT '',old_value TEXT DEFAULT '',new_value TEXT DEFAULT '',"
        "created_at TEXT DEFAULT (datetime('now','localtime')))"
    )
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_pcl_product ON product_change_logs(product_id, id DESC)"
    )


def log_product_changes(product_id, user_name='', changes=None, action='update'):
    """记录商品字段级修改日志（商品档案"修改记录"弹窗数据源）。
    changes: list of (field_name, old_value, new_value) 三元组。
    action: create / update / delete / restore / batch
    """
    if not changes:
        return 0
    with get_db() as db:
        _ensure_product_change_logs(db)
        for f, o, n in changes:
            db.execute(
                "INSERT INTO product_change_logs (product_id,user_name,action,field_name,old_value,new_value) VALUES (?,?,?,?,?,?)",
                (product_id, user_name, action, f,
                 '' if o is None else str(o),
                 '' if n is None else str(n)))
        db.commit()
        return len(changes)


def get_product_changes(product_id, limit=200):
    """查询商品修改记录，按时间倒序（id 倒序）。"""
    with get_db() as db:
        _ensure_product_change_logs(db)
        return [dict(r) for r in db.execute(
            "SELECT * FROM product_change_logs WHERE product_id=? ORDER BY id DESC LIMIT ?",
            (product_id, limit)).fetchall()]

def batch_update_category(ids, category='', brand=''):
    with get_db() as db:
        updates,params = [],[]
        if category: updates.append("category=?"); params.append(category)
        if brand: updates.append("brand=?"); params.append(brand)
        if not updates: return {'updated':0}
        params.extend(ids)
        placeholders = ",".join(["?"]*len(ids))
        db.execute(f"UPDATE products SET {','.join(updates)},updated_at=datetime('now','localtime') WHERE id IN ({placeholders})",params)
        db.commit()
        return {'updated':len(ids)}

# v107.38: 商品软删除/恢复(is_active 批量) — 删除=is_active 0(列表隐藏, 历史订单/报表不受影响), 恢复=1
def batch_set_active(ids, active):
    if not ids:
        return {'updated':0}
    with get_db() as db:
        placeholders = ",".join(["?"]*len(ids))
        db.execute(f"UPDATE products SET is_active=?,updated_at=datetime('now','localtime') WHERE id IN ({placeholders})",[1 if active else 0]+list(ids))
        db.commit()
        return {'updated':len(ids)}


def batch_price_adjust(ids, sale_price=None, purchase_price=None, pct_change=None):
    """Batch adjust product prices. sale_price/purchase_price=absolute, pct_change=percentage."""
    with get_db() as db:
        if not ids:
            return {'updated': 0}
        placeholders = ",".join(["?"] * len(ids))
        updated = 0
        if pct_change and pct_change != 0:
            factor = 1 + pct_change / 100.0
            if sale_price:
                db.execute(f"UPDATE products SET sale_price=ROUND(sale_price*?,2),updated_at=datetime('now','localtime') WHERE id IN ({placeholders})", [factor] + ids)
                updated = db.rowcount
            if purchase_price:
                db.execute(f"UPDATE products SET purchase_price=ROUND(purchase_price*?,2),updated_at=datetime('now','localtime') WHERE id IN ({placeholders})", [factor] + ids)
                updated = max(updated, db.rowcount)
            if not sale_price and not purchase_price:
                db.execute(f"UPDATE products SET sale_price=ROUND(sale_price*?,2),updated_at=datetime('now','localtime') WHERE id IN ({placeholders})", [factor] + ids)
                updated = db.rowcount
        else:
            if sale_price is not None and sale_price > 0:
                db.execute(f"UPDATE products SET sale_price=?,updated_at=datetime('now','localtime') WHERE id IN ({placeholders})", [sale_price] + ids)
                updated = db.rowcount
            if purchase_price is not None and purchase_price > 0:
                db.execute(f"UPDATE products SET purchase_price=?,updated_at=datetime('now','localtime') WHERE id IN ({placeholders})", [purchase_price] + ids)
                updated = max(updated, db.rowcount)
        db.commit()
        return {'updated': updated if updated else len(ids)}


def get_customer_frequent_products(contact_id, limit=8):
    with get_db() as db:
        rows = db.execute("SELECT soi.product_id,p.name,p.sale_price,SUM(soi.quantity) as total_qty FROM sale_order_items soi JOIN sale_orders so ON soi.order_id=so.id JOIN products p ON soi.product_id=p.id WHERE so.customer_id=? GROUP BY soi.product_id ORDER BY total_qty DESC LIMIT ?",(contact_id,limit)).fetchall()
        return [dict(r) for r in rows]


def get_related_products(product_id, limit=5):
    with get_db() as db:
        # Find orders containing this product, then find other products in those orders
        rows = db.execute("SELECT soi2.product_id,p.name,COUNT(*) as freq FROM sale_order_items soi1 JOIN sale_order_items soi2 ON soi1.order_id=soi2.order_id JOIN products p ON soi2.product_id=p.id WHERE soi1.product_id=? AND soi2.product_id!=? GROUP BY soi2.product_id ORDER BY freq DESC LIMIT ?",(product_id,product_id,limit)).fetchall()
        return [dict(r) for r in rows]


def save_substitute(product_id, substitute_id, reason=''):
    with get_db() as db:
        sid = db.execute("INSERT INTO product_substitutes (product_id,substitute_id,reason) VALUES (?,?,?)",(product_id,substitute_id,reason)).lastrowid
        db.commit(); return sid


def get_substitutes(product_id):
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT ps.*,p.name,p.sale_price,p.spec FROM product_substitutes ps JOIN products p ON ps.substitute_id=p.id WHERE ps.product_id=? AND ps.is_active=1",(product_id,)).fetchall()]


def set_customer_price(customer_id, product_id, price=None,
                       small_unit_price=None, medium_unit_price=None,
                       large_unit_price=None, updated_at=None):
    """写「客户专属价」（`customer_prices`）—— **只覆盖显式提供的那几列**。

    🔴 为什么不能用裸 `INSERT OR REPLACE`（本函数原写法）：
       SQLite 的 `REPLACE` 在唯一键冲突时语义是「**DELETE 旧行 + INSERT 新行**」，
       **没写进列清单的列一律取建表 DEFAULT** ⇒ 原写法
       `INSERT OR REPLACE INTO customer_prices (customer_id,product_id,price)`
       每写一次就会把 `small_unit_price / medium_unit_price / large_unit_price /
       updated_at` **静默清零**（生产 `tenant_1` 的 8024 行里，有 5702 行这四列本有值）。
       改用 `ON CONFLICT DO UPDATE` 后只 SET 传进来的列，其余保持原值。

    「小单位价」缺省跟随 `price`（反向亦然）—— 生产既有 5702 行两者**恒等**
    （`import_zhoupu.py:246` 写入时同值），保持这一不变量，
    避免产生 `price>0` 而 `small_unit_price=0` 的半残行。

    ⚠️ 消费方 `_check_customer_price`（`domain/pricing_engine.py:501`）按
    「单位专属价 > 0 优先、否则退回通用 `price`」决策 ⇒ **清空任一列都会改变取价结果**，
       所以「部分更新」必须是真部分更新，不能整行重写。
    """
    if price is None and small_unit_price is not None:
        price = small_unit_price
    if small_unit_price is None and price is not None:
        small_unit_price = price
    provided = {"price": price, "small_unit_price": small_unit_price,
                "medium_unit_price": medium_unit_price,
                "large_unit_price": large_unit_price}
    provided = {k: v for k, v in provided.items() if v is not None}
    if not provided:
        return
    if updated_at is None:
        updated_at = time.strftime('%Y-%m-%d %H:%M:%S')
    provided["updated_at"] = updated_at
    cols = ["customer_id", "product_id"] + list(provided.keys())
    vals = [customer_id, product_id] + list(provided.values())
    upd = ", ".join("%s=excluded.%s" % (c, c) for c in provided)
    sql = ("INSERT INTO customer_prices (%s) VALUES (%s) "
           "ON CONFLICT(customer_id,product_id) DO UPDATE SET %s"
           % (",".join(cols), ",".join(["?"] * len(cols)), upd))
    with get_db() as db:
        db.execute(sql, vals)
        db.commit()
    # Invalidate pricing engine cache for this customer+product
    try:
        from domain.pricing_engine import invalidate_price_cache
        invalidate_price_cache(customer_id, product_id)
    except Exception:
        pass  # cache invalidation is best-effort


def get_customer_prices(customer_id):
    with get_db() as db:
        return [dict(r) for r in db.execute("SELECT cp.*,p.name,p.sale_price FROM customer_prices cp JOIN products p ON cp.product_id=p.id WHERE cp.customer_id=?",(customer_id,)).fetchall()]


_CP_SORTS = {
    "customer": "c.name, p.name",
    "product": "p.name, c.name",
    "updated": "cp.updated_at DESC, c.name",
}


def _cp_auto_unit(base, ratio):
    """按商品换算比**推算**某一档的单位价 —— 口径与 `domain/pricing_engine._get_standard_price`
    逐字相同：`round(小单位价 × ratio, 2)`。

    为什么要有它（v229）：三档价**本来就是联动的** —— 用户口径原话「中单位/大单位价可以用
    小单位价反推呀，它们之间的价是联动的」。实证：生产 `tenant_1` 93 个同时有分销价/厂价的
    商品里 **88 个严格命中 `大单位价 = 小单位价 × 换算数 × 0.9`**（0.9 是厂价特有的整箱折扣，
    属厂价链，不是通用三档系数）。⇒ 界面上中/大两档**留空即按此推算**，只有真实存在
    非等比例外价（实测有 0.81 = 两重折扣的样本）才需要手工覆盖。

    🔴 `ratio` 在 `products` 里可能是**空字符串**：
       `typeof` 实测 —— `medium_ratio` 有 272 行是 text `''`（两级商品没有中单位），
       `large_ratio` 有 9 行是 text `''`（赠品物料如「君乐宝凳子」）。
       ⇒ 必须走 `float(x or 0)`：`'' or 0` 得 `0` 才安全，直接 `float('')` 抛 `ValueError`。

    🔴 **不要**改用 SQL 的 `COALESCE(col,0) > 0` 来判断（本轮踩过）：SQLite 的类型优先级是
       NULL < 数字 < **TEXT**，`'' > 0` 判定为**真** —— 实测会把「真的有中单位的 99 个商品」
       误报成 371 个。要判就用 `CAST(COALESCE(col,0) AS REAL) > 0`。

    返回 `None`（而非 0）表示**推不出来** —— 前端据此显示「—」而不是 0.00。
    """
    try:
        b = float(base or 0)
        r = float(ratio or 0)
    except (TypeError, ValueError):
        return None
    if b <= 0 or r <= 0:
        return None
    return round(b * r, 2)


def list_customer_prices(keyword="", customer_id=0, product_id=0, only_priced="",
                         sort="customer", offset=0, limit=50):
    """客户专属价**全局价目表**（界面用）。

    与上面的 `get_customer_prices(customer_id)` 分工不同：
      那个回答「某个客户有哪些专属价」；这个回答「全量价目表长什么样」（分页 + 搜索 + 汇总）。
      生产 `tenant_1` 有 8024 行 / 518 客户 / 65 商品，界面上必须分页看。

    参数：
      keyword     模糊匹配 客户名 / 商品名 / 条码 / 商品编号（任一命中即算）
      customer_id 只看某客户（0 = 不限）｜ product_id 只看某商品（0 = 不限）
      only_priced "1" = 只看「至少一档有价」的行
      sort        customer（默认，按客户名）| product | updated

    返回 `{items, total, summary}`,行内含客户名/商品名/三级价与商品换算比
    —— 一并带回 `large_ratio/medium_ratio` 让前端能算「中/大单位价」的自动联动，
      不必再逐行请求商品档案（避免前端 N+1）。

    v229 增补（三档联动上界面）：
      · 多带 `medium_unit / large_unit`（「组」「件」「提」这些**单位名**）—— 界面上
        「中单位价」这一档要连同单位一起显示，否则用户分不清那格是元/组还是元/件。
      · 多带 `auto_medium / auto_large` = **后端按 `_cp_auto_unit` 算好的推算值**。
        前端只负责显示，不自己算 —— 避免 JS `Math.round`（四舍五入）与 Python `round`
        （银行家舍入）在 `.xx5` 边界上差 0.01，导致「界面显示 2.68、系统实算 2.67」。
      · 汇总多带 `medium_capable_rows / large_capable_rows` = **有中/大单位能力的行数**。
        🔴 这两个数**不等于** `medium_rows/large_rows`（那两列是「库里的专属价填了几行」）。
        生产实测：449 个商品里只有 **99 个是三级商品**（杯→组→件），另 **263 个是两级**
        （瓶→件，`medium_ratio` 是空串）、**87 个单单位** ⇒ 界面对「没有中单位」的商品
        必须显示「该商品无中单位」，不能给一个永远填不出意义的输入框。
    """
    where, params = [], []
    if customer_id:
        where.append("cp.customer_id = ?"); params.append(customer_id)
    if product_id:
        where.append("cp.product_id = ?"); params.append(product_id)
    kw = (keyword or "").strip()
    if kw:
        where.append("(c.name LIKE ? OR p.name LIKE ? OR p.barcode LIKE ? OR p.product_code LIKE ?)")
        like = "%" + kw + "%"
        params += [like, like, like, like]
    if str(only_priced) == "1":
        where.append("(COALESCE(cp.price,0) > 0 OR COALESCE(cp.medium_unit_price,0) > 0 "
                     "OR COALESCE(cp.large_unit_price,0) > 0)")
    w = (" WHERE " + " AND ".join(where)) if where else ""
    base = (" FROM customer_prices cp"
            " LEFT JOIN contacts c ON cp.customer_id = c.id"
            " LEFT JOIN products p ON cp.product_id = p.id" + w)
    order = _CP_SORTS.get(sort, _CP_SORTS["customer"])
    lim = max(1, min(int(limit or 50), 500))
    off = max(0, int(offset or 0))
    with get_db() as db:
        total = db.execute("SELECT COUNT(*)" + base, params).fetchone()[0]
        rows = db.execute(
            "SELECT cp.customer_id, cp.product_id, cp.price, cp.small_unit_price,"
            " cp.medium_unit_price, cp.large_unit_price, cp.updated_at,"
            " c.name AS customer_name, c.code AS customer_code,"
            " p.name AS product_name, p.barcode AS barcode, p.spec AS spec,"
            " p.unit AS unit, p.large_unit AS large_unit, p.medium_unit AS medium_unit,"
            " p.large_ratio AS large_ratio, p.medium_ratio AS medium_ratio"
            + base + " ORDER BY " + order + " LIMIT ? OFFSET ?",
            params + [lim, off]).fetchall()
        s = db.execute(
            "SELECT COUNT(*) AS total_rows,"
            " SUM(CASE WHEN COALESCE(cp.price,0) > 0 THEN 1 ELSE 0 END) AS priced_rows,"
            " SUM(CASE WHEN COALESCE(cp.medium_unit_price,0) > 0 THEN 1 ELSE 0 END) AS medium_rows,"
            " SUM(CASE WHEN COALESCE(cp.large_unit_price,0) > 0 THEN 1 ELSE 0 END) AS large_rows,"
            # 🔴 用 CAST(... AS REAL) 而不是 `COALESCE(col,0) > 0` —— 换算比列里存着 text `''`，
            #    而 SQLite 的 ''(TEXT) > 0(INTEGER) 判定为**真**，会把无中单位的行也算进来。
            " SUM(CASE WHEN CAST(COALESCE(p.medium_ratio,0) AS REAL) > 0 THEN 1 ELSE 0 END) AS medium_capable_rows,"
            " SUM(CASE WHEN CAST(COALESCE(p.large_ratio,0) AS REAL) > 0 THEN 1 ELSE 0 END) AS large_capable_rows,"
            " COUNT(DISTINCT cp.customer_id) AS customers,"
            " COUNT(DISTINCT cp.product_id) AS products" + base, params).fetchone()
    items = []
    for r in rows:
        d = dict(r)
        # 推算基准 = 小单位价（缺则退回通用 price）—— 与 `_check_customer_price` 的取价顺序一致。
        base_price = d.get("small_unit_price") or d.get("price") or 0
        d["auto_medium"] = _cp_auto_unit(base_price, d.get("medium_ratio"))
        d["auto_large"] = _cp_auto_unit(base_price, d.get("large_ratio"))
        items.append(d)
    return {"items": items, "total": total,
            "summary": dict(s) if s else {}, "offset": off, "limit": lim}


def quotation_create(customer_id, items, note="", operator_id=""):
    with get_db() as db:
        total = sum(it.get("quantity",0)*it.get("unit_price",0) for it in items)
        no = _gen_no("QT")
        qid = db.execute("INSERT INTO quotations (order_no,customer_id,total_amount,status,note,operator_id) VALUES (?,?,?,?,?,?)",
                         (no,customer_id,total,"draft",note,operator_id)).lastrowid
        for it in items:
            db.execute("INSERT INTO quotation_items (quotation_id,product_name,quantity,unit_price,amount) VALUES (?,?,?,?,?)",
                       (qid,it.get("product_name",""),it.get("quantity",0),it.get("unit_price",0),it.get("quantity",0)*it.get("unit_price",0)))
        db.commit(); return {"id":qid,"order_no":no,"total":total}


def quotation_convert_to_order(qid, operator_id="", idempotency_key=None):
    from erp_db import idempotency_get, idempotency_put
    # Q3 (2026-07-25): client idempotency key — replaying a conversion returns the
    # sale order that was originally created (no second order).
    if idempotency_key:
        ex = idempotency_get(idempotency_key)
        if ex and ex[0] == 'quotation':
            return {'order_id': ex[1], 'order_no': ex[2], 'idempotent': True}
    with get_db() as db:
        q = db.execute("SELECT * FROM quotations WHERE id=?",(qid,)).fetchone()
        if not q: return {"error":"报价单不存在"}
        items = [dict(r) for r in db.execute("SELECT * FROM quotation_items WHERE quotation_id=?",(qid,)).fetchall()]
        r = sale_order_create(q["customer_id"], [{"product_name":it["product_name"],"quantity":it["quantity"],"unit_price":it["unit_price"]} for it in items], 1, 0, q["note"] or "", operator_id)
        db.execute("UPDATE quotations SET status='converted' WHERE id=?",(qid,))
        db.commit()
    if idempotency_key:
        idempotency_put(idempotency_key, 'quotation', r.get('order_id'), r.get('order_no', ''))
    return r

# ===== v74: Sales Funnel (销售漏斗) =====

def get_last_prices(product_id):
    with get_db() as db:
        last_sale = db.execute("SELECT soi.unit_price,so.order_date FROM sale_order_items soi JOIN sale_orders so ON soi.order_id=so.id WHERE soi.product_id=? ORDER BY so.id DESC LIMIT 1",(product_id,)).fetchone()
        last_purchase = db.execute("SELECT poi.unit_price,po.order_date FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id WHERE poi.product_id=? ORDER BY po.id DESC LIMIT 1",(product_id,)).fetchone()
        return {"last_sale_price":last_sale[0] if last_sale else 0,"last_sale_date":last_sale[1] if last_sale else "","last_purchase_price":last_purchase[0] if last_purchase else 0,"last_purchase_date":last_purchase[1] if last_purchase else ""}

def get_last_sale_prices_by_customer(limit=500):
    """Get last sale price per customer+product combo (like 舟谱)."""
    with get_db() as db:
        rows = db.execute("""
            SELECT c.name AS customer_name, c.code AS customer_code,
                   p.name AS product_name, p.product_code,
                   soi.unit_price AS small_unit_price,
                   so.order_date AS last_sale_date,
                   p.unit, p.medium_unit, p.medium_ratio, p.large_unit, p.large_ratio
            FROM sale_order_items soi
            JOIN sale_orders so ON soi.order_id=so.id
            JOIN contacts c ON so.customer_id=c.id
            JOIN products p ON soi.product_id=p.id
            WHERE soi.id IN (
                SELECT MAX(soi2.id) FROM sale_order_items soi2
                JOIN sale_orders so2 ON soi2.order_id=so2.id
                GROUP BY so2.customer_id, soi2.product_id
            )
            ORDER BY so.order_date DESC
            LIMIT ?
        """, (limit,)).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            sp = d.get('small_unit_price', 0) or 0
            ratio = d.get('medium_ratio', 0) or 0
            lratio = d.get('large_ratio', 0) or 0
            d['medium_unit_price'] = round(sp * ratio, 2) if ratio else 0
            d['large_unit_price'] = round(sp * lratio, 2) if lratio else 0
            results.append(d)
        return results

def get_last_purchase_prices_by_supplier(limit=500):
    """Get last purchase price per supplier+product combo."""
    with get_db() as db:
        rows = db.execute("""
            SELECT c.name AS supplier_name, c.code AS supplier_code,
                   p.name AS product_name, p.product_code,
                   poi.unit_price AS small_unit_price,
                   po.order_date AS last_purchase_date,
                   p.unit, p.medium_unit, p.medium_ratio, p.large_unit, p.large_ratio
            FROM purchase_order_items poi
            JOIN purchase_orders po ON poi.order_id=po.id
            JOIN contacts c ON po.supplier_id=c.id
            JOIN products p ON poi.product_id=p.id
            WHERE poi.id IN (
                SELECT MAX(poi2.id) FROM purchase_order_items poi2
                JOIN purchase_orders po2 ON poi2.order_id=po2.id
                GROUP BY po2.supplier_id, poi2.product_id
            )
            ORDER BY po.order_date DESC
            LIMIT ?
        """, (limit,)).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            sp = d.get('small_unit_price', 0) or 0
            ratio = d.get('medium_ratio', 0) or 0
            lratio = d.get('large_ratio', 0) or 0
            d['medium_unit_price'] = round(sp * ratio, 2) if ratio else 0
            d['large_unit_price'] = round(sp * lratio, 2) if lratio else 0
            results.append(d)
        return results

# v37 migrations
try:
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS price_schemes (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,margin_pct REAL DEFAULT 0,description TEXT,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS credit_control_schemes (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,credit_limit REAL DEFAULT 0,credit_days INTEGER DEFAULT 0,freeze_days INTEGER DEFAULT 30,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS unit_archive (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS business_types (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS account_types (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS asset_types (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS adjustment_types (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS settlement_periods (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,is_active INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS custom_fields (id INTEGER PRIMARY KEY AUTOINCREMENT,module TEXT,field_name TEXT,field_label TEXT,field_type TEXT DEFAULT 'text',options TEXT,sort_order INTEGER DEFAULT 0,is_system INTEGER DEFAULT 0,UNIQUE(module,field_name));
            CREATE TABLE IF NOT EXISTS opening_balances (id INTEGER PRIMARY KEY AUTOINCREMENT,balance_type TEXT,contact_id INTEGER,amount REAL,ref_no TEXT,balance_date TEXT DEFAULT (date('now','localtime')),created_at TEXT DEFAULT (datetime('now','localtime')));
        """)
        # Seed data
        if not db.execute("SELECT id FROM unit_archive LIMIT 1").fetchone():
            for u in ["件","箱","瓶","袋","桶","盒","个","公斤","升","条"]:
                db.execute("INSERT INTO unit_archive (name) VALUES (?)",(u,))
        if not db.execute("SELECT id FROM price_schemes LIMIT 1").fetchone():
            db.execute("INSERT INTO price_schemes (name,margin_pct,description) VALUES ('标准售价',0,'基础售价方案'),('促销价',-10,'降价10%'),('VIP专属价',-5,'VIP客户优惠5%')")
        if not db.execute("SELECT id FROM credit_control_schemes LIMIT 1").fetchone():
            db.execute("INSERT INTO credit_control_schemes (name,credit_limit,credit_days,freeze_days) VALUES ('标准信用',5000,30,30),('宽松信用',10000,60,45),('严格信用',2000,15,15)")
        if not db.execute("SELECT id FROM business_types LIMIT 1").fetchone():
            for b in ["销售","退货","换货","赠送","报损","调拨"]:
                db.execute("INSERT INTO business_types (name) VALUES (?)",(b,))
        if not db.execute("SELECT id FROM account_types LIMIT 1").fetchone():
            for a in ["资产类","负债类","权益类","收入类","成本类","费用类"]:
                db.execute("INSERT INTO account_types (name) VALUES (?)",(a,))
        if not db.execute("SELECT id FROM asset_types LIMIT 1").fetchone():
            for a in ["车辆","办公设备","电子设备","房屋建筑物","其他"]:
                db.execute("INSERT INTO asset_types (name) VALUES (?)",(a,))
        if not db.execute("SELECT id FROM adjustment_types LIMIT 1").fetchone():
            for a in ["应收冲应收","应收冲应付","预收冲应收","预付冲应付","其他"]:
                db.execute("INSERT INTO adjustment_types (name) VALUES (?)",(a,))
        if not db.execute("SELECT id FROM settlement_periods LIMIT 1").fetchone():
            for s in ["周结","半月结","月结","季结","年结","自定义"]:
                db.execute("INSERT INTO settlement_periods (name) VALUES (?)",(s,))
        db.commit()
except Exception as _e:
    import sys; log_migration_warn(_e)


def sale_order_reject(oid, operator_id=''):
    """Reject a sale order: set status to rejected.

    🔴 v532b 修本函数三处既有真实缺陷（此前必然 500 / 静默 `None`）：
      ① **`updated_at` 列根本不存在**：原 SQL 是
         `UPDATE sale_orders SET status='rejected', operator_id=?, updated_at=datetime('now','localtime')`，
         而**全仓没有任何迁移建过 `sale_orders.updated_at`**（建表语句里也没有）
         ⇒ 每次调用都 `sqlite3.OperationalError: no such column: updated_at`。
         🔴 修法是**删掉这段赋值，而不是去加列**：为一条从来没被读过的列在生产库上
         跑 migrate，风险远大于收益。销售单的时间戳口径就是 `order_date`/`created_at`。
      ② **没有 `return`**：成功时返回 `None`，调用方（批量端点）无法区分"成了"和"返回了个空"。
         现与 `sale_order_cancel` 同构：成功 `{"order_id","order_no","status"}`。
      ③ **状态闸门只住在路由层**（`routers/sales.py` 的 `reject_sale`），db 层裸奔
         ⇒ 任何一个绕过该路由的调用方（批量端点就是）都能把已签收单改成 rejected。
         闸门下沉进这里，成为唯一判据；失败返回 `{"error": ...}`（与 cancel 同口径）。

    ⚠️ 用 `get_db()` + 显式 `commit()`（与原本一致），**不要顺手改成 `get_db_tx()`**
       —— 事务语义变化属于另一件事，而且 `log_entity_changes` 在 commit 之后。
    """
    with get_db() as db:
        o = db.execute("SELECT order_no, status FROM sale_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {"error": "订单不存在"}
        if o["status"] not in ("draft", "pending_approval"):
            return {"error": "状态错误：只有草稿或待审批状态的订单才能拒绝"}
        db.execute("UPDATE sale_orders SET status='rejected', operator_id=? WHERE id=?", (operator_id, oid))
        db.commit()
        # v107.116: 审计日志
        try: log_entity_changes('sale_order', oid, operator_id, [('status', o["status"], 'rejected')], action='reject')
        except Exception: pass
        return {"order_id": oid, "order_no": o["order_no"], "status": "rejected"}

def check_active_promotions(items):
    """Auto-apply active promotions to sale items. Returns (modified items, applied list)."""
    with get_db() as db:
        today = db.execute("SELECT date('now')").fetchone()[0]
        promos = db.execute(
            "SELECT p.* FROM promotions p WHERE p.is_active=1 AND p.start_date<=? AND p.end_date>=?",
            (today, today)
        ).fetchall()
        if not promos:
            return items, []

        applied = []
        for promo in promos:
            promo = dict(promo)
            ptype = promo.get('promo_type', 'discount')
            discount_pct = float(promo.get('discount_pct', 0) or 0)
            buy_qty = int(promo.get('buy_qty', 0) or 0)
            free_qty = int(promo.get('free_qty', 0) or 0)
            gift_name = promo.get('gift_product_name', '')

            # Get linked product IDs
            linked = db.execute("SELECT product_id FROM promotion_items WHERE promotion_id=?", (promo['id'],)).fetchall()
            linked_ids = set(r[0] for r in linked) if linked else set()

            for item in items:
                pid = item.get('product_id', 0)
                qty = int(float(item.get('quantity', 0)))
                uprice = float(item.get('unit_price', 0))

                if linked_ids and pid not in linked_ids:
                    continue  # promotion is product-specific and this item doesn't match

                if ptype == 'discount' and discount_pct > 0:
                    new_price = round(float(uprice) * (1 - discount_pct / 100.0), 2)
                    item['unit_price'] = new_price
                    item['amount'] = round(qty * new_price, 2)
                    applied.append({"type": "discount", "promo_name": promo['name'], "product_id": pid, "promotion_id": promo['id']})

                elif ptype == 'buy_x_free_y' and buy_qty > 0 and qty >= buy_qty and free_qty > 0:
                    free_item = {
                        "product_id": pid, "product_name": gift_name or (item.get('product_name', '') + ' (赠品)'),
                        "quantity": free_qty, "unit_price": 0, "amount": 0,
                        "note": "买赠活动"
                    }
                    items.append(free_item)
                    applied.append({"type": "free_item", "promo_name": promo['name'], "product_id": pid, "promotion_id": promo['id']})

                elif ptype == 'gift' and gift_name:
                    # Gift product — use the gift_product_name to find or create a gift line
                    gift_prod = db.execute("SELECT id, sale_price FROM products WHERE name=? LIMIT 1", (gift_name,)).fetchone()
                    if gift_prod:
                        gift_item = {
                            "product_id": gift_prod[0], "product_name": gift_name,
                            "quantity": int(promo.get('gift_qty', 1) or 1), "unit_price": 0, "amount": 0,
                            "note": "买赠活动"
                        }
                        items.append(gift_item)
                        applied.append({"type": "gift", "promo_name": promo['name'], "product_id": gift_prod[0], "promotion_id": promo['id']})

        return items, applied

# ============================================================
# v38: 组合规则、增减方式
# ============================================================

