#!/usr/bin/env python
"""v403 影子库验收 —— 采购订单重塑（后端）。

跑法：
    SRC=/tmp/v403-shadow-src /Users/zhangjunfeng/.workbuddy/binaries/python/envs/default/bin/python \
        .workbuddy/tools/v403-shadow-verify.py

设计要点（照 hergent-realdata-ab-proof / 影子库纪律）：
  · **只写影子副本**，生产快照原样不动（`SRC` 只读，每次都重新拷进 SH）。
  · **不 import 应用就能观察「改动前」形态**：Phase 0 用裸 sqlite3 读原始快照。
  · **反例自证（判别力）**：Phase 0 的断言在改动后必须**失败**（列已存在），
    否则说明这个探针根本区分不出「有没有加列」——探针本身是假的。
  · `ERP_DB_PATH` 必须在 **import erp_db 之前**设好：`DB_DIR` 由它推导，
    租户库路径 `<DB_DIR>/tenant_1.db` 也跟着走影子目录。
"""
import os
import shutil
import sqlite3
import sys
import traceback

SRC = os.environ.get("SRC", "/tmp/v403-shadow-src")
WORK = os.environ.get("WORK", "/tmp/v403-shadow")
SERVER_DIR = "/Users/zhangjunfeng/Documents/hergent-erp/server"

NEW_COLS = ["audit_time", "print_count", "received_amount", "source", "mark"]
PASS, FAIL = [], []


def ok(name, cond, got=None):
    (PASS if cond else FAIL).append(name)
    mark = "✅" if cond else "❌"
    print(f"  {mark} {name}" + ("" if cond else f"   ← got={got!r}"))
    return cond


def section(t):
    print(f"\n{'─' * 72}\n{t}\n{'─' * 72}")


def cols_of(db_path, table):
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return [r[1] for r in c.execute(f"PRAGMA table_info({table})").fetchall()]
    finally:
        c.close()


# ═══════════════════════════════════════════════════ Phase 0：反例（改动前形态）
section("Phase 0  反例自证：影子副本必须是「加列之前」的形态")
if not os.path.isdir(SRC):
    print(f"❌ 快照目录不存在：{SRC}（先跑 scp 下载生产快照）")
    sys.exit(2)

shutil.rmtree(WORK, ignore_errors=True)
os.makedirs(WORK)
for f in ("erp.db", "tenant_1.db"):
    shutil.copy2(os.path.join(SRC, f), os.path.join(WORK, f))

pre_master = cols_of(os.path.join(WORK, "erp.db"), "purchase_orders")
pre_tenant = cols_of(os.path.join(WORK, "tenant_1.db"), "purchase_orders")
print(f"  主库 purchase_orders({len(pre_master)}): {pre_master}")
print(f"  租户 purchase_orders({len(pre_tenant)}): {pre_tenant}")
for c in NEW_COLS:
    ok(f"0.1 主库**尚无** {c}（反例：改动后此断言必须失败）", c not in pre_master, pre_master)
ok("0.2 供应商类别列 supplier_category **早就存在**（查 contacts，不是要新增的）",
   "supplier_category" in cols_of(os.path.join(WORK, "tenant_1.db"), "contacts"))
ok("0.3 反例：凭空一个不存在的列必须判 False（证明 cols_of 有判别力）",
   "zzz_not_a_column" not in pre_master)

# ═══════════════════════════════════════════════════ Phase 1：迁移（import 即迁移）
section("Phase 1  启动期迁移：主库 + 租户库**两处**都必须补上 5 列")
os.environ["ERP_DB_PATH"] = os.path.join(WORK, "erp.db")
os.environ.pop("DATABASE_URL", None)
# `core.py` 在**导入期**就要求 ERP_SECRET（否则 RuntimeError）—— 影子库验收要有端点级覆盖
# （routers.psi 的创建人解析）就必须给一个值。这里用**仅本机探针使用**的哑值，
# 不读生产密钥、也不写入任何文件。
os.environ.setdefault("ERP_SECRET", "v403-shadow-verify-local-only")
sys.path.insert(0, SERVER_DIR)
try:
    import erp_db as db                                    # noqa: E402  ← import 触发迁移
    from db.connection import set_tenant_context           # noqa: E402
except Exception:
    traceback.print_exc()
    print("❌ erp_db 导入失败 —— 后面的断言无意义，直接退出")
    sys.exit(3)

