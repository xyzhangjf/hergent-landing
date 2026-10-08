# -*- coding: utf-8 -*-
"""v366 判据台：报单「已开放」通知 —— ① 遵守面板渠道开关 ② 报单窗口印到分

设计（对齐 hergent-capability-reality-audit 第九种的范式）：
  · 被测代码 = **磁盘真源码**（AST 抠函数体 → exec 到只提供假依赖的命名空间），不是手抄副本；
  · 不 import scheduler（它有顶层 init_db / 重依赖）；
  · 🔴 B 段**判别力自证**：造两份「旧口径」坏副本，同一套断言指向它们**必须 FAIL**。
     否则"全绿"只证明脚本能跑通，不证明它抓得住回归。

判据分五段：A 行为 / B 判别力 / C 静态链路 / D 同族调用方登记表 / E 外部客户可收性。
"""
import ast
import os
import sys
import types

SCHED = os.environ.get("V366_SCHED",
                       os.path.expanduser("~/Documents/hergent-erp/server/scheduler.py"))
FINANCE = os.environ.get("V366_FINANCE",
                         os.path.expanduser("~/Documents/hergent-erp/server/db/queries/finance.py"))

with open(SCHED, encoding="utf-8") as f:
    SRC = f.read()
TREE = ast.parse(SRC)

P, F = [], []


def ok(name, cond, detail=""):
    (P if cond else F).append(name)
    print("  %s %s%s" % ("PASS" if cond else "FAIL", name, ("  | " + detail) if detail else ""))


def grab(fn_name):
    for n in TREE.body:
        if isinstance(n, ast.FunctionDef) and n.name == fn_name:
            return ast.get_source_segment(SRC, n)
    raise SystemExit("找不到函数：" + fn_name)


# ---------------------------------------------------------------- 被测真源码
OPEN_SRC = grab("_notify_period_opened")


def make_runner(fn_src):
    """把函数源码 exec 进一个只有假依赖的命名空间，返回 build()。"""

    def _build():
        sent, pushed, logs = [], [], []
        db = types.ModuleType("db")

        def message_send(title, content, msg_type="notice", sender="", recipients="",
                         dedup_window=None, event_key=None, **kw):
            sent.append({"title": title, "content": content, "type": msg_type,
                         "event_key": event_key, "recipients": recipients})

        db.message_send = message_send
        conn_mod = types.ModuleType("db.connection")
        conn_mod.get_tenant_context = lambda: "1"
        db.connection = conn_mod
        sys.modules["db"] = db
        sys.modules["db.connection"] = conn_mod

        ns = {
            "db": db,
            "_push_tenant_channels": lambda t, ti, c: (pushed.append((t, ti, c)) or 1),
            "print": lambda *a, **k: logs.append(" ".join(str(x) for x in a)),
            "__builtins__": __builtins__,
        }
        exec(compile(fn_src, "<v366-extracted>", "exec"), ns)
        return ns, sent, pushed, logs

    return _build


def run_case(build, cfg, **kw):
    ns, sent, pushed, logs = build()
    ns["_forecast_reminder_cfg"] = lambda: cfg
    kw.setdefault("period_id", 23)
    kw.setdefault("os_", "2026-10-02")
    kw.setdefault("oe", "2026-10-03")
    kw.setdefault("close_time", "21:00")
    kw.setdefault("arrival", "2026-10-04")
    kw.setdefault("open_time", "16:00")          # 🔴 夹具必须给默认值，否则 A4 在真源码上也假红
    ns["_notify_period_opened"](**kw)
    return sent, pushed, logs


CFG_BOTH_ON = {"channels": {"inapp": True, "wecom": True}}
CFG_WECOM_OFF = {"channels": {"inapp": True, "wecom": False}}   # ← tenant_1 生产现状
CFG_INAPP_OFF = {"channels": {"inapp": False, "wecom": True}}


