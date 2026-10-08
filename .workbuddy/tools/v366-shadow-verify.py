# -*- coding: utf-8 -*-
"""v366 影子库真机验证：真函数 + 真库副本 ⇒ 落库正文与开关行为

安全三保险（绝不碰生产、绝不外发）：
  ① 库是 `erp.db` / `tenant_1.db` 的 SQLite `backup()` 副本，在 /tmp 下；
  ② `ERP_DB_PATH` 指向副本目录（⚠️ 必须在 import erp_db **之前**设）；
  ③ `_push_tenant_channels` 被替换成**收集器** ⇒ 即使开关打开也不会真发企微。

被测代码 = 从生产 scheduler.py **真源码**抠出的 `_forecast_reminder_cfg` + `_notify_period_opened`
（AST 提取 → exec 到注入真 `db` 的命名空间），不是手抄副本。
"""
import ast
import json
import os
import shutil
import sqlite3
import sys
import types

PROD_DIR = "/opt/hergent-erp"
SCHED = os.path.join(PROD_DIR, "scheduler.py")
SHADOW = "/tmp/v366-shadow"

# ── ① 造副本（必须在任何 import 之前）
shutil.rmtree(SHADOW, ignore_errors=True)
os.makedirs(SHADOW, exist_ok=True)
for name in ("erp.db", "tenant_1.db"):
    src = os.path.join(PROD_DIR, name)
    if not os.path.exists(src):
        continue
    s = sqlite3.connect("file:%s?mode=ro" % src, uri=True)
    d = sqlite3.connect(os.path.join(SHADOW, name))
    with d:
        s.backup(d)
    d.close()
    s.close()
print("[影子库] %s" % sorted(os.listdir(SHADOW)))

# ── ② ERP_DB_PATH 指向副本（在 import 之前！）
os.environ["ERP_DB_PATH"] = os.path.join(SHADOW, "erp.db")
sys.path.insert(0, PROD_DIR)

import erp_db as realdb                                            # noqa: E402

print("[影子库] erp_db.DB_PATH =", getattr(realdb, "DB_PATH", "?"))

# ── 抠真源码
with open(SCHED, encoding="utf-8") as f:
    SRC = f.read()
TREE = ast.parse(SRC)


def grab(name):
    for n in TREE.body:
        if isinstance(n, ast.FunctionDef) and n.name == name:
            return ast.get_source_segment(SRC, n)
    raise SystemExit("找不到 " + name)


NS = {
    "db": realdb,
    "json": json,
    "print": print,
    "__builtins__": __builtins__,
    # 常量（真源码里的默认值）
    "_REMINDER_CFG_DEFAULT": None,
}
for n in TREE.body:
    if isinstance(n, ast.Assign):
        for t in n.targets:
            if isinstance(t, ast.Name) and t.id == "_REMINDER_CFG_DEFAULT":
                exec(compile(ast.Module(body=[n], type_ignores=[]), "<s>", "exec"), NS)
for fn in ("_forecast_reminder_cfg", "_notify_period_opened"):
    exec(compile(grab(fn), "<s>", "exec"), NS)      # ⚠️ 必须 grab(fn)（源码），不是 fn（名字）

PUSHED = []
NS["_push_tenant_channels"] = lambda tid, ti, c: (PUSHED.append((tid, ti, c)) or 1)

# 租户上下文（副本租户 1）
try:
    realdb.set_tenant_context(1)
except Exception:
    try:
        from db.connection import set_tenant_context
        set_tenant_context(1)
    except Exception as e:
        print("[警告] 设租户上下文失败：", e)

P, F = [], []


def ok(name, cond, detail=""):
    (P if cond else F).append(name)
    print("  %s %s%s" % ("PASS" if cond else "FAIL", name, ("  | " + detail) if detail else ""))


def count_rows(pid):
    c = sqlite3.connect(os.path.join(SHADOW, "tenant_1.db"))
    n = c.execute("SELECT COUNT(*) FROM message_center "
                  "WHERE COALESCE(event_key,'')=?", ("forecast_period_open_%d" % pid,)).fetchone()[0]
    c.close()
    return n


def latest_row(pid):
    c = sqlite3.connect(os.path.join(SHADOW, "tenant_1.db"))
    c.row_factory = sqlite3.Row
    r = c.execute("SELECT * FROM message_center WHERE COALESCE(event_key,'')=? "
                  "ORDER BY id DESC LIMIT 1", ("forecast_period_open_%d" % pid,)).fetchone()
    c.close()
    return dict(r) if r else None


