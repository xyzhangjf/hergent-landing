# -*- coding: utf-8 -*-
"""单据状态机 —— 状态词表、跃迁白名单、统一写入口（阶段 1 · 第 3 项）

🔴 为什么需要这个模块（现状是「三套状态机 + 谁都能写」）
--------------------------------------------------------
收口前，同一批单据上的状态判断散在三处、互不相认：

  ① **业务表 `status`**：真正被前端读的字段。写入点遍布 `db/queries/*.py` 与
     `erp_db.py`（5 类单据共 30+ 处），其中大部分是 `UPDATE … SET status='x' WHERE id=?`
     —— **没有任何来源状态守卫**，任何状态都能跳到任何状态。
  ② **`db/queries/approvals.py`**：多级审批流，写业务表 `status`
     （`draft → pending_approval → approved`），有自己的 `DOC_TABLES`。
  ③ **`erp_db.doc_state_set()`**：另一套词表（`draft/submitted/in_approval/approved/
     rejected/returned/executed/voided`），写的是 `document_states` **影子表**，
     业务表一行不动，报错还是英文 `Invalid state transition: draft -> approved`。
     实测生产 `document_states` **0 行** —— 这套从未真正接线。

后果不是「会报错」，而是**静默脏状态**：已签收的销售单能被 AI 改成 `confirmed`、
已入库的采购单能被回滚成 `cancelled`、`picking` 这种中间态能被任意端点覆盖，
全程零报错、零留痕。生产 `sale_orders` 22,505 条 `signed` 就是在这种「无守卫」
前提下由脚本一路写过来的。

本模块把**词表**与**跃迁规则**收成唯一一份，别处只许引用，不许再写字面量。

🔴 两条必须同时成立的设计约束
------------------------------
1. **白名单必须装得下现有全部真实业务**。白名单的 `from` 集合是从生产代码里
   逐处抽取的（`WHERE … status IN (…)` + Python 层守卫），不是从 ERPNext 抄的
   理想状态图。少一条 = 上线当天拦死正常业务。
2. **非法跃迁必须给出中文原因**，而且要能回答「这张单现在是什么、能变成什么」。
   只说「状态错误」等于把排查成本转给用户。

🔴 `status` 与 `delivery_status` / `invoice_status` 是**不同字段**
-----------------------------------------------------------------
盘点时踩过：全仓按 `status=` 扫，会把 `delivery_status='assigned'`、
`invoice_status='invoiced'` 一起抓进来，凭空给销售单造出 `assigned`/`invoiced`
两个根本不存在的 `status` 值。正则必须写成 `(?<![_A-Za-z])status`。

🔴 本轮**不新增 `docstatus` 物理列**
------------------------------------
计划里的目标是「统一 docstatus（0 草稿／1 已提交／2 已取消）+ 业务状态独立字段」。
本轮只做 `docstatus_of()` **派生**，原因是：加列要让 30+ 个写入点同时写两列、
回填 22,505 条历史行、还要改前端全部读取处；而它带来的拦截能力，用派生 + 白名单
已经完全拿到。物理列留给阶段 2 与「提交后字段锁定 / 乐观锁 / doc_versions」一起做
—— 那时本来就要改保存钩子，改一次比改两次安全。
"""
from __future__ import annotations

from datetime import datetime

__all__ = [
    'IllegalTransition', 'DOC_SPECS', 'STATUS_LABEL',
    'spec', 'status_label', 'docstatus_of', 'allowed_targets', 'allowed_sources',
    'check_transition', 'explain', 'guard_sql', 'set_doc_status',
    'editable_fields', 'assert_no_locked_fields', 'status_token_clause',
]


class IllegalTransition(Exception):
    """非法状态跃迁。`str(e)` 就是可以直接抛给用户看的中文原因。"""


