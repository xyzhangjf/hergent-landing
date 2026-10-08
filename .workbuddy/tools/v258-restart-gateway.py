"""重启 tenant_1 网关，让 v258 A2 的 HOME 隔离生效。必须以 hergent 身份运行。"""
import os
import sys

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
import hermes_tenants as ht  # noqa: E402

tid = 1
print("running as uid:", os.getuid())
print("available:", ht.available())
print("enabled_channels:", ht.enabled_channels(tid))
print("pid_before:", ht.gateway_pid(tid))

res = ht.gateway_restart(tid, wait=True)
print("restart_result:", res)

print("pid_after:", ht.gateway_pid(tid))
