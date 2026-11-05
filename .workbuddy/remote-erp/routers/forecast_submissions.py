"""
Forecast Submissions Router — 预报订单小程序（v107）

员工（业务员/促销员/导购/分销商）在小程序填报预报单 → 落库
→ 文员/老板在汇总总表跨角色聚合。多租户由连接层隔离，多角色由 user.role + employee_stores 范围控制。
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from core import _auth, _admin
import erp_db as db
import logging
# v213：数量录入判据的**唯一实现**（见 db/queries/forecast_rules.py）。
# 两个写入口（`POST ""` 小程序 / `POST /save-matrix` Web）**都调这里**，
# 前端经 `GET /validation-spec` 取同一份规则与同一份文案 —— 口径不再各写一套。
from db.queries import forecast_rules as fr
# v247：报单「列头（门店名）」的唯一实现（见 db/queries/report_column.py）。
# 与 Excel 导入同源（导入模板列名 = report_alias），否则同一个门店会因两条写路径口径不同
# 而在汇总表裂成两列（用户 2026-09-22 报障：配了「东津」却多出「永辉东津店」列）。
from db.queries.report_column import report_column_name
# v7xx（2026-10-30）报单汇总表「客户列顺序」（老板指定顺序，见该模块 docstring）
from db.queries import forecast_unit_order as fuo

router = APIRouter(prefix="/api/forecast-submissions", tags=["forecast-submissions"])

# ---- 报单汇总可见 / 关单后授权改单 的角色白名单（v267 建立，v305 起身兼两职）----
# 🔴 **本元组是唯一权威。** 前端镜像在 `hergent-cn-v2/src/constants/roles.js::FORECAST_SUMMARY_ROLES`，
#    两侧由 `.workbuddy/tools/role-registry-consistency-check.py` 做 AST 一致性校验。
#    ⚠️ 之所以把它从函数体内联元组**提成模块级常量**：护栏用 AST 解析，内联在函数里的
#      字符串元组护栏看不见 —— 看不见就等于没有护栏，两侧必然漂移。
# 🔴 为什么这个白名单必须存在（不是多余的限制）：`/api/forecast-submissions/summary` 返回的是
#    **全公司跨门店的报单汇总**，业务员/员工不该看到别家门店的量。而 `/api/forecast-submissions`
#    整个前缀在 `server.py::_PATH_MODULE_MAP` 里映射的是 `data` 模块 —— 业务员**持有** `data`
#    ⇒ 中间件的模块级门禁拦不住他，必须在**这里**按角色拦。
# ⚠️ 判据是**主角色单值**（`users.role`），不是 `core.user_roles()` 的并集：
#    兼任了 boss 的业务员在这条路上仍会被拒。这是 `core.py::user_roles` 注释里点名的
#    「9 处按单值 role 判断的地方」之一 —— 要放开兼任属于**业务决定**，别顺手改成并集。
#
# 🔴 v333（2026-09-30）**加 `accountant`（财务/文员）** —— 老板原话：「财务/文员需要导出
#    舟谱订单模版，需要填达成填报，所以要默认给财务/文员 预报订单管理 和 返利与目标 权限」。
#    ⚠️ 只加 `core._DEFAULT_PERMS['accountant']` 的 `data` **不够**：`/forecast` 的可见性是
#       **两轴取交集** —— `module:'data'` ∧ `roles: FORECAST_SUMMARY_ROLES`（前端
#       `pages.js` 那一行），后端这里是同一批人的权威名单 ⇒ 不同步改就会出现
#       「入口没有、接口也 403」与「模块给了却看不见页」两种假象。
#
# 🔴 **本元组身兼两职，加人 = 两个能力一起给**（v305 起）：
#     ① 第 560 行 `submission_summary()` —— 看**全公司跨门店**的报单汇总；
#     ② 第 905 行 `save_matrix` 的 `_allow_closed` —— **期次关闭后授权改单**。
#   本批加会计是**有意**连带第 ② 条，且与 v305 的用户原话吻合：「关单后要支持主管 /
#   **文员**等有 web 端权限的人能够改单」—— 当时名单里只有 admin/boss/supervisor，
#   「文员」那一半一直空着，本批补齐。
#   ⚠️ 若日后要「让会计看汇总但**不许**改单」，唯一正确做法是**拆成两份名单**（并按
#      纪律同步前端镜像与护栏），**不能**靠"只加模块不加名单"糊过去（那样只会造假期入口）。
#
# ⚠️ 「关闭 = 停止销售报单」的语义**不变**：`sales` / `staff` 仍不在名单里，而他们走的是
#    小程序 `POST /api/forecast-submissions`（那条路**没开**这个口子）。会计的登录端是
#    `web`（`core.ROLE_LOGIN_SCOPE`）⇒ 拿不到小程序入口，报单链路对他照样不通。
# ⚠️ 前端镜像 `roles.js::FORECAST_SUMMARY_ROLES` 必须同步（AST 护栏会逐项比对）。
SUMMARY_ROLES = ("admin", "boss", "supervisor", "accountant")


def _violations_400(violations):
    """400 + 违规清单（数量录入不合法）。

    🔴 **必须用 `JSONResponse` 直接返回，不能 `raise HTTPException(400, {...})`。**
       全局异常处理器 `core.register_exception_handler::http_exception_handler` 对 dict detail
       **只取 `error` / `detail` / `error_code` 三个键**，其余键（含 `violations`）会被**静默丢弃**
       ⇒ 前端只拿到一句话，拿不到 `{row, col}`，也就点不到那一格 —— 而「点一行跳到那一格」
       正是本次「两端同源」要拿到的东西。
       既有范式同 `routers/rebate_rules.py`（422 带 errors / 409 带 conflicts 都走 JSONResponse）。

    信封字段与 `core.error_envelope` **逐字对齐**（ok/success/data/detail/message/error/code）：
    前端 `api()` 读 `data.detail || data.message || data.error`，并把整个响应体挂到
    `err.payload`（client.js:237）⇒ 上层可 `e.payload.violations` 取清单。
    `detail` 里带**首处**的行列与原因：不用渲染清单的调用方（curl / 小程序 toast）也能拿到可行动信息。
    """
    n = len(violations)
    first = violations[0]
    msg = "共 %d 处录入不合法（首处：第 %d 行「%s」%s）" % (
        n, first.get("row") or 0, first.get("col") or "", first.get("msg") or "")
    return JSONResponse(status_code=400, content={
        "ok": False, "success": False, "data": None,
        "detail": msg, "message": msg, "error": msg, "code": 400,
        "violations": violations,
    })


def _user_label(uid):
    """user_id → 显示名（主库 users 表）。查不到就回退「员工N」——不抛错、不阻塞。"""
    try:
        uid = int(uid or 0)
    except (TypeError, ValueError):
        return ""
    if uid <= 0:
        return ""
    try:
        from core import _master_db
        conn = _master_db()
        try:
            row = conn.execute("SELECT display_name FROM users WHERE id=?", (uid,)).fetchone()
            if row and row["display_name"]:
                return str(row["display_name"])
        finally:
            conn.close()
    except Exception:
        pass
    return "员工%d" % uid


def _conflict_409(cur, base_rev):
    """409 + 并发冲突信息（乐观锁）。

    同 `_violations_400` 的纪律：**必须 `JSONResponse` 直接返回** —— 全局异常处理器对 dict
    detail 只保留 error/detail/error_code，`conflict` 子对象会被静默丢弃，前端就没法弹
    「谁在什么时候改的」对话框，只剩一句无从下手的话。

    文案口径（给不懂技术的经销商老板看）：
      · 说清**发生了什么**（本期数据被别人改过）；
      · 说清**我的改动怎么了**（没保存，不是"保存失败"——"失败"听起来像系统坏了）；
      · 给**两个出口**（重新载入看对方的 / 坚持覆盖）由前端按钮承接，后端只报事实。
    """
    who = _user_label(cur.get("by_uid")) or "其他人"
    at = (cur.get("at") or "").strip()
    when = ("（%s）" % at) if at else ""
    msg = ("本期数据在你打开之后已被 %s%s 修改过，为避免覆盖对方的改动，"
           "这次保存没有执行。请重新载入查看最新数据，或选择用你这份覆盖。") % (who, when)
    return JSONResponse(status_code=409, content={
        "ok": False, "success": False, "data": None,
        "detail": msg, "message": msg, "error": msg, "code": 409,
        "conflict": {
            "by": who, "at": at, "by_uid": int(cur.get("by_uid") or 0),
            "base_rev": base_rev or "", "current_rev": cur.get("rev") or "",
            "items": int(cur.get("items") or 0),
        },
    })


@router.post("")
async def create_submission(request: Request):
    """员工提交预报单：{store:{id,name}, note, items:[{product_id, product_name, spec, unit, quantity}]}

    安全修复（2026-08-22 审核）：
    - role 以 token 校验后的 u['role'] 为准，忽略客户端传入（防伪造）
    - price 由后端按 product_id 查 products 表，忽略客户端传入（防篡改/防泄露进价）
    - JSON 解析失败返回 400

    v213（2026-09-20）：**数量判据改为走唯一实现** `db/queries/forecast_rules.py`。
    改前本入口自带「上限 10000」、且「非数字 / 负数」是 `continue`（**静默跳过**）——
    同一个 `POST /save-matrix` 无上限、前端 999999、小程序 99999，四处四个答案。
    现在：非数字 / 非整数 / 负数 / 超上限一律 **400 + violations 清单**（与 Web 端同判据），
    不再静默丢弃（静默丢弃的最坏形态是「用户以为报上去了」）。`0` 仍是「未填」而非错误。

    v224（2026-09-21）：**键与覆盖语义改造**（用户拍板「一家门店一个期次只能有一单，
    在期次关闭前都可以修改」）：
      · 幂等键去掉 `user_id` ⇒ 键 = (store_id, period_id)：同店同期次**只留一条单**
        （原来两人各报一次会真存两条、汇总翻倍）；
      · 覆盖改为**原位替换**（`forecast_submission_replace`）⇒ **单号不变**；
      · 返回值新增 `created`（true = 新建 / false = 更新），供结果卡区分
        「已提交」与「已更新这一单」。
    """
    u = _auth(request)
    try:
        d = await request.json()
    except Exception:
        raise HTTPException(400, "请求体格式错误")
    if not isinstance(d, dict):
        raise HTTPException(400, "请求体格式错误")
    items = d.get("items") or []
    if not items:
        raise HTTPException(400, "预报单不能为空")

    # ---- B1 修复：门店越权校验（安全） ----
    # 客户端传来的 store.id 必须属于该员工可报范围，否则可伪造/误报任意门店污染汇总。
    # 服务端门店名以员工授权范围为准，不信任客户端传入的 name。
    #
    # 🔴 v294（2026-09-27）：校验与落库的键由「门店号」升级为 **(门店号, 类型)**。
    #    背景：`store_id` 是**跨域**数字列 —— 门店行装 `contacts.id`、本人仓行装
    #    `warehouses.id`，两个 id 空间独立自增 ⇒ 「门店 5」与「仓库 5」是不同对象。
    #    只比数字会让：① 被授权「门店 5」的人能报「仓库 5」（越权）；
    #                  ② 同一期次里两单的幂等键相同而**互相覆盖**（静默丢单）。
    #    这正是用户提出的「客户 ID 前加 ZT、仓库 ID 前加 DB」要解决的问题；
    #    这里用显式类型轴表达同一件事，等价但不动 `store_id` 的类型（改类型要动所有读端）。
    store_raw = d.get("store") or {}
    try:
        store_id = int(store_raw.get("id") or 0)
    except (TypeError, ValueError):
        store_id = 0
    # 缺省 'store'：老版小程序不带 `kind`，行为与改动前**逐字一致**。
    # `_kind_given` 把「老客户端（根本没有 kind 表达能力）」与「新客户端明确传了 store」
    # 区分开 —— 前者在下方授权校验里走一次**无歧义兜底**，否则升级期会出现
    # 「下拉里看得见『刘小顶仓』、一点提交就 403」这种看得见点不通的坏体验。
    _kind_given = bool(str(store_raw.get("kind") or "").strip())
    store_kind = db._norm_store_kind(store_raw.get("kind"))
    # 2026-09-15 / v317：主体解析改走**唯一实现** `report_subject_of`（员工 或 外部客户）。
    # 🔴 它解出的主体是**门店越权校验**的依据，而这个位置已栽过两次同类跟头：
    #    ① 原实现只读 `employee_code`：某账号只有 `employee_id` 而 code 为空 → 解出 0 →
    #       下方整段跳过 ⇒ **授权校验静默失效（fail-open）**；
    #    ② v317 之前，外部客户（分销商）账号 `employee_id` 恒 0 ⇒ **同样整段跳过** ——
    #       客户可以绕过小程序直调 API，往本租户**任意门店**报单（越权 + 污染汇总）。
    #    两次的病根同一个：**「谁是报单人」没有唯一答案**。现在读端（`/stores`、`/my`）
    #    与写端门禁（这里）共用同一份判据，不会再各分叉一次。
    _subj_kind, _subj_id = db.report_subject_of(u)
    if store_id <= 0:
        raise HTTPException(400, "请选择有效的报单对象")
    store_name = str(store_raw.get("name") or "")
    if _subj_kind:
        allowed = db.report_subject_stores(_subj_kind, _subj_id) or []
        # 键必须是二元组 —— `employee_stores_get` 的每一项都带 kind（门店 / 本人仓）。
        allowed_map = {(int(s.get("id") or 0), db._norm_store_kind(s.get("kind"))): s.get("name")
                       for s in allowed}
        # 🔴 v294 升级期兜底（**只对没有 kind 表达能力的老客户端生效**）：
        #    `employee_stores_get` 现在会把「本人仓」一并列出来，而没升级的小程序 / 直接
        #    调 API 的客户端**传不出 kind** ⇒ 若直接 403，用户看到的是
        #    「入口就在下拉里、一点提交就失败」—— 看得见点不通，比不显示更坏。
        #    这里只在**不存在歧义**时纠偏：缺省口径不匹配、且另一口径**正好**匹配。
        #    当前数据（门店 id 2214+ / 仓库 id 1–10，区间不重叠）语义唯一；
        #    将来真出现同号对象时两个口径**都在** map 里 ⇒ 本分支不命中，如实 403，
        #    **不会静默报到另一个对象上**（那比 403 更坏）。
        #    ⚠️ 新客户端一律显式带 kind ⇒ 走精确匹配，永不进本分支。
        if not _kind_given and (store_id, store_kind) not in allowed_map:
            _alt = "warehouse" if store_kind == "store" else "store"
            if (store_id, _alt) in allowed_map:
                store_kind = _alt
        if (store_id, store_kind) not in allowed_map:
            raise HTTPException(403, "无权向该对象报单（不在你的报单范围）")
        # 服务端优先取授权范围里的名字；仅「解析出了报单主体」时进入本分支。
        # 最终列名口径在下一段按报单配置简称收敛。
        store_name = allowed_map.get((store_id, store_kind)) or store_name
    # v247：汇总表的**列名**以「报单配置」的简称(列头)为准。
    # 上面取到的是 contacts.name（档案全称），而汇总表列头是 store_name 的**全历史去重名册** ——
    # 用全称落库会与「Excel 导入」（写的是配置简称）**裂成两列**且永不自动合并
    # （用户 2026-09-22 报障）。取不到配置时原样回退，行为与改动前一致。
    # ⚠️ v294：必须带上 `store_kind` —— 否则「本人仓 5」会取到「门店 5」的简称（撞号）。
    store_name = report_column_name(store_id, store_name, store_kind)
    store = {"id": store_id, "name": store_name, "kind": store_kind}

    # ---- v213 数量判据门禁（与 Web 端 `save_matrix` **同一份判据**） ----
    # 位置：**门店授权之后、期次解析之前**。顺序理由是语义：
    #   ① 授权先于数据（`store_id` 越权是 403，比「数量填错」更该先答）；
    #   ② 数据形状先于业务窗口（期次解析要查库，脏载荷没必要先花两次查询）。
    # 影响面已核实：小程序 `fill.js:612` 恒带 `product_name: c.name`、数量走 `/\d+/` 正则
    # 且封顶 99999 ⇒ 正常路径**产生不出**任何违规（负数/非整数/非数字/超限都进不来）。
    # 会撞上这条的只有「绕过前端直调 API」——那时给 400 明显优于静默丢格。
    _rules = fr.get_rules()
    _violations = fr.violations_for_items(items, _rules)
    if _violations:
        return _violations_400(_violations)

    # ---- v219：建表前置（新租户空库的第一个写路径） ----
    # 本入口是**小程序报单**的唯一写路径，很可能是新租户库建成后的**第一个**请求
    # （v218 已确认：新租户建库只灌 6 条币种，预报相关的表全部靠惰性建表）。
    # 而 `_ensure_forecast_tables` 此前只在 `forecast_submission_create._insert` 里调
    # （erp_db.py:16844）—— **在它之前**本函数已经读了三张表：期次（下方 172/180 行）
    # 与幂等判重（198 行 `SELECT ... FROM forecast_submissions`）⇒ 空库上直接
    # `no such table` ⇒ **500**，用户看到的是"服务器坏了"，而不是"请先创建期次"。
    # 先建后读即可；`_ensure_forecast_tables` 幂等且不抛异常（与 wastage_tracker 同范式），
    # 故这里**不包 except** —— 包了反而会把真正的建表失败吞成更难查的后续错误。
    with db.get_db_tx() as _c:
        db._ensure_forecast_tables(_c)

    # ---- 期次解析（小程序报单对齐到货窗口，A+B 方案） ----
    # 规则：
    #  1) 显式传 period_id：校验「开放 + 今天在窗口内」，order_date 取期次 order_start；
    #  2) 未传 period_id：后端自动取「今天开放窗口内」的期次（forecast_open_periods 第一条）。
    #     —— 取到则用其 order_start；取不到则【硬报错】，不再静默回退"今天"（B 锁死）。
    # 安全：order_date 一律由服务端按校验过的期次推导，不信任客户端传入的日期。
    # ⚠️ v224：`uid` 曾在这里解出（供 v158 幂等键 `user_id=?` 使用）。键去掉 user_id 之后
    #    它在本函数内已无消费方 —— 留着就是"看起来还在按人判重"的误导 ⇒ 一并删掉。
    from datetime import date as _date
    od = _date.today().isoformat()
    _period_id = d.get("period_id") or 0
    try:
        _period_id = int(_period_id)
    except (TypeError, ValueError):
        _period_id = 0
    if _period_id > 0:
        _p = db.forecast_period_get(_period_id)
        if not _p:
            raise HTTPException(400, "所选报单期次不存在，请下拉刷新后重选")
        if _p.get("status") != "open":
            # v224：与 Web 端口径对齐（v219 起「定稿」= 关闭期次）。给用户的是**下一步动作**
            # （找管理员重开本期），而不是一句"不可用"——后者听起来像系统坏了。
            # 这也是用户拍板「期次关闭前都可以修改」的另一面：关闭之后**不能再改**。
            raise HTTPException(400, "本期已定稿（关闭），不能再报单；如需改动请联系管理员重开本期")
        if not (_p.get("order_start", "") <= od <= _p.get("order_end", "")):
            raise HTTPException(400, "该报单期次当前不在开放报单时间内")
        od = _p.get("order_start")
    else:
        # B 锁死：无开放窗口期次时禁止报单，彻底杜绝"落到错误日期/今天"的后门
        _opens = db.forecast_open_periods()
        if not _opens:
            raise HTTPException(400, "当前没有开放的报单期次，请联系管理员在 Web 端创建后再报单")
        _p = _opens[0]  # 多个开放期次时取最早开始的一个（按 order_start 升序）
        od = _p.get("order_start")
        # 2026-09-15：此前未同步 _period_id（恒为 0）→ 下方幂等判重拿不到期次键。
        _period_id = int(_p.get("id") or 0)
    # ---- B4/v224 幂等：**同【门店】同【期次】仅一条预报**（用户 2026-09-21 拍板） ----
    # 用户原话：「一家门店一个期次只能有一单，但在这期期次关闭之前都可以修改。」
    #   · v224 键改造：由 (user_id, store_id, period_id) **去掉 user_id** ⇒ 键 = (store_id, period_id)。
    #     原来带 user_id 的后果：同店同期次由**两个人**各报一次会**真存两条单**、汇总翻倍 ——
    #     而业务上一家店只有一个答案，「两个人各报一份」是没有意义的中间态。
    #   · 覆盖 = **原位替换**（下方 `_prev_sub_id` 分支调 `forecast_submission_replace`）
    #     ⇒ **单号不变**，「同一单被修改」在数据上成立，用户可对外一直引用同一个单号。
    # 重复提交=覆盖更新，避免汇总总量被叠加放大；已审批通过（历史数据）则禁止覆盖。
    # ⚠️ v158：本块**只校验、不删数据** —— 落库推迟到「新明细校验通过之后」（见下方 _prev_sub_id）。
    # 原实现是「先删旧单 → 再校验新单」：一旦新提交整单被拒（停售商品 / v158 未录进价），
    # 旧单**已经删掉**、用户却只收到 400 → 上一次的报单被静默清空且无从恢复。
    # 2026-09-13 实测复现（同店同日：OFF 态提交成功 → ON 态整单被拒 → 该商品明细数 2→1）。
    # 2026-09-15：键由 (user_id, store_id, order_date) 改为 (user_id, store_id, period_id)。
    #   原键的漏洞：order_date 由期次 order_start 推导，当两个期次 order_start 相同时
    #   （如 9/8~9/14 与 9/8~9/11 并存），后报的一期会静默**覆盖**前一期，而不是各存一条。
    #   双口径：period_id=0 的历史行仍按 order_date 比对（与 /summary 的归属口径同源）。
    # ⚠️ 撤回（recall）是 `UPDATE status='recalled'`、**不删行** ⇒ 撤回后重新报单会命中那条行；
    #    `forecast_submission_replace` 里**必须把 status 复位为 pending**，否则新单继承「已撤回」
    #    ⇒ 不计入本期汇总，而用户看到的是「提交成功」（静默失效）。
    # ⚠️ 占位符顺序必须与 SQL 中出现顺序一致：store_id → period_id → order_date。
    with db.get_db_tx() as conn:
        row = conn.execute(
            "SELECT id, status FROM forecast_submissions "
            "WHERE store_id=? AND store_kind=? "
            "AND (period_id=? OR (period_id=0 AND order_date=?)) "
            "ORDER BY id DESC LIMIT 1",
            (store_id, store_kind, _period_id, od),
        ).fetchone()
    if row and row["status"] == "approved":
        # 2026-09-07：审批流下线后不会再新产生 approved，此处仅兜底历史数据
        raise HTTPException(409, "该期次该门店预报已定稿，如需修改请联系管理员")
    _prev_sub_id = int(row["id"]) if row else 0

    # ---- 明细清洗（后端权威 price，忽略客户端传入） ----
    cleaned = []
    price_map = {}
    # 2026-09-12（用户选 2b：报单侧禁止停用商品）：把已停售明细挡在写库之前。
    # 背景：汇总表行严格来自商品主档（is_active=1），若允许停售商品落库，
    # 这笔报单在 Web 端「本期预报」永远不显示，被误判为「没同步」。
    # inactive_pids 由下方主档查询填充；active_checked 为 False 时（老库缺 is_active 列 /
    # 连接异常）一律不剔除，宁可放行也不误杀整单。
    inactive_pids = {}
    dropped_inactive = []
    active_checked = False
    # v158 进价闸门（与报单导入共用同一条判据 db.factory_price_verdict）：
    #   开启时，**档案没录进价**的商品明细一律拒收 —— 小程序侧业务员无法填进价，
    #   所以判据的「行内进价」恒为空，实际就是看档案。不拦的话这笔报单定稿后
    #   会在「本期需付款」里回退估算 → 付款额不准（历史事故类型）。
    #   v165：回退链条已改为「进价 → 标准售价」两档（v226 起 factory_price / purchase_price 视为同一列），
    #         故闸门判据同步取「进价有值即放行」，不再只看 factory_price。
    #   关闭时 fp_gate_on=False → 下面整段判据不执行，行为与上线前完全一致。
    fp_gate_on = db.factory_price_gate_enabled()
    no_fp_pids = {}
    dropped_no_fp = []
    # v215（2026-09-20）：**报单商品必须属于本期清单**。
    # 用户拍板：「报单商品的判定基准不是商品档案，因为商品档案中的商品并非每一个都需要
    # 报单（例如很多赠品就不需要报单）。因此应该以每一期次内实际包含哪些商品作为报单的
    # 基准。」且要求小程序与 Web 端的商品数量与顺序逐项一致。
    # 🔴 为什么**展示层对齐堵不住、必须在这一层再拦一次**：
    #   小程序已按本期清单铺开商品，但下面两条既有路径会绕过展示层把**上一期**的商品带进来：
    #     ·「一键带入上次报单」（跨期沿用，fill.js::applyLastOrder）；
    #     ·「切期次后仍在的购物车」（fs_cart_<storeId> 是跨期次持久化的）。
    #   不拦就会把本不该在本期出现的商品写进汇总表 —— 且它是"静默正确"的，没人会发现。
    # ⚠️ fail-open：`scope_pids` 为空（该期还没导入清单 / 登记表未建 / 期次非法）时
    #   **不过滤**，行为与上线前完全一致 —— 否则「还没配清单的期次」会突然整单报不了单。
    scope_pids = set()
    dropped_out_of_scope = []
    # 判据来源：`db.forecast_period_product_ids`（与小程序的商品铺开**同一函数**，
    # 禁止在此手写第二条 SQL —— 否则会出现"小程序显示属于本期、提交说不属于"）
    if _period_id > 0:
        try:
            scope_pids = db.forecast_period_product_ids(_period_id) or set()
        except Exception:
            scope_pids = set()
    # B2 修复：product_id 转换包 try，跳过非法明细，避免 500
    pids = []
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            pid = int(it.get("product_id") or 0)
        except (TypeError, ValueError):
            continue
        if pid > 0:
            pids.append(pid)
    if pids:
        try:
            with db.get_db() as conn:
                ph = ",".join(["?"] * len(pids))
                for r in conn.execute(
                    f"SELECT id, name, sale_price, purchase_price, is_active, factory_price, "
                    f"{db.factory_price_sql('products')} AS fp_eff "
                    f"FROM products WHERE id IN ({ph})", pids
                ).fetchall():
                    price_map[r["id"]] = float(r["sale_price"] or r["purchase_price"] or 0)
                    # is_active 为 NULL 视为在售（与 /products/fill-search 的口径一致）
                    if r["is_active"] is not None and int(r["is_active"]) != 1:
                        inactive_pids[r["id"]] = r["name"] or ""
                    # v158：进价判据走唯一核心 factory_price_verdict（行内价恒 0 —— 小程序没有进价列）
                    # v165：档案侧取 fp_eff（`factory_price` 优先，缺则取 `purchase_price`），
                    #       与付款额 / 补价计数**同源**（唯一实现 `db.factory_price_sql`）。
                    #       改前只取 `r["factory_price"]` ⇒ 真实租户 269/269 全空 ⇒ 一开闸全拒。
                    if fp_gate_on:
                        _eff, _ = db.factory_price_verdict(0, r["fp_eff"])
                        if _eff <= 0:
                            no_fp_pids[r["id"]] = r["name"] or ("#" + str(r["id"]))
                active_checked = True
        except Exception:
            active_checked = False

    # ── v765：品牌报单日管控（第二道闸，前端禁用之外的后端兜底）──
    #   🔴 刻意**不**把 brand 塞进上面那条主档 SELECT：那条一旦因缺列抛错，会被
    #      `except: active_checked = False` 吞成「全部放行」**且 price_map 全空**
    #      ⇒ 明细价格静默变 0 落库（比拦不住严重得多）。这里单独一条查询、单独兜底。
    #   🔴 取不到品牌 / 判定异常 ⇒ 放行（fail-safe 方向与内核一致：宁可漏拦，不可误伤全员）。
    dropped_brand_locked = []
    brand_map = {}
    _bw_brands = {}
    try:
        from domain.brand_order_window import (
            period_brand_windows, normalize_brand as _brand_label)
        _bw_brands = (period_brand_windows(_period_id if _period_id > 0 else None)
                      or {}).get("brands") or {}
    except Exception as e:
        logging.getLogger("hergent").warning(
            "[submit] 品牌报单日判定不可用（按全放行）: %s", e)
        _bw_brands = {}
    if _bw_brands and pids:
        try:
            with db.get_db() as conn:
                ph = ",".join(["?"] * len(pids))
                for _r in conn.execute(
                    f"SELECT id, COALESCE(NULLIF(TRIM(brand),''),'') "
                    f"FROM products WHERE id IN ({ph})", pids
                ).fetchall():
                    brand_map[_r[0]] = _r[1] or ""
        except Exception as e:
            # 读不到品牌就判不了 —— 直接关掉这道闸，并留下日志（不静默）
            logging.getLogger("hergent").warning(
                "[submit] 商品品牌读取失败，本轮跳过品牌闸门: %s", e)
            _bw_brands = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        # v213：改用**唯一解析器**取数（不再自己写 `int(...)`）。
        # 为什么不能各写一份：「解析」与「判定」一旦是两个实现，就会出现
        # 「判据说 12、取数说 0」——旧代码正是 `int("12箱")` 抛 ValueError → `continue`
        # → 用户以为报上去了、实际那一格被静默丢掉（本轮修的原缺陷之一）。
        qty, _bad = fr.normalize_qty(it.get("quantity"))
        if _bad:
            # 前面整单已拦；此处仅防御（日后判据被改宽也不会退化成静默丢弃）
            continue
        if qty <= 0:          # 0 = 未填（稀疏报单），不是错误
            continue
        try:
            pid = int(it.get("product_id") or 0)
        except (TypeError, ValueError):
            continue
        if pid <= 0:  # B2 修复：丢弃无有效商品 ID 的明细
            continue
        # v215：**先判「是否属于本期」**，再判停售 —— 顺序有意如此：一个商品若根本
        # 不在本期清单里，说它"已停售"可能是错的（也可能它就是在售、只是本期不报），
        # 会给用户指错方向。
        if scope_pids and pid not in scope_pids:
            dropped_out_of_scope.append(str(it.get("product_name") or f"#{pid}")[:50])
            continue
        # v765：品牌不在本期报单日 —— 剔除并记账（不落库）。
        #   🔴 必须放在「不属于本期」**之后**：一个根本不在本期清单里的商品，
        #      若先被告知「每周X才能报」，业务员会去等那一期 —— 等到了依然报不了。
        #   ⚠️ 用 `is False` 严格比较：`orderable` 若被写成字符串 "false"，
        #      truthy 判断会当成可报，闸门静默失效。
        if _bw_brands:
            _win = _bw_brands.get(_brand_label(brand_map.get(pid, ""))) or {}
            if _win.get("orderable") is False:
                dropped_brand_locked.append((
                    str(it.get("product_name") or brand_map.get(pid) or f"#{pid}")[:50],
                    _win.get("tip") or "",
                ))
                continue
        # 停售商品直接剔除并记账，前端据此提示用户（不落库 → 不会产生 Web 端看不见的脏数据）
        if active_checked and pid in inactive_pids:
            dropped_inactive.append(inactive_pids.get(pid) or f"#{pid}")
            continue
        # v158：进价闸门开启时，档案没录进价的商品同样剔除并记账（同上，不落库）
        if fp_gate_on and pid in no_fp_pids:
            dropped_no_fp.append(no_fp_pids.get(pid) or f"#{pid}")
            continue
        price = price_map.get(pid, 0.0)
        cleaned.append({
            "product_id": pid,
            "product_name": str(it.get("product_name") or "")[:100],
            "spec": str(it.get("spec") or "")[:50],
            "unit": str(it.get("unit") or "件")[:10],
            "quantity": qty,
            "price": price,
            "amount": round(qty * price, 2),
        })
    if not cleaned:
        # v215 优先给「不在本期」的提示 —— 这是整单被拒时最可能、也最容易被误解的成因
        if dropped_out_of_scope:
            names = "、".join(dropped_out_of_scope[:3])
            raise HTTPException(
                400,
                f"所选商品不在本期的报单清单里：{names}"
                f"{' 等' if len(dropped_out_of_scope) > 3 else ''}。"
                "请以填报页列出的商品为准；如确需报单外商品，"
                "请管理员先在电脑端【预报订单管理 → 导入模板】把该商品加入本期"
            )
        if dropped_brand_locked:
            # v765：整单都卡在品牌报单日上 —— 必须把「周几能报」说清楚，
            #   否则业务员只看到「不能报」，会一直重试或去问内勤。
            names = "、".join(n for n, _t in dropped_brand_locked[:3])
            tip = next((t for _n, t in dropped_brand_locked if t), "")
            raise HTTPException(
                400,
                f"所选商品本期不可提报：{names}"
                f"{' 等' if len(dropped_brand_locked) > 3 else ''}。"
                + (tip or "该品牌本期不在报单日")
            )
        if dropped_inactive:
            names = "、".join(dropped_inactive[:3])
            raise HTTPException(400, f"所选商品已停售：{names}{' 等' if len(dropped_inactive) > 3 else ''}，请移除后再提交")
        # v158：整单都因缺进价被拒时，给**可操作**的提示（告诉业务员找谁、去哪补）
        if dropped_no_fp:
            names = "、".join(dropped_no_fp[:3])
            raise HTTPException(
                400,
                f"所选商品未录进价：{names}{' 等' if len(dropped_no_fp) > 3 else ''}。"
                "进价是厂家跟你结算的价，需由管理员在「商品档案 → 补进价」补录后再报单"
            )
        raise HTTPException(400, "所有明细数量都为 0 或商品无效")
    # ---- v158/v224 幂等落点：新明细已校验通过，**此时才动旧单** ----
    # 保证语义是「要么完整覆盖、要么原样不动」，绝不会出现「旧的删了、新的没进来」。
    # v224 起覆盖改走 `forecast_submission_replace` —— **原位 UPDATE（单号不变）**，不再是
    # 「删旧单 + 插新单」。改前的写法每覆盖一次单号就换一次 ⇒ 用户手里的「单号」在下一次提交
    # 之后就查不到了；也正因如此，当时的前端只能写「再提交会新增一单」，把"覆盖"说成了"新增"。
    # role 以服务端认证结果为准（防客户端伪造）
    role = u.get("role") or "staff"
    if _prev_sub_id:
        result = db.forecast_submission_replace(_prev_sub_id, u, role, store, cleaned,
                                                str(d.get("note") or ""), order_date=od,
                                                period_id=_p.get("id"))
        created = False
    else:
        result = db.forecast_submission_create(u, role, store, cleaned, str(d.get("note") or ""),
                                               order_date=od, period_id=_p.get("id"))
        created = True
    # AI 留痕
    try:
        db.log_workflow_advice(
            task_type="forecast_submit",
            advice_text=f"预报提交[{store.get('name', '')}]：{len(cleaned)} 个 SKU，共 {result['total_qty']} 件 ¥{result['total_amount']}",
            payload={"store": store, "count": len(cleaned)},
            summary=result,
            ai_source="miniprogram:forecast",
            user=u,
        )
    except Exception:
        pass
    return {"ok": True, "period_id": _p.get("id"), "skipped_inactive": dropped_inactive,
            "skipped_no_factory": dropped_no_fp,
            # v215：不在本期清单、被剔除的商品名（只增键，前端据此提示）
            "skipped_out_of_scope": dropped_out_of_scope,
            # v765：品牌不在本期报单日而被剔除的商品名（部分提交时前端据此提示）
            "skipped_brand_locked": [n for n, _t in dropped_brand_locked],
            # v224：本次是**新建**还是**更新**（前端结果卡据此说「已提交」/「已更新这一单」）。
            # ⚠️ 与 `result['updated']` 是同一件事的两种表达；保留 `created` 是因为它无需
            #    前端知道 replace 的内部键名，且语义是「这笔提交之前有没有单」。
            "created": created, **result}


@router.get("/open-periods")
def open_periods(request: Request):
    """小程序报单页拉取可报单期次（列表展示用）。

    2026-09-06：改用 forecast_open_periods_all() —— 列出 Web 端所有 status='open' 的期次，
    并带 in_window 标志（今天是否落在报单窗口内）。此前只返回「今天在窗口内」的期次，
    导致 Web 端显示 4 个、小程序只显示 1 个（单日窗口期次一过期就被日期过滤掉，
    但管理员未关闭、状态仍为 open）。

    注意：提交时的自动选期次仍走严格的 forecast_open_periods()（窗口内），
    且本接口返回的过期期次在提交时会被 400 拒绝，不会写脏数据。
    """
    _auth(request)
    return {"ok": True, "periods": db.forecast_open_periods_all()}


@router.get("/my")
def my_submissions(request: Request, date: str = "", limit: int = 50,
                   store_id: int = 0, store_kind: str = "store"):
    """我的提交（当前用户 + 我负责的门店 / 本人仓）。

    v227（2026-09-21 · 样单）：新增**可选** `store_id` —— 小程序「复制生成样单」用它一次取回
    「该门店报过的所有单（含明细）」，本地按期次匹配后给出「可复制的源期次」列表。
    ⚠️ 授权由 `store_ids` 天然兜住：过滤条件是「我的 OR 我负责门店的」**且** 门店号相等
      ⇒ 传别家的门店号只会查不到。不传时行为与改前**逐字一致**。

    v294（2026-09-27）：新增可选 `store_kind`（'store' 缺省 | 'warehouse'）。
    它与 `store_id` **成对**使用 —— 只按数字过滤会让「门店 5」命中「仓库 5」的单
    （见 `forecast_submission_list` 的说明）。不传 = 'store'，老小程序行为一字不变。

    v224（2026-09-21）：范围扩到「我负责的门店」。理由 —— 「一店一期一单」落地后，
    同一门店同一期次只有一条单：若甲先报、乙后来改了它（**改的资格按门店给，不按人给**），
    只按 `user_id` 过滤会让**乙看不到自己刚改过的那一单**，与他刚收到的「提交成功」
    回执自相矛盾（这正是本项目反复出现的「读端与写端作用域不是同一套数据」）。
    ⚠️ 取不到员工档案（emp_id=0）或门店范围为空 ⇒ 退回只按 user_id，**行为与改前一致**。
    ⚠️ 门店范围走 `employee_stores_get` —— 与提交时的越权校验**同一函数**，不另写一份
       （两份实现迟早分叉：一边允许报、一边查不到）。
    """
    u = _auth(request)
    store_ids = []
    try:
        # v317：走报单主体唯一实现（员工 / 外部客户）。
        _kind, _subj = db.report_subject_of(u)
        if _kind:
            # v294：**原样**传返回（含 kind），不再只取 id ——
            # 只取 id 会把「本人仓」压成裸数字，重新引入撞号问题。
            store_ids = db.report_subject_stores(_kind, _subj) or []
    except Exception:
        store_ids = []
    records = db.forecast_submission_list(int(u["id"]), order_date=date, limit=limit,
                                          store_ids=store_ids, store_id=store_id,
                                          store_kind=store_kind, role=u.get("role", ""))
    return {"ok": True, "records": records}


@router.get("/summary")
def submission_summary(request: Request, date: str = "", start: str = "", end: str = "", period_id: int = 0):
    """汇总总表：SKU+单位跨角色聚合 + 来源明细（文员/老板）。支持 date 单日，或 start~end 区间（周期视图）。

    2026-09-12：新增 period_id —— 传了就按期次号精确归属（period_id=0 的历史数据回退日期窗口），
    修复期次窗口重叠时同一笔报单被重复计入的问题。不带 period_id 时行为完全不变。
    """
    u = _auth(request)
    # 2026-09-20（收敛三处判据）：`accountant` 曾从名单里移除 —— 当时它在名单里，
    # 但 `core._DEFAULT_PERMS['accountant']` **没有 `data` 模块**、
    # 而 `/api/forecast-submissions` 整体映射 `data` ⇒ 会计在**中间件**就被 403，
    # 永远到不了这一句。于是形成「前端 APPROVER_ROLES 收会计（入口可见）+ 本名单收会计
    # + 中间件拒会计」的三处打架 —— 用户看到的是「入口在、点进去报错」的假入口。
    # 用户 2026-09-20 拍板：**会计不报单**，故当时三处统一为「会计不在名单内」。
    # ⚠️ 当时那句"若日后要让会计看汇总，正确做法是给会计加 `data`（业务决定，会一并放开
    #    `/api/products` 等宽权限），而不是只把名字加回这里" —— **本批正是照它做的**。
    #
    # 🔴 v333（2026-09-30）**会计回到名单**：本批**先**给 `_DEFAULT_PERMS['accountant']`
    #    补上 `data` + `sales`（见 `core.py` 对应注释的 v333 段），**再**加进顶部
    #    `SUMMARY_ROLES` —— 顺序不能反：先加名单后补模块，就又是 2026-09-20 那次假入口。
    #    ⚠️ 与 2026-09-20 那条决定**不矛盾**：那条讲的是「会计**不报单**」（不用小程序提交），
    #       本条讲的是「会计**看汇总 + 导出舟谱模板 + 填达成**」。会计登录端仍是 `web`，
    #       小程序报单入口对他**照样不通**（`ROLE_LOGIN_SCOPE['accountant'] = 'web'`）。
    # ⚠️ 小程序 `utils/roles.js::APPROVER_ROLES` **有意不同步**：会计登不进小程序，
    #    同步了没有任何人能感知；且改小程序代码要重新提审。两侧的差异是**有意的**，
    #    不是漏改 —— 判据见该文件那段"2026-09-20 已收敛"注释（它对小程序仍成立）。
    # 🔴 v267：名单提成模块级常量 `SUMMARY_ROLES`（本文件顶部）—— ① 让护栏能 AST 校验前端镜像；
    #    ② 前端 `Forecast.vue` / `Shell.vue` 现在也用**同一份名单**判「入口可见 + 表格可读」，
    #    这样业务员不再看到「入口在、点进去是空表 + 全灰按钮 + 一句『交叉表加载失败』」的假入口。
    #    ③ **403 文案要随名单改** —— v267 当时说"文案一字未动"是因为**名单没变**；
    #       本批名单变了，文案不改就是对被拒的人撒谎（前端 `Forecast.vue` 另有一份
    #       自己写的同类提示，同批更新）。前端判定走 `err.status`、**不解析文案**（v267 约定），
    #       故改文案不会破坏任何判据。
    if u.get("role") not in SUMMARY_ROLES:
        raise HTTPException(403, "仅管理员 / 老板 / 主管 / 财务文员可查看报单汇总")
    data = db.forecast_submission_summary(order_date=date, start_date=start, end_date=end, period_id=period_id)
    # ---- v213-B1：矩阵内容指纹（乐观锁基座）+ 最后写入人/时刻 ----
    # 前端把 `matrix_rev` 当作「我打开时看到的版本」，保存时原样回传 → 不等即 409。
    # ⚠️ 本接口被**小程序共用**（supervisor 也读汇总）⇒ 只**新增**键，绝不改/删既有键
    #    （date / rows / all_units / confirmed / imported_products 一字未动）。
    _rev = db.forecast_matrix_rev(period_id=period_id, start_date=start, end_date=end)
    data["matrix_rev"] = _rev.get("rev") or ""
    data["matrix_at"] = _rev.get("at") or ""
    data["matrix_by"] = ""   # 下方补显示名（users 在主库）
    # 补人名：users 在主库，批量查询 user_id -> display_name 映射（v108-fix: N+1 -> 批量 IN 查询）
    try:
        from core import _master_db
        conn = _master_db()
        try:
            ids = set()
            for r in data.get("rows", []):
                for s in r.get("sources", []):
                    ids.add(s.get("user_id") or 0)
            # v213-B1：指纹的最后写入人也一并解析（同一次批量查询，不额外开连接）
            _rev_uid = int(_rev.get("by_uid") or 0)
            if _rev_uid:
                ids.add(_rev_uid)
            name_map = {}
            if ids:
                # 批量查询，避免 N+1
                id_list = list(ids)
                placeholders = ",".join(["?"] * len(id_list))
                rows = conn.execute(
                    f"SELECT id, display_name FROM users WHERE id IN ({placeholders})", id_list
                ).fetchall()
                name_map = {r["id"]: r["display_name"] for r in rows}
            for r in data.get("rows", []):
                for s in r.get("sources", []):
                    s["user"] = name_map.get(s.get("user_id") or 0, f"员工{s.get('user_id') or ''}")
            # v213-B1：指纹最后写入人 → 显示名（解析不到就留空，前端只说「其他人」）
            data["matrix_by"] = name_map.get(_rev_uid, "")
        finally:
            conn.close()
    except Exception:
        pass
    return {"ok": True, **data}


@router.get("/validation-spec")
def validation_spec(request: Request):
    """数量录入的**校验规格** —— 两端唯一判据（唯一实现见 db/queries/forecast_rules.py）。

    前端（Web 交叉表）取它做三件事：
      ① 用 `qty_max` 替掉写死的 `QTY_MAX = 999999` —— 口径单源，改一处两端同时变；
      ② 用 `kinds[].msg` 渲染红框 / 悬停提示 / 查错清单 —— 「同一个错误在两端显示同一句话」
         不再靠人工对齐，而是**同一份数据**；
      ③ 用 `kinds[].k` 做分组筛选，且与后端 400 回的 `violations[].kind` **逐字同名**，
         前端才能拿 `{row, col}` 直接跳到那一格。

    任何登录用户可读：它只是一组数值与文案，不含任何业务数据（也不泄露任何门店/商品信息）。
    这条路是**纯增量**，不改变任何既有接口的载荷形状 ⇒ 小程序（与 Web 共用
    `/api/forecast-submissions/summary`）不受影响。
    """
    _auth(request)
    return {"ok": True, "spec": fr.validation_spec()}


@router.put("/validation-rules")
async def set_validation_rules(request: Request):
    """保存本租户的**数量录入规则**（老板 / 管理员）。

    为什么要有这条路（v219 打磨⑥）：`forecast_rules.set_rules()` 早就写好、
    `GET /validation-spec` 也早就把 `qty_max` 下发给前端判红框与文案，
    但**全仓没有任何 HTTP 调用方** —— 也就是这个上限实际上是「只读」的：
    租户改不了它，只能用出厂默认 99999。用户遇到「一个正常的量被拦了」时无路可走
    （记忆里挂着的「数量上限目前改不了」= 这条）。

    载荷：`{"qty_max"?: int, "name_required"?: bool}` —— **只写传进来的字段**，
          其余保持原值（同 `save_business_profile` 的判据）。
    非法值 → 400，**绝不静默截断成默认值**：静默改写上限等于「用户以为设了、其实没设」，
    比报错贵得多（见 `forecast_rules.py` 头注）。改完**留痕**（谁把上限从多少改成了多少）。

    权限用 `_admin`（role ∈ admin/boss），与同文件「老板配置员工门店 / 开员工账号」同域：
    这是全局判据，不是某个员工的个人偏好。
    """
    u = _admin(request)
    try:
        d = await request.json()
    except Exception:
        d = {}
    if not isinstance(d, dict):
        d = {}
    patch = {}
    if "qty_max" in d:
        patch["qty_max"] = d.get("qty_max")
    if "name_required" in d:
        patch["name_required"] = d.get("name_required")
    if not patch:
        raise HTTPException(400, "没有可保存的字段（qty_max / name_required）")
    before = fr.get_rules()
    try:
        r = fr.set_rules(**patch)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # 留痕：上限是全局判据，改了必须能查到「谁在什么时候把多少改成了多少」。
    # 失败不阻塞主流程（配置已落库）—— 与项目其它写路径同纪律。
    try:
        from db.queries.entity_logs import log_entity_changes
        changes = [(k, before.get(k), r.get(k)) for k in patch if str(before.get(k)) != str(r.get(k))]
        log_entity_changes("forecast_rules", 0, _user_label(u.get("id")),
                           changes, action="update", ref="预报 · 数量录入规则")
    except Exception:
        pass
    return {"ok": True, "rules": {"qty_max": r["qty_max"], "name_required": r["name_required"]}}


@router.post("/remind")
def manual_remind(request: Request):
    """手动触发催单（当前租户）：算"还差谁没报"并推送企微+站内通知。无未报者时 pushed=false。

    🔴 v304b（2026-09-28）：这里**故意不传** `respect_open_notice=True`（定时轮才传）。
       定时轮在「本期刚开放 30 分钟内」会主动让位给开放通知；但**手动点是用户的显式意图**，
       必须真发 —— 手点却没反应 = 又一处「点得动、没反应、零报错」的静默失效。
       ⚠️ 以后重构时**不要**为了"统一"而把两个调用点写成一样。

    🔴 v305（2026-09-28）：加 `ignore_quiet=True` —— 面板新增了「免打扰时段（仅影响企业微信）」，
       那是给**自动推送**用的；用户**主动点按钮**时不该被它拦下，否则又变成
       「手点了没反应、零报错」—— 与上面 `respect_open_notice` 是**同一类**取舍，故一并写在这里。
    """
    _auth(request)
    try:
        from scheduler import push_forecast_reminder_current
        pushed = push_forecast_reminder_current(ignore_quiet=True)
        return {"ok": True, "pushed": pushed}
    except Exception as e:
        raise HTTPException(500, f"催单失败: {str(e)[:120]}")


@router.get("/pending-summary")
def pending_summary(request: Request):
    """本期报单进度 + 我负责但还没报的单元（v304 · 小程序首页提醒条用）。**只读**。

    🔴 口径与调度器催单**同源**（都走 `scheduler.forecast_pending_summary`）——
       页面显示的「还差几个」与催单催的「还差谁」必须是同一件事，否则会出现
       「页面说都报完了、催单还在催」这种自相矛盾（本项目反复栽的同一类坑）。

    ⚠️ 全局只回**计数**（不含门店名、不含量）；门店名只回**他自己负责的**
       （按 `report_mapping.employee_id` 反查），业务员不该看到别家门店。

    ── v369（2026-10-03 · 老板原话：「这个信息不应该让所有报单人都知道，报单人只需要
       知道自己还有几家没报就可以了」）────────────────────────────────
    🔴 **全局计数本身也是泄露**：虽然不含店名，但「本期 12 个单元、已报 9 个」等于把
       **全公司谁还没动**的家数摊给每一个销售 —— 销售之间会互相比较、也会向客户转述。
       ⇒ **纯报单账号只看自己**：`scope="self"` 时**不下发** `units_total /
         units_reported / units_missing`（一律 0），只给 `my_missing`（自己负责、
         还没报的家数与店名）。
    🔴 **判据是「角色」而不是「有没有员工档案」**（这是本轮实测踩出来的）：
       老板账号 `users.id=2` 的 `employee_id=7`（他名下确实有东津/吾悦两个门店、
       真的要报单），若按「有员工档案就算报单人」判，他打开小程序就**看不到全局进度**了
       —— 而催单恰恰是他的活。⇒ 判据 = `role`（并读 `roles` 多值）：
         · `sales` / `distributor`（纯报单）⇒ `scope="self"`
         · `admin` / `boss` / `supervisor` / `accountant` 等管理角色 ⇒ `scope="all"`
       ⚠️ `fail-closed`：角色**取不到**（空）时判为 `self` —— 宁可少给，不可泄露。
    ⚠️ 反查不到员工 id 时同样**不给全局**（`my_missing` 为空 ⇒ 报单人那条不显示）。
    """
    u = _auth(request)
    try:
        from scheduler import forecast_pending_summary
    except Exception as e:
        raise HTTPException(500, f"催单模块不可用: {str(e)[:120]}")

    # 当前登录账号 → 员工 id。`employee_account_map()` 是「员工→账号」方向，这里反查。
    # 拿不到就填 0 ⇒ 只回全局计数（fail-safe，绝不因为取不到归属就报错）。
    my_emp = 0
    try:
        uid = int((u or {}).get("id") or 0)
        if uid:
            for eid, a in (db.employee_account_map() or {}).items():
                if int((a or {}).get("id") or 0) == uid:
                    my_emp = int(eid)
                    break
    except Exception as e:
        print(f"[forecast] pending-summary 反查员工失败（降级为全局）: {e}")

    # v369：是不是「纯报单账号」？判据 = 角色轴（管理角色要看全局去催单）。
    _roles = set()
    try:
        _r = str((u or {}).get("role") or "").strip().lower()
        if _r:
            _roles.add(_r)
        for _x in str((u or {}).get("roles") or "").replace("，", ",").split(","):
            if _x.strip():
                _roles.add(_x.strip().lower())
    except Exception as e:
        print(f"[forecast] pending-summary 读角色失败（按报单人处理）: {e}")
    _MGMT = {"admin", "boss", "supervisor", "accountant", "manager"}
    self_scope = not (_roles & _MGMT)          # 角色取不到 ⇒ 空集合 ⇒ True ⇒ 不给全局

    try:
        data = forecast_pending_summary(my_emp)
    except Exception as e:
        raise HTTPException(500, f"读取报单进度失败: {str(e)[:120]}")

    if self_scope:
        _miss = data.get("my_missing") or []
        # ⚠️ 放在**最后**覆盖：`data` 里带着 `units_*` 全局计数，不覆盖就是泄露。
        return {"ok": True, "scope": "self",
                "has_period": bool(data.get("has_period")),
                "period": data.get("period"),
                "my_missing": _miss, "my_missing_count": len(_miss),
                "owner_bound": bool(data.get("owner_bound")),
                "units_total": 0, "units_reported": 0, "units_missing": 0}
    return {"ok": True, "scope": "all", **data}


# ⚠️ v318（2026-09-29）：原先此处的 `_notify_extra_allocs(summary, …)` 已**删除**。
# 加单/减单通知的推送出口已唯一化到「关闭期次」（= 定稿）：
#   `routers/forecast.py::close_period` → `routers/product_targets.py::notify_extra_allocs_finalized()`
# 为什么必须搬走（用户拍板）：
#   ① `save-matrix` 是**保存草稿**动作，经理每改一轮就保存一次 ⇒ 通知发一次 = 刷屏；
#   ② 而真正的终态「关闭期次」（弹窗原文就写着「关闭 = 定稿」）此前**一条通知都不发**；
#   ③ 旧实现还有个 **P0 缺陷**：`recipients` 直接把 `employee_id`（租户内员工 id）当
#      `users.id`（主库全局账号）用 —— 读端 `routers/messages.py::_visible_where` 只认后者
#      ⇒ 送错人或无人可见，且**零报错**。新实现经 `db.employee_account_map()` 解析
#      （与工资条 `salary_send` 同范式），取不到账号就**不投递**。
# 保留这段说明而不是静默删掉：下次有人想在保存时"顺手也发一条回执"时，先读这里。


def _sync_period_product_list(conn, pid, start, end, rows, operator=""):
    """v612（2026-10-19）：把本次保存的**行集**同步进本期商品清单（`forecast_import_products`）。

    🔴 用户诉求原话：「我想增加报单商品，增加后小程序实时可以看到，正确的路径是什么」。
    根因是**系统缺了一环**，不是操作失误：小程序报单页（`routers/data.py::fill_search_products`）
    与小程序提交时的本期校验（`forecast_period_product_ids`）**只读这张清单**，
    而 `save_matrix` 此前只写报单明细、从不写清单。于是「改单里补录商品 → 保存」的结果是
    Web 端立刻看得见（它读在售档案），小程序永远搜不到 —— 两边用的是两套基准。
    能写清单的旧入口只有三个（新建期次沿上期 / 复制商品清单 / 重新导入模板），都无法"加一个"：
    前者只能整期继承，最后那个会先删本期已导入明细再重建（等于覆盖掉已填数量）。

    语义（用户 2026-10-19 拍板选 **B**）：
      · **新增** —— payload 里有、清单里没有、且**够格**的档案号 ⇒ 追加到**末尾**
        （`sort_no` 递增），`origin='manual'`。位置在末尾与 Web 端新增行本来就排最后一致，
        两端顺序天然对齐。「够格」= 该行有正数量 **或** 前端标了 `is_new`（用户手动补录/粘贴）
        **或** 前端标了 `add_to_list`（v613：勾品牌后用「加入本期清单」批量上架 —— 商品本来
        就在档案与表里，只是没登记进清单，数量自然为 0、也不是新增行）。
        ⚠️ 这条限定不是优化，是**正确性**：勾「显示全部商品」时编辑表行底是全部在售档案，
           不加限定一次保存就把整个档案灌进本期清单（详见下方 eligible 注释）。
      · **移除** —— 两条支路，结果都是物理 DELETE：
        ① 清单里有、payload 里没有的档案号（删行 = 这期不报这个商品）；
        ② **v614**：清单里有、payload 里**也**有，但该行显式标了 `list_del`
           （用户在「改单」里勾品牌 → 点「撤下清单」批量退单）。
           为什么要第二支：删行会把该行从 payload 剔除，而 save_matrix 是「整期清空重建」的
           语义 ⇒ 那一行的已报数量会跟着消失。用户要的「某个品牌整批撤下」多数发生在
           上错的时候，但也可能夹着已有人报的行；「撤下清单」只该退**清单**（小程序搜不到），
           不该动已经报上来的数量。所以行留在 payload 照常写数量，只把它从清单摘掉。
        ⚠️ 这是本表**唯一**的 DELETE 路径，推翻了 v184 注释里「本表只增不删」的旧约定 ——
           那条约定的成立前提是「清单只由导入产生」，现在清单也由汇总表保存维护，语义已变。
        ⚠️ 前端保证 `list_del` 只打在「行内数量全为 0」的行上。这不是洁癖，是**防回弹**：
           下面的 eligible 含 `qty>0`，一条 qty>0 的行撤下后，下次任何保存都会把它当
           「小程序先报、Web 后加进表」的合法新增**自动加回清单** ⇒ 用户看到「撤下了又自己
           回来了」且零报错。qty 恒 0 ⇒ 不 eligible ⇒ 撤下是持久的。
      · `product_id<=0` 的行**不参与**：清单唯一键是 (period_id, product_id)，没有档案号无法登记。
        这类行通常是「新增行还没建档成功」（`bulk-upsert` 被跳过 / 前端没回填 id），
        由调用方在回执里点名，不静默吞掉。

    安全闸（必须有，且只有这两条）：
      1. `pid<=0` 直接返回 —— 没有归属期次就无从判断"本期清单"，宁可不动。
      2. **本次 payload 一个档案号都没有时不做任何移除**（fail-open）。否则一次畸形/半截请求
         就能把整期清单清空，而小程序那边表现为"所有商品都没了"，且没有任何报错可循。
         新增仍然照做（有 id 才可能走到这里）。

    返回 `(added, removed)`。
    """
    try:
        _pid = int(pid or 0)
    except (TypeError, ValueError):
        _pid = 0
    if _pid <= 0:
        return 0, 0
    _start = (start or "").strip()
    _end = (end or "").strip()
    scope = db.forecast_period_scope_sql("r")
    params = (_pid, _start, _end)
    # 本次保存要保留的档案号（payload 里的行集 —— 编辑态是整表语义，不是差分）
    keep = {}
    # 允许**新登记进清单**的档案号：有正数量，或前端明确标了「这是用户新增的行」。
    # 🔴 为什么不能"凡在 payload 里就登记"：勾了「显示全部商品」时，编辑表的行底是
    #    **全部在售档案**（buildRowBase 的 showAll 分支），一次保存就会把 285 个 SKU
    #    全灌进本期清单 —— 而用户 2026-09-20 拍板的口径恰恰相反：
    #    「商品档案中的商品并非每一个都需要报单（例如很多赠品就不需要报单）」。
    #    三个必要条件取并集，正好覆盖三种真实诉求：
    #      · 补录商品（想让大家在小程序里能报）—— 行是用户加的，qty 常为 0 ⇒ 靠 is_new；
    #      · 已在报的单（小程序先报、Web 后加进表）—— qty>0；
    #      · v613 批量上架（勾品牌 → 「加入本期清单」）—— 商品本来就在档案里、也在表里，
    #        只是没登记进本期清单，qty 自然为 0、也不是新增行 ⇒ 靠 add_to_list。
    #        🔴 这条不能省：用户的心智是「把新希望整批上架让门店自己报」，
    #           而「上架」本来就不该以「已经有人报了数量」为前提。
    #        ⚠️ add_to_list 只能由**那个按钮**置位（前端 addShownToList），
    #           不要改成「勾了显示全部商品就自动置位」—— 那等于把上面那条 285 灌库的老坑重开一遍。
    eligible = set()
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            rpid = int(r.get("product_id") or 0)
        except (TypeError, ValueError):
            rpid = 0
        if rpid <= 0:
            continue
        keep[rpid] = r
        _qb = r.get("qty_by_unit") or {}
        _pos = False
        if isinstance(_qb, dict):
            for _v in _qb.values():
                _q, _bad = fr.normalize_qty(_v)
                if not _bad and _q > 0:
                    _pos = True
                    break
        if _pos or r.get("is_new") or r.get("add_to_list"):
            eligible.add(rpid)
    if not keep:
        return 0, 0
    listed = {int(_r["product_id"]) for _r in conn.execute(
        "SELECT product_id FROM forecast_import_products r "
        "WHERE (" + scope + ") AND product_id>0", params).fetchall()}
    add = [p for p in keep if p not in listed and p in eligible]
    # v614：rem 由两支构成 —— ① 行已不在 payload（删行）；② 行在 payload 但标了 list_del（撤下清单）。
    # 用 `keep.get(p) or {}` 而不是 `keep[p]`：keep 里可能有非 dict 值（脏 payload），
    # 真出现时宁可信「没标」也别 500 —— 少删一条清单远比整单失败轻。
    rem = [p for p in listed
           if (p not in keep)
           or (isinstance(keep.get(p), dict) and bool(keep.get(p).get("list_del")))]
    if rem:
        # 按档案号删（不按行 id）：同一商品可能同时存在 period_id=pid 与历史 period_id=0 两条。
        # ⚠️ DELETE 不能带别名（`DELETE FROM t AS r` 在 SQLite 上不可移植）⇒ 用**无别名**的同一片段。
        conn.execute(
            "DELETE FROM forecast_import_products WHERE (" + db.forecast_period_scope_sql("") + ") "
            "AND product_id IN (%s)" % ",".join("?" * len(rem)),
            params + tuple(rem))
    if add:
        _mx = conn.execute(
            "SELECT COALESCE(MAX(sort_no),0) FROM forecast_import_products r WHERE (" + scope + ")",
            params).fetchone()
        _no = int((_mx[0] if _mx else 0) or 0)
        from datetime import datetime as _dt
        _ts = _dt.now().strftime("%Y-%m-%d %H:%M:%S")
        for p in add:
            _no += 1
            _pr = conn.execute("SELECT name, barcode FROM products WHERE id=?", (p,)).fetchone()
            _name = (_pr["name"] if _pr else "") or str(keep[p].get("product_name") or "")
            _bc = (_pr["barcode"] if _pr else "") or ""
            conn.execute(
                "INSERT OR IGNORE INTO forecast_import_products "
                "(period_id, order_date, product_id, product_name, barcode, action, "
                " imported_at, imported_by, source_file, origin, sort_no) "
                "VALUES (?,?,?,?,?,?,?,?,?,'manual',?)",
                (_pid, _start, p, _name, _bc, "手工补录", _ts, operator or "",
                 "改单保存", _no),
            )
    return len(add), len(rem)


@router.get("/unit-order")
def unit_order_get(request: Request):
    """报单汇总表「客户列顺序」—— 已保存的顺序（排障/核对用；汇总表本身已按它排好）。

    v7xx（2026-10-30）：老板要求「按我给的顺序，且从现在开始每期顺序不要变」。
    """
    u = _auth(request)
    if u.get("role") not in SUMMARY_ROLES:
        raise HTTPException(403, "仅管理员 / 老板 / 主管 / 财务文员可查看报单汇总")
    return {"ok": True, "customers": fuo.get_unit_order()}


@router.post("/unit-order")
async def unit_order_save(request: Request):
    """保存老板指定的客户列顺序（整体覆盖）。body: {customers: [列名...]}

    🔴 作用域**只有顺序**：客户列的成员仍由报单名册（`all_units`）决定 ——
      未列入顺序的名字**不会被隐藏也不会被删**，只是排到后面（保持原相对顺序）。
      要撤列走 `/save-matrix` 的 `hidden_customers`，不要用这个接口。
    """
    u = _auth(request)
    if u.get("role") not in SUMMARY_ROLES:
        raise HTTPException(403, "仅管理员 / 老板 / 主管 / 财务文员可保存报单列顺序")
    try:
        b = await request.json()
    except Exception:
        b = {}
    if not isinstance(b, dict):
        b = {}
    try:
        names = fuo.save_unit_order(b.get("customers"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "customers": names}


@router.post("/save-matrix")
async def save_matrix(request: Request):
    """保存交叉表编辑结果：把编辑后的矩阵重写为该窗口的『导入』报单（幂等：先清 role='导入' 再建）。
    body: {start, end, period_id?, customers: [name...], hidden_customers: [name...], rows: [{product_id, product_name, spec, unit, price, qty_by_unit: {客户名: qty}}], base_rev?, force?}
    - period_id：可选。前端知道自己在编哪一期，传了就直接用（最准）；不传才按 start/end 窗口解析。
    - base_rev（v213-B1，可选）：前端打开矩阵时 `GET /summary` 给的 `matrix_rev`。传了且与当前
      指纹不等 ⇒ **409 + conflict**（期间有人写过），本次保存**一个字节都不写**。
      不传 = 旧前端 ⇒ 完全不做冲突判定（行为与 v212 逐字相同）。
    - force（v213-B1，可选）：用户在冲突对话框上明确选了「用我这份覆盖」⇒ 跳过冲突判定。
    - 数量/增删行列：随矩阵重建（每客户一条提交，qty>0 的才建 item）
    - 商品名修改：只写 item.product_name（该周期显示层），不动 products 主档
    - 新增行 product_id=0 原样保留名称；删客户=不生成该客户提交；删行=不生成该商品 item
    - hidden_customers（v199, 2026-09-19）：用户在界面上**删掉的客户列**。仅「不生成提交」是不够的 ——
      客户列的来源是 all_units（**全历史聚合名册**，见 erp_db.py::forecast_submission_summary），
      非本函数的作用域（本期 role='导入'），所以删列后刷新列必然回来（用户 2026-09-19 报障）。
      这里把被删的列名落进 `forecast_hidden_units` ⇒ 名册里的 NOT EXISTS 过滤生效，列真正消失。
      **双向**：customers 里出现的名字会从隐藏名册中 DELETE ⇒ 用「新增客户」填回同名即可加回该列。
      ⚠️ 只隐藏**真实出现过的**客户名（INSERT ... WHERE EXISTS 那条）：避免用户删掉一个从未存在
         的自建列（如「新客户1」）时留下无意义的名册残留。
    不触碰 role 非『导入』的小程序报单。"""
    u = _auth(request)
    try:
        b = await request.json()
    except Exception:
        b = {}
    if not isinstance(b, dict):
        b = {}
    start = (b.get("start") or "").strip()
    end = (b.get("end") or "").strip()
    customers = b.get("customers") or []
    # v199：界面上被删掉的客户列（见 docstring）。缺省为空 ⇒ 旧前端（不传此字段）行为完全不变。
    hidden_customers = b.get("hidden_customers") or []
    rows = b.get("rows") or []
    # ---- v213-B1：乐观锁入参（两个都缺省 = 旧前端，行为**完全不变**：不判冲突） ----
    # base_rev：前端打开矩阵时从 GET /summary 拿到的 `matrix_rev`，保存时原样回传。
    #           与当前指纹不等 ⇒ 期间有人写过 ⇒ 409 + conflict（前端弹对话框给两个出口）。
    # force  ：用户在对话框上明确选了「用我这份覆盖」⇒ 跳过冲突判定（但下一次保存仍要带新 rev）。
    base_rev = str(b.get("base_rev") or "").strip()
    force = bool(b.get("force"))
    if not start or not end or not customers or not isinstance(rows, list):
        raise HTTPException(400, "缺少 start/end/customers/rows")

    # ---- v213 数量判据门禁（与小程序 `create_submission` **同一份判据**） ----
    # 本入口原是四处口径里**最宽**的一个：无数量上限、负数静默跳过、非数字静默归 0
    # （`int(qb.get(cname) or 0)` 抛错 → `qty = 0` → `continue`）。
    # 于是出现**方向相反**的分歧：前端 `cellErrMsg` 用 `parseFloat`（**前缀解析**）
    # 把 `"12箱"` 判成合法 ⇒ 不标红、放行；后端 `int("12箱")` 抛错 ⇒ 那一格**静默消失**，
    # 屏幕上没有任何痕迹（用户以为报上去了 = 漏订货）。现在两端同一判据：
    # 不合法就 400 带 `violations` 清单，前端点一行跳到那一格去改。
    _rules = fr.get_rules()
    _violations = fr.violations_for_matrix(rows, customers, _rules)
    if _violations:
        return _violations_400(_violations)

    uid = int(u.get("id") or 0)
    # A7/D2 (2026-07-24)：解析期次 id → 矩阵保存的报单落 period_id（供 accuracy 按期次关联）。
    # 2026-09-15 重写，修两个静默错期：
    #   原实现只在 status='open' 里按 (order_start, order_end) 匹配、ORDER BY id DESC 取最大 id：
    #   ① 编辑**已关闭**的历史期次 → 恒解析到 0，矩阵报单彻底丢期次键；
    #   ② 两个期次窗口**完全相同**时永久取 id 最大者 → 可能落到不是用户正在编辑的那一期。
    #   现改为「显式优先 + 含今天优先」：前端传 period_id 就照用（它知道自己在编哪一期）；
    #   未传才按窗口匹配，优先取「今天落在窗口内」的那一期，最后才退到同窗口的任意期次。
    from datetime import date as _date
    pid = 0
    try:
        pid = int(b.get("period_id") or 0)
    except (TypeError, ValueError):
        pid = 0
    if pid > 0:
        try:
            with db.get_db() as c:
                if not c.execute("SELECT id FROM forecast_periods WHERE id=?", (pid,)).fetchone():
                    pid = 0   # 脏 id 不落库
        except Exception:
            pid = 0
    if pid <= 0:
        try:
            _today = _date.today().isoformat()
            with db.get_db() as c:
                row = c.execute(
                    "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=? AND status='open' "
                    "AND order_start<=? AND order_end>=? ORDER BY id DESC LIMIT 1",
                    (start, end, _today, _today),
                ).fetchone()
                if not row:
                    row = c.execute(
                        "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=? AND status='open' "
                        "ORDER BY id DESC LIMIT 1",
                        (start, end),
                    ).fetchone()
                if not row:
                    # 含今天、窗口一致但不限状态 → 覆盖「编辑已关闭期次」的场景
                    row = c.execute(
                        "SELECT id FROM forecast_periods WHERE order_start=? AND order_end=? "
                        "AND order_start<=? AND order_end>=? ORDER BY id DESC LIMIT 1",
                        (start, end, _today, _today),
                    ).fetchone()
                if row:
                    pid = int(row["id"] or 0)
        except Exception:
            pid = 0

    # ---- v244 期次归属硬闸：没有可归属的**进行中**期次 ⇒ 拒写（fail-closed） ----
    # 用户 2026-09-22 拍板：「新建期次必须落一条真实期次，否则无法保存」。
    # 判据沿用**既定方案**（`outputs/期次数据流程优化方案-2026-09-17` §四.1 原文：
    # 「不是『必须先建期次』，而是『必须有一个「进行中」的期次』」）——
    # 即 v193 给**导入**加的那道门，本闸把它**扩展到报单保存**。三个写路径至此口径一致：
    #   · 小程序 `create_submission` —— v219「B 锁死」起已有；
    #   · 导入 `import_router._execute_forecast_cross` —— v193 起已有；
    #   · **本函数**是唯一未设闸的写路径。
    # 为什么必须堵：本函数产出的 `period_id=0` 行**不落 `forecast_periods`**，会被看板
    #   补成「合成行」（`id<0`）—— 而四个行级按钮的判据都是 `Number(row.id)>0`
    #   ⇒ 那批数据**既改不了也关不掉**，只能靠人工清库。2026-08-22 那 20 条 / 12,709 件
    #   就是这样产生的（已于 v243 清理，见 `outputs/孤儿报单清理-2026-09-22/`）。
    # 🔴 本闸**推翻** v219 当年的一条显式决定（原文见下方 v219 段，保留以留档）：
    #   当时为保住「没建期次也能报单」这条兜底路径而**有意**放过 `pid<=0`；用户现在的诉求
    #   正相反 —— **废掉这条兜底**。归算不上就不写，比写进去再人工擦干净便宜得多。
    # ⚠️ 与下方 v219 定稿闸门互补、不重叠：**本闸**判「有没有归属」（`pid<=0`），
    #    **那道**判「归属对象可不可写」（`pid>0` 但已关闭）。
    #    四阶段实测下两闸各自命中（不是推断，见 v244 验证记录）：
    #      · 显式传一个**已关闭**期次的 id ⇒ `pid>0` ⇒ 走 v219 ⇒
    #        **409「该期次已定稿（关闭）…请到「往期预报」里先重开」**；
    #      · 不传 / 传 0 / 传入的 id 已不存在（上方解析会把它归零）/ 窗口解析不到
    #        （含前端「今日报单」形态）⇒ `pid=0` ⇒ 走本闸 ⇒
    #        **400「没有进行中的报单期次…请先点「新建期次」」**。
    #    分两闸而非合并的价值：两条文案各自指向**正确的下一步**（「重开」vs「新建」）——
    #    合并成一句会让「我只是想改个历史期次」的用户被指引去新建，越走越远。
    if pid <= 0:
        raise HTTPException(
            400,
            "当前没有进行中的报单期次，无法保存：请先点「新建期次」创建一个进行中的期次。",
        )

    # ---- v219 定稿闸门：期次已关闭（= 已定稿）⇒ 矩阵不可再写 ----
    # 前端弹窗从 2026-08 起就书面承诺「关闭后该期次**不可再编辑**」，但这条承诺**从未兑现** ——
    # 本函数此前完全不看 status ⇒ 关闭期次照样保存成功，前端一直在撒谎。
    # ⚠️ 闸门只加在**本函数**（本期矩阵写入）这一个请求上 —— 前端 `saveEdits` 一次发**两个**
    #    请求（矩阵 + 商品档案 upsert），加在后者上会顺手把**全租户共享的商品档案**一起锁掉。
    # ⚠️ `pid<=0`（今日报单 / 无期次窗口）原为「**不拦**」（v219 有意保住「没建期次也能报单」
    #    的兜底路径）—— **该决定已被上方 v244 闸门推翻**，此处不再重复判 `pid<=0`。
    # ⚠️ 与上面「窗口解析第三段（不限状态）」的关系：那段是 2026-09-15 为让**已关闭期次**的
    #    报单也能落到正确期次键（不丢 period_id）而加的。加了本闸门后它变成「兜底但不可达」——
    #    这是**有意**的：编辑已关闭期次必须先 `reopen`，否则「关闭 = 定稿」就是一句空话。
    #    因为 `reopen` 是现成的补救路径，本闸门**不会**造成永久锁死（这正是它必须与
    #    `POST /periods/{pid}/reopen` 配套上线的原因 —— 分开上就是事故）。
    # 🔴 v305（2026-09-28）：`_closed_edit` = 本次保存是**靠授权**才写进来的（即严格口径本来会 409）。
    #   必须在 `if pid > 0` **之前**初始化 —— 否则 `pid<=0` 分支走到下方读取处会 NameError。
    _closed_edit = False
    if pid > 0:
        # v219 定稿闸门 + 截止硬锁（合并到统一判据）：期次已关闭（= 定稿）**或**报单截止日已过期
        # ⇒ 矩阵不可再写。原实现只看 status，漏了「open 但 order_end<今天」的过期期次
        # （自动化关单未跑/未开启时就会停在这种状态，save-matrix 仍能写 —— 用户要堵的洞）。
        # 🔴 v305（2026-09-28）用户拍板：「关单后要支持主管/文员等有 web 端权限的人能够改单」。
        #   此前唯一路径是 `POST /periods/{pid}/reopen`，而重开会让**销售又能报单**
        #   （见 `forecast_period_reopen` 注释）—— 为改一个错数而整期重开，代价过大。
        #   判据直接复用**固有权威名单** `SUMMARY_ROLES`（本文件顶部，前端 `roles.js` 有镜像、
        #   由 `role-registry-consistency-check.py` 做 AST 一致性护栏）——
        #   「能看全公司报单汇总的人」正是用户说的「有 web 端权限的人」，不新增名单、不会漂移。
        #   ⚠️ 销售/促销（`sales`/`staff`）不在名单里 ⇒ 「关闭 = 停止销售报单」的语义**不变**：
        #      他们走的是小程序 `POST /api/forecast-submissions`，那条路**没开**这个口子。
        # 🔴 v333（2026-09-30）：`SUMMARY_ROLES` 加了 `accountant` ⇒ **v305 那句「主管/文员」
        #    里的"文员"到本批才真正落地**（当时名单只有 admin/boss/supervisor，会计不在其中）。
        #    ⇒ 会计现在**可以**关单后授权改单，并照常触发下方留痕 + 站内通知。
        #    ⚠️ 撤单（`erp_db.py::forecast_submission_recall`）**仍不含会计** —— 那条路用的是
        #       它自己的内联元组，语义是"撤掉一整单"（比改单更强的破坏性动作）。本批**有意**
        #       不收窄也不放开它；要动属单独决定。
        #    ⚠️ 打印与站内信里的角色口径文案已同步为「管理员 / 老板 / 主管 / 财务文员」，
        #       否则收到通知的人会以为自己越权了。
        _u_role = str((u or {}).get("role") or "")
        _allow_closed = _u_role in SUMMARY_ROLES
        _wok, _wreason = db.forecast_period_writable(pid, allow_closed=_allow_closed)
        if not _wok:
            raise HTTPException(409, _wreason)
        if _allow_closed:
            # 再按**严格口径**判一次：只有"本来会被拒"才算授权改单 ⇒ 日常在 open 期次上改单不刷留痕。
            # 多一次 SELECT 的代价只落在授权角色身上，可接受（换取留痕不撒谎）。
            _wok_strict, _ = db.forecast_period_writable(pid)
            _closed_edit = not _wok_strict
    # D2 修复：原四段独立事务（清理/逐客户建单/extra_qty/确认标记）合并为单一大事务——
    # 任一步失败整体回滚，杜绝『清理成功但建单失败』导致的半写丢数据状态。
    _new_rev = {}
    # v612：本期商品清单同步结果（新增/移除条数 + 失败原因）—— 在 try 之前初始化，
    # 否则异常分支走到回执处会 NameError（v305 在 `_closed_edit` 上踩过同一个坑）。
    _list_added, _list_removed, _list_err = 0, 0, ""
    # v264c（2026-09-24）R9：**在开启写事务之前**把汇总表列名解析成报单对象 id。
    # 🔴 为什么必须提前：`resolve_alias_to_contact`（唯一实现）内部**另开连接**读
    #    `report_mapping`，而下方 `get_db_tx()` 持有写事务 —— 同进程另开连接读同一
    #    SQLite 文件会与写事务**互锁**（上方 v213-B1 那段注释已明确写过这条纪律）。
    # 解不出 ⇒ 保持 0（**不猜**：contacts 里同名不一定是同一语义对象），但逐列点名回执 ——
    # 旧实现对此**完全静默**（与 import_router 同款回执，方案 §八 R9）。
    _col_obj, _col_kind, _unmapped_cols = {}, {}, []
    for _c in customers:
        _c = str(_c or "").strip()
        if not _c:
            continue
        _rr = db.resolve_alias_to_contact(_c)
        _col_obj[_c] = int((_rr or {}).get("counterparty_id") or 0)
        # 🔴 v294：列头解析出的**对象类型**一并留存。汇总表的列里既有门店也有本人仓，
        #    两者的 id 空间独立、可以撞号 —— 落库时不带类型轴，Web 端写的「本人仓 5」
        #    与小程序写的「门店 5」会共用同一个幂等键而互相覆盖（静默丢单）。
        _col_kind[_c] = db._norm_store_kind(
            "warehouse" if (_rr or {}).get("counterparty_type") == "self_warehouse" else "store")
        if not _rr:
            _unmapped_cols.append(_c)
    # ── v277（需求 6）：加/减单的**按比例分配** —— 必须在写事务**之前**算完 ──────────
    # 理由与上方 v264c R9 那段逐字相同：`plan_extra_allocs` 要读 `product_targets` /
    # `product_target_alloc` / 本期各人报单量，这些读走 `get_db()`（**另开连接**），
    # 与下面 `get_db_tx()` 持的写事务同进程并发会**互锁**。
    # 它只**算**不写 —— 真正落库在事务内（见下方 forecast_extra_alloc 段落）。
    #
    # 🔴 算不出来**不能拦住建单**：经理的报单与加单本身必须落库，否则一次算法异常
    #    会让整张汇总表保存失败（那是把"通知没发出"升级成"数据没存上"）。
    #    但必须留痕 —— 静默失败 = 用户以为分好了、实际没有，正是本项目最怕的那类缺陷。
    _extra_alloc_rows, _extra_alloc_summary = [], {}
    try:
        from routers import product_targets as _pt          # 延迟导入：避免模块级环
        _extra_alloc_rows, _extra_alloc_summary = _pt.plan_extra_allocs(pid, start, end, rows)
    except Exception as _e:
        import logging as _lg
        _lg.getLogger("hergent").warning("v277 加单分配计算失败（不影响报单保存）：%s", _e)
    # ── v336：补第 12 列 `operator`（**这笔分摊是谁做的**）────────────────────────
    # 为什么在这里补、而不是在 `plan_extra_allocs` 里算：「谁」是**调用方的事实**
    #   （登录会话），不是算法输入 —— 算法层保持「纯计算、不碰会话」，与它「不含任何 DB 访问」
    #   的定位一致（`domain/product_targets.py` 文件头）。
    # 🔴 即使取不到显示名也要**补一个占位串**（空串）：行长度必须**恒为 13**
    #    （v658 起：12 列 + store_name 门店列 + operator = 13；v658 之前是 12）。
    #    少补一列 ⇒ `executemany` 直接抛 `Incorrect number of bindings` ⇒ 整个 save-matrix
    #   报 500「保存失败」。抛错比静默错列好，但更好的是**根本不给它抛的机会**。
    _alloc_operator = ""
    try:
        _alloc_operator = str((u or {}).get("display_name") or (u or {}).get("username") or "")
    except Exception:
        _alloc_operator = ""
    if _extra_alloc_rows:
        _extra_alloc_rows = [tuple(_r) + (_alloc_operator,) for _r in _extra_alloc_rows]
    try:
        with db.get_db_tx() as conn:
            db._ensure_forecast_tables(conn)
            # ---- v213-B1 乐观锁门禁（**必须在第一句 DELETE 之前**） ----
            # 作用域由 `forecast_matrix_rev` 自己界定（其条件与下方 _import_cond 逐字同源，
            # 见 erp_db.py 该函数 docstring）。**在事务内读、且在任何写之前**：
            #   · 读到的正是本事务即将清理的那一份数据；
            #   · 命中冲突直接 return ⇒ **不写任何业务数据**（`_ensure_forecast_tables` 若需补
            #     表/列会有 DDL，那是建表不是改数据；与 E3「被拒保存 DB 指纹一字不变」同性质）。
            # ⚠️ 必须在本事务连接上读（`db_conn=conn`）—— 另开连接读同一 SQLite 文件会与写事务互锁。
            # fail-open：指纹算不出（`rev=""`）时不拦。乐观锁是**防误覆盖的体验层**，不是完整性
            #   闸门（完整性由本事务保证）⇒ 宁可放行，也不能因为一次查询失败把用户挡在门外。
            if base_rev and not force:
                _cur = db.forecast_matrix_rev(period_id=pid, start_date=start, end_date=end, db_conn=conn)
                _cur_rev = _cur.get("rev") or ""
                if _cur_rev and _cur_rev != base_rev:
                    return _conflict_409(_cur, base_rev)
            # 幂等清理：该**期次**内全部『导入』数据（先 items 后 submissions）
            # 2026-09-15：改为按期次归属清理（period_id=pid；period_id=0 的历史行回退日期区间）。
            # 原实现纯按 order_date BETWEEN —— 两个期次窗口重叠时，保存 A 期会把
            # **属于 B 期的导入数据一并清掉**（隔离租户 E2E 实测复现，见 §T4/T5）。
            # 🔴 v213-B1：条件与参数改从 `erp_db` 的**唯一常量**取 —— 它与内容指纹
            #    （forecast_matrix_rev）用的必须是同一份作用域，两处手抄迟早分叉。
            _import_cond = db.FORECAST_IMPORT_SCOPE_SQL
            _import_p = db.forecast_import_scope_params(pid, start, end)
            conn.execute(
                f"DELETE FROM forecast_submission_items WHERE submission_id IN "
                f"(SELECT id FROM forecast_submissions WHERE {_import_cond})",
                _import_p,
            )
            conn.execute(
                f"DELETE FROM forecast_submissions WHERE {_import_cond}",
                _import_p,
            )
            saved_customers = 0
            saved_items = 0
            # v741：本次落下的「主管减单」负数明细条数（回执里给，便于诊断"减了多少行"）
            saved_adjusts = 0
            for cname in customers:
                cname = str(cname or "").strip()
                if not cname:
                    continue
                # v199：该列**还在** ⇒ 从隐藏名册移除。这是「加回列」的唯一路径，也是本方案
                #   可逆性的来源：删错一列只需用工具行「新增客户」填回同名再保存即可恢复，
                #   全程不需要碰数据库（旧实现里这一步是**不可逆**的 —— 删了就再也加不回来）。
                conn.execute("DELETE FROM forecast_hidden_units WHERE store_name=?", (cname,))
                items = []
                adj_items = []
                for r in rows:
                    if not isinstance(r, dict):
                        continue
                    qb = r.get("qty_by_unit") or {}
                    # v213：复用同一解析器（「判定」与「取数」必须是同一个实现）。
                    # 前面整单已拦违规，此处 `_bad` 只是防御；`qty == 0` 仍是「这一格没填」。
                    qty, _bad = fr.normalize_qty(qb.get(cname))
                    if _bad:
                        # 🔴 v741（2026-11-03）：主管减单。格子里填的是**合计**，减去门店自报量
                        #   （小程序 distributor 等）后差额可能是负数 —— 而 `normalize_qty` 把
                        #   负数判成 `VK_NEG`（三端共用判据，**不在此处放宽**，否则前端校验
                        #   与后端落库会分叉）。这里只接住"带负号"这一种情形：用**同一个解析器**
                        #   解析去掉负号后的数，再取负 —— 不另写一条"什么是数字"的正则。
                        if _bad == fr.VK_NEG:
                            _abs, _bad2 = fr.normalize_qty(str(qb.get(cname)).strip().lstrip("-"))
                            if not _bad2 and _abs:
                                qty = -_abs
                    if qty is None or qty == 0:
                        continue
                    name = str(r.get("product_name") or "").strip()
                    # v211b 同类缺陷：原实现 `int(r.get("product_id") or 0)` **未包 try**
                    # ⇒ 客户端传个 `"product_id": "abc"` 就抛 ValueError，被最外层
                    # `except Exception` 兜成 **500「保存失败」**（用户看到"服务器坏了"，
                    # 而其实是自己传错了参数）。改为包 try → rpid=0（= 无档案号的自建行，
                    # 下方 `if not name and not rpid: continue` 与落库路径都已按 0 处理）。
                    try:
                        rpid = int(r.get("product_id") or 0)
                    except (TypeError, ValueError):
                        rpid = 0
                    if not name and not rpid:
                        continue
                    price = 0.0
                    try:
                        price = float(r.get("price") or 0)
                    except (TypeError, ValueError):
                        price = 0.0
                    # v213：`name` 为空时补占位名。**在 `name_required=True`（默认）下这个分支
                    # 已不可达** —— 前面的门禁会对「有正数量却没名字」的行 400（`kind='name'`），
                    # 所以不会再出现「用户存进去一行、刷新变成『商品#123』」的静默改名。
                    # 保留兜底是为了 `name_required=False` 的租户（显式关掉该约束时才走这里）。
                    _item = {
                        "product_id": rpid, "product_name": name or f"商品#{rpid}",
                        "spec": str(r.get("spec") or ""), "unit": str(r.get("unit") or "件"),
                        "quantity": qty, "price": price, "amount": round(qty * price, 2),
                    }
                    # 🔴 v741：负数差额**不进『导入』行**（导入量代表"我这边填了多少"，
                    #   为负会污染它的语义，也会让「导入 vs 实报」的对比失去意义）。
                    #   单独落一条 `role='主管调整'` 明细 ⇒ summary 的跨角色求和
                    #   `导入 + 门店自报 + 主管调整` 自然等于主管填的**合计**，
                    #   门店原始报单**分毫不动**（可追溯），下次保存按同一 scope 幂等重建。
                    if qty < 0:
                        adj_items.append(_item)
                    else:
                        items.append(_item)
                real_items = items
                if not real_items:
                    # 客户列本周期无正数量商品：仍保留占位记录，使客户列持久化、刷新不丢
                    # （否则 save 后再 loadEditGrid 会因 summary 无该客户 sources 导致整列消失）
                    real_items = [{"product_id": 0, "product_name": "__列占位__", "spec": "", "unit": "件", "quantity": 0, "price": 0.0}]
                # v264c（2026-09-24）R9：**列名 → 报单对象 id 不再硬编码 0**。
                #   修前生产实测：39 行报单里 38 行 `store_id=0`（同一秒批量建单的那两批
                #   正是本路径写的），只有小程序报单那条带真 id ⇒「逐人实报」只能靠
                #   `store_name` 名字匹配 —— 报单配置里一改名，历史报单就归不到人，**零报错**。
                # 🔴 `name` 仍传 `cname`（汇总表**列名**），**不能**换成 contacts 系统全称 ——
                #   列名口径是「报单配置的简称」，换成全称会与 Excel 导入落库的名字裂成两列
                #   且永不合并（v247 用户报障的原形）。本次**只补 id**，不动名字。
                _cobj = {"id": _col_obj.get(cname, 0), "name": cname,
                         "kind": _col_kind.get(cname, "store")}
                db.forecast_submission_create({"id": uid}, "导入", _cobj, real_items,
                                              note="交叉表编辑保存", order_date=start,
                                              period_id=pid, db_conn=conn)
                saved_customers += 1
                saved_items += sum(1 for it in items if (it.get("quantity") or 0) > 0)
                # v741：减单差额单独成一单（同客户列、同期次、同一 type/id 轴）
                if adj_items:
                    db.forecast_submission_create({"id": uid}, "主管调整", _cobj, adj_items,
                                                  note="主管减单（交叉表合计下调）", order_date=start,
                                                  period_id=pid, db_conn=conn)
                    saved_adjusts += len(adj_items)
            # v199：用户**删掉的**客户列 → 落隐藏名册（名册侧的 NOT EXISTS 过滤见
            #   erp_db.py::forecast_submission_summary 的 all_units）。这是「删列」这个动作
            #   第一次有了持久化载体 —— 旧实现只删「本期 role='导入' 的记录」，而列来自
            #   全历史名册 ⇒ 刷新后列必然回来（用户 2026-09-19 报障的根因）。
            #   ⚠️ 顺序在「加回列」的 DELETE 之后：同一名字若同时出现在两个列表，以「还在」为准。
            #   ⚠️ `WHERE EXISTS` 守卫：只隐藏**真实出现过的**客户名 —— 用户删掉一个从未存在
            #      的自建列（如「新客户1」）时，不在名册里留无意义的残留行。
            #   ⚠️ 用「INSERT OR IGNORE + UPDATE」两步而非 upsert：`INSERT ... SELECT` 带
            #      `ON CONFLICT` 在 SQLite 里有解析歧义（需 WHERE 消歧），两步写法读起来也更直白。
            #      UPDATE 刷新时间/操作人 ⇒ 语义是「**最近一次**隐藏动作」（先删、加回、再删时更新）。
            hidden_by = (u.get("display_name") or u.get("username") or "经理")
            for hname in hidden_customers:
                hname = str(hname or "").strip()
                if not hname:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO forecast_hidden_units(store_name, hidden_by) "
                    "SELECT ?, ? WHERE EXISTS (SELECT 1 FROM forecast_submissions WHERE store_name = ?)",
                    (hname, hidden_by, hname),
                )
                conn.execute(
                    "UPDATE forecast_hidden_units SET hidden_at=datetime('now','localtime'), hidden_by=? "
                    "WHERE store_name=?",
                    (hidden_by, hname),
                )
            hidden_total = conn.execute("SELECT COUNT(*) FROM forecast_hidden_units").fetchone()[0]
            # ── v612：本期商品清单同步（新增补进 / 删行移除）──────────────────────
            # 位置说明：必须在**报单明细写完、且仍在同一事务内**执行 ——
            #   ① 明细写完后 `keep` 的档案号才是本次保存的最终行集（新增行此时已由前端回填 id）；
            #   ② 同一事务 ⇒ 清单与报单不会一个改了一个没改（小程序看到清单却没有对应报单 = 假数据）。
            # 失败**不回滚整单**（报单本身已经写对了，把它一起废掉代价更大），但**绝不静默**：
            # 错误原文经回执 `list_sync_error` 回给前端，由前端明确提示「清单没同步上」。
            # 判据：增益功能失败可以降级，但用户必须知道降级了 —— 否则他以为小程序能看到。
            try:
                _list_added, _list_removed = _sync_period_product_list(
                    conn, pid, start, end, rows,
                    operator=(u.get("display_name") or u.get("username") or ""))
            except Exception as _e:
                import logging as _lgs
                _lgs.getLogger("hergent").warning("v612 本期商品清单同步失败：%s", _e)
                _list_added, _list_removed, _list_err = 0, 0, str(_e)[:160]
            # 持久化行级补充值（与导入报单/定稿流独立，按 产品×期次 upsert）：
            #   extra_qty  加单(箱)
            #   case_price 本期手工录入的「单价(进价/箱)」—— **只在本期生效**（用户 2026-09-18 拍板）：
            #     唯一键含 (period_start, period_end) ⇒ 天然按期次隔离，绝不写商品档案
            #     （改档案会影响**所有期次**的金额，那是另一个选项，用户明确没选）。
            #     NULL / 0 = 未录入 ⇒ 前端回退按档案进价自动算。清空后保存即写回 NULL（见 DO UPDATE）。
            for r in rows:
                if not isinstance(r, dict):
                    continue
                # v211b 同类：`int(r.get("product_id"))` 未包 try ⇒ 脏 product_id 抛 500。
                # 这里判据是 `rpid <= 0 就跳过`（本表按 product_id 做唯一键，0 无意义）。
                try:
                    rpid = int(r.get("product_id") or 0)
                except (TypeError, ValueError):
                    rpid = 0
                if rpid <= 0:
                    continue
                try:
                    eq = float(r.get("extra_qty") or 0)
                except (TypeError, ValueError):
                    eq = 0.0
                # 手工单价：非正数一律归 NULL（前端判据也是「> 0 才算手工录入」，
                # 两边判据必须一致，否则会出现「前端显示自动价、后端存着 0」的静默分叉）。
                try:
                    _cp = r.get("case_price")
                    cp = float(_cp) if _cp not in (None, "") else None
                    if cp is not None and cp <= 0:
                        cp = None
                except (TypeError, ValueError):
                    cp = None
                pname = str(r.get("product_name") or "")
                punit = str(r.get("unit") or "件")
                conn.execute(
                    "INSERT INTO forecast_extra_qty (period_start, period_end, product_id, product_name, unit, extra_qty, case_price) "
                    "VALUES (?,?,?,?,?,?,?) "
                    "ON CONFLICT(period_start, period_end, product_id) DO UPDATE SET extra_qty=excluded.extra_qty, case_price=excluded.case_price, product_name=excluded.product_name, unit=excluded.unit",
                    (start, end, rpid, pname, punit, eq, cp),
                )
            # ── v277（需求 6）：落加/减单的**按人分配明细** ────────────────────
            # **无条件清空本期次的本表**再写，这样「把加单填回 0 再保存」会把上一版的分配
            # 一起清掉。若只在"有分配行"时才清，清空加单后旧分配会留在表里 ——
            # 前端悬停会把幽灵数据当成本次结果显示（"某人为啥被加了 6 箱"），
            # 而且**没人会来报这个 bug**（界面上看起来一切正常）。
            # 🔴 v279：**清空条件用 `period_id`（归属键）**，不再用窗口 ——
            #   与读取侧（`GET /extra-alloc`）同一把键 ⇒ 从根上消灭
            #   「写进去落在 A 窗口、读的时候查 B 窗口」这类静默失效。
            conn.execute(
                "DELETE FROM forecast_extra_alloc WHERE period_id=?",
                (pid,))
            if _extra_alloc_rows:
                conn.executemany(
                    "INSERT INTO forecast_extra_alloc (period_id, period_start, period_end, "
                    "product_id, employee_id, employee_name, store_name, ratio, reported_box, "
                    "alloc_box, final_box, basis, operator) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    _extra_alloc_rows)
                # 未分满必须留痕（占比缺口 / 报量不足被夹断）—— 否则经理只看到
                # 「我说加 60，实际只加了 54」，而系统一声不响。
                # 🔴 v336：把「**一个人都没有可分的**」单独说清 —— 它的成因与"分不满"
                #   完全不同（那是没人可分，去改占比没用，得先让人报单或建目标），
                #   混在一句 warning 里会让排障的人往错的方向找。
                import logging as _lgx          # 本函数内没有模块级 logger，就地取一次
                _lgx = _lgx.getLogger("hergent")
                for _apid, _asum in (_extra_alloc_summary or {}).items():
                    if _asum.get("no_members"):
                        _lgx.warning(
                            "v336 加单无处可分的商品：product=%s 经理填了 %.3f 箱，"
                            "而该商品「本期无人报过单、也没有启用目标（或目标没填承接人）」"
                            "⇒ **一个落点都没有**。v657 起有正门：在分摊弹窗从**报单对象名册**"
                            "勾选承接人（存本期临时占比）后再保存一次汇总表。界面需点名（商品：%s）",
                            _apid, _asum.get("total_delta", 0),
                            _asum.get("product_name") or "")
                        continue
                    if not _asum.get("fully_applied"):
                        _lgx.warning(
                            "v277 加单未分满 product=%s 总量=%.3f 实分=%.3f 缺口=%.3f"
                            "（占比缺口 %.3f + 报量不足 %.3f）依据=%s",
                            _apid, _asum.get("total_delta", 0), _asum.get("allocated", 0),
                            _asum.get("unassigned", 0), _asum.get("ratio_gap", 0),
                            _asum.get("clip_gap", 0), _asum.get("basis") or "target")
            # 2026-08-27：经理保存汇总表即完成审批 → 落本期次确认标记（老板进汇总表看数据可一眼区分草稿/已定稿）。
            uname = (u.get("display_name") or u.get("username") or "经理")
            conn.execute(
                "INSERT INTO forecast_period_confirm (period_start, period_end, confirmed_by, confirmed_at) "
                "VALUES (?,?,?,datetime('now','localtime')) "
                "ON CONFLICT(period_start, period_end) DO UPDATE SET confirmed_by=excluded.confirmed_by, confirmed_at=datetime('now','localtime')",
                (start, end, uname),
            )
            # v213-B1：保存**后**的新指纹 —— 必须在**本事务连接上**算，并且是在 commit 之前。
            #   ① 前端接着改不用重新载入：下一次保存拿它当 base_rev（否则自己刚存完就成
            #      「过期版本」，第二次保存必然 409 = 自己和自己冲突）。
            #   ② 用 `db_conn=conn` 而不是另开读连接：避免与未提交的写事务互锁，
            #      也保证读到的是**本次写入之后**的状态（另开连接在极端情况下会读到旧快照）。
            _new_rev = db.forecast_matrix_rev(period_id=pid, start_date=start, end_date=end, db_conn=conn)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"保存失败: {str(e)[:120]}")
    # ── v318：**保存不再发加单/减单通知** ─────────────────────────────────────
    # 推送出口已唯一化到「关闭期次（= 定稿）」：`routers/forecast.py::close_period`
    #   → `routers/product_targets.py::notify_extra_allocs_finalized()`。
    # 🔴 为什么从这里**撤掉**（原 v277 需求 7 的行为）：保存是草稿动作，经理每改一轮保存一次
    #    ⇒ 通知发一次 = 收件箱被草稿刷屏；而真正的终态「关闭期次」此前一条都不发。
    #    另：旧实现把 `employee_id` 当 `users.id` 用，会**静默错投**（详见上方 731 行那段说明）。
    # ⚠️ 不要"顺手"在这里再补一条回执通知 —— 需要回执就把明细做进「关闭期次」的确认弹窗。
    _notified = 0                           # 回执键保留（旧前端读它），语义改为「本动作不发通知」
    # ── v305（2026-09-28）：**授权改单留痕** —— 与上面同样必须在事务提交之后 ──────
    # 🔴 为什么必须留痕：`allow_closed` 把「关闭 = 定稿」这道硬锁**收窄成「只锁销售」**。
    #    如果不记名，"定稿"就退化成一句空话 —— 而"关闭之后偷偷能改"正是 v219 当初要消灭的形态。
    #    两个出口缺一不可：
    #      ① journald 逐次留痕（可 grep、可做监控规则 —— R8：不留痕的话「改过」与「没改过」
    #         在日志里长得一模一样）
    #      ② 站内通知中心（人看得见）。⚠️ 站内信去重按 `(title, msg_type, recipients)`+24h+未读
    #         （见 `db/queries/finance.py::message_send`）⇒ 同一天多次改会被**合并成一条**
    #         并累加 `dup_count`。这是有意的：正文说的是"改过"，精确逐次记录走 ①。
    if _closed_edit:
        print("[v305][closed-edit] 期次#%s（%s~%s）被授权修改：by=%s role=%s 客户列=%s 明细行=%s"
              % (pid, start, end, uname, _u_role, saved_customers, saved_items))
        try:
            db.message_send(
                "已关闭期次被修改",
                "%s 修改了**已关闭**的报单期次（%s ~ %s）：客户列 %d、明细行 %d。\n"
                "关闭后的修改属授权操作（仅管理员 / 老板 / 主管 / 财务文员），已留痕。"
                % (uname or "管理员", start, end, saved_customers, saved_items),
                "notice", "系统",
                event_key="forecast_closed_edit_%s" % pid,
            )
        except Exception as _ce_e:
            import logging as _lg2
            _lg2.getLogger("hergent").warning("v305 授权改单留痕失败（保存已成功）：%s", _ce_e)
    return {"success": True, "saved_customers": saved_customers, "saved_items": saved_items,
            # v741：本次落下的「主管减单」负数明细条数。旧前端不读这个键，无副作用。
            "saved_adjusts": saved_adjusts,
            # v305：本次是否为「授权改单」（关单后由管理员/老板/主管修改）。前端据此提示"已留痕"。
            #   旧前端不读这个键，无副作用。
            "closed_edit": _closed_edit,
            # v264c（2026-09-24）R9：本次保存里**列名没能解析成报单对象**的客户列。
            #   空数组 = 全部解析成功。旧前端不读这个键，无副作用。
            #   为什么必须在回执里给：这些列落库后 `store_id=0` ⇒「逐人实报」只能靠名字，
            #   改名即断链。用户在保存这一刻看到名单，就能去「报单配置」里补映射。
            "unmapped_columns": _unmapped_cols,
            # v199：隐藏名册当前总条数 —— 让「列是不是真的被隐去了」在回执里就能看到，
            #   不必再回数据库查（前端保存后的 toast 也只报客户/明细数，这里只作诊断用）。
            "hidden_units": hidden_total,
            # v213-B1：保存后的矩阵指纹/时刻（见上方注释）。旧前端不读这两个键，无副作用。
            "matrix_rev": _new_rev.get("rev") or "",
            "matrix_at": _new_rev.get("at") or "",
            "order_date": start, "confirmed": {"by": uname},
            # v277（需求 6 / 需求 7）：本次保存算出的加/减单分配结果 + 实际发出的通知条数。
            #   前端用它做「保存后回执」与加单列悬停说明；旧前端不读这个键，无副作用。
            "extra_alloc": _extra_alloc_summary,
            # v612：本期商品清单（= 小程序报单页的商品来源）同步结果。
            #   前端据此提示「小程序可见的商品已更新 / 移除了 N 个」；旧前端不读，无副作用。
            "list_added": _list_added, "list_removed": _list_removed,
            "list_sync_error": _list_err,
            "notified": _notified}


# ---- 撤回：报单人撤回本人预报（审批流已下线，见下注） ----
# 2026-09-07 下线：GET /pending、POST /{sid}/approve、POST /{sid}/reject 三个审批端点已删除。
# 原因：业务口径错误——经销商以「经销商」为单位向厂家下单，不存在按门店逐单采购，
# 原 approve 会按门店生成一张采购申请单（reason 写死"门店：X"），与真实业务不符；
# 且正确的「本期汇总审核/定稿」能力已在 Web 端 /api/forecast-audit/audit-period（期次维度）。
# 审批态不再是汇总表的门槛：pending 状态的报单本就直接计入汇总（summary 仅排除 rejected/recalled）。

@router.post("/{sid}/recall")
def recall_submission(sid: int, request: Request):
    """员工撤回本人预报单（仅 pending 可撤回）；管理员/老板/督导可撤回任意 pending。"""
    u = _auth(request)
    # 截止硬锁：期次已定稿/已过期 ⇒ 不允许再改动（含撤回）。管理员同样受锁，需先重开期次。
    try:
        with db.get_db() as _c:
            _sub = _c.execute(
                "SELECT id, period_id FROM forecast_submissions WHERE id=?", (sid,)
            ).fetchone()
    except Exception:
        _sub = None
    if _sub:
        _wok, _wreason = db.forecast_period_writable(int((dict(_sub).get("period_id") or 0)))
        if not _wok:
            raise HTTPException(400, _wreason)
    # v757：把「我的报单范围」一并交给判据 —— 与 `create_submission` 的越权校验
    #   走同一个 `report_subject_stores`（能报这单的人就能撤这单）。
    #   不给这段 ⇒ 导购报进主管导入行之后，永远撤不了自己的单（2026-11-04 报障）。
    _scopes = []
    try:
        _k, _s = db.report_subject_of(u)
        if _k:
            _scopes = db.report_subject_stores(_k, _s) or []
    except Exception:
        _scopes = []
    result = db.forecast_submission_recall(sid, user_id=int(u.get("id") or 0),
                                           role=u.get("role", ""), store_scopes=_scopes)
    if not result.get("success"):
        raise HTTPException(400, result.get("detail", "撤回失败"))
    return {"ok": True, **result}


@router.post("/{sid}/delete")
def delete_submission(sid: int, request: Request):
    """v259：报单人删除**本人**的预报单（硬删除，连同明细）。

    与 `/{sid}/recall` 的关系：撤回是软删（留痕、可追溯），本接口是硬删（不可逆）。
    小程序「我的提交」列表左滑删除走这里。

    权限：**只认本人**（`forecast_submission_delete` 内部判定），不看 role ——
    与撤回不同（撤回允许管理员代劳），因为删除不可逆，放开等于让督导能抹掉销售的单据。

    截止硬锁：与撤回**同一判据** `forecast_period_writable`，在**本路由层**统一执行
    （不放在 db 层）—— 锁是「写入口」语义，与谁调用无关，三处各判一次迟早分叉。
    期次已定稿/已截止 ⇒ 400，前端（`can_delete`）会提前不给入口，这里是第二道。
    """
    u = _auth(request)
    # 截止硬锁：期次已定稿/已过期 ⇒ 不允许再改动（含删除）。管理员同样受锁，需先重开期次。
    try:
        with db.get_db() as _c:
            _sub = _c.execute(
                "SELECT id, period_id FROM forecast_submissions WHERE id=?", (sid,)
            ).fetchone()
    except Exception:
        _sub = None
    if _sub:
        _wok, _wreason = db.forecast_period_writable(int((dict(_sub).get("period_id") or 0)))
        if not _wok:
            raise HTTPException(400, _wreason)
    result = db.forecast_submission_delete(sid, user_id=int(u.get("id") or 0), role=u.get("role", ""))
    if not result.get("success"):
        raise HTTPException(400, result.get("detail", "删除失败"))
    return {"ok": True, **result}


# ---- 员工账号与门店（老板在 Web 端配置） ----
@router.post("/staff-accounts")
async def create_staff_account(request: Request):
    """为员工开登录账号：{employee_id, username, password, display_name, role}"""
    _admin(request)
    d = await request.json()
    emp_id = int(d.get("employee_id") or 0)
    username = (d.get("username") or "").strip()
    password = (d.get("password") or "").strip()
    if not username:
        raise HTTPException(400, "账号必填")
    # 🔴 v289（2026-09-27）：密码策略**归一**。原来这里写的是「长度至少 4 位」判断 ——
    #    全系统唯一一处**真能用 4 位**建号的入口，比登录门槛（≥8 位且含字母数字）还低，
    #    等于给"老板代开的员工账号"配了一个比普通登录更弱的密码。
    #    同型改动 v254 只修了「老板重置密码」那一处、**漏了这里**（两处拷贝、改一处漏一处）
    #    ⇒ 本次收敛到唯一实现 `core._validate_password`：以后改策略只改 core 那一个函数。
    from core import normalize_role, role_reject_detail, _validate_password
    _ok, _msg = _validate_password(password)
    if not _ok:
        raise HTTPException(400, _msg)
    # 🔴 2026-09-19：角色白名单（判据唯一来源 = core.normalize_role）。
    #    此前 `d.get("role","staff")` 直接透传 → 传 admin/boss 就凭空造出一个全权限账号。
    #    缺省仍是 staff（最小权限角色），但**显式给的非法值一律拒**，不再静默落库。
    role = normalize_role(d.get("role", "staff"))
    if not role:
        raise HTTPException(400, role_reject_detail(d.get("role")))
    # v307 登录范围：**显式给的非法值一律拒 400**，不静默兜底成 both —— 静默兜底正是
    #   「界面显示保存成功、实际没生效」这类最难查故障的成因。
    # v310：**不传 ⇒ 按角色取默认值**（业务员/分销商/员工 = 仅小程序），唯一源
    #   = `core.default_login_scope_for_role`；以前这里硬写 "both"，于是「后端默认」
    #   与「前端下拉默认值」是两套口径 —— 前端没传就等于绕过收紧。
    from core import normalize_login_scope as _norm_scope
    from core import default_login_scope_for_role as _default_scope
    raw_scope = d.get("login_scope")
    if raw_scope is None or not str(raw_scope).strip():
        login_scope = _default_scope(role)
    else:
        login_scope = _norm_scope(raw_scope, default=None)
        if not login_scope:
            raise HTTPException(400, "登录范围不合法：%s。可选：mini（仅小程序）、web（仅网页端）、both（两端）" % raw_scope)
    # v308 外部客户（分销商）：`external_ref` 非空 ⇒ 跳过员工校验（外部客户没有员工档案）。
    # 角色闸门在 `staff_account_create` 内部（只允许 distributor），此处不重复判。
    external_ref = str(d.get("external_ref") or "").strip()
    return db.staff_account_create(emp_id, username, password, d.get("display_name", ""), role,
                                   login_scope=login_scope, external_ref=external_ref)


@router.get("/stores")
def my_stores(request: Request):
    """我的可报对象（当前员工绑定的填报范围：门店 + 本人仓）。

    ⚠️ v294：每项形如 `{id, name, kind}`，`kind` ∈ 'store' | 'warehouse'。
    客户端**必须**把 kind 原样回传（提交时的载荷 `store.kind`）——
    只回传 id 会让「门店 5」与「仓库 5」在服务端无法区分（详见 store_kind 列说明）。
    """
    u = _auth(request)
    # 2026-09-15：改走唯一实现（同上）。取不到 = 无员工身份 → 落到下方 boss/admin 回退分支。
    # v317（2026-09-29）：改走**报单主体**唯一实现 —— 外部客户（分销商）账号 `employee_id` 恒 0，
    #   在旧实现下**必然**落到「不是我负责的」分支拿空数组 ⇒ 客户能登录、下拉恒空
    #   （本次需求的原点：报单配置里配了也没用，因为读端根本不认这种主体）。
    _kind, _subj = db.report_subject_of(u)
    if _kind:
        return {"ok": True, "stores": db.report_subject_stores(_kind, _subj) or []}
    # 回退：boss/admin 看全部客户。
    # ⚠️ 这里**有意不并入本人仓**：本分支没有员工身份 ⇒ 没有「他的个人仓」概念，
    #    而老板的报单走 Web 矩阵（按简称列），不需要这个下拉。硬塞进来只会造出
    #    「下拉里能选、但没有对应报单配置」的假可选项。
    if u.get("role") in ("admin", "boss"):
        with db.get_db() as c:
            rows = c.execute("SELECT id, name FROM contacts WHERE type IN ('customer','both') AND is_active=1 ORDER BY id").fetchall()
            return {"ok": True, "stores": [{"id": r["id"], "name": r["name"], "kind": "store"} for r in rows]}
    return {"ok": True, "stores": []}


@router.put("/staff/{employee_id}/stores")
async def set_staff_stores(employee_id: int, request: Request):
    """老板配置员工门店：{store_ids: [1,2,3]}"""
    _admin(request)
    # D4 修复 (2026-07-24)：空 body / 非 JSON 兜底；store_ids 非数字安全转换（跳过），
    # 全非法时 400 明确报错，杜绝 ValueError→500。
    try:
        d = await request.json()
    except Exception:
        d = {}
    if not isinstance(d, dict):
        d = {}
    raw_ids = d.get("store_ids") or []
    if not isinstance(raw_ids, list):
        raw_ids = [raw_ids]
    ids = []
    for x in raw_ids:
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            continue
    if not ids:
        raise HTTPException(400, "store_ids 必须为门店 id 列表（非数字已忽略，全非法时拒绝）")
    return db.employee_stores_set(employee_id, ids)


@router.get("/staff/{employee_id}/stores")
def get_staff_stores(employee_id: int, request: Request):
    """查员工门店配置。"""
    _admin(request)
    return {"ok": True, "stores": db.employee_stores_get(employee_id)}


@router.get("/all-stores")
def all_stores(request: Request):
    """全部可填报门店（老板绑门店用）。

    ⚠️ v294：仍然**只列 contacts**（不含本人仓）—— 本接口喂的是「员工 × 门店」的
    历史授权（`employee_stores`，键就是 contacts.id），塞进仓库 id 会直接写脏那张表。
    本人仓的归属由**报单配置**表达，不经过这里。
    每项补 `kind: 'store'` 只为让形状与 `/stores` 一致，避免调用方两处解包。
    """
    _admin(request)
    with db.get_db() as c:
        rows = c.execute(
            "SELECT id, name FROM contacts WHERE type IN ('customer','both') AND is_active=1 ORDER BY name"
        ).fetchall()
        return {"ok": True, "stores": [{"id": r["id"], "name": r["name"], "kind": "store"} for r in rows]}
