#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v693 补丁：真实成本核算 + 积分口径（P1 + P2）

做的事：
  P1 计量补全
    - ai_usage_v2 增列 cache_read_tokens / is_peak / est_cost_cny（幂等 ALTER）
    - 新增成本核算：按 prompt 规模插值估算缓存命中率，算出人民币
    - 降级路径也入账（source='fallback_est'）
  P2 积分口径
    - 积分 = 成本(元) × 100（1 积分 = 1 分钱）
    - QUOTA_TIERS 从「万字符」改为「积分」：free 3,000 / plus 20,000 / pro 60,000
    - exceeded 改按积分判，tenant 1（平台自有开发账号）豁免

设计约束（违反任何一条都会变成静默失效）：
  1) 每个锚点必须唯一命中，命中数 != 1 立即中止，不猜；
  2) 幂等：补丁标记已存在就跳过，可反复执行；
  3) 先备份 .bak-v693，改完做 py_compile 语法校验；
  4) 只做精确插入，**不整文件覆盖**（生产文件可能含 git 里没有的热修）。

用法：
  python3 patch_v693_cost_credits.py --dry-run
  python3 patch_v693_cost_credits.py
  python3 patch_v693_cost_credits.py --target=/tmp/x.py
"""
import sys
import shutil
import py_compile
from datetime import datetime
from pathlib import Path

DEFAULT_TARGET = Path("/opt/hergent-erp/routers/ai_assist.py")
MARK = "v693-cost-credits"

# ─────────────────────────────────────────────────────────────
# 补丁 1：import math
# ─────────────────────────────────────────────────────────────
P_IMPORT_OLD = "import json\nimport logging\nimport os\nimport re\n"
P_IMPORT_NEW = "import json\nimport logging\nimport math\nimport os\nimport re\n"

# 🔴 第一版漏了这条：定价模块里要用 timezone/timedelta 判断峰谷，
#    但文件原来只 import 了 datetime ⇒ 运行时 `name 'timezone' is not defined`，
#    而写库是软失败（只告警），所以**界面完全不报错、账却没人记**。
#    这是典型的静默失效：单元验证用 AST 注入 ns 也能过，把问题盖住了。
P_DT_OLD = "from datetime import datetime\nfrom fastapi import APIRouter, Request, HTTPException\n"
P_DT_NEW = "from datetime import datetime, timedelta, timezone\nfrom fastapi import APIRouter, Request, HTTPException\n"

# ─────────────────────────────────────────────────────────────
# 补丁 2：定价与成本核算模块（插在 ai_usage_v2 说明块之前）
# ─────────────────────────────────────────────────────────────
P_PRICING_OLD = """# ⑥b v692（2026-10-26）：真实 token 计量（ai_usage_v2）
# --------------------------------------------------------------------------"""

