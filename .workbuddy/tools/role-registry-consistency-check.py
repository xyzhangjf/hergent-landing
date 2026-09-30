#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""角色清单一致性校验 —— 以后端 `core._DEFAULT_PERMS` 为唯一权威源。

## 为什么需要这个脚本

「角色清单缺条目」是**静默失败**：前端 `roleName(r) { return ROLE_NAMES[r] || r }`、
小程序 `roleText(role) { return ROLE_TEXT[role] || role }` —— 缺映射不报错、不告警，
只是把 `supervisor` 原样显示成裸英文。2026-09-19 实测踩到：后端 8 个角色，
员工档案的下拉与显示名各只列了 7 个（都漏 supervisor），后果是
**① 开不出新的主管账号（下拉里没有该角色）② 已是主管的账号显示裸英文**。

同一天还查出另外三处同根因漂移，本轮一并收敛：
  · `Forecast.vue` 的列权限用 owner/finance/promoter/dealer —— 后端**并不存在**这些角色
    ⇒ 一旦把登录角色接进 `store.user.role`，分销价列会对所有真实角色（含老板）隐藏；
  · 小程序 `utils/roles.js` 漏 driver/guide/staff，且 `accountant` 译作「财务」（与网页端「会计」不一致）；
  · 两处「写 users.role」的接口**只校验非空** ⇒ 任何 admin/boss 都能造出新的全权限账号。

## 权威源

后端 `server/core.py` 的 `_DEFAULT_PERMS`（**AST 解析，非正则** —— 注释里也出现过角色名）。
它同时驱动权限门禁，是产品里唯一「真会拒绝请求」的角色定义。

## 断言分三类

* **覆盖性（硬）**：某个面列的键集必须 ⊇ 权威集 —— 缺 = 那个角色在该面静默降级。
* **纯净性（硬）**：不得出现后端不存在的角色名（除非在**白名单**里，如视图令牌 / 业务口语）。
* **接线（硬）**：声明「加了门禁」的地方必须真的调到门禁函数（防止「门禁只有一半」）。

## 🔴 v300（2026-09-27）两道**结构性**订正 —— 改的是"怎么判"，不只是"判什么"

1. **接线类判据全部改用 AST 结构判据**（`func_body_has`），不再用 `[\\s\\S]{0,900}?`
   这类**字符窗口** —— 函数头一插长注释就**假红**（v289 给 `create_staff_account`
   加注释后即命中：白名单明明接了，护栏却说没接）。且 needle 一律带 `(`
   （= 必须真的是**调用**）：否则 `normalize_role_DISABLED(...)` 仍含子串 ⇒ 假绿。
   判别力自证（4 反例 + 正例 + 不误报）：`.workbuddy/tools/v300-guard-discriminate.py`。
2. **A / D 段判据从"label 文字"改成 `roles.js::ROLE_END`**，并把「能用小程序」的判据
   收窄为「有 `data` 或 `*`」。原因：`chat` 自 v292/v293 起**全员持有**（为代理通道降级），
   旧判据下 8 个角色**全部**被判成"能用小程序" ⇒ **失去区分度**。
   ⚠️ 那是**判据过时**，不是文案漏标 —— 所以**修判据**，绝不能"把文案补成 8 个"（那会把
   会计/导购/司机的下拉 label 写成"网页端 + 小程序"，等于把缺陷写进产品）。
   另加一条**横向**校验：`Settings.vue` 的角色标签若提「小程序」，该角色必须真的能用小程序
   （两处文案来源完全不同，这里是对账点）。

## 用法

    python3 .workbuddy/tools/role-registry-consistency-check.py

    # 判别力自证：把任一面替换成一份被改坏的副本，脚本必须 FAIL
    ROLE_REG_CONST=/tmp/broken-roles.js      python3 .workbuddy/tools/role-registry-consistency-check.py
    ROLE_REG_EMPARCHIVE=/tmp/broken.vue      python3 ...
    ROLE_REG_FORECAST=/tmp/broken-fore.vue   python3 ...
    ROLE_REG_MP=/tmp/broken-roles.js         python3 ...
    ROLE_REG_SERVER=/tmp/broken-server.py    python3 ...

