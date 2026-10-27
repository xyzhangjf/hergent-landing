#!/usr/bin/env python3
"""v711 补丁：补齐凭证模板（voucher templates）整条功能。

## 现状（v707 排查确认，本版动手前又复核了一遍）

`routers/voucher_templates.py`（v89 Phase 4）和 `voucher_engine.py` 从上线起就在调用
`db.voucher_template_list / create / update / delete / apply`，而这五个函数在 `erp_db.py`
里**从来不存在**（`grep "def voucher_template_" erp_db.py` 0 命中）⇒

  - `GET/POST/PUT/DELETE /api/voucher-templates`、`POST /seed` **全部 500**
    （create/update 还是 100% NameError：读了 `body` 却去用未定义的 `d`）
  - `POST /api/voucher-templates/test` 侥幸能跑（它只调 `apply_template`，
    而 `apply_template` 第一行就 `voucher_template_list` ⇒ 抛异常前先 500……

    实测：`apply_template` 里的 `db.voucher_template_list` 也是 AttributeError，
    所以它同样 500 ——「能跑」是假象。）
  - 自动记账 `auto_journal_for_*` 一直走硬编码科目，**模板引擎零调用者**。

## 改什么（4 个文件）

1. `erp_db.py` **新增 DB 层**（文件末尾追加）：
   `_ensure_voucher_template_tables` / `voucher_template_list|create|update|delete|apply`
   / `_voucher_entries_for`；并给 `feature_flag_list` / `feature_flag_set` 补
   flags 表惰性建表（生产主库 + 租户库**都没有** `feature_flags` 表 ⇒ 开关永远读不到）。

2. `routers/voucher_templates.py` 修 2 处 `d.get(...)` → `body.get(...)`
   （`d` 未定义，100% NameError；`.bak-v707` 自证非本轮引入），并接上已定义却没调用的
   pydantic 校验 `Val1`（类型不对给 422，而不是 500）。

3. `voucher_engine.py` 把 `db_conn` 真正透传给 `voucher_template_list` / `_apply`
   （改前签名有 `db_conn=None` 却没往下传 ⇒ 在自动记账事务里会另开连接写，
   sqlite 下就是 `database is locked`）。

4. `erp_db.py` 的 4 个 `auto_journal_for_*`（sale / payment / purchase / cogs）：
   **模板优先、硬编码兜底**，且只在 feature flag `voucher_templates` 打开时走模板。

## 为什么模板分录必须过三道闸才准过账

`_voucher_entries_for()` 任一条件不满足就返回 `None`（调用方回落硬编码）：

  ① flag 关 / 表缺失 / 异常 → None（fail-safe：读不到开关 = 关）
  ② 无匹配模板 → None
  ③ 模板算出来的分录**借贷不平衡**（`db.precision.money_balanced`，整数分）→ None
     + warning 日志。理由是模板是**用户手填的**，默认模板只覆盖 8 个场景，
     一旦有人填了单边分录就写进 `journal_entries`，账立刻不平且无从回滚。

flag 默认关：`feature_flags` 表在库里不存在，`is_voucher_templates_enabled()` 恒 False
⇒ **本次改动对生产过账结果零影响**（与改前逐分一致，探针用反向对照证明）。

## 用法

    python3 patch_v711_voucher_templates.py --dry-run
    python3 patch_v711_voucher_templates.py            # 打补丁 + 回读校验
    python3 patch_v711_voucher_templates.py --register-flag   # 显式登记 flag（enabled=0）
    python3 patch_v711_voucher_templates.py --revert
"""
import argparse
import os
import shutil
import sys

# 目录可用环境变量覆盖 —— 与 v710 同一条纪律：**让回滚能在副本上被真正验证**。
ERP = os.environ.get("ERP_DIR", "/opt/hergent-erp")
MAIN = os.path.join(ERP, "erp_db.py")
RT = os.path.join(ERP, "routers/voucher_templates.py")
ENG = os.path.join(ERP, "voucher_engine.py")
SUFFIX = ".bak-v711"

FAILS = []


def log(msg):
    print(msg)


def count_occurrences(text, sub):
    n, i = 0, 0
    while True:
        i = text.find(sub, i)
        if i < 0:
            return n
        n += 1
        i += len(sub)


def replace_once(text, old, new, rel, desc, optional=False):
    """幂等替换。

    🔴 判据顺序是硬要求：**先判新串是否已在位**，再看旧串唯一。
    `NEW = OLD + 追加` 这种形状下 OLD 是 NEW 的子串，若先判「旧串 0 次即已改」，
    第二遍跑会**再替换一次**、语法合法、静默劣化（v707 与 v709 各踩一次）。

    `optional=True` 用于「只针对旧形态的升级项」：新库上旧形态根本不存在，
    锚点 0 次是**正常的**（不是错误）。v711 自己踩到：DDL 升级项在干净副本上
    0 次 ⇒ `patch_file` 按错误处理**提前 return** ⇒ 后面几项（feature_flag_list
    兜底、ensure 补列）被连带跳过，重放出来的文件与生产差 39 行。
    """
    n_new = count_occurrences(text, new)
    n_old = count_occurrences(text, old)
    if n_new >= 1:
        log("⏭  %-24s 已是新口径（幂等跳过）— %s" % (rel, desc))
        return text, "already"
    if n_old == 0 and optional:
        log("⏭  %-24s 旧形态不在位（新库无需升级）— %s" % (rel, desc))
        return text, "already"
    if n_old != 1:
        log("🔴 %-24s 锚点出现 %d 次（应为 1）— %s" % (rel, n_old, desc))
        log("     旧串前 120 字：%s" % old[:120].replace("\n", "\\n"))
        FAILS.append("%s 锚点不唯一（%d 次）" % (rel, n_old))
        return text, "error"
    log("✏️  %-24s %s" % (rel, desc))
    return text.replace(old, new, 1), "done"