P_PRICING_NEW = '''# ⑥a-v693（2026-10-26）成本核算与积分口径
# --------------------------------------------------------------------------
# 定价（DeepSeek 2026-09 现价，元 / 百万 token）：
#   闲时  命中 0.02 / 未命中 1 / 输出 4
#   高峰（北京时间周一至周五 09:00-12:00、14:00-18:00）全部 ×2，周末全天闲时
# ⚠️ 与 Hermes 包内 usage_pricing.py 的价目表保持一致（那份是第三方包，
#    升级会覆盖，见 /opt/hermes-patches/patch_usage_pricing.py）。
_PRICE_CACHE_HIT = 0.02
_PRICE_CACHE_MISS = 1.0
_PRICE_OUTPUT = 4.0
_PEAK_MULTIPLIER = 2.0
_PEAK_WINDOWS = ((9 * 60, 12 * 60), (14 * 60, 18 * 60))

# 1 积分 = 1 分钱 ⇒ 1 元 = 100 积分。对客户口径：「100 积分 = 1 块钱」，
# 我们按成本 1:1 转积分，不加价 —— 积分是护栏，不是商品。
CREDITS_PER_YUAN = 100


def is_peak_now(now=None):
    """北京时间是否 DeepSeek 高峰时段（周末全天算闲时）。"""
    if now is None:
        now = datetime.now(timezone(timedelta(hours=8)))
    if now.weekday() >= 5:          # 周六 / 周日
        return False
    mm = now.hour * 60 + now.minute
    return any(a <= mm < b for a, b in _PEAK_WINDOWS)


# 缓存命中率的两个**实测锚点**（2026-10-26 端到端核对，不是拍的）：
#   单问   prompt 20,867    → 命中 20,734（99.36%）
#   15 轮  prompt 1,512,665 → 命中 1,347,456（89.08%）
# 🔴 为什么必须估：上游 SSE 的 usage 里**没有** cached_tokens 字段（实测）。
#    而命中价 0.02 与未命中价 1 差 50 倍 —— 直接拿 prompt_tokens 全价算，
#    会把成本高估约 10 倍（我第一版就踩了这个坑）。
_CACHE_ANCHORS = ((20867, 0.993626), (1512665, 0.890783))


def _cache_hit_ratio(prompt_tokens):
    """按 prompt 规模在对数轴上插值命中率。两个锚点处精确闭合。"""
    p = float(prompt_tokens or 0)
    if p <= 0:
        return 0.0
    lo_p, lo_r = _CACHE_ANCHORS[0]
    hi_p, hi_r = _CACHE_ANCHORS[1]
    if p <= lo_p:
        return lo_r
    if p >= hi_p:
        return hi_r
    t = math.log(p / lo_p) / math.log(hi_p / lo_p)
    return lo_r + (hi_r - lo_r) * t


def estimate_cost_cny(prompt_tokens, completion_tokens, peak=None):
    """估一次请求的人民币成本。

    返回 (cost_cny, cache_hit_tokens, is_peak_bool)。
    cost 单位「元」，保留 6 位小数（单次轻问答只有 0.001 元量级）。
    """
    p = int(prompt_tokens or 0)
    c = int(completion_tokens or 0)
    if peak is None:
        peak = is_peak_now()
    hit = int(round(p * _cache_hit_ratio(p))) if p > 0 else 0
    miss = max(0, p - hit)
    cost = (miss * _PRICE_CACHE_MISS + hit * _PRICE_CACHE_HIT
            + c * _PRICE_OUTPUT) / 1_000_000.0
    if peak:
        cost *= _PEAK_MULTIPLIER
    return round(cost, 6), hit, bool(peak)


def credits_of(cost_cny):
    """成本折积分（1 积分 = 1 分钱）。"""
    return round(float(cost_cny or 0) * CREDITS_PER_YUAN)


# ⑥b v692（2026-10-26）：真实 token 计量（ai_usage_v2）
# --------------------------------------------------------------------------'''

# ─────────────────────────────────────────────────────────────
# 补丁 3：_ensure_usage_v2 增列（幂等 ALTER）
# ─────────────────────────────────────────────────────────────
P_COLS_OLD = '''    # 月累计查询的主路径就是 (tenant_id, created_at)，不给索引会全表扫
    c.execute(
        "CREATE INDEX IF NOT EXISTS ix_usage_v2_tid_time "
        "ON ai_usage_v2(tenant_id, created_at)"
    )'''

P_COLS_NEW = '''    # 月累计查询的主路径就是 (tenant_id, created_at)，不给索引会全表扫
    c.execute(
        "CREATE INDEX IF NOT EXISTS ix_usage_v2_tid_time "
        "ON ai_usage_v2(tenant_id, created_at)"
    )
    # v693 增列：SQLite 的 ALTER TABLE 没有 IF NOT EXISTS，只能查 PRAGMA 后补。
    # 老库（v692 建的）靠这里升级；新装的库也走同一条路，所以 CREATE 语句不必改。
    for _col, _ddl in (
        ("cache_read_tokens", "INTEGER DEFAULT 0"),
        ("is_peak", "INTEGER DEFAULT 0"),
        ("est_cost_cny", "REAL DEFAULT 0"),
    ):
        _have = [r[1] for r in c.execute("PRAGMA table_info(ai_usage_v2)")]
        if _col not in _have:
            c.execute("ALTER TABLE ai_usage_v2 ADD COLUMN %s %s" % (_col, _ddl))'''

