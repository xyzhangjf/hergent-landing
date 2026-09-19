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
    """能进小程序干活的判据 = 后端模块权限里有 `*` / `data` / `chat`。

    依据：小程序调用的接口前缀在 `server.py::_PATH_MODULE_MAP` 里分别落到
    `data`（/api/forecast-submissions/*、/api/products）与 `chat`（AI 对话）。
    """
    if modules is None:
        return None
    return ('*' in modules) or ('data' in modules) or ('chat' in modules)


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
    """员工档案角色下拉 → [(value, label), ...]（要 label，因为「适用端」标注在 label 里）。"""
    m = re.search(r"const ROLE_OPTIONS\s*=\s*\[(.*?)\n\]", src, re.S)
    if not m:
        raise SystemExit('未找到 ROLE_OPTIONS')
    return re.findall(r"\{\s*value:\s*'([a-z_]+)',\s*label:\s*'([^']*)'\s*\}", m.group(1))


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
    print('A 员工档案 · 角色下拉（能开出哪些角色）')
    opts = fe_role_options(emp_src)
    opt_vals = [v for v, _ in opts]
    check('ROLE_OPTIONS 无重复值', len(opt_vals) == len(set(opt_vals)),
          '重复: %s' % [x for x in set(opt_vals) if opt_vals.count(x) > 1])
    missing = sorted(auth_set - set(opt_vals))
    extra = sorted(set(opt_vals) - auth_set)
    check('ROLE_OPTIONS 覆盖全部后端角色', not missing, '缺: %s' % missing if missing else '')
    check('ROLE_OPTIONS 无后端不存在的角色', not extra, '多: %s' % extra if extra else '')
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

    # ---- D 「适用端」标注必须与后端模块权限一致 --------------------------------
    print('D 员工档案 · 角色下拉的「适用端」标注 ↔ 后端模块权限')
    labeled_mini = {v for v, lab in opts if '小程序' in lab}
    auth_mini = {r for r in auth if can_use_miniprogram(modules.get(r))}
    check('标了「小程序」的角色集 = 后端有 data/chat 权限的角色集',
          labeled_mini == auth_mini,
          '文案多 %s / 少 %s' % (sorted(labeled_mini - auth_mini), sorted(auth_mini - labeled_mini)))
    for r in auth:
        if modules.get(r) is None:
            warn('角色 %s 的权限不是字面量列表，无法判定适用端' % r)
    print('        %s' % '  |  '.join(
        '%s=%s' % (r, ('小程序' if r in auth_mini else '仅网页端')) for r in auth))
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
    check('normalize_role 以 _DEFAULT_PERMS / ROLE_PERMS 为判据（未另抄名单）',
          bool(re.search(r"def\s+known_roles[\s\S]{0,300}?_DEFAULT_PERMS[\s\S]{0,120}?ROLE_PERMS", core)))
    srv = read(SERVER_PY)
    fs = read(FS_PY)
    erp = read(ERPDB_PY)
    check('PUT /api/users/{uid}/role 接入了白名单',
          bool(re.search(r"def\s+update_user_role[\s\S]{0,800}?normalize_role\s*\(", srv)),
          '只校验非空 ⇒ 任何 admin/boss 都能造出新 admin')
    check('开账号接口（staff-accounts）接入了白名单',
          bool(re.search(r"async\s+def\s+create_staff_account[\s\S]{0,900}?normalize_role\s*\(", fs)))
    check('staff_account_create（INSERT 旁）也有第二道白名单',
          bool(re.search(r"def\s+staff_account_create[\s\S]{0,900}?normalize_role\s*\(", erp)))
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