# --------------------------------------------------------------- 1. DB 层（追加）

VT_DB_LAYER = '''

# === v711: 凭证模板 DB 层 ===
#
# 背景：`routers/voucher_templates.py`（v89 Phase 4）与 `voucher_engine.py` 从上线起
# 就在调 `db.voucher_template_list/create/update/delete/apply`，而这五个函数在 erp_db
# **从来不存在** ⇒ 列表/新建/编辑/删除/播种五个接口全部 500（create/update 还是 100%
# NameError：读了 `body` 却去用未定义的 `d`）。此处补齐。
#
# 🔴 为什么是「请求时惰性建表」而不是在 `init_db()` 加迁移：租户库是从主库复制出来的，
#    init_db 只在主库跑，v706 已确认这种「代码里有表、库里没有」的形状会静默 500。
# 🔴 为什么模板只在 flag `voucher_templates` 打开时才参与自动记账：模板是**用户手填**
#    的会计分录，写错就直接进 `journal_entries`。默认关 = 本次改动对过账结果零影响。

_VT_DDL = (
    """CREATE TABLE IF NOT EXISTS voucher_templates(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        description TEXT DEFAULT '',
        entries_json TEXT NOT NULL DEFAULT '[]',
        conditions_json TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_vt_event ON voucher_templates(event_type, is_active)",
    """CREATE TABLE IF NOT EXISTS voucher_template_applies(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        event_type TEXT DEFAULT '',
        ref_id INTEGER DEFAULT 0,
        applied_at TEXT DEFAULT (datetime('now','localtime'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_vta_tpl ON voucher_template_applies(template_id)",
)

_VT_FF_DDL = """CREATE TABLE IF NOT EXISTS feature_flags(
    name TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    rollout_pct INTEGER DEFAULT 100,
    user_list TEXT DEFAULT '',
    tenant_list TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
)"""

# 存量库里 `feature_flags` 是**早期 schema**（主库权威 DDL 实测只有 6 列，没有
# `updated_at`），而 `feature_flag_list()` / `feature_flag_set()` 的 SELECT / INSERT
# 都引用了 `updated_at` ⇒ 在任何库上这两个函数都必抛 OperationalError
# ⇒ **整个 flag 机制从来没工作过**（不是"关着"，是从没被读到过）。逐列补齐。
_VT_FF_COLS = (
    ("enabled", "INTEGER DEFAULT 0"),
    ("rollout_pct", "INTEGER DEFAULT 100"),
    ("user_list", "TEXT DEFAULT ''"),
    ("tenant_list", "TEXT DEFAULT ''"),
    ("created_at", "TEXT"),
    ("updated_at", "TEXT"),
)


def _ensure_voucher_template_tables(db=None):
    """惰性建表。传 db 时复用调用方连接（自动记账在事务里，不能另开连接写）。"""
    if db is not None:
        for ddl in _VT_DDL:
            db.execute(ddl)
        return
    with get_db_tx() as conn:
        for ddl in _VT_DDL:
            conn.execute(ddl)


def _ensure_feature_flags_table():
    """feature_flags 表惰性建表 + 逐列补齐。

    存量库里这张表是**早期 schema**（缺 `updated_at`，详见 `_VT_FF_COLS` 注释），
    `CREATE TABLE IF NOT EXISTS` 对已存在的表**什么都不做** ⇒ 只建表不补列的话，
    `feature_flag_set()` 照样崩（B 组实测：`table feature_flags has no column named
    updated_at`）。所以按 `PRAGMA table_info` 缺哪列补哪列。
    """
    with get_db_tx() as conn:
        conn.execute(_VT_FF_DDL)
        try:
            have = {r[1] for r in conn.execute("PRAGMA table_info(feature_flags)")}
            for col, ddl in _VT_FF_COLS:
                if col not in have:
                    conn.execute("ALTER TABLE feature_flags ADD COLUMN %s %s" % (col, ddl))
        except Exception as e:
            logging.getLogger("hergent").warning("feature_flags ensure columns failed: %s", e)


def voucher_template_list(event_type="", active_only=False, db_conn=None):
    """凭证模板列表。`db_conn` 非空时复用调用方事务（自动记账路径）。"""
    sql = "SELECT * FROM voucher_templates"
    conds, args = [], []
    if event_type:
        conds.append("event_type=?")
        args.append(event_type)
    if active_only:
        conds.append("is_active=1")
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY priority DESC, id ASC"

    def _q(conn):
        return [dict(r) for r in conn.execute(sql, args).fetchall()]

    if db_conn is not None:
        try:
            return _q(db_conn)
        except Exception:
            try:
                _ensure_voucher_template_tables(db_conn)
                return _q(db_conn)
            except Exception as e:
                logging.getLogger("hergent").warning("voucher_template_list(in-tx) failed: %s", e)
                return []
    try:
        with get_db() as db:
            return _q(db)
    except Exception:
        pass
    try:
        _ensure_voucher_template_tables()
        with get_db() as db:
            return _q(db)
    except Exception as e:
        logging.getLogger("hergent").warning("voucher_template_list failed: %s", e)
        return []


def voucher_template_create(name, event_type, description="", entries_json="[]",
                            conditions_json="{}", is_active=1, priority=0):
    """新建凭证模板，返回新 id。名称/事件类型为空抛 ValueError（路由层转 400）。"""
    name = (name or "").strip() if isinstance(name, str) else name
    event_type = (event_type or "").strip() if isinstance(event_type, str) else event_type
    if not name:
        raise ValueError("模板名称不能为空")
    if not event_type:
        raise ValueError("事件类型不能为空")
    _ensure_voucher_template_tables()
    with get_db_tx() as db:
        cur = db.execute(
            "INSERT INTO voucher_templates "
            "(name,event_type,description,entries_json,conditions_json,is_active,priority) "
            "VALUES (?,?,?,?,?,?,?)",
            (name, event_type, description or "", entries_json or "[]",
             conditions_json or "{}", 1 if int(is_active or 0) else 0, int(priority or 0)),
        )
        return cur.lastrowid


def voucher_template_update(tid, name=None, event_type=None, description=None,
                            entries_json=None, conditions_json=None,
                            is_active=None, priority=None):
    """更新凭证模板。传 None 的字段**保持原值**（部分更新不会把别的字段清掉）。"""
    _ensure_voucher_template_tables()
    sets, args = [], []
    for col, val in (("name", name), ("event_type", event_type), ("description", description),
                     ("entries_json", entries_json), ("conditions_json", conditions_json)):
        if val is not None:
            sets.append(col + "=?")
            args.append(val)
    if is_active is not None:
        sets.append("is_active=?")
        args.append(1 if int(is_active or 0) else 0)
    if priority is not None:
        sets.append("priority=?")
        args.append(int(priority or 0))
    if not sets:
        return {"success": True, "changed": False}
    args.append(tid)
    with get_db_tx() as db:
        if not db.execute("SELECT id FROM voucher_templates WHERE id=?", (tid,)).fetchone():
            raise ValueError("模板不存在: %s" % tid)
        db.execute("UPDATE voucher_templates SET " + ",".join(sets) + " WHERE id=?", args)
    return {"success": True, "changed": True}


def voucher_template_delete(tid):
    """停用凭证模板（软删除：is_active=0）。

    用软删不是硬删：`voucher_template_applies` 里存着历史引用，硬删会让审计记录指向
    不存在的模板；而模板本身是配置，停用即可阻断后续匹配。
    """
    _ensure_voucher_template_tables()
    with get_db_tx() as db:
        if not db.execute("SELECT id FROM voucher_templates WHERE id=?", (tid,)).fetchone():
            raise ValueError("模板不存在: %s" % tid)
        db.execute("UPDATE voucher_templates SET is_active=0 WHERE id=?", (tid,))
    return {"success": True}


def voucher_template_apply(tpl_id, event_type="", ref_id=0, db_conn=None):
    """记录一次模板命中（审计）。`db_conn` 非空时并入调用方事务。"""
    if db_conn is not None:
        try:
            _ensure_voucher_template_tables(db_conn)
            db_conn.execute(
                "INSERT INTO voucher_template_applies (template_id,event_type,ref_id) "
                "VALUES (?,?,?)", (tpl_id, event_type or "", int(ref_id or 0)),
            )
        except Exception as e:
            logging.getLogger("hergent").warning("voucher_template_apply(in-tx) failed: %s", e)
        return
    try:
        _ensure_voucher_template_tables()
        with get_db_tx() as db:
            db.execute(
                "INSERT INTO voucher_template_applies (template_id,event_type,ref_id) "
                "VALUES (?,?,?)", (tpl_id, event_type or "", int(ref_id or 0)),
            )
    except Exception as e:
        logging.getLogger("hergent").warning("voucher_template_apply failed: %s", e)


def _voucher_entries_for(event_type, context, db_conn=None):
    """按凭证模板生成分录；**任一环节不满足就返回 None**（调用方回落硬编码）。

    三道闸：① flag `voucher_templates` 未开 / 表缺失 / 抛异常 → None；
            ② 无匹配模板 → None；
            ③ 模板算出的分录借贷不平衡或全零 → None + warning。
    第 ③ 条是硬要求：模板由用户手填，填错单边分录会直接写进 `journal_entries`。
    """
    try:
        from voucher_engine import is_voucher_templates_enabled, apply_template
        if not is_voucher_templates_enabled():
            return None
    except Exception:
        return None  # 读不到开关 = 关（fail-safe）
    try:
        entries = apply_template(event_type, context, db_conn=db_conn)
    except Exception as e:
        logging.getLogger("hergent").warning(
            "voucher template %s failed, fallback to hardcoded: %s", event_type, e)
        return None
    if not entries or not isinstance(entries, list):
        return None
    try:
        from db.precision import money_balanced
        norm = []
        dr = cr = 0.0
        for e in entries:
            if not isinstance(e, dict) or not e.get("code"):
                return None
            d = round(float(e.get("debit") or 0), 2)
            c = round(float(e.get("credit") or 0), 2)
            dr += d
            cr += c
            norm.append({"code": str(e.get("code")), "name": e.get("name") or "",
                         "debit": d, "credit": c, "summary": e.get("summary") or ""})
        if dr <= 0 and cr <= 0:
            return None
        if not money_balanced(dr, cr):
            logging.getLogger("hergent").warning(
                "voucher template %s unbalanced (dr=%s cr=%s), fallback to hardcoded",
                event_type, dr, cr)
            return None
    except Exception as e:
        logging.getLogger("hergent").warning("voucher template %s normalize failed: %s",
                                             event_type, e)
        return None
    return norm
'''