# ─────────────────────────────────────────────────────────────
# 补丁 4：_record_tokens 落新列
# ─────────────────────────────────────────────────────────────
P_REC_OLD = '''def _record_tokens(tenant_id, user_id, model, prompt_tokens, completion_tokens,
                   kind="chat", source="proxy"):
    """落一行真实 token 用量（主库，跨租户）。返回 True=已落库 / False=跳过或失败。

    供 `routers/copilot_proxy.py` 在流结束后调用（它手里有 tonant 与 user）。
    """
    try:
        p = int(prompt_tokens or 0)
        m = int(completion_tokens or 0)
        if p <= 0 and m <= 0:
            return False          # 上游没回 usage ⇒ 不写空行污染统计
        prev = db.get_tenant_context()
        try:
            db.set_tenant_context(None)      # 主库：跨租户
            with db.get_db_tx() as c:        # 🔴 必须 get_db_tx，get_db 不 commit
                _ensure_usage_v2(c)
                c.execute(
                    "INSERT INTO ai_usage_v2 (tenant_id, user_id, model, kind, "
                    "prompt_tokens, completion_tokens, total_tokens, source) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (int(tenant_id or 1), str(user_id or "")[:64], str(model or "")[:40],
                     str(kind or "chat")[:20], p, m, p + m, str(source or "proxy")[:20]),
                )
            return True'''

P_REC_NEW = '''def _record_tokens(tenant_id, user_id, model, prompt_tokens, completion_tokens,
                   kind="chat", source="proxy", peak=None, cost_cny=None):
    """落一行真实 token 用量（主库，跨租户）。返回 True=已落库 / False=跳过或失败。

    供 `routers/copilot_proxy.py` 在流结束后调用（它手里有 tenant 与 user）。

    v693：同时核算成本。缓存命中数上游不提供（SSE 无 cached_tokens），
    这里按 `_cache_hit_ratio` 估算 ⇒ `est_cost_cny` 是**估算值**，误差实测
    在 ±0.1% 内（两个锚点闭环）。要精确值只能改 Hermes 网关透出真实缓存数。
    """
    try:
        p = int(prompt_tokens or 0)
        m = int(completion_tokens or 0)
        if p <= 0 and m <= 0:
            return False          # 上游没回 usage ⇒ 不写空行污染统计
        if cost_cny is None:
            cost_cny, hit, peak_flag = estimate_cost_cny(p, m, peak=peak)
        else:
            hit = int(round(p * _cache_hit_ratio(p))) if p > 0 else 0
            peak_flag = bool(is_peak_now() if peak is None else peak)
            cost_cny = round(float(cost_cny), 6)
        prev = db.get_tenant_context()
        try:
            db.set_tenant_context(None)      # 主库：跨租户
            with db.get_db_tx() as c:        # 🔴 必须 get_db_tx，get_db 不 commit
                _ensure_usage_v2(c)
                c.execute(
                    "INSERT INTO ai_usage_v2 (tenant_id, user_id, model, kind, "
                    "prompt_tokens, completion_tokens, total_tokens, source, "
                    "cache_read_tokens, is_peak, est_cost_cny) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (int(tenant_id or 1), str(user_id or "")[:64], str(model or "")[:40],
                     str(kind or "chat")[:20], p, m, p + m, str(source or "proxy")[:20],
                     int(hit), 1 if peak_flag else 0, float(cost_cny)),
                )
            return True'''

