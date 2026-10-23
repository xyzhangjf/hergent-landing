#!/usr/bin/env python3
"""2026-10-21 重建：Hergent 异地 OSS 备份。

背景：原 scripts/sync_to_oss.sh 已丢失，且 backup.py::_run_offsite_backup 依赖
erp_db.backup_config_get()（该函数在 erp_db 中不存在）⇒ 异地备份自 2026-10-17 起
静默中断，仅本地备份（scheduler 内置 02:00）仍正常。

本脚本不依赖 erp_db，直接读 .env 的 OSS_* 配置 + ossutil 上传，
与历史远程路径一致：oss://<bucket>/backups/<YYYY-MM-DD>/

用法：
  SYNC_DATE=2026-10-21 python3 offsite_oss_sync.py     # 指定日期
  python3 offsite_oss_sync.py                          # 默认今天
退出码：0=成功 1=失败（供 cron 与告警判据）
"""
import os
import glob
import subprocess
import sys
from datetime import datetime

ENV_FILE = "/opt/hergent-erp/.env"
BACKUP_ROOT = "/opt/hergent-erp/backups"
LOG_FILE = "/var/log/hergent-oss-sync.log"
OSSUTIL = "/usr/local/bin/ossutil"
REQUIRED = ("OSS_BUCKET", "OSS_ENDPOINT", "OSS_KEY", "OSS_SECRET")


def load_env(path):
    cfg = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


def log(msg):
    """stdout 为权威记录（cron 由 root 外层重定向，见 v269）；文件写入为 best-effort。"""
    line = "[%s] %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass  # 属主非 hergent 时静默，依赖外层重定向落盘


def sync_one(cfg, date):
    local = os.path.join(BACKUP_ROOT, date)
    if not os.path.isdir(local):
        log("OSS_SYNC_FAIL date=%s 本地备份目录不存在: %s" % (date, local))
        return 1
    files = sorted(glob.glob(os.path.join(local, "*.db")))
    if not files:
        log("OSS_SYNC_FAIL date=%s 目录内无 .db 文件: %s" % (date, local))
        return 1

    remote = "oss://%s/backups/%s" % (cfg["OSS_BUCKET"], date)
    log("syncing %s -> %s (%d files)" % (local, remote, len(files)))
    cmd = [
        OSSUTIL, "cp", "-r", local, remote, "-u", "-f",
        "-e", cfg["OSS_ENDPOINT"],
        "-i", cfg["OSS_KEY"],
        "-k", cfg["OSS_SECRET"],
    ]
    try:
        # cwd=/tmp：ossutil 启动时会在 cwd 建 ossutil_output/，
        # 以 hergent 身份在 /opt/hergent-erp 下建目录会 EACCES（与 v269 同类）。
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, cwd="/tmp")
    except subprocess.TimeoutExpired:
        log("OSS_SYNC_FAIL date=%s 上传超时(30min)" % date)
        return 1

    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode == 0 and "Succeed" in out:
        log("OSS sync OK date=%s (%d files)" % (date, len(files)))
        return 0
    log("OSS_SYNC_FAIL date=%s rc=%s out=%s err=%s"
        % (date, p.returncode, (p.stdout or "")[-200:], (p.stderr or "")[-200:]))
    return 1


def main():
    cfg = load_env(ENV_FILE)
    missing = [k for k in REQUIRED if not cfg.get(k)]
    if missing:
        log("OSS_SYNC_FAIL .env 缺少配置: %s" % missing)
        return 1
    if not os.path.isfile(OSSUTIL):
        log("OSS_SYNC_FAIL ossutil 不存在: %s" % OSSUTIL)
        return 1

    arg_date = os.environ.get("SYNC_DATE", "").strip()
    if arg_date:
        return sync_one(cfg, arg_date)
    # 默认：同步今天；若本地今日备份尚未生成（如提前跑），回退到昨天
    today = datetime.now().strftime("%Y-%m-%d")
    if os.path.isdir(os.path.join(BACKUP_ROOT, today)):
        return sync_one(cfg, today)
    log("OSS_SYNC_SKIP 今日本地备份尚未生成: %s" % today)
    return 1


if __name__ == "__main__":
    sys.exit(main())
