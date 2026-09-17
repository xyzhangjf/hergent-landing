#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v184 真机验证 · 步 2：走真实 /api/import/execute 导入，然后回读产物。

mapping **直接取 preview 的 suggestions**（不手搓）—— 这样被测的就是
「用户上传→系统自动识别→执行」的真实链路，含识别器本身。
"""
import json
import os
import urllib.request

BASE = "https://hergent.cn"
TOKEN = "a21d9659fd4346c18cd56cf60a57f7eebfbc2bfe21f24b5db5cca07c60133fd4"
TENANT = "9999"
OUT = "/tmp/imp_cross_9999.xlsx"

prev = json.load(open("/tmp/preview_9999.json"))
mapping = {str(s["index"]): s["suggested_field"] for s in (prev.get("suggestions") or [])}
print("mapping（取自 preview suggestions）= ", json.dumps(mapping, ensure_ascii=False))
print("validation = ", json.dumps(prev.get("validation"), ensure_ascii=False))

H = {"Authorization": "Bearer " + TOKEN, "X-Tenant-Id": TENANT}
boundary = "----v184exec"
fields = {"category": "forecast_cross", "mapping": json.dumps(mapping), "check_dupes": "1"}
body = b""
for k, v in fields.items():
    body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (boundary, k, v)).encode()
with open(OUT, "rb") as f:
    raw = f.read()
body += ("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
         "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"
         % (boundary, os.path.basename(OUT))).encode()
body += raw + b"\r\n"
body += ("--%s--\r\n" % boundary).encode()

req = urllib.request.Request(BASE + "/api/import/execute", data=body,
                             headers={**H, "Content-Type": "multipart/form-data; boundary=" + boundary})
with urllib.request.urlopen(req, timeout=180) as resp:
    st, txt = resp.status, resp.read().decode("utf-8", "replace")
print("\n=== execute HTTP", st, "===")
with open("/tmp/execute_9999.json", "w") as f:
    f.write(txt)
d = json.loads(txt)
print("success =", d.get("success"), "| 键:", list(d.keys()))
for k in ("success", "skipped", "dupes", "message", "detail", "period_id", "period_name"):
    if k in d:
        print("   %s = %s" % (k, json.dumps(d[k], ensure_ascii=False)[:300]))
for k in ("errors", "warnings", "notes"):
    if d.get(k):
        print("   %s (%d): %s" % (k, len(d[k]), json.dumps(d[k], ensure_ascii=False)[:600]))