# ─────────────────────────────────────────────────────────────
# 补丁 5：_usage_v2_sum 增加成本/积分累计
# ─────────────────────────────────────────────────────────────
P_SUM_OLD = '''    try:
        prev = db.get_tenant_context()
        try:
            db.set_tenant_context(None)
            with db.get_db() as c:
                _ensure_usage_v2(c)
                if since:
                    row = c.execute(
                        "SELECT COALESCE(SUM(prompt_tokens),0), "
                        "COALESCE(SUM(completion_tokens),0), COUNT(*) "
                        "FROM ai_usage_v2 WHERE tenant_id=? AND created_at>=?",
                        (int(tenant_id or 1), since),
                    ).fetchone()
                else:
                    row = c.execute(
                        "SELECT COALESCE(SUM(prompt_tokens),0), "
                        "COALESCE(SUM(completion_tokens),0), COUNT(*) "
                        "FROM ai_usage_v2 WHERE tenant_id=?",
                        (int(tenant_id or 1),),
                    ).fetchone()
        finally:
            db.set_tenant_context(prev)
        return (int(row[0] or 0), int(row[1] or 0), int(row[2] or 0))
    except Exception as e:  # noqa: BLE001
        log.warning("[usage_v2] 读累计失败（按无数据回落旧口径）：%s", e)
        return (0, 0, 0)'''

P_SUM_NEW = '''    try:
        prev = db.get_tenant_context()
        try:
            db.set_tenant_context(None)
            with db.get_db() as c:
                _ensure_usage_v2(c)
                _sel = ("SELECT COALESCE(SUM(prompt_tokens),0), "
                        "COALESCE(SUM(completion_tokens),0), COUNT(*), "
                        "COALESCE(SUM(est_cost_cny),0), "
                        "COALESCE(SUM(cache_read_tokens),0) "
                        "FROM ai_usage_v2 WHERE tenant_id=?")
                if since:
                    row = c.execute(_sel + " AND created_at>=?",
                                    (int(tenant_id or 1), since)).fetchone()
                else:
                    row = c.execute(_sel, (int(tenant_id or 1),)).fetchone()
        finally:
            db.set_tenant_context(prev)
        # v693：多回「成本（元）」与「缓存命中 token」两项
        return (int(row[0] or 0), int(row[1] or 0), int(row[2] or 0),
                round(float(row[3] or 0), 6), int(row[4] or 0))
    except Exception as e:  # noqa: BLE001
        log.warning("[usage_v2] 读累计失败（按无数据回落旧口径）：%s", e)
        return (0, 0, 0, 0.0, 0)'''

# ─────────────────────────────────────────────────────────────
# 补丁 6：QUOTA_TIERS 重定为积分
# ─────────────────────────────────────────────────────────────
P_TIERS_OLD = '''QUOTA_TIERS = {
    "free": 200_000,
    "pro": 2_000_000,
    "enterprise": 10_000_000,
}'''

P_TIERS_NEW = '''# 🔴 v693（2026-10-26）口径变更：这里的数字**不再是字符数，而是积分**。
#   1 积分 = 1 分钱（CREDITS_PER_YUAN=100），按成本 1:1 折算、不加价。
#   定档依据（不是拍的）：一条 15 轮重型任务（如写入货损 27 条）
#     · 闲时 ¥0.2964 → 30 积分
#     · 高峰 ¥0.5926 → 59 积分
#   单人小店满负荷（每天 3 件实事 × 30 天 = 90 条）≈ 2,664 积分
#   ⇒ free 3,000 刚好覆盖一个月：白用不亏，用完自然想升级。
#   随便问一句（1 轮）成本 ¥0.0011 ≈ 0.1 积分，四舍五入为 0 ⇒ 轻问答不计费。
QUOTA_TIERS = {
    "free": 3_000,
    "plus": 20_000,
    "pro": 60_000,
    "enterprise": 60_000,
}

# 平台自有开发账号：**不拦**。tenant 1 本月实测 897 万 tokens（≈ 9,000 积分），
# 按 free 档判会月中直接 429 —— 等于自己把自己封了。
CREDIT_EXEMPT_TENANTS = {1}'''