def suite(fn_src, tag):
    build = make_runner(fn_src)
    p0, f0 = len(P), len(F)

    # A1 wecom=False ⇒ 不出站；且必须留痕（"关掉"与"失败"在日志里可区分 —— R8）
    sent, pushed, logs = run_case(build, CFG_WECOM_OFF)
    ok("[%s] A1 wecom=off ⇒ 不推租户渠道" % tag, len(pushed) == 0, "pushed=%d" % len(pushed))
    ok("[%s] A1 wecom=off ⇒ 站内信照发" % tag, len(sent) == 1, "sent=%d" % len(sent))
    ok("[%s] A1 wecom=off ⇒ 日志点名'已关闭「企业微信」'" % tag,
       any("已关闭「企业微信」" in x for x in logs), "日志=%s" % (logs[-1:] or None))

    # A2 wecom=True ⇒ 出站
    sent, pushed, logs = run_case(build, CFG_BOTH_ON)
    ok("[%s] A2 wecom=on ⇒ 推租户渠道 1 次" % tag, len(pushed) == 1, "pushed=%d" % len(pushed))
    ok("[%s] A2 wecom=on ⇒ 站内信也发" % tag, len(sent) == 1, "sent=%d" % len(sent))

    # A3 inapp=False ⇒ 不落站内，且留痕
    sent, pushed, logs = run_case(build, CFG_INAPP_OFF)
    ok("[%s] A3 inapp=off ⇒ 不落站内" % tag, len(sent) == 0, "sent=%d" % len(sent))
    ok("[%s] A3 inapp=off ⇒ 渠道照推" % tag, len(pushed) == 1, "pushed=%d" % len(pushed))
    ok("[%s] A3 inapp=off ⇒ 日志点名'已关闭「站内信」'" % tag,
       any("已关闭「站内信」" in x for x in logs))

    # A4 时分：窗口行含到分
    sent, _, _ = run_case(build, CFG_BOTH_ON)
    body = sent[0]["content"]
    ok("[%s] A4 窗口行含开放时刻" % tag, "2026-10-02 16:00" in body, body.splitlines()[1])
    ok("[%s] A4 窗口行含关单时刻" % tag, "2026-10-03 21:00" in body)
    ok("[%s] A4 关单时刻只印一次（不重复行）" % tag, body.count("21:00") == 1,
       "出现 %d 次" % body.count("21:00"))
    ok("[%s] A4 保留'到期自动关单'的行动语义" % tag, "自动关单" in body)

    # A5 降级：拿不到 open_time ⇒ 退化为纯日期，不印空串
    sent, _, _ = run_case(build, CFG_BOTH_ON, open_time="")
    body = sent[0]["content"]
    ok("[%s] A5 无 open_time ⇒ 起点退化为日期" % tag,
       "2026-10-02 ~" in body and "16:00" not in body, body.splitlines()[1])

    # A6 事件键稳定（前端按类静音依赖它）
    sent, _, _ = run_case(build, CFG_BOTH_ON)
    ok("[%s] A6 event_key 稳定为 forecast_period_open_<期次>" % tag,
       sent[0]["event_key"] == "forecast_period_open_23", str(sent[0]["event_key"]))

    # A7 两通道都关 ⇒ 零外呼零落库，且不抛
    try:
        sent, pushed, logs = run_case(build, {"channels": {"inapp": False, "wecom": False}})
        ok("[%s] A7 两通道全关 ⇒ 不出站不落库且不抛" % tag,
           len(sent) == 0 and len(pushed) == 0, "sent=%d pushed=%d" % (len(sent), len(pushed)))
    except Exception as e:
        ok("[%s] A7 两通道全关 ⇒ 不出站不落库且不抛" % tag, False, "抛异常 %s" % e)

    return len(P) - p0, len(F) - f0, [x for x in F if ("[%s]" % tag) in x]


print("=" * 72)
print("A 段：行为判据（真源码）")
print("=" * 72)
a_pass, a_fail, _ = suite(OPEN_SRC, "真")

print()
print("=" * 72)
print("B 段：判别力自证 —— 造旧口径坏副本，同一套断言必须 FAIL")
print("=" * 72)
OLD_SW = OPEN_SRC.replace('_wecom = bool(_ch.get("wecom", False))', '_wecom = True')
assert OLD_SW != OPEN_SRC, "B1 替换未生效（锚点文本变了）"
b1p, b1f, b1n = suite(OLD_SW, "坏-不读开关")
print("  ⇒ 坏副本①（不读开关）：通过 %d / 失败 %d" % (b1p, b1f))
ok("B1 坏副本①必须被抓到", b1f > 0, "失败=%d" % b1f)
ok("B1 被抓到的正是开关类判据", any(("A1" in n or "A7" in n) for n in b1n), str(b1n))

OLD_WIN = OPEN_SRC.replace(
    '_win_s = ("%s %s" % (os_, open_time)) if open_time else str(os_ or "")',
    '_win_s = str(os_ or "")')
assert OLD_WIN != OPEN_SRC, "B2 替换未生效（锚点文本变了）"
b2p, b2f, b2n = suite(OLD_WIN, "坏-只日期")
print("  ⇒ 坏副本②（窗口只印日期）：通过 %d / 失败 %d" % (b2p, b2f))
ok("B2 坏副本②必须被抓到", b2f > 0, "失败=%d" % b2f)
ok("B2 被抓到的正是时分类判据", any("A4" in n for n in b2n), str(b2n))

print()
print("=" * 72)
print("C 段：静态链路判据（调用方是否真的把时刻传进来）")
print("=" * 72)
ok("C1 _auto_period_open 增加 open_time 形参",
   'def _auto_period_open(p, dry, close_time="", open_time="")' in SRC)
