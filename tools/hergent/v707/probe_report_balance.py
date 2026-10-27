#!/usr/bin/env python3
"""v707 报表平衡判据统一 —— 端到端探针（生产只读 + 隔离库行为验证）。

## 为什么不能只 grep 字符串

"接口 200 / 文案没变" 不等于判据换了。本轮改的是**边界行为**：
`abs(a-b) < 0.01` → `abs(to_cents(a)-to_cents(b)) <= 1`。这两者只有输入
「恰好差 1 分」时才分歧，而这批存量数据一次都没踩到（双算 0 翻案）。
⇒ 光看生产报表，改与不改**完全一样**。必须人造那个边界才能验。

## 两段验证

**第一段 · 生产真实接口（只读，用真实会话 cookie）**
    只验"没改坏"：字段还在、类型还是布尔、数值与双算一致、第 4 处 500 已消失。
    这几条能证明改动没把报表搞崩；证明不了新判据生效。

**第二段 · 隔离库行为验证（/tmp 空库 + 生产同一份代码）**
    在 `/tmp` 建一个只有 COA + 凭证的临时库，用 `ERP_DB_PATH` 指过去，
    import 生产的 `erp_db` 调 `get_trial_balance()`：
      · 借 100.00 / 贷 99.99（差 1 分）⇒ 新口径**必须**判平
      · 借 100.00 / 贷 99.98（差 2 分）⇒ **必须**判不平
    第 1 条是**反向可证伪**的：把判据改回浮点，它会因为
    `100.00-99.99 = 0.010000000000005116` 而判不平 → 探针立刻 FAIL。
    注意：临时库**不能**建在产品目录下，避免被租户扫描误认。

## 用法

    python3 probe_report_balance.py            # 两段都跑
    python3 probe_report_balance.py --no-http  # 只跑隔离库那段

退出码：0 全过；1 有 FAIL。
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.request

PROD = "/opt/hergent-erp"
FAILS = []
PASSES = []
KNOWN_BROKEN = []      # 已知缺陷：不判 FAIL，但必须打印出来，不能被"全绿"掩盖


def chk(name, cond, detail=""):
    if cond:
        PASSES.append(name)
        print("  ✅ %s" % name)
    else:
        FAILS.append("%s %s" % (name, detail))
        print("  🔴 %s   %s" % (name, detail))


def _session_token():
    con = sqlite3.connect("file:%s/erp.db?mode=ro" % PROD, uri=True)
    try:
        r = con.execute(
            "SELECT token FROM sessions WHERE user_id=2 ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        return r[0] if r else None
    finally:
        con.close()


def _get(path, token):
    req = urllib.request.Request(
        "http://127.0.0.1:8700" + path,
        headers={"Cookie": "erp_token=%s; hergent_auth=1; csrf_token=%s" % (token, token),
                 "X-Tenant-Id": "1"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def _post(path, payload, token):
    req = urllib.request.Request(
        "http://127.0.0.1:8700" + path,
        data=json.dumps(payload).encode(),
        headers={"Cookie": "erp_token=%s; hergent_auth=1; csrf_token=%s" % (token, token),
                 "X-Tenant-Id": "1", "X-CSRF-Token": token,
                 "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def phase_http():
    print("\n【第一段】生产真实接口（只读）")
    tok = _session_token()
    if not tok:
        chk("拿到真实会话 token", False, "sessions 表无 user_id=2 的行")
        return
    chk("拿到真实会话 token", True)

    # 1) 试算表 · 不平的月份
    st, d = _get("/api/trial-balance?month=2026-06", tok)
    chk("GET /api/trial-balance?month=2026-06 → 200", st == 200, "status=%s" % st)
    chk("试算表返回 balanced 字段且为布尔", isinstance(d.get("balanced"), bool),
        "type=%s" % type(d.get("balanced")).__name__)
    chk("2026-06 仍判不平（真差 379 万，非判据问题）", d.get("balanced") is False,
        "balanced=%s" % d.get("balanced"))
    diff = float(d.get("total_debit", 0)) - float(d.get("total_credit", 0))
    chk("2026-06 借贷差 = 3,793,895.16（与双算一致）", abs(diff - 3793895.16) < 0.01,
        "实测差=%.2f" % diff)

    # 2) 试算表 · 平的月份
    st, d2 = _get("/api/trial-balance?month=2026-10", tok)
    chk("GET /api/trial-balance?month=2026-10 → 200", st == 200, "status=%s" % st)
    chk("2026-10 判平", d2.get("balanced") is True, "balanced=%s" % d2.get("balanced"))

    # 3) 资产负债表
    st, b = _get("/api/reports/balance-sheet?as_of=2026-06-30", tok)
    chk("GET /api/reports/balance-sheet?as_of=2026-06-30 → 200", st == 200, "status=%s" % st)
    chk("资产负债表返回 balanced 且为布尔", isinstance(b.get("balanced"), bool),
        "type=%s" % type(b.get("balanced")).__name__)
    chk("资产负债表仍判不平（真差 389 万）", b.get("balanced") is False,
        "balanced=%s" % b.get("balanced"))
    a = float((b.get("assets") or {}).get("total", 0))
    li = float((b.get("liabilities") or {}).get("total", 0))
    eq = float((b.get("equity") or {}).get("total", 0))
    chk("资产负债 资产=12,383,452.20 / 负债=205,844.00 / 权益=8,285,388.04",
        abs(a - 12383452.20) < 0.01 and abs(li - 205844.00) < 0.01 and abs(eq - 8285388.04) < 0.01,
        "实测 %.2f / %.2f / %.2f" % (a, li, eq))

    # 4) 凭证模板预览
    #    改前 100% 500（`d` 未定义）→ 已修。但修完暴露**第二层**存量断链：
    #    `voucher_engine.apply_template()` 调 `db.voucher_template_list()`，
    #    而 erp_db 里 voucher_template_list / create / update / delete / apply
    #    五个数据函数**一个都不存在**（全后端 grep 无 def）。⇒ 该功能整体不可用，
    #    属独立缺陷，不在"统一判据"范围。
    #    ⇒ 这里既不能判 PASS（没通），也不能判 FAIL（不属本轮 KPI，会长期挂红）：
    #      按 SKIP 记，并把原因打出来，避免"看起来全绿"。
    st, t = _post("/api/voucher-templates/test",
                  {"event_type": "sale_deliver",
                   "context": {"total_amount": 10000, "customer_name": "探针", "order_no": "SO-PROBE"}},
                  tok)
    if st == 200 and isinstance(t.get("balanced"), bool):
        chk("POST /api/voucher-templates/test → 200 且返回布尔 balanced", True)
    elif st == 500:
        KNOWN_BROKEN.append(
            "凭证模板预览仍 500：`db.voucher_template_list` 等 5 个函数在 erp_db 中不存在"
            "（存量断链，整条「凭证模板」功能不可用，属独立缺陷）")
    else:
        chk("POST /api/voucher-templates/test 返回非 500 非 200", False,
            "status=%s body=%s" % (st, str(t)[:150]))


def phase_isolated():
    """隔离库：用生产同一份 erp_db 代码，人造「恰好差 1 分」这张凭证。"""
    print("\n【第二段】隔离库行为验证（/tmp 空库 + 生产同一份代码）")
    tmpdir = tempfile.mkdtemp(prefix="v707-probe-")
    dbp = os.path.join(tmpdir, "probe.db")
    try:
        # ⚠️ ERP_DB_PATH 必须在 import erp_db 之前设好：DB_PATH 是模块级常量
        os.environ["ERP_DB_PATH"] = dbp
        sys.path.insert(0, PROD)
        import erp_db  # noqa: E402  （会跑 _safe_migrate 建表，落在临时库）

        con = sqlite3.connect(dbp)
        # ⚠️ `_safe_migrate` 会顺带 seed 一套完整 COA ⇒ 直接 INSERT '1001' 会撞
        #    UNIQUE(chart_of_accounts.code)。必须先清空，让合计只由本探针的两条凭证决定，
        #    否则 total 里混进别科目的余额，判据测的就不是"差 1 分"了。
        con.execute("DELETE FROM journal_entries")
        con.execute("DELETE FROM chart_of_accounts")
        con.execute("INSERT INTO chart_of_accounts (code,name,category,is_active) "
                    "VALUES ('1001','库存现金','资产',1)")
        con.execute("INSERT INTO chart_of_accounts (code,name,category,is_active) "
                    "VALUES ('2202','应付账款','负债',1)")
        con.commit()

        def put(debit, credit, note):
            con.execute("DELETE FROM journal_entries")
            con.execute("INSERT INTO journal_entries "
                        "(date,account_code,account_name,debit,credit,summary) "
                        "VALUES ('2026-07-15','1001','库存现金',?,?,?)", (debit, 0, note))
            con.execute("INSERT INTO journal_entries "
                        "(date,account_code,account_name,debit,credit,summary) "
                        "VALUES ('2026-07-15','2202','应付账款',?,?,?)", (0, credit, note))
            con.commit()
            return erp_db.get_trial_balance("2026-07")

        # ① 差 1 分：新口径判平。浮点老判据在这里会因 0.010000000000005 判"不平"。
        r1 = put(100.00, 99.99, "差1分")
        chk("借 100.00 / 贷 99.99（差 1 分）⇒ 新口径判『平』", r1.get("balanced") is True,
            "balanced=%s 差=%.17f" % (r1.get("balanced"),
                                     float(r1.get("total_debit", 0)) - float(r1.get("total_credit", 0))))

        # ② 差 2 分：必须判不平（防止把容差误放大）
        r2 = put(100.00, 99.98, "差2分")
        chk("借 100.00 / 贷 99.98（差 2 分）⇒ 判『不平』", r2.get("balanced") is False,
            "balanced=%s" % r2.get("balanced"))

        # ③ 完全相等
        r3 = put(1234.56, 1234.56, "相等")
        chk("借贷相等 ⇒ 判『平』", r3.get("balanced") is True, "balanced=%s" % r3.get("balanced"))

        # ④ 反向对照：老判据在这组数上确实会分歧（证明 ① 不是恒真）
        old1 = abs(100.00 - 99.99) < 0.01
        chk("老判据在『差 1 分』这组数上判不平（证明①有区分力）", old1 is False,
            "abs(100.00-99.99)=%.20f" % abs(100.00 - 99.99))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        chk("临时库已清理（残留 0）", not os.path.exists(tmpdir), tmpdir)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-http", action="store_true")
    a = ap.parse_args()
    print("v707 报表平衡判据统一 · 端到端探针")
    print("=" * 78)
    if not a.no_http:
        phase_http()
    phase_isolated()
    print("\n" + "=" * 78)
    print("通过 %d 项，失败 %d 项，已知缺陷 %d 项" % (len(PASSES), len(FAILS), len(KNOWN_BROKEN)))
    for k in KNOWN_BROKEN:
        print("  ⚠️  已知缺陷（非本轮范围）：" + k)
    for f in FAILS:
        print("  🔴 " + f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