# ------------------------------------------------- 2. auto_journal_for_* 接入模板

EDITS_SALE = [(
    '''        date_str = o["order_date"][:10]
        # Debit AR, Credit Revenue
        generate_journal_entry("sale",order_id,date_str,[
            {"code":"1122","name":"应收账款","debit":o["total_amount"],"credit":0,"summary":"销售:"+(o["customer_name"] or "")},
            {"code":"6001","name":"主营业务收入","debit":0,"credit":o["total_amount"],"summary":"销售:"+(o["customer_name"] or "")},
        ], db_conn=db)
''',
    '''        date_str = o["order_date"][:10]
        # v711：凭证模板优先（flag `voucher_templates` 开 + 模板平衡），否则回落硬编码。
        _entries = _voucher_entries_for("sale_deliver", {
            "total_amount": o["total_amount"], "customer_name": o["customer_name"] or "",
            "order_no": o["order_no"], "ref_id": order_id,
        }, db)
        if _entries is None:
            # Debit AR, Credit Revenue
            _entries = [
                {"code":"1122","name":"应收账款","debit":o["total_amount"],"credit":0,"summary":"销售:"+(o["customer_name"] or "")},
                {"code":"6001","name":"主营业务收入","debit":0,"credit":o["total_amount"],"summary":"销售:"+(o["customer_name"] or "")},
            ]
        generate_journal_entry("sale",order_id,date_str,_entries, db_conn=db)
''',
    "auto_journal_for_sale 接入模板",
)]

