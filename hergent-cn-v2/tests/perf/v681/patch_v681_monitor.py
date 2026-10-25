#!/usr/bin/env python3
# v681: 给 /api/monitor 补 _PATH_MODULE_MAP 登记（原缺失 => fail-closed 403 MODULE_NOT_CONFIGURED）
import re, shutil, py_compile, sys, time

P = "/opt/hergent-erp/server.py"
MARK = '"/api/monitor": "hr"'

src = open(P, encoding="utf-8").read()

if MARK in src:
    print("SKIP already-patched")
    sys.exit(0)

anchor = '    "/api/messages": "messages",\n'
n = src.count(anchor)
if n != 1:
    print("ABORT anchor-count=%d" % n)
    sys.exit(2)

block = (
    '    # v681（2026-10-25）：`/api/monitor` —— P1-4 监控端点（GET /api/monitor/health、\n'
    '    #   POST /api/monitor/test-alert）。\n'
    '    #   🔴 这是「接口上线即死」的实证：`/api/monitor` 长期只登记在 `_TENANT_MASTER_PREFIXES`\n'
    '    #      （租户上下文）里，从未进本表 ⇒ fail-closed 判成未配置 ⇒ 带合法 boss 令牌实测\n'
    '    #      恒为 403 MODULE_NOT_CONFIGURED，健康检查与测试告警全不可用；而同批登记的\n'
    '    #      AlertRules 页面是好的 ⇒ **「页面能开」不能证明「接口能调」**。\n'
    '    #   归 `hr`（owner-only，仅 boss 持有），与 `/api/config`、`/api/force-logout` 同档；\n'
    '    #   端点自身另有 `_admin` 守卫，这里是第二层（模块门禁）。\n'
    '    #   ✅ 顺序已静态核验：本表无其它以 `/api/mo` 开头的键，也不存在 `/api/monitor-*`\n'
    '    #      兄弟路由 ⇒ 既不吞别人、也不被别人吞（首个 startswith 命中即停）。\n'
    '    "/api/monitor": "hr",\n'
)

bak = P + ".bak-20261025-v681-monitor"
shutil.copy2(P, bak)

out = src.replace(anchor, block + anchor, 1)
open(P, "w", encoding="utf-8").write(out)

# 复核
new = open(P, encoding="utf-8").read()
assert new.count(MARK) == 1, "mark-count"
assert len(new) == len(src) + len(block), "len-delta"

i = new.index("_PATH_MODULE_MAP = {")
j = new.index("\n}", i)
entries = len(re.findall(r'"/api/[^"]+"\s*:', new[i:j]))

py_compile.compile(P, doraise=True)
print("OK patched bak=%s entries=%d py_compile=PASS" % (bak, entries))