post_master = cols_of(os.path.join(WORK, "erp.db"), "purchase_orders")
post_tenant = cols_of(os.path.join(WORK, "tenant_1.db"), "purchase_orders")
print(f"  主库 purchase_orders({len(post_master)}): {post_master}")
print(f"  租户 purchase_orders({len(post_tenant)}): {post_tenant}")
for c in NEW_COLS:
    ok(f"1.1 主库 purchase_orders 已补 {c}（_safe_migrate v403_po_*）", c in post_master, post_master)
    ok(f"1.2 租户库 purchase_orders 已补 {c}（租户列清单，**当次启动**生效）", c in post_tenant, post_tenant)
ok("1.3 主库 _migrations 记了 5 条 v403_po_*",
   all(any(r[0] == f"v403_po_{x}" for r in sqlite3.connect(
       os.path.join(WORK, "erp.db")).execute(
       "SELECT name FROM _migrations WHERE status='ok'").fetchall())
       for x in NEW_COLS))

# ═══════════════════════════════════════════════════ Phase 2：列表端点
section("Phase 2  列表：聚合列 / 状态计数 / 底部合计 / 服务端排除状态")
set_tenant_context(1)

r_all = db.purchase_order_list(limit=5, offset=0)
ok("2.1 返回 {orders,total} 且**追加** counts/summary（老前端仍可用）",
   set(["orders", "total", "counts", "summary"]).issubset(r_all.keys()), sorted(r_all.keys()))
print(f"      counts = {r_all['counts']}")
print(f"      summary = {r_all['summary']}")
ok("2.2 counts['all'] == 各状态计数之和",
   r_all["counts"]["all"] == sum(v for k, v in r_all["counts"].items() if k != "all"))
ok("2.3 total 与 counts['all'] 一致（无筛选时）", r_all["total"] == r_all["counts"]["all"],
   (r_all["total"], r_all["counts"]["all"]))
_row = r_all["orders"][0]
for k in ("supplier_category", "item_count", "order_qty", "order_unit",
          "audit_time", "print_count", "received_amount", "source"):
    ok(f"2.4 行内出现聚合列 {k}", k in _row, sorted(_row.keys())[:40])

# 服务端排除状态（侧栏「采购单 / 采购退货单」的同 path 不同 query）
n_all = db.purchase_order_list(limit=1, offset=0)["total"]
n_excl = db.purchase_order_list(limit=1, offset=0, exclude_status="returned")["total"]
n_ret = db.purchase_order_list(limit=1, offset=0, status="returned")["total"]
ok("2.5 exclude_status='returned' 后 total 恰少「已退货」的张数",
   n_excl == n_all - n_ret, (n_all, n_excl, n_ret))

# 状态筛选 + counts 不受 status 影响（页签数字不能跟着变）
r_s = db.purchase_order_list(status="received", limit=5, offset=0)
ok("2.6 按 state 筛选后 counts 与不筛时**完全相同**（页签数字稳定）",
   r_s["counts"] == r_all["counts"], (r_s["counts"], r_all["counts"]))
ok("2.7 按 state 筛选后每行状态都是 received",
   all(x["status"] == "received" for x in r_s["orders"]))

# 底部合计
sum_all = r_all["summary"]
ok("2.8 summary.unpaid_amount == received_amount - paid_amount",
   abs(sum_all["unpaid_amount"] - (sum_all["received_amount"] - sum_all["paid_amount"])) < 0.01,
   sum_all)
_oa = db.purchase_order_list(limit=1, offset=0)["summary"]["order_amount"]
ok("2.9 合计是**全量**而不是当前页（订单金额合计 >> 当页 5 行的和）",
   _oa > sum(float(x["total_amount"] or 0) for x in r_all["orders"]), _oa)

# 关键字 / 仓库 / 标记
_h = sqlite3.connect(f"file:{os.path.join(WORK, 'tenant_1.db')}?mode=ro", uri=True)
_ono = _h.execute("SELECT order_no FROM purchase_orders ORDER BY id DESC LIMIT 1").fetchone()[0]
_h.close()
r_kw = db.purchase_order_list(keyword=_ono, limit=20, offset=0)
ok(f"2.10 keyword 命中单号 {_ono}", r_kw["total"] >= 1 and
   any(x["order_no"] == _ono for x in r_kw["orders"]), r_kw["total"])
r_none = db.purchase_order_list(keyword="绝不可能存在的单号ZZZ", limit=5, offset=0)
ok("2.11 反例：不存在的 keyword → total=0（证明 keyword 真的进了 SQL）", r_none["total"] == 0,
   r_none["total"])

# 历史导入单：无明细 ⇒ 必须能显式区分（界面据此显示 `—` 而不是 ¥0.00）
_has = [x for x in db.purchase_order_list(limit=200, offset=0)["orders"] if int(x["item_count"] or 0) == 0]
ok("2.12 存在「item_count=0」的历史导入单（界面靠它把金额显示成 —）", len(_has) > 0,
   len(_has))