# ──────────────────────────────────────────────────────────────
# 一、单据规格（唯一词表）
# ──────────────────────────────────────────────────────────────
# statuses 里每个值都要有中文名 —— 报错与时间线都直接用它，
# 不允许出现「用户看到英文状态码」的情况。
DOC_SPECS = {
    'purchase_order': {
        'table': 'purchase_orders',
        'label': '采购单',
        'initial': 'draft',
        'statuses': {
            'draft': '草稿',
            'pending_approval': '待审批',
            'approved': '审批通过',
            'confirmed': '已确认',
            'partial': '部分入库',
            'received': '已入库',
            'returned': '已退货',
            'cancelled': '已作废',
        },
        # from → 允许去的目标集合。空集合 = 终态。
        'transitions': {
            'draft': {'pending_approval', 'approved', 'confirmed',
                      'partial', 'received', 'cancelled'},
            'pending_approval': {'draft', 'approved', 'confirmed',
                                 'partial', 'received', 'cancelled'},
            'approved': {'partial', 'received', 'confirmed', 'returned', 'cancelled'},
            'confirmed': {'pending_approval', 'partial', 'received', 'returned', 'cancelled'},
            # 再次全收是幂等动作（分批到货会反复进 received），必须放行
            'partial': {'partial', 'received', 'returned', 'cancelled'},
            'received': {'received', 'returned', 'cancelled'},
            'returned': set(),
            'cancelled': set(),
        },
    },
    'sale_order': {
        'table': 'sale_orders',
        'label': '销售单',
        'initial': 'draft',
        'statuses': {
            'draft': '草稿',
            'pending_approval': '待审批',
            'approved': '审批通过',
            'confirmed': '已确认',
            'picking': '拣货中',
            'delivered': '已发货',
            'signed': '已签收',
            'rejected': '已驳回',
            'cancelled': '已作废',
        },
        'transitions': {
            'draft': {'pending_approval', 'approved', 'confirmed', 'picking',
                      'delivered', 'rejected', 'cancelled'},
            'pending_approval': {'draft', 'approved', 'confirmed', 'picking',
                                 'delivered', 'rejected', 'cancelled'},
            'approved': {'picking', 'delivered', 'confirmed', 'cancelled'},
            'confirmed': {'picking', 'delivered', 'cancelled'},
            'picking': {'delivered', 'cancelled'},
            # 装箱发货（ship_packed）会对同一张单再写一次 delivered，放行自身
            'delivered': {'delivered', 'signed', 'cancelled'},
            # 已签收仍可作废：AI 回滚 / 红冲要撤销一张已签收单，这是**真实业务**
            'signed': {'cancelled'},
            'rejected': {'draft', 'cancelled'},
            'cancelled': set(),
        },
    },
    'transfer_order': {
        'table': 'transfer_orders',
        'label': '调拨单',
        'initial': 'draft',
        # ⚠️ 生产这张表**带 CHECK**，取值必须与之逐字一致，否则会出现
        #    「白名单放行、DDL 拒绝」的割裂（SQLite 会直接抛约束错误）。
        'statuses': {
            'draft': '草稿',
            'pending_approval': '待审批',
            'approved': '审批通过',
            'completed': '已完成',
            'cancelled': '已作废',
        },
        'transitions': {
            'draft': {'pending_approval', 'approved', 'completed', 'cancelled'},
            'pending_approval': {'draft', 'approved', 'completed', 'cancelled'},
            'approved': {'completed', 'cancelled'},
            'completed': set(),
            'cancelled': set(),
        },
        'ddl_check': {'draft', 'pending_approval', 'approved', 'completed', 'cancelled'},
    },
    'purchase_return': {
        'table': 'purchase_returns',
        'label': '采购退货单',
        'initial': 'draft',
        'statuses': {
            'draft': '草稿',
            'pending_approval': '待审批',
            'approved': '审批通过',
            'confirmed': '已过账',
            'cancelled': '已作废',
        },
        'transitions': {
            # 建单即过账走 (new) → confirmed；建草稿走 (new) → draft
            'draft': {'pending_approval', 'approved', 'confirmed', 'cancelled'},
            'pending_approval': {'draft', 'approved', 'confirmed', 'cancelled'},
            'approved': {'confirmed', 'cancelled'},
            'confirmed': set(),
            'cancelled': set(),
        },
    },
    'return_order': {
        'table': 'return_orders',
        'label': '销售退货单',
        'initial': 'draft',
        'statuses': {
            'draft': '草稿',
            'pending_approval': '待审批',
            'approved': '审批通过',
            'confirmed': '已确认',
            'dispositioned': '已处置',
            'refunded': '已退款',
            'rejected': '已驳回',
            'cancelled': '已作废',
        },
        'transitions': {
            'draft': {'pending_approval', 'approved', 'confirmed', 'rejected', 'cancelled'},
            'pending_approval': {'draft', 'approved', 'confirmed', 'rejected', 'cancelled'},
            'approved': {'confirmed', 'cancelled'},
            'confirmed': {'dispositioned', 'refunded', 'cancelled'},
            'dispositioned': {'refunded'},
            'rejected': {'draft'},
            'refunded': set(),
            'cancelled': set(),
        },
    },
}

