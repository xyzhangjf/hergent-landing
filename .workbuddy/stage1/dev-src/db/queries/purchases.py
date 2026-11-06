"""Purchase order queries."""
import datetime
import re
from contextlib import nullcontext
from db.connection import get_db, get_db_tx, _gen_no
from db.queries.inventory import inventory_adjust
# v409（P2-1）：数量换算的**唯一实现**。本文件绝不自己写 `× medium_ratio` —— 换算比在库里
#   是混类型列（空串），各写一份就会在「算不出时怎么办」上分岔且零报错地给出不同数。
from db.queries.units import (
    ratio_to_base, base_qty_of, unit_options, default_tier, conversion_text, norm_ratio,
)
# 阶段 1（第 3 项）：状态跃迁白名单的唯一源（见 `db/queries/doc_state.py`）。
from db.queries.doc_state import (check_transition, guard_sql, status_label,
                                 IllegalTransition, _phase, editable_fields,
                                 status_token_clause)
# v415（P2-7）：采购单「自定义字段」—— 定义层与校验层**复用**报单矩阵那套唯一实现
#   （`db/queries/forecast_columns.py`），本文件**只负责把值落进/读出 `purchase_orders.extra_json`**。
#   🔴 绝不在这里另写一份"字段存不存在 / 值是不是数字"的校验 —— 抄两份必然在边界上分岔。
import json
from db.queries.forecast_columns import MODULE_PURCHASE_ORDERS, validate_extra, load_extra
import logging
_logger = logging.getLogger(__name__)

# 采购单审批阈值默认值（元）：system_config 缺失、缺行或值不是整数时的兜底
DEFAULT_APPROVAL_THRESHOLD = 5000


def _poi_base_qty(itd):
    """明细行**入库 / 记账口径**的数量 = 折小单位数量（`base_qty`），没有则回退 `quantity`。

    v409（P2-1）：采购允许按小 / 中 / 大三档下单后，`quantity` 的量纲**随档位变**
    （1 件 / 8 包 / 40 袋是同一批货），所以凡是要进库存、进批次的地方都必须用
    **同一个量纲**（小单位）记账，否则库存是混着加的 —— 交易系统里这是真金白银的错。

    🔴 回退**只**发生在「这行没填单位 / 换不出比值」的老行上（v409 之前建的单，
       或导入器建的）：那时 `quantity` 本身就是唯一量纲 ⇒ 回退它 = 与改动前
       **逐字一致**（不是近似一致，是同一条 SQL 同一个数）。
    🔴 为什么不把 `base_qty` 为 0 直接当 0 返回：`base_qty` 是「未折算」的哨兵值，
       当 0 用会让老单入库**少进全部货**（静默且致命）；必须回退。
    """
    try:
        b = float(itd.get("base_qty") or 0)
    except (TypeError, ValueError):
        b = 0.0
    if b > 0:
        return b
    return itd.get("quantity") or 0


def _poi_base_price(itd):
    """明细行**入库成本单价** = 折小单位单价（`unit_price / unit_ratio`）。

    v409（P2-1）：与 `_poi_base_qty` 成对使用 —— 数量折成小单位后，单价**必须同折**，
    否则进到 `inventory.cost_price` 的是「元 / 件」却被当成「元 / 袋」用。

    🔴 乘回来仍等于原行金额：`(qty × ratio) × (price ÷ ratio) == qty × price`
       ⇒ 「订单金额 / 应付 / 收货金额」这些**金额口径一个字都不变**，变的只是
       库存的**量纲**（从"按所选单位"统一成"按小单位"）。
    🔴 `unit_ratio` 为 0（老行 / 换不出）⇒ 回退原 `unit_price` ⇒ 与改动前**逐字一致**。
    """
    try:
        p = float(itd.get("unit_price") or 0)
        r = float(itd.get("base_ratio") or 0)
    except (TypeError, ValueError):
        return itd.get("unit_price") or 0
    if r <= 0:
        return itd.get("unit_price") or 0
    return round(p / r, 6)


def _poi_ratio(itd):
    """明细行换算比的**快照读取口**（1 个所选单位 = ratio 个小单位）。

    v414（P2-6）：退货要把「已入库 / 已退」统一到小单位，就得有这行的比值。优先级：
      ① `base_ratio` —— v409 建单时按档案**现算并快照**下来的，最可靠；
      ② 反推 `base_qty / quantity` —— 老行（v409 之前）/ 快照缺失时的兜底，
         两者本就等价（`base_qty` 就是 `quantity × ratio` 的产物）；
      ③ 都拿不到 ⇒ 返回 **0**（调用方必须把 0 当「未折算」，回退原量纲 —— 不能当 1）。

    🔴 为什么**不**现查 `products.large_ratio/medium_ratio`：换算是**下单那一刻的事实**。
       商品档案后来改了比值，退货时再查档案会与「入库时到底进了多少」对不上。
       唯一实现仍是 `db/queries/units.py`（建单时算的），这里只读它的产物。
    """
    try:
        r = float(itd.get("base_ratio") or 0)
    except (TypeError, ValueError):
        r = 0.0
    if r > 0:
        return r
    try:
        q = float(itd.get("quantity") or 0)
        b = float(itd.get("base_qty") or 0)
    except (TypeError, ValueError):
        return 0.0
    if q > 0 and b > 0:
        return round(b / q, 6)
    return 0.0


def _poi_received_base_qty(itd, status=''):
    """明细行**已入库**数量（统一到**小单位**）。

    v414（P2-6）：退货上限 = 「已入库 − 已退」，而这两个数在库里**量纲不同**：
      · `purchase_order_items.received_qty` = 与 `quantity` **同单位**（v404 刻意不折 ——
        `ap_invoice_match` 要用 `received_qty × unit_price` 还原金额）；
      · `purchase_return_items.quantity` = 提交时传的**小单位**（与 `inventory_adjust` 同量纲）。
    ⇒ 不折算直接相减 = 拿「件」减「袋」，得到的是错的数**且零报错**。

    口径（与 `purchase_order_confirm` 写库时**逐字对齐**）：
      · `status='received'`（整单全收，`received_qty` 为空/0 的历史单）⇒ 每行 = `_poi_base_qty(itd)`
        —— `confirm` 正是逐行 `batch_in(_poi_base_qty)`；
      · `received_qty > 0` ⇒ 折小单位（`_poi_ratio` 为 0 的老行回退 `received_qty`，
        与写库时**同一份**回退规则）；
      · 其余 ⇒ 0。
      ⚠️ `returned` **不能**一概当 0：v408（P0-3）的口径是「只要有退货就落 `returned`」，
         部分退货的单也会变 `returned`，而行上确实进过货 —— 一律给 0 会让「还能退多少」
         恒为 0，界面看起来像"退完了"，其实还有余量（**静默假否定**）。
         ⇒ 所以判据是 `received_qty` 与 `status` 的组合，不是单看状态。
    """
    try:
        rq = float(itd.get("received_qty") or 0)
    except (TypeError, ValueError):
        rq = 0.0
    if rq > 0:
        r = _poi_ratio(itd)
        return round(rq * r, 4) if r > 0 else rq
    if str(status or '').strip() == 'received':
        return _poi_base_qty(itd)
    return 0.0


# v410（P2-3）：「最后操作 / 最后打印 人 + 时间」的**列名对**。
#   🔴 为什么列名叫 `last_op_*` 而不是 `last_modified_*`：舟谱那两列叫「最后操作人 /
#   最后操作时间」，与用户对账时指着同一个词说事，造一个新词只会让两边对不上号。
_PO_STAMP_COLS = {
    "op":    ("last_op_at", "last_op_by"),
    "print": ("last_print_at", "last_print_by"),
}


def _po_stamp_insert(op_id='', kind='op'):
    """`_po_stamp` 的 **INSERT 形态**：返回 `(列名列表, VALUES 表达式列表, 参数列表)`。

    🔴 为什么要另一个函数：`INSERT` 里没法把 `datetime('now','localtime')` 当**参数**传
    （会落成字面量字符串 `datetime('now','localtime')` —— 一个假时间，且看起来像真的），
    只能把它写进 VALUES 的**表达式位**。所以这里返回"要拼进 SQL 的文本"，
    而 `_po_stamp` 返回"SET 子句"。
    ⚠️ 两者共用 `_PO_STAMP_COLS` 这一个列名源 ⇒ 将来改列名不会只改一处。
    ⚠️ "没传操作人 ⇒ 整对不盖"这条纪律两个形态**必须一致**（理由见 `_po_stamp`）。
    """
    _oid = str(op_id or '').strip()
    if not _oid:
        return ([], [], [])
    _at, _by = _PO_STAMP_COLS['print' if kind == 'print' else 'op']
    return ([_at, _by], ["datetime('now','localtime')", "?"], [_oid])


def _po_stamp(op_id='', kind='op'):
    """🔴 「最后操作 / 最后打印」盖章 SQL 片段的**唯一实现**。返回 `(set_sql, params)`。

    用法（**参数顺序不可换**——SET 在 WHERE 之前，所以 `params` 必须排在 WHERE 参数前面）：

        _st, _sp = _po_stamp(operator_id)
        db.execute("UPDATE purchase_orders SET status='cancelled'"
                   + (", " + _st if _st else "")
                   + " WHERE id=? AND ...", _sp + [oid])

    为什么做成"返回片段"而不是"替你执行一条 UPDATE"：九个埋点的 SET / WHERE 各不相同
    （有的 `WHERE id=?`、有的 `WHERE id IN (...)`、还要各自拿 `rowcount` 判命中），
    替它们执行就得把 rowcount 语义也接管了；而做成片段可以让盖章**与主 UPDATE 同一条语句**
    —— 一次 `db.execute` 完成，不存在"状态改了、章没盖"的中间态。

    🔴 **`op_id` 为空 ⇒ 返回空片段（连时间都不写）**，不是"时间照写、人留空"：
       · 「最后操作人」与「最后操作时间」是同一件事的两半，缺一半就会出现
         「有最后操作时间、操作人却是空」这种**自相矛盾**的行 —— v408 P1-7 在审核人上
         已经吃过一次这个亏（只清时间不清人 ⇒ 库里出现没有审核时间却写着审核人的行）。
       · `op_id` 为空只可能来自**还没适配 v410 的调用方**（老前端 / 小程序 / 舟谱导入器 /
         `batch-create`）。对它们不盖章 = 与改动前**逐字一致**；宁可列表显示 `—`
         （如实表达"没记"），也不把上一次的操作人**抹成空**。
    🔴 只存 **id** 不存名字（与 `auditor_id` 同一套纪律）：名字会改，落库即与主库漂移；
       显示名统一由端点层 `_creator_names` 现解析。
    ⚠️ 谁都不许在别处手写 `last_op_at=datetime(...)` —— 那等于抄第二份规则，
       将来改口径（比如打印要不要也算一次操作）必然改漏一处且零报错。
    """
    _oid = str(op_id or '').strip()
    if not _oid:
        return ('', [])
    _at, _by = _PO_STAMP_COLS['print' if kind == 'print' else 'op']
    return ("%s=datetime('now','localtime'), %s=?" % (_at, _by), [_oid])


_PREPAID_COL_READY = [False]


def _ensure_prepaid_column():
    """幂等给 `purchase_orders` 加 `prepaid_amount`（v697）。

    ⚠️ **不在模块导入时调用**：导入期执行 DDL 会让「导入这个模块」带副作用，
       而且那时连接池/租户上下文未必就绪。改为在**第一次真的要写预付款**时懒执行
       （`purchase_prepayment_create` 开头），并用模块级标志位保证一个进程只跑一次。
    ⚠️ 老租户库不会走建表语句（那只在空库执行）⇒ 必须靠 ALTER 补齐，这就是本函数存在的理由。
    """
    if _PREPAID_COL_READY[0]:
        return
    try:
        with get_db() as db:
            cols = {r[1] for r in db.execute("PRAGMA table_info(purchase_orders)").fetchall()}
            if "prepaid_amount" not in cols:
                db.execute("ALTER TABLE purchase_orders ADD COLUMN prepaid_amount REAL DEFAULT 0")
                db.commit()
                _logger.info("v697: purchase_orders.prepaid_amount 已新增")
        _PREPAID_COL_READY[0] = True
    except Exception as e:  # pragma: no cover
        # 不置 True：下次调用重试（列缺失不该变成永久禁用预付款）
        _logger.warning("_ensure_prepaid_column failed: %s", e)


def purchase_order_create(supplier_id, items, warehouse_id=1, note='', operator_id='', expected_date='', order_no='', order_date='', status='', db_conn=None,
                          source='', audit_time='', handler='', department_id=0, extra=None):
    """建一张采购单 + 明细。返回 `{'order_id','order_no','total_amount'}`；
    单号已存在时返回 `{'existed':True,...}`。

    v107.146: +expected_date(预计到货日期) — 引擎表单已提交该字段

    v313（2026-09-28，邮件对账 M0）新增 4 个参数，**默认值 = 原行为**，既有调用方零影响：

    · `order_no` — 非空则用它（外部系统的原单号）+ **按单号查重**（幂等）。
      🔴 为什么必须加：本函数原先**只能**用 `_gen_no("PO")` 自造单号，外部系统那张单的原始单号
      **无处可存** ⇒ 同一份文件传两次就会**再建一遍单**（重复计采购成本 + 污染 P&L）。
      范式照抄 `sale_order_create` 的 v268 实现（含 UNIQUE 约束兜底查重）。

    · `order_date` — 非空则写进 `order_date` 列。🔴 导入历史单据**必须传**：
      不传就落表默认值 `datetime('now')` ⇒ 8 月的单全部变成「今天」，按期间对账直接错位。

    · `status` — 非空则**跳过审批阈值判定**，直接用这个状态。
      🔴 为什么导入必须传：默认逻辑是 `'pending_approval' if total >= 阈值(默认 5000) else 'draft'`。
      导入 62 张历史单会让 `pending_approval` 堆 62 条（用户看到一屏待审批，且 `get_pnl` 不认它们）。
      导入方传 `'received'`（舟谱「订单状态=已完成」+ 有入库数量 ⇒ 已收货是事实陈述）。
      ⚠️ 副作用须知：`get_pnl()` 用 `status='received'` 统计采购成本 ⇒ 导入后 P&L 会把这些单算进去。

    · `db_conn` — 复用调用方连接、**不自行 commit**，事务边界归调用方（导入分批提交用）。

    · items 每项现在是 `{product_id|product_name, quantity, unit_price, amount?, unit?, note?}`：
      · `amount` 非空 ⇒ 用它做本行金额与合计（**权威金额**），不再用 `quantity*unit_price` 现算。
        🔴 实测（2026-08 采购明细 1,134 行）：`Σ(入库数量×采购价) = 936,604.87` 而舟谱给的
        **「采购入库金额」合计 = 936,599.78**，差 **¥5.09**，45 行有差（单行最大 ¥0.48）——
        因为「采购价」是 4 位小数、行金额是四舍五入后的值。做**金额对账**时这点差就是 45 行假差异。
      · `unit` 非空 ⇒ 同时写进 `purchase_order_items.unit`（v313 新增列）。

    v392（2026-10-07，进销存批次 5 前置）：明细行**透传批次三列**
    `batch_no` / `expiry_date` / `production_date`（列在 `purchase_order_items` 表里早就存在）。

    🔴 为什么此前「填了等于没填」：本函数原先的明细 INSERT 只写
      `order_id/product_id/quantity/unit_price/amount/unit` **六列**；而 `purchase_order_confirm`
      入库时**从明细行读** `batch_no`/`expiry_date` 送给 `batch_in(...)` ⇒ 上游传了也被**静默丢弃**。
      生产实测后果：`inventory` 54 行的 `batch_no`/`expiry_date` **100% 为空** ⇒
      低温奶的「临期预警 / FEFO 先进先出 / 报损」全部没有数据基础。
    ⚠️ 语义：**字段为空则不加列** ⇒ 不传时 SQL 与行为与改动前逐字一致；传了则**如实落库**。
      `expiry_date` 为空的后果由 `confirm` 承担（落 `''` ⇒ 该批次进「无到期日」桶），
      前端（批次 5）因此把「批次号 + 到期日」做成**必填**。

    v403（2026-10-08，采购订单重塑）再补 2 个参数，**默认值 = 原行为**，既有调用方零影响：

    · `source` — 单据来源。取 `manual`（界面手动建单）/ `zhoupu`（舟谱导入）/ `ai`（AI 开单）。
      🔴 为什么要它：生产 81 张单里有 **79 张是舟谱导入**（`CD` 前缀），它们**只有表头、没有明细行**
      （旧导入器 `import_zhoupu.py` 直接裸 INSERT 表头）。界面要区分「这单为什么没有订单数量」，
      靠单号前缀猜是脆弱做法；落成显式列才能如实告知用户。

    · `audit_time` — 审核时间（列名与 `sale_orders.audit_time` 同一套叫法，不新造词）。
      舟谱的采购单导出**带这一列**，导入时如实落库；界面手动建单走 `purchase_order_approve` 写。

    ⚠️ 参数顺序：这两个排在 **`db_conn` 之后**（而不是之前）是**刻意的** —— 全仓
      `purchase_order_create` 的调用方从没超过 5 个位置参数，追加在末尾可证明不会挪动任何既有
      位置参数的下标；插在 `db_conn` 之前则要求「所有调用方都用关键字传 `db_conn`」这一前提永远成立。
      代价只是可读性略差，换的是「不可能静默改坏调用方」。

    v415（2026-10-09，P2-7）再补 1 个参数，**默认值 = 原行为**，既有调用方零影响：

    · `extra` — 采购单的**自定义字段值**（`{字段key: 值}`），落在 `purchase_orders.extra_json`。
      🔴 **同一个事务里随单写入**，不另开一次写接口 —— 两次写会出现「单建成了、自定义字段
         没落库」的半截状态，而用户看到的是"保存成功"（静默半截）。
      🔴 校验（key 是否登记过 / 值是不是数字 / 超长）**复用** `validate_extra`，
         本函数不自己写一份（抄两份必然在边界上分岔）。
      ⚠️ 沿用本函数第六次的「**空则不加列**」范式（前五次：批次三列 v392、表头 handler
         v408、行 note v408、明细 base_ratio 表 v409、last_op 四列 v410）⇒ 不传 `extra`
         时 SQL 与改动前**逐字一致**，老前端 / 小程序 / 舟谱导入器走的路径一个字符没变。
      ⚠️ 值为 `None` 的键在**建单**时等价于"没填" ⇒ 直接不写（与 `set_values` 的
         "清空该键"语义不同，因为新建时不存在"原来有值"这回事）。
    """
    no = str(order_no or '').strip()
    if no:
        # 查重走同一连接：否则读不到本批未提交的已插单据（同号会各建一张单）。
        try:
            with (nullcontext(db_conn) if db_conn is not None else get_db()) as _dq:
                _ex = _dq.execute("SELECT id,total_amount FROM purchase_orders WHERE order_no=? LIMIT 1", (no,)).fetchone()
            if _ex:
                return {'order_id': _ex['id'] if hasattr(_ex, 'keys') else _ex[0],
                        'order_no': no,
                        'total_amount': float(_ex['total_amount'] or 0) if hasattr(_ex, 'keys') else 0.0,
                        'existed': True}
        except Exception as e:
            _logger.warning(f"purchase_order_create 按 order_no 查重失败，继续建单: {e}")
    if not no:
        no = _gen_no("PO")

    def _line_amount(it):
        a = it.get('amount')
        return float(a) if a is not None else it['quantity'] * it['unit_price']

    total = sum(_line_amount(it) for it in items)
    st = str(status or '').strip()
    if not st:
        # Approval threshold: read from system_config table, default ¥5000
        try:
            with get_db() as conn:
                r = conn.execute("SELECT value FROM system_config WHERE key='approval_threshold'").fetchone()
                threshold = int(r['value']) if r else DEFAULT_APPROVAL_THRESHOLD
        except Exception:
            # 旧写法是裸 `except:`：DB 不可用 / 值非数字都静默回落，可能让本应审批的单直接过。
            # 这里保留兜底（不能因为读配置失败就拒绝建单），但必须留痕以便发现配置漂移。
            _logger.warning(
                "读取 approval_threshold 失败，按默认阈值 %d 元判定审批状态",
                DEFAULT_APPROVAL_THRESHOLD, exc_info=True,
            )
            threshold = DEFAULT_APPROVAL_THRESHOLD
        st = 'pending_approval' if total >= threshold else 'draft'
    # v417（B 语义「保存并审核」）：`status='confirmed'` 且未传审核时间 ⇒ 自己审自己，
    # 自动填审核时间(now)，审核人(auditor_id)在下方写列时记为操作人(operator_id)。
    if st == 'confirmed' and not str(audit_time or '').strip():
        audit_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # v415（P2-7）自定义字段：**在建单之前**整体校验（未知 key / 非数字 / 超长 → 抛 ValueError，
    #   路由层转 400）。放在 `with get_db()` **外面**是刻意的 ——
    #   ① 校验失败时一行都不落（建单要么整体成立、要么什么都没发生）；
    #   ② 避免在已持有连接的块里再开一个连接去读注册表（嵌套 `get_db()` 会另开 throwaway 连接，
    #      读不到本事务未提交的写入 —— 将来若有人改成"先建单后写字段"就会踩这个坑）。
    _extra = {}
    if extra:
        _extra = {k: v for k, v in validate_extra(MODULE_PURCHASE_ORDERS, extra).items()
                  if v is not None}
    with (nullcontext(db_conn) if db_conn is not None else get_db()) as db:
        _cols = ["order_no", "supplier_id", "warehouse_id", "total_amount", "note",
                 "operator_id", "status", "expected_date"]
        _vals = [no, supplier_id, warehouse_id, total, note, operator_id, st, expected_date]
        if str(order_date or '').strip():
            _cols.append("order_date")
            _vals.append(str(order_date).strip())
        # v403：来源 / 审核时间 / 审核人 —— 同样「空则不加列」⇒ 不传时 SQL 与改动前逐字一致。
        #   v417（B 语义）：`status='confirmed'` 时审核人(auditor_id)即操作人(operator_id)，
        #   表示「自己保存自己审核」。
        for _k, _v in (("source", source), ("audit_time", audit_time),
                       ("auditor_id", operator_id if st == 'confirmed' else '')):
            _s = str(_v or "").strip()
            if _s:
                _cols.append(_k)
                _vals.append(_s)
        # v408（P0-5）经办人 / 部门 —— 同样「空则不加列」⇒ 不传时 SQL 与改动前**逐字一致**。
        #   ⚠️ `handler` 与 `operator_id` 是两回事（见 `erp_db.py` 的 v408 迁移块注释）：
        #      前者=业务归属（归谁办）、后者=系统事实（谁建的）。同取值域、不同语义。
        _h = str(handler or "").strip()
        if _h:
            _cols.append("handler")
            _vals.append(_h)
        if int(department_id or 0) > 0:
            _cols.append("department_id")
            _vals.append(int(department_id))
        # v415（P2-7）自定义字段值 —— 同样的「空则不加列」范式（第六次用它）。
        #   🔴 `ensure_ascii=False` 存**中文原文**（不是 `\uXXXX`）：库里可读、能直接 grep，
        #      而 `load_extra` 用 `json.loads` 解析两种写法都吃 ⇒ 不构成口径分叉。
        if _extra:
            _cols.append("extra_json")
            _vals.append(json.dumps(_extra, ensure_ascii=False))
        # v410（P2-3）：**建单本身就是一次操作** ⇒ 当场盖「最后操作」章。
        #   🔴 为什么建单也必须盖：不盖的话「建完没人动过」的单这两列恒空，而事实是
        #      「最后操作 = 张三在 10-09 14:00 建的」—— 一列空一列空看起来像"系统没记"，
        #      用户只能去翻创建时间 + 创建人自己拼。盖了才是完整事实。
        #   🔴 为什么用 `operator_id`（建单人）而不是另收一个参数：本函数的 `operator_id`
        #      语义就是「谁建的」，与「最后操作人」在建单这一刻**是同一个人**；另收参数
        #      只会在调用方忘记传时多一个静默为空的洞。
        #   ⚠️ 沿用本函数第五次的「空则不加列」范式 ⇒ `operator_id` 为空（导入器 / 老调用方）
        #      时 SQL 与改动前**逐字一致**。
        _sc, _se, _sp = _po_stamp_insert(operator_id)
        _cols.extend(_sc)
        _vals.extend(_sp)
        # ⚠️ 占位符个数必须按「**参数**个数」算，不是按列数：`_se` 里 `datetime(...)` 是
        #    **表达式**（不是 `?`），它不消耗参数。写成 `["?"] * len(_cols)` 会让
        #    `?` 比参数多一个 ⇒ `sqlite3.ProgrammingError: Incorrect number of bindings`。
        cur = db.execute(
            "INSERT INTO purchase_orders (%s) VALUES (%s)" % (
                ",".join(_cols), ",".join(["?"] * (len(_vals) - len(_sp)) + _se)),
            _vals)
        oid = cur.lastrowid
        for it in items:
            pid = it.get('product_id')
            if not pid and it.get('product_name'):
                r = db.execute("SELECT id FROM products WHERE name=? LIMIT 1",(it['product_name'],)).fetchone()
                if not r:
                    # Q2 (2026-07-25): 不静默回退 pid=1（会把入库/应付错配到商品1）。
                    raise ValueError(f"商品不存在：{it.get('product_name')}，请先在商品档案建档")
                pid = r['id']
            if not pid:
                raise ValueError("采购明细缺少 product_id 且无法按 product_name 匹配")
            unit = str(it.get('unit') or '').strip()
            _icols = ["order_id", "product_id", "quantity", "unit_price", "amount", "unit"]
            _ivals = [oid, pid, it['quantity'], it['unit_price'], _line_amount(it), unit]
            # v409（P2-1）单位换算：**换算比只在后端算**（`db/queries/units` 唯一实现）。
            #   🔴 为什么**不接受**前端传 `unit_ratio`：那等于把「库存记多少」交给浏览器算术
            #      —— 前端算错、或 JS 与 Python 的舍入在 `.xx5` 上差一点，都会让进了多少货
            #      记错，而且**零报错**。后端按商品档案现查、现算、把比值**快照**进明细行。
            #   🔴 `unit` 为空（老前端 / 小程序 / 舟谱导入器都不传它）⇒ `_ratio` = 0 ⇒
            #      **不加这两列** ⇒ 走的 SQL 与改动前**逐字一致**（「空则不加列」范式，
            #      本函数第五次用它：批次三列 v392、表头 handler v408、行备注 v408 …）。
            _pr = db.execute("SELECT unit, medium_unit, large_unit, medium_ratio, large_ratio,"
                             " order_unit FROM products WHERE id=?", (pid,)).fetchone()
            _pd = dict(_pr) if _pr else {}
            _ratio = ratio_to_base(_pd, unit) if unit else 0.0
            _bq = base_qty_of(it.get('quantity'), _ratio)
            if _ratio > 0 and _bq is not None:
                _icols.append("base_ratio")
                _ivals.append(_ratio)
                _icols.append("base_qty")
                _ivals.append(_bq)
            elif unit and _ratio <= 0:
                # 填了单位却换不出比值：**如实告警**，不静默按 1 记账（静默错数比报错更坏）。
                _logger.warning(
                    "[v409] 采购明细单位换算不出：product_id=%s unit=%s —— 该行按原数量入库（未折算）",
                    pid, unit)
            # v392（2026-10-07，批次 5 前置）：批次三列透传。
            # 🔴 为什么必须加：`purchase_order_confirm` 入库时**从明细行读**这两列
            #    （`itd.get('batch_no','') or f"{today}-{oid}"` / `itd.get('expiry_date','') or ''`）
            #    送给 `batch_in(...)`；而本函数此前**只写六列** ⇒ 前端/接口传了批次号与到期日
            #    **也会被静默丢掉** —— 生产 54 行 `inventory` 的 `batch_no`/`expiry_date`
            #    **100% 为空**就是这条造成的（低温奶的效期管理、FEFO 全无数据基础）。
            # 范式照抄上方 `order_date` 的条件追加：**字段为空则不加列** ⇒ 不传时 SQL 与行为
            # 与改动前**逐字一致**，既有调用方（老前端 / 导入 / AI 预测建议）零影响。
            for _k in ("batch_no", "expiry_date", "production_date"):
                _v = str(it.get(_k) or "").strip()
                if _v:
                    _icols.append(_k)
                    _ivals.append(_v)
            # v408（P1-2）明细行备注 —— 同一个「字段为空则不加列」范式（第三次用它，
            # 前两次是批次三列 v392 与表头 handler/department_id v408）。
            #   🔴 为什么坚持这个写法：它把「不传」证明成**与改动前逐字一致**——
            #      老前端 / 小程序 / 舟谱导入器都不传 `note` ⇒ 它们走的 SQL 一个字符都没变。
            #   ⚠️ 与表头 `purchase_orders.note` 不是一回事：那是「整单备注」，
            #      这是「这一行为什么这么订」。
            _vn = str(it.get("note") or "").strip()
            if _vn:
                _icols.append("note")
                _ivals.append(_vn)
            db.execute("INSERT INTO purchase_order_items (%s) VALUES (%s)" % (
                           ",".join(_icols), ",".join("?" * len(_icols))), _ivals)
        if db_conn is None:
            db.commit()
    return {'order_id':oid,'order_no':no,'total_amount':total}