EDITS_PAYMENT = [(
    '''        date_str = p["created_at"][:10]
        if p["type"]=="income":
            generate_journal_entry("payment",payment_id,date_str,[
                {"code":"1002","name":"银行存款","debit":p["amount"],"credit":0,"summary":"收款"},
                {"code":"1122","name":"应收账款","debit":0,"credit":p["amount"],"summary":"收款"},
            ], db_conn=db)
        else:
            generate_journal_entry("payment",payment_id,date_str,[
                {"code":"2202","name":"应付账款","debit":p["amount"],"credit":0,"summary":"付款"},
                {"code":"1002","name":"银行存款","debit":0,"credit":p["amount"],"summary":"付款"},
            ], db_conn=db)
''',
    '''        date_str = p["created_at"][:10]
        # v711：凭证模板优先。收款/付款是两个 event_type，按 cash_flow.type 选。
        _entries = _voucher_entries_for(
            "payment_received" if p["type"] == "income" else "payment_made",
            {"amount": p["amount"], "type": p["type"], "ref_id": payment_id}, db)
        if p["type"]=="income":
            if _entries is None:
                _entries = [
                    {"code":"1002","name":"银行存款","debit":p["amount"],"credit":0,"summary":"收款"},
                    {"code":"1122","name":"应收账款","debit":0,"credit":p["amount"],"summary":"收款"},
                ]
            generate_journal_entry("payment",payment_id,date_str,_entries, db_conn=db)
        else:
            if _entries is None:
                _entries = [
                    {"code":"2202","name":"应付账款","debit":p["amount"],"credit":0,"summary":"付款"},
                    {"code":"1002","name":"银行存款","debit":0,"credit":p["amount"],"summary":"付款"},
                ]
            generate_journal_entry("payment",payment_id,date_str,_entries, db_conn=db)
''',
    "auto_journal_for_payment 接入模板",
)]

EDITS_PURCHASE = [(
    '''        date_str = o["order_date"][:10]
        generate_journal_entry("purchase",order_id,date_str,[
            {"code":"1405","name":"库存商品","debit":o["total_amount"],"credit":0,"summary":"采购入库"},
            {"code":"2202","name":"应付账款","debit":0,"credit":o["total_amount"],"summary":"采购入库"},
        ], db_conn=db)
''',
    '''        date_str = o["order_date"][:10]
        # v711：凭证模板优先，否则回落硬编码。
        _entries = _voucher_entries_for("purchase_receive", {
            "total_amount": o["total_amount"],
            # 🔴 `sqlite3.Row` 没有 .get()（B 组实测 AttributeError ⇒ 采购过账全挂）
            "order_no": o["order_no"] if "order_no" in o.keys() else "",
            "ref_id": order_id,
        }, db)
        if _entries is None:
            _entries = [
                {"code":"1405","name":"库存商品","debit":o["total_amount"],"credit":0,"summary":"采购入库"},
                {"code":"2202","name":"应付账款","debit":0,"credit":o["total_amount"],"summary":"采购入库"},
            ]
        generate_journal_entry("purchase",order_id,date_str,_entries, db_conn=db)
''',
    "auto_journal_for_purchase 接入模板",
)]