# 取消类状态：docstatus = 2。驳回**不算**取消 —— 它把单子退回可编辑，
# 语义上是「还没提交成功」，所以归 0（与 ERPNext 对 rejected 的处理一致）。
_CANCELLED_STATES = {'cancelled', 'voided'}
# 未提交（可编辑）状态：docstatus = 0
_DRAFT_STATES = {'draft', 'pending_approval', 'rejected'}

# ═══════════════════════════════════════════════════════════════════════════
# 字段锁（FIELD LOCK）—— 阶段 1 · 第 4 项「提交后字段锁定 + 乐观锁」
# ─────────────────────────────────────────────────────────────────────────────
# 🔴 与状态白名单同源：规则只在这里定义一次，所有编辑入口统一来查，不抄第二份。
#
# 背景：收口前「状态」无守卫，导致「提交/审批/入库后还能整单改」—— 改的是已发生的
#   历史（库存/应付/批次已落账），却零报错。第 3 项只管「状态怎么跳」，本段管
#   「在某个状态下，哪些字段还能改」。
#
# 设计（不新增物理列，复用 `status` 作并发令牌）：
#   · `_phase(doc_type, status)` 把状态归到三档：
#       'full'      —— 草稿类，可整单编辑（核心字段 + 安全字段都能改）；
#       'submitted' —— 已提交/审批/确认/拣货/调拨完成，核心交易字段锁死，
#                       只留「安全字段」（备注/经手人/部门/期望日期/单据日期）；
#       'terminal'  —— 已入/已发/已签/已退/已处置/已退款/作废，仓库也锁，只留安全字段。
#   · `editable_fields(doc_type, status)` 返回当前状态下**允许客户端修改**的字段集合。
#   · `assert_no_locked_fields(doc_type, status, attempted)` 校验一批想改的字段，
#       有锁死的就返回中文错误（含当前状态中文名），否则返回 None。
#   · 乐观锁：编辑写入统一 `WHERE id=? AND status=?`（status = 客户端加载时的值），
#       并发下别人先把单子提交了（status 变了），本次 rowcount=0 ⇒ 抛「已被他人改」。
#
# ⚠️ `_phase` 对采购单保留一个既有怪癖：`cancelled` 仍归 'full'（purchase_order_update
#   会把作废单重新整单保存并维持作废）。其余单据的 `cancelled` 一律 'terminal'。
# ═══════════════════════════════════════════════════════════════════════════

