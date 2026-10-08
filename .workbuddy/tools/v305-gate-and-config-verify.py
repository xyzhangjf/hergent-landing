#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v305 判据台：① 关单后「授权改单」判据 ② 报单提醒「配置驱动」（面板 7 组设置 + 四个节点）。

🔴 判别力自证（本台的核心 —— 不是"跑通就算通过"）：

  A. `forecast_period_writable` 的**四象限**必须全部存在：
       · closed 期次 + `allow_closed=False`（**旧口径**）⇒ 必须 **False**（照旧锁）
       · closed 期次 + `allow_closed=True` （**新口径**）⇒ 必须 **True** （放行）
       · **不存在**的期次 + 两种取值 ⇒ 必须**都 False**（← 反例：放宽 ≠ 什么都不判）
     缺任何一侧，"放行"都可能是"函数压根没判"造成的**假通过**。

  B. 纯函数（`_period_close_at` / `_in_quiet_hours` / `_forecast_reminder_cfg`）与
     常量（`_REMINDER_CFG_DEFAULT`）全部用 `ast.get_source_segment` 从**真实源码**提取后 exec
     —— **绝不复制实现**。复制出来的副本会与真身漂移，判据随之失去意义。

  C. `per_sales` 必须能**真读出来**（旧版被静默丢弃）—— 用 fake 连接喂 false，必须读回 false。
