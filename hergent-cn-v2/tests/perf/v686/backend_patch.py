#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v686 后端补丁：销售单/退货单「业务员」字段 + 业务员部门带出数据源 + 账号部门写端。

三项老板口径（2026-10-25）：
  ① 未选供应商/客户不许筛商品、不许开单  —— 纯前端，不在本脚本
  ② 选业务员自动带出部门 + 无部门明确提示  —— 本脚本补**数据源**（refs users.department_id）
     与**写入口**（PUT /api/users/{uid}/department）。没有写端，这列永远是 0。
  ③ 「经办人」全站统一叫「业务员」        —— 自提/车销四页此前**没有**这个字段，
     不是改名而是补字段：sale_orders / return_orders 各加 handler 列并打通
     create → 详情 → 列表。

🔴 纪律：每处替换都断言命中次数 == 1，命中 0 或 >1 立刻中止（不做模糊替换）。
🔴 全部是「加法」：新列默认 ''、新参数默认空串 ⇒ 不传时 SQL 与改动前逐字一致。
用法：python3 backend_patch.py [--dry-run]
"""
import os
import sys
import time
import shutil

ROOT = "/opt/hergent-erp"
STAMP = time.strftime("%Y%m%d%H%M%S")
DRY = "--dry-run" in sys.argv

# (文件, 说明, old, new)
PATCHES = []


def P(f, desc, old, new):
    PATCHES.append((f, desc, old, new))


# ─────────────────────────── 1) erp_db.py ───────────────────────────
P("erp_db.py", "主库迁移：sale_orders/return_orders 加 handler",
  """    _safe_migrate('v408_po_department_id', "ALTER TABLE purchase_orders ADD COLUMN department_id INTEGER DEFAULT 0")""",
  """    _safe_migrate('v408_po_department_id', "ALTER TABLE purchase_orders ADD COLUMN department_id INTEGER DEFAULT 0")
    # v686（2026-10-25）：销售单 / 销售退货单补「业务员」列。
    #   🔴 为什么是**加列**而不是改名：自提/车销四个建单页此前**根本没有**人员归属字段
    #      （只有 `operator_id` = 谁建的、`driver_id` = 送货司机）。老板要求「全链路统一叫
    #      业务员」，落地的第一步是让它先存在。
    #   🔴 取值域与 `purchase_orders.handler` **逐字相同**（主库 `users.id` 的字符串）——
    #      共用同一个 `refs?kind=users` 下拉，不另立一套编号。
    #   ⚠️ 与 `operator_id` 是两回事：`operator_id` = 谁**建**的（系统事实 + `_doc_owner_ok`
    #      拿它做归属鉴权）；`handler` = 这张单归谁**办**（业务归属，将来可改）。
    #   ⚠️ 租户库有第二处必须同步登记（见 `_ensure_tenant_module_tables` 的列补丁清单）。
    _safe_migrate('v686_so_handler', "ALTER TABLE sale_orders ADD COLUMN handler TEXT DEFAULT ''")
    _safe_migrate('v686_ro_handler', "ALTER TABLE return_orders ADD COLUMN handler TEXT DEFAULT ''")""")

P("erp_db.py", "租户列补丁清单：加两条 handler",
  """                    ("purchase_orders.issued_by", "ALTER TABLE purchase_orders ADD COLUMN issued_by TEXT DEFAULT ''"),
                ):""",
  """                    ("purchase_orders.issued_by", "ALTER TABLE purchase_orders ADD COLUMN issued_by TEXT DEFAULT ''"),
                    # v686（2026-10-25）：与主库 `v686_so_handler` / `v686_ro_handler` **成对**。
                    #   口径同 v403 / v408 / v449 那几段：这里是「**当次启动就生效**」的那一路；
                    #   只靠启动期列对账（`_sync_tenant_columns_on`）会留一个「租户库还没有这列」
                    #   的窗口，窗口内建销售单/退货单会 `no such column` ⇒ 直接 500。
                    #   🔴 列名与主库**逐字相同** —— 拼错一个字符就变成"主库有、租户库没有"的
                    #      偏科状态，且只在非默认租户上才暴露。
                    ("sale_orders.handler", "ALTER TABLE sale_orders ADD COLUMN handler TEXT DEFAULT ''"),
                    ("return_orders.handler", "ALTER TABLE return_orders ADD COLUMN handler TEXT DEFAULT ''"),
                ):""")

# ─────────────────── 2) db/queries/sales.py ───────────────────
P("db/queries/sales.py", "sale_order_create 签名加 handler",
  """skip_credit_check=False, order_no='', order_type='', sub_order_no='', db_conn=None, skip_entity_log=False, department=''):""",
  """skip_credit_check=False, order_no='', order_type='', sub_order_no='', db_conn=None, skip_entity_log=False, department='', handler=''):""")

P("db/queries/sales.py", "sale_order_create 动态列加 handler",
  """    for _k, _v in (("order_type", order_type), ("sub_order_no", sub_order_no),
                   ("department", department)):""",
  """    # v686：`handler`（业务员）与上面三个同族 —— 有值才进 INSERT（空 ⇒ SQL 与改动前逐字一致）。
    #   ⚠️ 它是「业务归属」不是「创建人」：`operator_id` 由服务端从登录身份写死，
    #      `handler` 由建单人在「业务员」下拉里选，两者取值域相同但语义不同。
    for _k, _v in (("order_type", order_type), ("sub_order_no", sub_order_no),
                   ("department", department), ("handler", handler)):""")

P("db/queries/sales.py", "return_order_create 签名加 handler",
  """                        order_date='', draft=False):""",
  """                        order_date='', draft=False, handler=''):""")

P("db/queries/sales.py", "return_order_create 动态列加 handler",
  """        for _k, _v in (('warehouse_id', wh), ('order_type', order_type),
                       ('driver_id', driver_id), ('note', note)):""",
  """        # v686：`handler`（业务员）—— 与上面四个同族（「列存在 且 有值」才写）。
        for _k, _v in (('warehouse_id', wh), ('order_type', order_type),
                       ('driver_id', driver_id), ('note', note), ('handler', handler)):""")

# ─────────────────── 3) routers/sales.py ───────────────────
P("routers/sales.py", "SaleOrderCreate 声明 handler",
  """    order_type: str = ""
    department: str = \"\"