# 每个单据类型的「核心交易字段」—— 提交后必须锁死、绝不允许直接改的字段。
_CORE_FIELDS = {
    'purchase_order': {'supplier_id', 'warehouse_id', 'items', 'product_id',
                       'quantity', 'unit', 'unit_price', 'amount', 'total_amount'},
    'sale_order': {'customer_id', 'warehouse_id', 'items', 'product_id',
                   'quantity', 'unit', 'unit_price', 'amount', 'total_amount',
                   'discount', 'tax_rate', 'tax_amount', 'driver_id', 'vehicle_id',
                   'delivery_date', 'delivery_address'},
    'transfer_order': {'warehouse_id', 'from_warehouse_id', 'to_warehouse_id',
                       'items', 'product_id', 'quantity', 'unit'},
    'purchase_return': {'supplier_id', 'warehouse_id', 'items', 'product_id',
                        'quantity', 'unit', 'unit_price', 'amount'},
    'return_order': {'customer_id', 'warehouse_id', 'items', 'product_id',
                     'quantity', 'unit', 'unit_price', 'amount'},
}

# 安全字段：任何状态下都可改（不触账本/库存/应付，只改描述/归属/日期）。
_SAFE_FIELDS = {'note', 'handler', 'department_id', 'expected_date', 'order_date'}

# 已提交但未入/未发的状态：核心锁，安全字段 + 仓库（同仓）可改。
_SUBMITTED_STATES = {'pending_approval', 'approved', 'confirmed', 'picking', 'completed'}


def _phase(doc_type, status):
    """字段锁相位：'full'（可整单改）| 'submitted'（核心锁，安全字段+同仓）| 'terminal'（仅安全字段）。"""
    if status == 'draft':
        return 'full'
    if doc_type == 'purchase_order' and status == 'cancelled':
        return 'full'  # 既有怪癖：作废采购单可重新整单保存并维持作废
    if status in _SUBMITTED_STATES:
        return 'submitted'
    return 'terminal'


def editable_fields(doc_type, status, include_warehouse=True):
    """当前状态下**允许客户端修改**的字段集合。

    - full：核心字段 + 安全字段（整单可改）
    - submitted：安全字段（+ 仓库，当 `include_warehouse` 为真且未入库时）
    - terminal：仅安全字段（仓库锁）
    """
    if _phase(doc_type, status) == 'full':
        return set(_CORE_FIELDS.get(doc_type, set())) | set(_SAFE_FIELDS)
    fields = set(_SAFE_FIELDS)
    if include_warehouse and _phase(doc_type, status) == 'submitted':
        fields.add('warehouse_id')
    return fields


def assert_no_locked_fields(doc_type, status, attempted_fields):
    """`attempted_fields` 是客户端想改的字段集合。若有当前状态锁死的字段，
    返回中文错误（含当前状态中文名 + 首个被锁字段）；否则返回 None。

    用途：编辑入口在落库前调用，把「提交后还去改核心字段」的请求挡在写入之前。
    """
    attempted = set(attempted_fields or ())
    allowed = editable_fields(doc_type, status)
    locked = attempted - allowed
    if not locked:
        return None
    f = sorted(locked)[0]
    return ('该单据已处于「%s」，字段「%s」已锁定不可修改；如需调整交易内容，'
            '请走对应的退/换流程，不要直接改单'
            % (status_label(doc_type, status), f))


def status_token_clause(expected_status):
    """乐观锁片段：返回 `(' AND status=?', [expected_status])`。
    编辑入口把它拼到 UPDATE 末尾，rowcount=0 即代表「状态已被别人改」。"""
    return (' AND status=?', [str(expected_status)])

# 反查表：status 值 → 中文名。同名状态在不同单据下含义相同，取首个即可。
STATUS_LABEL = {}
for _sp in DOC_SPECS.values():
    for _code, _lab in _sp['statuses'].items():
        STATUS_LABEL.setdefault(_code, _lab)


# ──────────────────────────────────────────────────────────────
# 二、只读查询
# ──────────────────────────────────────────────────────────────
def spec(doc_type):
    """取单据规格。未登记的单据直接抛错 —— 静默放行等于没做守卫。"""
    try:
        return DOC_SPECS[doc_type]
    except KeyError:
        raise ValueError(
            '未登记的单据类型「%s」；已登记：%s'
            % (doc_type, '、'.join(sorted(DOC_SPECS)))
        )