# 🔴 第一版在 purchase 的 ctx 里写了 `o.get("order_no", "")` —— `sqlite3.Row` 没有
# .get()，AttributeError 会让**采购过账整条路径挂掉**（B 组实测）。就地修掉。
EDITS_PURCHASE_FIX = [(
    '''            "total_amount": o["total_amount"], "order_no": o.get("order_no", ""),''',
    '''            "total_amount": o["total_amount"],
            # 🔴 `sqlite3.Row` 没有 .get()（B 组实测 AttributeError ⇒ 采购过账全挂）
            "order_no": o["order_no"] if "order_no" in o.keys() else "",''',
    "auto_journal_for_purchase 修 Row 无 .get()",
    True,  # 可选：新库上 EDITS_PURCHASE 直接产出修好的版本，无需再修
)]

EDITS_COGS = [(
    '''        date_str = o["order_date"][:10]
        generate_journal_entry("cogs", order_id, date_str, [
            {"code": "6401", "name": "主营业务成本", "debit": round(total_cost, 2), "credit": 0,
             "summary": f"结转销售成本 订单#{o['order_no']}"},
            {"code": "1405", "name": "库存商品", "debit": 0, "credit": round(total_cost, 2),
             "summary": f"结转销售成本 订单#{o['order_no']}"},
        ], db_conn=db)
''',
    '''        date_str = o["order_date"][:10]
        # v711：凭证模板优先（默认模板取 `cost_amount`），否则回落硬编码。
        _entries = _voucher_entries_for("cogs", {
            "cost_amount": round(total_cost, 2), "total_cost": round(total_cost, 2),
            "order_no": o["order_no"], "ref_id": order_id,
        }, db)
        if _entries is None:
            _entries = [
                {"code": "6401", "name": "主营业务成本", "debit": round(total_cost, 2), "credit": 0,
                 "summary": f"结转销售成本 订单#{o['order_no']}"},
                {"code": "1405", "name": "库存商品", "debit": 0, "credit": round(total_cost, 2),
                 "summary": f"结转销售成本 订单#{o['order_no']}"},
            ]
        generate_journal_entry("cogs", order_id, date_str, _entries, db_conn=db)
''',
    "auto_journal_for_cogs 接入模板",
)]

# feature_flags 兜底：存量表缺 `updated_at` 列 ⇒ list/set 全崩 ⇒ flag 机制形同虚设
OLD_FF_LIST = '''def feature_flag_list():
    """Return all feature flags as a list of dicts. Empty list if table missing."""
    with get_db() as db:
        try:
            rows = db.execute(
                "SELECT name, enabled, rollout_pct, user_list, tenant_list, "
                "created_at, updated_at FROM feature_flags ORDER BY name"
            ).fetchall()
        except Exception:
            return []
    return [dict(r) for r in rows]
'''

NEW_FF_LIST = '''def feature_flag_list():
    """Return all feature flags as a list of dicts. Empty list if table missing."""
    _sel = ("SELECT name, enabled, rollout_pct, user_list, tenant_list, "
            "created_at, updated_at FROM feature_flags ORDER BY name")
    try:
        with get_db() as db:
            rows = db.execute(_sel).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        pass
    # v711：存量表缺 `updated_at` 列 ⇒ 这条 SELECT 必抛异常 ⇒ 任何 flag 恒为关，
    # 而且**永远没法被打开**。先建表/补列再查一次；仍失败返回 []（读不到 = 关）。
    # 🔴 建表必须走 get_db_tx：`get_db()` 退出时会 rollback，CREATE 会被丢掉。
    try:
        _ensure_feature_flags_table()
        with get_db() as db:
            rows = db.execute(_sel).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logging.getLogger("hergent").debug("feature_flag_list: %s", e)
        return []
'''

