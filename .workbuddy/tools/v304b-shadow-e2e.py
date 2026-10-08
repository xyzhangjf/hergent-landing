#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v304b 影子库端到端验收：`_notify_period_opened` 真能落站内信、且一期只落一条。

为什么必须做：这是**今天 16:00 就要在生产真跑**的新代码。只做静态自检不够 ——
本项目反复栽在「函数写了、接线看着对、运行时其实没生效」。

做法（沿用本项目既有的影子库范式）：
  · 由启动脚本先把 `erp.db` / `tenant_1.db` 拷进影子目录，并设 `ERP_DB_PATH` 指向影子
    （`DB_DIR = dirname(DB_PATH)` ⇒ **一个环境变量两处同源**，tenant_1.db 自动落在影子目录）
  · 本脚本**先断言 DB_PATH 真的在影子目录**（否则立即中止，绝不冒险碰生产）
  · 把 `_push_tenant_channels` 换成桩 ⇒ 不发真消息（通道能力已由 v304b-send-test 单独验过）
  · 调真实函数 → 读影子库 `message_center` 断言 → 再调一次验 `event_key` 去重

⚠️ 只读生产库、只写影子库；结束时打印生产库 mtime 供人工二次确认未被触碰。
"""
import os
import sqlite3
import sys

SHADOW = os.environ.get("V304B_SHADOW", "")
if not SHADOW:
    print("FATAL: 未设置 V304B_SHADOW")
    sys.exit(2)

os.environ["ERP_DB_PATH"] = os.path.join(SHADOW, "erp.db")
sys.path.insert(0, "/opt/hergent-erp")
os.chdir("/opt/hergent-erp")

PASS = 0
FAIL = 0


def check(cond, name, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  [OK] %s%s" % (name, ("  -> " + str(extra)) if extra else ""))
    else:
        FAIL += 1
        print("  [XX] %s%s" % (name, ("  -> " + str(extra)) if extra else ""))


# ── 0. 安全闸：必须先证明确实跑在影子库上
from db.connection import DB_PATH, DB_DIR, set_tenant_context   # noqa: E402
print("DB_PATH =", DB_PATH)
print("DB_DIR  =", DB_DIR)
check(DB_PATH.startswith(SHADOW), "DB_PATH 在影子目录（安全闸）")
if not DB_PATH.startswith(SHADOW):
    print("FATAL: 不在影子库，立即中止")
    sys.exit(3)
check(os.path.exists(os.path.join(SHADOW, "tenant_1.db")), "影子租户库 tenant_1.db 存在")

import scheduler as S   # noqa: E402

# ── 1. 桩掉渠道推送（通道能力已单独验过；这里只验站内信写入与去重）
pushed_calls = []


def _stub_push(tid, title, content):
    pushed_calls.append((tid, title))
    return 1


S._push_tenant_channels = _stub_push

# ── 2. 调真实函数
set_tenant_context(1)

TENANT_DB = os.path.join(SHADOW, "tenant_1.db")


def count_open_rows():
    c = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
    try:
        return c.execute(
            "SELECT COUNT(*) FROM message_center "
            "WHERE event_key LIKE 'forecast_period_open_%'").fetchone()[0]
    finally:
        c.close()


PID = 987654321          # 明显不存在的假期次号，避免与真期次 event_key 撞
before = count_open_rows()
print("\n调用前 forecast_period_open_* 行数 =", before)

S._notify_period_opened(PID, "2026-09-28", "2026-09-29",
                        close_time="11:00", arrival="2026-10-03")

after1 = count_open_rows()
check(after1 == before + 1, "调用一次 ⇒ 站内信 +1", "%d -> %d" % (before, after1))

c = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
row = c.execute("SELECT title, content, msg_type, sender, event_key, dup_count "
                "FROM message_center WHERE event_key=?",
                ("forecast_period_open_%d" % PID,)).fetchone()
c.close()
check(row is not None, "站内信带**按期次稳定**的 event_key（可去重、可追溯）")
if row:
    title, content, mtype, sender, ek, dup = row
    check(title == "本期报单已开放", "标题正确", title)
    check("2026-09-28 ~ 2026-09-29" in content, "正文含报单窗口", content.replace("\n", " | ")[:80])
    check("2026-09-29 11:00" in content, "正文含**关单时刻**（close_time 真的传进来了）")
    check("2026-10-03" in content, "正文含到货日")
    check(mtype == "notice" and sender == "系统", "类型/来源正确", "%s/%s" % (mtype, sender))

# ── 3. 重复触发收敛：v166 口径 = 同 (title,msg_type,recipients) 窗口内**不新增行**、只累加 dup_count
S._notify_period_opened(PID, "2026-09-28", "2026-09-29",
                        close_time="11:00", arrival="2026-10-03")
after2 = count_open_rows()
check(after2 == after1, "再调一次**不新增行**（告警收敛 ⇒ 不会刷屏）",
      "%d -> %d" % (after1, after2))
c = sqlite3.connect("file:%s?mode=ro" % TENANT_DB, uri=True)
dup2 = c.execute("SELECT dup_count FROM message_center WHERE event_key=?",
                 ("forecast_period_open_%d" % PID,)).fetchone()[0]
c.close()
# 🔴 口径（读 message_send 源码确认，不是猜）：dup_count 记的是「**被重复触发几次**」——
#    插入时置 0，命中去重 UPDATE 一次变 1。所以调用 2 次 ⇒ dup_count == 1。
check(int(dup2 or 0) == 1, "重复触发次数记进 dup_count（可观测触发了几次）", "dup_count=%s" % dup2)

# ── 4. 渠道确实被调用（桩记到了）；
check(len(pushed_calls) == 2 and pushed_calls[0][1] == "本期报单已开放",
      "租户渠道推送**被调用**且标题一致", pushed_calls)

set_tenant_context(None)

# ── 5. 生产库未被触碰（mtime 与影子分离）
print("\n生产库 mtime（应与影子无关、本次未变）：")
for f in ("erp.db", "tenant_1.db"):
    p = "/opt/hergent-erp/" + f
    import datetime
    print("   %-14s %s" % (f, datetime.datetime.fromtimestamp(os.path.getmtime(p))))

print()
print("PASS=%d  FAIL=%d" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
