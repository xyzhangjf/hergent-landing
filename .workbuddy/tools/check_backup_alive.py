#!/usr/bin/env python3
"""2026-10-21 重建：备份存活巡检（原 scripts/check_backup_alive.py 已丢失）。

背景：异地备份自 2026-10-17 起静默中断 5 天，而健康检查脚本同样缺失 ⇒ 零告警。
本脚本把「本地备份 + 异地 OSS 副本」一起巡检，任一异常即推送告警。

巡检项：
  1. 今日本地备份目录存在、*.db 文件数达标（基线=昨日份数）、总大小 > 0
  2. 异地 OSS 今日对象数 == 本地文件数
告警通道：FEISHU_WEBHOOK_URL / WECOM_WEBHOOK_URL（.env 未配置则仅落日志，不静默）
退出码：0=全部正常 1=异常（供 cron 判据）
"""
import glob
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta

ERP = "/opt/hergent-erp"
BACKUP_ROOT = os.path.join(ERP, "backups")
ENV_FILE = os.path.join(ERP, ".env")
OSSUTIL = "/usr/local/bin/ossutil"


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


def local_stat(date):
    d = os.path.join(BACKUP_ROOT, date)
    if not os.path.isdir(d):
        return None
    files = sorted(glob.glob(os.path.join(d, "*.db")))
    size = sum(os.path.getsize(f) for f in files)
    return {"count": len(files), "size_mb": round(size / 1024 / 1024, 1)}


def oss_stat(cfg, date):
    if not os.path.isfile(OSSUTIL):
        return None
    remote = "oss://%s/backups/%s/" % (cfg["OSS_BUCKET"], date)
    cmd = [OSSUTIL, "ls", remote, "-e", cfg["OSS_ENDPOINT"],
           "-i", cfg["OSS_KEY"], "-k", cfg["OSS_SECRET"]]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120, cwd="/tmp")
    except subprocess.TimeoutExpired:
        return None
    if p.returncode != 0:
        return None
    n = sum(1 for ln in (p.stdout or "").splitlines() if "oss://" in ln and not ln.endswith("/"))
    return n


def notify(cfg, title, content):
    """推送告警。webhook 未配置时明确打印，绝不静默。"""
    sent = False
    for key, kind in (("FEISHU_WEBHOOK_URL", "feishu"), ("WECOM_WEBHOOK_URL", "wecom")):
        url = cfg.get(key, "")
        if not url:
            continue
        try:
            import urllib.request
            body = json.dumps({"msg_type": "text",
                               "content": {"text": "%s\n%s" % (title, content)}}).encode()
            req = urllib.request.Request(url, data=body,
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10).read()
            print("[Notify] %s 已发送: %s" % (kind, title))
            sent = True
        except Exception as e:
            print("[Notify] %s 发送失败: %s" % (kind, e))
    if not sent:
        print("[Notify] [X] 未配置 FEISHU_WEBHOOK_URL / WECOM_WEBHOOK_URL，"
              "本条告警未推送（仅落日志）: %s" % title)


def main():
    cfg = load_env(ENV_FILE)
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    cur = local_stat(today)
    base = local_stat(yesterday) or {"count": 7, "size_mb": 0}
    problems = []

    if cur is None:
        problems.append("今日本地备份缺失: %s/%s" % (BACKUP_ROOT, today))
    else:
        if cur["count"] < base["count"]:
            problems.append("本地备份文件数不足: %d < 基线%d" % (cur["count"], base["count"]))
        if cur["size_mb"] <= 0:
            problems.append("本地备份大小为 0")
        n_oss = oss_stat(cfg, today)
        if n_oss is None:
            problems.append("异地 OSS 副本缺失或不可读: backups/%s" % today)
        elif cur["count"] and n_oss < cur["count"]:
            problems.append("异地 OSS 对象数不足: %d < 本地%d" % (n_oss, cur["count"]))

    cur_txt = ("%d 个 / %sMB" % (cur["count"], cur["size_mb"])) if cur else "缺失"
    print("巡检 %s: 本地备份 %s，期望基线 %d 个；异地=%s"
          % (today, cur_txt, base["count"],
             oss_stat(cfg, today) if cur else "n/a"))

    if not problems:
        print("结果：全部正常 ✅")
        return 0
    print("结果：异常 ❌ " + "；".join(problems))
    notify(cfg, "[Hergent] 备份巡检告警 %s" % today, "\n".join("- " + p for p in problems))
    return 1


if __name__ == "__main__":
    sys.exit(main())