EDITS_FF = [
    # 存量库已应用过第一版（只建表不补列），就地升级
    (
        '''_VT_FF_DDL = """CREATE TABLE IF NOT EXISTS feature_flags(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    enabled INTEGER DEFAULT 0,
    rollout_pct INTEGER DEFAULT 100,
    user_list TEXT DEFAULT '',
    tenant_list TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
)"""
''',
        '''_VT_FF_DDL = """CREATE TABLE IF NOT EXISTS feature_flags(
    name TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    rollout_pct INTEGER DEFAULT 100,
    user_list TEXT DEFAULT '',
    tenant_list TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
)"""

# 存量库里 `feature_flags` 是**早期 schema**（主库权威 DDL 实测只有 6 列，没有
# `updated_at`），而 `feature_flag_list()` / `feature_flag_set()` 的 SELECT / INSERT
# 都引用了 `updated_at` ⇒ 在任何库上这两个函数都必抛 OperationalError
# ⇒ **整个 flag 机制从来没工作过**（不是"关着"，是从没被读到过）。逐列补齐。
_VT_FF_COLS = (
    ("enabled", "INTEGER DEFAULT 0"),
    ("rollout_pct", "INTEGER DEFAULT 100"),
    ("user_list", "TEXT DEFAULT ''"),
    ("tenant_list", "TEXT DEFAULT ''"),
    ("created_at", "TEXT"),
    ("updated_at", "TEXT"),
)
''',
        "feature_flags DDL 改与主库同形 + 补列清单",
        True,  # 可选：新库追加的就是新 DDL，旧形态 0 次属正常
    ),
    (
        '''def _ensure_feature_flags_table():
    """feature_flags 表惰性建表。

    生产实测：主库 `/opt/hergent-data/erp.db` 与租户库 `tenant_1.db` **都没有**这张表
    ⇒ `feature_flag_list()` 恒返回 [] ⇒ 任何 flag 永远是关，也永远没法被打开。
    """
    with get_db_tx() as conn:
        conn.execute(_VT_FF_DDL)
''',
        '''def _ensure_feature_flags_table():
    """feature_flags 表惰性建表 + 逐列补齐。

    存量库里这张表是**早期 schema**（缺 `updated_at`，详见 `_VT_FF_COLS` 注释），
    `CREATE TABLE IF NOT EXISTS` 对已存在的表**什么都不做** ⇒ 只建表不补列的话，
    `feature_flag_set()` 照样崩（B 组实测：`table feature_flags has no column named
    updated_at`）。所以按 `PRAGMA table_info` 缺哪列补哪列。
    """
    with get_db_tx() as conn:
        conn.execute(_VT_FF_DDL)
        try:
            have = {r[1] for r in conn.execute("PRAGMA table_info(feature_flags)")}
            for col, ddl in _VT_FF_COLS:
                if col not in have:
                    conn.execute("ALTER TABLE feature_flags ADD COLUMN %s %s" % (col, ddl))
        except Exception as e:
            logging.getLogger("hergent").warning("feature_flags ensure columns failed: %s", e)
''',
        "_ensure_feature_flags_table 加补列",
        True,  # 可选：同上，新库追加块里已是带补列的版本
    ),
    (
        '（不是"关着",是从没被读到过）',
        '（不是"关着"，是从没被读到过）',
        "注释标点统一（纯注释，无语义）",
        True,
    ),
    (OLD_FF_LIST, NEW_FF_LIST, "feature_flag_list 补惰性建表"),
    # 注：上面这条的 `NEW` 文本必须**始终与"最终形态"一致**，否则已应用过的库上
    # 会变成 n_new=0 且 n_old=0 ⇒ 整批回滚（v711 自己踩过一次）。
    (
        "    # v711：flags 表在库里根本不存在（生产主库 + 租户库实测都没有）⇒ 任何 flag 恒为关，\n"
        "    # 而且**永远没法被打开**。惰性建一次空表；仍失败就返回 []（读不到 = 关，fail-safe）。\n",
        "    # v711：存量表缺 `updated_at` 列 ⇒ 这条 SELECT 必抛异常 ⇒ 任何 flag 恒为关，\n"
        "    # 而且**永远没法被打开**。先建表/补列再查一次；仍失败返回 []（读不到 = 关）。\n",
        "feature_flag_list 注释更正（表存在，缺的是列）",
    ),
    (
        'def feature_flag_set(name, enabled=1, rollout_pct=100, user_list=\'\', tenant_list=\'\'):\n'
        '    """Upsert a feature flag (idempotent)."""\n',
        'def feature_flag_set(name, enabled=1, rollout_pct=100, user_list=\'\', tenant_list=\'\'):\n'
        '    """Upsert a feature flag (idempotent)."""\n'
        '    try:\n'
        '        _ensure_feature_flags_table()\n'
        '    except Exception as e:\n'
        '        logging.getLogger("hergent").warning("feature_flag_set: ensure table failed: %s", e)\n',
        "feature_flag_set 先确保表存在",
    ),
]

# ------------------------------------------------------------- 3. 路由：修 `d` 未定义

EDITS_RT = [
    (
        '''    body = await request.json()
    tid = db.voucher_template_create(
        d.get("name", ""), d.get("event_type", ""),
        d.get("description", ""), d.get("entries_json", "[]"),
        d.get("conditions_json", "{}"), int(d.get("is_active", 1)),
        int(d.get("priority", 0))
    )
    return {"success": True, "id": tid}
''',
        '''    body = await request.json()
    if not isinstance(body, dict):
        body = {}
    _v(Val1, body)  # v711：改前读了 body 却用未定义的 `d` ⇒ 100% NameError
    try:
        tid = db.voucher_template_create(
            body.get("name", ""), body.get("event_type", ""),
            body.get("description", ""), body.get("entries_json", "[]"),
            body.get("conditions_json", "{}"), body.get("is_active", 1),
            body.get("priority", 0)
        )
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    return {"success": True, "id": tid}
''',
        "create_template 修 d→body + 校验",
    ),
    (
        '''    body = await request.json()
    db.voucher_template_update(tid,
        d.get("name"), d.get("event_type"), d.get("description"),
        d.get("entries_json"), d.get("conditions_json"),
        int(d.get("is_active", 1)), int(d.get("priority", 0))
    )
    return {"success": True}
''',
        '''    body = await request.json()
    if not isinstance(body, dict):
        body = {}
    _v(Val1, body)  # v711：同上，`d` 未定义
    try:
        db.voucher_template_update(tid,
            body.get("name"), body.get("event_type"), body.get("description"),
            body.get("entries_json"), body.get("conditions_json"),
            body.get("is_active"), body.get("priority")
        )
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    return {"success": True}
''',
        "update_template 修 d→body + 校验",
    ),
]

# -------------------------------------------------------- 4. voucher_engine 透传 db_conn