def purchase_order_update(oid, supplier_id=0, items=None, warehouse_id=1, note='',
                         operator_id='', expected_date='', order_date='', handler='',
                         department_id=0, mark='', extra=None, source='',
                         expected_status=None):
    """P1-4 编辑一张**尚未入库**的采购单（draft / cancelled 可整单重写）。

    🔴 闸门（阶段 1 第 4 项「提交后字段锁定」）：只有 `_phase == 'full'` 的状态能整单改。
      原闸门放行 (draft, pending_approval, cancelled)；现 `pending_approval` 已提交，核心字段
      锁死 ⇒ 整单重写被拦（备注/经手人/期望日期等走 `purchase_order_update_header`）。
      保留 `cancelled` 整单可改是既有怪癖（本函数会把作废单重存并维持作废）。
      一旦 `confirmed` / `received` / `partial` / `returned`，库存/应付/批次已落账，再改明细
      就是「改已发生的历史」⇒ 拒绝。这是进销存「写已发生事实」的硬边界。

    实现：整单重写 —— 更新表头 + **删旧明细、按新 items 重插**。对未入库的单这是安全的
      （明细还没变成库存，没有外键 / 批次引用需要保留）。已入库的单走「退货」而不是「编辑」。

    🔴 复刻 `purchase_order_create` 的明细写入纪律：批次三列 / 单位换算 / 自定义字段 / 空则不加列
      一切照旧，保证「编辑后保存」与「新建」走**同一套**落库逻辑（唯一实现，不抄第二份）。

    乐观锁：`expected_status` 是客户端加载时读到的状态，UPDATE 末尾拼 `AND status=?`；
      并发下有人先把单子提交了（status 变了），本次 rowcount=0 ⇒ 如实报「已被他人改」。
    """
    items = items or []
    if not supplier_id:
        return {'ok': False, 'error': '缺少供应商'}
    if not items:
        return {'ok': False, 'error': '采购明细不能为空'}
    with get_db() as db:
        o = db.execute(
            "SELECT id, status, total_amount FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {'ok': False, 'error': '采购单不存在'}
        o = dict(o)
        _st = o['status']
        # 阶段 1（第 4 项）：提交后字段锁定 —— 离开草稿类的整单重写不再允许。
        # 原闸门放行 (draft, pending_approval, cancelled)；现 `pending_approval` 已提交，
        # 核心字段锁死 ⇒ 整单改被拦（备注/经手人等走 update_header）。cancelled 保留整单可改。
        _ph = _phase('purchase_order', _st)
        if _ph != 'full':
            return {'ok': False, 'error': '该单据已%s，不能整单编辑（如需调整交易内容，请走退/换流程；'
                                          '备注、经手人、期望日期可在详情页行内修改）'
                    % status_label('purchase_order', _st)}

        def _line_amount(it):
            a = it.get('amount')
            return float(a) if a is not None else it['quantity'] * it['unit_price']

        total = sum(_line_amount(it) for it in items)
        # 重新判定状态（仅草稿有效；cancelled 保持取消）。
        if _st == 'draft':
            try:
                r = db.execute("SELECT value FROM system_config WHERE key='approval_threshold'").fetchone()
                threshold = int(r['value']) if r else DEFAULT_APPROVAL_THRESHOLD
            except Exception:
                threshold = DEFAULT_APPROVAL_THRESHOLD
            new_st = 'pending_approval' if total >= threshold else 'draft'
        else:
            new_st = _st  # cancelled 保持取消

        # —— 表头更新（只改可编辑字段，其余原样保留）——
        # 阶段 1（第 4 项）：乐观锁 —— 用加载时的 status 作令牌，并发下有人先把单子提交
        #   （status 变了），本次 rowcount=0 ⇒ 整单未生效、如实报「已被他人改」。
        _tok_sql, _tok_params = status_token_clause(expected_status if expected_status else _st)
        _hdr_cur = db.execute(
            "UPDATE purchase_orders SET supplier_id=?, warehouse_id=?, total_amount=?, note=?, "
            "expected_date=?, order_date=?, handler=?, department_id=?, mark=?, status=? "
            "WHERE id=?" + _tok_sql,
            (supplier_id, warehouse_id, total, note, expected_date,
             str(order_date).strip() if str(order_date or '').strip() else o.get('order_date') or '',
             str(handler or '').strip(), int(department_id or 0), str(mark or '').strip(),
             new_st, oid) + tuple(_tok_params))
        if not _hdr_cur.rowcount:
            return {'ok': False, 'error': '该采购单刚被别人改过状态（现为%s），本次整单编辑未生效，请刷新后重试'
                    % status_label('purchase_order', expected_status if expected_status else _st)}
        # v415（P2-7）自定义字段：随编辑写入（空 dict ⇒ 清空 extra_json）。
        _extra = {}
        if extra is not None:
            _extra = {k: v for k, v in validate_extra(MODULE_PURCHASE_ORDERS, extra).items()
                      if v is not None}
        db.execute("UPDATE purchase_orders SET extra_json=? WHERE id=?",
                   (json.dumps(_extra, ensure_ascii=False) if _extra else '', oid))
        # —— 明细：删旧重插 ——
        db.execute("DELETE FROM purchase_order_items WHERE order_id=?", (oid,))
        for it in items:
            pid = it.get('product_id')
            if not pid and it.get('product_name'):
                r = db.execute("SELECT id FROM products WHERE name=? LIMIT 1", (it['product_name'],)).fetchone()
                if not r:
                    raise ValueError(f"商品不存在：{it.get('product_name')}，请先在商品档案建档")
                pid = r['id']
            if not pid:
                raise ValueError("采购明细缺少 product_id 且无法按 product_name 匹配")
            unit = str(it.get('unit') or '').strip()
            _icols = ["order_id", "product_id", "quantity", "unit_price", "amount", "unit"]
            _ivals = [oid, pid, it['quantity'], it['unit_price'], _line_amount(it), unit]
            _pr = db.execute("SELECT unit, medium_unit, large_unit, medium_ratio, large_ratio,"
                             " order_unit FROM products WHERE id=?", (pid,)).fetchone()
            _pd = dict(_pr) if _pr else {}
            _ratio = ratio_to_base(_pd, unit) if unit else 0.0
            _bq = base_qty_of(it.get('quantity'), _ratio)
            if _ratio > 0 and _bq is not None:
                _icols.append("base_ratio"); _ivals.append(_ratio)
                _icols.append("base_qty"); _ivals.append(_bq)
            for _k in ("batch_no", "expiry_date", "production_date"):
                _v = str(it.get(_k) or "").strip()
                if _v:
                    _icols.append(_k); _ivals.append(_v)
            _vn = str(it.get("note") or "").strip()
            if _vn:
                _icols.append("note"); _ivals.append(_vn)
            db.execute("INSERT INTO purchase_order_items (%s) VALUES (%s)" % (
                           ",".join(_icols), ",".join("?" * len(_icols))), _ivals)
        # 最后操作章（与建单同一套纪律）。
        _sc, _se, _sp = _po_stamp_insert(operator_id)
        if _sc:
            db.execute("UPDATE purchase_orders SET %s WHERE id=?" % ",".join(_sc), _sp + [oid])
        db.commit()
    return {'ok': True, 'order_id': oid, 'total_amount': total}

    """审核一张采购单（`pending_approval` → `draft`），并落审核时间 + **审核人**。

    v403 之前这里只 `SET status='draft'`，**不记时间** ⇒ 舟谱列表的「审核时间」列永远空。
    v403 起一并写 `audit_time`，v408（P1-7）起再一并写 `auditor_id`（审核人），
    但有几个必须说清的语义：

    · **幂等保留首次**：`audit_time` 只在为空时才写（`CASE WHEN COALESCE(audit_time,'')=''`）。
      重复点「审核」不会把时间刷新成「刚才」—— 审核时间一旦落定就是历史事实。
    · **免审批单也要可审**：金额低于阈值的单直接落 `draft`，从来没进过 `pending_approval`。
      若这里只认 `pending_approval`，用户对这批单点「批量审核」会**看起来像没点**
      （状态不变、时间仍空、也查不出问题）—— 正是「恒空恒 0 且零报错 = 静默失效」。
      所以对 `draft` / `confirmed` 也补审核时间，**但不动状态**。
    · **已入库 / 部分入库 / 已取消 不可审**：这类返回 `ok=False` + 原因，由调用方**如实回报**，
      不假装成功（批量操作里用户必须看到「哪几张没审、为什么」）。
    · 🔴 **审核人 = `auditor_id`（v408 P1-7 新增）**：取值域与 `operator_id` / `handler`
      完全相同（主库 `users.id` 的字符串），但**语义不同**：`operator_id` = 谁建的、
      `handler` = 归谁办、`auditor_id` = **谁审的**。
      ⚠️ 只存 id **不存名字**（名字会改，存了会与主库漂移）；显示名由**端点层**现解析
      （`psi.py` 复用 `_creator_names` → `auditor_name`），与 `operator_id`→`creator_name` 同一套。
      ⚠️ 与 `audit_time` **同一条幂等纪律**：只在为空时才写 ⇒ 重复点「审核」不会把
      **审核人**换成后点的那个人（审核人一旦落定就是历史事实，与审核时间成对）。
      ⚠️ `auditor_id=''`（调用方没传，例如 v408 之前的调用方）时**写空串、不覆盖**已有值 ——
      宁可留空也不要把「谁审的」抹掉（本仓铁律：**「没有」≠「是零」**，缺值不编）。

    v410（P2-3）追加 `operator_id`（**本次点审核的人**），用来盖「最后操作」章。
    🔴 为什么不直接复用 `auditor_id`：两者**语义不同、更新规则也相反** ——
      · `auditor_id` = **首次**审核人，重复点审核**保留**第一个（历史事实，不可改写）；
      · `last_op_by` = **最后一次**操作人，重复点审核必须**刷成本次**这个人。
      若复用 `auditor_id`，第二次点审核的人不会出现在「最后操作人」里 —— 界面上就会是
      「刚才明明是我点的审核，最后操作人却写着张三」，而零报错。
    ⚠️ 排在 `auditor_id` 之后（末尾追加）⇒ 既有调用方的位置参数一个都没挪动。
    """
    # v410（P2-3）：盖章片段。**空则不加**（没人 ⇒ 连时间都不写，见 `_po_stamp`）。
    _st, _sp = _po_stamp(operator_id)
    with get_db() as db:
        cur = db.execute(
            "UPDATE purchase_orders SET "
            "  status=CASE WHEN status='pending_approval' THEN 'draft' ELSE status END, "
            "  audit_time=CASE WHEN COALESCE(audit_time,'')='' "
            "                 THEN datetime('now','localtime') ELSE audit_time END, "
            "  auditor_id=CASE WHEN COALESCE(auditor_id,'')='' "
            "                 THEN ? ELSE auditor_id END "
            + (", " + _st if _st else "")
            + " WHERE id=? AND status IN ('pending_approval','draft','confirmed')",
            [str(auditor_id or '')] + _sp + [oid])
        db.commit()
        if not cur.rowcount:
            return {'order_id': oid, 'ok': False,
                    'reason': '该单已入库 / 部分入库 / 已取消，不能再审核'}
        return {'order_id': oid, 'ok': True, 'status': 'draft', 'message': '已审批，可确认入库'}


def purchase_order_unapprove(oid, operator_id=''):
    """反审核：把「已审核但还没入库」的单退回 `pending_approval`，并清空审核时间。

    v403 新增（舟谱批量操作里的「批量反审核」）。**只对 `draft` / `confirmed` 生效**：
    已入库（`received` / `partial`）的单意味着库存与应付**已经真的产生了**，
    反审核它不会撤销任何账 —— 那只会让单据状态与事实脱节，所以一律拒绝并说明原因。

    🔴 v408（P1-7）：清 `audit_time` 时**必须同时清 `auditor_id`**。
    只清时间不清人 ⇒ 库里出现「没有审核时间、却写着审核人」这种**自相矛盾**的事实，
    列表上一列空一列有值，用户只能猜。两者是同一件事的两半，必须同进同退。

    v410（P2-3）追加 `operator_id`：反审核**本身也是一次操作** ⇒ 盖「最后操作」章。
    🔴 为什么"撤销"也要记：不记的话用户看到的最后操作人还是**上一次**那个人，而这张单
      刚刚被人动过 —— 「最后操作」的价值就在于**不留空窗**，撤销尤其要留痕
      （否则"谁把它退回待审的"永远查不出来）。
    """
    _st, _sp = _po_stamp(operator_id)
    # 阶段 1（第 3 项）：来源集合改由白名单生成（原先手写 `IN ('draft','confirmed')`，
    # 与 `doc_state` 里 pending_approval 的两条入边逐字相同 —— 抄两份就会在将来分岔）。
    _gs, _gp = guard_sql('purchase_order', 'pending_approval')
    with get_db() as db:
        cur = db.execute(
            "UPDATE purchase_orders SET status='pending_approval', audit_time='', auditor_id='' "
            + (", " + _st if _st else "")
            + " WHERE id=?" + _gs, _sp + [oid] + _gp)
        db.commit()
        if not cur.rowcount:
            return {'order_id': oid, 'ok': False,
                    'reason': '只有「已审核但未入库」的单可以反审核（已入库/已取消的不行）'}
        return {'order_id': oid, 'ok': True, 'status': 'pending_approval'}


def purchase_order_cancel(oid, operator_id=''):
    """作废一张采购单（`status='cancelled'`）。

    🔴 **只允许未入库的单**（`draft` / `pending_approval` / `confirmed`）。
    已入库 / 部分入库的单**不能**在这里取消：库里已经进了货、应付已经记了账，
    直接改状态就是「账实不符」。这类应该走**采购退货单**冲回，不是把单据一按了之。
    这个判据与 `purchase_order_confirm` 把 `status` 推进到 `received` 是同一条业务事实的两面。

    v410（P2-3）追加 `operator_id`：作废是本次操作 ⇒ 盖「最后操作」章（理由同 `unapprove`）。
    """
    _st, _sp = _po_stamp(operator_id)
    with get_db() as db:
        # 阶段 1（第 3 项）：这里的来源集合**刻意窄于**白名单 —— 白名单放
        # `received/partial → cancelled` 是给 AI 回滚用的系统通道；人工作废一张
        # 已入库的单会让库存与应付凭空消失，只能走采购退货冲回。
        # 两者的分工写在此处，避免以后有人「统一一下」把它放宽。
        cur = db.execute(
            "UPDATE purchase_orders SET status='cancelled' "
            + (", " + _st if _st else "")
            + " WHERE id=? AND status IN ('draft','pending_approval','confirmed')", _sp + [oid])
        db.commit()
        if not cur.rowcount:
            _row = db.execute("SELECT status FROM purchase_orders WHERE id=?", (oid,)).fetchone()
            _now = status_label('purchase_order', _row['status']) if _row else '（单据不存在）'
            return {'order_id': oid, 'ok': False,
                    'reason': '当前是「%s」，不能作废；已入库 / 部分入库请走采购退货单冲回'
                              % _now}
        return {'order_id': oid, 'ok': True, 'status': 'cancelled'}


def purchase_order_mark(oids, mark='', operator_id=''):
    """批量「标记 / 删标记」。`mark=''` 即删标记。

    v403 新增（舟谱批量操作里的「标记 / 删标记」）。**纯展示层字段，不参与任何业务判定**
    —— 它既不影响库存、不影响应付，也不影响状态机；只是让老板把「这几张我要盯的」挑出来。
    ⚠️ 单张不存在 / 已取消都不拦：标记没有业务前置条件，硬拦反而让用户以为工具坏了。

    v410（P2-3）追加 `operator_id`：标记 / 删标记也是一次操作 ⇒ 盖「最后操作」章。
    """
    ids = [int(x) for x in (oids or []) if str(x).strip()]
    if not ids:
        return {'updated': 0}
    m = str(mark or '').strip()
    ph = ",".join("?" * len(ids))
    _st, _sp = _po_stamp(operator_id)
    with get_db() as db:
        cur = db.execute(
            "UPDATE purchase_orders SET mark=?" + (", " + _st if _st else "")
            + f" WHERE id IN ({ph})", [m] + _sp + ids)
        db.commit()
        return {'updated': cur.rowcount or 0, 'mark': m}


def purchase_order_bump_print(oids, operator_id=''):
    """批量「打印」计数（`print_count += 1`）。

    v403 新增。🔴 这里**只计数、不产生任何文件**：真正的打印在浏览器侧（`window.print`）。
    为什么仍要落库：舟谱列表里有「打印数」列，老板用它判断「这张单我到底打没打给供应商」；
    如果只在浏览器打印而库里不记，刷新一下那个数字就回到 0 —— 列是空的、功能是假的。
    ⚠️ 返回值逐单给出 `print_count` 新值，便于前端就地更新（不重拉整页）。

    v410（P2-3）追加 `operator_id`：盖「**最后打印**」章（人 + 时间）。
    🔴 **刻意只盖 print 章、不盖 op 章**：打印若也算一次「操作」，那么「最后操作人」永远
      等于「最后打印人」，两列信息完全重复、白占一列宽。分成两条轴才回答得了两个不同的
      问题 —— 「这张单最后是谁改的」与「这张单最后是谁打的、什么时候打的」。
      ⚠️ 舟谱就是这么分的（它同时有这四列），沿用同一口径，不自己发明。
    """
    ids = [int(x) for x in (oids or []) if str(x).strip()]
    if not ids:
        return {'updated': 0, 'counts': {}}
    ph = ",".join("?" * len(ids))
    _st, _sp = _po_stamp(operator_id, kind='print')
    with get_db() as db:
        db.execute(
            "UPDATE purchase_orders SET print_count=COALESCE(print_count,0)+1"
            + (", " + _st if _st else "")
            + f" WHERE id IN ({ph})", _sp + ids)
        db.commit()
        counts = {int(r['id']): int(r['print_count'] or 0) for r in db.execute(
            f"SELECT id, print_count FROM purchase_orders WHERE id IN ({ph})", ids).fetchall()}
    return {'updated': len(counts), 'counts': counts}


def purchase_order_append_note(oids, text='', operator_id=''):
    """批量「添加备注」——**追加**到现有 `note` 之后，不覆盖原内容。

    v403 新增（舟谱批量操作里的「添加备注」）。🔴 为什么是追加不是覆盖：
    `note` 里已经**承载着机器写的溯源信息**（`舟谱采购单:CD260531000002 | 经办人:…`、
    `AI开采购单: …`、`由采购计划#12 转单`）。批量备注若覆盖，这些溯源当场消失且**不可恢复**。
    ⚠️ 逐单**只写一次分隔符**：`\\n` 拼接后前端按行显示；空文本视为无操作（返回 changed=0，
    不假装成功）。

    v410（P2-3）追加 `operator_id`：追加备注也是一次操作 ⇒ 盖「最后操作」章。
    🔴 为什么"只写一行字"也要记：`note` 是本单唯一能被人随手改的字段，出问题（比如
      备注里写了「已电话确认降价」却没真改价）时要能查到是谁加的。
    """
    ids = [int(x) for x in (oids or []) if str(x).strip()]
    t = str(text or '').strip()
    if not ids:
        return {'changed': 0, 'reason': '未选择单据'}
    if not t:
        return {'changed': 0, 'reason': '备注内容为空'}
    ph = ",".join("?" * len(ids))
    _st, _sp = _po_stamp(operator_id)
    with get_db() as db:
        cur = db.execute(
            f"UPDATE purchase_orders SET note = "
            f"  CASE WHEN COALESCE(note,'')='' THEN ? ELSE note || char(10) || ? END "
            + (", " + _st if _st else "")
            + f" WHERE id IN ({ph})", [t, t] + _sp + ids)
        db.commit()
        return {'changed': cur.rowcount or 0, 'text': t}

def purchase_order_confirm(oid, operator_id=''):
    """确认入库（整单全收）。

    v410（P2-3）追加 `operator_id`：入库是这张单**最重要的一次操作**（它产生库存与应付），
    必须盖「最后操作」章 —— 否则「货是谁收进来的」只能去翻日志猜。
    """
    # v410：盖章片段（空则不盖，见 `_po_stamp`）。与下面那两条 UPDATE 同一事务。
    _st, _sp = _po_stamp(operator_id)
    try: from erp_db import check_period_open; check_period_open()
    except Exception: _logger.warning("check_period_open failed in purchase_order_confirm", exc_info=True)
    with get_db_tx() as db:
        # v697c：守卫补 `confirmed`。审核落库写的是 `confirmed`（v417「保存并审核」），
        #   而这里原本只收 ('draft','approved') ⇒ **审核通过的单根本入不了库**
        #   （前端 canConfirm 与后端逐字对齐，所以按钮也不显示 —— 老板看到的「没有入库入口」）。
        #   `approved` 保留：存量/其他链路可能有这个值，去掉是破坏性变更。
        o = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {'error': '采购单不存在'}
        if o['status'] not in ('draft', 'approved', 'confirmed'):
            # 集合**不放宽**（未审批 / 部分入库各有自己的入口），只把「当前是什么」
            # 说出来 —— 原提示把三种情况压成一句「已作废 / 已入库」，用户无从判断。
            return {'error': '当前是「%s」，不能整单入库；只有草稿 / 审批通过 / 已确认的单可以'
                             % status_label('purchase_order', o['status'])}
        # QC gate: check if rejected QC records exist for this PO
        try:
            qc = db.execute("SELECT result FROM qc_records WHERE ref_type='purchase_order' AND ref_id=? AND result!='pending' ORDER BY id DESC LIMIT 1", (oid,)).fetchone()
            if qc and qc[0] == 'rejected':
                return {'error': '质检不合格，无法入库。请先处理质检问题。'}
        except Exception:
            pass  # qc_records table may not exist yet
        # Get supplier name
        sup = db.execute("SELECT name FROM contacts WHERE id=?", (o['supplier_id'],)).fetchone()
        sup_name = sup['name'] if sup else ''
        today_str = db.execute("SELECT date('now')").fetchone()[0]
        # Collect product IDs for WAC recalculation
        product_ids = set()
        # v408（P0-6）：本次真正发生入库的**明细行数**。只用来决定「要不要盖入库时间」——
        # 零明细的采购单（`purchase_order_create` 不拦空 items）走完本函数会把状态置成
        # `received`，若不设这道闸，就会给一张**什么都没收到**的单盖上入库时间。
        # 那不是「没有」而是「编了一个」——本仓铁律就是不许编。
        _n_recv = 0
        for it in db.execute("SELECT poi.*, p.name as product_name FROM purchase_order_items poi LEFT JOIN products p ON poi.product_id=p.id WHERE poi.order_id=?",(oid,)).fetchall():
            itd = dict(it) if not isinstance(it, dict) else it
            batch_no = itd.get('batch_no', '') or f"{today_str.replace('-','')}-{oid}"
            expiry = itd.get('expiry_date', '') or ''
            # Use batch_in with shared connection
            from db.queries.inventory import batch_in
            # v409（P2-1）：入库数量用**折小单位数量**（`_poi_base_qty`），不是订单数量。
            #   「按件订 1」与「按袋订 40」必须进同样的库存 —— 用 `quantity` 会让库存量纲
            #   随下单时选的档位漂移。老行（`base_qty`=0）回退 `quantity` ⇒ 逐字一致。
            _in_qty = _poi_base_qty(itd)
            # 🔴 上面换成小单位数量，这里**必须同步**把单价折成「元 / 小单位」——
            #    只换数量不换价，`inventory.cost_price` 会记成「40 袋 @100 元」（应为 2.5 元/袋），
            #    加权平均成本随之错几十倍，而且**零报错**（库存看着对、成本全错）。
            #    两者相乘仍等于原行金额（`qty × price`），金额口径不变。
            # v789：把明细行的生产日期透传给 batch_in —— 录不录由用户偏好决定，
            #   空串合法（不强制）；此前只传 batch_no/expiry_date ⇒ 录了也不落台账。
            batch_in(itd['product_id'], o['warehouse_id'], _in_qty, _poi_base_price(itd), batch_no, expiry,
                     db_conn=db, production_date=itd.get('production_date', '') or '')
            _n_recv += 1
            # 🔴 v404：把「整单全收」这件事**落到明细行**（`received_qty = quantity`）。
            #    此前只有 `purchase_order_partial_receive` 会写这一列，`confirm` 从不写 ⇒
            #    全收之后 `purchase_orders.status='received'` 而每行 `received_qty` **仍是 0**。
            #    两个后果（都不是报错，而是静默错数）：① 详情页「入库单」的「入库数量 / 差异数量」
            #    整列显示 0 / 等于订单数量，可表头写着「已入库」，用户会以为货根本没到；
            #    ② `ap_invoices` 的三单匹配把「收货金额」算成 0（它用
            #    `SUM(poi.received_qty * poi.unit_price)` ⇒ 见 `erp_db.py` 的 `ap_invoice_match`），
            #    发票永远匹配不上「收货匹配」这一项。
            #    改动面核查（生产实测 2026-10-08）：`received_qty > 0` 的明细行 **0 行**、
            #    `ap_invoices` **0 行** ⇒ 这条修正**没有既有数据会被扰动**；
            #    `procurement_planner._get_on_order_qty` 按
            #    `po.status IN ('draft','pending_approval','confirmed')` 过滤，已入库单本来就不在
            #    它范围内 ⇒ 在途量读数不受影响。
            #    幂等性：`confirm` 的状态守卫只放 `draft|approved`，跑过一次就变 `received`
            #    ⇒ 不可能对同一张单重复执行，不存在累加漂移。
            db.execute("UPDATE purchase_order_items SET received_qty=? WHERE id=?",
                       (itd['quantity'], itd['id']))
            product_ids.add(itd['product_id'])
            # Record batch trace with shared connection
            try:
                from erp_db import record_batch_trace
                record_batch_trace(
                    batch_no, 'in', itd['product_id'], itd['product_name'] or '',
                    # v409：批次追踪与库存**同量纲**（都是折小单位数量）—— 否则同一批货
                    # 在 `batch_trace` 里写 1 件、在 `inventory` 里写 40 袋，事后核对时
                    # 两边数字对不上又查不出原因。
                    _in_qty, 'purchase_order', oid, o['order_no'], sup_name,
                    db_conn=db
                )
            except Exception as e:
                logging.getLogger("hergent").debug(f"optional step failed: {e}")
        # v403：confirm 的语义 = **整单全收**（上面逐行 `batch_in(itd['quantity'])` 已把全部数量入库），
        # 所以「入库金额」== 订单金额，在这里一并落 `received_amount`。
        # 🔴 之前整条链路只用 `status='received'` 表达「已入库」，舟谱那 17 列里我们唯独缺的
        #    「入库金额」列**没有任何数据来源** —— 界面只能显示空。
        # v404：同一条「整单全收」语义现在**也落到明细行**（上面循环里的
        #    `UPDATE purchase_order_items SET received_qty=quantity`）—— 表头与明细必须同一次
        #    表达同一个事实，不能一处说「已入库」、另一处说「收到 0」。
        # ⚠️ `audit_time` 只在为空时补：已走显式审核的单不能被覆盖成入库时刻。
        #    对「金额低于阈值、免审批直接建单」的单，这一步是它**唯一**的审核时间来源 ——
        #    不补则该列对它永久为空，用户会以为系统坏了。取值 = 「这张单最后一次被人工确认的时刻」。
        # 阶段 1（第 3 项）：这条 UPDATE 原先**没有任何来源守卫**（`WHERE id=?`），
        # 注释里写的「状态守卫只放 draft|approved」其实只住在上面的 SELECT 里，
        # 而校验与写入之间隔着整段逐行入库 + 批次追溯 —— 并发下可被重复收一次货。
        _gs, _gp = guard_sql('purchase_order', 'received')
        _cur = db.execute(
            "UPDATE purchase_orders SET "
            "  status='received', "
            "  received_amount=COALESCE(total_amount,0), "
            "  audit_time=CASE WHEN COALESCE(audit_time,'')='' "
            "                 THEN datetime('now','localtime') ELSE audit_time END "
            + (", " + _st if _st else "")
            + " WHERE id=?" + _gs, _sp + [oid] + _gp)
        if not _cur.rowcount:
            raise ValueError('这张单刚被别人改过状态，本次入库未生效，请刷新后重试')
        # v408（P0-6）：**入库时间**（`received_at`）—— 与上面的 `audit_time` 是**两个不同事实**，
        # 所以是**另一条语句、另一个口径**，不要顺手并进上面那条 UPDATE：
        #   · `audit_time`  = 审核时刻；已审核的单**不能被覆盖**（CASE WHEN 空则补）。
        #   · `received_at` = 入库时刻；本动作（整单全收）**就是**入库时刻 ⇒ 每次如实覆盖。
        # 二者相等只是「免审批单」的巧合（那种单 `audit_time` 也是本函数补的），不是定义。
        # ⚠️ 守卫 `_n_recv > 0`：零明细的单调 `confirm` 什么都没收进来 ⇒ 不盖时间戳。
        #    对正常单而言 `_n_recv = 明细行数 > 0`，恒成立，此闸不影响任何真实入库。
        if _n_recv > 0:
            db.execute("UPDATE purchase_orders SET received_at=datetime('now','localtime') WHERE id=?", (oid,))
        # 🔴 v697：改 UPSERT。分批到货（`purchase_order_partial_receive`）现在会先建应付行，
        #    若这里仍是裸 INSERT，同一张单会出现**两条 ap 行** ⇒ 往来账应付翻倍、
        #    货款页 `ORDER BY id LIMIT 1` 只读到第一条，第二条永远没人管。
        _ap_row = db.execute(
            "SELECT id FROM receivables WHERE type='ap' AND ref_type='purchase' AND ref_id=? "
            "ORDER BY id LIMIT 1", (oid,)).fetchone()
        if _ap_row:
            db.execute("UPDATE receivables SET amount=? WHERE id=?",
                       (o['total_amount'], _ap_row['id']))
            _ap_id = _ap_row['id']
        else:
            _ap_id = db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) VALUES ('ap',?,'purchase',?,?)",(o['supplier_id'],oid,o['total_amount'])).lastrowid
        # 🔴 v697b：**预付款必须在应付行上留痕**。
        #    预付走的是 `cash_flow` + `purchase_orders.prepaid_amount`（老板定的口径：
        #    不另建预付款台账）。但 `receivables` 是往来账读的那张表 —— 如果不在它的
        #    `paid_amount` 上镜像一笔，就会出现：
        #       货款页「未结 ¥1,500」  vs  往来账「这笔应付还欠 ¥2,000」
        #    两处记账分叉，正是货款页那个黄色警告要报的错，而且老板会真的不知道该信谁。
        #    镜像值 = 已预付（**封顶到应付金额**）：多付的部分不进应付，
        #    由 `overpaid_amount` 单独提示（不设上限是老板定的，但多付的钱不能悄悄滑进应付）。
        _pre_m = min(_po_money(_po_get(o, "prepaid_amount")), _po_money(o['total_amount']))
        if _pre_m > 0:
            db.execute(
                "UPDATE receivables SET paid_amount=?, "
                "  status=CASE WHEN amount<=? THEN 'paid' ELSE 'partial' END WHERE id=?",
                (_pre_m, _pre_m, _ap_id))
        # Auto-generate journal entry with shared connection
        from erp_db import auto_journal_for_purchase
        auto_journal_for_purchase(oid, db_conn=db)
        # Recalculate weighted average cost per product with shared connection
        from erp_db import recalculate_weighted_average_cost
        for pid in product_ids:
            recalculate_weighted_average_cost(pid, db_conn=db)
        return {'order_id':oid,'order_no':o['order_no'],'status':'received'}