_open_seg = ast.get_source_segment(SRC, next(
    n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == "_auto_period_open"))
ok("C2 _auto_period_open 把 open_time 转发给通知函数", "open_time=open_time" in _open_seg)
ok("C3 调用点传了真实开放时刻 open_time=ot",
   "_auto_period_open(p, dry, close_time=ct, open_time=ot)" in SRC)
ok("C4 ot 在调用点作用域内确有定义", 'ot = (carrier.get("auto_open_time")' in SRC)

print()
print("=" * 72)
print("D 段：同族调用方一致性登记表（三类，逐条可失败）")
print("=" * 72)
# read = 报单提醒域内、必须读该开关；exempt = 同域内刻意豁免、须留书面理由；out = 不属该域、必须**不读**
FAMILY = [
    ("_notify_period_opened", "read", "报单提醒域 · 开放通知"),
    ("push_forecast_reminder_current", "read", "报单提醒域 · 催报"),
    ("push_forecast_summary", "read", "报单提醒域 · 截止后汇总"),
    ("_alert_carry_empty", "exempt", "同域内的系统故障告警（清单为空）"),
    ("_push_copilot_cards_brief", "out", "每日经营简报，不属报单提醒域"),
    ("_check_ai_reminders", "out", "用户自建 AI 提醒，不属报单提醒域"),
]


def reads_switch(fn_name):
    seg = grab(fn_name)
    return ("channels" in seg) and ("wecom" in seg or "inapp" in seg)


for fn_name, want, why in FAMILY:
    seg = grab(fn_name)
    if want == "read":
        ok("D %s 必须读 channels 开关" % fn_name, reads_switch(fn_name), why)
    elif want == "exempt":
        ok("D %s 豁免且留有书面理由" % fn_name,
           ("刻意不读" in seg) and ("v366" in seg), why)
    else:
        # 反向断言：不在该域的函数**不该**读该开关。哪天有人给它加上，说明串域了。
        ok("D %s 不在该域 ⇒ 不该读该开关" % fn_name, not reads_switch(fn_name), why)

print()
print("=" * 72)
print("E 段：外部客户（distributor）可收性 —— 唐成这类账号收不收得到")
print("=" * 72)
try:
    with open(FINANCE, encoding="utf-8") as f:
        fin_src = f.read()
    fin_tree = ast.parse(fin_src)
    WANT = {"AUDIENCE_ALL", "DEFAULT_AUDIENCE", "_AUDIENCE_EXACT", "_AUDIENCE_PREFIX_RAW",
            "_AUDIENCE_PREFIX", "audience_for_event", "roles_in_audience", "message_visible",
            "norm_event_key"}
    ns2 = {"__builtins__": __builtins__, "re": __import__("re")}
    for node in fin_tree.body:                      # 必须按 body 顺序（_AUDIENCE_PREFIX 依赖 RAW）
        take = False
        if isinstance(node, ast.Assign):
            take = any(isinstance(t, ast.Name) and t.id in WANT for t in node.targets)
        elif isinstance(node, ast.FunctionDef):
            take = node.name in WANT
        if take:
            exec(compile(ast.Module(body=[node], type_ignores=[]), "<finance>", "exec"), ns2)

    afe = ns2["audience_for_event"]
    mv = ns2["message_visible"]
    ek = "forecast_period_open_23"

    ok("E1 开放通知的受众已登记（不落 DEFAULT）",
       afe(ek) != ns2["DEFAULT_AUDIENCE"], afe(ek))
    ok("E2 受众名单含 distributor（唐成的角色）",
       "distributor" in afe(ek), afe(ek))
    ok("E3 distributor 可见「本期报单已开放」",
       mv("本期报单已开放", ek, "", ["distributor"], set()) is True)
    ok("E4 sales / supervisor / staff 同样可见",
       all(mv("本期报单已开放", ek, "", [r], set()) is True
           for r in ("sales", "supervisor", "staff")))
    # 反例（判别力）：不在名单的角色必须**不可见**，否则上面几条无意义
    ok("E5 反例·accountant 不可见（证明判据有牙齿）",
       mv("本期报单已开放", ek, "", ["accountant"], set()) is False)
    ok("E6 反例·盈亏快报对 distributor 不可见（域间不串）",
       mv("盈亏快报", "盈亏快报", "", ["distributor"], set()) is False)
except Exception as e:
    import traceback
    traceback.print_exc()
    ok("E 段整体执行", False, str(e))

print()
print("=" * 72)
print("汇总：PASS=%d  FAIL=%d" % (len(P), len(F)))
if F:
    print("失败项：")
    for x in F:
        print("  -", x)
print("=" * 72)
sys.exit(1 if F else 0)