EDITS_ENG = [
    (
        "    templates = db.voucher_template_list(event_type=event_type, active_only=True)",
        "    templates = db.voucher_template_list(event_type=event_type, active_only=True,\n"
        "                                         db_conn=db_conn)",
        "apply_template 列表走同一连接",
    ),
    (
        '            db.voucher_template_apply(tpl["id"], event_type, context.get("ref_id", 0))',
        '            db.voucher_template_apply(tpl["id"], event_type, context.get("ref_id", 0),\n'
        '                                      db_conn=db_conn)',
        "apply_template 审计写同一连接",
    ),
    # 🔴 审计必须写在**平衡校验之后**：改前审计写在 return 之前、校验之前，于是
    # 「模板因为不平衡被拒、账其实走了硬编码」也照样留下一条 applies 记录 ⇒
    # 审计表会骗人（A21 实测：单边模板被拒但仍留下 1 条命中）。
    (
        '''        # Record template application for audit
        try:
            db.voucher_template_apply(tpl["id"], event_type, context.get("ref_id", 0),
                                      db_conn=db_conn)
        except Exception as e:
            logging.getLogger("hergent").debug(f"optional step failed: {e}")

        return entries
''',
        '''        # v711：先校验借贷平衡，再写审计。不平衡的模板**跳过并继续试下一个**，
        # 而不是把它返回给上层丢弃 —— 否则审计表里会有「命中了但其实没用」的脏记录。
        try:
            from db.precision import money_balanced
            if not money_balanced(sum(e["debit"] for e in entries),
                                  sum(e["credit"] for e in entries)):
                logging.getLogger("hergent").warning(
                    "voucher template #%s(%s) unbalanced, skip", tpl.get("id"), tpl.get("name"))
                continue
        except Exception as e:
            logging.getLogger("hergent").warning(
                "voucher template #%s balance check failed: %s", tpl.get("id"), e)
            continue
        # Record template application for audit
        try:
            db.voucher_template_apply(tpl["id"], event_type, context.get("ref_id", 0),
                                      db_conn=db_conn)
        except Exception as e:
            logging.getLogger("hergent").debug(f"optional step failed: {e}")

        return entries
''',
        "apply_template 审计移到平衡校验之后",
    ),
]


def patch_file(path, edits, dry):
    rel = os.path.relpath(path, ERP)
    text = open(path, encoding="utf-8").read()
    orig = text
    for item in edits:
        old, new, desc = item[0], item[1], item[2]
        optional = item[3] if len(item) > 3 else False
        text, st = replace_once(text, old, new, rel, desc, optional)
        if st == "error":
            return
    if text == orig:
        return
    if dry:
        log("   (dry-run 不落盘：%s 将变更 %d 字节)" % (rel, len(text) - len(orig)))
        return
    if not os.path.exists(path + SUFFIX):
        shutil.copy2(path, path + SUFFIX)
        log("   备份 → %s%s" % (rel, SUFFIX))
    open(path, "w", encoding="utf-8").write(text)
    try:
        compile(text, path, "exec")
        log("   语法 ok: %s" % rel)
    except SyntaxError as e:
        shutil.copy2(path + SUFFIX, path)
        log("   🔴 语法错误，已回滚：%s" % e)
        FAILS.append("%s 语法错误已回滚" % rel)


def append_db_layer(dry):
    """DB 层是**整块追加**：判据不能用「旧串是否存在」——旧串根本不存在。
    只能判「新串是否已在位」（`def voucher_template_list(` 唯一）。"""
    rel = os.path.relpath(MAIN, ERP)
    text = open(MAIN, encoding="utf-8").read()
    anchor = "def voucher_template_list(event_type="
    n = count_occurrences(text, anchor)
    if n >= 1:
        log("⏭  %-24s DB 层已在位（幂等跳过），实际 %d 处" % (rel, n))
        return
    log("✏️  %-24s 追加凭证模板 DB 层（%d 字节）" % (rel, len(VT_DB_LAYER)))
    if dry:
        log("   (dry-run 不落盘)")
        return
    if not os.path.exists(MAIN + SUFFIX):
        shutil.copy2(MAIN, MAIN + SUFFIX)
        log("   备份 → %s%s" % (rel, SUFFIX))
    open(MAIN, "a", encoding="utf-8").write(VT_DB_LAYER)
    try:
        compile(open(MAIN, encoding="utf-8").read(), MAIN, "exec")
        log("   语法 ok: %s" % rel)
    except SyntaxError as e:
        shutil.copy2(MAIN + SUFFIX, MAIN)
        log("   🔴 语法错误，已回滚：%s" % e)
        FAILS.append("%s 追加后语法错误已回滚" % rel)


def revert():
    for path in (MAIN, RT, ENG):
        if os.path.exists(path + SUFFIX):
            shutil.copy2(path + SUFFIX, path)
            log("↩️  已从备份恢复 %s" % os.path.relpath(path, ERP))
        else:
            log("⏭  无备份，跳过 %s" % os.path.relpath(path, ERP))
    return 0


def register_flag():
    """显式登记 flag（enabled=0）—— 让「默认关」是一个**看得见的事实**，
    而不是「因为表不存在所以正好是关」这种巧合。"""
    sys.path.insert(0, ERP)
    os.chdir(ERP)
    import erp_db  # noqa: E402
    erp_db.feature_flag_set("voucher_templates", 0, 100)
    rows = [r for r in erp_db.feature_flag_list() if r.get("name") == "voucher_templates"]
    log("flag 现状: %s" % rows)
    if not rows or int(rows[0].get("enabled") or 0) != 0:
        FAILS.append("flag 登记失败（应存在且 enabled=0）")
    return rows


