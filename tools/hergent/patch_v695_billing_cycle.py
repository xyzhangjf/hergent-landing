#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v695：AI 额度改为「按购买日滚动」的计费周期，并修复改档越权。

一、周期（老板 2026-10-26 定）
    原来是 `first = datetime.now().strftime("%Y-%m-01")` —— **自然月**，
    每月 1 日一夜之间清零。问题：
      · 客户 10 月 20 日才开始用，付了一个月的钱只享受到 10 天额度；
      · 卖的是"月度订阅"，账期应当从**购买日**起算，而不是从日历上切。
    改为：`[本锚点日, 下锚点日)` 的滚动窗口，例如 6/18 开通 ⇒ 每轮 6/18~7/18。
    月末钳制用 calendar.monthrange：锚点 31 日 ⇒ 2 月按 28/29 日算，
    但**每次从原始 day 重算**，所以 3 月会回到 31 日（不会被 2 月带偏）。

二、锚点从哪来（三级回落，越靠前越权威）
    ① `ai_quota.cycle_anchor_date`：开通/改档时写入，此后固定；
    ② `tenants.created_at`：注册日 ≈ 购买日（对已有客户不用补数据）；
    ③ 自然月 1 日：兜底，绝不因为缺数据把接口打挂。

三、顺带修一个越权（这条比周期更严重）
    `POST /api/ai/quota` 原先只 `_auth(request)` —— 只校验"已登录"。
    而 `QUOTA_TIERS` 里 enterprise = 60,000 积分/月，任何**租户管理员**
    都能 POST `{"tier":"enterprise"}` 把自己升上去，还能直接传 `monthly_chars`
    设任意额度 ⇒ 免费白嫖。这与 core.py 里 `_platform_admin` 注释写的
    「每个自注册用户角色就是 boss，提权口子不能挂在 boss 上」是同一类洞。
    改档是商业条款，只能平台方操作 ⇒ 判据换成 `_platform_admin`（fail-closed）。

用法：
    python3 patch_v695_billing_cycle.py --target=/opt/hergent-erp/routers/ai_assist.py [--dry-run]
