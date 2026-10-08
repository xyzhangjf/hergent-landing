#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v325（2026-09-29）AI 权限的**离线权限矩阵验收件**（零写入）。

用法（服务器上）：
    cd /opt/hergent-erp && set -a && . ./.env && set +a && python3 <本文件>

原理：RBAC 中间件用的就是同一个 `core._check_perm` ⇒ **离线结论 == 真机结论**。
零写入：不造令牌、不写 sessions、不碰业务库。

🔴 探针自证记录（第一版写错过，留此以防复发）：
   「有没有租户覆盖行」**不能**用 `role in perms_for(tid)` 判 —— `perms_for` 返回的是
   「内置 ⊕ 覆盖」的**全量结果**，每个角色都在里面 ⇒ 那个判据**恒真**，
   会把"走内置默认"的角色统统标成"有覆盖行"。
   正口径 = `core.custom_roles(tid)`（按**内容 ≠ 内置默认**判，与 `pages.js` 的让位同源）。
"""
import sys
sys.path.insert(0, "/opt/hergent-erp")
import core  # ⚠️ 必须先 source .env（core.py import 期强制要 ERP_SECRET）

ROLES = ("admin", "boss", "accountant", "sales", "guide", "driver", "staff",
         "supervisor", "distributor")


def can(role, mod, tid=1):
    u = {"id": 1, "role": role, "roles": ""}
    try:
        r = core._check_perm(u, mod, "read", tenant_id=tid)
        return True if r is None else bool(r)
    except Exception:
        return False


fails = []


def ck(cond, label):
    print("    %s %s" % ("✅" if cond else "❌", label))
    if not cond:
        fails.append(label)


print("=== A) 内置默认（_DEFAULT_PERMS）持 chat 的角色 ===")
holders = sorted([r for r, v in core._DEFAULT_PERMS.items() if "*" in v or "chat" in v])
print("    ", holders)
ck(holders == ["admin", "boss"], "默认只有 admin/boss 持 chat")

for tid in (1, 10):
    print()
    print("=== tenant_%d 裁决 ===" % tid)
    cust = sorted(core.custom_roles(tid))
    print("    custom_roles(%d) = %s" % (tid, cust))
    for role in ROLES:
        tbl = core.perms_for(tid)
        row = tbl.get(role)
        keys = sorted(row.keys()) if isinstance(row, dict) else (sorted(row) if row else [])
        print("      %-14s chat=%-6s 模块 %d 项  %s"
              % (role, can(role, "chat", tid), len(keys),
                 "**改过**（让位生效）" if role in cust else "走内置默认"))

print()
print("=== C) 反例对照：非 AI 模块必须仍然放行（证明只撤了 chat）===")
for role, mod in (("staff", "data"), ("sales", "sales"), ("accountant", "accounts"),
                  ("driver", "stock"), ("guide", "crm"), ("supervisor", "sales"),
                  ("boss", "hr"), ("admin", "chat")):
    ck(can(role, mod, 1), "%s 仍可访问 %s" % (role, mod))

print()
print("=== D) 断言：管理员与老板保留 AI，其余内置角色无 AI ===")
for role in ("admin", "boss"):
    ck(can(role, "chat", 1), "%s 保留 chat（管理员/老板）" % role)
for role in ("accountant", "sales", "guide", "driver", "staff"):
    ck(not can(role, "chat", 1), "%s 已无 chat" % role)
print("    （supervisor / distributor / 自定义角色见上面各租户裁决 —— 它们随租户而异）")

print()
print("===== %s =====" % ("全部通过" if not fails else "失败 %d 项：%s" % (len(fails), fails)))
sys.exit(0 if not fails else 1)