def verify():
    log("\n【回读校验】")
    main = open(MAIN, encoding="utf-8").read()
    rt = open(RT, encoding="utf-8").read()
    eng = open(ENG, encoding="utf-8").read()

    def bad(label, cond, extra=""):
        if not cond:
            FAILS.append(label)
        log(("  ✅ " if cond else "  🔴 ") + label + (("  " + extra) if extra else ""))

    for fn in ("def voucher_template_list(", "def voucher_template_create(",
               "def voucher_template_update(", "def voucher_template_delete(",
               "def voucher_template_apply(", "def _ensure_voucher_template_tables(",
               "def _ensure_feature_flags_table(", "def _voucher_entries_for("):
        n = count_occurrences(main, fn)
        bad("erp_db 定义 %s（且只 1 处）" % fn, n == 1, "实际 %d 处" % n)

    for ev, label in (("sale_deliver", "sale"), ("payment_received", "payment"),
                      ("purchase_receive", "purchase"), ("cogs", "cogs")):
        n = count_occurrences(main, '"%s"' % ev)
        bad("auto_journal %s 已接模板" % label, n >= 1, "出现 %d 次" % n)
    bad("4 处 auto_journal 全部走 _voucher_entries_for",
        count_occurrences(main, "_voucher_entries_for(") >= 5,
        "实际 %d 处（4 处调用 + 1 处定义）" % count_occurrences(main, "_voucher_entries_for("))
    bad("flag 检查走 money_balanced（模板不平衡即回落）",
        "from db.precision import money_balanced" in main)
    bad("purchase ctx 不再用 Row.get()（Row 没有该方法）",
        'o.get("order_no", "")' not in main)

    bad("feature_flag_list 已补惰性建表", "_ensure_feature_flags_table()" in main)
    bad("feature_flag_set 已补惰性建表",
        count_occurrences(main, "_ensure_feature_flags_table()") >= 2)
    bad("feature_flags 补列清单在位（存量表缺 updated_at）",
        "_VT_FF_COLS = (" in main and "PRAGMA table_info(feature_flags)" in main)
    bad("feature_flags DDL 与主库同形（name TEXT PRIMARY KEY）",
        "    name TEXT PRIMARY KEY," in main)

    bad("router 不再引用未定义的 d（残留 0 处）",
        count_occurrences(rt, "d.get(") == 0, "实际 %d 处" % count_occurrences(rt, "d.get("))
    bad("router create 用 body.get", 'body.get("name", "")' in rt)
    bad("router update 用 body.get", 'body.get("entries_json")' in rt)
    bad("router 已接 pydantic 校验", count_occurrences(rt, "_v(Val1, body)") == 2)

    bad("engine 列表透传 db_conn", "active_only=True,\n                                         db_conn=db_conn)" in eng)
    bad("engine 审计透传 db_conn", 'db.voucher_template_apply(tpl["id"], event_type, context.get("ref_id", 0),\n                                      db_conn=db_conn)' in eng)
    bad("engine 审计在平衡校验之后（不平衡即跳过）",
        "unbalanced, skip" in eng and count_occurrences(eng, "unbalanced, skip") == 1,
        "出现 %d 次" % count_occurrences(eng, "unbalanced, skip"))

    for f in (MAIN, RT, ENG):
        try:
            compile(open(f, encoding="utf-8").read(), f, "exec")
            log("  ✅ 语法 ok %s" % os.path.relpath(f, ERP))
        except SyntaxError as e:
            FAILS.append("语法错误 %s: %s" % (f, e))
            log("  🔴 语法错误 %s: %s" % (f, e))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--register-flag", action="store_true")
    ap.add_argument("--skip-verify", action="store_true")
    a = ap.parse_args()

    if a.revert:
        return revert()

    log("目标目录 %s" % ERP)
    for p in (MAIN, RT, ENG):
        if not os.path.exists(p):
            log("🔴 缺文件 %s" % p)
            return 2

    log("\n【1/5】erp_db.py 追加凭证模板 DB 层")
    append_db_layer(a.dry_run)

    log("\n【2/5】erp_db.py auto_journal_for_* 四处接入模板")
    for name, edits in (("sale", EDITS_SALE), ("payment", EDITS_PAYMENT),
                        ("purchase", EDITS_PURCHASE), ("cogs", EDITS_COGS),
                        ("purchase-fix", EDITS_PURCHASE_FIX)):
        log("  -- %s" % name)
        patch_file(MAIN, edits, a.dry_run)

    log("\n【3/5】erp_db.py feature_flags 表惰性建表")
    patch_file(MAIN, EDITS_FF, a.dry_run)

    log("\n【4/5】routers/voucher_templates.py 修 d 未定义")
    patch_file(RT, EDITS_RT, a.dry_run)

    log("\n【5/5】voucher_engine.py 透传 db_conn")
    patch_file(ENG, EDITS_ENG, a.dry_run)

    if not a.dry_run and not a.skip_verify:
        verify()

    if a.register_flag and not a.dry_run:
        log("\n【flag 登记】voucher_templates = 0（默认关）")
        register_flag()

    log("\n" + "=" * 78)
    if FAILS:
        log("失败 %d 项：" % len(FAILS))
        for f in FAILS:
            log("  🔴 " + f)
        return 1
    log("补丁完成，全部校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
