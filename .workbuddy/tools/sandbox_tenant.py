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
  · 🔴 克隆必须带 -wal / -shm（2026-09-15 修复）：生产库跑在 WAL 模式，
    未 checkpoint 的改动**只在 -wal 里**。旧实现只 copy 主库文件 ⇒ 沙箱拿到的是
    过期快照，**生产上的问题在沙箱里复现不出来**（实测 tenant_1：主库 12:02 vs
    WAL 17:33，症状直接消失）。判断方法：比较 `ls -la tenant_N.db` 与 `tenant_N.db-wal`
    的 mtime，两者差距大就说明主库落后。
  · down 忘传 --user 也能清干净：三级兜底 meta.user_id → username → tenant_id 反查
    （2026-09-15 实测：down 默认 --user=sbx_verify 与 up 实际值不一致时，旧实现
     静默留下幽灵账号 + user_tenants 绑定，且仍报 ok:true）
  · down 的 ok 现在反映 ZERO_RESIDUE，有残留即 exit 1，不再假装成功

⚠️🔴 沙箱改写了数据 —— 这些验证在沙箱里做等于没做（2026-09-15 实测踩坑）：
  克隆后脚本会把**全部** forecast_submissions.order_date 改成今天（见下方第 1 步），
  目的是让克隆来的报单落进「今日报单」窗口。副作用是**任何按期次/日期窗口过滤的行为
  都会失真**：期次窗口只要含今天，就命中全部报单。
  实测：期次 9（窗口 8/30~9/15）返回 95 个商品 / 12,713 件 = 全时段数据；
        而按真实 order_date 手算同一 cond 只有 4 个商品 / 4 件。
  差点据此误报「后端期次过滤失效」的产品缺陷 —— 根因是沙箱自己改的数据。

  ✅ 沙箱**可以**验证：单行取值、单元格渲染、列统计、筛选、复制、金额计算、
     布局/容量、交互路径（这些都与 order_date 无关）。
  ❌ 沙箱**不能**验证：期次归属、跨期不重复计入、时间窗口筛选、达成月归属、
     任何依赖 order_date 的报表口径 —— 一律去真实库只读手算，或起真实租户对照。
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
    # 🔴 2026-09-15 修复：必须连源库的 -wal / -shm 一起复制。
    #    生产库长期运行在 WAL 模式，未 checkpoint 的改动**只在 -wal 里**，
    #    旧实现只 copy 主库文件 ⇒ 克隆出的是过期快照，沙箱复现不出生产问题。
    #    实测（tenant_1）：主库文件 mtime 12:02、-wal mtime 18:03；
    #    沙箱拿到的是 12:02 状态（5 条返利目标、年度目标"进行中"），
    #    而 -wal 里的真实状态是 2 条、且全部已停用 ⇒ 症状在沙箱里消失，极易误判产品无缺陷。
    for suffix in ("-wal", "-shm"):
        sp = src_db + suffix
        if os.path.exists(sp):
            shutil.copy2(sp, dst_db + suffix)
    os.chmod(dst_db, 0o644)          # 与真实租户一致；属主已是 hergent（脚本以 hergent 跑）

    today = date.today().isoformat()
    tc = sqlite3.connect(dst_db)
    # 让数据落进「今日报单」窗口（前端无期次时取 summary(order_start=order_end=今天)）
    # ⚠️🔴 这一句是本工具最大的副作用：它把**全部**报单的日期改到今天 ⇒ 沙箱里
    #     「按期次/日期窗口过滤」的行为全部失真（窗口含今天即命中全部报单）。
    #     2026-09-15 实测：期次 9 返回 95 商品/12,713 件（=全时段），据此差点误报产品缺陷。
    #     要验证期次归属/窗口筛选，别用沙箱 —— 去真实库只读手算（见文首 ⚠️ 段）。
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
                   # ⚠️ 必须落盘 user/user_id：down 默认 --user=sbx_verify，与 up 实际值不一致时
                   #    按 username 查不到 → 旧实现静默留下幽灵账号（2026-09-15 实测踩过）
                   "user": a.user, "user_id": uid,
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
    # 先读 up 落盘的 meta（含 user / user_id），供下面兜底
    meta_path = "/tmp/sandbox_%d.meta.json" % a.id
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
        except Exception:
            meta = {}

    # 🔴 源库必须以 up 时落盘的 meta["src"] 为准（2026-09-15 实测修）。
    #    旧实现直接取 a.src，而 down 的 --src 默认 10：只给 up 传了 `--src 1`、down 不带
    #    `--src 1` 时，会拿 **tenant_1 的指纹** 去比 **tenant_10 的计数** ⇒ 稳定假报
    #    「112 张业务表计数变了」+ verdict=review。实证三步排除真漂移：
    #      ① 紧邻的 up→down（间隔 4s）同样报 122 张表，期间源库无人写；
    #      ② 源库 -wal mtime 早于 up 时刻，该窗口 nginx 非 GET 请求数 = 0；
    #      ③ 同一库连读两次 + JSON 往返，_src_diff 均为 0 —— 指纹函数本身稳定。
    #    ⚠️ 这道假警报的方向最坏：会把「干净的沙箱」读成「污染了真实库」。
    if meta.get("src") and int(meta["src"]) != a.src:
        src_db = os.path.join(ERP_DIR, "tenant_%d.db" % int(meta["src"]))

    mc = sqlite3.connect(MASTER)
    mc.row_factory = sqlite3.Row
    removed = {}
    uids = []
    lookup = None
    try:
        # 三级查找，任一级命中即用 —— 目标：**只要租户清了，账号与绑定关系一定清掉**
        # ① 首选 up 落盘的 user_id（最可靠，不受 --user 默认值错配影响）
        if meta.get("user_id"):
            uids = [meta["user_id"]]
            lookup = "meta.user_id"
        # ② 其次按 --user 用户名查
        if not uids:
            rows = mc.execute("SELECT id FROM users WHERE username=?", (a.user,)).fetchall()
            uids = [r["id"] for r in rows]
            if uids:
                lookup = "username:%s" % a.user
        # ③ 兜底：按 tenant_id 反查 user_tenants
        if not uids:
            rows = mc.execute("SELECT user_id FROM user_tenants WHERE tenant_id=?", (a.id,)).fetchall()
            uids = [r["user_id"] for r in rows]
            if uids:
                lookup = "user_tenants.tenant_id:%d" % a.id
        if not uids:
            lookup = "none"
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
    # meta 已在 step 1 读过（含 user / user_id / src_table_counts），此处复用，不再重复读
    src_fp = _table_counts(src_db) if os.path.exists(src_db) else None
    check = _src_diff(meta.get("src_table_counts"), src_fp)
    if os.path.exists(meta_path):
        os.remove(meta_path)
    zero = (not left_files and all(v == 0 for v in left.values()))
    print(json.dumps({
        # ⚠️ ok 必须反映 ZERO_RESIDUE：旧实现恒 ok:true，有残留时会被读成「销毁成功」
        "ok": zero, "tenant_id": a.id, "user_lookup": lookup,
        "removed_master_rows": removed, "left_master_rows": left,
        "left_files": left_files, "ZERO_RESIDUE": zero,
        "src_sha256_after": src_after,
        "src_business_check": check,
    }, ensure_ascii=False))
    if not zero:
        sys.exit("销毁未达零残留：left_master_rows=%s left_files=%s user_lookup=%s" % (left, left_files, lookup))


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
    dn.add_argument("--user", default="sbx_verify",
                    help="与 up 时一致；即便忘传也有三级兜底（meta.user_id → username → tenant_id 反查 user_tenants）")
    dn.set_defaults(func=cmd_down)

    a = ap.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
