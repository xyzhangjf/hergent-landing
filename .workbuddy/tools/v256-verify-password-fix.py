"""只读验证：生产 core.py 的密码预哈希修复是否真的生效（不写库、不改任何数据）。"""
import os
import sys
import sqlite3
from collections import Counter

# 1) 加载 .env（core.py 顶层需要 ERP_SECRET）
env_path = "/opt/hergent-erp/.env"
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

sys.path.insert(0, "/opt/hergent-erp")
import core  # noqa: E402

print("ERP_SECRET loaded:", bool(os.environ.get("ERP_SECRET")))
print("")

# 2) 长密码能否哈希 + 验证（纯内存，不落库）
print("=== A. 长密码哈希/验证（关键：>8 位是否还抛 ValueError） ===")
tests = ["Abc12345", "Abc12345678", "MyPass2026Long!", "Xy9#kLmQ2026", "Abc1234567890123456"]
for pw in tests:
    try:
        h = core._hpw(pw)
        ok = core._verify_password(pw, h)
        print("  len=" + str(len(pw)).rjust(2) + " -> is_bcrypt2=" + str(h.startswith("bcrypt2$")) + " verify=" + str(ok))
    except Exception as e:
        print("  len=" + str(len(pw)).rjust(2) + " -> EXCEPTION " + type(e).__name__ + ": " + str(e))

print("")
print("=== B. 旧格式兼容（存量用户不能被锁在外面） ===")
old_sha = core._hpw_old("Legacy123")
print("  legacy SHA-256 verify:", core._verify_password("Legacy123", old_sha))
print("  needs_rehash(legacy) :", core._needs_rehash(old_sha))
print("  needs_rehash(bcrypt2):", core._needs_rehash(core._hpw("Abc12345")))

# bcrypt$(旧 8 字节限制格式) —— 若库里还有，验证长密码时应 False 而非抛错
try:
    legacy_b = "bcrypt$" + core.__dict__.get("_x", "")  # 占位，真实值来自库统计
except Exception:
    pass

print("")
print("=== C. 生产 users 哈希格式分布（只读） ===")
try:
    con = sqlite3.connect("file:/opt/hergent-erp/erp.db?mode=ro", uri=True)
    rows = con.execute("SELECT password_hash FROM users").fetchall()
    c = Counter()
    for (h,) in rows:
        if h is None:
            c["NULL"] += 1
        elif h.startswith("bcrypt2$"):
            c["bcrypt2$(新)"] += 1
        elif h.startswith("bcrypt$"):
            c["bcrypt$(旧)"] += 1
        else:
            c["sha256-legacy(旧)"] += 1
    print("  formats:", dict(c), "total=", len(rows))
    con.close()
except Exception as e:
    print("  db stat error:", type(e).__name__, e)

print("")
print("=== D. 密码策略（_validate_password，最小长度） ===")
for pw in ["Abc1234", "Abc12345", "Abc12345678"]:
    print("  len=" + str(len(pw)).rjust(2) + " ->", core._validate_password(pw))