def purchase_order_partial_receive(oid, items, operator_id=''):
    """Partially receive items on a purchase order. items: [{product_id, quantity}]

    v410（P2-3）追加 `operator_id`：分批到货也是一次真实操作 ⇒ 盖「最后操作」章
    （口径与 `purchase_order_confirm` 完全一致，两处都走 `_po_stamp` 同一实现）。
    """
    _st, _sp = _po_stamp(operator_id)
    with get_db() as db:
        # v697c：同上，补 `confirmed`。
        o = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {'error': '采购单不存在'}
        if o['status'] not in ('draft', 'approved', 'confirmed', 'partial'):
            # 原提示只有两个字「状态错误」—— 分批到货失败时用户完全不知道该怎么办。
            return {'error': '当前是「%s」，不能分批到货；只有草稿 / 审批通过 / 已确认 / '
                             '部分入库的单可以'
                             % status_label('purchase_order', o['status'])}
        received_count = 0; total_count = 0
        for item_input in items:
            it = db.execute("SELECT * FROM purchase_order_items WHERE order_id=? AND product_id=?",(oid, item_input['product_id'])).fetchone()
            if not it: continue
            new_received = (it['received_qty'] or 0) + item_input['quantity']
            new_received = min(new_received, it['quantity'])
            db.execute("UPDATE purchase_order_items SET received_qty=? WHERE id=?",(new_received, it['id']))
            # 🔴 v391（2026-10-07）：这里原先**没传** `db_conn=db` —— 而 `inventory_adjust` 不带
            #    `db_conn` 时会 `get_db()` **自开第二条连接**去写。此时外层 `with get_db() as db:`
            #    已持有写事务，SQLite 只有一个写者 ⇒ **必然** `OperationalError: database is locked`。
            #    实测：独立进程、无任何其它连接占用下调用本函数，仍然 100% 锁死
            #    （`.workbuddy/tools/v391-partial-receive-lock-repro.py` ①③④ 三步对照）。
            #    ⇒ 本函数此前**一次都成功不了**（不是偶发、不是并发才有的竞态）。
            #    同族 `purchase_order_confirm` 早就修成 `batch_in(..., db_conn=db)` 了，本处漏改。
            #    ⚠️ 语义未变：仍然只调整**总量**（不落批次/到期日，那是 `confirm` 的 `batch_in` 的职责）。
            # v409（P2-1）：与 `purchase_order_confirm` **同口径** —— 传入的 `quantity` 是
            #   **订单单位**的数量，进库存要折成小单位，单价同折（否则成本价错一个量级）。
            #   🔴 但 `received_qty`（上面的 `new_received`）**刻意不折**：它要和 `quantity`
            #   （订单量）比较来判断「这一行到齐没有」，折了反而永远对不上。
            _itd = dict(it) if not isinstance(it, dict) else it
            _r = norm_ratio(_itd.get('base_ratio'))
            try:
                _pq = float(item_input.get('quantity') or 0)
                _up = float(_itd.get('unit_price') or 0)
            except (TypeError, ValueError):
                _pq, _up = 0.0, 0.0
            _in_q = round(_pq * _r, 4) if _r > 0 else _pq
            _in_p = round(_up / _r, 6) if _r > 0 else _up
            inventory_adjust(it['product_id'], o['warehouse_id'], _in_q, _in_p, 'purchase', oid, db_conn=db)
            if new_received >= it['quantity']: received_count += 1
            total_count += 1
        # v403：入库金额。**从明细行重算**而不是在循环里累加增量 —— 重算对「同一单分多次到货」
        # 天然幂等，且明细表就是唯一事实源；增量累加在行数被 cap 到 `quantity` 上限后会漂移。
        _ra = db.execute(
            "SELECT COALESCE(SUM(COALESCE(received_qty,0) * COALESCE(unit_price,0)),0) a "
            "FROM purchase_order_items WHERE order_id=?", (oid,)).fetchone()
        recv_amt = round(float(_ra['a'] or 0), 2)
        # v408（P0-6）：**入库时间**（`received_at`）。两个分支（到齐 / 部分）都要盖 ——
        # 「部分到货」本身就是一次真实入库动作，不盖就等于说「这单没进过货」。
        # 口径与 `purchase_order_confirm` **完全一致**：每次实际入库动作都**覆盖** ⇒
        # `received_at` = 这张单**最近一次**收到货的时刻；分批到货时它会随每次到货往后走，
        # 最终停在**到齐那一刻**（这正是用户要看的「什么时候收完的」）。
        #
        # ⚠️ 守卫 `_moved > 0`（本次 Σ 传入数量）：本函数有两个「什么都没收」的入口 ——
        #    ① `items` 为空；② 传了行但 `quantity` 全为 0（`inventory_adjust(...,0)` 是空操作）。
        #    这两种情况下状态**照样会被改**（且 `total_count=0` 时 `received_count>=total_count`
        #    恒真 ⇒ 甚至会把零明细的单标成 `received`），若不设闸就会给「没收到货的提交」
        #    盖上入库时间 —— 那是**编**一个事实出来，违背本仓铁律。
        #    对任何真实到货 `_moved > 0` 恒成立，此闸不影响正常路径。
        _moved = sum(float(_x.get('quantity') or 0) for _x in items)
        # 🔴 v697（缺陷 2）：分批到货**必须同步应付行**。
        #    此前本函数只写 `received_amount`，不建 `receivables` ⇒ 状态是「部分入库」，
        #    但 `purchase_payment_create` 的「必须有应付行」那道闸会直接把付款拒掉
        #    ⇒ **分批到货的货永远付不了一分钱**，而且界面上给的理由是
        #    「这张单没有对应的应付单，不用登记付款」—— 看起来像"确实不用付"，属于静默失效。
        #    金额口径：到齐用 `total_amount`（与 `confirm` 一致，订单金额可能是外部权威值），
        #    未到齐用 `recv_amt`（只欠已到货部分，不该为没到的货付钱）。
        _ap_amt = (_po_money(_po_get(o, "total_amount"))
                   if received_count >= total_count else recv_amt)
        _ap_row = db.execute(
            "SELECT id FROM receivables WHERE type='ap' AND ref_type='purchase' AND ref_id=? "
            "ORDER BY id LIMIT 1", (oid,)).fetchone()
        if _ap_row:
            # 只改金额，**不动 paid_amount / status** —— 已付过的钱与状态由付款链路负责。
            db.execute("UPDATE receivables SET amount=? WHERE id=?", (_ap_amt, _ap_row["id"]))
        else:
            _ap_id = db.execute("INSERT INTO receivables (type,contact_id,ref_type,ref_id,amount) "
                                "VALUES ('ap',?,'purchase',?,?)",
                                (o["supplier_id"], oid, _ap_amt)).lastrowid
            # 🔴 v697b：**预付款必须在应付行上留痕**（同 `confirm` 的理由，见那里的长注释）。
            #   只在**首次创建**应付行时写这一次；后续每次到货都覆盖的话，会把真实付款额
            #   重置回预付额（那是真的会丢账，而且不会报错）。
            _pre_m = min(_po_money(_po_get(o, "prepaid_amount")), _ap_amt)
            if _pre_m > 0:
                db.execute(
                    "UPDATE receivables SET paid_amount=?, "
                    "  status=CASE WHEN amount<=? THEN 'paid' ELSE 'partial' END WHERE id=?",
                    (_pre_m, _pre_m, _ap_id))
        # Set status
        # 阶段 1（第 3 项）：两条状态写入都补来源守卫（原先只有 SELECT 校验，
        # 写入本身裸奔；分批到货会真的动库存与应付，被重复执行就是多收一次货）。
        if received_count >= total_count:
            # 全部到齐 ⇒ 与 `purchase_order_confirm` 口径保持一致：入库金额 = 订单金额
            # （订单金额可能是外部系统给的权威金额，未必等于 Σ数量×采购价，不能现算替它）。
            _gs, _gp = guard_sql('purchase_order', 'received')
            db.execute("UPDATE purchase_orders SET status='received', "
                       "received_amount=COALESCE(total_amount,0)"
                       + (", " + _st if _st else "") + " WHERE id=?" + _gs,
                       _sp + [oid] + _gp)
        else:
            _gs, _gp = guard_sql('purchase_order', 'partial')
            db.execute("UPDATE purchase_orders SET status='partial', "
                       "received_amount=?" + (", " + _st if _st else "")
                       + " WHERE id=?" + _gs, [recv_amt] + _sp + [oid] + _gp)
        if _moved > 0:
            db.execute("UPDATE purchase_orders SET received_at=datetime('now','localtime') WHERE id=?", (oid,))
        db.commit()
        return {'order_id': oid, 'order_no': o['order_no'], 'status': 'partial' if received_count < total_count else 'received', 'received': received_count, 'total': total_count, 'received_amount': recv_amt}

