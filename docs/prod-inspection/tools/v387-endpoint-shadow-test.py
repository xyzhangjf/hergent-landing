#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v387-endpoint-shadow-test.py —— 批次 1.2 行为级取证（**在服务器上跑，只碰 /tmp 快照**）

要证的三件事：
  【P0】**`POST /api/contacts {"type":"supplier"}` 到底落不落 `supplier`？**
       改动前它**恒落 `customer`**（HTTP 200 + 零报错，界面看不出）。本脚本把
       `routers/data.py::create_contact` 的**真源码**抽出来执行 ⇒ 端到端判据，不是读代码觉得对。
  【A】**新建供应商时填的 4 个格子（开户行 / 银行账号 / 供应商类别 / 营业执照号）真落库吗？**
       `contact_update` 的 allowed 里本来就有这 4 列、`contact_create` 没有 ⇒ v316 同族缺陷。
  【B】`contact_options(type='supplier')` 的候选里有没有 `supplier_category`。

🔴 判别力自证（防「碰巧对」）：脚本**同时**用【旧调用约定】和【真端点】各建一条，
   断言前者落 `customer`（**复现缺陷**）、后者落 `supplier`（**修复生效**）。
   若两条都落一样，说明本测试根本没有判别力 ⇒ 直接判 FAIL。

方法论（沿用 `server/tools/v361-realdata-ab-proof.py` 的范式）：
  · 真源码：`spec_from_file_location` 加载 `/opt/hergent-erp/db/queries/contacts.py` 真身；
    `ast` 抠出 `routers/data.py::create_contact` 的源码段后 `exec`。
  · 真数据：`sqlite3` **在线备份 API** 把生产库快照到 `/tmp/v387-snap.db`，全程只读源库。
  · 有意替身（**逐条声明，共 3 处，都不影响本结论**）：
      ① `db.connection.get_db` → 指向快照的上下文管理器（不指向生产库）；
      ② `crypto_utils.encrypt/decrypt_contact_dict` → 恒等 + 一个与生产无关的 dummy 密钥；
         （加密是否发生与本轮「type 落没落对 / 白名单收没收」正交）
      ③ `log_entity_changes` → no-op（不往快照写修改日志，避免污染比对）
  · 测试数据**全部为编造值**（`ZZ-selftest-*` / 假银行账号），不落任何真实供应商信息；
    跑完删快照 + 断言 `ZERO_RESIDUE`。

