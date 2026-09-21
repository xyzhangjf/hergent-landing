"""清理配对自检残留（必须以 hergent 身份运行）。"""
import json
import os
import sys

HOME = "/opt/hermes-tenants/hergent_t1"
os.environ["HERMES_HOME"] = HOME
sys.path.insert(0, "/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages")
from gateway.pairing import PAIRING_DIR, PairingStore   # noqa: E402

st = PairingStore()

# 1) 待审：只清自检用户；若全是自检则整体清空
pend = st.list_pending("wecom")
print("PENDING_BEFORE:", json.dumps(pend, ensure_ascii=False))
p = PAIRING_DIR / "wecom-pending.json"
d = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
removed = [k for k, v in d.items() if str((v or {}).get("user_id", "")).startswith("__")]
for k in removed:
    del d[k]
p.write_text(json.dumps(d, indent=2), encoding="utf-8")
os.chmod(p, 0o600)
print("PENDING_REMOVED:", removed, "| LEFT:", json.dumps(d, ensure_ascii=False))

# 2) 已授权：清掉自检用户
apr = PAIRING_DIR / "wecom-approved.json"
a = json.loads(apr.read_text(encoding="utf-8")) if apr.is_file() else {}
gone = [k for k in list(a) if k.startswith("__")]
for k in gone:
    del a[k]
apr.write_text(json.dumps(a, indent=2), encoding="utf-8")
os.chmod(apr, 0o600)
print("APPROVED_REMOVED:", gone, "| LEFT:", json.dumps(a, ensure_ascii=False))

# 3) 计数：复位失败/锁定/自检限流键（把渠道从"即将被锁"拉回）
rl = PAIRING_DIR / "_rate_limits.json"
r = json.loads(rl.read_text(encoding="utf-8")) if rl.is_file() else {}
for k in list(r):
    if "__" in k or k.startswith("_failures:") or k.startswith("_lockout:"):
        del r[k]
rl.write_text(json.dumps(r, indent=2), encoding="utf-8")
os.chmod(rl, 0o600)
print("RATE_LIMITS ->", r)

print("FINAL_LIST:", json.dumps(st.list_pending("wecom"), ensure_ascii=False),
      json.dumps(st.list_approved("wecom"), ensure_ascii=False))
print("CLEANUP_DONE")
