#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只读取证：两条权限链的数据链透视。

审计对象（都只读，不写任何库、不改任何文件）：
  A 链 =「设置 › 权限」   → 写 tenant_<id>.db::role_permissions（角色 × 模块）
  B 链 =「员工档案 › 账号」→ 写主库 erp.db::users（role / roles）

判据取真码：用 ast 从生产 core.py 切 `_DEFAULT_PERMS` / `_ALL_MODULES`，
而不是在脚本里另抄一份（抄一份 = 下一个漂移源）。

用法（生产服务器上，以 hergent 身份）：
    runuser -u hergent -- /usr/bin/python3 /opt/hergent-erp/perms-dual-chain-audit.py
"""
import ast
import json
import os
import sqlite3
import sys

ERPDIR = "/opt/hergent-erp"
MASTER = os.path.join(ERPDIR, "erp.db")
TENANTS = [1, 10]

# 前端硬编码的角色下拉（pages/EmployeeArchive.vue::ROLE_OPTIONS）—— 用于「B 链能不能指派该角色」
FE_ROLE_OPTIONS = ["staff", "supervisor", "sales", "guide", "driver", "accountant", "boss", "admin"]
# 前端角色中文名表（constants/roles.js::ROLE_NAMES）—— 用于「显示是否回落成未知角色(xxx)」
FE_ROLE_NAMES = ["admin", "boss", "accountant", "sales", "guide", "driver", "staff", "supervisor"]


def ro(path):
    """只读打开（活库：mode=ro，**不带** immutable —— 带了会无视 WAL 读到过期页）。"""
    return sqlite3.connect("file:%s?mode=ro" % path, uri=True)


def parse_from_source():
    """从生产真码 core.py 切出 _DEFAULT_PERMS / _ALL_MODULES。"""
    p = os.path.join(ERPDIR, "core.py")
    src = open(p, encoding="utf-8").read()
    tree = ast.parse(src)
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in ("_DEFAULT_PERMS", "_ALL_MODULES"):
                    out[t.id] = ast.literal_eval(node.value)
    assert "_DEFAULT_PERMS" in out and "_ALL_MODULES" in out, "AST 切片失败：未找到目标赋值"
    return out


def canon(v):
    """与 core._canon_perms 同口径：模块名升序去重。"""
    if isinstance(v, dict):
        return sorted({str(k) for k in v.keys()})
    if isinstance(v, (list, tuple, set)):
        return sorted({str(x) for x in v})
    return []


def hr(t):
    print("\n" + "=" * 78)
    print(t)
    print("=" * 78)


def main():
    real = parse_from_source()
    DP = real["_DEFAULT_PERMS"]
    ALLMOD = real["_ALL_MODULES"]
    print("判据来源：生产 core.py（ast 实取，非手抄）")
    print("  _DEFAULT_PERMS 角色数 = %d  → %s" % (len(DP), "、".join(sorted(DP.keys()))))
    print("  _ALL_MODULES   模块数 = %d  → %s" % (len(ALLMOD), "、".join(ALLMOD)))

    # ---------------- A 链：角色权限矩阵（租户库） ----------------
    custom_by_tenant = {}
    for tid in TENANTS:
        path = os.path.join(ERPDIR, "tenant_%d.db" % tid)
        if not os.path.exists(path):
            print("\n[A链] tenant_%d.db 不存在，跳过" % tid)
            continue
        hr("[A链] tenant_%d.db::role_permissions —— 「设置 › 权限」的落库处" % tid)
        with ro(path) as db:
            try:
                rows = db.execute("SELECT role_name, permissions FROM role_permissions").fetchall()
            except Exception as e:
                print("  读表失败：%s" % e)
                continue
            if not rows:
                print("  (空表 —— 该租户从未点过「保存权限」)")
            custom = {}
            for name, pj in rows:
                try:
                    v = json.loads(pj)
                except Exception as e:
                    print("  %-12s  JSON 坏行: %s" % (name, e))
                    continue
                c = canon(v)
                d = canon(DP.get(name))
                mark = "**自定义**" if c != d else "(与内置默认相同)"
                print("  %-12s 模块数=%-3d %s" % (name, len(c), mark))
                print("       %s" % (c if c else "[]"))
                if c != d:
                    custom[name] = c
                    if name in DP:
                        only_new = sorted(set(c) - set(d))
                        only_gone = sorted(set(d) - set(c))
                        if only_new:
                            print("       ↑ 比内置默认多: %s" % only_new)
                        if only_gone:
                            print("       ↓ 比内置默认少: %s" % only_gone)
            custom_by_tenant[tid] = custom
            print("\n  ⇒ custom_roles(tenant_%d) = %s" % (tid, sorted(custom.keys())))
            known = set(DP.keys()) | set(custom.keys())
            print("  ⇒ known_roles(tenant_%d)  = %d 个 → %s" % (tid, len(known), sorted(known)))

    # ---------------- B 链：账号表（主库） ----------------
    hr("[B链] erp.db::users —— 「员工档案 › 账号与权限」的落库处")
    with ro(MASTER) as db:
        cols = [r[1] for r in db.execute("PRAGMA table_info(users)").fetchall()]
        print("  users 列: %s" % ", ".join(cols))
        has_roles_col = "roles" in cols
        sel = "id, username, role, is_active"
        if has_roles_col:
            sel += ", roles"
        if "employee_id" in cols:
            sel += ", employee_id"
        rows = db.execute("SELECT %s FROM users ORDER BY role, id" % sel).fetchall()
        print("\n  账号总数 = %d" % len(rows))
        by_role = {}
        for r in rows:
            d = dict(zip([c.strip() for c in sel.split(",")], r))
            by_role.setdefault(d.get("role") or "(空)", []).append(d)
        print("\n  按主角色分布：")
        for role in sorted(by_role.keys()):
            lst = by_role[role]
            in_name = "OK" if role in FE_ROLE_NAMES else "🔴 不在前端 ROLE_NAMES"
            in_opt = "OK" if role in FE_ROLE_OPTIONS else "🔴 不在前端下拉 ROLE_OPTIONS"
            print("    %-14s %2d 个   [%s] [%s]" % (role, len(lst), in_name, in_opt))

        # 兼任角色
        if has_roles_col:
            extras = [d for d in (dict(zip([c.strip() for c in sel.split(",")], r)) for r in rows)
                      if (d.get("roles") or "").strip()]
            print("\n  带兼任角色的账号 = %d" % len(extras))
            for d in extras[:20]:
                print("    #%s %-14s 主=%-12s 兼任=%s" % (d["id"], d["username"], d["role"], d["roles"]))

        # 员工关联
        if "employee_id" in cols:
            linked = sum(1 for r in rows if r[-1])
            print("\n  已关联员工档案的账号 = %d / %d" % (linked, len(rows)))

    # ---------------- 交叉分析 ----------------
    hr("交叉分析：两条链的对齐/错位")
    with ro(MASTER) as db:
        cols = [r[1] for r in db.execute("PRAGMA table_info(users)").fetchall()]
        rows = db.execute("SELECT id, username, role FROM users").fetchall()
    all_used_roles = sorted({(r[2] or "").strip() for r in rows if (r[2] or "").strip()})

    print("① users.role 里实际出现的角色 = %s" % all_used_roles)
    print("② 前端下拉可指派（ROLE_OPTIONS，写死 8 项）= %s" % FE_ROLE_OPTIONS)

    missing_in_dp = [r for r in all_used_roles if r not in DP]
    print("\n③ 🔴 被指派过、但**不在内置 _DEFAULT_PERMS** 里的角色（= 租户自定义角色）：")
    print("     %s" % (missing_in_dp or "无"))
    for r in missing_in_dp:
        tids = [t for t, c in custom_by_tenant.items() if r in c]
        print("     · %-12s 在租户库有自定义权限吗？租户 %s" % (r, tids or "🔴 无 —— 每个模块都 403 的僵尸账号"))

    print("\n④ 🔴 B 链指派得出来、但 A 链**看不到**的角色：无（A 链读 known_roles，是超集）")
    print("⑤ 🔴 A 链配得出权限、但 B 链**下拉里选不到**的角色（只能手改库）：")
    all_custom = sorted({r for c in custom_by_tenant.values() for r in c})
    cannot_assign = [r for r in all_custom if r not in FE_ROLE_OPTIONS]
    print("     自定义角色共 %d 个：%s" % (len(all_custom), all_custom or "无"))
    print("     🔴 下拉选不到的：%s" % (cannot_assign or "无"))

    print("\n⑥ 前端显示层：users.role 里会渲染成「未知角色(xxx)」的 = %s"
          % ([r for r in all_used_roles if r not in FE_ROLE_NAMES] or "无"))

    print("\n⑦ 内置角色在两条链的可见性对照（B 链下拉 / A 链矩阵列）")
    with_tenant = sorted({r for c in custom_by_tenant.values() for r in c})
    for r in sorted(set(list(DP.keys()) + with_tenant)):
        b = "✓" if r in FE_ROLE_OPTIONS else "✗"
        a = "✓" if r in DP else ("✓(自定义)" if r in with_tenant else "✗")
        print("     %-12s B链下拉=%s   A链矩阵=%s" % (r, b, a))

    print("\n[完] 本脚本全程 mode=ro，未写任何库。")


if __name__ == "__main__":
    sys.exit(main())
