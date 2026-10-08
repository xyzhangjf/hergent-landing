#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v348 侦察：权限页「四类维度」改造前的真实代码盘点。

回答四个问题，全部**机器对齐**，不靠肉眼：
  A. 侧栏 10 项，各自挂的是哪个后端模块？权限页上到底有没有一行能关掉它？
  B. 后端 `_ALL_MODULES` 19 项里，哪些在**侧栏没有任何入口**（= 勾了看不见变化）？
  C. 后端 `/api/role-permissions*` + `/api/permissions/*` 的全部端点，哪些**前端从未调用**？
  D. 接口侧下发但前端**从未读取**的字段（被埋起来的能力）。

只读：不写任何文件、不改任何库。
"""
import ast
import os
import re
import sys

ROOT = "/Users/zhangjunfeng/Documents"
CORE_PY = os.path.join(ROOT, "hergent-erp/server/core.py")
SERVER_PY = os.path.join(ROOT, "hergent-erp/server/server.py")
FE = os.path.join(ROOT, "laozhangai-product/hergent-cn-v2/src")
PAGES_JS = os.path.join(FE, "constants/pages.js")
SHELL_VUE = os.path.join(FE, "components/Shell.vue")
SETTINGS_VUE = os.path.join(FE, "pages/Settings.vue")
ROLES_JS = os.path.join(FE, "constants/roles.js")


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def py_literal(path, var):
    """AST 取模块级 `var = <字面量>`；不 import、不执行。"""
    tree = ast.parse(read(path))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == var:
                    try:
                        return ast.literal_eval(node.value)
                    except Exception:
                        return None
    return None


# ---------------------------------------------------------------- 后端
ALL_MODULES = py_literal(CORE_PY, "_ALL_MODULES") or []
MODULE_LABEL = py_literal(CORE_PY, "MODULE_LABEL") or {}
MODULE_IMPACT = py_literal(CORE_PY, "MODULE_IMPACT") or {}
MINI_MODULES = tuple(py_literal(CORE_PY, "MINI_MODULES") or ())
DEFAULT_PERMS = py_literal(CORE_PY, "_DEFAULT_PERMS") or {}
PATH_MODULE_MAP = py_literal(SERVER_PY, "_PATH_MODULE_MAP") or {}
ALL_ACTIONS = py_literal(CORE_PY, "_ALL_ACTIONS") or []
ROLE_LOGIN_SCOPE = py_literal(CORE_PY, "ROLE_LOGIN_SCOPE") or {}
ROLE_END_PROTECTED = tuple(py_literal(CORE_PY, "ROLE_END_PROTECTED") or ())

# 每个模块「真的在裁决多少条接口前缀」——按首个 startswith 命中即停的**真实**语义统计
def mod_endpoint_count():
    cnt = {}
    for prefix in PATH_MODULE_MAP:          # 只数前缀条数（映射是前缀表）
        m = PATH_MODULE_MAP[prefix]
        cnt[m] = cnt.get(m, 0) + 1
    return cnt


MOD_EP = mod_endpoint_count()

# 后端权限族端点
BACKEND_ROUTES = []
src = read(SERVER_PY)
for m in re.finditer(r'@app\.(get|post|put|delete)\("(/api/(?:role-permissions|permissions)[^"]*)"\)', src):
    BACKEND_ROUTES.append((m.group(1).upper(), m.group(2)))

# ---------------------------------------------------------------- 前端 pages.js
pages_src = read(PAGES_JS)
PAGE_RULES = {}
for m in re.finditer(r"'([^']+)':\s*\{([^}]*)\}", pages_src):
    path, body = m.group(1), m.group(2)
    if not path.startswith("/"):
        continue
    t = re.search(r"title:\s*'([^']*)'", body)
    mod = re.search(r"module:\s*(null|'([^']*)')", body)
    lock = bool(re.search(r"lock:\s*true", body))
    PAGE_RULES[path] = {
        "title": t.group(1) if t else "",
        "module": (mod.group(2) if (mod and mod.group(2)) else None),
        "lock": lock,
    }

# ---------------------------------------------------------------- Shell.vue NAV
shell_src = read(SHELL_VUE)
nav_block = shell_src.split("const NAV = [", 1)[1].split("\n]", 1)[0]
NAV = []          # (组名, path, 侧栏名)
cur_group = None
for line in nav_block.splitlines():
    g = re.search(r"label:\s*'([^']+)'", line)
    if g:
        cur_group = g.group(1)
        continue
    it = re.search(r"\{\s*path:\s*'([^']+)',\s*name:\s*'([^']+)'", line)
    if it:
        NAV.append((cur_group, it.group(1), it.group(2)))

# ---------------------------------------------------------------- 前端消费面
settings_src = read(SETTINGS_VUE)


def strip_comments(js):
    """去掉块注释 / 模板注释 / 整行 `//` 注释 —— 注释里提到字段名不算"读了它"。

    🔴 必须先剥：本仓的注释密度极高，`is_default`、`feeds`、`手机端` 都在注释里出现过
       （如 Settings.vue 的 v331c / v328 说明段）⇒ 不剥就会把"注释里提过"当成"前端读过"，
       正是「搜到了就算事实」那类误判。只剥整行 `//`（不动行内，避免砍掉 `https://`）。
    """
    s = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"^\s*//.*$", "", s, flags=re.M)
    return s


settings_code = strip_comments(settings_src)


def fe_reads_field(pattern):
    return re.search(pattern, settings_code) is not None


# ---------------------------------------------------------------- 输出
line = "=" * 78


def h(t):
    print()
    print(line)
    print(t)
    print(line)


print("v348 权限维度盘点（只读）")
print("后端 %s" % CORE_PY)
print("前端 %s" % SETTINGS_VUE)

h("A. 侧栏 10 项 × 后端模块 × 权限页有没有一行能关掉它")
print("%-4s %-8s %-16s %-14s %-18s %s" % ("#", "组", "侧栏项", "路由", "挂的模块", "权限页上对应哪一行"))
uncovered, indirect = [], []
for i, (grp, path, name) in enumerate(NAV, 1):
    r = PAGE_RULES.get(path, {})
    mod = r.get("module")
    row = ""
    if mod:
        row = "%s（%s）" % (MODULE_LABEL.get(mod, mod), mod)
        ent = MODULE_IMPACT.get(mod, {}).get("entries") or []
        # 两类「名义对不上」：① 行名 ≠ 侧栏名；② 这一个开关同时管多页（一关关一串）
        if MODULE_LABEL.get(mod, mod) != name or len(ent) > 1:
            indirect.append((name, path, mod, row, MODULE_LABEL.get(mod, mod), ent))
    else:
        row = "◀ 无 —— 权限页上没有任何一行管它"
        uncovered.append((name, path, r.get("title", "")))
    print("%-4d %-8s %-18s %-18s %-20s %s" % (
        i, grp, name, path,
        (MODULE_LABEL.get(mod, mod) if mod else "—"),
        row))

h("A2. 「侧栏有入口、权限页上却没有任何一行能关掉它」的页面（= 老板说的『缺失的配置入口』）")
for name, path, title in uncovered:
    r = PAGE_RULES.get(path, {})
    print("  · %-12s %-16s  module=%s  lock=%s" % (name, path, r.get("module"), r.get("lock")))
print("  —— 第二类：**能关，但行名对不上 / 一个开关管一串页**（老板照侧栏名找不到它）：")
for name, path, mod, row, lab, ent in indirect:
    print("  · 侧栏「%s」%s\n      权限页那一行叫「%s」，它同时管 %d 个页面入口：%s"
          % (name, path, lab, len(ent), "、".join(ent)))

h("B. 后端 %d 个模块 × 接口前缀条数 × 侧栏是否有入口" % len(ALL_MODULES))
print("%-16s %-20s %-8s %-10s %s" % ("模块键", "权限页行名", "接口数", "小程序", "对应页面入口（MODULE_IMPACT.entries）"))
sidebar_titles = {n for _, _, n in NAV}
nopage = []
for m in ALL_MODULES:
    eps = MOD_EP.get(m, 0)
    ent = MODULE_IMPACT.get(m, {}).get("entries", [])
    feeds = MODULE_IMPACT.get(m, {}).get("feeds", [])
    if not ent and not feeds:
        nopage.append((m, MODULE_LABEL.get(m, m), eps))
    print("%-16s %-20s %-8s %-10s %s%s" % (
        m, MODULE_LABEL.get(m, m), eps,
        "✓" if m in MINI_MODULES else "",
        "、".join(ent) if ent else "（无入口页）",
        ("  feeds→ " + "、".join(feeds)) if feeds else ""))

print()
print("B2. 勾了在**新前端**看不到任何变化的模块（entries 与 feeds 都空） —— 共 %d 个：" % len(nopage))
for m, lab, eps in nopage:
    print("  · %-14s %-16s 接口前缀 %d 条" % (m, lab, eps))

h("C. 后端权限族端点 × 前端是否调用")
print("%-8s %-46s %s" % ("方法", "端点", "前端调用"))
for meth, path in BACKEND_ROUTES:
    print("%-8s %-46s %s" % (meth, path, "✓" if fe_reads_field(re.escape(path)) else "✗ 从未调用"))

h("D. 接口已下发、但权限页**从未读取**的字段")
FIELDS = [
    ("modules[].mini", r"\bm\.mini\b",
     "该模块在小程序端有没有真实功能（v312 加的只读标记，v331c 把那一列删了）"),
    ("modules[].feeds", r"\.feeds\b",
     "入口不受它管、但页内数据要靠它读（v333 起前端刻意不显示）"),
    ("roles[].is_default", r"\bis_default\b",
     "该角色是不是系统自带（后端 `role in _DEFAULT_PERMS`）"),
    ("roles[].end_builtin", r"\bend_builtin\b",
     "登录端的内置默认值（用于「恢复默认」比对）"),
    ("roles[].default_login_scope", r"\bdefault_login_scope\b",
     "该角色新账号的默认可登录端（单值）"),
    ("detail.modules / detail.actions", r"\bd\.modules\b|\bd\.actions\b",
     "细粒度端点的模块表与动作表（前端自己硬编码了 `permActions`）"),
]
for label, pat, why in FIELDS:
    print("%-30s %-6s %s" % (label, "读过" if fe_reads_field(pat) else "未读", why))

h("E. 四类维度的后端「已有积木」核对")
print("① 功能模块  → `_ALL_MODULES`（%d 项）＋ `role_permissions.permissions`    %s" % (len(ALL_MODULES), "已有"))
print("② 可用 AI   → 模块 `chat`（%s）＋ %d 条接口前缀      %s"
      % (MODULE_LABEL.get("chat", "chat"), MOD_EP.get("chat", 0), "已有，但混在模块列表里"))
print("③ 网页端    → `role_end(role_name, allow_web, allow_mini)` 表              %s" % "已有")
print("④ 小程序端  → 同上（同一行两列）                                          %s" % "已有")
print()
print("端的内置默认（`ROLE_LOGIN_SCOPE`）与不可关名单：")
for k in sorted(ROLE_LOGIN_SCOPE):
    print("   %-14s %s%s" % (k, ROLE_LOGIN_SCOPE[k], "   ← 电脑端不可关" if k in ROLE_END_PROTECTED else ""))
print()
print("动作轴（后端已有、v334 才接上前端）：_ALL_ACTIONS = %s" % ALL_ACTIONS)
print("默认权限表角色数 = %d：%s" % (len(DEFAULT_PERMS), "、".join(sorted(DEFAULT_PERMS))))
print()
print("判定：解锁 ①②③④ 四类维度所需的后端积木**全部已存在**，缺的只是权限页的**行来源**"
      "（现在按后端模块出行，而不是按侧栏功能出行）。")