def get_supplier_price_comparison(product_name=''):
    """Get supplier prices for a product for display in purchase form."""
    with get_db() as db:
        prods = [dict(r) for r in db.execute("SELECT id,name FROM products WHERE name LIKE ? AND is_active=1 LIMIT 20",(f"%{product_name}%",)).fetchall()]
        result = []
        for p in prods:
            suppliers = [dict(r) for r in db.execute("""
                SELECT c.id as supplier_id, c.name as supplier_name, MIN(poi.unit_price) as best_price, po.order_date as last_order_date
                FROM purchase_order_items poi JOIN purchase_orders po ON poi.order_id=po.id JOIN contacts c ON po.supplier_id=c.id
                WHERE poi.product_id=? AND po.status IN ('received','partial')
                GROUP BY c.id ORDER BY MIN(poi.unit_price)
            """,(p['id'],)).fetchall()]
            if suppliers: result.append({'product_id': p['id'], 'name': p['name'], 'suppliers': suppliers})
        return result

# v470：采购单列表**服务端排序**白名单（键 = 前端列 key，值 = SQL 片段）。
#   🔴 为什么是「白名单映射」而不是把 `order_by` 直接拼进 SQL：`order_by` 来自查询参数
#      （用户可控），直接拼接 = SQL 注入。映射表里查不到的键**一律回落**默认 `po.id DESC`。
#   🔴 为什么排序必须在 SQL 里做：本列表是**服务端分页**（`LIMIT ? OFFSET ?`）。前端对当前页
#      20 行重排，看着"排好了"，一翻页就散架（第 2 页是另一批 20 行，排序基准不同）。
#   ⚠️ `qty` / `return_amount` 是 SELECT 里的**相关子查询别名**（SQLite 允许 `ORDER BY 别名`）。
#   ⚠️ `unpaid` 在库里**没有这一列** —— 它是 `received_amount - paid_amount` 的前端口径，
#      故这里写**表达式**；写 `po.unpaid` 会直接 `no such column: po.unpaid` 报 500。
#   ⚠️ 人名列（creator_name / auditor_name / last_op_*）库里只存 **id**，只能按 id 排
#      （按姓名排需要 join 主库 users，为一次排序把主库拖进这条热查询不划算）。
_PO_ORDER_SQL = {
    'id':                'po.id',
    'order_no':          'po.order_no',
    'supplier':          'c.name',
    'supplier_category': 'c.supplier_category',
    'qty':               'order_qty',
    'warehouse':         'po.warehouse_id',
    'status':            'po.status',
    'total_amount':      'po.total_amount',
    'received_amount':   'po.received_amount',
    'paid_amount':       'po.paid_amount',
    'unpaid':            '(COALESCE(po.received_amount,0) - COALESCE(po.paid_amount,0))',
    'return_amount':     'return_total',
    'audit_time':        'po.audit_time',
    'order_date':        'po.order_date',
    'creator_name':      'po.operator_id',
    'note':              'po.note',
    'print_count':       'po.print_count',
    'source':            'po.source',
    'created_at':        'po.created_at',
    'expected_date':     'po.expected_date',
    'mark':              'po.mark',
    'received_at':       'po.received_at',
    'auditor_name':      'po.auditor_id',
    'last_op_at':        'po.last_op_at',
    'last_op_name':      'po.last_op_by',
    'last_print_at':     'po.last_print_at',
    'last_print_name':   'po.last_print_by',
}


def purchase_order_list(status='', supplier_id=0, date_from='', date_to='', limit=100, offset=0,
                        keyword='', warehouse_id=0, creator='', only_marked=False,
                        exclude_status='', source='', print_state='', product_keyword='',
                        returnable=False, department_id=0, handler='', auditor='', mark='',
                        order_by='', order_dir=''):
    """P1-3 补 4 个筛选（部门 / 经办人 / 审核人 / 标记内容）。全部默认空 = 不筛 ⇒ 既有调用方零影响。

      · `department_id`  精确匹配 `po.department_id`（引用 `departments.id`，v408 已加列）
      · `handler`        精确匹配 `po.handler`（用户 id 字符串，取值域与 `operator_id` 同）
      · `auditor`        精确匹配 `po.auditor_id`；哨兵 `'__none__'` = 只看「未标注审核人」；
                         其余非空值 = 看指定审核人（v408 P1-7 起才记，存量单多为空 ⇒ 必须有「未标注」出路）
      · `mark`           模糊匹配 `po.mark`（标记内容包含，与「只看已标记」`only_marked` 互补：
                         `only_marked` 只答「有没有标」，`mark` 答「标了什么」）
    """
    """采购单列表（v403 扩展：舟谱列表所需的聚合列 + 状态页签计数 + 底部合计行）。

    v403 之前只有 6 个筛选参数、只回 `{orders,total}`，且**不含**供应商类别 / 订单数量 /
    入库金额 / 审核时间 / 打印数 —— 舟谱那 17 列里我们只能凑出 8 列，其余只能靠前端东拼西凑。

    新增筛选（**全部默认空 = 不筛**，既有调用方零影响）：
      · `keyword`        单号 / 供应商名 / 备注 模糊匹配
      · `warehouse_id`   仓库
      · `creator`        创建人（`operator_id`，字符串，与 users.id 同型）
      · `only_marked`    只看「已标记」（`mark` 非空）
      · `exclude_status` 逗号分隔的状态黑名单。
        🔴 **为什么必须有它**：侧栏「采购单 / 采购退货单」是同一条 path + query 区分，
        前端原先的做法是**先分页、再从当页结果里 filter 掉 returned** —— 服务端分页 + 客户端过滤
        必然错位：页大小少几行、`total` 对不上、翻页会跳过记录。排除必须在 **SQL 里**做。

    v408（P1-3）再补 3 个筛选（同样全部默认空 = 不筛）：
      · `source`           单据来源，**精确**匹配 `manual` / `zhoupu` / `ai`；
                           另收哨兵 `'__none__'` = 只看**未标注来源**（`source` 为空串）——
                           生产 81 张存量单全是空串，没有这个哨兵就一张都筛不出来（详见下方实现注释）
      · `print_state`      `'printed'`（打印数>0）/ `'unprinted'`（=0）；其它值不筛
      · `product_keyword`  按**明细商品名 / 条码**找单（EXISTS 子查询，天然不重复行）
      🔴 三者都进 `base_where` ⇒ **状态页签计数（`counts`）也跟着变**，这是刻意的：
         页签数字应当反映「当前筛选下各状态有多少张」，而不是全库总量（否则切页签时
         数字会自己跳，页签就失去意义）。
      ✅ **v408（P1-7）「审核人」的源头已经补上了**：加列 `auditor_id` +
         `purchase_order_approve(oid, auditor_id)` 收操作人 + 两个调用方传当前登录人。
         至此"`approval_history.approver_name` 那列存在但采购单从不写"不再是拦路石
         （生产/本地均 0 行，`doc_approve` 只被 `/api/workflow` 调用 —— 那是**另一条**审批流）。
      ⚠️ 但**筛选参数仍未加**（本轮只做「列」，不做「筛」）：技术上现在可做，
         加之前要先想清楚「审核人为空的历史单怎么筛」（占绝大多数 ⇒ 需要一个"未标注"选项），
         属独立取舍，不在 P1-7 范围。

    新增返回（**追加键**，不删不改既有键 ⇒ 老前端与 `/api/purchase-orders` 继续可用）：
      · `counts`  按状态计数（**忽略 status 筛选、保留其它筛选** —— 这就是状态页签上的数字；
        若把 status 也算进去，切页签时所有数字会自己变，页签就没意义了）
      · `summary` 当前筛选下的合计（订单金额 / 入库金额 / 已结款 / 未结款），对应舟谱底部合计行

    🔴 **入库金额对历史数据是 0，这是事实不是缺陷**：`received_amount` 是 v403 才加的列，
    生产 79 张舟谱导入单创建时**只落了 `total_amount`（舟谱的「订单金额」）而没有任何入库金额**
    （旧导入器只写表头）。**不要**用「已入库 ⇒ 入库金额 = 订单金额」去回填 —— 舟谱这两列本来就
    不等（实测 1,038,778.91 vs 927,760.36，差 12%），那样做是**凭空造钱**。
    界面对这种行显示 `—` 而不是 `¥0.00`，让「真没有」与「真的是 0」可区分。
    """
    with get_db() as db:
        # ── 与 status 无关的筛选（状态页签计数要用同一套，否则数字会随页签漂移）────────
        base_where, base_params = [], []

        def _add(cond, val):
            base_where.append(cond)
            base_params.append(val)

        if supplier_id:
            _add("po.supplier_id=?", supplier_id)
        if date_from:
            _add("date(po.order_date)>=?", date_from)
        if date_to:
            _add("date(po.order_date)<=?", date_to)
        if warehouse_id:
            _add("po.warehouse_id=?", warehouse_id)
        if creator:
            _add("po.operator_id=?", str(creator))
        if only_marked:
            base_where.append("COALESCE(po.mark,'')<>''")
        _kw = str(keyword or '').strip()
        if _kw:
            base_where.append("(po.order_no LIKE ? OR COALESCE(c.name,'') LIKE ? "
                              "OR COALESCE(po.note,'') LIKE ?)")
            _like = f"%{_kw}%"
            base_params.extend([_like, _like, _like])
        _ex = [s.strip() for s in str(exclude_status or '').split(',') if s.strip()]
        if _ex:
            base_where.append("po.status NOT IN (%s)" % ",".join("?" * len(_ex)))
            base_params.extend(_ex)

        # ── v414（P2-6）「可退单」筛选（默认关 ⇒ 既有调用方零影响）──────────────────────
        # 退货建单页选「原采购单」时用它：只有**进过货**的单才谈得上退货。
        #   🔴 为什么把 `returned` 也算进来：v408（P0-3）的口径是「只要有退货就落 returned」，
        #      部分退货的单因此也变成 `returned` —— 若这里只放 `received/partial`，那张单
        #      在「再退第二批」时**搜不到**（静默假否定：用户以为系统里没有这张单）。
        #      `returned` 里到底还能不能退，由 `purchase_order_return_preview` 逐行算余量决定
        #      —— 那是唯一判定处，这里只做**粗筛**，不重复实现"能不能退"。
        #   ⚠️ `draft` / `pending_approval` / `cancelled` 一定没进过货 ⇒ 排除。
        #      **不能**写成「只留 received」—— `partial`（分批到货）同样是有货入库的。
        if returnable:
            base_where.append("po.status IN ('received','partial','returned')")

        # ── v408（P1-3）三个新筛选。全部默认空 = 不筛 ⇒ 既有调用方零影响 ────────────────
        # ① 单据来源。`source` 列 v403 就在库里（manual / zhoupu / ai）。
        #    🔴 必须**精确匹配**而不是 LIKE：`source` 是枚举（代码里只有这三个值），
        #       用 LIKE 的话搜 "man" 会同时命中 manual —— 看着能用，但用户以为自己在做模糊搜。
        #    🔴 `__none__` 是哨兵 = 筛「未标注来源」（`source` 为空串）。**这个出路不能少**：
        #       生产实测（`tenant_1.db`，81 张单）`source` **全部是空串** —— 它们是 v403
        #       之前建的存量单，被 `ADD COLUMN … DEFAULT ''` 填成空。没有哨兵的话，界面上
        #       「手工录入 / 舟谱导入 / AI 代建」三个选项**对现有数据一张都筛不出来**；
        #       而用户点「舟谱导入」得到空列表，会读成「没有舟谱导入的单」——
        #       实际有 79~81 张（v408 前序排查：6 月批量导入）。那是**静默假否定**，
        #       比筛不出来更坏。哨兵值 `__none__` 不会与真实来源撞车（来源全是代码常量）。
        _src = str(source or '').strip()
        if _src == '__none__':
            base_where.append("COALESCE(po.source,'')=''")
        elif _src:
            _add("COALESCE(po.source,'')=?", _src)
        # ② 打印状态。取值域**只有两个**（`printed` / `unprinted`），传别的值一律**不筛**
        #    （不是报错）—— 但界面只会给这两个选项，所以"传别的"只可能来自手改 URL。
        #    ⚠️ `print_count` 是 v403 才加的列。它的 DDL 是
        #       `ADD COLUMN print_count INTEGER DEFAULT 0` ⇒ SQLite 会把**已有行填成 0**，
        #       不是 NULL（本机 scratch 库实测：旧行加列后读出 `0`，`IS NULL` 命中 0 行）。
        #       租户库那条镜像 DDL 同款；启动期 `_sync_tenant_columns_on` 也把 `dflt` 带上了。
        #       生产实测（`tenant_1.db`，81 张单）：`IS NULL` = **0 行**、`=0` = 61 行、`>0` = 20 行。
        #    🔴 `COALESCE` 仍然**保留**，但理由要写对：它是**防御**（防将来有人用不带 DEFAULT
        #       的 `ADD COLUMN` 补列 —— 那种写法下已存在行才真的是 NULL），
        #       **不是**「历史单就是 NULL」。本注释早先写反过（写成"历史单是 NULL ⇒ 必须
        #       COALESCE"），已按生产实测更正 —— 否则下一个人会拿它当事实去推 SQL。
        #       COALESCE 本身无害：0 与 NULL 都命中 `=0`。
        _ps = str(print_state or '').strip()
        if _ps == 'printed':
            base_where.append("COALESCE(po.print_count,0)>0")
        elif _ps == 'unprinted':
            base_where.append("COALESCE(po.print_count,0)=0")
        # ③ 商品（按明细行的商品名 / 条码找单）。
        #    🔴 用 **EXISTS 子查询**而不是 JOIN 明细表：一张单有两行都匹配时，JOIN 会让
        #       这张单在结果里出现**两次**（`total` 也跟着变大），用户看到重复行 + 计数不对，
        #       且零报错。EXISTS 天然去重。
        #    ⚠️ 只按 `products.name` / `p.barcode` 匹配（明细行**没有**商品名快照列）。
        _pk = str(product_keyword or '').strip()
        if _pk:
            base_where.append(
                "EXISTS (SELECT 1 FROM purchase_order_items i "
                "        LEFT JOIN products p ON p.id = i.product_id "
                "        WHERE i.order_id = po.id "
                "          AND (COALESCE(p.name,'') LIKE ? OR COALESCE(p.barcode,'') LIKE ?))")
            _plike = f"%{_pk}%"
            base_params.extend([_plike, _plike])

        # ── P1-3 四个新筛选。全部默认空 = 不筛 ⇒ 既有调用方零影响 ───────────────────────
        # ① 部门。精确匹配 `departments.id`（v408 已加列 `department_id`）。
        if department_id:
            _add("po.department_id=?", int(department_id))
        # ② 经办人。精确匹配 `handler`（用户 id 字符串，取值域与 `operator_id` 同）。
        _hd = str(handler or '').strip()
        if _hd:
            _add("po.handler=?", _hd)
        # ③ 审核人。精确匹配 `auditor_id`；哨兵 `__none__` = 只看「未标注审核人」。
        #    🔴 必须有「未标注」出路：v408（P1-7）起才记 `auditor_id`，存量单绝大多数为空，
        #       没有这个哨兵，界面点「只看未审核」会返回空 ⇒ 用户误读成「没有待审核单」。
        _au = str(auditor or '').strip()
        if _au == '__none__':
            base_where.append("COALESCE(po.auditor_id,'')=''")
        elif _au:
            _add("po.auditor_id=?", _au)
        # ④ 标记内容。模糊匹配（含子串）。与 `only_marked`（只看「有没有标」）互补。
        _mk = str(mark or '').strip()
        if _mk:
            base_where.append("COALESCE(po.mark,'') LIKE ?")
            base_params.append(f"%{_mk}%")

        where, params = list(base_where), list(base_params)
        if status:
            where.append("po.status=?")
            params.append(status)
        w = (" WHERE " + " AND ".join(where)) if where else ""
        w_base = (" WHERE " + " AND ".join(base_where)) if base_where else ""
        _from = "FROM purchase_orders po LEFT JOIN contacts c ON po.supplier_id=c.id"

        # v470：服务端排序（前端表头点击）。`order_by` 非法 / 缺省 ⇒ 回落 `po.id DESC`
        #   （与 v470 之前的行为**逐字一致** ⇒ 老前端不传这两个参数时零观感变化）。
        #   🔴 尾缀 `, po.id DESC` 是**决定性 tiebreaker**：排序列大量同值时
        #      （状态 / 来源 / 金额 0），SQL 不保证同值行的相对顺序稳定 ⇒ 翻页会出现
        #      「同一单重复出现、另一单整页消失」。这不是理论问题，是分页表的经典事故。
        _order_expr = _PO_ORDER_SQL.get((order_by or '').strip())
        _order_dir = 'ASC' if str(order_dir or '').strip().lower() == 'asc' else 'DESC'
        _osql = (f" ORDER BY {_order_expr} {_order_dir}, po.id DESC"
                 if _order_expr else " ORDER BY po.id DESC")

        # 行级聚合用**相关子查询**：只对当前页这 N 行求值。不写成
        # `LEFT JOIN (SELECT order_id,SUM(..) FROM purchase_order_items GROUP BY order_id)`——
        # 那会把**整张明细表**物化一遍，单量上量后拖慢每一次翻页，而此时只需要 50 行。
        _agg = ("(SELECT COUNT(*) FROM purchase_order_items i WHERE i.order_id=po.id) AS item_count, "
                "(SELECT SUM(i.quantity) FROM purchase_order_items i WHERE i.order_id=po.id) AS order_qty, "
                "(SELECT CASE WHEN COUNT(DISTINCT NULLIF(i.unit,''))=1 THEN MAX(i.unit) ELSE '' END "
                "   FROM purchase_order_items i WHERE i.order_id=po.id) AS order_unit, "
                # v481（P2-①）：列表「参考金额」= 按参考成本价(products.purchase_price)估算的整单成本。
                #   明细行没有参考成本价快照 ⇒ 现 JOIN products 取档案价；与详情页 `product_purchase_price`
                #   同一口径（详情页那列就是它）。订单级只有这一种表示法（一行一个价，整单汇总），
                #   所以列表显示"整单参考金额"而非"每行参考价"。
                "(SELECT COALESCE(SUM(i.quantity * COALESCE(p.purchase_price,0)),0) "
                "   FROM purchase_order_items i LEFT JOIN products p ON p.id=i.product_id "
                "   WHERE i.order_id=po.id) AS ref_amount")

        orders = [dict(r) for r in db.execute(
            f"SELECT po.*, c.name AS supplier_name, "
            f"       COALESCE(c.supplier_category,'') AS supplier_category, {_agg}, "
            f"       (SELECT COALESCE(SUM(pr.total_amount),0) FROM purchase_returns pr "
            f"          WHERE pr.purchase_order_id=po.id "
            # v451：草稿（未过账）**不进**退货金额 —— 它既没扣库存也没冲应付，
            #   算进来的话列表上会显示一笔"凭空多出来的退货"，与实际账不符。
            f"            AND COALESCE(pr.status,'confirmed')!='draft') AS return_total "
            f"  {_from}{w}{_osql} LIMIT ? OFFSET ?",
            params + [limit, offset]).fetchall()]

        # v415（P2-7）自定义字段：把 `extra_json` 解析成 `extra`，供列表里的自定义列出值。
        #   ⚠️ 解析后**丢掉**原始字符串键：同一个事实在一份响应里出现两种形态
        #      （`'{}'` 与 `{}`）会诱使前端去读那个字符串 —— 那就是第二份表示，早晚打架。
        #   ⚠️ 老库 / 未迁移的库没有这一列 ⇒ `.pop(..., '')` 得空串 ⇒ `extra = {}`
        #      ⇒ 自定义列整列显示 `—`（**可降级，不是崩溃**）。
        for _o in orders:
            _o['extra'] = load_extra(_o.pop('extra_json', ''),
                                     src='purchase_orders.extra_json')

        total = db.execute(f"SELECT COUNT(*) {_from}{w}", params).fetchone()[0]

        counts = {r['status']: int(r['n'] or 0) for r in db.execute(
            f"SELECT po.status, COUNT(*) n {_from}{w_base} GROUP BY po.status",
            base_params).fetchall()}
        counts['all'] = sum(counts.values())

        s = db.execute(
            f"SELECT COALESCE(SUM(po.total_amount),0) order_amount, "
            f"       COALESCE(SUM(po.received_amount),0) received_amount, "
            f"       COALESCE(SUM(po.paid_amount),0) paid_amount "
            f"  {_from}{w}", params).fetchone()
        _oa = round(float(s['order_amount'] or 0), 2)
        _ra = round(float(s['received_amount'] or 0), 2)
        _pa = round(float(s['paid_amount'] or 0), 2)

        return {
            'orders': orders,
            'total': total,
            'counts': counts,
            'summary': {
                'order_amount': _oa,
                'received_amount': _ra,
                'paid_amount': _pa,
                # 未结款 = 入库金额 − 已结款（与舟谱一致：已结款 + 未结款 = **入库金额**，
                # 不是订单金额 —— 用订单金额算会把「还没入库的那部分」也当成欠款）。
                'unpaid_amount': round(_ra - _pa, 2),
                'count': int(total or 0),
            },
            'limit': limit,
            'offset': offset,
        }