class ReturnItem(BaseModel):""",
  """    order_type: str = ""
    department: str = ""
    # v686（2026-10-25）：业务员。取值域与 `operator_id` **相同**（主库 users.id 的字符串），
    #   但语义相反 —— `operator_id` 是"谁建的"（服务端从登录身份写死），
    #   本字段是"归谁办"（建单人在下拉里选，可改）。
    #   ⚠️ 显式声明 = 契约：不声明时字段名打错也不报错，只会安静落空值（本仓反复付学费）。
    handler: str = \"\"


class ReturnItem(BaseModel):""")

P("routers/sales.py", "create_sale 透传 handler",
  """        department=(getattr(payload, 'department', '') or '').strip(),
    )""",
  """        department=(getattr(payload, 'department', '') or '').strip(),
        # v686：业务员（空串 ⇒ db 层「空则不写列」⇒ 建单 SQL 与改动前逐字一致）
        handler=(getattr(payload, 'handler', '') or '').strip(),
    )""")

# ─────────────────── 4) routers/psi.py ───────────────────
P("routers/psi.py", "_main_users 读 department_id",
  """                rows = d.execute("SELECT id, username, display_name FROM users").fetchall()""",
  """                try:
                    # v686：业务员下拉要「选人带出部门」，所以必须把 `department_id` 一起读出来。
                    #   ⚠️ 老主库可能没有这一列 ⇒ 退回原投影（不能因为少一列就让整个下拉消失，
                    #      那正是本仓最贵的一类静默失效）。
                    rows = d.execute(
                        "SELECT id, username, display_name, department_id FROM users").fetchall()
                except Exception:
                    rows = d.execute("SELECT id, username, display_name FROM users").fetchall()""")

P("routers/psi.py", "_main_users 返回 department_id",
  """    return [{"id": r["id"],
             "username": str(r["username"] or "").strip(),
             "name": str(r["display_name"] or "").strip() or str(r["username"] or "").strip()}
            for r in rows]""",
  """    _out = []
    for r in rows:
        # `sqlite3.Row` 缺列时 `r["x"]` 抛 IndexError ⇒ 用 keys() 判存在（见 v686 注释）。
        _did = 0
        try:
            if "department_id" in r.keys():
                _did = int(r["department_id"] or 0)
        except Exception:
            _did = 0
        _out.append({"id": r["id"],
                     "username": str(r["username"] or "").strip(),
                     "department_id": _did,
                     "name": str(r["display_name"] or "").strip() or str(r["username"] or "").strip()})
    return _out""")

P("routers/psi.py", "refs users 下发 department_id",
  """        _us = _main_users()
        if _us is not None:
            out["users"] = [{"id": u["id"], "name": u["name"]} for u in _us if u["name"]]""",
  """        _us = _main_users()
        if _us is not None:
            # v686：多下发 `department_id` —— 前端「选业务员自动带出部门」的唯一数据源。
            #   🔴 部门**名**不在这里翻译：前端本来就有 `departments` 下拉（按 id 匹配），
            #      在两端各译一次必然分叉。0 = 该账号没设部门 ⇒ 前端据此给提示。
            out["users"] = [{"id": u["id"], "name": u["name"],
                             "department_id": int(u.get("department_id") or 0)}
                            for u in _us if u["name"]]""")

P("routers/psi.py", "销售退单落 handler",
  """        order_date=str(body.get("order_date") or "").strip(),
        # v500（与采购侧 v451 同款）：「保存草稿」= True ⇒ 只落单、不动库存与应收；
        #   「保存并审核」/ 老调用方 = False ⇒ 建单即过账（v449 行为零变化）。
        draft=bool(body.get("draft")),
    )""",
  """        order_date=str(body.get("order_date") or "").strip(),
        # v686：业务员（选填；空串 ⇒ db 层不写该列）
        handler=str(body.get("handler") or "").strip(),
        # v500（与采购侧 v451 同款）：「保存草稿」= True ⇒ 只落单、不动库存与应收；
        #   「保存并审核」/ 老调用方 = False ⇒ 建单即过账（v449 行为零变化）。
        draft=bool(body.get("draft")),
    )""")

P("routers/psi.py", "销售详情注入 handler_name",
  """        _o = r.get("order") if isinstance(r, dict) else None
        if _o is not None:
            _o["approval_node"] = int(_o.get("approval_node") or 0)
            _o["approval_chain"] = _o.get("approval_chain") or \"\"""",
  """        _o = r.get("order") if isinstance(r, dict) else None
        if _o is not None:
            # v686：业务员的**显示名**（与采购详情 `handler_name` 同一纪律：内部 id 不流到界面）。
            #   缺值 ⇒ 空串 ⇒ 界面显示 `—`，不编名字。
            try:
                _hk = str(_o.get("handler") or "").strip()
                _o["handler_name"] = _creator_names([_hk]).get(_hk, "") if _hk else ""
            except Exception as _e:
                logging.getLogger("hergent").warning(f"[psi] 销售详情 handler_name 解析失败: {_e}")
            _o["approval_node"] = int(_o.get("approval_node") or 0)
            _o["approval_chain"] = _o.get("approval_chain") or \"\"""")

