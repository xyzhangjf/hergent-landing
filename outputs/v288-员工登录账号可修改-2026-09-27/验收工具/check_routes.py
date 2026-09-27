# -*- coding: utf-8 -*-
"""v286：直读**运行时**路由表，确认新端点真的注册了。

为什么不能用 HTTP 返回码当判据（本轮实测踩到）：
  未登录打 `/api/users/4/username`、`/api/users/4/role`、**以及一个根本不存在的路由**
  三者全部返回 401 —— 因为存在 ``/api/{full_path:path}`` 兜底路由 + 认证中间件在路由
  匹配之前拦截。⇒ 「401 ≠ 端点存在」，拿它当判据是假 PASS。
  唯一可靠判据 = 直接读 `server.app.routes`（import 即注册，装饰器在 import 期执行）。
"""
import os
import sys
sys.path.insert(0, "/opt/hergent-erp")

# 🔴 必须先把 .env 灌进环境：`core.py` 顶部 `if not ERP_SECRET: raise RuntimeError`
#    （服务由 systemd `EnvironmentFile=` 提供，裸跑 python3 不会自动读）
with open("/opt/hergent-erp/.env", encoding="utf-8") as _f:
    for _line in _f:
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

import server  # noqa: E402

rows = []
for r in server.app.routes:
    p = getattr(r, "path", None)
    if not p:
        continue
    m = sorted(getattr(r, "methods", []) or [])
    rows.append((p, m))

print("运行中 app 的路由总数 = %d" % len(rows))
print()

print("=== 本轮新增的端点 ===")
hit = 0
for p, m in rows:
    if "username" in p:
        print("  ✅ %-42s %s" % (p, m))
        hit += 1
print("  命中 %d 条（期望 ≥1）" % hit)
print()

print("=== 同族端点对照（应四条同在前缀下）===")
for p, m in sorted(rows):
    if p.startswith("/api/users/") and p.count("/") == 4:
        print("  %-42s %s" % (p, m))
