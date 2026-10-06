#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v386 · 批次 1.1 影子库写入验证 —— 「填了配送线路，保存后刷新还在」

开发计划《开发计划-侧栏重构与进销存-2026-10-06.md》§三·1.1 的验收判据：
  「客户档案编辑弹窗出现「配送线路」；**保存后刷新仍在**（刷新不丢才是真接上）」。

本脚本验**后端那一半**（写路径 → 落库 → 读回 → 建议清单），用**真实源码**跑：
  · `db.queries.contacts.contact_update()` —— 与 `PUT /api/contacts/{id}` 同一个函数
  · `contact_get()` / `contact_list()`        —— 与 `GET` 同一批函数
  · `contact_options()`                       —— 表单「已有值补全」的唯一来源

做法：把生产 `tenant_1.db`（+ 主库 `erp.db`）**复制**成影子库，再让真实的
`db.connection` 把 DB_DIR 解析到影子目录 —— 于是所有读写都落在副本上。

🔴 安全闸门（第 1 条断言，先于任何写）：解析出的 DB_DIR 必须在影子根目录下。
   本项目 v383 出过一次「清理沙箱时误删生产行」的 P0 事故，根因就是**以为在沙箱**。
   这里把「我现在到底在哪个库」做成硬断言，而不是靠人记得。

判别力自证（缺了它，「写进去了」可能只是**白名单根本没生效**）：
  传一个**不在白名单**的列名，必须**写不进去**。

用法（服务器上，工作目录 = /opt/hergent-erp）：
  python3 v386-shadow-write-test.py
打补丁来源：server/db/queries/contacts.py 的 `contact_update.allowed`。
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

SHADOW_ROOT = "/tmp/shadow_v386"
SRC_DIR = "/opt/hergent-erp"
SERVER = os.path.join(SRC_DIR)

FAILED = []
PASSED = 0


def ok(cond, label, extra=""):
    global PASSED
    if cond:
        PASSED += 1
        print("  ✅ %s%s" % (label, ("  → " + str(extra)) if extra else ""))
    else:
        FAILED.append(label)
        print("  ❌ %s%s" % (label, ("  → " + str(extra)) if extra else ""))
    return bool(cond)


def _mask(s):
    """客户名是既定**脱敏红线**（不进任何产物）⇒ 输出里只留首字 + 长度。"""
    s = str(s or "")
    if not s:
        return "(空)"
    return s[0] + "＊" * (len(s) - 1)


def _raw_row(db_path, cid):
    """读 `contacts` 的**原始行**（不经过 decrypt / 聚合列），用于 storage 层逐列比对。"""
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    try:
        r = c.execute("SELECT * FROM contacts WHERE id=?", (cid,)).fetchone()
        return dict(r) if r else {}
    finally:
        c.close()


