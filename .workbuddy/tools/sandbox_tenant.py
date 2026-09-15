#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
可复用的「隔离租户沙箱」工具 —— 给前端真机验证造一个带真实数据的租户。

范式（来自技能 hergent-tenant-isolation-audit §10.7）：
  · 克隆真实租户库（默认 tenant_10）当沙箱库 —— 一步拿到全套 schema + 真实数据 + 真实口径
  · 主库 erp.db 里插 tenants / users / user_tenants / sessions（直接注入令牌，绕开登录）
  · 沙箱库属主必须是 hergent（否则服务写不进去 → 所有写端点 500，看着像产品缺陷）
  · 销毁时连 -wal / -shm 一起删，并按 user_id 清主库四表

用法（必须在生产上以 hergent 身份跑，且先 source .env）：

  # 建
  scp .workbuddy/tools/sandbox_tenant.py root@<prod>:/tmp/
  ssh root@<prod> 'cd /opt/hergent-erp && set -a && . ./.env && set +a && \
    runuser -u hergent --preserve-environment -- python3 /tmp/sandbox_tenant.py up --id 9997 --src 10'

  # 销
  ssh root@<prod> 'cd /opt/hergent-erp && set -a && . ./.env && set +a && \
    runuser -u hergent --preserve-environment -- python3 /tmp/sandbox_tenant.py down --id 9997'

产出（up）：一行 JSON，含 tid / sandbox_id / token / 源库 sha256（销毁前再跑 down 会复核）。

🔴 安全约束（脚本内已写成硬断言）：
  · 沙箱 id 必须 >= 9997（>= 9997 才算隔离区；tenant_1 / tenant_10 永不触碰）
  · 源租户只允许 1 或 10，且只读（只 shutil.copy2，绝不写）
  · 目标路径必须落在 /opt/hergent-erp 下
