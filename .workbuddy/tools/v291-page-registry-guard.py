#!/usr/bin/env python3
"""v291 页面注册表护栏 —— 防止「漏登记」导致的静默失去保护。

为什么必须有这把护栏（本轮真实踩过）：
    `constants/pages.js::ruleFor()` 对**未登记的路径返回 `null`**，而 `canSeePage()`
    对 `null` 是 **fail-open（放行）**。这个方向是刻意选的（未登记不应把页面锁死），
    但它有个必然代价：**漏登记不会报错，只是那一页静默失去门禁**。
    本轮第一次跑探针就抓到两处 —— `/payroll` 与 `/bid-radar` 我根本没写进表里，
    于是「算工资」「招投标雷达」对**全部 8 个角色**都可见（其余 10 条是对的）。
    这种缺陷读代码看不出来（代码里什么都没有，所以"看起来没问题"），
    只有拿「入口实际引用到的路径」去比「表里登记的路径」才会现形。

判据（任一不满足即退出码 1）：
    A. Shell.vue / CommandPalette.vue 里引用到的**每一个**路径，都必须在 PAGE_RULES 里登记。
       引用 = `canSee('/x')` 字面量 ∪ **`Shell.vue` NAV 表里的 `path: '/x'`**（v390 起）。
    B. router/index.js 里每个**有组件**的子路由（非 redirect），也必须在表里登记。
       （redirect-only 的路由豁免 —— 它不渲染页面，keeper 不适用。）
    C. 反向提示：表里登记但三个入口都没引用的路径 —— 只提示不失败
       （`/zhoupu-import`、`/loss`、`/dashboard`、`/data-fill` 这类是深链/页内跳转专用，正常）。

🔴 v390（2026-10-07）判据 A 的**输入**扩了 —— 这是**修判据**，不是放宽：
    v388/v390 把侧栏改成**表驱动**（读同一张 `NAV`，`canSee` 只在 `resolveNavItem`/`mnavItems`
    里各调一次，模板里 0 处判据）⇒ 旧判据那套「从 `Shell.vue` 正则抓 `canSee('/x')` 字面量」
    会抓到 **0 个**，于是本条**恒绿但什么也没查**（覆盖面对称地消失了 —— 比红灯更危险）。
    新输入 = `path: '/x'`：表驱动下**每一条 `path` 都真的会被 `canSee` 判一次**
    （扁平项判自己；职能区判准入锚点 `path` + 每个条目的 `path`）⇒ 未登记仍会 fail-open
    （`ruleFor` 返 null ⇒ 放行）⇒ 必须登记。改的是"从哪儿取引用"，判的方向一字未动。
    ⚠️ 取引用前**先剥注释**：本仓注释刻意引用被禁止的写法本身
       （v390 就在 NAV 注释里写了 `path: '/inventory'`），不剥会把"注释里提到的路径"
       当成真实入口引用（同族纪律见 `role-registry-consistency-check.py::strip_js_comments`）。

用法：python3 .workbuddy/tools/v291-page-registry-guard.py
"""
import re
import sys
import pathlib

SRC = pathlib.Path('/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src')
PAGES = SRC / 'constants/pages.js'
SHELL = SRC / 'components' / 'Shell.vue'
PALETTE = SRC / 'components' / 'CommandPalette.vue'
ROUTER = SRC / 'router' / 'index.js'

fail = []

# ---------- 1. 表里登记了哪些 ----------
pages_src = PAGES.read_text(encoding='utf-8')
# 只取 PAGE_RULES 对象字面量里的键（避免误抓注释里的 '/x'）
block = pages_src[pages_src.index('export const PAGE_RULES'):]
block = block[:block.index('\n}')]
registered = set(re.findall(r"^\s*'(/[a-z0-9/-]+)':\s*\{", block, re.M))
print('PAGE_RULES 登记 %d 个路径' % len(registered))
for p in sorted(registered):
    print('   ' + p)

# ---------- 2. 入口引用了哪些 ----------
def _strip_comments(s):
    """抹掉 `<!-- -->` / `/* */` / `//` 注释。判据只许看**行为**，不许看"提及行为"。

    🔴 本仓注释刻意引用被禁止的写法本身（v390 就在 NAV 注释里写了 `path: '/inventory'`）；
       不剥会把注释里提到的路径当成真实入口引用（同族纪律见
       `role-registry-consistency-check.py::strip_js_comments`）。
    ⚠️ `//` 只在其前面是行首或空白时才当注释 —— 否则 `http://` 会被截掉。
    """
    s = re.sub(r"<!--[\s\S]*?-->", " ", s)
    s = re.sub(r"/\*[\s\S]*?\*/", " ", s)
    return '\n'.join(re.sub(r"(^|\s)//.*$", r"\1", ln) for ln in s.split('\n'))


