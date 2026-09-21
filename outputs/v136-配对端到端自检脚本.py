"""配对审批链路端到端自检（必须以 hergent 身份运行，保证文件属主与网关一致）。

验证点：
  1. 真配对码生成 → Hergent pairing_list 能读到（目录对齐）
  2. 错码审批 → 必须返回 ok=False（CLI 恒 exit 0，不能看 rc）
  3. 真码审批 → ok=True 且进 approved
  4. revoke → 从 approved 移除
  5. 清理：删自检键 + 复位 _failures 计数（避免把真实渠道顶到锁定）
"""
import json
import os
import sys

HOME = "/opt/hermes-tenants/hergent_t1"
os.environ["HERMES_HOME"] = HOME
sys.path.insert(0, "/usr/local/lib/hermes-agent/venv/lib/python3.11/site-packages")

from gateway.pairing import PAIRING_DIR, PairingStore   # noqa: E402

print("PAIRING_DIR:", PAIRING_DIR)

st = PairingStore()
code = st.generate_code("wecom", "__p_pairtest__", "__p_pairtest__")
print("GENERATED_CODE:", code, "| len:", len(code or ""))

sys.path.insert(0, "/opt/hergent-erp")
import hermes_tenants as ht   # noqa: E402

before = ht.pairing_list(1)
print("LIST_BEFORE:", json.dumps(before["pending"], ensure_ascii=False))

wrong = ht.pairing_approve(1, "wecom", "ZZZZZZZZ")
print("APPROVE_WRONG:", json.dumps(wrong, ensure_ascii=False), "=> EXPECT ok=False")
assert wrong.get("ok") is False, "错码竟然通过了！"

assert not any(u["user_id"] == "__p_pairtest__" for u in ht.pairing_list(1)["approved"]), \
    "错码把用户放进了 approved！"

real = ht.pairing_approve(1, "wecom", code)
print("APPROVE_REAL:", json.dumps(real, ensure_ascii=False), "=> EXPECT ok=True")
assert real.get("ok") is True, "真码没通过！"

after = ht.pairing_list(1)
print("APPROVED_LIST:", json.dumps(after["approved"], ensure_ascii=False))
print("LOCKED:", json.dumps(after["locked"], ensure_ascii=False))

rev = ht.pairing_revoke(1, "wecom", "__p_pairtest__")
print("REVOKE:", json.dumps(rev, ensure_ascii=False), "=> EXPECT ok=True")
assert rev.get("ok") is True, "撤销失败！"
print("FINAL_APPROVED:", json.dumps(ht.pairing_list(1)["approved"], ensure_ascii=False))

# ---- 清理 ----
p = PAIRING_DIR / "_rate_limits.json"
d = json.loads(p.read_text(encoding="utf-8"))
for k in list(d):
    if "__p_pairtest__" in k or k.startswith("_failures:") or k.startswith("_lockout:"):
        del d[k]
p.write_text(json.dumps(d, indent=2), encoding="utf-8")
os.chmod(p, 0o600)
print("CLEANED_RATE_LIMITS ->", d)
print("E2E_ALL_PASS")