用法（服务器上）：python3 /tmp/v387-endpoint-shadow-test.py
"""
import ast
import contextlib
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import types

SRC = os.environ.get("V387_SRC", "/opt/hergent-erp")
PROD_DB = os.environ.get("V387_DB", os.path.join(SRC, "tenant_1.db"))
SNAP = os.environ.get("V387_SNAP", "/tmp/v387-snap.db")
DUMMY_SECRET = "v387-shadow-selftest-not-a-real-secret"

TESTS = []      # (name, ok, detail)
_IDS = []       # 本脚本建出来的行 id（收尾要删）


def ok(name, cond, detail=""):
    TESTS.append((name, bool(cond), detail))
    print(("  PASS  " if cond else "  FAIL  ") + name + ((" | " + str(detail)) if detail else ""))


def head(t):
    print("\n=== " + t + " ===")


# 🔴 安全闸门（沿用 v386 的范式，先于任何写）：本脚本**只允许**写 /tmp 下的快照。
#   本项目 v383 出过一次「清理沙箱时误删生产行」的 P0 事故，根因就是**以为在沙箱**。
#   ⇒ 把「我现在到底在写哪个库」做成硬断言，而不是靠人记得。
def safety_gate():
    real_snap = os.path.realpath(SNAP)
    prod_real = os.path.realpath(PROD_DB)
    bad = []
    if not real_snap.startswith("/tmp/"):
        bad.append("SNAP 不在 /tmp 下：%s" % real_snap)
    if real_snap == prod_real:
        bad.append("SNAP 与生产库是同一个文件！")
    if not os.path.exists(prod_real):
        bad.append("源库不存在：%s" % prod_real)
    return bad


# ─────────────────────────────────────────────── 真数据：在线备份取快照
def make_snapshot():
    if os.path.exists(SNAP):
        os.remove(SNAP)
    src = sqlite3.connect("file:%s?mode=ro" % PROD_DB, uri=True)
    dst = sqlite3.connect(SNAP)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    # 快照完整性自证：能 PRAGMA integrity_check 过 + 有 contacts 表
    c = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    integ = c.execute("PRAGMA integrity_check").fetchone()[0]
    n = c.execute("SELECT COUNT(*) FROM contacts").fetchone()[0]
    c.close()
    return integ, n


# ─────────────────────────────────────────────── 替身 ①：get_db → 快照
@contextlib.contextmanager
def get_db_shim():
    con = sqlite3.connect(SNAP)
    con.row_factory = sqlite3.Row
    try:
        yield con
    finally:
        con.close()


def install_stub_modules():
    """把 `db.connection` / `crypto_utils` / `db.queries.entity_logs` 换成本地替身，
    再加载 contacts.py 真身 —— 真源码 + 替身 I/O（三处替身见文件头）。"""
    pkg_db = types.ModuleType("db")
    pkg_db.__path__ = []                     # 声明为包，允许 db.queries 子模块
    pkg_q = types.ModuleType("db.queries")
    pkg_q.__path__ = []
    mod_conn = types.ModuleType("db.connection")
    mod_conn.get_db = get_db_shim
    mod_logs = types.ModuleType("db.queries.entity_logs")
    mod_logs.log_entity_changes = lambda *a, **k: None
    mod_crypto = types.ModuleType("crypto_utils")
    mod_crypto.SENSITIVE_FIELDS = {"phone", "phone2", "email", "wechat", "bank_account",
                                   "tax_id", "boss_phone"}
    # 替身 ②：恒等加解密（不引入真密钥；加密与"字段收没收"正交）
    mod_crypto.encrypt_contact_dict = lambda d: dict(d)
    mod_crypto.decrypt_contact_dict = lambda d: dict(d)
    mod_crypto.encrypt_value = lambda v: v
    mod_crypto.decrypt_value = lambda v: v
    sys.modules.update({
        "db": pkg_db, "db.queries": pkg_q, "db.connection": mod_conn,
        "db.queries.entity_logs": mod_logs, "crypto_utils": mod_crypto,
    })


def load_real(path, name):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def extract_function_source(path, func_name):
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func_name:
            return ast.get_source_segment(src, node)
    raise RuntimeError("function %s not found in %s" % (func_name, path))


# ─────────────────────────────────────────────── 执行「真端点体」
def build_endpoint(C):
    """把 routers/data.py 的 create_contact 真源码 exec 出来，只替换 5 个外设。"""
    body = extract_function_source(os.path.join(SRC, "routers", "data.py"), "create_contact")

    class _HTTPException(Exception):
        def __init__(self, status, detail=""):
            self.status_code = status
            self.detail = detail
            super().__init__("%s %s" % (status, detail))

    class _Req:      # 只作为 _auth/_json_body 的入参占位
        pass

    dbns = types.SimpleNamespace(contact_create=C.contact_create)

    ns = {
        "HTTPException": _HTTPException,
        "normalize_ctype": C.normalize_ctype,
        "db": dbns,
        "Val2": object,
        "Request": _Req,
        "_v": lambda model, d: None,          # Val2 是 extra="allow" 的空模型 ⇒ 校验恒过
        "_auth": lambda request: {"display_name": "v387-selftest", "username": "v387-selftest"},
    }
    # _json_body 是 async ⇒ 这里也必须是 async，返回当前待投喂的请求体
    state = {"body": {}}

    async def _json_body(request):
        return dict(state["body"])

    ns["_json_body"] = _json_body
    exec(compile(body, "<create_contact@routers/data.py>", "exec"), ns)
    return ns["create_contact"], state, _HTTPException


def call_endpoint(ep, state, payload):
    import asyncio
    state["body"] = dict(payload)
    return asyncio.get_event_loop().run_until_complete(ep(object()))


# ─────────────────────────────────────────────── 行工具
def rows_with_prefix(prefix):
    con = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute(
            "SELECT * FROM contacts WHERE name LIKE ? ORDER BY id", (prefix + "%",)).fetchall()]
    finally:
        con.close()


def contact_type_of(cid):
    con = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    try:
        r = con.execute("SELECT type FROM contacts WHERE id=?", (cid,)).fetchone()
        return None if r is None else r[0]
    finally:
        con.close()


def digest_of_preexisting_suppliers():
    """对「非本脚本建的行」的供应商做逐列摘要 —— 证明我们的写入没有副作用。"""
    con = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    con.row_factory = sqlite3.Row
    try:
        cols = [r[1] for r in con.execute("PRAGMA table_info(contacts)").fetchall()]
        h = hashlib.sha256()
        n = 0
        for r in con.execute(
                "SELECT * FROM contacts WHERE type IN ('supplier','both') "
                "AND name NOT LIKE 'ZZ-selftest-%' ORDER BY id").fetchall():
            h.update(("|".join("%s=%s" % (c, r[c]) for c in cols)).encode("utf-8"))
            n += 1
        return h.hexdigest(), n
    finally:
        con.close()


def main():
    print("### v387 批次 1.2 行为级取证（真源码 + 真租户库快照）")

    head("0. 安全闸门 + 快照")
    bad = safety_gate()
    ok("安全闸门：写目标在 /tmp 且不等于生产库", not bad, bad)
    if bad:
        print("!! 闸门未过，拒绝继续（绝不在这种状态下写任何库）")
        return 3
    integ, n_before_all = make_snapshot()
    ok("快照 integrity_check = ok", integ == "ok", integ)
    ok("快照 contacts 行数 > 0", n_before_all > 0, n_before_all)
    ok("快照源 = 生产库（不是本地小库）", n_before_all > 500, "rows=%d" % n_before_all)

    install_stub_modules()
    C = load_real(os.path.join(SRC, "db", "queries", "contacts.py"), "v387_contacts")
    ok("contacts.py 真身加载成功（含 contact_create/contact_update/contact_options）",
       all(hasattr(C, f) for f in ("contact_create", "contact_update", "contact_options")))

    n_sup0 = C.contact_count(contact_type="supplier")
    n_cus0 = C.contact_count(contact_type="customer")
    dg0, n_dg0 = digest_of_preexisting_suppliers()
    ok("快照供应商数 = 生产 38", n_sup0 == 38, n_sup0)
    print("      (customer=%d, 用于对照)" % n_cus0)

    ep, state, HTTPException = build_endpoint(C)

    # ─────────────────────────── 判别力自证：旧约定 vs 真端点
    head("1. 🔴 判别力自证：旧调用约定（复现缺陷） vs 真端点（修复后）")
    # 旧写法 = 改动前的端点那一行：把请求体原样 **d 展开（键是 type）
    old_id = C.contact_create(_user="v387-selftest", **{"name": "ZZ-selftest-OLD-CONV",
                                                        "type": "supplier"})
    _IDS.append(old_id)
    t_old = contact_type_of(old_id)
    ok("【旧约定】传 type='supplier' 实际落 customer（**复现 P0 缺陷**）",
       t_old == "customer", "落库 type=%r" % (t_old,))

    r1 = call_endpoint(ep, state, {"name": "ZZ-selftest-NEW-EP", "type": "supplier"})
    ok("【真端点】POST body type='supplier' 返回 success", r1.get("success") is True, r1)
    new_id = r1.get("id")
    _IDS.append(new_id)
    t_new = contact_type_of(new_id)
    ok("【真端点】实际落 supplier（**修复生效**）", t_new == "supplier", "落库 type=%r" % (t_new,))
    ok("判别力自证：两条路径结果**必须不同**（否则本测试无判别力）", t_old != t_new,
       "old=%r new=%r" % (t_old, t_new))

    # ─────────────────────────── 列表可见性
    head("2. 落对类型 ⇒ 供应商页/客户页各看得见、看不见")
    sup_names = [r["name"] for r in C.contact_list(contact_type="supplier", limit=500)]
    cus_names = [r["name"] for r in C.contact_list(contact_type="customer", limit=500)]
    ok("真端点建的那条**在**供应商列表里", "ZZ-selftest-NEW-EP" in sup_names)
    ok("真端点建的那条**不在**客户列表里", "ZZ-selftest-NEW-EP" not in cus_names)
    ok("旧约定那条**在**客户列表里（坐实它被建成了客户）",
       "ZZ-selftest-OLD-CONV" in cus_names)
    # ⚠️ 这里期望 **+1 而不是 +2**：旧约定那条已落成 `customer`（正是本轮要修的缺陷）
    #    ⇒ 它**不该**出现在供应商侧计数里。写成 +2 就等于"把缺陷也当成正确行为"，
    #    首次跑出 39（= 38+1）被我判成 FAIL —— 是**断言写错**，不是代码错，已改正。
    ok("contact_count(supplier) 比快照 +1（只有真端点那条算供应商侧）",
       C.contact_count(contact_type="supplier") == n_sup0 + 1,
       "%d（期望 %d）" % (C.contact_count(contact_type="supplier"), n_sup0 + 1))

    # ─────────────────────────── 白名单 4 列
    head("3. 新建供应商时那 4 个格子真落库（v316 同族）")
    payload = {
        "name": "ZZ-selftest-4COLS", "type": "supplier",
        "supplier_category": "ZZ-品类-测试",
        "bank_name": "ZZ测试银行", "bank_account": "TEST-0000-0000",
        "business_license": "ZZ-TEST-LIC-001",
        "contact_person": "ZZ对接人", "phone": "13900000000",
    }
    r2 = call_endpoint(ep, state, payload)
    cid2 = r2.get("id")
    _IDS.append(cid2)
    con = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    con.row_factory = sqlite3.Row
    row2 = dict(con.execute("SELECT * FROM contacts WHERE id=?", (cid2,)).fetchone())
    con.close()
    for k in ("supplier_category", "bank_name", "bank_account", "business_license",
              "contact_person", "phone"):
        ok("新建时 %-18s 落库 = 传入值" % k, row2.get(k) == payload[k],
           "%r vs %r" % (row2.get(k), payload[k]))
    ok("联系人/电话也一起落了（列表要显示这两列）",
       row2.get("contact_person") == "ZZ对接人" and row2.get("phone") == "13900000000")

    # ─────────────────────────── 类型归一化 / 非法值
    head("4. 类型归一化与非法值（回归，别把 v316 的收口改坏）")
    r3 = call_endpoint(ep, state, {"name": "ZZ-selftest-BOTH", "type": "客户+供应商"})
    _IDS.append(r3.get("id"))
    ok("中文「客户+供应商」→ both", contact_type_of(r3["id"]) == "both",
       contact_type_of(r3["id"]))
    r4 = call_endpoint(ep, state, {"name": "ZZ-selftest-CUST", "type": "customer"})
    _IDS.append(r4.get("id"))
    ok("type='customer' → customer（客户档案零行为变化）",
       contact_type_of(r4["id"]) == "customer")
    n_all_before_bad = C.contact_count(include_inactive=True)
    try:
        call_endpoint(ep, state, {"name": "ZZ-selftest-BADTYPE", "type": "员工"})
        ok("无法识别的类型必须 400（不许兜底写库）", False, "居然没抛")
    except HTTPException as e:
        ok("无法识别的类型必须 400（不许兜底写库）", e.status_code == 400, e.detail)
    ok("非法类型那次**零写入**", C.contact_count(include_inactive=True) == n_all_before_bad)
    try:
        call_endpoint(ep, state, {"name": "   ", "type": "supplier"})
        ok("空名称必须 400", False, "居然没抛")
    except HTTPException as e:
        ok("空名称必须 400", e.status_code == 400, e.detail)

    # ─────────────────────────── options
    head("5. contact_options(type='supplier') 含 supplier_category")
    opts = C.contact_options("supplier")
    ok("options 返回 supplier_category 键", "supplier_category" in opts, list(opts))
    ok("刚写入的 ZZ-品类-测试 出现在候选里（= 补全通道真通）",
       "ZZ-品类-测试" in (opts.get("supplier_category") or []),
       opts.get("supplier_category"))
    ok("options 仍含 v386 的 delivery_route（不回归）", "delivery_route" in opts)
    ok("options **不含** 加密列 bank_account（只读直出通道不放 PII）",
       "bank_account" not in opts and "phone" not in opts)

    # ─────────────────────────── update 路径
    head("6. 编辑路径（contact_update）对供应商四列可改、白名单外无副作用")
    C.contact_update(cid2, _user="v387-selftest", bank_name="ZZ测试银行-改",
                     supplier_category="ZZ-品类-测试2")
    con = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    con.row_factory = sqlite3.Row
    row2b = dict(con.execute("SELECT * FROM contacts WHERE id=?", (cid2,)).fetchone())
    con.close()
    ok("改后 bank_name 生效", row2b.get("bank_name") == "ZZ测试银行-改", row2b.get("bank_name"))
    ok("改后 supplier_category 生效", row2b.get("supplier_category") == "ZZ-品类-测试2")
    cols_meta = [r[1] for r in sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
                 .execute("PRAGMA table_info(contacts)").fetchall()]
    r5 = call_endpoint(ep, state, {"name": "ZZ-selftest-NOSIDE", "type": "supplier",
                                   "bogus_col_v387": "x", "is_active": 0})
    _IDS.append(r5.get("id"))
    con = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    con.row_factory = sqlite3.Row
    row5 = dict(con.execute("SELECT * FROM contacts WHERE id=?", (r5["id"],)).fetchone())
    con.close()
    ok("白名单外的 bogus_col_v387 不建列", "bogus_col_v387" not in cols_meta)
    ok("白名单外的 is_active 不被改（新行仍是 1 或 NULL，不是 0）",
       row5.get("is_active") in (1, None), row5.get("is_active"))
    ok("传白名单外字段照样 200 成功（extra=allow 契约未被破坏）", r5.get("success") is True)

    # ─────────────────────────── v386 回归
    head("7. v386（配送线路）回归")
    r6 = call_endpoint(ep, state, {"name": "ZZ-selftest-ROUTE", "type": "supplier",
                                   "delivery_route": "ZZ-城东线"})
    _IDS.append(r6.get("id"))
    con = sqlite3.connect("file:%s?mode=ro" % SNAP, uri=True)
    r = con.execute("SELECT delivery_route FROM contacts WHERE id=?", (r6["id"],)).fetchone()
    con.close()
    ok("v386 的 delivery_route 仍可经本端点写入（不回归）", r and r[0] == "ZZ-城东线", r)

    # ─────────────────────────── 无副作用
    head("8. 无副作用：既有 38 个供应商逐列未变")
    dg1, n_dg1 = digest_of_preexisting_suppliers()
    ok("既有供应商行数不变", n_dg1 == n_dg0, "%d → %d" % (n_dg0, n_dg1))
    ok("既有供应商逐列摘要不变（sha256 相同）", dg1 == dg0, "%s vs %s" % (dg0[:12], dg1[:12]))

    # ─────────────────────────── 收尾可逆
    head("9. 可逆：删掉本脚本建的行，快照回到原值")
    con = sqlite3.connect(SNAP)
    for i in _IDS:
        if i:
            con.execute("DELETE FROM contacts WHERE id=?", (i,))
    con.commit()
    con.close()
    n_sup_after = C.contact_count(contact_type="supplier")
    n_all_after = C.contact_count(include_inactive=True)
    ok("供应商数回到 38", n_sup_after == n_sup0, "%d → %d" % (n_sup0, n_sup_after))
    left = rows_with_prefix("ZZ-selftest-")
    ok("ZZ-selftest-* 残留 = 0", len(left) == 0, len(left))

    # ─────────────────────────── 汇总
    npass = sum(1 for _, c, _ in TESTS if c)
    nfail = len(TESTS) - npass
    print("\n" + "=" * 64)
    print("汇总：%d/%d 通过，失败 %d" % (npass, len(TESTS), nfail))
    print("ZERO_RESIDUE: %s" % (n_all_after == n_before_all))

    # 清快照（不让 PII 副本留在服务器 /tmp）
    try:
        os.remove(SNAP)
        print("快照已删除：%s" % SNAP)
    except Exception as e:
        print("!! 快照删除失败：%s" % e)
    print("=" * 64)
    return 0 if nfail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