def refs(path):
    s = _strip_comments(path.read_text(encoding='utf-8'))
    return set(re.findall(r"canSee\('(/[a-z0-9/-]+)'\)", s))


def nav_paths(path):
    """v390：`Shell.vue` NAV 表里声明的入口路径（`path: '/x'`）—— 见文件头判据 A 的说明。

    表驱动下这些 `path` **每一条都会被 `canSee` 判一次**，所以它们与 `canSee('/x')`
    字面量**同等**受"必须登记"的约束。取之前先剥注释（注释里也写着 `path: '/…'`）。
    ⚠️ 只取**带引号的字符串字面量**：`{ path: it.path }` / `{ path: route.path }`
       这类是取值（不是新路径），不会被抓到。
    """
    s = _strip_comments(path.read_text(encoding='utf-8'))
    return set(re.findall(r"\bpath:\s*'(/[a-z0-9/-]+)'", s))


shell_refs = refs(SHELL) | nav_paths(SHELL)
palette_refs = refs(PALETTE)
print('\nShell.vue 引用 %d 个（含 NAV 表 %d 个）/ CommandPalette.vue 引用 %d 个'
      % (len(shell_refs), len(nav_paths(SHELL)), len(palette_refs)))

used = shell_refs | palette_refs
missing_a = sorted(used - registered)
print('\n--- 判据 A：入口引用但**未登记**（fail-open ⇒ 静默失去门禁）---')
if missing_a:
    for p in missing_a:
        print('   ❌ %s' % p)
        fail.append('A: %s 被入口引用但未登记' % p)
else:
    print('   ✅ 无（每个被引用的路径都已登记）')

# ---------- 3. router 里有组件的子路由 ----------
# 🔴 按**缩进层级**取：只取 `{` 缩进为 8 空格的那一层（= Shell 的直接 children）。
#    为什么要分层次：`/archive` 的 4 个子路由（employees/customers/brands/products）
#    真实 URL 是 `/archive/xxx`，由父级 `/archive` 一行覆盖 —— 若把它们当独立页面，
#    会报 4 个假缺口（第一版就是这么误报的）。同层还要跳过 `/` 与 `/login`（公开页）。
rsrc = ROUTER.read_text(encoding='utf-8')
rlines = rsrc.split('\n')
routes = set()
for i, ln in enumerate(rlines):
    m = re.match(r'^(\s*)\{\s*(.*)$', ln)
    if not m:
        continue
    if len(m.group(1)) != 8:          # 只认 Shell 的直接 children 这一层
        continue
    pm = re.match(r"path:\s*'([^']*)'", m.group(2))
    if not pm and i + 1 < len(rlines):
        pm = re.match(r"\s*path:\s*'([^']*)'", rlines[i + 1])
    if not pm:
        continue
    seg = pm.group(1)
    if not seg or seg.startswith('/'):
        continue                      # path: '' 是 redirect；绝对路径是公开/顶层
    # 纯 redirect 路由（不渲染页面）豁免 —— 典型是 v265 保留的 `/product-target`
    # （旧书签/命令面板里还留着它，redirect 到 `/forecast?tab=target`）。
    # 不渲染就不需要门禁；真进了也会被 redirect 到目标页，由目标页的行负责。
    if 'redirect' in m.group(2) and 'component' not in m.group(2):
        continue
    routes.add('/' + seg)


def covered(p):
    """模拟 pages.js::ruleFor 的「逐级去尾段」匹配。"""
    while p:
        if p in registered:
            return True
        i = p.rfind('/')
        if i <= 0:
            return False
        p = p[:i]
    return False


missing_b = sorted(p for p in routes if not covered(p))
print('\n--- 判据 B：router 有组件的子路由但**未登记** ---')
print('   （router 抓到 %d 个：%s）' % (len(routes), ' '.join(sorted(routes))))
if missing_b:
    for p in missing_b:
        print('   ❌ %s' % p)
        fail.append('B: %s 是路由页面但未登记' % p)
else:
    print('   ✅ 无')

# ---------- 4. 反向提示 ----------
unused = sorted(registered - used - routes)
print('\n--- 反向提示：登记了但三个入口都没引用（仅提示，不算失败）---')
print('   ' + (' '.join(unused) if unused else '（无）'))
print('   注：这些通常是深链 / 页内跳转专用（如 /zhoupu-import、/loss），属正常。')

print('\n' + '=' * 56)
if fail:
    print('❌ 护栏未通过（%d 项）：' % len(fail))
    for f in fail:
        print('   - ' + f)
    sys.exit(1)
print('✅ 护栏通过：入口引用集合 ⊆ 注册表')