def status_label(doc_type, status):
    """状态码 → 中文名。未知值如实显示为「未知状态(x)」，不猜。"""
    sp = spec(doc_type)
    code = str(status or '')
    if code in sp['statuses']:
        return sp['statuses'][code]
    if not code:
        return '空状态'
    return '未知状态(%s)' % code


def docstatus_of(doc_type, status):
    """派生 docstatus：0 草稿 / 1 已提交 / 2 已取消。

    ⚠️ 这是**派生**，不是库里存的列。阶段 2 加物理列时，回填口径必须与本函数
       逐条一致，否则历史数据与新增数据会分成两套判定。
    """
    sp = spec(doc_type)
    code = str(status or '')
    if code not in sp['statuses']:
        # 未知状态不猜成 0：猜成 0 会让它被当成「可编辑草稿」，正是脏状态的入口。
        raise ValueError('%s 的状态「%s」不在词表内' % (sp['label'], code or '(空)'))
    if code in _CANCELLED_STATES:
        return 2
    if code in _DRAFT_STATES:
        return 0
    return 1


def allowed_targets(doc_type, from_status):
    """当前状态能去哪些状态（按词表顺序返回，便于拼提示语）。"""
    sp = spec(doc_type)
    code = str(from_status or '')
    targets = sp['transitions'].get(code, set())
    order = list(sp['statuses'])
    return tuple(s for s in order if s in targets)


def allowed_sources(doc_type, to_status):
    """哪些状态可以走到目标状态 —— 用来给现有 UPDATE 拼 `AND status IN (...)`。

    ⚠️ 返回**按词表顺序**的元组。拼进 SQL 时参数个数必须与元组长度一致，
       别用 `?` * len(set) 那种写法（集合无序，参数顺序会对不上）。
    """
    sp = spec(doc_type)
    code = str(to_status or '')
    if code not in sp['statuses']:
        raise ValueError('%s 没有状态「%s」' % (sp['label'], code))
    order = list(sp['statuses'])
    srcs = {f for f, ts in sp['transitions'].items() if code in ts}
    return tuple(s for s in order if s in srcs)


def check_transition(doc_type, from_status, to_status):
    """校验一次跃迁。合法返回 True；非法抛 `IllegalTransition`（中文原因）。"""
    sp = spec(doc_type)
    src, dst = str(from_status or ''), str(to_status or '')
    if dst not in sp['statuses']:
        raise IllegalTransition(
            '%s没有「%s」这个状态（可用状态：%s）'
            % (sp['label'], dst or '(空)',
               '、'.join(sp['statuses'][s] for s in sp['statuses']))
        )
    if src == dst:
        return True                       # 幂等重写，不算跃迁
    if src not in sp['statuses']:
        raise IllegalTransition(
            '%s当前状态是「%s」，系统不认识这个状态，拒绝改成「%s」'
            % (sp['label'], src or '(空)', sp['statuses'][dst])
        )
    if dst not in sp['transitions'].get(src, set()):
        raise IllegalTransition(explain(doc_type, src, dst))
    return True


def explain(doc_type, from_status, to_status):
    """生成中文原因。**这是用户唯一会看到的那句话**，必须能照着它做决定。"""
    sp = spec(doc_type)
    src, dst = str(from_status or ''), str(to_status or '')
    src_lab = status_label(doc_type, src)
    dst_lab = status_label(doc_type, dst) if dst in sp['statuses'] else (dst or '(空)')
    targets = allowed_targets(doc_type, src)
    if not targets:
        return ('%s已经是「%s」，这是终态，不能再改成「%s」。'
                '要更正请另开一张单（终态单据不允许被改写）。'
                % (sp['label'], src_lab, dst_lab))
    return ('%s当前是「%s」，不能直接改成「%s」；当前只能改成：%s。'
            % (sp['label'], src_lab, dst_lab,
               '、'.join(sp['statuses'][s] for s in targets)))


