#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小程序「角色 × 接口」授权矩阵 —— 用真实后端代码 + 真实生产覆盖数据判定。

判据与 server.py::rbac_middleware 逐字同构：
  module = _PATH_MODULE_MAP 中**首个前缀命中**（dict 顺序即优先级）；
  action = {GET:read, POST:create, PUT:update, PATCH:update, DELETE:delete}[method]；
  放行   = _check_perm(user, module, action, tenant_id=tid)
          ⇒ perms = perms_for(tid).get(role, [])；'*' 通配；list 格式 ⇒ `module in perms`。
"""
import ast, os, sys, sqlite3

SERVER = os.environ.get("HERGENT_SERVER", os.path.expanduser("~/Documents/hergent-erp/server"))


def load_perms_map():
    src = open(os.path.join(SERVER, "core.py"), encoding="utf-8").read()
    for n in ast.parse(src).body:
        if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == "_DEFAULT_PERMS" for t in n.targets):
            return ast.literal_eval(n.value)
    raise SystemExit("找不到 _DEFAULT_PERMS")


def load_path_map():
    src = open(os.path.join(SERVER, "server.py"), encoding="utf-8").read()
    for n in ast.parse(src).body:
        if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == "_PATH_MODULE_MAP" for t in n.targets):
            return ast.literal_eval(n.value)          # dict 保序
    raise SystemExit("找不到 _PATH_MODULE_MAP")


def resolve(path):
    for prefix, mod in PATH_MAP.items():
        if path.startswith(prefix):
            return mod
    return None


# 小程序调用的全部端点（从前端源码 request() 调用点提取）
ENDPOINTS = [
    ("POST", "/api/auth/login",                     "登录",            "RBAC 豁免（/api/auth 在 _PUBLIC_PATHS，端点内自带校验）"),
    ("GET",  "/api/auth/me",                        "会话复核",         "RBAC 豁免"),
    ("POST", "/api/auth/password",                  "改密",            "RBAC 豁免"),
    ("POST", "/api/auth/forgot-reset",              "重置码改密",       "RBAC 豁免（免登录）"),
    ("GET",  "/api/forecast-submissions/open-periods", "期次列表",       ""),
    ("GET",  "/api/forecast-submissions/stores",    "我的门店",         ""),
    ("GET",  "/api/forecast-submissions/my",        "我的提交",         ""),
    ("POST", "/api/forecast-submissions",           "提交预报",         ""),
    ("POST", "/api/forecast-submissions/123/recall", "撤回",           ""),
    ("GET",  "/api/forecast-submissions/summary",   "汇总总表",         "路由内另有角色名单硬编码"),
    ("GET",  "/api/products/fill-search",           "填报商品",         ""),
]

ORDER = ["admin", "boss", "accountant", "sales", "supervisor", "guide", "driver", "staff"]

# 生产实测：main库 tenants = {1,10}；租户库 role_permissions 覆盖行
#   tenant_1: 库管(自定义角色) + supervisor  |  tenant_10: supervisor  |  tenant_9: supervisor（空壳库）
PROD_OVERRIDES = {
    1:  {"supervisor": ["data", "dashboard"]},
    10: {"supervisor": ["data", "dashboard"]},
}

SUMMARY_ROLE_WHITELIST = ("admin", "boss", "accountant", "supervisor")   # routers/forecast_submissions.py:273


def eff_perms(tid, role):
    """该租户下该角色的**生效**权限（租户覆盖优先，否则内置默认）。"""
    return PROD_OVERRIDES.get(tid, {}).get(role, _DEFAULT_PERMS.get(role, []))


def allowed(perms, module, action):
    if not perms:
        return False
    if "*" in perms:
        return True
    return module in perms          # legacy list 格式：授予该模块全部动作


if __name__ == "__main__":
    _DEFAULT_PERMS = load_perms_map()
    PATH_MAP = load_path_map()

    print("=" * 100)
    print(" A、解析自真实代码（不是手抄）")
    print("=" * 100)
    print("  _PATH_MODULE_MAP 条目数 =", len(PATH_MAP))
    print("  _DEFAULT_PERMS 角色数 =", len(_DEFAULT_PERMS), "→", list(_DEFAULT_PERMS))
    print()
    print("  小程序 11 个端点 → (模块, 动作)")
    for m, p, name, note in ENDPOINTS:
        mod = resolve(p)
        act = {"GET": "read", "POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}[m]
        print("    %-46s %-14s %s / %-6s %s" % (p[:46], name, mod or "[未配置]", act, note))

    print()
    print("=" * 100)
    print(" B、授权矩阵：role × 「能否调通填报主链」")
    print("    填报主链 = /stores（读门店）+ /products/fill-search（读商品）+ POST /api/forecast-submissions（提交）")
    print("=" * 100)
    hdr = "%-12s %-4s | %-11s | %-11s | %-11s | %-11s | %s" % (
        "角色", "全权", "读门店", "读商品", "提交预报", "撤回", "汇总总表")
    print(hdr)
    print("-" * 106)
    verdicts = []
    for role in ORDER:
        p1 = eff_perms(1, role)
        def ok(path, method):
            mod = resolve(path)
            act = {"GET": "read", "POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}[method]
            if mod is None:
                return False
            return allowed(p1, mod, act)

        v_stores = ok("/api/forecast-submissions/stores", "GET")
        v_prod = ok("/api/products/fill-search", "GET")
        v_submit = ok("/api/forecast-submissions", "POST")
        v_recall = ok("/api/forecast-submissions/1/recall", "POST")
        # 汇总要两层：中间件(模块) + 路由内名单
        v_sum_mw = ok("/api/forecast-submissions/summary", "GET")
        v_sum_role = role in SUMMARY_ROLE_WHITELIST
        v_sum = v_sum_mw and v_sum_role
        is_admin = "*" in p1
        row = "%-12s %-4s | %-11s | %-11s | %-11s | %-11s | %s" % (
            role, "★" if is_admin else "",
            "✅" if v_stores else "❌403", "✅" if v_prod else "❌403",
            "✅" if v_submit else "❌403", "✅" if v_recall else "❌403",
            ("✅ 可看" if v_sum else
             ("⚠️ 入口可见但 403" if (v_sum_role and not v_sum_mw) else "❌ 前端已隐藏")))
        print(row)
        verdicts.append((role, v_stores and v_prod and v_submit, v_sum, v_sum_role and not v_sum_mw))

    print()
    print("=" * 100)
    print(" C、判定：登录小程序之后能不能干活")
    print("=" * 100)
    dead, partial, fine = [], [], []
    for role, can_fill, can_sum, trap in verdicts:
        if not can_fill:
            (partial if can_sum else dead).append(role)
        else:
            fine.append(role)
    print("  ✅ 能完整填报           :", ", ".join(fine) or "（无）")
    print("  ❌ 登录即成死路（全 403）:", ", ".join(dead) or "（无）")
    print("  ⚠️ 填报 403 但能看汇总   :", ", ".join(partial) or "（无）")
    print()
    trap_roles = [r for r, _, _, t in verdicts if t]
    print("  🔴 陷阱（前端显示入口、点进去必报错）:", ", ".join(trap_roles) or "（无）")
    for r in trap_roles:
        print("       %s：APPROVER_ROLES 收它（roles.js:25）但 _DEFAULT_PERMS 缺 'data'" % r)
        print("             ⇒ mine 页 canManage=true 显示「汇总总表」→ summary.js 前端校验通过 →"
              " 中间件 403 → toast 报错")
    print()
    print("  ⚠️ 生产现状（无该角色的账号）⇒ 以上为**地雷**而非已爆：")
    print("     生产 users 仅 admin(2)/boss(2)/supervisor(1)/sales(1)，无 accountant/guide/driver/staff")
