#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v225 企微推送日志修复 —— 沙箱对照验证（2026-09-21）

验证目标（4 条判据 + 1 条反证）：
  A. 表被创建        —— 新版跑一次状态查询后，主库出现 notify_logs
  B. 计数可读        —— _get_push_count_today() 由恒 0 变为真实条数
  C. 最近推送可读    —— _get_last_push() 由恒 None 变为真实记录
  D. 历史可读        —— get_push_history() 由恒 [] 变为真实列表
  E. 【反证】只补 import 而不加 tenant_scope(None) —— 在租户上下文下会把表
     建到 tenant_N.db，主库依然没有表 ⇒ 证明本修复不能简化成"补一行 import"

隔离手法：`ERP_DB_PATH` 必须在 `import db.connection` **之前**设好
（DB_PATH 是模块级求值），这样整个进程只会碰沙箱库，不碰生产。
"""
import importlib.util
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

REPO = "/Users/zhangjunfeng/Documents/hergent-erp"
SERVER = os.path.join(REPO, "server")
SANDBOX = tempfile.mkdtemp(prefix="v225-sandbox-")
MAIN_DB = os.path.join(SANDBOX, "sandbox.db")
TENANT_DB = os.path.join(SANDBOX, "tenant_9.db")

# ---- 关键：先定 DB_PATH，再 import ----
os.environ["ERP_DB_PATH"] = MAIN_DB
sys.path.insert(0, SERVER)
os.chdir(SERVER)

FAILS = []


def check(name, got, want):
    ok = got == want
    print("  [%s] %-34s got=%r" % ("PASS" if ok else "FAIL", name, got))
    if not ok:
        FAILS.append("%s: got=%r want=%r" % (name, got, want))
    return ok


def table_exists(db_path, table="notify_logs"):
    if not os.path.exists(db_path):
        return False
    con = sqlite3.connect("file:%s?mode=ro" % db_path, uri=True)
    try:
        rows = [r[0] for r in con.execute("SELECT name FROM sqlite_master")]
        return table in rows
    finally:
        con.close()


def fetch_old_module():
    """取 HEAD 版 wecom_notify.py（= 修复前的实现）到沙箱。"""
    out = subprocess.run(
        ["git", "show", "HEAD:server/notify/wecom_notify.py"],
        cwd=REPO, capture_output=True, text=True, check=True).stdout
    path = os.path.join(SANDBOX, "old_wecom_notify.py")
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    spec = importlib.util.spec_from_file_location("old_wecom_notify", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["old_wecom_notify"] = mod
    spec.loader.exec_module(mod)
    return mod


print("=" * 72)
print("沙箱:", SANDBOX)
print("=" * 72)

import db.connection as conn_mod          # noqa: E402
import notify.wecom_notify as new         # noqa: E402

print("\n[0] 环境自检")
check("DB_PATH 指向沙箱", os.path.abspath(conn_mod.DB_PATH), os.path.abspath(MAIN_DB))
check("沙箱主库初始不存在", os.path.exists(MAIN_DB), False)

# ---------------------------------------------------------------- 旧版
print("\n[1] 旧版（HEAD）—— 复现静默失效")
old = fetch_old_module()
check("旧版 get_db 未导入", "get_db" in dir(old), False)
check("旧版调用前无表", table_exists(MAIN_DB), False)
old._log_push("旧版试探消息", True, 1, None)      # 期望：静默失败
check("旧版 _log_push 后仍无表", table_exists(MAIN_DB), False)
check("旧版 今日计数", old._get_push_count_today(), 0)
check("旧版 最近推送", old._get_last_push(), None)
check("旧版 推送历史", old.get_push_history(), [])
print("  ⇒ 旧版四项读数全部为 0/None/[]，与「表存在但确实没推过」无法区分")

# ---------------------------------------------------------------- 反证
print("\n[2] 【反证】只补 import、不加 tenant_scope(None) 会怎样")
tok = conn_mod._tenant_db.set(TENANT_DB)          # 模拟请求落在租户 9 上下文
try:
    with conn_mod.get_db_tx() as c:               # 注意：没有 tenant_scope(None)
        c.execute(new._NOTIFY_LOGS_DDL)
finally:
    conn_mod._tenant_db.reset(tok)
check("主库未建表（错库了）", table_exists(MAIN_DB), False)
check("租户库却被建了表", table_exists(TENANT_DB), True)
print("  ⇒ 证明：仅补 import 不够 —— 必须显式 tenant_scope(None) 才能落到主库")

# ---------------------------------------------------------------- 新版
print("\n[3] 新版 —— 四项判据")
st = new.get_push_status()
check("A 状态查询后主库建出表", table_exists(MAIN_DB), True)
check("A' configured(webhook 未配)", st["configured"], False)
check("A'' 今日计数初始 0", st["push_count_today"], 0)
check("A''' 最近推送初始 None", st["last_push"], None)

new._log_push("新版消息", True, 1, None)
check("B 今日计数变 1", new._get_push_count_today(), 1)

last = new._get_last_push()
check("C 最近推送标题", (last or {}).get("title"), "新版消息")
check("C' 最近推送成功标记", (last or {}).get("success"), True)
check("C'' 最近推送有时间", bool((last or {}).get("created_at")), True)

hist = new.get_push_history()
check("D 历史条数", len(hist), 1)
check("D' 历史首条标题", (hist[0] if hist else {}).get("title"), "新版消息")

new._log_push("第二条（失败）", False, 3, "timeout")
check("D'' 追加后计数 2", new._get_push_count_today(), 2)
check("D''' 追加后历史 2 条", len(new.get_push_history()), 2)

# ------------------------------------------------- 租户上下文下仍写主库
print("\n[4] 新版在租户上下文下依然写主库（tenant_scope 生效）")
tok = conn_mod._tenant_db.set(TENANT_DB)
try:
    before = new._get_push_count_today()
    new._log_push("租户上下文下的消息", True, 1, None)
    after = new._get_push_count_today()
finally:
    conn_mod._tenant_db.reset(tok)
check("租户上下文下写入主库", after, before + 1)

# ---------------------------------------------------------------- 时区
print("\n[5] 时区修正的机制演示（写入端=本地时间，查询端必须同为本地）")
con = sqlite3.connect("file:%s?mode=ro" % MAIN_DB, uri=True)
try:
    utc_d, local_d = con.execute("SELECT date('now'), date('now','localtime')").fetchone()
    print("     当前 UTC 日期=%s  本地日期=%s" % (utc_d, local_d))
    # 用固定时刻演示分叉窗口（北京时间 02:00 = UTC 前一天 18:00）
    a, b = con.execute(
        "SELECT date('2026-09-21 18:00:00'), date('2026-09-21 18:00:00','+8 hours')"
    ).fetchone()
    check("凌晨窗口两时基必然分叉", a != b, True)
    print("     机制：同一时刻 UTC 日期=%s / 本地日期=%s ⇒ 00:00-08:00 必错" % (a, b))
finally:
    con.close()

# ---------------------------------------------------------------- 汇总
print("\n" + "=" * 72)
if FAILS:
    print("结果：%d 项未通过" % len(FAILS))
    for f in FAILS:
        print("  - " + f)
else:
    print("结果：全部通过 —— 旧版 4 项静默失效已复现，新版 4 项判据全绿，反证成立")
print("=" * 72)

shutil.rmtree(SANDBOX, ignore_errors=True)
sys.exit(1 if FAILS else 0)