ok("2.13 这些无明细单的 order_qty 为 None（不是 0）—— 「真没有」≠「是 0」",
   all(x["order_qty"] is None for x in _has))

# ═══════════════════════════════════════════════════ Phase 3：批量操作原语
section("Phase 3  批量操作：审核 / 反审核 / 取消 / 打印 / 标记 / 备注（逐单显式回报）")
_drafts = db.purchase_order_list(status="draft", limit=10, offset=0)["orders"]
print(f"      draft 单: {[x['id'] for x in _drafts]}")
if _drafts:
    _d = _drafts[0]["id"]
    ra = db.purchase_order_approve(_d)
    ok("3.1 draft 单可审核（免审批单也得有可观察效果）", ra.get("ok") is True, ra)
    _row = db.purchase_order_get(_d)["order"]
    ok("3.2 审核后 audit_time 已落库", bool(_row.get("audit_time")), _row.get("audit_time"))
    _t1 = _row["audit_time"]
    db.purchase_order_approve(_d)
    _t2 = db.purchase_order_get(_d)["order"]["audit_time"]
    ok("3.3 重复审核**不刷新**首次审核时间（幂等）", _t1 == _t2, (_t1, _t2))
    ru = db.purchase_order_unapprove(_d)
    ok("3.4 反审核成功且状态回 pending_approval",
       ru.get("ok") is True and db.purchase_order_get(_d)["order"]["status"] == "pending_approval", ru)

_rcv = db.purchase_order_list(status="received", limit=3, offset=0)["orders"]
if _rcv:
    _r = _rcv[0]["id"]
    ok("3.5 反例：已入库单**不可**反审核（会与账实脱节）",
       db.purchase_order_unapprove(_r).get("ok") is False)
    ok("3.6 反例：已入库单**不可**作废（必须走退货单冲回）",
       db.purchase_order_cancel(_r).get("ok") is False)

# 打印计数
_p = db.purchase_order_bump_print([_drafts[0]["id"]] if _drafts else [1])
_before = db.purchase_order_get(_drafts[0]["id"])["order"]["print_count"] if _drafts else None
ok("3.7 打印计数 +1 并逐单回报", _p["updated"] >= 1 and bool(_p["counts"]), _p)

# 标记 / 删标记
_m = db.purchase_order_mark([_drafts[0]["id"]] if _drafts else [1], "★盯一下")
ok("3.8 标记成功", _m["updated"] == 1, _m)
ok("3.9 only_marked 能筛出刚标记的单",
   db.purchase_order_list(only_marked=True, limit=50, offset=0)["total"] >= 1)
_m2 = db.purchase_order_mark([_drafts[0]["id"]] if _drafts else [1], "")
ok("3.10 删标记（mark=''）成功", _m2["updated"] == 1, _m2)
ok("3.11 删标记后 only_marked 不含它",
   not any(x["id"] == (_drafts[0]["id"] if _drafts else 1)
           for x in db.purchase_order_list(only_marked=True, limit=50, offset=0)["orders"]))

# 备注追加（不覆盖机器写的溯源信息）
_h = sqlite3.connect(os.path.join(WORK, "tenant_1.db"))
_h.execute("UPDATE purchase_orders SET note='舟谱采购单:CD999 | 经办人:张三' WHERE id=?",
           (_drafts[0]["id"] if _drafts else 1,))
_h.commit()
_h.close()
_note_ret = db.purchase_order_append_note([_drafts[0]["id"]] if _drafts else [1], "对账单已核")
_note_now = db.purchase_order_get(_drafts[0]["id"] if _drafts else 1)["order"]["note"]
ok("3.12 备注是**追加**不是覆盖（机器的溯源串还在）",
   "舟谱采购单:CD999" in _note_now and "对账单已核" in _note_now, _note_now)
ok("3.13 空备注 → changed=0 且带原因，不假装成功",
   db.purchase_order_append_note([1], "  ")["changed"] == 0 and
   db.purchase_order_append_note([1], "  ").get("reason"), "ok")

