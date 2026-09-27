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
import os
import re
import sys

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
CORE_PY = _p('ROLE_REG_CORE', os.path.join(ERP_REPO, 'server', 'core.py'))
SERVER_PY = _p('ROLE_REG_SERVER', os.path.join(ERP_REPO, 'server', 'server.py'))
FS_PY = _p('ROLE_REG_FS', os.path.join(ERP_REPO, 'server', 'routers', 'forecast_submissions.py'))
ERPDB_PY = _p('ROLE_REG_ERPDB', os.path.join(ERP_REPO, 'server', 'erp_db.py'))

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
    """
    src = read(path)
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == funcname:
            seg = ast.get_source_segment(src, node) or ''
            return needle in seg
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
    """
    if modules is None:
        return None
    return ('*' in modules) or ('data' in modules)


# ---------------------------------------------------------------- 各面解析

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
        dup_raw = [k for k, v in const_names.items() if v == k]
        check('ROLE_NAMES 无「中文名 = 英文角色名」的空映射', not dup_raw, '可疑: %s' % dup_raw)
        non_cn = [k for k, v in const_names.items() if v and not re.search(r'[\u4e00-\u9fff]', v)]
        check('ROLE_NAMES 的值都是中文', not non_cn, '可疑: %s' % non_cn)
    # 视图令牌（后端不存在的演示词）必须逐个在 EXTRA_OK 里登记 —— 防止它们悄悄变成第二套「角色」
    unreg = sorted(set(view_names or {}) - set(EXTRA_OK))
    check('ROLE_VIEW_TOKEN_NAMES 的每个词都在 EXTRA_OK 里登记', not unreg,
          '未登记: %s' % unreg if unreg else '')
    # 单一来源：这两处**不许**再各留一份表，否则又回到「四份清单」
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
    auth_mini = {r for r in auth if can_use_miniprogram(modules.get(r))}
    check('标了「小程序」的角色集（ROLE_END 的 mini/both）= 后端有 data/* 权限的角色集',
          labeled_mini == auth_mini,
          'ROLE_END 多 %s / 少 %s' % (sorted(labeled_mini - auth_mini), sorted(auth_mini - labeled_mini)))
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
    _gated = len(re.findall(r"""v-if="(?:canSee\('/forecast'\)|canViewForecastSummary\()""", sh_src))
    _naked = len(re.findall(r"""<router-link\s+to="/forecast\"""", sh_src))
    check('Shell.vue 每个 /forecast 入口都带门禁（≥2 处，且无裸入口）',
          _gated >= 2 and _naked == 0,
          '带门禁 %d 处 / 裸入口 %d 处' % (_gated, _naked))
    fore_src = read(FORECAST)
    check('Forecast.vue 两条路都接了（summaryDenied 按角色预判 + crossDenied 服务端拒绝）',
          'summaryDenied' in fore_src and 'crossDenied' in fore_src)
    check('Forecast.vue 按**状态码**分流 403（不再把「无权限」说成「加载失败」）',
          bool(re.search(r"e\.status[\s\S]{0,80}?===\s*403", fore_src)))
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