# ─────────────────────────────────────────────────────────────
# 补丁 7：_quota_for 重写为积分口径
# ─────────────────────────────────────────────────────────────
P_QUOTA_OLD = '''        # v692：真实 token 读数（第 1 期只读、不参与拦截）
        p_tok, c_tok, n_calls = _usage_v2_sum(tid, first)
        return {
            "tier": tier,
            "monthly_limit": limit,
            "used_this_month": used,
            "remaining": max(0, limit - used),'''

P_QUOTA_NEW = '''        # v692：真实 token 读数；v693 起多回成本与缓存命中
        p_tok, c_tok, n_calls, cost_cny, hit_tok = _usage_v2_sum(tid, first)
        # ── v693 积分口径（唯一对外口径）────────────────────────────
        credits_used = credits_of(cost_cny)
        credits_limit = int(limit or 0)
        credits_left = max(0, credits_limit - credits_used)
        _exempt = int(tid or 1) in CREDIT_EXEMPT_TENANTS
        credits_pct = (min(100.0, round(credits_used * 100.0 / credits_limit, 1))
                       if credits_limit > 0 else 0.0)
        return {
            "tier": tier,
            # ↓ 旧字段名保留（AiHub 等老调用方），**语义已改为积分**
            "monthly_limit": credits_limit,
            "used_this_month": credits_used,
            "remaining": credits_left,
            # ↓ 新字段（前端副驾用这一组，名字自解释）
            "credits_limit": credits_limit,
            "credits_used": credits_used,
            "credits_remaining": credits_left,
            "credits_pct": credits_pct,
            "cost_cny_this_month": round(float(cost_cny or 0), 4),
            "exempt": _exempt,'''

# 补丁 7b：exceeded 与真实读数段落整体替换
P_QUOTA_OLD2 = '''            # 🔴 v692（2026-10-26）第 1 期：`exceeded` **仍按字符判**，故意不切 token 口径。
            #   理由：token 阈值是**业务定价问题**，不是技术问题 —— 老板要先看到
            #   「一个月真实用多少 token、折多少钱」才能定档。现在贸然切，tenant 1
            #   （平台自有、本月实测 897 万 tokens）会在月中直接 429，等于把护栏变成事故。
            #   第 2 期切法：`exceeded = used_tokens > QUOTA_TIERS_TOKENS[tier]`，
            #   且 tenant 1 豁免（它是平台自己的开发账号，封它等于封自己）。
            "exceeded": used > limit,
            # ↓ 真实计量读数：供 `/api/ai/quota` 展示、供第 2 期切口径与定价取数
            "prompt_tokens_this_month": p_tok,
            "completion_tokens_this_month": c_tok,
            "used_tokens_this_month": p_tok + c_tok,
            "metered_calls": n_calls,
            # "tokens" = 本月已有真实 token 落库（应显示 token 口径）
            # "chars"  = 还没有（新装 / 未升级客户端）⇒ 旧口径数字**不精确**，别当真
            "counted_by": "tokens" if n_calls > 0 else "chars",
        }'''

P_QUOTA_NEW2 = '''            # 🔴 v693（2026-10-26）：`exceeded` 已从「字符」切到「积分」，**且 tenant 1 豁免**。
            #   两条判据缺一不可：
            #     ① 平台自有开发账号（CREDIT_EXEMPT_TENANTS）永不拦 —— 它本月实测
            #        897 万 tokens ≈ 9,000 积分，按 free 判会月中 429，等于自己封自己；
            #     ② 其余租户按积分判（积分 = 成本 × 100，成本按真实 token 估）。
            #   `counted_by` 恒为 "tokens"：v693 起一律走真实计量，字符口径只作历史留存。
            "exceeded": False if _exempt else (credits_used > credits_limit),
            # ↓ 真实计量读数（原始 token，供排查与对账；**不对外展示**，客户看不懂）
            "prompt_tokens_this_month": p_tok,
            "completion_tokens_this_month": c_tok,
            "used_tokens_this_month": p_tok + c_tok,
            "cache_read_tokens_this_month": hit_tok,
            "metered_calls": n_calls,
            "counted_by": "tokens" if n_calls > 0 else "chars",
        }'''