# ─────────────────── 5) routers/platform.py ───────────────────
P("routers/platform.py", "GET /users 投影 department_id",
  """        rows = [dict(r) for r in con.execute(
            "SELECT id,username,display_name,role,roles,is_active FROM users").fetchall()]""",
  """        # v686：补 `department_id` —— 「业务员部门」配置卡的唯一数据源（与建单页
        #   `refs?kind=users` 同源：都是主库 users.department_id）。
        rows = [dict(r) for r in con.execute(
            "SELECT id,username,display_name,role,roles,is_active,department_id FROM users").fetchall()]""")

# ─────────────────── 6) server.py ───────────────────
P("server.py", "新增 PUT /api/users/{uid}/department",
  """@app.get("/api/users")
def list_users(request: Request):""",
  '''@app.put("/api/users/{uid}/department")
async def set_user_department(uid: int, request: Request):
    """改账号的**所属部门**（v686）。

    🔴 为什么必须有这个写端：进销存建单页选中「业务员」后要自动带出部门（老板口径
       2026-10-25），而 `users.department_id` 这一列**此前没有任何写入口** ——
       生产 27 个账号全是 0 ⇒ 带出功能会 100% 落到「这个人没设部门」的提示分支，
       功能等于永远不生效。没有写端的读字段就是死字段。
    ⚠️ 只写主库 `users.department_id`（业务员下拉与它同源），**不动** `hr_employees`：
       两表是**不同编号**（users id=2=张俊峰 / hr_employees id=2=符号），
       混用会让「同一个人」在两张表里对不上，且零报错。
    ⚠️ `department_id=0` 表示**清空**（不指定），不是"总部"（总部是 1）。
    """
    u = _assert_user_manageable(request, uid)
    d = await request.json()
    try:
        did = int((d or {}).get("department_id") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "部门编号必须是数字")
    if did < 0:
        raise HTTPException(400, "部门编号不能是负数")
    from core import _master_db
    conn = _master_db()
    try:
        if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            raise HTTPException(404, "账号不存在")
        if did and not conn.execute(
                "SELECT 1 FROM departments WHERE id=? LIMIT 1", (did,)).fetchone():
            raise HTTPException(400, "部门不存在，请先在部门设置里建好再分配")
        conn.execute("UPDATE users SET department_id=? WHERE id=?", (did, uid))
        conn.commit()
    finally:
        conn.close()
    try:
        db.audit_log(u.get("username") or "", f"修改账号所属部门 {uid} -> {did}", "auth", str(uid))
    except Exception:
        pass
    return {"success": True, "id": uid, "department_id": did}


@app.get("/api/users")
def list_users(request: Request):''')