"""
import ast
import json
import os
import sys
from datetime import datetime

SERVER = os.path.expanduser("~/Documents/hergent-erp/server")
PRODUCT = os.path.expanduser("~/Documents/laozhangai-product")
SCHED = os.path.join(SERVER, "scheduler.py")
ERPDB = os.path.join(SERVER, "erp_db.py")
FC = os.path.join(SERVER, "routers/forecast_config.py")
FSUB = os.path.join(SERVER, "routers/forecast_submissions.py")
FE_FORECAST = os.path.join(PRODUCT, "hergent-cn-v2/src/pages/Forecast.vue")
FE_REMIND = os.path.join(PRODUCT, "hergent-cn-v2/src/components/forecast/ReminderConfig.vue")

_P = [0]
_F = [0]


def check(ok, label, extra=""):
    if ok:
        _P[0] += 1
        print("  PASS  " + label)
    else:
        _F[0] += 1
        print("  FAIL  " + label + (("   << " + str(extra)) if extra else ""))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def grab(path, names):
    """用 ast 从真实源码提取顶层函数 / 赋值，返回 {name: source}。"""
    text = read(path)
    tree = ast.parse(text)
    out = {}
    for n in tree.body:
        if isinstance(n, ast.FunctionDef) and n.name in names:
            out[n.name] = ast.get_source_segment(text, n)
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name) and t.id in names:
                    out[t.id] = ast.get_source_segment(text, n)
    return out


# ══════════════════════════════════════════════════════════════════════════
# §1 `_period_close_at` / `_in_quiet_hours`（纯函数，源码提取后 exec）
# ══════════════════════════════════════════════════════════════════════════
print("=" * 78)
print("§1 纯函数：关单时刻解析 + 免打扰时段（从真实源码提取）")
print("=" * 78)
G = grab(SCHED, {"_period_close_at", "_in_quiet_hours"})
check("_period_close_at" in G and "_in_quiet_hours" in G, "两个纯函数都能从源码提取到")
ns = {"datetime": datetime, "timedelta": __import__("datetime").timedelta}
exec(G["_period_close_at"], ns)
exec(G["_in_quiet_hours"], ns)
pca, iqh = ns["_period_close_at"], ns["_in_quiet_hours"]

print("-- _period_close_at --")
check(pca("2026-09-29", "11:00") == datetime(2026, 9, 29, 11, 0),
      "正常：2026-09-29 + 11:00 ⇒ 09-29 11:00", pca("2026-09-29", "11:00"))
check(pca("", "11:00") is None, "空 order_end ⇒ None（不催）")
check(pca("2026-09-29", "") is None, "空 close_time ⇒ None（不催）")
check(pca("2026-9-29", "11:00") is None, "不规范日期（9 字符）⇒ None（拒绝瞎解析）")
check(pca("2026-09-29 12:00", "11:00") == datetime(2026, 9, 29, 11, 0),
      "带时间尾巴 ⇒ 只取前 10 位日期", pca("2026-09-29 12:00", "11:00"))
check(pca(None, "11:00") is None, "None ⇒ None（不抛异常）")

print("-- _in_quiet_hours（跨零点 22:00~08:00）--")
Q = {"start": "22:00", "end": "08:00"}
check(iqh(datetime(2026, 9, 28, 22, 30), Q) is True, "22:30 ⇒ 免打扰")
check(iqh(datetime(2026, 9, 28, 23, 59), Q) is True, "23:59 ⇒ 免打扰")
check(iqh(datetime(2026, 9, 28, 7, 30), Q) is True, "07:30 ⇒ 免打扰（跨零点后段）")
check(iqh(datetime(2026, 9, 28, 8, 0), Q) is False, "08:00 ⇒ **不**免打扰（右开）")
check(iqh(datetime(2026, 9, 28, 12, 0), Q) is False, "12:00 ⇒ 不免打扰")
print("-- _in_quiet_hours（同日区间 09:00~11:00 / 边界 / 退化）--")
D = {"start": "09:00", "end": "11:00"}
check(iqh(datetime(2026, 9, 28, 9, 0), D) is True, "09:00 ⇒ 免打扰（左闭）")
check(iqh(datetime(2026, 9, 28, 10, 30), D) is True, "10:30 ⇒ 免打扰")
check(iqh(datetime(2026, 9, 28, 11, 0), D) is False, "11:00 ⇒ 不免打扰（右开）")
check(iqh(datetime(2026, 9, 28, 12, 0), D) is False, "12:00 ⇒ 不免打扰")
check(iqh(datetime(2026, 9, 28, 12, 0), {"start": "08:00", "end": "08:00"}) is False,
      "开始==结束 ⇒ 不视为免打扰（否则等于全天静音）")
check(iqh(datetime(2026, 9, 28, 12, 0), {}) is False, "空配置 ⇒ 不免打扰")
check(iqh(datetime(2026, 9, 28, 12, 0), None) is False, "None ⇒ 不免打扰（不抛）")
print()

# ══════════════════════════════════════════════════════════════════════════
# §2 `forecast_period_writable` 四象限（fake 连接，不掉进真库分支）
# ══════════════════════════════════════════════════════════════════════════
print("=" * 78)
print("§2 关单后「授权改单」判据 —— 四象限（旧口径锁 / 新口径放 / 反例）")
print("=" * 78)
G2 = grab(ERPDB, {"forecast_period_writable", "_period_opened_recently"})
check("forecast_period_writable" in G2, "从 erp_db.py 提取到判据函数")
_embedded_dead = False


class _Cur:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, sql, params=()):
        return _Cur(self._rows.get(int(params[0])))


class _Ctx:
    def __init__(self, conn):
        self._conn = conn

    def __enter__(self):
        return self._conn

    def __exit__(self, *a):
        return False


def _load_writable(rows):
    """把提取到的函数 exec 进一个只有 fake 依赖的命名空间。"""
    _ns = {"datetime": datetime,
           "get_db": (lambda: _Ctx(_Conn(rows)))}
    exec(G2["forecast_period_writable"], _ns)
    return _ns["forecast_period_writable"]


TODAY = datetime.now().strftime("%Y-%m-%d")
ROWS = {
    19: {"id": 19, "status": "closed", "order_end": "2026-09-27"},              # 已关单 + 已过截止
    20: {"id": 20, "status": "open", "order_end": "2026-09-27"},                # 未关单但已过截止
    21: {"id": 21, "status": "open", "order_end": "2099-12-31"},                # 正常进行中
}
w = _load_writable(ROWS)

r_old = w(19, allow_closed=False)
check(r_old[0] is False, "🔴 closed 期次 + allow_closed=False ⇒ **False**（旧口径照旧锁住）", r_old)
r_new = w(19, allow_closed=True)
check(r_new[0] is True and r_new[1] == "", "✅ closed 期次 + allow_closed=True ⇒ **True**（授权放行）", r_new)

r_miss_old = w(999, allow_closed=False)
r_miss_new = w(999, allow_closed=True)
check(r_miss_old[0] is False and r_miss_new[0] is False,
      "🔴 反例：期次**不存在**时两种取值**都 False**（放宽 ≠ 什么都不判）",
      "%s / %s" % (r_miss_old, r_miss_new))
check("不存在" in r_miss_new[1], "反例的拒因说的是「不存在」（而不是「已定稿」）", r_miss_new[1])

r_exp_old = w(20, allow_closed=False)
check(r_exp_old[0] is False, "open 但已过截止 + 严格口径 ⇒ False（截止硬锁仍在）", r_exp_old)
r_exp_new = w(20, allow_closed=True)
check(r_exp_new[0] is True, "open 但已过截止 + 授权 ⇒ True（授权覆盖截止锁）", r_exp_new)

r_ok = w(21, allow_closed=False)
check(r_ok[0] is True, "正常进行中的期次 ⇒ True（不经授权也放行，行为未变）", r_ok)
check(w(0)[0] is True and w(0)[1] == "", "pid=0（未归属）⇒ True（保持原行为，由调用方另判）")
print()

# ══════════════════════════════════════════════════════════════════════════
# §3 提醒配置：`_forecast_reminder_cfg` 真能读出用户的值（含 per_sales）
# ══════════════════════════════════════════════════════════════════════════
print("=" * 78)
print("§3 提醒配置读取 —— `per_sales` 必须真读出来（旧版被静默丢弃）")
print("=" * 78)
G3 = grab(SCHED, {"_forecast_reminder_cfg", "_REMINDER_CFG_DEFAULT"})
check("_forecast_reminder_cfg" in G3 and "_REMINDER_CFG_DEFAULT" in G3, "配置层函数与默认值都能提取")


def _load_cfg(payload):
    class _C:
        def __init__(self):
            self.payload = payload

        def execute(self, sql, params=()):
            return _Cur(None if self.payload is None else {"payload": self.payload})

    class _M:
        def get_db(self):
            return _Ctx(_C())

    _ns = {"json": json, "db": _M(), "print": print}
    exec(G3["_REMINDER_CFG_DEFAULT"], _ns)
    exec(G3["_forecast_reminder_cfg"], _ns)
    return _ns["_forecast_reminder_cfg"]()


d0 = _load_cfg(None)
check(d0["per_sales"] is True, "无保存记录 ⇒ per_sales 默认 True", d0.get("per_sales"))
check(d0["channels"]["wecom"] is True, "无保存记录 ⇒ wecom 默认 **True**（企微是唯一接通渠道）", d0["channels"])
check(d0["nodes"]["summary"] is False, "无保存记录 ⇒ summary 默认 **False**（用户要求「关单后通知不做」）", d0["nodes"])
check(d0["enabled"] is True, "无保存记录 ⇒ enabled 默认 True")

_user = json.dumps({"enabled": True, "lead_hours": 2, "final_hours": 1, "per_sales": False,
                    "channels": {"inapp": True, "wecom": False},
                    "quiet": {"start": "23:00", "end": "07:00"},
                    "nodes": {"new_period": False, "lead": True, "final": True, "summary": True}})
d1 = _load_cfg(_user)
check(d1["per_sales"] is False, "🔴 用户存 per_sales=false ⇒ 读回 **false**（旧版恒 True = 假开关）",
      d1.get("per_sales"))
check(d1["channels"]["wecom"] is False, "用户存 wecom=false ⇒ 读回 false（尊重用户值）", d1["channels"])
check(d1["nodes"]["summary"] is True, "用户存 summary=true ⇒ 读回 true", d1["nodes"])
check(d1["nodes"]["new_period"] is False, "用户存 new_period=false ⇒ 读回 false", d1["nodes"])
check(d1["lead_hours"] == 2 and d1["quiet"]["start"] == "23:00",
      "其余字段逐个读到（lead_hours / quiet）", (d1["lead_hours"], d1["quiet"]))

d2 = _load_cfg("{ 这不是 JSON")
check(d2["per_sales"] is True and d2["channels"]["wecom"] is True,
      "JSON 坏 ⇒ fail-open 回默认（照常提醒，不静默关闭）", d2["channels"])
d3 = _load_cfg(json.dumps({"lead_hours": 1, "final_hours": 99}))
check(d3["lead_hours"] == 1 and d3["final_hours"] == 99,
      "配置层**不篡改**用户值（篡改会让「面板显示的值」与「库里存的值」不一致）",
      (d3["lead_hours"], d3["final_hours"]))
print()

# ══════════════════════════════════════════════════════════════════════════
# §4 静态断言：面板 7 组设置 / 四节点是真接上了，不是假开关
# ══════════════════════════════════════════════════════════════════════════
print("=" * 78)
print("§4 静态断言：接线完整性（前后端 + 调度器）")
print("=" * 78)
fc = read(FC)
fsub = read(FSUB)
sched = read(SCHED)
fe1 = read(FE_FORECAST)
fe2 = read(FE_REMIND)

check('out["per_sales"] = bool(d.get("per_sales", True))' in fc,
      "① `_normalize_reminder` 真的读写 per_sales（不再丢弃）")
check('_NODE_DFLT = {"new_period": True, "lead": True, "final": True, "summary": False}' in fc,
      "② 节点默认值逐个给，summary 默认 False")
check('"channels": {"inapp": True, "wecom": True}' in fc,
      "③ 后端默认值 wecom=True（与调度器默认一致）")
check('"channels": {"inapp": True, "wecom": True}' in sched,
      "④ 调度器 `_REMINDER_CFG_DEFAULT` 与后端默认值一致（防两处漂移）")
check('ch.get("wecom", True)' in fc,
      "⑤ `_normalize_reminder` 的 wecom 兜底也是 True（不传该键与传 false 行为可区分）")

check('_u_role in SUMMARY_ROLES' in fsub, "⑥ save_matrix 用既有权威名单判授权（零新增名单）")
check('allow_closed=_allow_closed' in fsub, "⑦ 判据真的把 allow_closed 传下去了")
check('"closed_edit": _closed_edit' in fsub, "⑧ 回执里带 closed_edit（前端可提示已留痕）")
check('forecast_closed_edit_%s' in fsub, "⑨ 授权改单写站内留痕（event_key 按期次稳定）")
check('push_forecast_reminder_current(ignore_quiet=True)' in fsub,
      "⑩ 手动催单传 ignore_quiet=True（免打扰不拦用户的手）")

check('_should_run_at("forecast_reminder"' not in sched,
      "⑪ 催报已**不再**用固定钟点（9:00/16:00 那行已撤）")
check('_should_run("forecast_reminder", 300, now)' in sched,
      "⑫ 改为 5 分钟节流 + 配置定时")
check('_run_forecast_reminder_for_tenant' in sched and '_REMINDER_FIRE_WINDOW_MIN = 10' in sched,
      "⑬ 有按租户的配置驱动调度函数 + 触发窗口常量")
check('_monitors_run[_k] = now' in sched and '_k = "fcrmd:%d:%s"' in sched,
      "⑭ 幂等记账存在（同一期次同一节点只发一次 ⇒ 5 分钟轮不会变成 5 分钟催一次）")
check('_push_tenant_channels(_tid, title, broadcast_content)' in sched,
      "⑮ 企微走**租户自己的**通道（全局 webhook 从未配置 ⇒ 只靠它会一条都发不出）")
check('_in_quiet_hours(datetime.now(), cfg.get("quiet"))' in sched,
      "⑯ 免打扰真的接进了企微分支")
check('get("new_period", True)' in sched, "⑰ 「新期次发布时通知」节点真的可控")
check('def push_forecast_summary' in sched and 'nodes.get("summary", False)' in sched,
      "⑱ summary 节点实现了（默认关 = 用户要求「关单后通知不做」）")

check('canEditClosedPeriod' in fe1, "⑲ 前端有授权改单判据")
check('_final_h >= _lead_h' in sched,
      "㉗ 调度层会跳过重合的 final（`max(1, lead-1)` 压不干净 ⇒ 必须有这一道）")
check("canViewForecastSummary((store.user && store.user.role) || '')" in fe1,
      "⑳ 判据取**登录角色**（不是 localStorage 的 bizRole —— 两套词汇，会前后端打架）")
check('if (canEditClosedPeriod.value) return false' in fe1,
      "㉑ periodLocked 对授权角色让开")
check('if (!canEditClosedPeriod.value) {' in fe1,
      "㉒ saveEdits 的截止硬锁对授权角色跳过（避免「后端能存、前端不提交」的假封锁）")
check('closedEditMode' in fe1, "㉓ 有「为什么还能改」的说明态（不是默默放行）")
check('r.closed_edit' in fe1, "㉔ 保存回执用到 closed_edit")
check('wecom: true' in fe2, "㉕ 前端面板默认值 wecom=true（与后端一致）")
check('summary: false }' in fe2, "㉖ 前端面板默认 summary=false（与后端一致）")

# 死代码检查：新增函数必须有调用点
for fn, needle in (("_run_forecast_reminder_for_tenant", "_run_forecast_reminder_for_tenant(tid)"),
                   ("push_forecast_summary", "push_forecast_summary(node="),
                   ("_reminder_close_time", "_reminder_close_time(cfg)"),
                   ("_period_close_at", "_period_close_at(oe, ct)"),
                   ("_in_quiet_hours", "_in_quiet_hours(datetime.now()"),
                   ("_auto_period_times", "_auto_period_times()"),
                   ("_forecast_reminder_cfg", "_forecast_reminder_cfg()")):
    d = sched.count("def %s(" % fn)
    u = sched.count(needle)
    check(d == 1 and u >= 1, "%s：定义 1 处、调用 %d 处（无死代码）" % (fn, u), (d, u))
check('def _reminder_close_time' in sched and '_reminder_close_time(cfg)' in sched,
      "_reminder_close_time 被调用（关单时刻唯一取法）")
check('def _auto_period_times' in sched and '_auto_period_times()' in sched,
      "_auto_period_times 被调用（与真实关单同源）")

print()
print("=" * 78)
print("PASS=%d  FAIL=%d" % (_P[0], _F[0]))
print("=" * 78)
sys.exit(1 if _F[0] else 0)