def purchase_order_neighbors(oid):
    """采购单「上一条 / 下一条」+ 位置读数（v408 P1-5）。

    🔴 **口径只有一条：全库 `id DESC` 顺序** —— 也就是列表页默认视图的顺序
       （见 `purchase_order_list` 末尾的 `ORDER BY po.id DESC`；该列表默认 `status=''`，
       即"全部状态"，所以默认视图下两者逐字同源）。

    🔴 **为什么不做「跟随列表筛选」**：那要把用户当前全部筛选条件（状态 / 供应商 / 日期 /
       关键词 / 仓库 / 创建人 / 来源 / 打印状态 / 商品…）从列表页带进详情页，而详情页
       可以被**直接打开**（深链、小程序、同事发来的链接）—— 带不全就会变成"有时候跟筛选、
       有时候不跟"，比完全不跟更难解释，也更像 bug。
       所以这里只认一个口径，并且**由界面把口径写出来**：
       「第 X / N 条（按采购单顺序，不受列表筛选影响）」。
       ⚠️ 不许把 `pos` 说成「当前筛选里的第几条」—— 那是另一个事实（＝同屏两个口径）。

    返回 `{id, prev_id, next_id, has_prev, has_next, pos, total}`；单不存在时返回 `None`。
    """
    with get_db() as db:
        hit = db.execute("SELECT id FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not hit:
            return None
        total = int(db.execute("SELECT COUNT(*) FROM purchase_orders").fetchone()[0] or 0)
        # 顺序是 id DESC ⇒ 更靠前 = **更大**的 id（上一条）；更靠后 = **更小**的 id（下一条）。
        # ⚠️ 两个方向的 ORDER BY 必须相反：写反了不会报错，只会把箭头指反。
        p = db.execute("SELECT id FROM purchase_orders WHERE id>? ORDER BY id ASC LIMIT 1",
                       (oid,)).fetchone()
        n = db.execute("SELECT id FROM purchase_orders WHERE id<? ORDER BY id DESC LIMIT 1",
                       (oid,)).fetchone()
        ahead = int(db.execute("SELECT COUNT(*) FROM purchase_orders WHERE id>?",
                               (oid,)).fetchone()[0] or 0)
        return {
            'id': int(oid),
            'prev_id': int(p['id']) if p else 0,
            'next_id': int(n['id']) if n else 0,
            'has_prev': bool(p),
            'has_next': bool(n),
            'pos': ahead + 1,
            'total': total,
        }


def purchase_order_get(oid):
    """单张采购单 + 明细（v403 补齐详情页要显示的字段）。

    v403 之前 `order` 只带 `supplier_name`、`items` 只带 `product_name/spec/unit` ——
    舟谱详情页的「供应商类别 / 仓库 / 条码 / 参考成本价 / 入库数量 / 入库金额」全都没有来源。
    这里**只加投影列**，不动任何既有键 ⇒ 既有调用方（老前端 / 小程序）零影响。
    ⚠️ `phone` 之类的 PII **刻意不投影**：开单详情用不到，不往响应里放。
    """
    with get_db() as db:
        o = db.execute(
            "SELECT po.*, c.name AS supplier_name, "
            "       COALESCE(c.supplier_category,'') AS supplier_category, "
            "       COALESCE(w.name,'') AS warehouse_name "
            "  FROM purchase_orders po "
            "  LEFT JOIN contacts c ON po.supplier_id=c.id "
            "  LEFT JOIN warehouses w ON po.warehouse_id=w.id "
            " WHERE po.id=?", (oid,)).fetchone()
        if not o: return None
        items = [dict(r) for r in db.execute(
            "SELECT poi.*, p.name AS product_name, p.spec, p.unit, p.barcode AS product_barcode, "
            "       p.purchase_price AS product_purchase_price, p.order_unit AS product_order_unit, "
            # v404：详情页「入库单」tab 要按舟谱显示「小单位条码 / 大单位条码 / 单位换算」，
            #       这三列在 v403 的投影里还没有来源 ⇒ 只会显示空白。仍然**只加投影列**，
            #       既有键一个不动（老前端 / 小程序零影响）。
            #       ⚠️ `unit_ratio` 刻意不投影：单位换算的权威口径是 `spec`（形如 `1#-12瓶`），
            #           `large_ratio/medium_ratio` 是**数量换算比**，两者不是一回事（见单位换算规范）。
            "       p.large_barcode, p.medium_barcode, p.large_unit, p.medium_unit, "
            "       p.large_ratio, p.medium_ratio, p.factory_price, "
            # v409（P2-1）：`p.unit` 必须**换个名字**投影 —— 直接写 `p.unit` 会被前面的
            #   `poi.*` 里的 `unit` 遮蔽（`sqlite3.Row["unit"]` 取第一个 = 订单行的单位），
            #   前端就永远拿不到「这个小单位叫什么」，三档下拉直接少一档。
            #   与 v404 的 `unit_label` 是**同一类坑、不同用途**：`unit_label` = 显示用的
            #   回退链（订单行优先），`base_unit` = 档案的小单位名（三档里的最小档）。
            "       p.unit AS base_unit, "
            # v404：`unit` 在这张投影里是**重名**的（`poi.unit` 与 `p.unit` 都叫 unit）——
            # `sqlite3.Row["unit"]` 取的是**第一个**（= `poi.unit`）。生产实测：
            # `purchase_order_items.unit` 大量为空串（建单时前端没传），而 `products.unit`
            # 有值（'件'/'瓶'）⇒ 界面「单位」列会整列空白。这里单开一个不重名的 `unit_label`
            # 做**回退链**（订单行的单位优先，空则用档案单位），界面用它。
            # ⚠️ 保留原 `unit` 键不动：既有调用方读的就是它（改语义 = 破坏性变更）。
            "       COALESCE(NULLIF(poi.unit,''), p.unit, '') AS unit_label "
            "  FROM purchase_order_items poi LEFT JOIN products p ON poi.product_id=p.id "
            " WHERE poi.order_id=?", (oid,)).fetchall()]
        # v409（P2-1）：每行补「三档换算信息」—— **在后端算好下发**，前端只负责显示。
        #   🔴 为什么不让前端拿 `large_ratio/medium_ratio` 自己算：① 这两列在库里是
        #      **混类型**（空串），`'' > 0` 在 SQLite 里为真、在 JS 里 `'' > 0` 为假 ⇒
        #      同一条规则两端判定相反；② 「哪一档可用」要同时判单位名非空**且**比值 > 0，
        #      在 JS 里再写一遍就是**第二份实现**，必然在边界上分岔（本仓铁律）。
        #      唯一实现 = `db/queries/units.py`，前端零算术。
        for _it in items:
            _pd = {
                'unit': _it.get('base_unit'),
                'medium_unit': _it.get('medium_unit'),
                'large_unit': _it.get('large_unit'),
                'medium_ratio': _it.get('medium_ratio'),
                'large_ratio': _it.get('large_ratio'),
                'order_unit': _it.get('product_order_unit') or '',
            }
            _it['unit_options'] = unit_options(_pd)
            _it['conv_text'] = conversion_text(_pd)
            _it['base_unit_price'] = _poi_base_price(_it)
            _it['base_qty'] = _poi_base_qty(_it)
        _ord = dict(o)
        # v415（P2-7）自定义字段：与**列表端点同一口径**（解析成 `extra`，丢掉原始字符串键）。
        #   详情页要用它渲染「自定义字段」块，并据此决定是否允许补填。
        #   ⚠️ 老库没有这一列 ⇒ 取到 `None`/缺键 ⇒ `load_extra` 返回 `{}`
        #      ⇒ 详情页**不渲染**空字段块（「没有」不写成"有一堆空字段"，本仓铁律）。
        _ord['extra'] = load_extra(_ord.pop('extra_json', '') or '',
                                   src='purchase_orders.extra_json')
        return {'order': _ord, 'items': items}


# v453：日期格式校验（`order_date` 行内编辑用）。与路由层 `_bad_doc_dates` 同一口径
#   （YYYY-MM-DD），但**写在写入层** —— 薄壳路由不该替 db 兜底，db 这一层才是唯一落库口。
_DOC_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# v453（R5）：已发生库存动作的状态 —— 这些状态下**不能改入库仓库**（货已经进了某个仓，
#   改单据上的仓库会让「库存实际在哪」与「单据说在哪」对不上，且零报错）。
_PO_STOCKED_STATUS = ("received", "partial", "returned")


def purchase_order_update_header(oid, note=None, expected_date=None, handler=None,
                                 department_id=None, warehouse_id=None, order_date=None,
                                 expected_status=None):
    """v452-followup（O10）／v453（R5）：更新采购单头部的**安全字段**。

    可写列与各自的闸门（🔴 分三档，**逐个字段**判，不是一个开关管全部）：
      · `note` / `expected_date` —— 纯描述性，**不触账本 / 不触库存 / 不触应付**，
        因此即便订单已确认 / 已入库也能改（这正是 O10「详情页行内编辑」能在 confirmed
        单上生效的后端闸门依据）。
      · `handler` / `department_id` / `order_date` —— **归属与日期**：改了会影响统计口径
        归到哪个部门 / 哪个人 / 哪一天，但**不造成物理不一致**（库存、应付都不动）
        ⇒ 任何状态都可改。
      · `warehouse_id` —— 🔴 **唯一有硬闸门的列**：货一旦进了库（received / partial /
        returned），改单据上的仓库 = 让「库存实际在哪」与「单据说在哪」分叉，
        且不会报任何错 ⇒ 这几个状态下**拒绝改**（改成同一个值不算改，放行）。

    🔴 守卫：仅当对应键不是 `None` 才更新该列（调用方不传 = 不改这一列），
       避免把「没传」误当成「清空」。
    🔴 校验失败一律返回 `{"error": ...}`，由路由层转成 400 如实报出 —— 不静默吞掉、
       也不假装保存成功。
    """
    with get_db() as db:
        cur = db.execute(
            "SELECT id, status, warehouse_id FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not cur:
            return {"error": "订单不存在"}
        cur = dict(cur)
        # 阶段 1（第 4 项）：字段锁单一源 —— 哪些字段在当前状态可改，统一问 doc_state。
        # 仓库是否可改由「是否已入库」决定（已入库锁仓库）；其余安全字段任何状态可改。
        _cur_status = str(cur.get("status") or "")
        _allow = editable_fields('purchase_order', _cur_status,
                                include_warehouse=(_cur_status not in _PO_STOCKED_STATUS))
        sets, vals = [], []
        # 未来若有人在此函数新增可写列，非安全字段会被这一道直接拦下（单一源兜底）。
        for _f in ('note', 'expected_date', 'handler', 'department_id', 'order_date'):
            if locals().get(_f) is not None and _f not in _allow:
                return {"error": "该单据已处于「%s」，字段「%s」已锁定不可修改"
                        % (status_label('purchase_order', _cur_status), _f)}
        if note is not None:
            sets.append("note=?")
            vals.append(str(note))
        if expected_date is not None:
            sets.append("expected_date=?")
            vals.append(str(expected_date))
        # —— v453（R5）经办人：存**主库 users.id 的字符串**（与 `operator_id` 同取值域）。
        #    空串 = 不指定（合法）。非数字 ⇒ 拒绝（拿员工档案 id 顶替会让归属变成另一个人，零报错）。
        if handler is not None:
            _h = str(handler or "").strip()
            if _h and not _h.isdigit():
                return {"error": "业务员必须是主库账号编号"}
            sets.append("handler=?")
            vals.append(_h)
        # —— v453（R5）部门：0 = 不指定（合法）；非 0 必须在 departments 里存在。
        if department_id is not None:
            try:
                _d = int(department_id or 0)
            except (TypeError, ValueError):
                _d = 0
            if _d < 0:
                return {"error": "部门不合法"}
            if _d and not db.execute("SELECT 1 FROM departments WHERE id=?", (_d,)).fetchone():
                return {"error": "部门不存在"}
            sets.append("department_id=?")
            vals.append(_d)
        # —— v453（R5）仓库：必须存在；已入库的单不允许改成**另一个**仓。
        if warehouse_id is not None:
            try:
                _w = int(warehouse_id or 0)
            except (TypeError, ValueError):
                _w = 0
            if not _w:
                return {"error": "请选择入库仓库"}
            if not db.execute("SELECT 1 FROM warehouses WHERE id=?", (_w,)).fetchone():
                return {"error": "仓库不存在"}
            if (str(cur.get("status") or "") in _PO_STOCKED_STATUS
                    and _w != int(cur.get("warehouse_id") or 0)):
                return {"error": "这张单已经入库，不能改入库仓库（改了库存与单据会对不上）"}
            sets.append("warehouse_id=?")
            vals.append(_w)
        # —— v453（R5）单据日期：不能清空（空日期会让「这单哪天发生的」永久丢失）。
        if order_date is not None:
            _od = str(order_date or "").strip()
            if not _od:
                return {"error": "单据日期不能为空"}
            if not _DOC_DATE_RE.match(_od):
                return {"error": "单据日期格式需为 YYYY-MM-DD（例如 2026-10-12）"}
            sets.append("order_date=?")
            vals.append(_od)
        if not sets:
            return {"success": True, "updated": 0}
        # 阶段 1（第 4 项）：乐观锁 —— 用加载时的 status 作令牌，并发下有人先改了状态，
        #   本次 rowcount=0 ⇒ 如实报「已被他人改」，不静默覆盖。
        _tok_sql, _tok_params = status_token_clause(expected_status if expected_status else _cur_status)
        vals.append(oid)
        _upd = db.execute(
            "UPDATE purchase_orders SET %s WHERE id=?%s" % (", ".join(sets), _tok_sql),
            list(vals) + _tok_params)
        if not _upd.rowcount:
            return {"error": "该采购单刚被别人改过状态（现为%s），本次修改未生效，请刷新后重试"
                    % status_label('purchase_order', expected_status if expected_status else _cur_status)}
        db.commit()
        return {"success": True, "updated": len(sets)}


def purchase_order_return_preview(oid):
    """采购退货的**可退预览**：这张单每行还能退多少（全部统一到**小单位**）。

    v414（P2-6）：详情页「转单为 → 采购退货」跳到退货建单页（`?kind=return&from_po=`）时，
    那一页要带出原单明细与可退量。

    🔴 为什么「可退量」必须在**后端**算：退货最终走 `purchase_return_create`
       （直连 `inventory_adjust(-qty)` 扣库存），库存是**小单位**量纲 ⇒ 退货数量
       **必须**是小单位。前端要自己算就得 `received_qty × ratio`，而 ratio 的来源列
       是混类型（空串）、`'' > 0` 在 SQLite 为真而在 JS 为假 ⇒ 那就是**第二份实现**，
       必然在边界上分岔。唯一实现留在这里（`_poi_received_base_qty` / `_poi_ratio`）。

    🔴 已退量按 `product_name` 关联 —— `purchase_return_items` **没有 `product_id` 列**
       （DDL 实测：`return_id, product_name, quantity, unit_price, amount`）。
       所以下面**统一用产品的规范名**当键（与我们写入时传下去的名字同源）；
       商品改名会让旧退货记录对不上 —— 这是**既有表结构**带来的约束，不是本次引入的，
       已在返回的 `note` 里向调用方说明。

    🔴 「不能退」的每一种都给**人话原因**（`reason`），界面照显 ——
       不许让用户对着一个点不动的按钮猜为什么。缺值一律空串（不编）。

    返回：
      `{order, can_return, reason, items[], total_amount, note}`
      · `items[].{product_id, product_name, unit, base_unit, quantity, base_qty,
                  received_qty, returned_qty, returnable_qty, unit_price,
                  base_unit_price, amount}`
        —— 四个数量字段**全是小单位**（`received_qty` 是**已入库**、不是订单行上的同名原单位列）。
      · `total_amount` = 可退金额（按折小单位价算）。**刻意不返回"可退总数量"**：
        不同商品的小单位不同（袋 / 瓶 / 盒），相加是一个**没有意义的伪指标**。
    """
    with get_db() as db:
        o = db.execute(
            "SELECT po.*, COALESCE(c.name,'') AS supplier_name, "
            "       COALESCE(w.name,'') AS warehouse_name "
            "  FROM purchase_orders po "
            "  LEFT JOIN contacts c ON po.supplier_id=c.id "
            "  LEFT JOIN warehouses w ON po.warehouse_id=w.id "
            " WHERE po.id=?", (oid,)).fetchone()
        if not o:
            return None
        o = dict(o)
        items = [dict(r) for r in db.execute(
            "SELECT poi.*, COALESCE(p.name,'') AS product_name, "
            "       COALESCE(NULLIF(poi.unit,''), p.unit, '') AS unit_label, "
            "       COALESCE(p.unit,'') AS base_unit "
            "  FROM purchase_order_items poi LEFT JOIN products p ON poi.product_id=p.id "
            " WHERE poi.order_id=? ORDER BY poi.id", (oid,)).fetchall()]
        # 已退量：一次 GROUP BY 拿全，**不要**每行一条 SQL（行数一多就是 N+1）。
        ret_map = {}
        try:
            for r in db.execute(
                    "SELECT COALESCE(pri.product_name,'') AS pname, "
                    "       COALESCE(SUM(pri.quantity),0) AS q "
                    "  FROM purchase_return_items pri "
                    "  JOIN purchase_returns pr ON pr.id = pri.return_id "
                    # v451：**草稿不计已退量** —— 草稿还没过账（库存未扣），把它算进"已退"
                    #   会让可退量凭空变小 ⇒ 用户被拦在原地退不了货，且**零报错**。
                    " WHERE pr.purchase_order_id=? "
                    "   AND COALESCE(pr.status,'confirmed')!='draft' "
                    " GROUP BY pri.product_name", (oid,)).fetchall():
                ret_map[str(r["pname"]).strip()] = float(r["q"] or 0)
        except Exception as e:
            # 只读预览不该因为一张可选表的问题整体失败 —— 但**绝不能静默**：
            #   已退量读不到 ⇒ 可退量会被高估。让调用方在 `note` 里看到这件事。
            _logger.warning("purchase_order_return_preview: 已退量读取失败 oid=%s: %s", oid, e)
            ret_map = None

        status = str(o.get("status") or '')
        out_items, total_amount = [], 0.0
        for it in items:
            name = str(it.get("product_name") or '').strip()
            received = _poi_received_base_qty(it, status)
            returned = 0.0 if ret_map is None else ret_map.get(name, 0.0)
            returnable = max(0.0, round(received - returned, 4))
            bprice = float(_poi_base_price(it) or 0)
            amount = round(returnable * bprice, 2)
            out_items.append({
                "product_id": it.get("product_id"),
                "product_name": name,
                "unit": it.get("unit_label") or "",
                "base_unit": it.get("base_unit") or "",
                "quantity": it.get("quantity") or 0,
                "base_qty": _poi_base_qty(it),
                "received_qty": received,
                "returned_qty": returned,
                "returnable_qty": returnable,
                "unit_price": it.get("unit_price") or 0,
                "base_unit_price": round(bprice, 6),
                "amount": amount,
            })
            total_amount += amount

        total_returnable = sum(float(x["returnable_qty"]) for x in out_items)
        can_return = total_returnable > 0 and bool(items) and ret_map is not None
        if ret_map is None:
            reason = "已退数量暂时读不到，为避免重复退货，先不能退。请稍后重试。"
        elif not items:
            reason = "这张单没有明细行，没有可退的货。"
        elif status in ("draft", "pending_approval", "cancelled"):
            reason = "这张单还没入库，没有货可退。"
        elif total_returnable <= 0:
            reason = "这张单的货已经全部退完了。"
        else:
            reason = ""

        note = ("数量单位为小单位（每行「单位」列下方注明）；提交后会扣减库存，"
                "并把这张单标记为「已退货」。金额按折小单位进货价计算。")
        if ret_map is None:
            note = "（已退数量读取失败，本次预览的可退量可能偏大）" + note
        return {
            "order": {
                "id": o.get("id"),
                "order_no": o.get("order_no") or "",
                "supplier_id": o.get("supplier_id") or 0,
                "supplier_name": o.get("supplier_name") or "",
                "warehouse_id": o.get("warehouse_id") or 0,
                "warehouse_name": o.get("warehouse_name") or "",
                "status": status,
                "order_date": o.get("order_date") or "",
                "received_at": o.get("received_at") or "",
                "total_amount": o.get("total_amount") or 0,
            },
            "can_return": can_return,
            "reason": reason,
            "items": out_items,
            "total_amount": round(total_amount, 2),
            "note": note,
        }


# ============================================================
# v404：采购单详情页「货款 / 入库单」两个 tab 的读与写
#   · 读：`purchase_order_payments` / `purchase_order_inbound`（都是**派生视图**，不建新表）
#   · 写：`purchase_payment_create`（登记一笔付款）
# ============================================================

def _po_money(v):
    """金额归一：`None` / 空串 / 脏值 → `0.0`，其余四舍五入到分。"""
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _po_get(o, key, default=0):
    """从 `sqlite3.Row` **或** `dict` 里安全取一列（两者取缺失键的异常类型不同）。"""
    try:
        v = o[key]
    except (KeyError, IndexError, TypeError):
        return default
    return default if v is None else v


def _po_received_amount(o):
    """**到货金额**（元）—— 全仓唯一的读法。v697c：历史单兜底。

    🔴 为什么需要它：`received_amount` 是 **v403 才加的列**。v403 之前落库的单
       （生产 79 张舟谱导入单，导入时直接标 `received`、没走 `confirm`）这一列是 0。
       若直接拿 0 当「一分货没到」：
         · `_po_unpaid` = max(0, 0 − 预付 − 已付) = 0 ⇒ **「付款」按钮永远不出现**；
         · 这批恰恰是老板最想核账的历史欠款单 —— 界面表现为「还能看，就是付不了钱」，
           典型的静默失效。
    🔴 为什么敢用订单金额兜底：`received` 这个状态就是**整单到齐**语义
       （`purchase_order_confirm` 整单全收才置它），所以到货金额的真值就是订单金额。
    🔴 为什么**只对 `received` 兜底**：`partial`（分批）到货了多少是未知数，
       拿订单金额顶上去就是**造数** —— 宁可显示 0（并在货款页提示），也不猜。
       生产当前 `partial` 为 0 张，不影响。
    """
    v = _po_money(_po_get(o, "received_amount"))
    if v <= 0 and str(_po_get(o, "status", "") or "").strip() == "received":
        return _po_money(_po_get(o, "total_amount"))
    return v


def _po_unpaid(o, ap=None):
    """**未结金额**的唯一算法（元）。与 v403 列表页的 `summary.unpaid_amount` 口径**逐字相同**。

    🔴 为什么用 `received_amount − paid_amount` 而不是 `receivables(ap).amount − paid_amount`：
       `receivables` 那一行**只有走过 `purchase_order_confirm` 的单才有**。舟谱导入的历史单
       （`source='zhoupudao'`，生产 79 张）在导入时就被直接标成 `received`，**没走 confirm**
       ⇒ 没有应付行 ⇒ 若以应付行为准，这些单的「未结金额」会恒为 `—`，
       而它们恰恰是老板最想核账的那批（历史欠款）。所以以 `purchase_orders` 两列为准。
       ⚠️ 应付行存在时（`ap` 传进来）调用方会**顺带比对**两者是否一致，不一致就在上层显示
          提示 —— 不静默（`receivables` 与 `purchase_orders` 是两处记账，理论上会分叉）。
    """
    return max(0.0, _po_received_amount(o)
                  - _po_money(_po_get(o, "prepaid_amount"))
                  - _po_money(_po_get(o, "paid_amount")))


def _po_overpaid(o):
    """**超付金额**（元）。独立于 `_po_unpaid` 的 `max(0, ...)` 兜底。

    v697：老板定「预付不设上限」⇒ 允许预付超过订单金额。若不单独算这个数，
    多付的部分会被 `_po_unpaid` 的 max 吃掉，界面显示「未结 0」——
    那是**看起来刚刚好、实际多给了钱**，属于本仓最忌讳的静默错数。

    口径：
      · 货还没到（`received_amount == 0`）：只能拿订单金额比 ⇒ `max(0, 预付 − 订单金额)`
      · 货已到一部分/全部：拿实际到货金额比 ⇒ `max(0, 预付 + 已付 − 入库金额)`
        （用入库金额而不是订单金额，因为只需要为「真正收到的货」付钱）
    """
    _pre = _po_money(_po_get(o, "prepaid_amount"))
    _paid = _po_money(_po_get(o, "paid_amount"))
    _recv = _po_received_amount(o)
    if _recv > 0:
        return max(0.0, _pre + _paid - _recv)
    return max(0.0, _pre - _po_money(_po_get(o, "total_amount")))


def supplier_balance(supplier_id):
    """P1-1：供应商维度应付余额 / 预付余额（跨该供应商**全部**单据，不是单张）。

    · 应付余额 = 该供应商所有未作废应付（receivables type='ap', contact_id=供应商）的
      (amount − paid_amount) 之和。与某张单的 `ap_amount`（本单应付）是两回事。
    · 预付余额 = 该供应商所有未冲抵预付款（prepayments type='ap', ref_id=0）的
      (amount − used_amount) 之和。
    金额一律四舍五入 2 位（与界面一致的口径）。
    """
    with get_db() as db:
        sp = db.execute(
            "SELECT COALESCE(SUM(amount - paid_amount),0) AS v FROM receivables "
            " WHERE type='ap' AND contact_id=? AND status!='void'",
            (int(supplier_id or 0),)).fetchone()
        spp = db.execute(
            "SELECT COALESCE(SUM(amount - used_amount),0) AS v FROM prepayments "
            " WHERE type='ap' AND contact_id=? AND ref_id=0",
            (int(supplier_id or 0),)).fetchone()
        return {
            "supplier_id": int(supplier_id or 0),
            "payable": _po_money(sp["v"] if sp else 0),
            "prepaid": _po_money(spp["v"] if spp else 0),
        }


def purchase_order_payments(oid):
    """「货款」tab 的数据：订单信息 + 付款流水。**只读**。

    口径（每一格都写清楚来源，界面不许自己再算一遍）：

    | 界面字段 | 来源 | 缺数据时 |
    |---|---|---|
    | 订单编号 | `purchase_orders.order_no` | — |
    | 供应商名称 | `contacts.name` | — |
    | 订单金额 | `purchase_orders.total_amount` | `0.00` |
    | 入库金额 | `purchase_orders.received_amount` | `0.00` |
    | 应付金额 | `receivables(type='ap',ref_type='purchase',ref_id=oid).amount` | **`None`** ⇒ 界面 `—` |
    | 已结金额 | `purchase_orders.paid_amount` | `0.00` |
    | 未结金额 | `max(0, 入库金额 − 已结金额)`（`_po_unpaid`） | `0.00` |
    | 已预付 | `prepayments(type='ap', contact_id=供应商)` 的 `Σ(amount-used_amount)` | `0.00` |

    🔴 「应付金额」缺数据时返回 **`None` 而不是 `0.0`**：舟谱导入的历史单没有应付行，
       显示 `¥0.00` 会被老板读成「这笔欠款是零」（**"没有"≠"是零"**，与 v403
       `has_items` 显示 `—` 同一条纪律）。同理 `ap` 是否存在用 `ap_exists` 单独报出。

    付款流水 = `cash_flow WHERE ref_type='purchase' AND ref_id=? AND type='expense'`
    （由本文件的 `purchase_payment_create` 写入）。现在生产为空 ⇒ 界面走空态，
    这正是舟谱那张「您还没有任何付款信息」的位置。
    🔴 结算两张表是**惰性建表**（`_init_settlement_tables`），本函数是第 10 个入口：
       不调 ⇒ 从未建过结算单的库上 `no such table` ⇒ 打开货款 tab 直接 500。
       （本文件既有纪律：每个入口函数都要调一次，见该函数 docstring。）
    """
    _init_settlement_tables()
    with get_db() as db:
        o = db.execute(
            "SELECT po.*, COALESCE(c.name,'') AS supplier_name "
            "  FROM purchase_orders po LEFT JOIN contacts c ON po.supplier_id=c.id "
            " WHERE po.id=?", (oid,)).fetchone()
        if not o:
            return None
        od = dict(o)
        ap = db.execute(
            "SELECT id, amount, paid_amount, status, created_at FROM receivables "
            " WHERE type='ap' AND ref_type='purchase' AND ref_id=? ORDER BY id LIMIT 1",
            (oid,)).fetchone()
        apd = dict(ap) if ap else None
        # 已预付：`type='ap'` = **我们付给供应商**的预付款；`ar` 是客户预付给我们，不是这里的事。
        pp = db.execute(
            "SELECT COALESCE(SUM(amount - used_amount),0) AS v FROM prepayments "
            " WHERE type='ap' AND contact_id=? AND ref_id=0",
            (od.get("supplier_id") or 0,)).fetchone()
        # 🔴 v697：必须带出 `category` —— 预付与付款在 `cash_flow` 里同为 `type='expense'`，
        #    唯一的区分点就是 category（'采购预付款' / '采购付款'）。不返回它，界面只能把
        #    两种钱混成一张表，用户看不出「这 500 是货没到就先给的」还是「这是结货款」。
        flows = [dict(r) for r in db.execute(
            "SELECT id, account, amount, note, operator_id, category, created_at FROM cash_flow "
            " WHERE ref_type='purchase' AND ref_id=? AND type='expense' "
            " ORDER BY id DESC", (oid,)).fetchall()]
        # P1-1：供应商维度应付余额 / 预付余额（跨该供应商**全部**单据，不是本单）。
        sb = supplier_balance(od.get("supplier_id") or 0)
        # P1-2：本采购单归属的结算单（可能多张，已作废的除外）。
        stmts = [dict(r) for r in db.execute(
            "SELECT st.id, st.settle_no, st.status, si.amount "
            "  FROM purchase_settlement_items si "
            "  JOIN purchase_settlements st ON st.id=si.settlement_id "
            " WHERE si.ref_type='purchase' AND si.ref_id=? ORDER BY st.id DESC",
            (oid,)).fetchall()]
        unpaid = _po_unpaid(od, apd)
        # ── 付款 / 预付的**唯一判定**（v697）─────────────────────────────
        # 前端不许自己拿 received_amount 去猜，否则「界面说能预付、后端说状态不对」
        # 这类自相矛盾迟早出现。三种模式互斥：
        #   prepay = 货未到且已审 ⇒ 只能预付
        #   pay    = 有到货金额且未结 > 0 ⇒ 只能结货款
        #   none   = 其余（草稿/待审/已结清/已取消/已退货）
        _st_v = str(od.get("status") or "").strip()
        _recv_v = _po_received_amount(od)
        if _st_v in ("cancelled", "returned"):
            _pay_mode = "none"
        elif _recv_v > 0:
            _pay_mode = "pay" if unpaid > 0.005 else "none"
        # v697c：`confirmed` 才是生产真实的「已审待执行」（v417 定的），`approved` 保留兼容。
        elif _st_v in ("approved", "confirmed"):
            _pay_mode = "prepay"
        else:
            _pay_mode = "none"
        return {
            "order": {
                "id": od["id"],
                "order_no": od.get("order_no") or "",
                "supplier_id": od.get("supplier_id") or 0,
                "supplier_name": od.get("supplier_name") or "",
                "status": od.get("status") or "",
                "order_date": od.get("order_date") or "",
                "audit_time": od.get("audit_time") or "",
                "total_amount": _po_money(od.get("total_amount")),
                "received_amount": _po_received_amount(od),
                "paid_amount": _po_money(od.get("paid_amount")),
                "unpaid_amount": unpaid,
                # 🔴 v697：本字段**改为本单口径**（原来是该供应商所有预付的余额）。
                #    一旦本单能预付，继续用供应商口径就会把别的单的钱显示成这张单的。
                #    供应商口径仍在下面 `supplier_prepay`（P1-1 就在返回它）。
                "prepaid_amount": _po_money(od.get("prepaid_amount")),
                "overpaid_amount": _po_overpaid(od),
                # 付款模式：**后端说了算**，前端只渲染。判定见下方 _pay_mode。
                "pay_mode": _pay_mode,
                # 预付参考上限（不拦，只做界面提示）。老板定了「不设上限」。
                "prepay_cap": max(0.0, _po_money(od.get("total_amount")) - _po_money(od.get("prepaid_amount"))),
                # P1-1：供应商全口径余额（不是本单）。缺数据 = 0（这两个本就是聚合和，没有就是 0）。
                "supplier_payable": sb["payable"],
                "supplier_prepay": sb["prepaid"],
                "ap_exists": bool(apd),
                "ap_amount": _po_money(apd["amount"]) if apd else None,
                "ap_paid_amount": _po_money(apd["paid_amount"]) if apd else None,
                "ap_status": (apd["status"] if apd else "") or "",
                # 🔴 两处记账分叉检测：应付未结 vs 采购单未结。不相等 ⇒ 界面必须说出来，
                #    否则老板在「货款」看到 100、在「往来账」看到 900，谁都不知道信哪个。
                "ap_unpaid_amount": (max(0.0, _po_money(apd["amount"]) - _po_money(apd["paid_amount"]))
                                     if apd else None),
            },
            # P1-2：本单归属的结算单列表（可能为空 ⇒ 界面显示「—」）。
            "settlements": stmts,
            "payments": flows,
        }


def purchase_payment_create(oid, amount, account="现金", note="", operator_id=""):
    """给一张采购单登记一笔付款。返回 `{'payment_id','amount','paid_amount','unpaid_amount'}`。

    🔴 **为什么本函数存在而不是委派 `finance.payment_create`**（这是最要紧的一段）：
       `finance.payment_create(..., ref_type, ref_id)` 内部执行的是
       `UPDATE receivables SET paid_amount=paid_amount+? WHERE id=?` —— 它那个 `ref_id`
       的语义是 **`receivables.id`（应收/应付表的行号）**，不是业务单据号。
       若把**采购单 id** 传进去，它会去改**行号恰好等于该数字的另一张应收单**
       ⇒ 钱记到了别人头上、真正的应付没动、而且**零报错**。
       所以这里自建一条：应付行一律用
       `type='ap' AND ref_type='purchase' AND ref_id=<采购单id>` **定位**，不碰 id 语义。

    安全性质（五条缺一不可，都在**同一个事务**里）：
      ① `amount > 0`（0 或负数一律拒）；
      ② `amount <= 未结金额`（**防超付**；未结的算法与列表页口径同源 `_po_unpaid`）；
      ③ 期间门禁 `check_period_open()` —— 关账期不许动钱。⚠️ 与 `purchase_order_confirm`
         的写法**不同**：那里 `import` 和 `check` 裹在同一个 `try` 里，**关账被拒会被吞掉**
         （当成 import 失败）。钱的操作不能这样，这里 import 与 check 分开，check 抛就拒。
      ④ 三处同步：`receivables(ap).paid_amount/status` → `purchase_orders.paid_amount`
         → `cash_flow` 一行。**要么都成，要么都不成**（`get_db_tx()` 一个事务）。
      ⑤ **没有应付行的单直接拒**，不做「只涨 `paid_amount` 不涨应付」的降级 ——
         那种"看着成功"会让报表两边永久对不上，比报错坏得多。导入的历史单（79 张）
         本来就不该在这里付款（它们连明细都没有），要付得先在往来账里把应付建起来。

    凭证：`auto_journal_for_payment`（借 2202 应付账款 / 贷 1002 银行存款），
    与 `finance.payment_create` 同一条科目口径，不另造一套。
    """
    try:
        amt = round(float(amount or 0), 2)
    except (TypeError, ValueError):
        return {"error": "付款金额不是合法数字"}
    if amt <= 0:
        return {"error": "付款金额必须大于 0"}
    # ③ 期间门禁：import 与 check **分开**（见上面 docstring 的说明）
    try:
        from erp_db import check_period_open as _cpo
    except Exception as e:  # pragma: no cover - 循环导入兜底
        _logger.warning("check_period_open import failed in purchase_payment_create: %s", e)
        _cpo = None
    if _cpo is not None:
        try:
            _cpo()
        except Exception as e:
            return {"error": str(e) or "会计期间已关闭，无法付款"}
    with get_db_tx() as db:
        o = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {"error": "采购单不存在"}
        unpaid = _po_unpaid(dict(o))
        if amt > unpaid + 1e-9:
            return {"error": f"付款金额超过未结金额（未结 ¥{unpaid:.2f}）"}
        ap = db.execute(
            "SELECT id, amount, paid_amount FROM receivables "
            " WHERE type='ap' AND ref_type='purchase' AND ref_id=? ORDER BY id LIMIT 1",
            (oid,)).fetchone()
        if not ap:
            return {"error": "这张单没有应付记录（多为导入的历史单），无法登记付款"}
        # ④-a 应付行：**按 ref_type/ref_id 定位**（绝不用 id 语义）
        db.execute(
            "UPDATE receivables SET "
            "  paid_amount=paid_amount+?, "
            "  status=CASE WHEN paid_amount+? >= amount THEN 'paid' "
            "              WHEN paid_amount+? > 0 THEN 'partial' ELSE status END "
            "WHERE id=?", (amt, amt, amt, ap["id"]))
        # ④-b 采购单：已结金额 + 状态（`paid` 只作标记，不参与 `purchase_order_confirm`
        #      的状态机 —— 那张表的 status 只有 draft/approved/partial/received/cancelled 等）
        db.execute("UPDATE purchase_orders SET paid_amount=COALESCE(paid_amount,0)+? WHERE id=?",
                   (amt, oid))
        # ④-c 资金流水：`type='expense'`（付出）、`ref_type='purchase'`（货款 tab 靠它查回）
        acc = str(account or "现金").strip() or "现金"
        bal = db.execute("SELECT current_balance FROM accounts WHERE name=?", (acc,)).fetchone()
        db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name=?", (amt, acc))
        new_bal = (bal["current_balance"] if bal else 0) - amt
        cur = db.execute(
            "INSERT INTO cash_flow (account,type,amount,balance_after,contact_id,ref_type,ref_id,"
            "category,note,operator_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (acc, "expense", amt, new_bal, o["supplier_id"] or 0, "purchase", oid,
             "采购付款", note or "", operator_id or ""))
        pid = cur.lastrowid
        try:
            from erp_db import auto_journal_for_payment
            auto_journal_for_payment(pid, db_conn=db)
        except Exception as e:
            # 凭证生成失败**必须回滚整笔付款**：钱动了而账没记，比不付更坏。
            _logger.warning("auto_journal_for_payment failed in purchase_payment_create: %s", e)
            raise
        o2 = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        _o2d = dict(o2) if o2 is not None else {}
        # 🔴 v697：未结金额必须走 `_po_unpaid`（它现在会减 `prepaid_amount`）。
        #    这里原先自己算 `max(0, received − paid)`，与列表页/货款页**不是同一个函数**
        #    ⇒ 预付场景下付款成功后前端拿到的是一个偏大的未结额，界面会「付了但没减」。
        return {"payment_id": pid, "order_id": oid, "amount": amt,
                "account": acc,
                "paid_amount": _po_money(_o2d.get("paid_amount")),
                "unpaid_amount": _po_unpaid(_o2d),
                "overpaid_amount": _po_overpaid(_o2d)}


def purchase_prepayment_create(oid, amount, account="现金", note="", operator_id=""):
    """给一张**已审待执行、货还没到**的采购单登记预付款。返回 dict。

    ⚠️ 与 `purchase_payment_create` 的分工（两个函数、两种前置条件，不要合并）：
      · 本函数 = **货未到、先给钱**：要求 `status='approved'`，**不碰应付行**（那时还没有）；
      · `purchase_payment_create` = **货已到、结货款**：要求有应付行，且金额 ≤ 未结。
      合并成一个函数会出现「到底按哪套前置条件校验」的歧义，且付款侧的五道安全性质
      会被预付款的宽松条件稀释 —— 钱的入口宁可分开写。

    🔴 为什么不写 `prepayments` 表（老板 2026-10-26 定「走货款流水」）：
       `prepayments` 的语义是**按供应商的往来账余额**（`supplier_balance` 就是拿它算的），
       一旦同一笔钱既在 `prepayments` 又在 `cash_flow`，就会出现「两处记账」，
       而这正是本仓在 `receivables` vs `purchase_orders` 上已经吃过一次亏的事
       （货款页那个「对不上」的黄色提示就是为它写的）。所以只有一个源：`cash_flow`。
       代价是往来账的「预付账款」在 `prepayments` 表里查不到 —— 已在界面上
       把两个概念分开写（本单预付 / 该供应商预付余额），不混淆。

    🔴 为什么预付也走 `auto_journal_for_payment`（借 2202 应付 / 贷 1002 银行）：
       看起来「预付应该记 1123 预付账款」。但入库时 `auto_journal_for_purchase` 会贷
       `2202` **全额**，如果预付记 1123，就还得在入库时补一张「1123 → 2202」的转账凭证，
       否则 2202 虚高、1123 挂着一个永远不会平的余额。统一记 2202 时，
       「入库贷全额 − 预付借部分 = 真实应付」**自动就平了**，不需要任何手工转账。
       小企业口径里这就是「应付账款借方余额」，实质等于预付，报表读得通。

    **不设金额上限**（老板明确要求）。但超付会被算进 `overpaid_amount` 并在货款页明示。
    """
    try:
        amt = round(float(amount or 0), 2)
    except (TypeError, ValueError):
        return {"error": "预付款金额不是合法数字"}
    if amt <= 0:
        return {"error": "预付款金额必须大于 0"}

    # 期间门禁：import 与 check **分开**（与 `purchase_payment_create` 同一条纪律 ——
    # `purchase_order_confirm` 那种 `try: import; check` 合并写法会把「关账被拒」吞成
    # 「import 失败」，钱的操作不能这样）。
    try:
        from erp_db import check_period_open as _cpo
    except Exception as e:  # pragma: no cover - 循环导入兜底
        _logger.warning("check_period_open import failed in purchase_prepayment_create: %s", e)
        _cpo = None
    if _cpo is not None:
        try:
            _cpo()
        except Exception as e:
            return {"error": str(e) or "会计期间已关闭，无法预付款"}

    # 懒建列：老租户库没有 prepaid_amount 时在这里补（一个进程只跑一次）
    _ensure_prepaid_column()

    with get_db_tx() as db:
        o = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not o:
            return {"error": "采购单不存在"}
        _od = dict(o)
        _st = str(_od.get("status") or "").strip()
        if _st != "approved":
            # 用中文状态说人话，不回显 `draft` 这种英文值（与本仓状态映射纪律一致）
            _zh = {"draft": "草稿（还没提交审核）",
                   "pending_approval": "待审批（等审批通过）",
                   "partial": "部分入库（货已到一部分，请用「付款」）",
                   "received": "已入库（货已到，请用「付款」）",
                   "returned": "已退货", "cancelled": "已取消"}.get(_st, _st or "未知")
            return {"error": f"只有「已审待执行」的采购单能预付款，当前是「{_zh}」"}

        acc = str(account or "现金").strip() or "现金"
        bal = db.execute("SELECT current_balance FROM accounts WHERE name=?", (acc,)).fetchone()
        db.execute("UPDATE accounts SET current_balance=current_balance-? WHERE name=?", (amt, acc))
        new_bal = (bal["current_balance"] if bal else 0) - amt
        # category 是「预付」与「付款」在流水上的唯一区分点（同表同 type='expense'）
        cur = db.execute(
            "INSERT INTO cash_flow (account,type,amount,balance_after,contact_id,ref_type,ref_id,"
            "category,note,operator_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (acc, "expense", amt, new_bal, _od.get("supplier_id") or 0, "purchase", oid,
             "采购预付款", note or "", operator_id or ""))
        pid = cur.lastrowid
        db.execute("UPDATE purchase_orders SET prepaid_amount=COALESCE(prepaid_amount,0)+? WHERE id=?",
                   (amt, oid))
        try:
            from erp_db import auto_journal_for_payment
            auto_journal_for_payment(pid, db_conn=db)
        except Exception as e:
            # 凭证失败必须回滚整笔预付：钱动了而账没记，比不付更坏
            # （与 `purchase_payment_create` 同一条硬纪律）。
            _logger.warning("auto_journal_for_payment failed in purchase_prepayment_create: %s", e)
            raise
        o2 = db.execute("SELECT * FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        _o2d = dict(o2) if o2 is not None else {}
        return {"prepayment_id": pid, "order_id": oid, "amount": amt, "account": acc,
                "prepaid_amount": _po_money(_o2d.get("prepaid_amount")),
                "total_amount": _po_money(_o2d.get("total_amount")),
                "unpaid_amount": _po_unpaid(_o2d),
                "overpaid_amount": _po_overpaid(_o2d)}


def purchase_order_inbound(oid):
    """「入库单」tab 的数据：由**本单自己的到货事实**合成的入库凭证。**只读、不建表**。

    🔴 它是**派生视图**，不是新单据 —— 这件事必须说清楚，否则会被误读成「系统里真有一张 RK 单」：
       · `inbound_orders` / `inbound_order_items` 两张表**存在但是空的**（0 行），
         且**没有任何列**指向 `/api/psi` 的采购单（列只有 supplier_id/warehouse_id/...），
         所以它们不是这个 tab 的来源，也不该为了这个 tab 去写它们（那会变成第二套入库台账，
         与 `purchase_order_confirm` 的 `batch_in` 分叉）。
       · 表头**全部**取自采购单本身：入库时间 = `received_at`（v408 P0-6 新增的**独立列**）、
         仓库、供应商、入库人 / 创建人 = `operator_id`。
         🔴 v408（P0-6）修正：此处此前把 **`audit_time`（审核时间）**当作「入库时间」返回 ——
            同一个值在界面上一列叫「审核时间」（详情信息条）、另一列叫「入库时间」（本 tab），
            对**先审后到**的单这两个时刻可以差好几天。现在两者**分列返回、各表各的事实**：
            `received_at` → 「入库时间」；`audit_time` 保留在表头里但**只表示审核时间**，
            界面不得再拿它当入库时间（历史单 `received_at` 为空是**如实**的，显示 `—`，
            不要回退去读 `audit_time` —— 那正是本次要拆掉的混淆）。
       · 明细**全部**取自 `purchase_order_items`：数量 / 金额 / 已入库数量 / 批次号 /
         到期日 / 生产日期。
       · **唯一派生出来的东西 = 入库单号**：源单号把 `CD` 前缀换成 `RK`（舟谱的编号习惯，
         形如 `CD2610080000002` → `RK2610080000002`）。返回时同时给 `derived: true`，
         界面必须带「按源单派生」的说明。**不落库、不参与唯一性**。

    空态：只有 `received` / `partial` 才有可看的到货事实。`draft`/`approved`/`pending_approval`
    返回 `{empty: True, reason: '本单还没入库'}`（**不要**渲染一张全 0 的表 —— 那会被读成
    「入了 0」）。`cancelled`/`returned` 同样给明确理由。
    """
    with get_db() as db:
        o = db.execute(
            "SELECT po.*, COALESCE(c.name,'') AS supplier_name, COALESCE(w.name,'') AS warehouse_name "
            "  FROM purchase_orders po "
            "  LEFT JOIN contacts c ON po.supplier_id=c.id "
            "  LEFT JOIN warehouses w ON po.warehouse_id=w.id "
            " WHERE po.id=?", (oid,)).fetchone()
        if not o:
            return None
        od = dict(o)
        status = (od.get("status") or "").strip()
        src_no = od.get("order_no") or ""
        # 入库单号：派生（见 docstring）。无源单号时留空，界面显示 `—`，不编。
        rk_no = ""
        if src_no:
            rk_no = ("RK" + src_no[2:]) if src_no.startswith("CD") else ("RK" + src_no)
        if status not in ("received", "partial"):
            reason = {
                "draft": "这张单还是草稿，没有入库单。",
                "approved": "这张单已确认但还没到货，没有入库单。",
                "pending_approval": "这张单还在等审批，没有入库单。",
                "cancelled": "这张单已取消，没有入库单。",
                "returned": "这张单已退货。",
            }.get(status, "这张单还没有入库记录。")
            return {"empty": True, "reason": reason, "status": status, "order_no": src_no}
        rows = db.execute(
            "SELECT poi.id, poi.product_id, poi.quantity, poi.unit, poi.unit_price, poi.amount, "
            "       poi.batch_no, poi.expiry_date, poi.production_date, "
            "       COALESCE(poi.received_qty,0) AS received_qty, "
            "       COALESCE(p.name,'') AS product_name, COALESCE(p.spec,'') AS spec, "
            "       COALESCE(p.barcode,'') AS barcode, COALESCE(p.large_barcode,'') AS large_barcode, "
            "       COALESCE(p.large_ratio,0) AS large_ratio, "
            # v404：与 `purchase_order_get` 同一条回退链（订单行单位优先，空则用档案单位）——
            # 生产实测 `poi.unit` 大量为空串 ⇒ 不回退则「单位」整列空白。
            "       COALESCE(NULLIF(poi.unit,''), p.unit, '') AS unit_label "
            "  FROM purchase_order_items poi LEFT JOIN products p ON poi.product_id=p.id "
            " WHERE poi.order_id=? ORDER BY poi.id", (oid,)).fetchall()
        items = []
        sum_qty = sum_amt = 0.0
        for r in rows:
            d = dict(r)
            qty = _po_money(d.get("quantity"))
            recv = _po_money(d.get("received_qty"))
            price = _po_money(d.get("unit_price"))
            # 「入库金额」按**已入库数量 × 采购价**算，与 partial_receive 的
            # `received_amount` 重算口径同源；整单全收时它 == 订单金额。
            recv_amt = round(recv * price, 2)
            d["order_qty"] = qty
            d["order_amount"] = _po_money(d.get("amount")) or round(qty * price, 2)
            d["recv_amount"] = recv_amt
            d["diff_qty"] = round(qty - recv, 2)
            d["has_batch"] = bool(str(d.get("batch_no") or "").strip())
            items.append(d)
            sum_qty += recv
            sum_amt += recv_amt
        return {
            "empty": False,
            "derived": True,
            "head": {
                "inbound_no": rk_no,
                "src_order_no": src_no,
                "order_type": "采购订单",
                "supplier_name": od.get("supplier_name") or "",
                "warehouse_name": od.get("warehouse_name") or "",
                "operator_id": od.get("operator_id") or "",
                # v408（P0-6）：入库时间**独立列**。空则如实返回空串（界面 `—`）。
                "received_at": od.get("received_at") or "",
                # ⚠️ 保留：这是**审核时间**，与上面不是同一个事实。界面「入库时间」读 `received_at`，
                #    不得回退读本字段（见本函数 docstring 的 v408 说明）。
                "audit_time": od.get("audit_time") or "",
                "order_date": od.get("order_date") or "",
                "status": status,
            },
            "items": items,
            "summary": {"recv_qty": round(sum_qty, 2), "recv_amount": round(sum_amt, 2),
                        "line_count": len(items)},
        }


# ============================================================
# v408（P0-4）采购单详情页「查看日志」—— **只读派生视图，不建表**
# v408（P1-6）同一函数加**行级过滤**（`product_id`），不另起一份实现
# ============================================================
def purchase_order_logs(oid, product_id=0):
    """「查看日志」的数据：由**已有痕迹**合成的操作日志。只读、不建表。

    ────────────────────────────────────────────────────────────────
    🔴 先讲清「哪些事件有痕迹、哪些没有」—— 这决定本视图能不能信
    ────────────────────────────────────────────────────────────────
    舟谱那张弹窗是 4 列：操作人 / 时间 / 事件 / 详细信息。逐事件核对「到底有没有落过库」
    （2026-10-08 实测）：

    | 事件 | 痕迹来源 | 操作人 |
    |---|---|---|
    | 订单创建 | `purchase_orders.created_at` | `operator_id` ✓ |
    | 审核 | `purchase_orders.audit_time`（v403 新增列） | v408 起 `auditor_id` ✓（见下） |
    | 已入库 | `batch_trace(ref_type='purchase_order', ref_id=oid)` | ✗ 无 |
    | 登记付款 | `cash_flow(ref_type='purchase', ref_id=oid, type='expense')` | `operator_id` ✓ |
    | 采购退货 | `purchase_returns(purchase_order_id=oid)` | `operator_id` ✓ |
    | 订单修改 | **没有任何痕迹** ⇒ 本视图不产出该事件 | — |

    🔴 **「操作人」在「已入库」上取不到 —— 不是漏查，是源头没记**：
       · `batch_trace` 的列里根本没有 operator（只有 `contact_name`＝供应商名）。
       ⇒ 界面必须如实显示 `—`。**不许**拿「创建人」顶替 —— 那是另一个事实。

    ✅ **「审核」的例外（v408 P1-7 起）**：`purchase_order_approve` 多写了 `auditor_id`，
       所以**审核事件有操作人**了，本视图直接读它。⚠️ 只限**从这次起新审的单** ——
       历史单的 `auditor_id` 是空（没记过就是没记过），界面照样显示 `—`，不回填、不猜。

    🔴 **为什么不从 `audit_logs` 取**（它名字最像"操作日志"）：
       全库 `audit_logs` 的 `module` 只有 `'auth'`（登录日志），采购单 **0 行**。
       而且它带一个**假命中陷阱**：`auth` 日志的 `ref_id` 是 user id，user id 1~4 恰好
       等于本地那几张采购单的 id ⇒ 若按 `ref_id` join，会印出一串**别人的登录记录**
       冒充采购单日志（看着有数据、其实全是噪音）。故本函数**不碰** `audit_logs`。

    🔴 **为什么不从 `inventory_logs` 取入库痕迹**：
       `batch_in` 写流水时 `ref_type='batch_in'`、`ref_id` **硬编码 0**
       （见 `db/queries/inventory.py::batch_in`）⇒ 按采购单**定位不到**。
       能按单定位的是 `batch_trace`（`record_batch_trace(..., 'purchase_order', oid, ...)`）。

    ⚠️ **`audit_time` 列可能不存在**：v403 才加（主库迁移 + 租户同步两处成对）。
       为让本视图在**旧库快照**上也能跑（而不是 500），一律用 `_po_get`/`dict.get` 取列：
       缺列时该事件**不出现**（既不崩，也不编一个时间出来）。

    ── v408（P1-6）行级过滤 ──────────────────────────────────────────
    每个 entry 多带一个 `product_ids`（**列表**，`[]` = 整单事件 / 无法归属到某一行）。
    传 `product_id=N` ⇒ 只返回 `N in product_ids` 的 entry。

    🔴 **哪些事件能挂到行上、哪些不能（这是事实，不是取舍）**：
       · 已入库 —— `batch_trace.product_id` **有这一列** ⇒ 能精确归属；
       · 采购退货 —— `purchase_return_items` **没有 `product_id` 列**（只有 `product_name`）
         ⇒ 只能拿名字对回本单的 `product_id`。**对不上就不归属**（`[]`），
         绝不"猜一个最像的" —— 把历史挂错行比没有历史更坏（用户会据此判断货是谁退的）。
       · 订单创建 / 审核 / 登记付款 —— **本身就没有"哪一行"这个维度**（付款更是整单金额），
         ⇒ 恒为 `[]`，**行级视图里不出现**。
    🔴 因此行级视图**可能为空**，而那是**正确结果**（不是"没有历史=没人动过"）。
       所以 `hint` 在行级模式下换了文案：必须把"哪些事件天生不属于某一行"说出来，
       否则用户会把空列表读成"这一行从来没动过"（同 `hint` 在整单模式下的纪律）。

    返回 `{order_no, status, entries[], count, hint}`；`entries` 按时间**倒序**（最新在上，
    对齐舟谱 —— 那张截图里最上面是「已入库 08:58:03」、最下面是「订单创建 08:53:48」）。
    单据不存在 ⇒ `None`（调用方转 404）。
    """
    with get_db() as db:
        o = db.execute("SELECT po.* FROM purchase_orders po WHERE po.id=?", (oid,)).fetchone()
        if not o:
            return None
        od = dict(o)
        entries = []

        def add(at, event, detail, operator, source, pids=None):
            """`pids` = 这条事件能归属到的**行**（`product_id` 列表）。
            缺省 `None`/`[]` = **整单事件**（创建 / 审核 / 付款），行级视图里不出现。"""
            at = str(at or "").strip()
            if not at:
                return          # 没时间 = 这件事没发生过，不产出一行
            entries.append({
                "at": at,
                "event": event,
                "detail": str(detail or ""),
                "operator": str(operator or ""),
                "source": source,
                # v408（P1-6）行级归属。**空列表 ≠ 未知**：空列表的含义是
                # "这件事本来就不挂某一行"，是**确定的事实**（见 docstring 那张表）。
                "product_ids": [int(x) for x in (pids or [])],
            })

        # 🔴 行级归属要用到的「本单商品名 → product_id」映射。
        #    `purchase_return_items` 只有名字，只能这样对（对不上就不归属）。
        _name2pid = {}
        try:
            for r in db.execute(
                    "SELECT poi.product_id AS pid, COALESCE(p.name,'') AS nm"
                    "  FROM purchase_order_items poi LEFT JOIN products p ON p.id=poi.product_id"
                    " WHERE poi.order_id=?", (oid,)).fetchall():
                _d = dict(r)
                _nm = str(_d.get("nm") or "").strip()
                if _nm and _d.get("pid"):
                    _name2pid.setdefault(_nm, int(_d["pid"]))
        except Exception as e:
            _logger.warning("purchase_order_logs: 商品名映射读取失败 oid=%s: %s", oid, e)

        # ① 订单创建
        add(od.get("created_at"), "订单创建", "", od.get("operator_id"), "order")

        # ② 审核（`audit_time` 缺列 ⇒ None ⇒ 不产出；不编时间）
        #    v408（P1-7）操作人从空串改为 `auditor_id` —— 源头现在记人了（见 docstring）。
        #    ⚠️ 仍然走 `_po_get`（该列 v408 才加）：老库快照上缺列 ⇒ 空串 ⇒ 界面 `—`，不崩。
        add(_po_get(od, "audit_time", ""), "审核", "", _po_get(od, "auditor_id", ""), "order")

        # ③ 已入库 —— 只认 `batch_trace`（`inventory_logs` 定位不到，见 docstring）
        try:
            for r in db.execute(
                    "SELECT batch_no, product_id, product_name, quantity, ref_no, created_at FROM batch_trace"
                    " WHERE ref_type='purchase_order' AND ref_id=? AND direction='in'"
                    " ORDER BY id", (oid,)).fetchall():
                d = dict(r)
                qty = _po_money(d.get("quantity"))
                parts = []
                if str(d.get("product_name") or "").strip():
                    parts.append(str(d["product_name"]).strip())
                if qty:
                    parts.append("数量 %g" % qty)      # 不带单位：batch_trace 没有单位列，别猜
                if str(d.get("batch_no") or "").strip():
                    parts.append("批次 " + str(d["batch_no"]).strip())
                # v408（P1-6）`batch_trace.product_id` 是**有这一列**的 ⇒ 精确归属到行。
                # ⚠️ 旧数据可能是 NULL（那一列可空）⇒ 退化成"不归属"，与"归属不到"同义，
                #    不编 id、也不去按名字反推（名字反推只给退货用，那里是没别的办法）。
                _pid = int(d.get("product_id") or 0)
                add(d.get("created_at"), "已入库", "，".join(parts), "", "batch",
                    [_pid] if _pid else [])
        except Exception as e:
            _logger.warning("purchase_order_logs: batch_trace 读取失败 oid=%s: %s", oid, e)

        # ④ 登记付款
        try:
            for r in db.execute(
                    "SELECT account, amount, note, operator_id, created_at FROM cash_flow"
                    " WHERE ref_type='purchase' AND ref_id=? AND type='expense'"
                    " ORDER BY id", (oid,)).fetchall():
                d = dict(r)
                detail = "¥%.2f" % _po_money(d.get("amount"))
                if str(d.get("account") or "").strip():
                    detail += "，" + str(d["account"]).strip()
                if str(d.get("note") or "").strip():
                    detail += "，" + str(d["note"]).strip()
                add(d.get("created_at"), "登记付款", detail, d.get("operator_id"), "payment")
        except Exception as e:
            _logger.warning("purchase_order_logs: cash_flow 读取失败 oid=%s: %s", oid, e)

        # ⑤ 采购退货
        try:
            for r in db.execute(
                    "SELECT id, total_amount, reason, operator_id, created_at FROM purchase_returns"
                    " WHERE purchase_order_id=? ORDER BY id", (oid,)).fetchall():
                d = dict(r)
                detail = "退货单 #%s，¥%.2f" % (d.get("id"), _po_money(d.get("total_amount")))
                if str(d.get("reason") or "").strip():
                    detail += "，" + str(d["reason"]).strip()
                # v408（P1-6）行级归属：退货明细**只有商品名**（无 product_id）⇒ 按名字对回。
                # 对不上就 `[]`（不归属），**不猜** —— 把退货挂错行会让人误判"是谁退的货"。
                _pids = []
                try:
                    for it in db.execute(
                            "SELECT product_name FROM purchase_return_items WHERE return_id=?",
                            (d.get("id"),)).fetchall():
                        _k = str(dict(it).get("product_name") or "").strip()
                        _p = _name2pid.get(_k)
                        if _p and _p not in _pids:
                            _pids.append(_p)
                except Exception as e2:
                    _logger.warning("purchase_order_logs: 退货明细读取失败 ret=%s: %s",
                                    d.get("id"), e2)
                add(d.get("created_at"), "采购退货", detail, d.get("operator_id"), "return", _pids)
        except Exception as e:
            _logger.warning("purchase_order_logs: purchase_returns 读取失败 oid=%s: %s", oid, e)

        # ── v408（P1-6）行级过滤 ────────────────────────────────────────
        # 传了 `product_id` ⇒ 只留「这件事确实挂在这一行上」的 entry。
        # 🔴 整单事件（product_ids 为空）在这里**被排除**，且下面 hint 会说明为什么 ——
        #    否则空列表会被读成"这一行从来没动过"。
        _row_mode = bool(int(product_id or 0))
        if _row_mode:
            _pid = int(product_id)
            entries = [e for e in entries if _pid in (e.get("product_ids") or [])]

        entries.sort(key=lambda x: x["at"], reverse=True)
        return {
            "order_no": od.get("order_no") or "",
            "status": od.get("status") or "",
            "entries": entries,
            "count": len(entries),
            "product_id": int(product_id or 0),
            # 界面上要显式说明"这里不是全部动作" —— 否则用户会把"没有订单修改"读成"没人改过"
            "hint": (
                ("这里是**这一行商品**的痕迹，只包含能定位到本行的事件（入库 / 退货）。"
                 "建单、审核、登记付款是**整单**事件，本来就不属于某一行，所以不会出现在这里；"
                 "为空只代表「这一行没有入库或退货痕迹」，不代表没人动过这张单。")
                if _row_mode else
                ("这里只显示系统真的记下来的动作：建单、审核、入库、付款、退货。"
                 "「订单修改」等动作目前没有留痕，不会出现在这里。"
                 "「已入库」没有操作人，是因为源头没记录谁做的（v408 起「审核」已补上审核人）。")),
        }


# ============================================================================
# v408（2026-10-09）P1-9 采购结算单
# ----------------------------------------------------------------------------
# 舟谱「采购结算单」（单号前缀 CJSJ）—— **与既有三个东西都不是一回事**，别混：
#
#   · `receivables(type='ap', ref_type='purchase', ref_id=<采购单id>)`
#       = **每张采购单一行应付**（`purchase_order_confirm` 入库时写）。这是**应付台账**，
#         颗粒度是「一张采购单」，不是「一次结算」。
#   · `ap_invoices`
#       = 供应商**发票**（票面金额 / 税额 / 三单匹配）。是**票**，不是**账**。
#         生产与本地均 **0 行**、只被 `routers/rfq.py` 调用，从未接进采购流程。
#   · `payment_batches` / `payment_batch_items`
#       = **付款批次**（付款申请）。走的是「付钱」，不是「对账」。
#   · `purchase_settlements`（本文件新增）
#       = **结算单**：一个供应商 + 一段时间，把若干张已入库采购单（应付）
#         ＋ 退货单（冲减）汇总成一张**对账单**，双方确认金额。
#
# 🔴 边界（刻意不做的，写下来免得后面被当成漏）：
#     本实体**只到「已确认」，不碰钱**。付款仍走既有 `purchase_payment_create`
#     （它按 `ref_type/ref_id` 定位应付行累加 `paid_amount`，见该函数 docstring）。
#     理由：结算是「对账」，付款是「出纳」；让结算单去改 `paid_amount` 会让
#     同一笔钱有两条写入路径 ⇒ 迟早对不上。
#
# 🔴 金额一律**快照**：明细行存 `doc_no` / `doc_date` / `amount` 三份拷贝。
#     源单后来被改了，结算单**不跟着变** —— 对账单一旦发出去就是历史事实，
#     回查源单会让「上个月对过的账」这个月自己变了。
#
# 🔴 占用：**一张单据只能进一张未作废的结算单**（`add_items` 硬拦并回具体单号）。
#     「已确认」的单不可再加删明细；作废后占用**自动释放**（查询按 `status!='void'` 排）。
# ============================================================================

def _init_settlement_tables():
    """惰性建表。

    🔴 为什么用「惰性建表」而不是加进启动期迁移清单：本仓主库 (`erp.db`) 与
       每个租户库 (`tenant_<id>.db`) 都要有这两张表，而启动期建表清单是「一处写、
       一处漏」的高发区（见 `erp_db.py` 的 `_safe_migrate` / `_ensure_tenant_module_tables`
       两处同改纪律）。照抄 `ap_invoices` 的既有做法（`_init_ap_invoice_tables`）：
       在每个入口函数里调一次，跑在哪个库的连接上就建在哪个库，天然两库同覆盖。
    """
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS purchase_settlements (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                settle_no     TEXT DEFAULT '',
                supplier_id   INTEGER DEFAULT 0,
                period_from   TEXT DEFAULT '',
                period_to     TEXT DEFAULT '',
                amount_purchase REAL DEFAULT 0,
                amount_return   REAL DEFAULT 0,
                amount_adjust   REAL DEFAULT 0,
                amount_total    REAL DEFAULT 0,
                status        TEXT DEFAULT 'draft',
                note          TEXT DEFAULT '',
                operator_id   TEXT DEFAULT '',
                confirmed_at  TEXT DEFAULT '',
                confirm_by    TEXT DEFAULT '',
                created_at    TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE TABLE IF NOT EXISTS purchase_settlement_items (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                settlement_id INTEGER DEFAULT 0,
                ref_type      TEXT DEFAULT '',
                ref_id        INTEGER DEFAULT 0,
                doc_no        TEXT DEFAULT '',
                doc_date      TEXT DEFAULT '',
                amount        REAL DEFAULT 0,
                note          TEXT DEFAULT ''
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_psi_uniq
                ON purchase_settlement_items(settlement_id, ref_type, ref_id);
        """)
        db.commit()


# 结算单状态取值域（界面与后端同一份口径，别在前端再抄一遍）
SETTLEMENT_STATUS = ('draft', 'confirmed', 'void')


def _settlement_recalc(db, sid):
    """🔴 结算金额**唯一实现** —— 任何改动明细的地方都必须调它，不许各算一遍。

    口径：`应付合计 = Σ入库 − Σ退货 + 调整`（`amount_return` 存**正数**，这里减）。
    """
    p = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM purchase_settlement_items "
        "WHERE settlement_id=? AND ref_type='purchase'", (sid,)).fetchone()[0] or 0
    r = db.execute(
        "SELECT COALESCE(SUM(amount),0) FROM purchase_settlement_items "
        "WHERE settlement_id=? AND ref_type='purchase_return'", (sid,)).fetchone()[0] or 0
    adj = db.execute(
        "SELECT COALESCE(amount_adjust,0) FROM purchase_settlements WHERE id=?", (sid,)
    ).fetchone()[0] or 0
    total = round(float(p) - float(r) + float(adj), 2)
    db.execute(
        "UPDATE purchase_settlements SET amount_purchase=?, amount_return=?, amount_total=? "
        "WHERE id=?", (round(float(p), 2), round(float(r), 2), total, sid))
    return {'amount_purchase': round(float(p), 2), 'amount_return': round(float(r), 2),
            'amount_total': total}


def purchase_settlement_create(supplier_id, period_from='', period_to='', note='', operator_id=''):
    """建一张结算单（草稿）。返回 `{'settlement_id','settle_no'}`。

    单号 `CJSJ-YYYYMMDD-NNN`：**当天第几张**就 NNN，跨天重置。
    ⚠️ 日期用**紧凑** `YYYYMMDD`（不带横杠）：单号要能被口头念、被复制进搜索框，
       中间的横杠只会让「日期」和「序号」两段的边界变模糊。
    先 INSERT 拿 id、再回填单号（单号需要 id 参与计数），同一事务内完成。
    """
    _init_settlement_tables()
    with get_db() as db:
        sid = db.execute(
            "INSERT INTO purchase_settlements (supplier_id,period_from,period_to,note,operator_id) "
            "VALUES (?,?,?,?,?)", (supplier_id, period_from, period_to, note, operator_id)
        ).lastrowid
        # ⚠️ 计数比较也用**同一个紧凑格式**：`date(created_at)` 出来是 `YYYY-MM-DD`，
        #    拿它和 `YYYYMMDD` 比 ⇒ 恒不相等 ⇒ 序号永远停在 001（零报错的错号）。
        today = db.execute("SELECT strftime('%Y%m%d','now','localtime')").fetchone()[0]
        db.execute(
            "UPDATE purchase_settlements SET settle_no="
            " 'CJSJ-'||?||'-'||printf('%03d', (SELECT COUNT(*) FROM purchase_settlements "
            "  WHERE strftime('%Y%m%d',created_at)=? AND id<=?)) WHERE id=?", (today, today, sid, sid))
        db.commit()
        no = db.execute("SELECT settle_no FROM purchase_settlements WHERE id=?", (sid,)).fetchone()[0]
        return {'settlement_id': sid, 'settle_no': no}


def purchase_settlement_add_items(sid, refs):
    """往结算单里加明细。`refs = [{'ref_type':'purchase'|'purchase_return','ref_id':n}]`。

    返回 `{'added':n, 'skipped':[{ref_type,ref_id,reason}]}` —— 🔴 **部分成功要如实回**，
    批量操作里用户必须看到「哪几张没进去、为什么」，不许整批静默丢弃。

    四道硬拦（缺一道都会造出错的账）：
      ① 结算单必须存在且是 `draft`（已确认/已作废不可改）；
      ② 源单必须存在，且**供应商与结算单一致**（把别人的单结算给我方另一个供应商 = 错账）；
      ③ 该源单**已被别的未作废结算单引用** ⇒ 拒，并回**那张结算单的单号**（可查可追）；
      ④ 本单内重复 ⇒ 拒（UNIQUE 索引是最后一道兜底，但要先给出人话）。
    """
    _init_settlement_tables()
    added, skipped = 0, []
    with get_db() as db:
        s = db.execute("SELECT * FROM purchase_settlements WHERE id=?", (sid,)).fetchone()
        if not s:
            return {'error': '结算单不存在'}
        s = dict(s)
        if s['status'] != 'draft':
            return {'error': '只有草稿状态的结算单可以添加单据（当前：%s）' % s['status']}
        for rf in (refs or []):
            rt, rid = rf.get('ref_type', ''), int(rf.get('ref_id') or 0)
            if rt not in ('purchase', 'purchase_return') or rid <= 0:
                skipped.append({'ref_type': rt, 'ref_id': rid, 'reason': '单据类型或编号不对'})
                continue
            # ② 源单存在 + 供应商一致
            if rt == 'purchase':
                src = db.execute("SELECT id,order_no,order_date,supplier_id,total_amount "
                                 "FROM purchase_orders WHERE id=?", (rid,)).fetchone()
                doc_no = (src['order_no'] if src else '')
                doc_dt = ((src['order_date'] or '')[:10] if src else '')
            else:
                src = db.execute("SELECT id,supplier_id,total_amount,created_at "
                                 "FROM purchase_returns WHERE id=?", (rid,)).fetchone()
                doc_no = ('TH' + str(rid)) if src else ''
                doc_dt = ((src['created_at'] or '')[:10] if src else '')
            if not src:
                skipped.append({'ref_type': rt, 'ref_id': rid, 'reason': '这张单据不存在'})
                continue
            src = dict(src)
            if int(src.get('supplier_id') or 0) != int(s['supplier_id'] or 0):
                skipped.append({'ref_type': rt, 'ref_id': rid,
                                'reason': '这张单的供应商不是本结算单的供应商'})
                continue
            # ③ 跨单占用（只算未作废的）
            occ = db.execute(
                "SELECT st.settle_no FROM purchase_settlement_items si "
                "JOIN purchase_settlements st ON st.id=si.settlement_id "
                "WHERE si.ref_type=? AND si.ref_id=? AND st.status!='void' AND st.id!=? LIMIT 1",
                (rt, rid, sid)).fetchone()
            if occ:
                skipped.append({'ref_type': rt, 'ref_id': rid,
                                'reason': '已经结算过了（结算单 %s）' % occ[0]})
                continue
            # ④ 本单内重复
            dup = db.execute(
                "SELECT id FROM purchase_settlement_items "
                "WHERE settlement_id=? AND ref_type=? AND ref_id=?", (sid, rt, rid)).fetchone()
            if dup:
                skipped.append({'ref_type': rt, 'ref_id': rid, 'reason': '本结算单里已经有了'})
                continue
            db.execute(
                "INSERT INTO purchase_settlement_items "
                "(settlement_id,ref_type,ref_id,doc_no,doc_date,amount) VALUES (?,?,?,?,?,?)",
                (sid, rt, rid, doc_no, doc_dt, float(src.get('total_amount') or 0)))
            added += 1
        db.commit()
        if added:
            _settlement_recalc(db, sid)
            db.commit()
    return {'added': added, 'skipped': skipped,
            **_settlement_amounts(sid)}


def _settlement_amounts(sid):
    with get_db() as db:
        r = db.execute("SELECT amount_purchase,amount_return,amount_adjust,amount_total "
                       "FROM purchase_settlements WHERE id=?", (sid,)).fetchone()
        return dict(r) if r else {}


def purchase_settlement_remove_item(sid, item_id):
    """从草稿结算单里删一条明细。删完自动重算金额。"""
    _init_settlement_tables()
    with get_db() as db:
        s = db.execute("SELECT status FROM purchase_settlements WHERE id=?", (sid,)).fetchone()
        if not s:
            return {'error': '结算单不存在'}
        if s[0] != 'draft':
            return {'error': '只有草稿状态的结算单可以删单据'}
        cur = db.execute("DELETE FROM purchase_settlement_items WHERE id=? AND settlement_id=?",
                         (item_id, sid))
        db.commit()
        if cur.rowcount == 0:
            return {'error': '这条明细不存在'}
        _settlement_recalc(db, sid)
        db.commit()
    return {'ok': True, **_settlement_amounts(sid)}


def purchase_settlement_set_adjust(sid, amount, note=''):
    """写「其它调整」（可正可负：运费补差 / 返利抵扣 / 抹零）。只有草稿可改。

    🔴 为什么单独一个函数而不是塞进 `add_items`：调整**没有源单**，它是「账面上的
       差额说明」；跟货物明细混在一个入参里会让「哪些是有单可查的、哪些是手填的」分不清。
    """
    _init_settlement_tables()
    with get_db() as db:
        s = db.execute("SELECT status FROM purchase_settlements WHERE id=?", (sid,)).fetchone()
        if not s:
            return {'error': '结算单不存在'}
        if s[0] != 'draft':
            return {'error': '只有草稿状态的结算单可以改调整金额'}
        db.execute("UPDATE purchase_settlements SET amount_adjust=?, note=? WHERE id=?",
                   (round(float(amount or 0), 2), note, sid))
        _settlement_recalc(db, sid)
        db.commit()
    return {'ok': True, **_settlement_amounts(sid)}


def purchase_settlement_list(supplier_id=0, status='', limit=50, offset=0):
    """结算单列表。带 `supplier_name` 与 `item_count`（列表页要显示「几张单」）。"""
    _init_settlement_tables()
    w, params = [], []
    if supplier_id:
        w.append("s.supplier_id=?"); params.append(supplier_id)
    if status:
        w.append("s.status=?"); params.append(status)
    where = ("WHERE " + " AND ".join(w)) if w else ""
    with get_db() as db:
        rows = [dict(r) for r in db.execute(
            "SELECT s.*, c.name AS supplier_name, "
            "  (SELECT COUNT(*) FROM purchase_settlement_items i WHERE i.settlement_id=s.id) "
            "    AS item_count "
            "FROM purchase_settlements s LEFT JOIN contacts c ON c.id=s.supplier_id "
            f"{where} ORDER BY s.id DESC LIMIT ? OFFSET ?", params + [limit, offset]).fetchall()]
        total = db.execute(f"SELECT COUNT(*) FROM purchase_settlements s {where}", params).fetchone()[0]
    return {'rows': rows, 'total': total}


def purchase_settlement_get(sid):
    """结算单详情（主行 + 明细）。不存在返回 `None`。"""
    _init_settlement_tables()
    with get_db() as db:
        s = db.execute(
            "SELECT s.*, c.name AS supplier_name FROM purchase_settlements s "
            "LEFT JOIN contacts c ON c.id=s.supplier_id WHERE s.id=?", (sid,)).fetchone()
        if not s:
            return None
        items = [dict(r) for r in db.execute(
            "SELECT * FROM purchase_settlement_items WHERE settlement_id=? ORDER BY id",
            (sid,)).fetchall()]
    return {'settlement': dict(s), 'items': items}


def purchase_settlement_confirm(sid, operator_id=''):
    """确认结算单。🔴 空单不许确认（一张没有明细的对账单没有意义，确认了就是假账）。

    确认时写 `confirmed_at` + `confirm_by` —— 与 P1-7 的 `auditor_id` 同一个道理：
    **谁确认的对账单**必须是事实，不能事后靠猜。
    """
    _init_settlement_tables()
    with get_db() as db:
        s = db.execute("SELECT * FROM purchase_settlements WHERE id=?", (sid,)).fetchone()
        if not s:
            return {'error': '结算单不存在'}
        s = dict(s)
        if s['status'] != 'draft':
            return {'error': '只有草稿可以确认（当前：%s）' % s['status']}
        n = db.execute("SELECT COUNT(*) FROM purchase_settlement_items WHERE settlement_id=?",
                       (sid,)).fetchone()[0]
        if n == 0:
            return {'error': '这张结算单还没有任何单据，请先添加'}
        db.execute(
            "UPDATE purchase_settlements SET status='confirmed', "
            "  confirmed_at=datetime('now','localtime'), confirm_by=? WHERE id=?",
            (str(operator_id or ''), sid))
        db.commit()
    return {'ok': True, 'status': 'confirmed'}


def purchase_settlement_void(sid, note=''):
    """作废结算单。**占用随之释放**（候选查询与占用检查都按 `status!='void'` 排）。

    🔴 不作废会怎样：一张单据被错加进草稿单后，**永远**加不进正确的结算单，
    而界面只会说「已经结算过了」—— 用户没有出路。作废是唯一的解。
    """
    _init_settlement_tables()
    with get_db() as db:
        s = db.execute("SELECT status FROM purchase_settlements WHERE id=?", (sid,)).fetchone()
        if not s:
            return {'error': '结算单不存在'}
        if s[0] == 'void':
            return {'error': '这张结算单已经作废了'}
        db.execute("UPDATE purchase_settlements SET status='void', note=CASE WHEN ?!='' "
                   "THEN ? ELSE note END WHERE id=?", (note, note, sid))
        db.commit()
    return {'ok': True, 'status': 'void'}


def purchase_settlement_candidates(supplier_id, date_from='', date_to=''):
    """列出**还没被任何未作废结算单引用**的单据，供新建结算单时勾选。

    口径：
      · 采购单 `purchase_orders`：`status='received'`（已入库才有结算的基础 ——
        没入库就结算 = 为没收到的货付钱）+ 供应商匹配；
      · 退货单 `purchase_returns`：供应商匹配。
        🔴 v451 更新（原说明已过时，勿再照抄）：`status` 列**从 v92 起就存在**，
        且 `purchase_return_create` 会写 `'confirmed'`；v451 起又多了 `'draft'`（草稿态）。
        ⇒ 现在**必须**排除草稿（见下 `status=='draft' → continue`），否则一张还没过账的
        草稿退货会被当成结算候选 = **为一笔没发生的退货付钱**。
        ⚠️ 但**不能**用"只收 `status='confirmed'`"的白名单写法：存量行（舟谱导入那条路）
        的 `status` 可能是空串/NULL ⇒ 白名单会让**历史退货全部消失**，零报错（旧「静默洞」）。
        故用**黑名单**排除 draft、其余一律放行。

    `date_from/date_to` 按单据日期过滤（采购单 `order_date`、退货单 `created_at`）。
    """
    _init_settlement_tables()
    with get_db() as db:
        taken_p = {r[0] for r in db.execute(
            "SELECT si.ref_id FROM purchase_settlement_items si "
            "JOIN purchase_settlements st ON st.id=si.settlement_id "
            "WHERE si.ref_type='purchase' AND st.status!='void'")}
        taken_r = {r[0] for r in db.execute(
            "SELECT si.ref_id FROM purchase_settlement_items si "
            "JOIN purchase_settlements st ON st.id=si.settlement_id "
            "WHERE si.ref_type='purchase_return' AND st.status!='void'")}
        rows = []
        for r in db.execute(
                "SELECT id,order_no,order_date,total_amount FROM purchase_orders "
                "WHERE supplier_id=? AND status='received' ORDER BY id DESC", (supplier_id,)).fetchall():
            d = dict(r)
            if date_from and (d['order_date'] or '')[:10] < date_from: continue
            if date_to and (d['order_date'] or '')[:10] > date_to: continue
            rows.append({'ref_type': 'purchase', 'ref_id': d['id'],
                         'doc_no': d['order_no'] or '', 'doc_date': (d['order_date'] or '')[:10],
                         'amount': float(d['total_amount'] or 0),
                         'taken': d['id'] in taken_p})
        for r in db.execute(
                "SELECT id,total_amount,created_at,COALESCE(status,'confirmed') AS status "
                "  FROM purchase_returns "
                "WHERE supplier_id=? ORDER BY id DESC", (supplier_id,)).fetchall():
            d = dict(r)
            # v451：草稿（未过账）**不是**结算候选 —— 它没进 AP，拿来结算 = 为
            #   一笔没发生的退货付钱。过滤写在 Python 侧是为了复用上面同一条 SQL 的
            #   列投影（下面函数头对"刻意不过滤 status"的说明已随 v451 更新）。
            if str(d.get("status") or "confirmed") == "draft":
                continue
            if date_from and (d['created_at'] or '')[:10] < date_from: continue
            if date_to and (d['created_at'] or '')[:10] > date_to: continue
            rows.append({'ref_type': 'purchase_return', 'ref_id': d['id'],
                         'doc_no': 'TH' + str(d['id']), 'doc_date': (d['created_at'] or '')[:10],
                         'amount': float(d['total_amount'] or 0),
                         'taken': d['id'] in taken_r})
    rows.sort(key=lambda x: (x['doc_date'], x['ref_type']), reverse=True)
    return rows

def purchase_order_approve(oid, auditor_id='', operator_id=''):
    """审核一张采购单（`pending_approval` → `draft`），并落审核时间 + **审核人**。

    v403 之前这里只 `SET status='draft'`，**不记时间** ⇒ 舟谱列表的「审核时间」列永远空。
    v403 起一并写 `audit_time`，v408（P1-7）起再一并写 `auditor_id`（审核人），
    但有几个必须说清的语义：

    · **幂等保留首次**：`audit_time` 只在为空时才写（`CASE WHEN COALESCE(audit_time,'')=''`）。
      重复点「审核」不会把时间刷新成「刚才」—— 审核时间一旦落定就是历史事实。
    · **免审批单也要可审**：金额低于阈值的单直接落 `draft`，从来没进过 `pending_approval`。
      若这里只认 `pending_approval`，用户对这批单点「批量审核」会**看起来像没点**
      （状态不变、时间仍空、也查不出问题）—— 正是「恒空恒 0 且零报错 = 静默失效」。
      所以对 `draft` / `confirmed` 也补审核时间，**但不动状态**。
    · **已入库 / 部分入库 / 已取消 不可审**：这类返回 `ok=False` + 原因，由调用方**如实回报**，
      不假装成功（批量操作里用户必须看到「哪几张没审、为什么」）。
    · 🔴 **审核人 = `auditor_id`（v408 P1-7 新增）**：取值域与 `operator_id` / `handler`
      完全相同（主库 `users.id` 的字符串），但**语义不同**：`operator_id` = 谁建的、
      `handler` = 归谁办、`auditor_id` = **谁审的**。
      ⚠️ 只存 id **不存名字**（名字会改，存了会与主库漂移）；显示名由**端点层**现解析
      （`psi.py` 复用 `_creator_names` → `auditor_name`），与 `operator_id`→`creator_name` 同一套。
      ⚠️ 与 `audit_time` **同一条幂等纪律**：只在为空时才写 ⇒ 重复点「审核」不会把
      **审核人**换成后点的那个人（审核人一旦落定就是历史事实，与审核时间成对）。
      ⚠️ `auditor_id=''`（调用方没传，例如 v408 之前的调用方）时**写空串、不覆盖**已有值 ——
      宁可留空也不要把「谁审的」抹掉（本仓铁律：**「没有」≠「是零」**，缺值不编）。

    v410（P2-3）追加 `operator_id`（**本次点审核的人**），用来盖「最后操作」章。
    🔴 为什么不直接复用 `auditor_id`：两者**语义不同、更新规则也相反** ——
      · `auditor_id` = **首次**审核人，重复点审核**保留**第一个（历史事实，不可改写）；
      · `last_op_by` = **最后一次**操作人，重复点审核必须**刷成本次**这个人。
      若复用 `auditor_id`，第二次点审核的人不会出现在「最后操作人」里 —— 界面上就会是
      「刚才明明是我点的审核，最后操作人却写着张三」，而零报错。
    ⚠️ 排在 `auditor_id` 之后（末尾追加）⇒ 既有调用方的位置参数一个都没挪动。
    """
    # v410（P2-3）：盖章片段。**空则不加**（没人 ⇒ 连时间都不写，见 `_po_stamp`）。
    _st, _sp = _po_stamp(operator_id)
    with get_db() as db:
        cur = db.execute(
            "UPDATE purchase_orders SET "
            "  status=CASE WHEN status='pending_approval' THEN 'draft' ELSE status END, "
            "  audit_time=CASE WHEN COALESCE(audit_time,'')='' "
            "                 THEN datetime('now','localtime') ELSE audit_time END, "
            "  auditor_id=CASE WHEN COALESCE(auditor_id,'')='' "
            "                 THEN ? ELSE auditor_id END "
            + (", " + _st if _st else "")
            + " WHERE id=? AND status IN ('pending_approval','draft','confirmed')",
            [str(auditor_id or '')] + _sp + [oid])
        db.commit()
        if not cur.rowcount:
            return {'order_id': oid, 'ok': False,
                    'reason': '该单已入库 / 部分入库 / 已取消，不能再审核'}
        return {'order_id': oid, 'ok': True, 'status': 'draft', 'message': '已审批，可确认入库'}



def purchase_order_issue(oid, operator_id=''):
    """采购单「发单」—— 把已审核通过（`confirmed`）的采购单正式下发给供应商（v481 P2-②）。

    前端「审核并发单」按钮此前只是灰显的「待接口」：点了只把单建为 `confirmed`，却没有任何
    后端发单概念（无列、无函数、无端点）。这里补齐发单动作 + 留痕。

    · **仅 `confirmed` 可发**：草拟 / 待审 / 已入库 / 已取消 / 已退货的单不允许发单
      （语义上发单必须在审核通过之后）；
    · 幂等守卫：已发过（`issued_at` 非空）的单再次点发单，返回 `ok=False` + 原因，
      由调用方如实回报，不假装成功（批量操作里用户必须看到「哪几张没发、为什么」）；
    · 盖「最后操作」章（`last_op_at/by`，`_po_stamp`）—— 发单也是一次操作；
    · `issued_at` 写发单时刻、`issued_by` 存发单人 id（只存 id，显示名端点层现解析，
      与 `auditor_id` / `operator_id` 同一套纪律）。
    """
    _st, _sp = _po_stamp(operator_id)
    with get_db() as db:
        _cur = db.execute(
            "SELECT status, issued_at FROM purchase_orders WHERE id=?", (oid,)).fetchone()
        if not _cur:
            return {'order_id': oid, 'ok': False, 'reason': '采购单不存在'}
        _status = _cur['status']
        if _status != 'confirmed':
            return {'order_id': oid, 'ok': False,
                    'reason': '该单尚未审核通过（状态：%s），不能发单' % _status}
        if str(_cur['issued_at'] or '').strip():
            return {'order_id': oid, 'ok': False, 'reason': '该单已发单，不能重复发单'}
        db.execute(
            "UPDATE purchase_orders SET issued_at=datetime('now','localtime'), issued_by=?"
            + (", " + _st if _st else "")
            + " WHERE id=?",
            [str(operator_id or '')] + _sp + [oid])
        db.commit()
        return {'order_id': oid, 'ok': True, 'status': 'confirmed', 'message': '已发单'}
