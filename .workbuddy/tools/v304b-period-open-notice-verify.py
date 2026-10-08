#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v304b 判据台：报单「已开放」通知（事件驱动）+ 固定轮让位

验的是**行为**，不是「代码里有没有那行字」。

🔴 本判据台的**核心**是 §1 的**判别力自证**：同一个函数，在「刚建过 / 没刚建过」
   两侧必须给出**不同**答案。两边同色 = 判据无效（本项目反复栽的坑：
   探针看起来全绿，其实什么都没验）。

§1 `_period_opened_recently()` 正反两侧 + 边界 + 失败方向（必须 fail-open）
§2 让位只作用于**定时轮**：respect_open_notice=True 短路，False 继续
§3 静态自检：三处接线（含 router **故意不传** flag）

⚠️ 不 import scheduler（erp_db 在 import 期就会开库/跑迁移）。
   照既有做法用 `ast` 抽源码再 exec —— 抽的是**生产同一份源码**，不是复制实现。
"""
import ast
import contextlib
import io
import os
import sqlite3
import sys
import tempfile
import types
from datetime import datetime, timedelta

SCHED = "/Users/zhangjunfeng/Documents/hergent-erp/server/scheduler.py"
ROUTER = "/Users/zhangjunfeng/Documents/hergent-erp/server/routers/forecast_submissions.py"

PASS = 0
FAIL = 0
NOTES = []


def check(cond, name, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  [OK] %s%s" % (name, ("  -> " + str(extra)) if extra else ""))
    else:
        FAIL += 1
        print("  [XX] %s%s" % (name, ("  -> " + str(extra)) if extra else ""))


def src_of(path, func_name):
    """从真实源码里抽出某个顶层函数的源码（含装饰器/签名/函数体）。"""
    text = io.open(path, encoding="utf-8").read()
    tree = ast.parse(text)
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func_name:
            return ast.get_source_segment(text, node)
    raise AssertionError("源码里找不到函数 %s（%s）" % (func_name, path))


def build_globals_for(func_src, extra_globals):
    """exec 一份函数源码，返回它的 globals（只含我们给的桩）。"""
    g = dict(extra_globals)
    exec(compile(func_src, "<extracted>", "exec"), g)
    return g


# ══════════════════════════════════════════════════════════════════
# §1 `_period_opened_recently()` —— 正反两侧 + 边界 + 失败方向
# ══════════════════════════════════════════════════════════════════
print("=" * 74)
print("§1  _period_opened_recently()：能不能区分「刚建过」与「没刚建过」")
print("=" * 74)

TMPDB = tempfile.mktemp(suffix="-v304b.db")
_conn = sqlite3.connect(TMPDB)


def _mk_forecast_periods():
    _conn.execute("DROP TABLE IF EXISTS forecast_periods")
    _conn.execute("CREATE TABLE forecast_periods ("
                  "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, order_start TEXT, "
                  "order_end TEXT, arrival_date TEXT, status TEXT, created_at TEXT)")
    _conn.commit()


def _ins(created_offset_seconds, name="t", created_null=False):
    if created_null:
        created = None
    else:
        created = (datetime.now() + timedelta(seconds=created_offset_seconds)
                   ).strftime("%Y-%m-%d %H:%M:%S")
    _conn.execute(
        "INSERT INTO forecast_periods (name, order_start, order_end, arrival_date, status, created_at) "
        "VALUES (?,?,?,?,?,?)", (name, "2026-09-28", "2026-09-29", "2026-10-03", "open", created))
    _conn.commit()


@contextlib.contextmanager
def _yield_conn():
    yield _conn


_g1 = build_globals_for(src_of(SCHED, "_period_opened_recently"), {
    "db": types.SimpleNamespace(get_db=lambda: _yield_conn()),
    "PERIOD_OPEN_NOTICE_MINUTES": 30,
    "print": print,
})
fn = _g1["_period_opened_recently"]

# --- 正侧（应判为「刚建过」）
_mk_forecast_periods()
_ins(-5 * 60)
check(fn() is True, "刚建成 5 分钟 -> True（应让位）")

_mk_forecast_periods()
_ins(-29 * 60)
check(fn() is True, "刚建成 29 分钟 -> True（边界内侧）")

# --- 反侧（应判为「没刚建过」）—— 没有这一侧，判据就没有判别力
_mk_forecast_periods()
_ins(-31 * 60)
check(fn() is False, "建成 31 分钟 -> False（边界外侧）")

_mk_forecast_periods()
_ins(-3 * 3600)
check(fn() is False, "建成 3 小时 -> False")

_mk_forecast_periods()
_ins(0, name="only_null", created_null=True)
check(fn() is False, "只有 NULL created_at -> False")

_mk_forecast_periods()
check(fn() is False, "表存在但 0 行 -> False")

# --- 失败方向：读不到必须 fail-open（照常催单），不能静默不催
_conn.execute("DROP TABLE IF EXISTS forecast_periods")
_conn.commit()
_g1["print"] = lambda *a, **k: None
check(fn() is False, "缺表 -> False（fail-open：照常催单）")
check(fn() is False, "缺表时**静默但结果安全**（表不存在 ⇒ 必然没有「刚建过」，不必刷屏）")

# 真正的异常路径（开库就炸）**必须留痕** —— 否则又一处静默失效
def _boom():
    raise RuntimeError("模拟开库失败")

_buf = io.StringIO()
_g2 = build_globals_for(src_of(SCHED, "_period_opened_recently"), {
    "db": types.SimpleNamespace(get_db=_boom),
    "PERIOD_OPEN_NOTICE_MINUTES": 30,
    "print": lambda *a, **k: _buf.write(" ".join(str(x) for x in a)),
})
check(_g2["_period_opened_recently"]() is False, "开库抛异常 -> False（fail-open）")
check("探测失败" in _buf.getvalue(),
      "开库抛异常时**有留痕**（不静默）", _buf.getvalue().strip()[:70])
_g1["print"] = print

# --- 参数化：minutes 生效
_mk_forecast_periods()
_ins(-45 * 60)
check(fn() is False and fn(60) is True, "minutes 参数生效：45 分钟在 30 内为 False、在 60 内为 True")


# ══════════════════════════════════════════════════════════════════
# §2 让位只作用于定时轮
# ══════════════════════════════════════════════════════════════════
print()
print("=" * 74)
print("§2  push_forecast_reminder_current(respect_open_notice=?)：让位只打定时轮")
print("=" * 74)

REM_SRC = src_of(SCHED, "push_forecast_reminder_current")

called = {"state": 0}


def _stub_state():
    called["state"] += 1
    return None                      # 无开放期次 -> 走原路径后返回 False


def _run_reminder(respect, opened_recently):
    called["state"] = 0
    g = build_globals_for(REM_SRC, {
        "PERIOD_OPEN_NOTICE_MINUTES": 30,
        "_period_opened_recently": lambda *a, **k: opened_recently,
        "_forecast_reminder_state": _stub_state,
        "datetime": datetime,
        "print": lambda *a, **k: None,
    })
    fn2 = g["push_forecast_reminder_current"]
    try:
        rv = fn2(respect_open_notice=respect)
    except TypeError:
        rv = fn2()
    return rv, called["state"]


rv, n = _run_reminder(True, True)
check(rv is False and n == 0,
      "定时轮 + 刚开放 -> 短路返回 False，且**没去算**催单状态", "state调用=%d" % n)

rv, n = _run_reminder(True, False)
check(n == 1, "定时轮 + 没刚开放 -> **继续**算催单状态（不误挡）", "state调用=%d" % n)

rv, n = _run_reminder(False, True)
check(n == 1,
      "手动轮 + 刚开放 -> **不短路**，照常算（手点必须真发）", "state调用=%d" % n)

# 默认值方向：不传参数时必须是「不让位」（失败方向安全）
g = build_globals_for(REM_SRC, {
    "PERIOD_OPEN_NOTICE_MINUTES": 30,
    "_period_opened_recently": lambda *a, **k: True,
    "_forecast_reminder_state": _stub_state,
    "datetime": datetime,
    "print": lambda *a, **k: None,
})
called["state"] = 0
try:
    g["push_forecast_reminder_current"]()          # 不传参
    n_def = called["state"]
except TypeError as e:
    n_def = -1
check(n_def == 1,
      "**默认不传参 = 不让位**（遗漏的调用点退化为「一定催」，不退化为「静默不催」）",
      "state调用=%d" % n_def)


# ══════════════════════════════════════════════════════════════════
# §3 静态自检：三处接线
# ══════════════════════════════════════════════════════════════════
print()
print("=" * 74)
print("§3  静态自检：接线是否真的接上（防止「函数写了但没人调」）")
print("=" * 74)

sched_txt = io.open(SCHED, encoding="utf-8").read()
router_txt = io.open(ROUTER, encoding="utf-8").read()


def between(text, start_marker, end_marker):
    i = text.index(start_marker)
    j = text.index(end_marker, i)
    return text[i:j]


open_body = between(sched_txt, "def _auto_period_open(", "def _alert_carry_empty(")
check("_notify_period_opened(pid" in open_body,
      "开放通知**被调用**在建表成功之后（不是只定义了函数）")
check(open_body.index("forecast_period_create") < open_body.index("_notify_period_opened(pid"),
      "调用顺序：先建表、后通知（用户点通知时页面可用）")
check("close_time=close_time" in open_body and "arrival=arr" in open_body,
      "通知带上关单时刻与到货日")

# 🔴 通知必须**自带兜底**：否则通知一炸就落到外层 except 打「建表失败」，
#    而期次其实已建成 —— 假信号会把下一轮排查整轮带偏。
_ni = open_body.index("_notify_period_opened(pid")
check(open_body.rfind("try:", 0, _ni) > open_body.rfind("except", 0, _ni),
      "通知调用**自己包着 try**（不裸奔在外层 except 里）")
check(open_body.find("except Exception as _ne:", _ni) > _ni,
      "通知有独立 except，且日志明说「**期次已建成**」（不留假信号）")

# R8：成功也必须留痕，否则「发了但没收到」与「压根没发」日志上一样
_notify_src = between(sched_txt, "def _notify_period_opened(", "def _auto_period_close(")
check("开放通知已发" in _notify_src and "pushed=" in _notify_src,
      "通知**成功也留痕**（含 pushed=N，能把「站内有、渠道没出去」区分出来）")

check("_auto_period_open(p, dry, close_time=ct)" in sched_txt,
      "调用处把品牌规则的关单时刻 ct 传进去了")
check("push_forecast_reminder_current(respect_open_notice=True)" in sched_txt,
      "定时轮传 respect_open_notice=True")

# 🔴 验的是**调用表达式**，不是「文件里有没有这个词」—— 注释里也会出现这个词，
#    用全文 `not in` 会得到假阴性（本判据台第一版就栽在这里）。
_rt_calls = [ln.strip() for ln in router_txt.splitlines()
             if "push_forecast_reminder_current(" in ln and "import" not in ln]
check(len(_rt_calls) == 1 and _rt_calls[0].rstrip(")") == "pushed = push_forecast_reminder_current(",
      "手动催单端点的**调用表达式**不传任何 flag（手点必须真发）", _rt_calls)
check("手动" in between(router_txt, "def manual_remind(", "def pending_summary(")
      and "不要" in between(router_txt, "def manual_remind(", "def pending_summary("),
      "router 里留了「以后重构不要为了统一而写成一样」的警示注释")

# 死代码检查：新增的两个函数必须都有调用点
for fname, needle in (("_period_opened_recently", "_period_opened_recently()"),
                      ("_notify_period_opened", "_notify_period_opened(pid")):
    defs = sched_txt.count("def %s(" % fname)
    uses = sched_txt.count(needle)
    check(defs == 1 and uses >= 1,
          "%s：定义 1 处、真实调用 %d 处（无死代码）" % (fname, uses))

print()
print("=" * 74)
print("PASS=%d  FAIL=%d" % (PASS, FAIL))
if NOTES:
    print("\n".join(NOTES))
try:
    _conn.close()
    os.unlink(TMPDB)
except Exception:
    pass
sys.exit(1 if FAIL else 0)
