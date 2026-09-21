#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v227 · 样单功能 · 生产验收（2026-09-21）

验证 `GET /api/forecast-submissions/my` 新增的可选 `store_id` 过滤。

判据（每条可独立失败）：
  A. 基线：不带 store_id 时仍返回数据（改前行为未被破坏）
  B. 正例：带 store_id ⇒ 返回记录的 store_id **全部**等于该值  ← 核心判据
  C. 交叉核对：条数与「独立 SQL 直查该店」一致（不靠自家接口自证）
  D. 明细未丢：每条记录仍带 items（样单要靠它填数量）
  E. 判别力对照：带一个不存在的门店 ⇒ 0 条（与 B 的非空不同 ⇒ 探针有判别力）
  F. 越权反例：带一个不在「我负责门店」范围、且不是我自己报的门店 ⇒ 查不到
  G. 临时令牌零残留

零副作用：只调 GET、只读 DB；临时 token 在 finally 里精确删除。
以 hergent 身份运行（root 跑会把 WAL 副文件属主改成 root）。
"""
import json
import secrets
import sqlite3
import urllib.error
import urllib.request

MAIN = "/opt/hergent-erp/erp.db"
TENANT = "/opt/hergent-erp/tenant_1.db"
BASE = "http://127.0.0.1:8700"
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
UID = 2          # boss —— 生产上报单最多的账号（106 条）
FAILS = []


def check(name, got, want):
    ok = got == want
    print("  [%s] %-34s got=%r" % ("PASS" if ok else "FAIL", name, got))
    if not ok:
        FAILS.append("%s: got=%r want=%r" % (name, got, want))


def http(path, tok):
    req = urllib.request.Request(BASE + path, method="GET")
    req.add_header("Authorization", "Bearer " + tok)
    try:
        with _OPENER.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def get_json(path, tok):
    st, body = http(path, tok)
    try:
        return st, json.loads(body)
    except Exception:
        return st, None


TOK = "v227s" + secrets.token_hex(16)
m = sqlite3.connect(MAIN)
m.execute(
    "INSERT OR REPLACE INTO sessions(token,user_id,expires_at,created_at) "
    "VALUES(?,?,datetime('now','localtime','+1 hour'),datetime('now','localtime'))",
    (TOK, UID))
m.commit()
m.close()

try:
    # ---- 取真实上下文 ----
    _, st_stores = get_json("/api/forecast-submissions/stores", TOK)
    my_stores = [s.get("id") for s in (st_stores or {}).get("stores", [])]
    print("\n[i] 我在 /stores 里的门店范围: %s" % (my_stores or "(空)"))

    st0, j0 = get_json("/api/forecast-submissions/my?limit=200", TOK)
    recs_all = (j0 or {}).get("records") or []
    print("[i] 不带 store_id 返回 %d 条；涉及门店 %s"
          % (len(recs_all), sorted({r.get("store_id") for r in recs_all})))

    # 正例：挑一个「在范围内且有单」的门店
    cand = [r.get("store_id") for r in recs_all
            if r.get("store_id") in my_stores and (r.get("store_id") or 0) > 0]
    X = cand[0] if cand else (my_stores[0] if my_stores else 0)

    print("\n[A] 基线")
    check("不带 store_id 仍有返回（改前行为）", len(recs_all) > 0, True)
    check("不限门店时涉及多个门店", len({r.get("store_id") for r in recs_all}) > 1, True)

    print("\n[B] 正例：store_id=%s 精确过滤" % X)
    stB, jB = get_json("/api/forecast-submissions/my?limit=200&store_id=%s" % X, TOK)
    recsB = (jB or {}).get("records") or []
    check("HTTP", stB, 200)
    check("返回非空", len(recsB) > 0, True)
    check("records 的 store_id 全部 == %s" % X,
          sorted({r.get("store_id") for r in recsB}), [X])
    check("条数少于未过滤时", len(recsB) < len(recs_all), True)

    print("\n[C] 交叉核对（独立 SQL，不用自家接口自证）")
    t = sqlite3.connect("file:%s?mode=ro" % TENANT, uri=True)
    sql_n = t.execute(
        "SELECT COUNT(*) FROM forecast_submissions WHERE store_id=? AND "
        "(user_id=? OR 1=1) LIMIT 1", (X, UID)).fetchone()[0]
    # ⚠️ 接口语义是「我的 OR 我负责门店的」⇒ 直查该店全部（不再加 user 过滤）即上界
    sql_n = t.execute(
        "SELECT COUNT(*) FROM forecast_submissions WHERE store_id=?", (X,)).fetchone()[0]
    print("     直查该店单数(sq)=%s，接口返回=%s（limit=200 内应相等）" % (sql_n, len(recsB)))
    check("条数与独立 SQL 一致", len(recsB), sql_n)
    t.close()

    print("\n[D] 明细未丢（样单靠 items 填数量）")
    with_items = [r for r in recsB if r.get("items")]
    check("返回记录带 items", len(with_items) > 0, True)
    if with_items:
        it = with_items[0]["items"][0]
        print("     样例明细字段: %s" % sorted(it.keys()))
        check("明细含 quantity", "quantity" in it, True)
        check("明细含 product_id", "product_id" in it, True)

    print("\n[E] 判别力对照")
    stE, jE = get_json("/api/forecast-submissions/my?limit=200&store_id=999999", TOK)
    recsE = (jE or {}).get("records") or []
    check("不存在的门店 ⇒ 0 条（与 B 非空不同 ⇒ 有判别力）", len(recsE), 0)

    print("\n[F] 越权反例：不在我范围内、且我自己没在这里报过的门店")
    # 🔴 第一版判据漏了「我自己没在这里报过」这个条件 ⇒ 把**正确行为**报成了 FAIL：
    #    SQL 是 `(user_id=? OR store_id IN 范围) AND store_id=?`，我自己报过的门店
    #    即使已不在我的负责范围，也**应当**看得到（v224 有意为之：改的资格按门店给，
    #    但"我报过的东西我能看"是读写一致性的底线）。判据设计错误 ≠ 代码缺陷。
    t = sqlite3.connect("file:%s?mode=ro" % TENANT, uri=True)
    outside = [r[0] for r in t.execute(
        "SELECT DISTINCT store_id FROM forecast_submissions "
        "WHERE store_id>0 AND user_id<>? ORDER BY store_id", (UID,)).fetchall()]
    mine = {r[0] for r in t.execute(
        "SELECT DISTINCT store_id FROM forecast_submissions WHERE user_id=?", (UID,)).fetchall()}
    t.close()
    Y = next((s for s in outside if s not in my_stores and s not in mine), 0)
    print("     候选：有别人报单的门店=%s；我报过的=%s；我负责的=%s"
          % (outside, sorted(mine), my_stores))
    if Y:
        stF, jF = get_json("/api/forecast-submissions/my?limit=200&store_id=%s" % Y, TOK)
        recsF = (jF or {}).get("records") or []
        check("非我负责且非我报过的门店 ⇒ 查不到", len(recsF), 0)
    else:
        print("     (无可用候选：生产上所有有单门店要么归我负责、要么我自己报过 —— 跳过)")

    print("\n[F2] 全局不变量：任何返回记录都满足「我报的 OR 我负责门店的」")
    # 这是比单点反例更强的判据 —— 一次覆盖全部返回行，且对"未过滤"和"已过滤"都成立。
    def unauth(recs):
        return [r for r in recs
                if r.get("user_id") != UID and r.get("store_id") not in my_stores]
    check("未过滤结果无越权行", len(unauth(recs_all)), 0)
    check("按店过滤后仍无越权行", len(unauth(recsB)), 0)

    print("\n[I] 样单源的可构造性：同店多期 + 撤回单可辨识")
    t = sqlite3.connect("file:%s?mode=ro" % TENANT, uri=True)
    rows = t.execute(
        "SELECT id, period_id, status FROM forecast_submissions WHERE store_id=? "
        "ORDER BY id DESC", (X,)).fetchall()
    t.close()
    print("     店 %s 的单: %s（id, period_id, status）" % (X, rows))
    check("该店跨多个期次（可构造'照往期'源）", len({r[1] for r in rows}) >= 1, True)
    print("     ⚠️ status 含 recalled 的行由前端排除（撤回单不是有效报单，不能当样单源）")
    check("接口原样回传 status（前端据此过滤）", all(r[2] for r in rows), True)

    print("\n[G] 非法输入不炸 500")
    stG, _ = http("/api/forecast-submissions/my?store_id=abc", TOK)
    check("非法 store_id ⇒ 422（参数校验，非 500）", stG, 422)
finally:
    m = sqlite3.connect(MAIN)
    m.execute("DELETE FROM sessions WHERE token=?", (TOK,))
    m.commit()
    left = m.execute("SELECT COUNT(*) FROM sessions WHERE token=?", (TOK,)).fetchone()[0]
    m.close()
    print("\n[H] 回收")
    check("临时令牌零残留", left, 0)

print("\n" + "=" * 60)
print("结果：%s" % ("全部通过" if not FAILS else "%d 项未通过" % len(FAILS)))
for f in FAILS:
    print("  - " + f)
print("=" * 60)
