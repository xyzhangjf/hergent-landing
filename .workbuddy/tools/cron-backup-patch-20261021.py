#!/usr/bin/env python3
"""2026-10-21 修正 /etc/cron.d/hergent-backup 的死路径。

原 02:00 行调用 scripts/backup.py + scripts/sync_to_oss.sh —— 两者均已不存在，
自 2026-10-17 起每日静默失败（且把告警也拖死）。本地备份实际由后端 scheduler
内置任务产出；异地 OSS 改由 02:30 新脚本负责。本行仅保留「当日备份目录准备」。

幂等：含新标记则跳过。
"""
import sys

P = "/etc/cron.d/hergent-backup"
MARK = "2026-10-21 修正(v650)"

OLD = (
    "0 2 * * * root /bin/bash -c 'D=/opt/hergent-erp/backups/$(date --iso-8601=date); "
    "mkdir -p \"$D\" 2>>/var/log/hergent-backup.log; chown hergent:hergent \"$D\" "
    "2>>/var/log/hergent-backup.log; chmod 700 \"$D\" 2>>/var/log/hergent-backup.log; "
    "runuser -u hergent -- /usr/bin/python3 /opt/hergent-erp/scripts/backup.py "
    ">> /var/log/hergent-backup.log 2>&1 && runuser -u hergent -- "
    "/opt/hergent-erp/scripts/sync_to_oss.sh >> /var/log/hergent-oss-sync.log 2>&1'\n"
)

NEW = (
    "# \U0001f534 %s：原行调用 scripts/backup.py + sync_to_oss.sh —— 两脚本均已不存在，\n"
    "#    自 2026-10-17 起每日静默失败，并把健康检查一起拖死（零告警）。\n"
    "#    本地备份实际由后端 scheduler 内置任务(02:00)产出；\n"
    "#    异地 OSS 改由 02:30 的 scripts/offsite_oss_sync.py 负责。\n"
    "#    本行仅保留「当日备份目录准备」（scheduler 依赖该目录已存在且属主正确）。\n"
    "0 2 * * * root /bin/bash -c 'D=/opt/hergent-erp/backups/$(date --iso-8601=date); "
    "mkdir -p \"$D\" 2>>/var/log/hergent-backup.log; chown hergent:hergent \"$D\" "
    "2>>/var/log/hergent-backup.log; chmod 700 \"$D\" 2>>/var/log/hergent-backup.log'\n"
    "# 2026-10-21 新增：异地 OSS 同步（本地备份 02:00 完成后 30 分钟）\n"
    "30 2 * * * root runuser -u hergent -- /usr/bin/python3 "
    "/opt/hergent-erp/scripts/offsite_oss_sync.py >> /var/log/hergent-oss-sync.log 2>&1\n"
) % MARK

s = open(P).read()

if MARK in s:
    print("ALREADY_PATCHED")
    sys.exit(0)

n = s.count(OLD)
if n != 1:
    print("ANCHOR_NOT_UNIQUE: count=%d" % n)
    sys.exit(2)

open(P, "w").write(s.replace(OLD, NEW, 1))
print("PATCHED_OK")