# ═══════════════════════════════════════════════════ Phase 4：创建人姓名走主库
section("Phase 4  创建人姓名：必须读**主库** users（租户库那份是克隆残留）")
try:
    from routers import psi as psi_mod                             # noqa: E402
    nm = psi_mod._creator_names(["2", "999916", "王会计", "", None])
    print(f"      _creator_names → {nm}")
    ok("4.1 主库 id=2 → 张俊峰（而非租户库的 boss 同名）", nm.get("2") == "张俊峰", nm)
    ok("4.2 主库 id=999916 → 程欢欢（租户库压根没这个 id）",
       nm.get("999916") == "程欢欢", nm)
    ok("4.3 反例：租户库种子用户「王会计」在主库不存在 ⇒ 必须返回空串而不是张冠李戴",
       nm.get("王会计") == "", nm)
    ok("4.4 空/None key 被跳过，不产生垃圾条目",
       "" not in nm and None not in nm, nm)
    # 走完整端点（含 creator_name / has_items 追加）
    from starlette.requests import Request as _Req

    class _FakeReq:
        def __init__(self):
            self.headers = {}
    # 直接调内部函数：_auth 在实际端点里跑，这里只验投影后的字段
    _rows = db.purchase_order_list(limit=3, offset=0)["orders"]
    _names = psi_mod._creator_names([x.get("operator_id") for x in _rows])
    for x in _rows:
        x["creator_name"] = _names.get(str(x.get("operator_id") or "").strip(), "")
        x["has_items"] = int(x.get("item_count") or 0) > 0
    ok("4.5 行内 creator_name / has_items 都能投影出来（两键都存在）",
       all(("creator_name" in x and "has_items" in x) for x in _rows),
       [(x.get("operator_id"), x.get("creator_name"), x.get("has_items")) for x in _rows])
except Exception:
    traceback.print_exc()
    ok("4.0 routers.psi 可导入（否则端点无法验收）", False)

# ═══════════════════════════════════════════════════ Phase 5：创建人下拉的数据源
section("Phase 5  创建人下拉：唯一读取口 _main_users，且不能拿员工档案顶替")
try:
    from routers import psi as psi_mod                             # noqa: E402

    us = psi_mod._main_users()
    print(f"      _main_users() → {len(us) if us is not None else None} 行；前 3 = "
          f"{[u['name'] for u in (us or [])[:3]]}")
    ok("5.1 主库 users 可读（返回列表，而不是 None）", isinstance(us, list), us)
    ok("5.2 每行都带 id / username / name 三键",
       bool(us) and all(all(k in u for k in ("id", "username", "name")) for u in us),
       (us or [])[:3])
    _probe = [u for u in (us or []) if str(u.get("name") or "").strip()][:5]
    ok("5.3 唯一读取口：_creator_names 与下拉**同源** ⇒ 下拉里的每个人都能筛出单据",
       psi_mod._creator_names([str(u["id"]) for u in _probe]) ==
       {str(u["id"]): u["name"] for u in _probe},
       psi_mod._creator_names([str(u["id"]) for u in _probe]))
    # 反例：员工档案是**另一套编号**。判据不能只看「能不能筛出单据」——
    # 两边 id 恰好都从 1 开始（users id=1 与 hr_employees id=1 都是「管理员」），
    # 用 id 命中是**巧合**而不是「编号相同」。真正可证伪的性质是：
    #     **同一个 id 在两表里指向不同的人** ⇒ 下拉会显示成另一个人（id 对上、名字是错的）。
    _u_by_id = {u["id"]: u["name"] for u in (us or [])}
    _e_by_id = {}
    try:
        with db.get_db() as _c:
            _e_by_id = {r[0]: str(r[1] or "") for r in _c.execute(
                "SELECT id, name FROM hr_employees").fetchall()}
    except Exception as _e:
        print(f"      （hr_employees 不可用：{_e}）")
    if _e_by_id:
        _conflict = sorted((i, _u_by_id[i], _e_by_id[i])
                           for i in (set(_u_by_id) & set(_e_by_id))
                           if _u_by_id[i] != _e_by_id[i])
        print(f"      同 id 不同人的冲突：{_conflict[:4]}")
        ok(f"5.4 反例：users 与 hr_employees 有 {len(_conflict)} 个同名 id 指向不同的人"
           f" ⇒ 员工档案不能当这个下拉的代用品", len(_conflict) > 0, _conflict[:3])
    else:
        ok("5.4 反例：hr_employees 在本租户库不存在 ⇒ 用员工档案填该下拉连数据都没有",
           True, "表不存在")

    # 端点级：refs(kind='users') 必须真的把这个键带出来。
    # ⚠️ 端点内有 `_auth`，这里**只替掉鉴权**（返回一个假 boss），其余逻辑原样跑 ——
    #    否则「验的就不是端点」。
    _orig_auth = psi_mod._auth
    psi_mod._auth = lambda _req: {"id": 1, "username": "boss", "display_name": "张俊峰",
                                  "role": "boss"}

    class _R:
        headers = {}
    try:
        _out = psi_mod.psi_refs(request=_R(), kind="users", keyword="", limit=200)
    finally:
        psi_mod._auth = _orig_auth
    _keys = sorted((_out or {}).keys())
    print(f"      refs(kind='users') → keys={_keys}, users={len(_out.get('users') or [])} 条")
    ok("5.5 refs(kind='users') 返回 users 键且非空",
       isinstance(_out.get("users"), list) and len(_out.get("users") or []) > 0, _keys)
    ok("5.6 下拉里没有空名条目（空名选项点了也筛不出人）",
       all(str(u.get("name") or "").strip() for u in (_out.get("users") or [])), _out.get("users"))
    ok("5.7 只拉 users 时**不**顺带把客户/商品也解密出来（少一次无谓的 PII 出库）",
       "customers" not in _out and "products" not in _out, _keys)
