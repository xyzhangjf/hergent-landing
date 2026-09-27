# -*- coding: utf-8 -*-
"""v289 只读探针：把「密码策略」的真实口径钉死。

零业务写入：只 import core 调纯函数，再静态读出各写入口的校验行。
"""
import os
import re
import sys

# 裸跑 python3 不读 systemd 的 EnvironmentFile ⇒ 手工灌 .env，
# 否则 core.py:12 抛 RuntimeError: ERP_SECRET environment variable is required
ENV = "/opt/hergent-erp/.env"
if os.path.exists(ENV):
    with open(ENV, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

sys.path.insert(0, "/opt/hergent-erp")
import core  # noqa: E402

print("=" * 68)
print("A. 权威函数 core._validate_password 的真实行为")
print("=" * 68)
samples = [
    ("abcd", "4 位纯字母"),
    ("1234", "4 位纯数字"),
    ("abcd1234", "8 位含字母数字"),
    ("abcdefgh", "8 位纯字母"),
    ("12345678", "8 位纯数字"),
    ("Ab1", "3 位含字母数字"),
    ("测试abc123", "含中文 8 位"),
]
for pw, desc in samples:
    ok, msg = core._validate_password(pw)
    verdict = "PASS" if ok else "REJECT"
    print("  %-6s  %-14s  %-16s  %s" % (verdict, desc, repr(pw), msg or "—"))

print()
print("=" * 68)
print("B. 各处写入口的门槛（静态读源，看是否都归一）")
print("=" * 68)
TARGETS = [
    ("server.py", "老板重置某员工密码 /api/users/{uid}/password"),
    ("routers/auth.py", "本人改密 / 注册 / 管理员重置"),
    ("routers/forecast_submissions.py", "开通员工账号 /api/staff-accounts"),
    ("routers/platform.py", "平台开通租户"),
    ("password_reset.py", "忘记密码一次性重置码"),
    ("erp_db.py", "建/改用户"),
]
for fn, desc in TARGETS:
    path = os.path.join("/opt/hergent-erp", fn)
    if not os.path.exists(path):
        print("  (缺) %s" % fn)
        continue
    hits = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        for i, line in enumerate(f, 1):
            if "_validate_password(" in line and "def " not in line:
                hits.append((i, "调用权威函数"))
            # 裸的长度判断（没走权威函数）
            if re.search(r"len\(\s*(new_)?password\s*\)\s*<\s*\d", line):
                hits.append((i, "裸长度判断 <- %s" % line.strip()[:60]))
    print("  %-38s %s" % (fn, desc))
    for i, what in hits:
        print("      :%-5d %s" % (i, what))
    if not hits:
        print("      （无密码长度校验）")
