#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v347 迁移脚本的本地自测：证明它「改对了」且「没多改」。

判据（每条都要自证判别力）：
  ① 两种存量格式都处理（list / dict）；
  ② 幂等：跑两次，第二次 0 处变化；
  ③ **不误伤**：库管 / sales / guide 一个字节都不许变
     —— 库管持 `data` 却**不该**拿到 `forecast`，这正是本轮修复的目标；
  ④ 主库 erp.db 也在扫描范围内。

用临时库跑（绝不碰生产）。
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

ERP = os.environ.get("ERP_REPO", "/Users/zhangjunfeng/Documents/hergent-erp")
MIG = os.path.join(ERP, "tools", "v347-forecast-split-migrate.py")

TMP = tempfile.mkdtemp(prefix="v347-selftest-")
print("临时目录: %s\n" % TMP)

SEED = {
    "erp.db": [
        # 主库：supervisor（list，实测生产就这一行）
        ("supervisor", json.dumps(["dashboard", "data", "sales", "stock", "cron", "bid",
                                   "messages", "forecast-audit"], ensure_ascii=False)),
    ],
    "tenant_test.db": [
        ("库管", json.dumps(["dashboard", "stock", "data", "messages"], ensure_ascii=False)),
        # supervisor 用 **dict** 格式（生产 tenant_1 就是这种）
        ("supervisor", json.dumps({"dashboard": ["read"], "sales": ["read"], "stock": ["read"],
                                   "cron": ["read", "create", "update", "delete"],
                                   "bid": ["read", "create", "update", "delete"],
                                   "messages": ["read"],
                                   "forecast-audit": ["read"]}, ensure_ascii=False)),
        ("boss", json.dumps(["dashboard", "data", "cron", "bid"], ensure_ascii=False)),
        ("accountant", json.dumps(["dashboard", "data", "reports"], ensure_ascii=False)),
        ("sales", json.dumps(["dashboard", "sales", "data", "messages"], ensure_ascii=False)),
        ("guide", json.dumps(["dashboard", "data", "sales"], ensure_ascii=False)),
    ],
}

for fn, rows in SEED.items():
    con = sqlite3.connect(os.path.join(TMP, fn))
    con.execute("CREATE TABLE role_permissions (id INTEGER PRIMARY KEY, role_name TEXT, "
                "permissions TEXT, created_at TEXT)")
    for i, (role, perms) in enumerate(rows, 1):
        con.execute("INSERT INTO role_permissions VALUES (?,?,?,?)", (i, role, perms, "2026-01-01"))
    con.commit()
    con.close()
print("已建临时库: %s\n" % ", ".join(SEED))


def snapshot():
    out = {}
    for fn in SEED:
        con = sqlite3.connect(os.path.join(TMP, fn))
        for rid, role, perms in con.execute("SELECT id, role_name, permissions FROM role_permissions"):
            out[(fn, rid, role)] = perms
        con.close()
    return out


BEFORE = snapshot()

env = dict(os.environ, ERP_DB_DIR=TMP)
print("=" * 78)
print("第一次跑（--apply）")
print("=" * 78)
r1 = subprocess.run([sys.executable, MIG, "--apply"], env=env, capture_output=True, text=True)
print(r1.stdout)
if r1.returncode != 0:
    print("STDERR:", r1.stderr)
    sys.exit(1)
AFTER1 = snapshot()

print("=" * 78)
print("第二次跑（幂等验证）")
print("=" * 78)
r2 = subprocess.run([sys.executable, MIG, "--apply"], env=env, capture_output=True, text=True)
print(r2.stdout)

FAILS = []


def chk(name, cond, detail=""):
    print("  %s  %s%s" % ("PASS" if cond else "FAIL", name, ("   " + detail) if detail else ""))
    if not cond:
        FAILS.append(name)


def mods(key):
    return json.loads(AFTER1[key])


print("=" * 78)
print("结果判定")
print("=" * 78)

# ① 主管：删 cron、加 forecast、保留 bid
k = ("tenant_test.db", 2, "supervisor")
v = mods(k)
chk("主管（dict 格式）**删掉** `cron`", "cron" not in v, str(sorted(v.keys())))
chk("主管 **加上** `forecast`（4 动作）", v.get("forecast") == ["read", "create", "update", "delete"])
chk("主管 **保留** `bid`（老板要他看招投标雷达）", "bid" in v)
chk("主管 其它键逐项不变（只动该动的）",
    {x: y for x, y in v.items() if x not in ("cron", "forecast")} ==
    {"dashboard": ["read"], "sales": ["read"], "stock": ["read"],
     "bid": ["read", "create", "update", "delete"], "messages": ["read"],
     "forecast-audit": ["read"]})

# ② 主库 supervisor（list 格式）
v2 = mods(("erp.db", 1, "supervisor"))
chk("主库 supervisor（list 格式）删 cron", "cron" not in v2, str(v2))
chk("主库 supervisor 加 forecast", "forecast" in v2)

# ③ boss：加 forecast，**保留 cron**（老板自己的定时任务不动）
v3 = mods(("tenant_test.db", 3, "boss"))
chk("boss 加 `forecast`", "forecast" in v3, str(v3))
chk("boss **仍持** `cron`（只管主管，不碰老板）", "cron" in v3)

# ④ accountant：加 forecast
v4 = mods(("tenant_test.db", 4, "accountant"))
chk("会计 加 `forecast`", "forecast" in v4, str(v4))

# ⑤ 🔴 不误伤：库管 / sales / guide 逐字节不变
for key in (("tenant_test.db", 1, "库管"), ("tenant_test.db", 5, "sales"),
            ("tenant_test.db", 6, "guide")):
    role = key[2]
    chk("🔴 %s 的权限**逐字节未变**（不许误伤）" % role,
        AFTER1[key] == BEFORE[key], AFTER1[key])
    chk("🔴 %s **没有**被塞进 `forecast`" % role,
        "forecast" not in json.loads(AFTER1[key]))

# ⑥ 幂等
AFTER2 = snapshot()
chk("幂等：第二次跑后全库快照与第一次**逐字节相同**", AFTER1 == AFTER2)
chk("幂等：第二次跑输出「无需改动」", "无需改动" in r2.stdout,
    " | ".join(r2.stdout.strip().split("\n")[-2:]))

shutil.rmtree(TMP, ignore_errors=True)
print()
print("总判定: %s（%d 项失败）" % ("✅ 全绿" if not FAILS else "❌ 有失败项", len(FAILS)))
for f in FAILS:
    print("   - " + f)
sys.exit(1 if FAILS else 0)