"""
import argparse, hashlib, json, os, shutil, sqlite3, sys, uuid
from datetime import date, datetime, timedelta

ERP_DIR = "/opt/hergent-erp"
MASTER = os.path.join(ERP_DIR, "erp.db")
SANDBOX_MIN = 9997


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _assert_isolated(sandbox_id):
    if sandbox_id < SANDBOX_MIN:
        sys.exit("拒绝：沙箱 id %d 小于隔离下限 %d —— tenant_1 / tenant_10 绝不可当沙箱" % (sandbox_id, SANDBOX_MIN))


# ── 源库「零污染」判据（v169 修正）──────────────────────────────
# ⚠️ 为什么不用 sha256 前后一致做判据：源库是**真实租户**，生产后端一直在跑 ——
#    缓存刷新（today_briefing_cache / ai_profile_cache）、真实用户浏览、定时任务都会
#    改写主文件，实测一轮下来哈希必变（cdc7cd6c → d447dc46）而业务计数一字未动。
#    用哈希判据会把「生产正常运行」误报成「沙箱污染了真实库」，方向完全反了。
# 正确判据：**比对源库的表计数指纹**，并把变化分类 —— 只落在运行时/缓存表即为正常。
_RUNTIME_TABLES = {
    "today_briefing_cache", "ai_profile_cache", "ai_advice_log", "ai_fallback_log",
    "ai_reminders", "chat_sessions", "message_center", "audit_logs", "daily_logs",
    "_migrations", "sessions",
}


def _table_counts(db):
    """全表计数指纹（只读打开，绝不触发 checkpoint 之外的写入）"""
    con = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    try:
        tabs = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        out = {}
        for t in tabs:
            try:
                out[t] = con.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
            except Exception:
                out[t] = "ERR"
        return out
    finally:
        con.close()


def _src_diff(before, after):
    """对比源库指纹，区分「运行时写入」与「需人工确认的变化」"""
    if not before or not after:
        return {"compared": False}
    changed = sorted(t for t in set(before) | set(after)
                     if before.get(t) != after.get(t))
    runtime = [t for t in changed if t in _RUNTIME_TABLES]
    business = [t for t in changed if t not in _RUNTIME_TABLES]
    return {
        "compared": True,
        "changed_tables": changed,
        "runtime_tables": runtime,
        "business_tables": business,
        # ok        = 变化全落在运行时/缓存表（生产正常运行，非沙箱所致）
        # review    = 业务表计数也变了 —— 多半是真实用户在操作，须人工确认后再收工
        "verdict": "ok" if not business else "review",
    }


def cmd_up(a):
    _assert_isolated(a.id)
    src_db = os.path.join(ERP_DIR, "tenant_%d.db" % a.src)
    dst_db = os.path.join(ERP_DIR, "tenant_%d.db" % a.id)
    # 目标必须落在 ERP 目录内，且不能等于源
    if not os.path.abspath(dst_db).startswith(ERP_DIR + "/"):
        sys.exit("拒绝：目标路径不在 %s 内" % ERP_DIR)
    if dst_db == src_db:
        sys.exit("拒绝：目标与源相同")
    if a.src not in (1, 10):
        sys.exit("拒绝：只允许从 tenant_1 / tenant_10 克隆（源库必须真实且只读）")

    src_before = sha256(src_db)

    # ── 1. 克隆库 ────────────────────────────────────────────────
    for suffix in ("", "-wal", "-shm"):
        p = dst_db + suffix
        if os.path.exists(p):
            os.remove(p)
    shutil.copy2(src_db, dst_db)
    os.chmod(dst_db, 0o644)          # 与真实租户一致；属主已是 hergent（脚本以 hergent 跑）

    today = date.today().isoformat()
    tc = sqlite3.connect(dst_db)
    # 让数据落进「今日报单」窗口（前端无期次时取 summary(order_start=order_end=今天)）
    moved = tc.execute("SELECT COUNT(*) FROM forecast_submissions").fetchone()[0]
    tc.execute("UPDATE forecast_submissions SET order_date=?", (today,))
    tc.execute("UPDATE forecast_submissions SET created_at=? WHERE created_at IS NULL OR created_at=''",
               (datetime.now().isoformat(timespec="seconds"),))
    seeded = 0
    if a.seed_decisions:
        seeded = _seed_decisions(tc, today)
    tc.commit()
    tc.close()

    # ── 2. 主库登记租户 + 注入登录态 ──────────────────────────────
    token = uuid.uuid4().hex + uuid.uuid4().hex
    now = datetime.now()
    mc = sqlite3.connect(MASTER)
    mc.row_factory = sqlite3.Row
    try:
        # ⚠️ 主库真实列：tenants 用 is_active（**没有 status 列**）
        mc.execute("INSERT OR REPLACE INTO tenants (id, name, is_active, created_at, max_users, plan) "
                   "VALUES (?,?,?,?,?,?)",
                   (a.id, a.name, 1, now.isoformat(timespec="seconds"), 50, "pro"))
        uid = mc.execute("INSERT INTO users (username, display_name, password_hash, role, created_at) "
                         "VALUES (?,?,?,?,?)",
                         (a.user, "沙箱只读账号", "!sandbox-no-login!", "boss",
                          now.isoformat(timespec="seconds"))).lastrowid
        mc.execute("INSERT OR REPLACE INTO user_tenants (user_id, tenant_id, role) VALUES (?,?,?)",
                   (uid, a.id, "boss"))
        # ⚠️ 主库 sessions **没有 tenant_id 列** —— 租户由 user_tenants 反查
        mc.execute("INSERT INTO sessions (token, user_id, expires_at, created_at, last_activity) "
                   "VALUES (?,?,?,?,?)",
                   (token, uid, (now + timedelta(days=1)).isoformat(timespec="seconds"),
                    now.isoformat(timespec="seconds"), now.isoformat(timespec="seconds")))
        mc.commit()
    finally:
        mc.close()

    src_after = sha256(src_db)
    # 记源库指纹供 down 时比对（哈希只作参考：真实租户一直在被生产写）
    src_fp = _table_counts(src_db)
    meta_path = "/tmp/sandbox_%d.meta.json" % a.id
    with open(meta_path, "w") as f:
        json.dump({"tenant_id": a.id, "src": a.src, "src_db": src_db,
                   "src_table_counts": src_fp,
                   "created_at": now.isoformat(timespec="seconds")}, f, ensure_ascii=False)
    print(json.dumps({
        "ok": True, "tenant_id": a.id, "user_id": uid, "token": token,
        "dst": dst_db, "src": src_db,
        "src_sha256_before": src_before, "src_sha256_after": src_after,
        "src_hash_unchanged": src_before == src_after,
        "src_tables_fingerprinted": len(src_fp), "meta": meta_path,
        "submissions_retargeted": moved, "order_date": today, "decisions_seeded": seeded,
    }, ensure_ascii=False))


def _seed_decisions(tc, today):
    """造「已定稿」数据，让汇总表「最终下单」列有值 → 复制按钮 enabled。

    🔴 坑（技能 §10.8）：`decision_join` 用 **d.product_name = i.product_name**（提报名），
    不是商品主档名 `products.name`；两者可以不同。故必须取**提报名**（且同一 product_id 可能有
    多个提报名，取出现最多的那个）。按主档名插会**静默不匹配**，看着像"复制功能坏了"。
    返回插入行数。
    """
    rows = tc.execute(
        "SELECT product_id, product_name, unit, SUM(quantity) q, COUNT(*) n "
        "FROM forecast_submission_items "
        "WHERE product_id IS NOT NULL AND product_name IS NOT NULL AND product_name <> '' "
        "GROUP BY product_id, product_name, unit "
        "ORDER BY n DESC, q DESC"
    ).fetchall()

    best = {}          # (product_id, unit) -> 出现最多的提报名
    total = {}         # (product_id, unit) -> 合计数量
    for pid, pname, unit, q, n in rows:
        key = (pid, (unit or "").strip())
        if key not in best:
            best[key] = pname
        total[key] = total.get(key, 0) + (q or 0)

    n = 0
    for (pid, unit), pname in best.items():
        tc.execute(
            "INSERT OR REPLACE INTO forecast_audit_decisions "
            "(period_start, period_end, product_id, product_name, unit, requested_qty, "
            " suggested_qty, final_qty, verdict, adopted, decided_at, decided_by) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (today, today, pid, pname, unit, total[(pid, unit)], total[(pid, unit)],
             total[(pid, unit)], "accepted", 1,
             datetime.now().isoformat(timespec="seconds"), "sandbox"))
        n += 1
    return n


def _count_sessions(mc, uids):
    """sessions 表没有 tenant_id，只能按 user_id 数（uids 为空时返回 0）。"""
    if not uids:
        return 0
    q = "SELECT COUNT(*) c FROM sessions WHERE user_id IN (%s)" % ",".join("?" * len(uids))
    return mc.execute(q, uids).fetchone()["c"]


def cmd_down(a):
    _assert_isolated(a.id)
    dst_db = os.path.join(ERP_DIR, "tenant_%d.db" % a.id)
    src_db = os.path.join(ERP_DIR, "tenant_%d.db" % a.src)

    # ── 1. 按 user_id 清主库四表（不按 token 删 —— 注册链路会留第二条 session） ──
    mc = sqlite3.connect(MASTER)
    mc.row_factory = sqlite3.Row
    removed = {}
    uids = []
    try:
        rows = mc.execute("SELECT id FROM users WHERE username=?", (a.user,)).fetchall()
        uids = [r["id"] for r in rows]
        for t in ("sessions", "user_tenants"):
            if uids:
                q = "DELETE FROM %s WHERE user_id IN (%s)" % (t, ",".join("?" * len(uids)))
                removed[t] = mc.execute(q, uids).rowcount
            else:
                removed[t] = 0
        if uids:
            removed["users"] = mc.execute(
                "DELETE FROM users WHERE id IN (%s)" % ",".join("?" * len(uids)), uids).rowcount
        else:
            removed["users"] = 0
        removed["tenants"] = mc.execute("DELETE FROM tenants WHERE id=?", (a.id,)).rowcount
        mc.commit()

        left = {
            "tenants": mc.execute("SELECT COUNT(*) c FROM tenants WHERE id=?", (a.id,)).fetchone()["c"],
            "users": mc.execute("SELECT COUNT(*) c FROM users WHERE username=?", (a.user,)).fetchone()["c"],
            # ⚠️ sessions 无 tenant_id 列 → 只能按 user_id 复核
            "sessions": _count_sessions(mc, uids),
            "user_tenants": mc.execute("SELECT COUNT(*) c FROM user_tenants WHERE tenant_id=?", (a.id,)).fetchone()["c"],
        }
    finally:
        mc.close()

    # ── 2. 删库 + WAL/SHM 边文件 ─────────────────────────────────
    left_files = []
    for suffix in ("", "-wal", "-shm"):
        p = dst_db + suffix
        if os.path.exists(p):
            os.remove(p)
    # 通配复核，别只看 .db
    import glob
    stray = sorted(glob.glob(os.path.join(ERP_DIR, "tenant_%d*" % a.id)))
    left_files = [os.path.basename(x) for x in stray]

    src_after = sha256(src_db) if os.path.exists(src_db) else None
    # 源库零污染判据 = **表计数指纹比对**，不是哈希（见文件头 _RUNTIME_TABLES 说明）
    meta_path = "/tmp/sandbox_%d.meta.json" % a.id
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
        except Exception:
            meta = {}
    src_fp = _table_counts(src_db) if os.path.exists(src_db) else None
    check = _src_diff(meta.get("src_table_counts"), src_fp)
    if os.path.exists(meta_path):
        os.remove(meta_path)
    print(json.dumps({
        "ok": True, "tenant_id": a.id, "removed_master_rows": removed, "left_master_rows": left,
        "left_files": left_files, "ZERO_RESIDUE": (not left_files and all(v == 0 for v in left.values())),
        "src_sha256_after": src_after,
        "src_business_check": check,
    }, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    up = sub.add_parser("up", help="建沙箱租户（克隆真实库 + 注入令牌）")
    up.add_argument("--id", type=int, required=True, help="沙箱租户 id（必须 >= %d）" % SANDBOX_MIN)
    up.add_argument("--src", type=int, default=10, help="克隆源租户（只允许 1 或 10，默认 10）")
    up.add_argument("--name", default="沙箱验证租户", help="租户显示名")
    up.add_argument("--user", default="sbx_verify", help="沙箱账号用户名（销毁时按它定位）")
    up.add_argument("--seed-decisions", action="store_true",
                    help="造「已定稿」数据，让汇总表「最终下单」有值（复制按钮 enabled 路径；"
                         "join 键取**提报名**，见技能 §10.8）")
    up.set_defaults(func=cmd_up)

    dn = sub.add_parser("down", help="销毁沙箱租户（按 user_id 清主库 + 删库与边文件）")
    dn.add_argument("--id", type=int, required=True)
    dn.add_argument("--src", type=int, default=10, help="克隆源（用于复核 sha256）")
    dn.add_argument("--user", default="sbx_verify", help="与 up 时一致")
    dn.set_defaults(func=cmd_down)

    a = ap.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