退出码 0 = 全绿，1 = 有硬断言失败。
"""
import ast
import io
import os
import re
import sys
import tokenize

HERE = os.path.dirname(os.path.abspath(__file__))
FE_REPO = os.path.dirname(os.path.dirname(HERE))          # laozhangai-product
ERP_REPO = os.environ.get('HERGENT_ERP_DIR', '/Users/zhangjunfeng/Documents/hergent-erp')


def _p(env_key, *parts):
    return os.environ.get(env_key, os.path.join(*parts))


FE_SRC = os.path.join(FE_REPO, 'hergent-cn-v2', 'src')
# 前端「短名」的唯一来源（8 个后端角色 + 视图令牌）
CONST_ROLES = _p('ROLE_REG_CONST', os.path.join(FE_SRC, 'constants', 'roles.js'))
# 员工档案（角色下拉 + 徽标色板）
EMPARCHIVE = _p('ROLE_REG_EMPARCHIVE', os.path.join(FE_SRC, 'pages', 'EmployeeArchive.vue'))
FORECAST = _p('ROLE_REG_FORECAST', os.path.join(FE_SRC, 'pages', 'Forecast.vue'))
SHELL_VUE = _p('ROLE_REG_SHELL', os.path.join(FE_SRC, 'components', 'Shell.vue'))
SETTINGS = _p('ROLE_REG_SETTINGS', os.path.join(FE_SRC, 'pages', 'Settings.vue'))
MP_ROLES = _p('ROLE_REG_MP', os.path.join(
    FE_REPO, 'forecast-order-miniprogram-20260812T023419087Z', 'miniprogram', 'utils', 'roles.js'))
# 前端入口可见性的唯一来源（v291/v296；也是 v328 §5 判据的比对对象）
PAGES_JS = _p('ROLE_REG_PAGES', os.path.join(FE_SRC, 'constants', 'pages.js'))
CORE_PY = _p('ROLE_REG_CORE', os.path.join(ERP_REPO, 'server', 'core.py'))
SERVER_PY = _p('ROLE_REG_SERVER', os.path.join(ERP_REPO, 'server', 'server.py'))
FS_PY = _p('ROLE_REG_FS', os.path.join(ERP_REPO, 'server', 'routers', 'forecast_submissions.py'))
ERPDB_PY = _p('ROLE_REG_ERPDB', os.path.join(ERP_REPO, 'server', 'erp_db.py'))
# v325（2026-09-29）AI 能力闸（`chat` 模块）—— 判据散在前后端两处，故并列在此
STORE_JS = _p('ROLE_REG_STORE', os.path.join(FE_SRC, 'store', 'index.js'))
CMDPAL = _p('ROLE_REG_CMDPAL', os.path.join(FE_SRC, 'components', 'CommandPalette.vue'))
WORKBENCH = _p('ROLE_REG_WORKBENCH', os.path.join(FE_SRC, 'pages', 'Workbench.vue'))

# 允许出现在前端清单里的**非**后端角色（各有理由，别随手往这里加）：
EXTRA_OK = {
    'owner': '视图令牌（早期「按身份预览」演示用词，非后端角色；已被 normRole 归一为 boss）',
    'finance': '视图令牌（同上；归一为 accountant）',
    'dealer': '业务词（本租户主体就是经销商，后端没有也不是角色）',
    'promoter': '业务口语（促销；后端由 staff 承载 —— core.py v107 注释即证）',
}

PASS, FAIL, WARN = [], [], []


def check(name, ok, detail=''):
    (PASS if ok else FAIL).append(name)
    print(('  PASS  ' if ok else '  FAIL  ') + name + (('   [' + detail + ']') if detail else ''))
    return ok


def warn(name, detail=''):
    WARN.append(name)
    print('  WARN  ' + name + (('   [' + detail + ']') if detail else ''))


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def func_body_has(path, funcname, needle):
    """某个函数**体内**是否出现 `needle` —— **AST 结构判据，不用字符窗口**。

    返回 `True` / `False`（函数存在）；函数**不存在**时返回 `None`（与"存在但没有"区分开）。

    🔴 为什么不能用 `re.search(r"def f[\\s\\S]{0,900}?token", src)`：
       那个 900 是**拍脑袋的字符预算**。函数头附近一旦插进长注释，真正的调用点就被推到
       窗口之外 ⇒ **假红**。本项目实测两回：v289 给开账号接口加了长注释后，护栏报
       「没接白名单」，而白名单**明明接了**（已按纪律先怀疑探针，见 `local-machine-pitfalls` §12）。
       结构判据不受注释长度影响：先按 AST 找到函数节点，再只在它自己的源码段里找。

    🔴 v312（2026-09-28）**再订正一层：排除函数自己的 docstring**。
       原实现用 `ast.get_source_segment(node)` —— 它**含 docstring**，于是
       「函数体内出现 X」这条断言，可以被**一句文档字符串满足**。实测踩到：
       v312 把 `default_login_scope_for_role` 的实现从「直读 `ROLE_LOGIN_SCOPE`」
       换成「经 `role_end_for` 派生」之后，D2 那条
       「判据来自 ROLE_LOGIN_SCOPE（未另抄名单）」**仍然 PASS** ——
       唯一原因就是它的 docstring 里写着 `ROLE_LOGIN_SCOPE` 这几个字。
       ⇒ 那是**假绿**：判据来源已经换了，护栏却看不见（本项目最贵的缺陷形态）。
       排除 docstring 之后，「体内出现」= 真的在**代码**里出现。
    """
    src = read(path)
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == funcname:
            body = list(node.body)
            if body and isinstance(body[0], ast.Expr):
                c = body[0].value
                if isinstance(c, ast.Constant) and isinstance(c.value, str):
                    body = body[1:]          # 丢掉 docstring
            seg = '\n'.join(_strip_py_comments(ast.get_source_segment(src, s) or '')
                            for s in body)
            return needle in seg
    return None


def _strip_py_comments(seg):
    """把 Python 片段里的**注释**整段置空（`#` 及其后），保留代码原文逐字不变。

    🔴 v312 第三层订正：`func_body_has` 先排 docstring、再排注释 —— 因为
       `# db.save_role_end(...)` 这样的**注释**同样能满足「体内出现该调用」。
       本项目纪律：**判据只认代码，不认字样**（注释里的"我接好了"不算接线）。
    ⚠️ 实现必须**按 tokenize 给的真实列号截断**，不能把 token 拼回去 —— token 之间
       会插空格，`db.save_role_end(` 会被拼成 `db . save_role_end (` ⇒ 所有断言假红。
    """
    lines = seg.split('\n')
    try:
        for tok in tokenize.generate_tokens(io.StringIO(seg).readline):
            if tok.type == tokenize.COMMENT:
                r, c = tok.start
                if 1 <= r <= len(lines):
                    lines[r - 1] = lines[r - 1][:c]
    except Exception:
        pass                                  # 片段语法不完整也要能用（尽力而为）
    return '\n'.join(lines)


def _strip_js_comments(seg):
    """把 JS 片段里的 `//` 行注释与 `/* */` 块注释去掉（够用即可，不做完整词法分析）。

    ⚠️ `//` 只在其**前面是行首或空白**时才当注释 —— 否则 `http://` 会被截掉。
    """
    if not seg:
        return seg
    seg = re.sub(r"/\*[\s\S]*?\*/", "", seg)
    return '\n'.join(re.sub(r"(^|\s)//.*$", r"\1", ln) for ln in seg.split('\n'))


def _find_func(src, funcname):
    """按名找函数节点（不存在 → `None`）。"""
    try:
        tree = ast.parse(src)
    except Exception:
        return None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == funcname:
            return node
    return None


def _py_def_exists(path, funcname):
    """源码里是否存在 `def funcname(` 的**真定义**（AST；注释里写着不算）。"""
    return _find_func(read(path), funcname) is not None


def _py_call_exists(path, callee):
    """源码里是否存在对 `callee` 的**真调用**（AST；`f(` / `mod.f(` 都算）。"""
    try:
        tree = ast.parse(read(path))
    except Exception:
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if (isinstance(f, ast.Name) and f.id == callee) or \
               (isinstance(f, ast.Attribute) and f.attr == callee):
                return True
    return False


def _py_assign_subscript(path, name, key):
    """源码里是否存在 `name[key] = ...` 的**真赋值**（AST；注释掉的不算）。

    专门为「表必须真的进 `ddl_map`」这条铁律服务：把 `ddl_map["role_end"] = ...`
    注释掉 = 租户库拿不到这张表 = 读永远空且零报错 —— 那种情况下断言**必须**报红，
    所以判据不能是"源码里出现过这几个字"。
    """
    try:
        tree = ast.parse(read(path))
    except Exception:
        return False
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for t in node.targets:
            if not (isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name)
                    and t.value.id == name):
                continue
            sl = t.slice
            if isinstance(sl, ast.Index):          # py<3.9 兼容
                sl = sl.value
            if isinstance(sl, ast.Constant) and sl.value == key:
                return True
    return False


def _py_route_exists(path, http_method, route):
    """源码里是否存在 `@app.<method>("<route>")` 的**真路由装饰器**（AST）。"""
    try:
        tree = ast.parse(read(path))
    except Exception:
        return False
    want = '.' + http_method.lower()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            f = dec.func
            if not (isinstance(f, ast.Attribute) and f.attr.lower() == http_method.lower()):
                continue
            if dec.args and isinstance(dec.args[0], ast.Constant) and dec.args[0].value == route:
                return True
    return False


def _py_dict_literal(path, var):
    """从 Python 源码里取 `var = {...}` 的**字典字面量**（AST，不 import、不执行）。

    🔴 为什么不 `import` 后端模块：那会真的跑起来 `core.py`（连库、读环境变量、起日志），
    而护栏只在乎"这张表写了什么"。`ast.literal_eval` 对非字面量（拼字符串、函数调用）
    一律返回 `None` ⇒ 护栏报红，正好逼着写表的人保持它是纯字面量。
    """
    try:
        src = read(path)
        tree = ast.parse(src)
    except Exception:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == var:
                    try:
                        v = ast.literal_eval(node.value)
                    except Exception:
                        return None
                    return v if isinstance(v, dict) else None
    return None


# ---------------------------------------------------------------- 权威源

def authority():
    """(角色顺序列表, {角色: 模块列表或 None}, 行号) —— 后端 `_DEFAULT_PERMS`。"""
    tree = ast.parse(read(CORE_PY))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if getattr(t, 'id', None) == '_DEFAULT_PERMS' and isinstance(node.value, ast.Dict):
                    roles, mods = [], {}
                    for k, v in zip(node.value.keys, node.value.values):
                        roles.append(k.value)
                        if isinstance(v, ast.List) and all(
                                isinstance(e, ast.Constant) and isinstance(e.value, str) for e in v.elts):
                            mods[k.value] = [e.value for e in v.elts]
                        else:
                            mods[k.value] = None          # 非字面量（少见的自定义格式）→ 不参与模块判定
                    return roles, mods, node.lineno
    raise SystemExit('无法从 %s 解析 _DEFAULT_PERMS' % CORE_PY)


def can_use_miniprogram(modules):
    """能进小程序干活的判据 = 后端模块权限里有 `*` 或 `data`。

    🔴 v300（2026-09-27）**去掉 `chat`** —— 这是**判据本身的订正**，不是"改期望让红灯变绿"：
      · `chat` 自 v292/v293 起**全员持有**（为「副驾代理通道降级」而补，见后端
        `_DEFAULT_PERMS` 的 2026-09-25 注释）⇒ 带上它，8 个角色**全部**被判成"能用小程序"，
        而事实上会计 / 导购 / 司机在业务上并不用小程序 ⇒ 判据**已失去区分度**。
      · 小程序的核心能力是**报单**（`/api/forecast-submissions/*`、`/api/products` → 归 `data`）。
      · 订正后 = admin(*) / boss / sales / staff / supervisor —— 恰好 5 个，与产品定义一致。

    ⚠️ 这不是"放宽"：若某角色**真的丢掉 `data`**（如租户在权限页撤掉「档案管理」），
       订正后的判据会**如实报红**（旧判据因 chat 兜着，反而看不见）。
       判别力自证见 `docs`：把 `_DEFAULT_PERMS['sales']` 的 `data` 删掉拷到临时文件，
       本脚本必须以 `ROLE_REG_CORE=` 报 D 段 FAIL。

    🔴 v333（2026-09-30）再订正一处 —— 这个函数回答的是「**有 `data` 吗**」，而
       D 段过去把它当成了「**能用小程序吗**」。两者在 v333 之前恰好同真同假，现在**不再等价**：
         · `data` 的真实语义 = **能读业务数据**（报单汇总、商品、门店、报单配置）。
           小程序报单只是它的一种消费场景，**不是唯一场景** —— 网页端「预报订货管理」
           整页也吃 `data`（`pages.js` 的 `module:'data'`）。
         · v333 给 `accountant` 加 `data` 是**为了让会计在网页端看订货汇总 / 导出舟谱模板**，
           而会计的登录端仍是 `web`（`ROLE_LOGIN_SCOPE`）⇒ 他**进不了小程序**。
       ⇒ 「有 `data`」不再蕴含「能用小程序」。**蕴含方向只剩单边**：
          能用小程序 ⇒ 必须有 `data`（否则登进去一点报单就 403 —— 那才是真故障）。
          本函数保留原名与实现（它算的本来就是"有 data 吗"），由 D 段按其真实语义使用。
    """
    if modules is None:
        return None
    return ('*' in modules) or ('data' in modules)


# ---------------------------------------------------------------- 各面解析

def _py_literal(path, var):
    """从 Python 源码取 `var = <字面量>`（tuple / list / dict / str；AST，不 import）。

    `_py_dict_literal` 的推广版 —— v312 的 `MINI_MODULES`（元组）与
    `ROLE_END_PROTECTED`（元组）不是字典，需要同一个"只读字面量、绝不执行"的范式。
    """
    try:
        tree = ast.parse(read(path))
    except Exception:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if getattr(t, 'id', None) == var:
                    try:
                        return ast.literal_eval(node.value)
                    except Exception:
                        return None
    return None


def _func_body_seg(src, funcname):
    """函数**代码体**的源码段（排除 docstring 与注释）；函数不存在 → `None`。"""
    node = _find_func(src, funcname)
    if node is None:
        return None
    body = list(node.body)
    if body and isinstance(body[0], ast.Expr):
        c = body[0].value
        if isinstance(c, ast.Constant) and isinstance(c.value, str):
            body = body[1:]
    return '\n'.join(_strip_py_comments(ast.get_source_segment(src, s) or '') for s in body)


def _py_func_str_consts(path, funcname):
    """某 Python 函数**代码体**内出现过的字符串常量集合（AST；排除 docstring）。

    用途 = **取值域对账**：前后端各有一份同义函数（如 `end_to_scope` /
    `endToScope`）时，比"返回值的取值域相等"比逐字比源码更耐重构
    （换 if/elif 顺序、改名局部变量都不会假红），但只要有人往一侧多塞一个取值
    （如只在前端支持 `'app'`），立刻报红。
    """
    seg = _func_body_seg(read(path), funcname)
    if seg is None:
        return None
    return {a or b for a, b in re.findall(r"'([^'\n]*)'|\"([^\"\n]*)\"", seg)}


def _js_func_body(src, funcname):
    """粗取 JS 函数体（`function NAME(...) {` → 行首 `}`），**已去注释**。找不到 → `None`。"""
    m = re.search(r"function\s+%s\s*\([^)]*\)\s*\{(.*?)\n\}" % funcname, src, re.S)
    return _strip_js_comments(m.group(1)) if m else None


def _js_str_consts(seg):
    """JS 片段里的字符串常量集合（单/双引号；不含模板串）。"""
    if not seg:
        return set()
    return {a or b for a, b in re.findall(r"'([^'\n]*)'|\"([^\"\n]*)\"", seg)}


def map_from_js_obj(src, var):
    """从 `const VAR = { k: 'v', ... }` 取 {k: v}（容忍行尾注释）。"""
    m = re.search(r"const\s+%s\s*=\s*\{(.*?)\n\}" % var, src, re.S)
    if not m:
        return None
    return dict(re.findall(r"([a-zA-Z_]+)\s*:\s*'([^']*)'", m.group(1)))


def const_tables():
    """前端唯一来源 constants/roles.js → (ROLE_NAMES, ROLE_VIEW_TOKEN_NAMES)。"""
    src = read(CONST_ROLES)
    return map_from_js_obj(src, 'ROLE_NAMES'), map_from_js_obj(src, 'ROLE_VIEW_TOKEN_NAMES')


def const_role_hints():
    """`ROLE_HINTS`（内置角色一句话职责）—— v328 起上提到 `constants/roles.js`。

    原先它只是 `EmployeeArchive.vue` 里的局部常量，而权限页列头用的是另一套名字
    （"财务 / 文员" vs "会计"）⇒ 同一个角色两个名字。上提后两页共用一份，
    本函数就是护栏读它的唯一入口（别再去 .vue 里正则）。"""
    return map_from_js_obj(read(CONST_ROLES), 'ROLE_HINTS')


def fe_page_modules():
    """`pages.js` → `{模块: [页面标题]}`，**只取挂了 `module` 的行**。

    `module: null` 的行（走角色门槛的页面）**不进本表** —— 那正是 v328 要阐明的区别：
    它们不受模块勾选举影响入口，只受页面内数据影响（记在 `MODULE_IMPACT.feeds`）。"""
    src = read(PAGES_JS) or ''
    out = {}
    for m in re.finditer(
            r"'(/[A-Za-z0-9_/\-]+)':\s*\{\s*title:\s*'([^']+)'[^}]*?module:\s*'([^']+)'", src):
        out.setdefault(m.group(3), []).append(m.group(2))
    return out


def fe_role_options(src):
    """员工档案角色下拉 —— v300 起 label 是**生成式**，所以解析的是它的**输入**。

    返回 `(order, hints, is_dynamic, hardcoded)`：
      · `order`       `BUILTIN_ROLE_ORDER` —— 内置 8 个角色的展示顺序
      · `hints`       `ROLE_HINTS` —— 业务说明（**不许**含「适用端」文字，否则又是手写文案）
      · `is_dynamic`  值域是否真的从后端取（引用了 `/api/role-permissions`）
      · `hardcoded`  是否**仍然是写死的 `ROLE_OPTIONS` 字面量数组**

    🔴 为什么保留 `hardcoded` 这条判据：写死清单**正是 v300 修的缺陷本身**
       （客户在「设置 › 权限」配出来的自定义角色选不到 ⇒ 后端放行、UI 断 ⇒ 死配置）。
       没有这条防回退断言，下一个人会顺手把它改回数组，而其它断言全都还是绿的。
    """
    m = re.search(r"const\s+BUILTIN_ROLE_ORDER\s*=\s*\[([^\]]*)\]", src)
    order = re.findall(r"'([a-z_]+)'", m.group(1)) if m else []
    hints = map_from_js_obj(src, 'ROLE_HINTS') or {}
    is_dynamic = bool(re.search(r"api\(\s*'/api/role-permissions'", src))
    hardcoded = bool(re.search(r"const\s+ROLE_OPTIONS\s*=\s*\[\s*\{", src))
    return order, hints, is_dynamic, hardcoded


def fe_role_css(src):
    return re.findall(r"\.df-role\.r-([a-z_]+)\s*\{", src)


def js_literal_block(src, var):
    """取 `const VAR = { ... }` / `= [ ... ]` 的**字面量内部文本**（按括号配平扫描）。

    ⚠️ 不能用 `.*?\\n[}\\]]` 这类正则收尾：`ENTRY_ROLES = ['a','b']` 写在**一行**里时，
    它会把后面几十行的代码一起吃进来（本轮实测把 `viewMode.value = 'cross'` 的 `'cross'`
    当成了角色名）。按括号深度扫才不会漏。
    """
    m = re.search(r"const\s+%s\s*=\s*([\{\[])" % var, src)
    if not m:
        return None
    open_ch = m.group(1)
    close_ch = '}' if open_ch == '{' else ']'
    depth = 0
    start = m.end() - 1
    for i in range(start, len(src)):
        c = src[i]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return src[start + 1:i]
    return None


def forecast_role_literals(src):
    """Forecast.vue 里「列权限 / 填报白名单」出现的角色字面量是否都在已知词汇内。

    这就是本轮踩到的坑：`dist_price: ['owner','finance']` 两个名字后端都不存在 ⇒
    比对永远为假 ⇒ 一旦真接上登录角色，分销价列对所有真实角色隐藏。
    """
    out = {}
    for var in ('COLUMN_PERMISSIONS', 'ENTRY_ROLES'):
        blk = js_literal_block(src, var)
        if blk is not None:
            out[var] = re.findall(r"'([a-z_]+)'", blk)
    return out


def strip_js_comments(src):
    """抹掉 JS/Vue 源码里的注释（`//`、`/* */`、**以及 `<!-- -->`**），保留字符串字面量。

    🔴 为什么必须剥：本仓的注释**大量引用被禁止的写法本身**，这是刻意的好习惯
       （例：v325 在 `Shell.vue` 写「**不要**在这里直写 `canModule('chat')`」）。
       不剥注释，护栏会把「注释里引用了坏写法」判成「代码里用了坏写法」＝**假红**；
       反过来更要命——注释里出现 `preventDefault()` 会让「顺序」判据读到注释的位置，
       于是**真正颠倒顺序的代码反而测不出来**（假绿）。

    🔴 `.vue` 有**两套**注释语法，只认 JS 那套会漏掉模板注释（本轮实测踩到：
       `Shell.vue` 那句警告写在 `<!-- -->` 里，剥完仍在 ⇒ 依旧假红）。

    判据只许看**行为**，不许看**提及行为**。故本函数是 F3 全部前端判据的前置。
    状态机而非正则：要正确处理字符串里的 `//`、`/*`、以及转义引号。
    """
    out = []
    i, n = 0, len(src)
    quote = ''
    bs = chr(92)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if quote:
            out.append(c)
            if c == bs:
                if nxt:
                    out.append(nxt)
                    i += 2
                    continue
            elif c == quote:
                quote = ''
            i += 1
            continue
        if c in ('"', "'", '`'):
            quote = c
            out.append(c)
            i += 1
            continue
        if src.startswith('<!--', i):
            j = src.find('-->', i + 4)
            i = n if j < 0 else j + 3
            out.append(' ')
            continue
        if c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            out.append(' ')
            continue
        if c == '/' and nxt == '/':
            j = src.find(chr(10), i)
            i = n if j < 0 else j
            continue
        out.append(c)
        i += 1
    return ''.join(out)


# ---------------------------------------------------------------- 主流程

def main():
    auth, modules, lineno = authority()
    auth_set = set(auth)
    emp_src = read(EMPARCHIVE)
    const_names, view_names = const_tables()

    print('权威源：server/core.py::_DEFAULT_PERMS (L%d) = %d 个角色' % (lineno, len(auth)))
    print('        %s' % ', '.join(auth))
    print('')

    # ---- A 员工档案 · 角色下拉 -------------------------------------------------
    # v300（2026-09-27）：下拉从「前端写死 8 项」改为「内置 8 项 + 本租户自定义角色」，
    #   label 也从手写文案改为**生成式**（适用端取自 ROLE_END）。所以本段的判据换成：
    #   ① 值域**真的**接了后端；② 内置顺序覆盖全部后端角色；③ 业务说明键集对齐；
    #   ④ 业务说明里**不许**再出现「适用端」字样（否则又变回"两份手写文案"）。
    print('A 员工档案 · 角色下拉（能开出哪些角色）')
    order, hints, is_dynamic, hardcoded = fe_role_options(emp_src)
    # v328：`ROLE_HINTS` 已上提到 `constants/roles.js`（权限页与档案页共用一份）。
    #   仍先从 .vue 里解析是为了**兼容旧写法**，但拿到共享表就以共享表为准 ——
    #   否则上提之后这里解析不到 ⇒ 判据假红（看着像"档案页丢了说明"）。
    _shared = const_role_hints()
    if _shared:
        hints = _shared
    check('ROLE_HINTS 已上提到 constants/roles.js（两页共用一份名字与职责）', bool(_shared),
          '在 roles.js 里找不到 ROLE_HINTS ⇒ 权限页与档案页又在各写一套')
    check('ROLE_OPTIONS 不再写死角色清单（值域从后端动态取）', not hardcoded,
          '写死 ⇒ 客户在权限页自配的角色在下拉里选不到（后端放行、UI 断 = 死配置）')
    check('下拉值域真的接了后端（引用 /api/role-permissions）', is_dynamic,
          '' if is_dynamic else '找不到 api(\'/api/role-permissions\')')
    check('BUILTIN_ROLE_ORDER 无重复值', len(order) == len(set(order)),
          '重复: %s' % [x for x in set(order) if order.count(x) > 1])
    missing = sorted(auth_set - set(order))
    extra = sorted(set(order) - auth_set)
    check('BUILTIN_ROLE_ORDER 覆盖全部后端角色', not missing, '缺: %s' % missing if missing else '')
    check('BUILTIN_ROLE_ORDER 无后端不存在的角色', not extra, '多: %s' % extra if extra else '')
    _diff = sorted(set(hints) ^ set(order))
    check('ROLE_HINTS 的键集 = BUILTIN_ROLE_ORDER（每个内置角色都有业务说明）', not _diff,
          '差: %s' % _diff if _diff else '')
    _handwritten = [k for k, v in hints.items() if '小程序' in v or '网页端' in v]
    check('ROLE_HINTS 里不写「适用端」（它由 ROLE_END 生成；手写必然漂移）', not _handwritten,
          '这些条目的说明里含适用端字样，说明又退回手写: %s' % _handwritten if _handwritten else '')
    print('')

    # ---- B 前端唯一来源 + 显示名 ----------------------------------------------
    print('B 角色中文名（唯一来源 src/constants/roles.js）')
    check('constants/roles.js 存在且可解析出 ROLE_NAMES', bool(const_names))
    if const_names:
        miss_c = sorted(auth_set - set(const_names))
        check('ROLE_NAMES 的键覆盖全部后端角色', not miss_c,
              '缺: %s（缺条目会静默显示裸英文）' % miss_c if miss_c else '')
        # 🔴 v333：**反向**也要断言。前端多一个后端不存在的角色名，后果不是"多一行显示" ——
        #   `roles.js::isCanonicalRole()` 正是拿 `ROLE_NAMES` 的键当「是不是内置角色」的判据
        #   （权限页「自定义角色」列头、`resetAllRoles()` 的筛选都靠它）⇒ 多出来的名字会被
        #   误判成**内置** ⇒ 真·自建角色不标「自定义角色」，还会被「全部恢复出厂」删掉配置行
        #   （删行 = 该角色没有任何权限 = 派了它的人全员 403）。两集合必须**可证相等**。
        extra_c = sorted(set(const_names) - auth_set)
        check('ROLE_NAMES 无后端不存在的角色（否则 isCanonicalRole 会把自建角色误判成内置）',
              not extra_c, '多: %s' % extra_c if extra_c else '')
        # 反例自证（判别力）：往**真实** ROLE_NAMES 里塞一个后端没有的角色 ⇒ 上面那条必须转红
        _cn_mut = dict(const_names)
        _cn_mut['ghost-role-v333'] = '幽灵角色'
        _extra_mut = sorted(set(_cn_mut) - auth_set)
        check('反例自证：ROLE_NAMES 多一个后端不存在的角色 ⇒ 上面那条必须转红（判据有判别力）',
              bool(_extra_mut), '注入后多出 %d 个' % len(_extra_mut))
        dup_raw = [k for k, v in const_names.items() if v == k]
        check('ROLE_NAMES 无「中文名 = 英文角色名」的空映射', not dup_raw, '可疑: %s' % dup_raw)
        non_cn = [k for k, v in const_names.items() if v and not re.search(r'[\u4e00-\u9fff]', v)]
        check('ROLE_NAMES 的值都是中文', not non_cn, '可疑: %s' % non_cn)
    # 视图令牌（后端不存在的演示词）必须逐个在 EXTRA_OK 里登记 —— 防止它们悄悄变成第二套「角色」
    unreg = sorted(set(view_names or {}) - set(EXTRA_OK))
    check('ROLE_VIEW_TOKEN_NAMES 的每个词都在 EXTRA_OK 里登记', not unreg,
          '未登记: %s' % unreg if unreg else '')
    # 单一来源：这两处**不许**再各留一份表，否则又回到「四份清单」
    check('EmployeeArchive.vue 不再自带 ROLE_HINTS（v328 已上提到 roles.js）',
          not re.search(r"const\s+ROLE_HINTS\s*=", emp_src),
          '页面里又定义了一份 ⇒ 权限页与档案页的职责说明会各说各的')
    check('EmployeeArchive.vue 不再自带 ROLE_NAMES（改为引用共享表）',
          not re.search(r"const\s+ROLE_NAMES\s*=", emp_src),
          '本地重复表会让护栏只看一处、漂移从另一处进来')
    check('EmployeeArchive.vue 引用了共享角色表',
          bool(re.search(r"from\s+'\.[./]*constants/roles'", emp_src)))
    print('')

    # ---- C 角色标签色板 -------------------------------------------------------
    print('C 员工档案 · 角色标签色板')
    css = fe_role_css(emp_src)
    miss_css = sorted(auth_set - set(css))
    check('.df-role.r-* 覆盖全部后端角色', not miss_css,
          '缺: %s（缺则退回基础 teal，与 staff 撞色）' % miss_css if miss_css else '')
    check('色板无重复定义', len(css) == len(set(css)),
          '重复: %s' % [x for x in set(css) if css.count(x) > 1])
    print('')

    # ---- D 「适用端」标注 ↔ 后端模块权限（唯一来源 = roles.js::ROLE_END）--------
    # 🔴 v300 两处订正 —— 别误读成"改期望让红灯变绿"：
    #   ① **判据去掉 `chat`**（见 `can_use_miniprogram` 注释）：那是**判据过时**，
    #      不是文案漏标 —— 旧判据下 8 个角色会被全判成"能用小程序"，红灯指错了地方。
    #   ② **不再从渲染出来的 label 文字里抓「小程序」**：v300 起 label 是**生成式**
    #      （输入 = `ROLE_END`）⇒ 判据必须落在 `ROLE_END` 上；若继续查文案，等于让
    #      "两份手写清单互查"，而这两份已经漂移过一次（本次修的就是它）。
    # 🔴 v333 第三处订正（**方向**：相等 → 单向包含）—— 同上，是判据过时：
    #   两个集合本批首次分叉（`accountant` 有 `data` 却标 `web`，为网页端看订货汇总）
    #   ⇒ 「有 `data`」不再蕴含「能用小程序」。保留的方向 = 标了小程序的必须 **⊆** 有 `data`
    #      的（标了却没 `data` = 登进去一点报单就 403，是真故障）。
    #   判别力双向自证：正例 101/101；反例（删 `guide` 的 `data`）⇒ 100/101 且点名 `['guide']`。
    print('D 「适用端」标注 ↔ 后端模块权限（唯一来源 = roles.js::ROLE_END）')
    const_src = read(CONST_ROLES)
    end_map = map_from_js_obj(const_src, 'ROLE_END') or {}
    end_label_map = map_from_js_obj(const_src, 'ROLE_END_LABEL') or {}
    _miss_end = sorted(auth_set - set(end_map))
    check('ROLE_END 覆盖全部后端角色（缺 = 该角色在下拉里没有适用端标注）', not _miss_end,
          '缺: %s' % _miss_end if _miss_end else '')
    _bad_val = sorted(set(end_map.values()) - set(end_label_map))
    check('ROLE_END 的取值都在 ROLE_END_LABEL 里登记（否则 label 拼出空串）', not _bad_val,
          '未登记: %s' % _bad_val if _bad_val else '')
    labeled_mini = {r for r, v in end_map.items() if v in ('mini', 'both')}
    auth_has_data = {r for r in auth if can_use_miniprogram(modules.get(r))}
    # 🔴 v333（2026-09-30）判据由「集合**相等**」改为「**单向包含**」。
    #   原断言「标了小程序的角色集 == 有 data/* 的角色集」成立于 v300～v332，前提是
    #   "`data` 只被小程序消费"。v333 给 `accountant` 加 `data`（为在**网页端**看订货汇总 /
    #   导出舟谱模板）后该前提**破裂** —— 会计有 `data` 但登录端是 `web`。
    #   ⇒ 保留的那条方向才是真故障：**标了「小程序」却没有 `data`** = 登得进小程序、
    #      一点报单就 403（界面全在、动作全废，本项目最难解释的一类坏）。
    #   反方向（有 `data` 但登录端不是小程序）是**正当状态**，只打印不判红。
    # 🔴 这是**订正判据**，不是"改期望让红灯变绿"：另一条路是把会计的 `data` 撤掉去迁就
    #   一条过时断言 —— 那等于为了护栏绿灯而砍掉老板要的功能。判别力自证见下方那条反例。
    check('标了「小程序」的角色（ROLE_END 的 mini/both）都必须有 data/* 权限'
          '（反之不要求：`data` 也服务于网页端页面）',
          labeled_mini <= auth_has_data,
          '标了小程序却没有 data/*（登进去即 403）: %s' % sorted(labeled_mini - auth_has_data)
          if (labeled_mini - auth_has_data) else '')
    _data_not_mini = sorted(auth_has_data - labeled_mini)
    if _data_not_mini:
        print('        （有 data/* 但登录端不是小程序 —— 正当状态，仅列出：%s）'
              % ', '.join(_data_not_mini))
    # 反例自证（判别力）：构造一个"标了小程序、后端却没有 data"的角色，判据必须**不成立**。
    #   ⚠️ 这里构造的是判据的**输入**（两个集合），验的是"这个方向能不能被抓到"；
    #      真实数据上的判别力另有一层 —— 把 `_DEFAULT_PERMS` 里某角色的 `data` 删掉、
    #      用 `ROLE_REG_CORE=<临时副本>` 重跑本脚本，必须报 D 段 FAIL（v300 起的手工流程）。
    _probe = (set(labeled_mini) | {'ghost_mini'}) <= set(auth_has_data)
    check('反例自证：标了小程序却无 data 的角色会被抓出来（该断言有判别力）',
          not _probe,
          '注入 ghost_mini 后的判据值 = %s（期望 False；为 True 即假绿）' % _probe)
    for r in auth:
        if modules.get(r) is None:
            warn('角色 %s 的权限不是字面量列表，无法判定适用端' % r)
    # 横向交叉校验：「设置 › 权限」的角色标签提了「小程序」时，该角色必须真的能用小程序。
    # 两处文案来源完全不同（员工档案 = 生成式 / 设置页 = 手写），这里就是它们唯一的对账点。
    st_labels_d = map_from_js_obj(read(SETTINGS), 'ROLE_LABELS') if os.path.isfile(SETTINGS) else {}
    _st_bad = sorted(k for k, v in (st_labels_d or {}).items() if '小程序' in v and k not in labeled_mini)
    check('Settings.vue 角色标签里提「小程序」的角色 = ROLE_END 里 mini/both 的角色', not _st_bad,
          '文案说能用小程序、ROLE_END 说不能: %s' % _st_bad if _st_bad else '')
    print('        %s' % '  |  '.join(
        '%s=%s' % (r, end_label_map.get(end_map.get(r, ''), '?')) for r in auth))
    print('')

    # ---- D2 角色 → 默认登录范围（前端 ROLE_END ↔ 后端 core.ROLE_LOGIN_SCOPE）------
    # 🔴 v310 新增：这份映射**天然会被写成两份** —— 前端要拿它做「新建账号时登录端的
    #    默认值」，后端要拿它做「建号没传时的默认值」。两边一旦漂移，症状是
    #    「界面上看着是仅小程序、开出来的号照样能登网页端」（或反之），**且零报错**。
    #    本项目三次栽在"同一规则抄成两份" ⇒ 这里就是那份对账点。
    print('D2 角色 → 默认登录范围（前端 ROLE_END ↔ 后端 core.ROLE_LOGIN_SCOPE）')
    be_scope = _py_dict_literal(CORE_PY, 'ROLE_LOGIN_SCOPE')
    check('core.py 定义了 ROLE_LOGIN_SCOPE（角色 → 默认登录范围，字典字面量）',
          isinstance(be_scope, dict) and bool(be_scope),
          '' if isinstance(be_scope, dict) else '没解析到字典')
    _bad_scope = sorted({k for k, v in (be_scope or {}).items() if v not in ('mini', 'web', 'both')})
    check('ROLE_LOGIN_SCOPE 的取值都是合法端（mini/web/both；拼错 = 该账号永远登不进来）',
          not _bad_scope, '非法: %s' % _bad_scope if _bad_scope else '')
    _miss_scope = sorted(set(end_map) - set(be_scope or {}))
    check('后端 ROLE_LOGIN_SCOPE 覆盖前端 ROLE_END 的全部角色'
          '（缺 = 该角色建号时回落 both，与界面标注不符）',
          not _miss_scope, '缺: %s' % _miss_scope if _miss_scope else '')
    _diff_scope = sorted(k for k in (set(end_map) & set(be_scope or {}))
                         if end_map[k] != be_scope[k])
    check('前端 ROLE_END 与后端 ROLE_LOGIN_SCOPE 逐项一致（默认端不许两份口径）',
          not _diff_scope,
          '; '.join('%s: 前端=%s 后端=%s' % (k, end_map[k], be_scope[k]) for k in _diff_scope))
    # 判据来源：默认值必须由那张表派生，不许在函数里另抄一份 if/elif。
    # 🔴 v312 订正这条断言的**指向**：判据链变成
    #    default_login_scope_for_role → end_to_scope → role_end_for → builtin_role_end
    #    → ROLE_LOGIN_SCOPE（即"内置表仍是唯一源"，但中间插进了"租户覆盖"一层）。
    #    旧断言「函数体内含 ROLE_LOGIN_SCOPE」在 v312 之后**只能靠 docstring 里那行字蒙过**
    #    ⇒ 判据已失效（假绿）。换成逐段接线断言：每一段都必须真的在**代码**里调用。
    check('默认端链路接线完整（default_login_scope_for_role → end_to_scope → role_end_for）',
          func_body_has(CORE_PY, 'default_login_scope_for_role', 'end_to_scope(') is True
          and func_body_has(CORE_PY, 'role_end_for', 'builtin_role_end(') is True,
          '')
    check('default_login_scope_for_role 未再直读 ROLE_LOGIN_SCOPE（否则与端配置成两份口径）',
          func_body_has(CORE_PY, 'default_login_scope_for_role', 'ROLE_LOGIN_SCOPE') is False,
          '')
    check('builtin_role_end 的判据来自 ROLE_LOGIN_SCOPE（内置表仍是唯一源）',
          func_body_has(CORE_PY, 'builtin_role_end', 'ROLE_LOGIN_SCOPE') is True,
          '')
    # 接线：定义了却没人用 = 声明式护栏（本项目的老毛病）
    check('开账号（erp_db.staff_account_create）真的用了角色默认值',
          func_body_has(ERPDB_PY, 'staff_account_create', 'default_login_scope_for_role') is True,
          '')
    check('开账号路由（forecast_submissions.create_staff_account）真的用了角色默认值',
          func_body_has(FS_PY, 'create_staff_account', 'default_login_scope_for_role') is True,
          '')
    print('')

    # ---- D3 角色端配置（v312：内置默认 ⊕ 租户覆盖）唯一源与接线 ----------------
    # 🔴 v312 是对 D/D2 的**结构升级**：v310 之前「角色 → 端」是**代码常量**，任何租户都改不了；
    #    v312 把它改成「内置默认 ⊕ 租户覆盖」，与 `_DEFAULT_PERMS` ⊕ `role_permissions`
    #    **完全同构**。这一层有三个静默失败点，逐条立断言：
    #      ① **只建表/不下发** ⇒ 租户库没这张表 ⇒ 读永远空 ⇒ 界面上配了不生效（零报错）；
    #      ② **前后端各抄一份 `{web,mini} → scope`** ⇒ 界面写「仅小程序」、建号却按「两端」；
    #      ③ **防自锁判据丢失** ⇒ admin/boss 的电脑端被关 ⇒ 改的人进不来、只有他能改回来。
    print('D3 角色端配置（core.role_end_for ↔ 租户 role_end 表 ↔ 两处写入口）')
    _mini_mods = _py_literal(CORE_PY, 'MINI_MODULES')
    check('core.py 定义了 MINI_MODULES（手机端在用的模块，字面量元组）',
          isinstance(_mini_mods, (tuple, list)) and bool(_mini_mods),
          '' if isinstance(_mini_mods, (tuple, list)) else '没解析到字面量元组（改了格式？）')
    _bad_mini = sorted(set(_mini_mods or ()) - set(_py_literal(CORE_PY, '_ALL_MODULES') or ()))
    check('MINI_MODULES 的模块名都在 _ALL_MODULES 里（写错字 = 「手机端」标记永不出现）',
          not _bad_mini, '未登记: %s' % _bad_mini if _bad_mini else '')
    # 与 `can_use_miniprogram` 同源 —— ⚠️ 那个函数是**本护栏脚本自己**的判据
    # （不在 core.py 里，别去后端找），所以这里读的是**本文件**的源码。
    #
    # 🔴 v331（2026-09-29）订正这条断言的**方向**：由「相等」改为「子集」。
    #   两个常量**本来就不是一个概念**，相等只是它们恰好同为一个词时的巧合：
    #     · `core.MINI_MODULES`（产品侧）= **模块级**「手机端」标记 —— 小程序代码
    #       真的调了该模块的接口，只用于权限页那一列的显示（`server.py` 的
    #       `"mini": m in MINI_MODULES`）。
    #     · `can_use_miniprogram`（护栏侧）= **角色级**「这个角色进得去小程序干活吗」，
    #       判据是**报单能力** `data`（报单是小程序的核心，见该函数 docstring）。
    #   v330+ 把 `messages` 补进 `MINI_MODULES`（小程序 v318 起确实在调 `/api/messages`）
    #   ⇒ 两者**必然**不再相等。若为了保住「相等」而把 `messages` 写进本函数判据，
    #   导购 / 司机这类**只在网页端收通知**的角色会被误判成小程序用户，D 段立刻失真
    #   （= 用改判据的方式让红灯变绿，正是本脚本禁止的做法）。
    #   ⇒ 保留的保护是：**护栏不许凭空造词** —— 判据里的每个词都必须真的在产品的
    #     手机端词表里（否则护栏拿一套产品里不存在的模块名去判，D 段就是假绿）。
    _cum = {m for m in (_py_func_str_consts(os.path.abspath(__file__), 'can_use_miniprogram') or set())
            if m != '*'}
    check('can_use_miniprogram 的判据词 ⊆ MINI_MODULES（护栏不许自创产品里没有的模块名）',
          _cum <= set(_mini_mods or ()),
          'MINI_MODULES=%s / 护栏判据=%s / 判据独有=%s'
          % (sorted(_mini_mods or ()), sorted(_cum), sorted(_cum - set(_mini_mods or ()))))
    # 反向的兜底：产品把某个「构成登录判据」的词从手机端词表里摘走时，也要能报出来
    # （否则产品说 data 不是手机端模块、护栏却仍拿它判，两边各自绿灯）。
    check('MINI_MODULES 仍含报单模块 data（摘走 = 权限页「手机端」列与登录判据分叉）',
          'data' in set(_mini_mods or ()),
          '当前 MINI_MODULES=%s' % (sorted(_mini_mods or ()),))
    # 前后端 `{web,mini} → scope` 取值域必须逐项一致（抄成两份 = 界面与建号两条口径）
    _be_sc = _py_func_str_consts(CORE_PY, 'end_to_scope')
    _fe_sc = _js_str_consts(_js_func_body(read(CONST_ROLES), 'endToScope'))
    check('end_to_scope 前后端取值域逐项一致（{web,mini}→scope 不许两份映射）',
          _be_sc == _fe_sc == {'both', 'mini', 'web'},
          '后端=%s 前端=%s' % (sorted(_be_sc or ()), sorted(_fe_sc)))
    # 防自锁红线
    _prot = _py_literal(CORE_PY, 'ROLE_END_PROTECTED') or ()
    check('ROLE_END_PROTECTED 含 admin 与 boss（否则老板能把自己关在电脑端外）',
          {'admin', 'boss'} <= set(_prot), '当前: %s' % (list(_prot),))
    # 读端：租户覆盖必须真的接进 role_end_for，且两端全关时回落内置（不造"登不进任何地方"的角色）
    check('role_end_for 真的先读租户覆盖（role_end_map）再回落内置',
          func_body_has(CORE_PY, 'role_end_for', 'role_end_map(') is True
          and func_body_has(CORE_PY, 'role_end_for', 'builtin_role_end(') is True,
          '')
    check('role_end_is_custom 的判据 = 覆盖表里有该行（同值即删行 ⇒ 不会误判）',
          func_body_has(CORE_PY, 'role_end_is_custom', 'role_end_map(') is True, '')
    # 租户库下发三处缺一不可（本项目铁律：只 `_safe_migrate` = 主库有表、租户库没有 ⇒ 恒空零报错）
    check('erp_db 定义了 role_end 的读（真定义，非注释里的字样）',
          _py_def_exists(ERPDB_PY, 'get_all_role_end'), '')
    check('erp_db 定义了 role_end 的写（save_role_end / delete_role_end，真定义）',
          _py_def_exists(ERPDB_PY, 'save_role_end')
          and _py_def_exists(ERPDB_PY, 'delete_role_end'), '')
    check('role_end 表进了 ddl_map（**真赋值**；注释掉那一行 = 租户库无表 ⇒ 恒空且零报错）',
          _py_assign_subscript(ERPDB_PY, 'ddl_map', 'role_end'), '')
    # 写入口接线（路由用真装饰器判、取值用真调用判 —— 都不认注释与文档字符串）
    check('server.py 有 POST /api/role-permissions/end（真路由）',
          _py_route_exists(SERVER_PY, 'post', '/api/role-permissions/end'), '')
    check('server.py 有 DELETE /api/role-permissions/end/{role_name}（真路由）',
          _py_route_exists(SERVER_PY, 'delete', '/api/role-permissions/end/{role_name}'), '')
    # ⚠️ 认的是**公开取值口** `role_end_for`，不是底层的 `role_end_map` ——
    #    读端只该问"这个角色实际能用哪些端"，`role_end_map` 是"租户覆盖表原文"，
    #    直接读它会漏掉"没配过 ⇒ 回落内置默认"那一半（正是 v312 最容易写错的地方）。
    check('GET /api/role-permissions 按角色取了实际端配置（真调用 role_end_for）',
          _py_call_exists(SERVER_PY, 'role_end_for'), '')
    check('POST /api/role-permissions/end 真的落库（db.save_role_end）',
          func_body_has(SERVER_PY, 'save_role_end', 'db.save_role_end(') is True, '')
    check('DELETE /api/role-permissions/end 真的删行（db.delete_role_end）',
          func_body_has(SERVER_PY, 'reset_role_end', 'db.delete_role_end(') is True, '')
    check('两处写入口都让本租户缓存失效（reload_role_end；不失效 = 改了不生效）',
          func_body_has(SERVER_PY, 'save_role_end', 'reload_role_end(') is True
          and func_body_has(SERVER_PY, 'reset_role_end', 'reload_role_end(') is True, '')
    check('保存端点对「两端都不勾」硬拒（400；否则造出登不进任何一端的角色）',
          func_body_has(SERVER_PY, 'save_role_end', 'not web and not mini') is True, '')
    check('保存端点对 ROLE_END_PROTECTED 的电脑端硬拒（400；防把老板锁在门外）',
          func_body_has(SERVER_PY, 'save_role_end', 'ROLE_END_PROTECTED') is True, '')
    # 前端：路径必须与后端逐字一致（抄错 = 点保存静默失败）。
    #  ⚠️ 必须落在**真调用** `api('<路径>'` 上 —— 只写在注释里的路径不算。
    _st_src = read(SETTINGS)
    check('Settings.vue 提交端的路径与后端逐字一致（真调用 api(...)）',
          bool(re.search(r"""api\(\s*'/api/role-permissions/end'""", _st_src)), '')
    check('Settings.vue 恢复默认的路径与后端逐字一致（真调用 api(...)）',
          bool(re.search(r"""api\(\s*'/api/role-permissions/end/'\s*\+""", _st_src)), '')
    check('Settings.vue 编辑端时有前端侧把关（toggleEnd；后端 400 只是第二道）',
          _js_func_body(_st_src, 'toggleEnd') is not None, '')
    print('')

    # ---- E 其它面的清单（本轮由「只告警」升级为硬断言） ------------------------
    print('E 其它面的角色清单')
    # E1 Forecast.vue：不许自带表；角色字面量必须在已知词汇内
    fore = read(FORECAST) if os.path.isfile(FORECAST) else ''
    check('Forecast.vue 不再自带 ROLE_LABELS（改为引用共享表）',
          not re.search(r"const\s+ROLE_LABELS\s*=", fore))
    check('Forecast.vue 引用了共享角色表',
          bool(re.search(r"from\s+'\.[./]*constants/roles'", fore)))
    lits = forecast_role_literals(fore)
    for var, vals in lits.items():
        # ⚠️ 这两张表**必须用规范角色名**，不许用视图令牌：它们都是「拿 bizRole 去 includes」的
        #    策略表，而 bizRole 里装的是登录角色（后端规范名）。历史 bug 正是这里写成了
        #    `['owner','finance']` —— 两个名字后端都不存在 ⇒ 比对永远为假 ⇒
        #    一旦真接上登录角色，分销价列会对所有真实角色（含老板）隐藏。
        bad = sorted(set(vals) - auth_set)
        check('%s 里的角色名都是**规范角色名**' % var, not bad,
              '不是后端角色的名字: %s（比对永远为假）' % bad if bad else '')
    if not lits:
        warn('Forecast.vue 未解析到 COLUMN_PERMISSIONS / ENTRY_ROLES')
    # E2 小程序 roles.js
    mp = read(MP_ROLES) if os.path.isfile(MP_ROLES) else ''
    mp_text = map_from_js_obj(mp, 'ROLE_TEXT') or {}
    miss_mp = sorted(auth_set - set(mp_text))
    check('小程序 ROLE_TEXT 覆盖全部后端角色', not miss_mp,
          '缺: %s（这些人在「我的」页显示裸英文）' % miss_mp if miss_mp else '')
    extra_mp = sorted(set(mp_text) - auth_set)
    bad_extra = [x for x in extra_mp if x not in EXTRA_OK]
    check('小程序 ROLE_TEXT 无未登记的多余角色', not bad_extra,
          '未登记: %s' % bad_extra if bad_extra else '')
    if extra_mp:
        print('        （已登记的非后端角色：%s）' % ', '.join(
            '%s=%s' % (x, EXTRA_OK.get(x, '未登记')) for x in extra_mp))
    check('小程序 roleText 不回落成原值（静默失败载体）',
          not re.search(r"ROLE_TEXT\[role\]\s*\|\|\s*role\b", mp),
          '应回落到显式标记（如 `未知角色( x )`）')
    # E3 跨面同名（短名 register：共享表 vs 小程序）
    if const_names and mp_text:
        diff = {r: (const_names.get(r), mp_text.get(r)) for r in auth
                if r in mp_text and const_names.get(r) != mp_text.get(r)}
        check('同一角色在网页端与小程序译名逐字一致', not diff,
              '；'.join('%s: 网页=%s 小程序=%s' % (r, a, b) for r, (a, b) in diff.items()))
    # E4 Settings.vue（权限矩阵，措辞更长 → 只查覆盖性与「不是英文」）
    st = read(SETTINGS) if os.path.isfile(SETTINGS) else ''
    st_map = re.search(r"const ROLE_LABELS\s*=\s*\{(.*?)\n\}", st, re.S)
    st_labels = dict(re.findall(r"([a-z_]+)\s*:\s*'([^']*)'", st_map.group(1))) if st_map else {}
    miss_st = sorted(auth_set - set(st_labels))
    check('Settings.vue ROLE_LABELS 覆盖全部后端角色', not miss_st,
          '缺: %s' % miss_st if miss_st else '')
    raw_st = [k for k, v in st_labels.items() if v == k]
    check('Settings.vue ROLE_LABELS 无空映射', not raw_st, '可疑: %s' % raw_st)
    print('')

    # ---- F 后端白名单与接线 ---------------------------------------------------
    print('F 后端 · 角色白名单与两处写入口接线')
    core = read(CORE_PY)
    check('core.py 定义了 normalize_role（白名单判据唯一来源）',
          bool(re.search(r"def\s+normalize_role\s*\(", core)))
    # v205 起读端由「进程级全局 ROLE_PERMS」改为「**按租户** perms_for(tid)」⇒
    # 判据必须两者皆可，否则脚本会对**正确实现**误报。
    # 2026-09-24 实测：旧判据下 27/28 FAIL，但 core.py 的实现完全正确（候选 ≠ 缺陷）。
    # 保留原意：known_roles 必须**派生自权威源**，不得另抄一份硬编码角色名单。
    # 🔴 v300（2026-09-27）：本段"函数体内找 token"的判据**全部改用 AST 结构判据**
    #    （`func_body_has`）。原来用 `[\s\S]{0,900}?` 这类**字符窗口** —— 函数头附近
    #    一插长注释就**假红**（v289 给 `create_staff_account` 加注释后即命中：
    #    白名单明明接了，护栏却说没接）。同族风险一次改完。
    #    第三态（`None` = 函数名都找不到）单独报 —— 否则"函数被改名"会被误述成"没接线"。
    def _wired(path, fn, token, note=''):
        """→ (ok, detail)。detail **只在失败时非空**（`check()` 的 detail 是无条件打印的）。"""
        v = func_body_has(path, fn, token)
        if v is True:
            return True, ''
        if v is False:
            return False, '函数 %s 体内找不到 %s%s' % (fn, token, ('（' + note + '）') if note else '')
        return False, '找不到函数 %s（判据要跟着改名）' % fn

    _kr_a = func_body_has(CORE_PY, 'known_roles', '_DEFAULT_PERMS')
    _kr_b = func_body_has(CORE_PY, 'known_roles', 'perms_for')
    _kr_ok = (_kr_a is True and _kr_b is True)
    check('normalize_role 以权威源（_DEFAULT_PERMS + 按租户表）为判据（未另抄名单）', _kr_ok,
          '' if _kr_ok else 'known_roles 体内 _DEFAULT_PERMS=%s / perms_for=%s（None = 函数不存在）'
                            % (_kr_a, _kr_b))
    fs = read(FS_PY)
    # ⚠️ needle 一律带 `(`（= 必须真的是**调用**）：若只写函数名，
    #    `normalize_role_DISABLED(...)` 这类改名后的调用**仍含子串** `normalize_role`
    #    ⇒ 判据假绿。这不是假设 —— v300 判别力自证的反例 ③ 就是这么把它抓出来的。
    _ok, _d = _wired(SERVER_PY, 'update_user_role', 'normalize_role(',
                     '只校验非空 ⇒ 任何 admin/boss 都能造出新 admin')
    check('PUT /api/users/{uid}/role 接入了白名单', _ok, _d)
    _ok, _d = _wired(FS_PY, 'create_staff_account', 'normalize_role(')
    check('开账号接口（staff-accounts）接入了白名单', _ok, _d)
    _ok, _d = _wired(ERPDB_PY, 'staff_account_create', 'normalize_role(')
    check('staff_account_create（INSERT 旁）也有第二道白名单', _ok, _d)
    print('')

    # ---- F2 报单汇总可见角色白名单（v267）-------------------------------------
    # 为什么单列一面：这条白名单**不在模块权限矩阵里**（`/api/forecast-submissions` 整体归 `data`，
    # 业务员持有）⇒ 它是**唯一**决定「业务员能不能看全公司汇总」的东西，且两端各有一份。
    # 漂移的后果是不对称的、且都是**静默**的：
    #   · 后端放宽 / 前端没跟上 ⇒ 前端仍然隐藏入口 = 功能做了但没人看得见；
    #   · 后端收紧 / 前端没跟上 ⇒ 入口可见、点进去 403 = 「假入口」（用户 2026-09-20 刚为会计修过一次）。
    # 另一半判据（接线）同样重要：改了常量却没接到判据/调用点上 = 白改且看不出来。
    print('F2 报单汇总可见角色白名单（后端 SUMMARY_ROLES ↔ 前端 FORECAST_SUMMARY_ROLES）')
    m_be = re.search(r"^SUMMARY_ROLES\s*=\s*\(([^)]*)\)", fs, re.M)
    be = [s.strip().strip('"\'') for s in (m_be.group(1).split(',') if m_be else []) if s.strip()]
    check('后端 SUMMARY_ROLES 是**模块级常量**（内联在函数体内护栏看不见 ⇒ 等于没护栏）',
          bool(m_be), '' if m_be else '未在 forecast_submissions.py 顶层找到 SUMMARY_ROLES')
    const_src = read(CONST_ROLES)
    m_fe = re.search(r"FORECAST_SUMMARY_ROLES\s*=\s*\[([^\]]*)\]", const_src)
    fe = [s.strip().strip('"\'') for s in (m_fe.group(1).split(',') if m_fe else []) if s.strip()]
    check('前端定义了 FORECAST_SUMMARY_ROLES（roles.js）', bool(m_fe))
    check('两侧白名单逐项一致（排序后）', sorted(be) == sorted(fe),
          '后端=%s 前端=%s' % (be, fe))
    check('SUMMARY_ROLES 非空（空 = 全员看不到汇总 = 静默失效）', bool(be))
    bad_role = sorted(set(be) - auth_set)
    check('SUMMARY_ROLES 不含后端不存在的角色（写错字 = 那个角色被静默放行）',
          not bad_role, '可疑: %s' % bad_role if bad_role else '')
    # v300：同上改 AST 判据（原 `[\s\S]{0,1400}?` 同样是字符窗口，同族风险）。
    _ss_uses = func_body_has(FS_PY, 'submission_summary', 'not in SUMMARY_ROLES')
    _ss_inline = func_body_has(FS_PY, 'submission_summary', 'not in ("admin"')
    _ss_ok = (_ss_uses is True) and not _ss_inline
    check('submission_summary 真的用 SUMMARY_ROLES 判据（未留内联副本）', _ss_ok,
          '' if _ss_ok else ('找不到函数 submission_summary' if _ss_uses is None
                             else ('函数体内没引用 SUMMARY_ROLES' if not _ss_uses
                                   else '函数体内仍留了内联角色副本')))
    sh_src = read(SHELL_VUE) if os.path.isfile(SHELL_VUE) else ''
    # 🔴 2026-09-27（v291/v292）订正：原断言数的是「`canViewForecastSummary(` 出现 ≥ 3 次」，
    #    而 v291 已经把「谁看得见预报页」的判据**收敛进页面注册表**
    #    （`Shell.vue` 改成 `canSee('/forecast')` ⇒ `constants/pages.js` 的 `/forecast` 行，
    #     那一行的 `roles` 仍是 `FORECAST_SUMMARY_ROLES`）⇒ 原断言**永久变红**。
    #    ⚠️ 一条永远红的断言比没有断言更糟：它会训练所有人忽略红色输出（本项目已因此栽过——
    #    "看起来像历史遗留的红"正是漏检的温床）。故改成断言**真正的契约**：
    #      ① 带门禁的 /forecast 入口 ≥ 2（桌面侧栏 `.sb-item` + 手机底栏 `.mnav-item`）；
    #      ② **不存在**裸入口（`<router-link to="/forecast"` 前面不带 `v-if`）
    #         —— 那正是"入口对全员可见、点进去被 403"的假入口。
    #    两种门禁写法都接受（注册表式 / 旧的专用函数式），这样无论判据收敛到哪一层都测得准。
    # 🔴 2026-09-28（v311）**第二次订正**：v311 把桌面侧栏改成**表驱动**
    #    （`NAV` 一张表 + `navGroups`/`drawerGroups` 统一过 `canSee(it.path)`），于是
    #    "数 `canSee('/forecast')` 出现次数"的判据**又**假红了 —— 与 v291 那次同因：
    #    **判据绑在"写法"上，写法一重构就失去判别力**。
    #    本次改成按**形态**认门禁，并补一条旧判据**看不见**的洞：
    #      表驱动时 `/forecast` 只是表里一行**普通对象**，长得不像 `<router-link>`，
    #      旧正则的 `_naked` 完全抓不到它 ⇒ 若那张表**没有**过 `canSee`，
    #      "对全员可见、点进去 403"的假入口会**静默通过**。
    #      ⇒ 所以"表里有 /forecast"必须**同时**证明"表真的被 canSee 过滤"。
    # 🔴 2026-09-29（v325）**第三次订正**：v311b 把**三处导航**（桌面侧栏 `navGroups` /
    #    手机底栏 `mnavItems` / 抽屉 `drawerGroups`）**全部**改成「读同一张 `NAV` 表 +
    #    各自 `canSee(it.path)` 过滤」，于是 v311 写的「带门禁的 /forecast 入口 ≥ 2 处」
    #    **又**假红了：真实结构是 **1 行表数据 → 3 个渲染面**，而判据数的是**字面出现次数**。
    #    ⚠️ 与 v291 / v311 **同因**（判据绑"写法"，写法一重构就失去判别力）；更糟的是这条
    #    自 v311 起**红了一整天**，正是"永远红的断言会训练所有人忽略红色输出"的活样本。
    #    ⇒ 本次改成**按渲染面（surface）去数**，且判据自带反例自证：
    #      ① 字面入口：`<router-link to="/forecast">` 必须**自带** `v-if` 门禁；
    #      ② 表驱动入口：模板里每个 `v-for="x in <list>"` 的 `<list>`，只要它**真的**
    #         在派生处 `.filter(...canSee(...)` 过，就算 **1 个受门禁的渲染面**
    #         —— **行数是数据，面数才是暴露面**。
    #      ③ 只有在表里**确实有** /forecast 时，②的面数才计入（否则表被删了还虚增）。
    #    反例自证（本判据必须能转红）：把 `navGroups` 的 `canSee` 注入删掉 ⇒ 面数掉到 2。
    _lit_links = re.findall(r"""<router-link[^>]*?to="/forecast"[^>]*?>""", sh_src)
    _lit_gated = [t for t in _lit_links
                  if re.search(r"""v-if="[^"]*(?:canSee\('/forecast'\)|canViewForecastSummary\()""", t)]
    _naked = len(_lit_links) - len(_lit_gated)
    _nav_rows = re.findall(r"""\{\s*path:\s*'/forecast'""", sh_src)
    _nav_filtered = bool(re.search(r"canSee\(\s*[a-z]+\.path\s*\)", sh_src))
    _render_lists = sorted(set(re.findall(r"""v-for="\s*\w+\s+in\s+(\w+)\s*\"""", sh_src)))

    def _def_body(src, name, cap=900):
        """取 `const <name> = ...` 的**函数体切片**，切到下一条顶层声明为止。

        🔴 为什么不能直接用「`<name>` 之后 N 字内的 `canSee`」：那就是本判据前两版的
           病根 —— 窗口会**跨出定义边界**，串到下一个 computed 的 `canSee` 上，
           于是"抹掉某个面的门禁"也测不出来（反例自证当场红给看）。按边界切才测得准。
        """
        m = re.search(r"""(?:const|let|var)\s+""" + re.escape(name) + r"""\s*=""", src)
        if not m:
            return ''
        body = src[m.end():m.end() + cap]
        cut = re.search(r"""\n(?=(?:const|let|var|function|import|export|/\*)\s)""", body)
        return body[:cut.start()] if cut else body

    def _gated_of(src):
        return [n for n in _render_lists
                if re.search(r"""\.filter\([\s\S]{0,120}?canSee\(""", _def_body(src, n))]

    _gated_surfaces = _gated_of(sh_src)
    _tbl_gated = len(_gated_surfaces) if _nav_rows else 0
    _total_gated = len(_lit_gated) + _tbl_gated
    check('Shell.vue 每个 /forecast 入口都带门禁（≥2 个渲染面，且无裸入口）',
          _total_gated >= 2 and _naked == 0,
          '字面门禁 %d 面 / 表驱动门禁 %d 面%s / 裸入口 %d 处'
          % (len(_lit_gated), _tbl_gated,
             ('（' + '、'.join(_gated_surfaces) + '）') if _gated_surfaces else '', _naked))
    check('Shell.vue 导航表里的 /forecast 条目真的过了 canSee（表里有序、不过滤 = 假入口）',
          (not _nav_rows) or _nav_filtered or bool(_gated_surfaces), '')
    # 反例自证：证明上面这条判据**真的会红**（不是恒绿的空转断言）
    _probe = sorted(_render_lists)[0] if _render_lists else ''
    _mut = sh_src.replace('items.filter(it => canSee(it.path))',
                          'items.filter(it => true)', 1) if _probe else sh_src
    check('反例自证：抹掉一个渲染面的 canSee ⇒ 面数必须掉下来（判据有判别力）',
          bool(_probe) and _mut != sh_src and len(_gated_of(_mut)) < _tbl_gated,
          '原 %d 面 → 抹掉后 %d 面' % (_tbl_gated, len(_gated_of(_mut))))
    fore_src = read(FORECAST)
    check('Forecast.vue 两条路都接了（summaryDenied 按角色预判 + crossDenied 服务端拒绝）',
          'summaryDenied' in fore_src and 'crossDenied' in fore_src)
    check('Forecast.vue 按**状态码**分流 403（不再把「无权限」说成「加载失败」）',
          bool(re.search(r"e\.status[\s\S]{0,80}?===\s*403", fore_src)))
    # ---- F3 AI 能力闸（v325，2026-09-29）----------------------------------------
    # 需求原话：「使用 AI 会消耗积分有成本，大部分老板不会开放 AI 给员工，
    #   请默认只给管理员和老板配置 AI 权限，其他角色**预留权限配置入口**，
    #   让用户**自由选择**是否配置 AI」
    # ⇒ 四件事各要一条判据，缺一条就会出现"改了默认但用户勾不到"或"勾了但没封住"：
    #   ① 出厂默认只 admin/boss；② `chat` 仍在权限矩阵里（否则老板勾不到）；
    #   ③ 撤权限 = **真封锁**（后端 AI 路由全归 `chat`）；④ 成本要在**勾之前**可见。
    # 🔴 为什么必须进护栏：撤/加默认值是"一行改动、影响全部租户"的操作，且**没有报错**——
    #   把 `chat` 加回全员，界面上一切正常，只有账单会知道。这类"静默花钱"的回归
    #   只能靠断言挡，靠人眼看不出来。
    print('')
    print('F3 AI 能力闸（`chat` 模块）—— 默认只给 admin / boss，其余角色"预留入口"')
    # 先给 load-bearing 助手自证 —— 它错了，本段下面所有前端读数都不可信。
    # 合成输入同时覆盖三种注释与一个"含 // 的字符串"，正反两面都查。
    sy_in = ('const a = ' + chr(39) + 'http://x' + chr(39) + ' // t' + chr(10)
             + "const b = 1 /* canModule('chat') */" + chr(10)
             + '<!-- canUseAi -->' + chr(10) + 'const c = 2')
    sy_out = strip_js_comments(sy_in)
    check('strip_js_comments 自证：剥掉三种注释 / 保留含 `//` 的字符串（load-bearing 助手）',
          "canModule('chat')" not in sy_out and 'canUseAi' not in sy_out
          and 'http://x' in sy_out and 'const c = 2' in sy_out,
          repr(sy_out.replace(chr(10), ' ')))
    server_src = read(SERVER_PY)
    all_mods = _py_literal(CORE_PY, '_ALL_MODULES') or ()
    check('`chat` 仍在 _ALL_MODULES 里（=「其他角色预留权限配置入口」的实现基础）',
          'chat' in all_mods,
          '不在 ⇒ 权限页勾不到它 ⇒ 老板无法给任何人开 AI，需求落空')
    # 🔴 `admin` 走的是 legacy 通配格式 `["*"]`，**不是**列出模块名。只判字面成员
    #    会把 admin 漏掉、得出「默认只有 boss 有 AI」的错读数（本轮实测踩到）。
    #    通配 = 持有全部模块 ⇒ 判据必须展开它。
    def _holds(mods, m):
        mods = mods or ()
        return m in mods or '*' in mods
    chat_holders = sorted(r for r in auth if _holds(modules.get(r), 'chat'))
    check('出厂默认持 AI 的角色 == admin / boss（消费积分有成本 ⇒ 不默认开放给员工）',
          chat_holders == ['admin', 'boss'],
          '实际: %s（admin 经 `["*"]` 通配持有）' % chat_holders)
    check('反例自证：把 `chat` 加回任一业务角色 ⇒ 上面那条判据必须转红（有判别力）',
          chat_holders != sorted(set(chat_holders) | {'sales'}),
          '原 %s → 加回 sales 后 %s' % (chat_holders, sorted(set(chat_holders) | {'sales'})))
    nl = chr(10)
    map_seg = server_src.split('_PATH_MODULE_MAP = {', 1)[-1].split(nl + '}', 1)[0]
    # 🔴 一行可以登记**多个**前缀（`"/api/chat": "chat", "/api/ai": "chat", "/api/correct": "chat",`）
    #    ⇒ 必须按**键值对**解析。早先按"引号位置切"（取每行最后一个引号串当模块名）
    #    会把**中间的模块名** `chat` 也当成前缀，得出 6 条（含一条假的裸 `chat`）——
    #    看着"更全"，实则是把值当键的读错（本轮实测踩到）。
    map_pairs = re.findall(r'"([^"]*)"\s*:\s*"([^"]*)"',
                           nl.join(ln.split('#', 1)[0] for ln in map_seg.split(nl)))
    chat_prefixes = sorted({k for k, v in map_pairs if v == 'chat'})
    need_ai = ['/api/ai', '/api/chat', '/api/correct']
    miss_ai = [x for x in need_ai if x not in chat_prefixes]
    check('后端 AI 路由全部归 `chat`（⇒ 撤权限是**真封锁**，不是「撤了还能直连」）',
          not miss_ai,
          ('缺: %s' % miss_ai) if miss_ai else
          '共 %d 条: %s' % (len(chat_prefixes), ', '.join(chat_prefixes)))
    lbl_i = server_src.find('"chat":"')
    chat_label = server_src[lbl_i + len('"chat":"'):].split('"', 1)[0] if lbl_i > 0 else ''
    check('权限页里 `chat` 的显示名带**成本提示**（老板得在勾之前就看见「消耗积分」）',
          '积分' in chat_label,
          '显示名 = %r（退回纯「AI对话」= 成本在勾之前不可见）' % chat_label)
    store_src = read(STORE_JS)
    check('前端有 `canUseAi()` 这**一个**判据函数（不是 5 处各写一份 canModule）',
          'function canUseAi()' in store_src, '')
    # 🔴 判"有没有导出"不能绑语法形式：本仓 store 不是 `export const` 逐个导出，而是
    #    工厂 `return { ... }` 一个对象（`canUseAi` 在返回对象里 = 已导出）。
    #    绑形式的判据会在"确实导出了、只是换了写法"时假红（本轮实测踩到）。
    exp_ok = any(('canUseAi' in ln and 'canModule' in ln and 'loadPerms' in ln)
                 or (ln.strip().startswith('export') and 'canUseAi' in ln)
                 for ln in store_src.splitlines())
    check('`canUseAi` 真的被导出了（定义了没导出 = 各处照样各写一份）', exp_ok,
          '须出现在 store 的公开 API 上（工厂 return 对象 / export 均可）')
    # 🔴 前端判据一律在**剥掉注释**的源码上做：本仓注释刻意写了"不要这样写"的反例，
    #    不剥就会把文档当成违规（本轮实测踩到 → 假红）。
    ai_hits = {}
    for root, dirs, files in os.walk(FE_SRC):
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'dist', '__pycache__')]
        for fn in files:
            if not fn.endswith(('.vue', '.js')):
                continue
            fp = os.path.join(root, fn)
            code = strip_js_comments(read(fp))
            if "canModule('chat')" in code or 'canUseAi' in code:
                ai_hits[os.path.relpath(fp, FE_SRC)] = (code.count("canModule('chat')"),
                                                        code.count('canUseAi'))
    store_rel = os.path.join('store', 'index.js')
    dup_files = sorted(k for k, v in ai_hits.items() if v[0] > 0 and k != store_rel)
    check("除 store 外无任何前端文件直写 `canModule('chat')`（判据唯一，防抄多份）",
          not dup_files, '散落: %s' % dup_files)
    users = sorted(k for k, v in ai_hits.items() if v[1] > 0)
    check('≥4 个文件在用 `canUseAi`（store + Shell + Workbench + Forecast，少一个即漏网入口）',
          len(users) >= 4, '用到: %s' % users)
    # 🔴 顺序判据必须看**剥注释后**的代码：本仓注释里就写着「`preventDefault()` 必须在判据**之后**」，
    #    按原样取位置会把注释的位置当代码位置 ⇒ **真颠倒顺序也测不出来**（假绿）。
    sh_code = strip_js_comments(sh_src)
    kd_i = sh_code.find('function onKeydown(')
    kd = sh_code[kd_i:kd_i + 700] if kd_i > 0 else ''
    kd_ok = ('canUseAi' in kd and 'preventDefault' in kd
             and kd.find('canUseAi') < kd.find('preventDefault'))
    check('⌘K 的权限判据在 preventDefault() **之前**（否则无 AI 角色按键被吃掉、毫无反应）',
          kd_ok,
          'canUseAi@%d / preventDefault@%d' % (kd.find('canUseAi'), kd.find('preventDefault')))
    kd_mut = kd.replace('!store.canUseAi()', 'true', 1) if kd_ok else kd
    check('反例自证：抹掉 onKeydown 里的 canUseAi ⇒ 上面那条必须转红',
          kd_ok and not ('canUseAi' in kd_mut
                         and kd_mut.find('canUseAi') < kd_mut.find('preventDefault')),
          '抹掉后窗口内 canUseAi 出现 %d 次' % kd_mut.count('canUseAi'))
    cp_src = read(CMDPAL)
    check('命令面板的「问 AI 副驾」条目带 `module: \'chat\'`（否则面板成为漏网入口）',
          "module: 'chat'" in cp_src, '')
    print('')

    # ---- G v328「权限项 ↔ 它真正影响的功能」一致性 ------------------------------
    # 由来（v328 审计）：权限页长期存在两类"名不副实"
    #   ① **幽灵**：有勾选框、但 0 条接口映射（marketing / settings）⇒ 勾了不生效；
    #   ② **隐形遗产**：角色持有、却没登记进 `_ALL_MODULES`（ops-workbench / perf / goals）
    #      ⇒ 老板看不见也改不了。两者都违反"权限名与它真正对应的功能一致"。
    # ③ 还有"许诺差距"：勾了模块但页面入口没变化 —— 由 `MODULE_IMPACT` 在界面上说明，
    #    本段只保证那份说明**不漂移**（与 pages.js 逐项比对）。
    print('G 权限项 ↔ 它真正影响的功能（v328 · 幽灵模块 / 隐形遗产 / 影响面标注）')
    all_mods = _py_literal(CORE_PY, '_ALL_MODULES') or []
    defperm = _py_literal(CORE_PY, '_DEFAULT_PERMS') or {}
    impact = _py_literal(CORE_PY, 'MODULE_IMPACT') or {}
    check('core.py 解析得出 _ALL_MODULES / _DEFAULT_PERMS', bool(all_mods) and bool(defperm),
          '_ALL_MODULES=%d 项 / _DEFAULT_PERMS=%d 个角色' % (len(all_mods), len(defperm)))
    check('core.py 定义了 MODULE_IMPACT（「勾了会怎样」的唯一源）', bool(impact),
          '缺 ⇒ 权限页只能空口许诺' if not impact else '%d 个模块' % len(impact))
    GHOST = ('marketing', 'settings', 'ops-workbench', 'perf')
    still = [g for g in GHOST if g in all_mods]
    check('被摘掉的幽灵模块没有复活（%s）' % ' / '.join(GHOST), not still,
          '仍在 _ALL_MODULES: %s（有勾选框但 0 条接口映射 = 勾了不生效）' % still)
    holders = sorted(r for r, v in defperm.items()
                     if isinstance(v, list) and any(g in v for g in GHOST))
    check('没有角色再持有幽灵模块（_DEFAULT_PERMS）', not holders,
          '持有: %s（持有却无功能 = 权限名与功能不一致）' % holders)
    # 🔴 双向判据：有接口映射 ⇒ 必须可配（防隐形遗产）；可配 ⇒ 必须有接口映射（防假配置）
    pmap = _py_literal(SERVER_PY, '_PATH_MODULE_MAP') or {}
    mapped = set(pmap.values())
    invisible = sorted(mapped - set(all_mods))
    check('凡有接口映射的模块都能在权限页里配到（防"持有却看不见"的隐形遗产）', not invisible,
          '不可配: %s（典型形态：它出现在某角色的默认权限里，但界面上找不到）' % invisible)
    fake = sorted(set(all_mods) - mapped)
    check('凡是能勾的模块都有接口映射（防"勾了不生效"的假配置）', not fake,
          '无映射: %s（勾与不勾完全等价）' % fake)
    # 说明不漂移：`entries` 必须与 pages.js 里挂了 module 的页面逐项一致
    pg = fe_page_modules()

    def _entry_mismatch(page_map):
        out = []
        for m, v in (impact or {}).items():
            e = sorted((v or {}).get('entries', []))
            p = sorted(page_map.get(m, []))
            if e != p:
                out.append('%s: 表=%s pages.js=%s' % (m, e, p))
        return out

    mism = _entry_mismatch(pg)
    check('MODULE_IMPACT 的「入口页」与 pages.js 的 module 字段逐项一致（说明不许漂移）',
          not mism, '; '.join(mism))
    # 反例自证：把 pages.js 里 dashboard 那一页的 module 抹掉 ⇒ 上条必须转红
    pg_mut = {k: v for k, v in pg.items() if k != 'dashboard'}
    check('反例自证：抹掉 pages.js 里一页的 module ⇒ 上面那条必须转红（判据有判别力）',
          bool(pg.get('dashboard')) and bool(_entry_mismatch(pg_mut)),
          '抹掉后差异数 %d' % len(_entry_mismatch(pg_mut)))
    print('')

    print('-' * 62)
    print('硬断言 %d/%d 通过，告警 %d 条' % (len(PASS), len(PASS) + len(FAIL), len(WARN)))
    if FAIL:
        print('失败项:')
        for f in FAIL:
            print('   - ' + f)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