def guard_sql(doc_type, to_status, prefix='status'):
    """给现有 `UPDATE … WHERE …` 拼一段来源守卫：(sql 片段, 参数列表)。

    用法（**参数顺序要紧**：SET 的占位符在 WHERE 之前）：

        frag, gp = guard_sql('sale_order', 'delivered')
        db.execute("UPDATE sale_orders SET status='delivered' WHERE id=?" + frag,
                   [oid] + gp)

    🔴 为什么保留这种「拼片段」而不是全部换成 `set_doc_status()`：
       很多 UPDATE 同时写 `received_amount` / `audit_time` / 盖章列，整条替换会
       把这些副作用搬到别处，风险远大于收益。片段方案让守卫只有一个来源，
       同时不动既有 SET 子句。
    """
    srcs = allowed_sources(doc_type, to_status)
    if not srcs:
        # 没有任何状态能走到它 —— 说明是 (new) 才有的初始态，只允许 INSERT。
        raise ValueError('%s 的「%s」只能由建单产生，不能 UPDATE 进去'
                         % (spec(doc_type)['label'], status_label(doc_type, to_status)))
    return (' AND %s IN (%s)' % (prefix, ','.join('?' * len(srcs))), list(srcs))


# ──────────────────────────────────────────────────────────────
# 三、唯一写入口
# ──────────────────────────────────────────────────────────────
def set_doc_status(db, doc_type, doc_id, to_status, operator_id='',
                   extra_set=None, extra_params=None, touch=None):
    """把一张单据改到 `to_status`。**这是状态跃迁的唯一写入口**。

    行为：
      1. 读当前状态（同一连接、同一事务）→ 不存在就抛中文错；
      2. 校验跃迁（非法 → `IllegalTransition`，中文原因）；
      3. 乐观锁写入：`WHERE id=? AND status=<读到的旧值>`
         —— 并发下别人先改了，rowcount=0 ⇒ 抛「已被别人改成 X」，不静默覆盖；
      4. 返回 `{'id','from','to','from_label','to_label','docstatus'}`。

    `extra_set` / `extra_params` 供需要「同时写别的列」的调用方使用
    （如 `received_amount`）。它们被拼在 status 之后，参数排在前面。

    `touch` 传列名（如 `'applied_at'`）时补一个本地时间。时间戳由 Python 生成、
    走参数传入，不用 `datetime('now')` —— 那个函数是 SQLite 专有，
    而本仓已支持 PostgreSQL（`db/connection.py` 的 DATABASE_URL 分支）。
    """
    sp = spec(doc_type)
    table = sp['table']
    row = db.execute('SELECT status FROM %s WHERE id=?' % table, (doc_id,)).fetchone()
    if row is None:
        raise IllegalTransition('%s #%s 不存在' % (sp['label'], doc_id))
    src = row['status'] if hasattr(row, 'keys') else row[0]
    src = str(src or sp['initial'])
    if src == to_status:
        return {'id': doc_id, 'from': src, 'to': src,
                'from_label': status_label(doc_type, src),
                'to_label': status_label(doc_type, src),
                'docstatus': docstatus_of(doc_type, src), 'unchanged': True}
    check_transition(doc_type, src, to_status)

    sets = ['status=?']
    params = [to_status]
    for frag, vals in (extra_set or []):
        sets.append(frag)
        params.extend(vals)
    if touch:
        sets.append('%s=?' % touch)
        params.append(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    params.extend([doc_id, src])
    cur = db.execute(
        'UPDATE %s SET %s WHERE id=? AND status=?' % (table, ', '.join(sets)), params)
    if not cur.rowcount:
        raise IllegalTransition(
            '%s #%s 刚被其他人改成别的状态，本次「%s」未生效，请刷新后重试'
            % (sp['label'], doc_id, status_label(doc_type, to_status))
        )
    return {'id': doc_id, 'from': src, 'to': to_status,
            'from_label': status_label(doc_type, src),
            'to_label': status_label(doc_type, to_status),
            'docstatus': docstatus_of(doc_type, to_status),
            'operator_id': str(operator_id or '')}