def main():
    # ---------- 0) 造影子库 ----------
    if os.path.isdir(SHADOW_ROOT):
        shutil.rmtree(SHADOW_ROOT)
    os.makedirs(SHADOW_ROOT, exist_ok=True)
    for f in ("tenant_1.db", "erp.db"):
        s = os.path.join(SRC_DIR, f)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(SHADOW_ROOT, f))
    shadow_master = os.path.join(SHADOW_ROOT, "erp.db")
    shadow_tenant = os.path.join(SHADOW_ROOT, "tenant_1.db")

    # 🔴 关键：让真实的 db.connection 把 DB_DIR 指到影子目录
    os.environ["ERP_DB_PATH"] = shadow_master
    sys.path.insert(0, SERVER)

    import db.connection as conn_mod   # noqa: E402
    from db.queries import contacts as C   # noqa: E402

    print("══ 0) 安全闸门：我到底在哪个库 ══")
    real_dir = os.path.realpath(conn_mod.DB_DIR)
    ok(real_dir.startswith(os.path.realpath(SHADOW_ROOT)),
       "DB_DIR 在影子目录内（否则立刻停手）", real_dir)
    if FAILED:
        print("\n🔴 安全闸门未通过 ⇒ 拒绝执行任何写操作。")
        return 1
    ok(conn_mod.DB_PATH == shadow_master, "主库 = 影子 erp.db", conn_mod.DB_PATH)

    conn_mod.set_tenant_context(1)
    resolved = conn_mod._tenant_db.get()
    ok(os.path.realpath(resolved or "") == os.path.realpath(shadow_tenant),
       "租户 1 解析到影子 tenant_1.db", resolved)
    if FAILED:
        print("\n🔴 租户库未落在影子目录 ⇒ 拒绝执行任何写操作。")
        return 1

    # ---------- 1) 选一个客户 ----------
    rows = C.contact_list(keyword="", contact_type="customer", limit=5, offset=0)
    ok(len(rows) > 0, "影子库能列出客户（基线非空）", "前 5 条：%d" % len(rows))
    if not rows:
        return 1
    target = rows[0]
    cid = target["id"]
    print("\n  目标客户：id=%s name=%s 原 delivery_route=%r"
          % (cid, _mask(target.get("name")), target.get("delivery_route")))

    # 「其它字段一字未动」的基线**取原始行**（storage 层），不取接口返回的行：
    #   · `contact_list` 会额外挂 ar_balance / last_order / visit_count / last_visit（聚合列）
    #   · `contact_get`  会额外挂 receivable / payable
    #   两者列集本来就不同 ⇒ 拿它们互比会产出 6 个**假**「意外变动」（本脚本首跑即栽在这）。
    raw_before = _raw_row(shadow_tenant, cid)

    # ---------- 2) 负面自证先跑：白名单外字段必须写不进 ----------
    print("\n══ 1) 判别力自证：白名单外字段**必须**写不进 ══")
    sentinel_col = "zzz_v386_not_a_column"
    real_cols = [r[1] for r in sqlite3.connect(shadow_tenant).execute(
        "PRAGMA table_info(contacts)").fetchall()]
    ok(sentinel_col not in real_cols,
       "哨兵列确实不在 contacts 表里（前提成立）", "表列数=%d" % len(real_cols))
    ok("delivery_route" in real_cols, "delivery_route 列真实存在（迁移已生效）")
    raw_pre_neg = _raw_row(shadow_tenant, cid)
    try:
        C.contact_update(cid, _user="v386-shadow", **{sentinel_col: "SHOULD_NOT_WRITE"})
        raised = None
    except Exception as e:
        raised = type(e).__name__
    cols_after = [r[1] for r in sqlite3.connect(shadow_tenant).execute(
        "PRAGMA table_info(contacts)").fetchall()]
    raw_post_neg = _raw_row(shadow_tenant, cid)
    ok(sentinel_col not in cols_after,
       "白名单外字段没有把列建出来（无论它抛不抛异常）",
       "调用结果=%s" % (raised or "未抛异常（静默丢弃，属既有行为）"))
    ok(raw_pre_neg == raw_post_neg,
       "★ 传白名单外字段后整行**逐列未变**（证明 allowed 白名单真的在拦）",
       "变动列=%s" % (sorted(k for k in set(raw_pre_neg) | set(raw_post_neg)
                             if raw_pre_neg.get(k) != raw_post_neg.get(k)) or "无"))

    # ---------- 3) 正例：写 delivery_route ----------
    print("\n══ 2) 正例：写「配送线路」→ 读回 → 刷新后仍在 ══")
    NEWVAL = "城东线"
    C.contact_update(cid, _user="v386-shadow", delivery_route=NEWVAL)

    got = C.contact_get(cid)
    ok(got.get("delivery_route") == NEWVAL,
       "contact_get 读回该值（写路径真的通了，没有被白名单静默丢）",
       "读到 %r" % got.get("delivery_route"))

    listed = C.contact_list(keyword="", contact_type="customer", limit=5, offset=0)
    hit = next((r for r in listed if r["id"] == cid), None)
    ok(hit is not None and hit.get("delivery_route") == NEWVAL,
       "★ contact_list 重新拉取后该值仍在（= 「刷新后仍在」）",
       "列表里读到 %r" % (hit or {}).get("delivery_route"))

    opts = C.contact_options("customer")
    ok(NEWVAL in (opts.get("delivery_route") or []),
       "★ 建议清单（已有值补全）里出现了该值 —— 下次可直接选，不会填成第二个写法",
       "delivery_route 候选=%s" % (opts.get("delivery_route") or [])[:5])
    ok(set(opts.keys()) >= {"region", "channel", "assigned_salesperson",
                            "settlement_method", "delivery_route"},
       "建议清单 5 个键齐全（加字段没有顶掉老键）", sorted(opts.keys()))
    # 反向对照：`safe` 白名单**确实在起作用** —— `boss_name` 是普通文本但**不在** safe 里，
    # 它的值不该被当成「可补全候选」下发。缺了这条，「键变多了」可能只是白名单形同虚设。
    ok("boss_name" not in opts,
       "反向对照：白名单外的 boss_name 不出现在建议清单里（证明 safe 真在过滤）",
       sorted(opts.keys()))

    # ---------- 4) 副作用：其它字段一字未动（比原始行）----------
    print("\n══ 3) 副作用：其它字段一字未动（storage 层原始行比对）══")
    raw_after = _raw_row(shadow_tenant, cid)
    IGNORE = {"updated_at", "delivery_route"}   # updated_at 就该变；delivery_route 是本次目标
    cols = sorted(set(raw_before) | set(raw_after))
    changed = sorted(k for k in cols
                     if k not in IGNORE and raw_before.get(k) != raw_after.get(k))
    ok(not changed, "除 delivery_route/updated_at 外，%d 列逐列一致" % (len(cols) - len(IGNORE)),
       "意外变动 = %s" % (changed or "无"))
    ok(raw_after.get("delivery_route") == NEWVAL, "原始行里 delivery_route 已是新值")

    # ---------- 5) 复原（影子库，仅为整洁）----------
    print("\n══ 4) 复原影子库 ══")
    C.contact_update(cid, _user="v386-shadow", delivery_route="")
    ok(C.contact_get(cid).get("delivery_route") == "",
       "改回空串后读回为空（说明写入是**可逆的**，不是只写不读）")

    print("\n" + "=" * 52)
    print("通过 %d 项，失败 %d 项" % (PASSED, len(FAILED)))
    if FAILED:
        for f in FAILED:
            print("  · %s" % f)
    print("=" * 52)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