def main():
    # 先全量校验，再统一落盘 —— 中途失败不留半截状态（后端不在 git，回滚靠 .bak）
    hits = []
    for f, desc, old, new in PATCHES:
        path = os.path.join(ROOT, f)
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        n = src.count(old)
        if n != 1:
            print(f"❌ 命中 {n} 次（要求 1）：{f} :: {desc}")
            if n > 1:
                print("   old 片段：", old[:120].replace("\n", "\\n"))
            return 2
        hits.append((f, desc, old, new))
    print(f"✅ 全部 {len(hits)} 处片段均已精确定位（命中 1 次）")
    if DRY:
        print("（--dry-run，未写盘）")
        return 0

    by_file = {}
    for f, desc, old, new in hits:
        by_file.setdefault(f, []).append((desc, old, new))
    for f, items in by_file.items():
        path = os.path.join(ROOT, f)
        shutil.copy2(path, f"{path}.bak-v686-{STAMP}")
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        for desc, old, new in items:
            src = src.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(src)
        print(f"  ✍️ {f}（{len(items)} 处）→ .bak-v686-{STAMP}")

    import py_compile
    bad = 0
    for f in by_file:
        try:
            py_compile.compile(os.path.join(ROOT, f), doraise=True)
            print(f"  ✅ 语法 OK：{f}")
        except Exception as e:
            bad += 1
            print(f"  ❌ 语法错：{f} :: {e}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