def set_wecom(on):
    c = sqlite3.connect(os.path.join(SHADOW, "tenant_1.db"))
    row = c.execute("SELECT payload FROM forecast_config WHERE kind='reminder'").fetchone()
    cfg = json.loads(row[0]) if row else {}
    cfg.setdefault("channels", {})["wecom"] = bool(on)
    c.execute("UPDATE forecast_config SET payload=? WHERE kind='reminder'",
              (json.dumps(cfg, ensure_ascii=False),))
    c.commit()
    c.close()


print()
print("=" * 72)
print("[1] 真库现状：tenant_1 面板配置的 channels")
print("=" * 72)
cfg0 = NS["_forecast_reminder_cfg"]()
print("   channels =", cfg0.get("channels"), " nodes =", cfg0.get("nodes"))
ok("P1 读到真租户配置", isinstance(cfg0.get("channels"), dict), str(cfg0.get("channels")))
WECOM_NOW = bool((cfg0.get("channels") or {}).get("wecom", False))
print("   ⇒ 当前 wecom =", WECOM_NOW, "（这与生产一致；决定了部署后的真实行为）")

print()
print("=" * 72)
print("[2] 场景 A：沿用真库现状（wecom=%s）跑一次真实调用" % WECOM_NOW)
print("=" * 72)
PID_A = 90001
before = count_rows(PID_A)
NS["_notify_period_opened"](PID_A, "2026-10-05", "2026-10-06",
                            close_time="21:00", arrival="2026-10-08", open_time="16:00")
after = count_rows(PID_A)
row = latest_row(PID_A)
print("   message_center 行数 %d → %d" % (before, after))
ok("P2 真调一次 ⇒ 站内信真落库（1 行）", after == before + 1, "%d→%d" % (before, after))
if row:
    print("   落库正文：")
    for ln in (row["content"] or "").splitlines():
        print("     | " + ln)
    ok("P3 落库正文的窗口行含开放时刻", "2026-10-05 16:00" in (row["content"] or ""))
    ok("P4 落库正文的窗口行含关单时刻", "2026-10-06 21:00" in (row["content"] or ""))
    ok("P5 落库正文不再有单独的'关单时刻：'行",
       "关单时刻：" not in (row["content"] or ""))
    ok("P6 event_key 正确", row.get("event_key") == "forecast_period_open_90001",
       str(row.get("event_key")))
ok("P7 wecom=%s ⇒ 未外发（pushed 次数符合预期）" % WECOM_NOW,
   len(PUSHED) == (1 if WECOM_NOW else 0), "pushed=%d" % len(PUSHED))

print()
print("=" * 72)
print("[3] 场景 B：把副本配置改成 wecom=True，验'开着就推'")
print("=" * 72)
set_wecom(True)
cfg1 = NS["_forecast_reminder_cfg"]()
print("   改后 channels =", cfg1.get("channels"))
PUSHED.clear()
PID_B = 90002
NS["_notify_period_opened"](PID_B, "2026-10-05", "2026-10-06",
                            close_time="21:00", arrival="2026-10-08", open_time="16:00")
ok("P8 wecom=True ⇒ 外发 1 次（收集器，未真发）", len(PUSHED) == 1, "pushed=%d" % len(PUSHED))
ok("P9 外发内容与落库一致", PUSHED and PUSHED[0][2] == (latest_row(PID_B) or {}).get("content"))

print()
print("=" * 72)
print("[4] 场景 C：两通道全关 ⇒ 零落库零外发，且不抛")
print("=" * 72)
c = sqlite3.connect(os.path.join(SHADOW, "tenant_1.db"))
row = c.execute("SELECT payload FROM forecast_config WHERE kind='reminder'").fetchone()
cfg2 = json.loads(row[0]) if row else {}
cfg2["channels"] = {"inapp": False, "wecom": False}
c.execute("UPDATE forecast_config SET payload=? WHERE kind='reminder'",
          (json.dumps(cfg2, ensure_ascii=False),))
c.commit()
c.close()
PUSHED.clear()
PID_C = 90003
try:
    NS["_notify_period_opened"](PID_C, "2026-10-05", "2026-10-06", close_time="21:00",
                                arrival="2026-10-08", open_time="16:00")
    ok("P10 两通道全关 ⇒ 零落库", count_rows(PID_C) == 0)
    ok("P11 两通道全关 ⇒ 零外发", len(PUSHED) == 0)
    ok("P12 两通道全关 ⇒ 不抛异常", True)
except Exception as e:
    ok("P10/P11/P12 两通道全关不应抛", False, str(e))

print()
print("=" * 72)
print("汇总：PASS=%d  FAIL=%d" % (len(P), len(F)))
for x in F:
    print("  FAIL -", x)
print("=" * 72)
print("影子库目录（用完即删）：", SHADOW)