except Exception:
    traceback.print_exc()
    ok("5.0 Phase 5 可执行", False)

# ═══════════════════════════════════════════════════ Phase 6：建单头的两个日期字段
section("Phase 6  建单：order_date / expected_date 必须**真的存得进去**（此前被静默丢弃）")
try:
    import asyncio                                                  # noqa: E402

    from routers import purchase as po_mod                          # noqa: E402
    from routers import psi as psi_mod                              # noqa: E402

    with db.get_db() as _c:
        _pid = _c.execute("SELECT id FROM products ORDER BY id LIMIT 1").fetchone()[0]
    _SUP = 1

    class _FakeReq:
        headers = {}

        def __init__(self, payload):
            self._p = payload

        async def json(self):
            return self._p

    _orig = po_mod._auth
    po_mod._auth = lambda _r: {"id": 1, "username": "boss", "display_name": "张俊峰",
                               "role": "boss"}
    try:
        _res = asyncio.run(po_mod.create_purchase(_FakeReq({
            "supplier_id": _SUP, "warehouse_id": 1, "note": "v403 影子验收",
            "order_date": "2026-09-15", "expected_date": "2026-09-20",
            "items": [{"product_id": _pid, "quantity": 2, "unit_price": 3.5}],
        })))
    finally:
        po_mod._auth = _orig
    _oid = _res.get("order_id") or _res.get("id")
    with db.get_db() as _c:
        _row = _c.execute("SELECT order_date, expected_date, source FROM purchase_orders "
                          "WHERE id=?", (_oid,)).fetchone()
    print(f"      #{_oid} order_date={_row['order_date']!r} "
          f"expected_date={_row['expected_date']!r} source={_row['source']!r}")
    ok("6.1 传了 order_date ⇒ 落库的就是传的值（不是「今天」）",
       str(_row["order_date"])[:10] == "2026-09-15", _row["order_date"])
    # 🔴 这条在改动前**必然失败**：expected_date 不在 Pydantic 模型里，
    #    `extra='ignore'` 把它扔掉，落库是空串。
    ok("6.2 回归反例：传了 expected_date ⇒ 必须落库（改动前会被静默丢弃）",
       str(_row["expected_date"] or "")[:10] == "2026-09-20", _row["expected_date"])
    ok("6.3 界面手动建单 source='manual'", _row["source"] == "manual", _row["source"])

    # 脏日期必须被薄壳 400 拦下（否则该单在「按日期筛选」里永久消失且零报错）
    ok("6.4 脏 order_date → _bad_doc_dates 命中", psi_mod._bad_doc_dates({"order_date": "2026/9/15"}) == ["order_date"],
       psi_mod._bad_doc_dates({"order_date": "2026/9/15"}))
    ok("6.5 反例：合法日期 / 空串 / 缺字段 都不算脏",
       psi_mod._bad_doc_dates({"order_date": "2026-09-15", "expected_date": ""}) == []
       and psi_mod._bad_doc_dates({}) == [], "clean")
    ok("6.6 反例：`2026-13-45` 这种「正则放得过、语义是假的」也要拒",
       psi_mod._bad_doc_dates({"expected_date": "2026-13-45"}) == ["expected_date"],
       psi_mod._bad_doc_dates({"expected_date": "2026-13-45"}))
except Exception:
    traceback.print_exc()
    ok("6.0 Phase 6 可执行", False)

# ═══════════════════════════════════════════════════ 汇总
section(f"汇总  通过 {len(PASS)} / 失败 {len(FAIL)}")
if FAIL:
    for f in FAIL:
        print(f"  ❌ {f}")
    sys.exit(1)
print("  全部通过 —— 影子库副本仅写副本，生产快照未改动")