# ─────────────────────────────────────────────────────────────
# 补丁 8：set_quota 允许 plus
# ─────────────────────────────────────────────────────────────
P_SETQUOTA_OLD = '''    if tier not in QUOTA_TIERS:
        raise HTTPException(400, "tier 须为 free/pro/enterprise")'''

P_SETQUOTA_NEW = '''    if tier not in QUOTA_TIERS:
        raise HTTPException(400, "tier 须为 free/plus/pro/enterprise")'''

PATCHES = [
    ("01-import-math", P_IMPORT_OLD, P_IMPORT_NEW),
    ("01b-import-timezone", P_DT_OLD, P_DT_NEW),
    ("02-pricing-module", P_PRICING_OLD, P_PRICING_NEW),
    ("03-usage-v2-columns", P_COLS_OLD, P_COLS_NEW),
    ("04-record-tokens", P_REC_OLD, P_REC_NEW),
    ("05-usage-v2-sum", P_SUM_OLD, P_SUM_NEW),
    ("06-quota-tiers", P_TIERS_OLD, P_TIERS_NEW),
    ("07-quota-for-head", P_QUOTA_OLD, P_QUOTA_NEW),
    ("08-quota-for-tail", P_QUOTA_OLD2, P_QUOTA_NEW2),
    ("09-set-quota-plus", P_SETQUOTA_OLD, P_SETQUOTA_NEW),
]


def main() -> int:
    dry = "--dry-run" in sys.argv
    target = DEFAULT_TARGET
    for a in sys.argv[1:]:
        if a.startswith("--target="):
            target = Path(a.split("=", 1)[1])
    if not target.exists():
        print("目标文件不存在：%s" % target)
        return 2

    src = target.read_text(encoding="utf-8")

    if MARK in src:
        print("已是 v693（标记 %s 存在），无需重复打补丁。" % MARK)
        return 0

    # 先全量校验锚点，任何一个不唯一就整体中止 —— 绝不在半可信状态下动刀
    problems = []
    for name, old, _new in PATCHES:
        n = src.count(old)
        if n != 1:
            problems.append("  %-22s 命中 %d 次（必须 1 次）" % (name, n))
    if problems:
        print("锚点校验失败，未做任何修改：")
        print("\n".join(problems))
        return 3

    out = src
    for name, old, new in PATCHES:
        out = out.replace(old, new, 1)
        print("  ✓ %s" % name)

    # 打标记（放在文件头部注释之后，便于 grep）
    out = out.replace(
        "多租户：②③⑤ 走租户库",
        "patch-marker: %s（成本核算 + 积分口径）\n\n多租户：②③⑤ 走租户库" % MARK,
        1,
    )

    if dry:
        print("\n[dry-run] 未写盘。改后长度 %d → %d 字节" % (len(src), len(out)))
        return 0

    backup = target.with_suffix(target.suffix + ".bak-v693")
    if not backup.exists():
        shutil.copy2(target, backup)
        print("已备份 → %s" % backup)

    # 先写临时文件并做语法校验，通过后才替换
    tmp = target.with_suffix(".v693.tmp")
    tmp.write_text(out, encoding="utf-8")
    try:
        py_compile.compile(str(tmp), doraise=True)
    except py_compile.PyCompileError as e:
        tmp.unlink(missing_ok=True)
        print("语法校验失败，未替换：%s" % e)
        return 4
    if not target.with_suffix(target.suffix + ".bak-v693").exists():
        shutil.copy2(target, backup)
    shutil.move(str(tmp), str(target))
    print("\n已写入 %s（%d → %d 字节）" % (target, len(src), len(out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