"""
import sys
import shutil
import py_compile
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/ai_assist.py")

# ─────────────────────────────────────────────────────────────
# 补丁 1：ai_quota 加 cycle_anchor_date 列（幂等）
# ─────────────────────────────────────────────────────────────
ENSURE_OLD = '''def _ensure_quota_table(c):
    c.execute(
        """CREATE TABLE IF NOT EXISTS ai_quota (
            tenant_id INTEGER PRIMARY KEY,
            tier TEXT DEFAULT 'free',
            monthly_chars INTEGER DEFAULT 0
        )"""
    )'''

ENSURE_NEW = '''def _ensure_quota_table(c):
    c.execute(
        """CREATE TABLE IF NOT EXISTS ai_quota (
            tenant_id INTEGER PRIMARY KEY,
            tier TEXT DEFAULT 'free',
            monthly_chars INTEGER DEFAULT 0
        )"""
    )
    # v695：计费周期锚点（购买日）。老库没有这列 ⇒ 幂等补上。
    #   注意：本函数也被只读连接（db.get_db()）调用，DDL 可能不落盘。所以
    #   `_quota_for` 里查这列时另有 try/except 回落，不靠这里必然成功。
    try:
        _cols = {r[1] for r in c.execute("PRAGMA table_info(ai_quota)").fetchall()}
        if "cycle_anchor_date" not in _cols:
            c.execute("ALTER TABLE ai_quota ADD COLUMN cycle_anchor_date TEXT")
    except Exception as _e:  # noqa: BLE001
        log.warning("[quota] 补 cycle_anchor_date 列失败（回落自然月）：%s", _e)


def _cycle_bounds(anchor_day, now=None):
    """返回本轮额度周期 [start, end) 两个 date。

    anchor_day = 购买日的「日」（1-31）。月末钳制用当月实际天数，
    且**每轮都从原始 anchor_day 重算** ⇒ 锚点 31 时：1/31、2/28、3/31 这样走，
    不会因为 2 月只有 28 天就永久退化成 28。
    """
    import calendar
    from datetime import date as _date

    now = now or datetime.now()
    d = max(1, min(31, int(anchor_day or 1)))

    def _clamp(y, m):
        return min(d, calendar.monthrange(y, m)[1])

    if now.day >= _clamp(now.year, now.month):
        sy, sm = now.year, now.month
    else:
        sy, sm = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    sd = _clamp(sy, sm)

    ny, nm = (sy, sm + 1) if sm < 12 else (sy + 1, 1)
    nd = _clamp(ny, nm)
    return _date(sy, sm, sd), _date(ny, nm, nd)


def _cycle_anchor_of(row, tenant_row):
    """三级回落取「购买日」的日份。返回 (anchor_day, source)。"""
    # ① 显式锚点（开通时写入）
    try:
        v = row["cycle_anchor_date"] if row is not None else None
    except (IndexError, KeyError, TypeError):
        v = None
    if v:
        try:
            return datetime.strptime(str(v)[:10], "%Y-%m-%d").day, "anchor"
        except Exception:  # noqa: BLE001
            pass
    # ② 租户注册日（≈ 购买日，老客户不必补数据）
    try:
        c_at = tenant_row["created_at"] if tenant_row is not None else None
    except (IndexError, KeyError, TypeError):
        c_at = None
    if c_at:
        try:
            day = datetime.strptime(str(c_at)[:10], "%Y-%m-%d").day
            if 1 <= day <= 31:
                return day, "tenant_created"
        except Exception:  # noqa: BLE001
            pass
    # ③ 兜底：自然月
    return 1, "calendar"'''

# ─────────────────────────────────────────────────────────────
# 补丁 2：_quota_for 读三列 + 读租户注册日
# ─────────────────────────────────────────────────────────────
ROW_OLD = '''            _ensure_quota_table(c)
            row = c.execute(
                "SELECT tier, monthly_chars FROM ai_quota WHERE tenant_id=?", (tid,)
            ).fetchone()'''

ROW_NEW = '''            _ensure_quota_table(c)
            # v695：多读 cycle_anchor_date。老库该列可能因 DDL 未落盘而缺失 ⇒ 回落两列。
            try:
                row = c.execute(
                    "SELECT tier, monthly_chars, cycle_anchor_date FROM ai_quota WHERE tenant_id=?",
                    (tid,),
                ).fetchone()
            except Exception:  # noqa: BLE001
                row = c.execute(
                    "SELECT tier, monthly_chars FROM ai_quota WHERE tenant_id=?", (tid,)
                ).fetchone()
            # v695：租户注册日（≈ 购买日），用于在没有显式锚点时定周期起点
            try:
                _trow = c.execute(
                    "SELECT created_at FROM tenants WHERE id=?", (tid,)
                ).fetchone()
            except Exception as _e:  # noqa: BLE001
                log.warning("[quota] 读 tenants.created_at 失败（周期回落自然月）：%s", _e)
                _trow = None'''

# ─────────────────────────────────────────────────────────────
# 补丁 3：first 从「月初」改成「本轮起点」
# ─────────────────────────────────────────────────────────────
FIRST_OLD = '''        first = datetime.now().strftime("%Y-%m-01")'''

FIRST_NEW = '''        # ── v695：周期 = 从购买日起、每月同一天滚动（不再按自然月）────────
        #   老板原话：「额度不应以自然月为单位发放，应该以客户购买日往后顺延」。
        #   1 号一刀切对月中开通的客户不公平（10/20 开通只享受到 10 天额度）。
        _anchor_day, _anchor_src = _cycle_anchor_of(row, _trow)
        _cyc_start, _cyc_end = _cycle_bounds(_anchor_day)
        first = _cyc_start.strftime("%Y-%m-%d")
        _days_left = max(0, (_cyc_end - datetime.now().date()).days)'''

# ─────────────────────────────────────────────────────────────
# 补丁 4：返回里补周期字段
# ─────────────────────────────────────────────────────────────
RET_OLD = '''            "credits_pct": credits_pct,
            "cost_cny_this_month": round(float(cost_cny or 0), 4),'''

RET_NEW = '''            "credits_pct": credits_pct,
            # ↓ v695 计费周期（前端据此显示「下一轮几号恢复」，不再写死「每月 1 日」）
            "cycle_start": _cyc_start.isoformat(),
            "cycle_end": _cyc_end.isoformat(),
            "cycle_days_left": _days_left,
            "cycle_anchor_day": _anchor_day,
            "cycle_source": _anchor_src,
            "cost_cny_this_month": round(float(cost_cny or 0), 4),'''

# ─────────────────────────────────────────────────────────────
# 补丁 5：改档提权（只校验登录 → 只允许平台管理员）
# ─────────────────────────────────────────────────────────────
PERM_OLD = '''@router.post("/quota")
async def set_quota(request: Request):
    u = _auth(request)'''

PERM_NEW = '''@router.post("/quota")
async def set_quota(request: Request):
    # 🔴 v695：改档 = 商业条款（决定每月能免费用多少 AI），只能平台方操作。
    #   原判据 `_auth` 只校验「已登录」⇒ 任何租户管理员都能 POST {"tier":"enterprise"}
    #   把自己升到 60,000 积分/月，或直接传 monthly_chars 设任意额度 = 越权提额。
    #   这与 core.py `_platform_admin` 注释里写的「每个自注册用户角色就是 boss，
    #   提权口子不能挂在 boss 上」是同一类洞 ⇒ 换成 platform_admins 名单表（fail-closed）。
    from core import _platform_admin
    u = _platform_admin(request)'''

# ─────────────────────────────────────────────────────────────
# 补丁 6：首次开档写入周期锚点（不覆盖已有锚点）
# ─────────────────────────────────────────────────────────────
INS_OLD = '''            c.execute(
                "INSERT INTO ai_quota (tenant_id, tier, monthly_chars) VALUES (?,?,?) "
                "ON CONFLICT(tenant_id) DO UPDATE SET tier=excluded.tier, "
                "monthly_chars=excluded.monthly_chars",
                (tid, tier, monthly),
            )'''

INS_NEW = '''            # v695：首次开档时把「购买日」记下来当周期锚点（取租户注册日，拿不到取今天）。
            #   `ON CONFLICT` 分支**不动** cycle_anchor_date —— 锚点只在开通时定一次；
            #   否则客户每升一次档，本轮额度就被重置一次，等于可以刷额度。
            c.execute(
                "INSERT INTO ai_quota (tenant_id, tier, monthly_chars, cycle_anchor_date) "
                "VALUES (?,?,?, COALESCE((SELECT substr(created_at,1,10) FROM tenants WHERE id=?), "
                "date('now','localtime'))) "
                "ON CONFLICT(tenant_id) DO UPDATE SET tier=excluded.tier, "
                "monthly_chars=excluded.monthly_chars",
                (tid, tier, monthly, tid),
            )'''


def main() -> int:
    dry = "--dry-run" in sys.argv
    target = DEFAULT_TARGET
    for a in sys.argv[1:]:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    src = target.read_text(encoding="utf-8")

    if '"cycle_anchor_day"' in src:
        print("已打过 v695，跳过。")
        return 0

    steps = [
        ("ensure-column", ENSURE_OLD, ENSURE_NEW),
        ("quota-row", ROW_OLD, ROW_NEW),
        ("first-date", FIRST_OLD, FIRST_NEW),
        ("return-fields", RET_OLD, RET_NEW),
        ("set-quota-perm", PERM_OLD, PERM_NEW),
        ("insert-anchor", INS_OLD, INS_NEW),
    ]
    # 全部锚点先校验命中 1 次，再一起改（避免改一半留下半截状态）
    for name, old, _new in steps:
        n = src.count(old)
        if n != 1:
            print("%s 锚点命中 %d 次（必须 1），未修改。" % (name, n))
            return 3

    out = src
    for _name, old, new in steps:
        out = out.replace(old, new, 1)

    if dry:
        print("[dry-run] 将改 6 处：加列 / 读锚点 / 周期起点 / 返回字段 / 改档权限 / 开档写锚点")
        return 0

    backup = target.with_suffix(target.suffix + ".bak-v695")
    if not backup.exists():
        shutil.copy2(target, backup)
        print("已备份 → %s" % backup)
    tmp = target.with_suffix(".v695.tmp")
    tmp.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(tmp), doraise=True)
    except py_compile.PyCompileError as e:
        tmp.unlink(missing_ok=True)
        print("语法校验失败：%s" % e)
        return 4
    shutil.move(str(tmp), str(target))
    print("已写入 %s" % target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
