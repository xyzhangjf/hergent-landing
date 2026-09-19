#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""角色清单一致性校验 —— 以后端 `core._DEFAULT_PERMS` 为唯一权威源。

## 为什么需要这个脚本

「角色清单缺条目」是**静默失败**：前端 `roleName(r) { return ROLE_NAMES[r] || r }`、
小程序 `roleText(role) { return ROLE_TEXT[role] || role }` —— 缺映射不报错、不告警，
只是把 `supervisor` 原样显示成裸英文。2026-09-19 实测踩到：后端 8 个角色，
员工档案的下拉与显示名各只列了 7 个（都漏 supervisor），后果是
**① 开不出新的主管账号（下拉里没有该角色）② 已是主管的账号显示裸英文**。

两处清单彼此也不一致（比如同一个 supervisor 在相邻页面被叫「主管」和「督导」），
所以断言必须**对外一个权威源、对内两处互校**，而不是各自为政。

## 权威源

后端 `server/core.py` 的 `_DEFAULT_PERMS`（AST 解析，非正则 —— 注释里也出现过角色名）。
它同时驱动权限门禁，是产品里唯一「真会拒绝请求」的角色定义。

## 用法

    python3 .workbuddy/tools/role-registry-consistency-check.py
    # 判别力自证：指向一份被改坏的副本，脚本必须 FAIL
    ROLE_REG_EMPARCHIVE=/tmp/broken.vue python3 .workbuddy/tools/role-registry-consistency-check.py

退出码 0 = 全绿，1 = 有硬断言失败。
"""
import ast
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FE_REPO = os.path.dirname(os.path.dirname(HERE))          # laozhangai-product
ERP_REPO = os.environ.get('HERGENT_ERP_DIR', '/Users/zhangjunfeng/Documents/hergent-erp')

EMPARCHIVE = os.environ.get(
    'ROLE_REG_EMPARCHIVE',
    os.path.join(FE_REPO, 'hergent-cn-v2', 'src', 'pages', 'EmployeeArchive.vue'))
SETTINGS = os.path.join(FE_REPO, 'hergent-cn-v2', 'src', 'pages', 'Settings.vue')
FORECAST = os.path.join(FE_REPO, 'hergent-cn-v2', 'src', 'pages', 'Forecast.vue')
MP_ROLES = os.path.join(
    FE_REPO, 'forecast-order-miniprogram-20260812T023419087Z', 'miniprogram', 'utils', 'roles.js')
CORE_PY = os.path.join(ERP_REPO, 'server', 'core.py')

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


def authority_roles():
    """后端 _DEFAULT_PERMS 的键集 —— 唯一权威源。"""
    tree = ast.parse(read(CORE_PY))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if getattr(t, 'id', None) == '_DEFAULT_PERMS' and isinstance(node.value, ast.Dict):
                    return [k.value for k in node.value.keys], node.lineno
    raise SystemExit('无法从 %s 解析 _DEFAULT_PERMS' % CORE_PY)


def fe_role_options(src):
    m = re.search(r"const ROLE_OPTIONS\s*=\s*\[(.*?)\n\]", src, re.S)
    if not m:
        raise SystemExit('未找到 ROLE_OPTIONS')
    return re.findall(r"value:\s*'([a-z_]+)'", m.group(1))


def fe_role_map(src):
    """员工档案 ROLE_NAMES：角色 -> 中文名。"""
    m = re.search(r"const ROLE_NAMES\s*=\s*\{(.*?)\}", src, re.S)
    if not m:
        raise SystemExit('未找到 ROLE_NAMES')
    return dict(re.findall(r"([a-z_]+)\s*:\s*'([^']*)'", m.group(1)))


def fe_role_css(src):
    return re.findall(r"\.df-role\.r-([a-z_]+)\s*\{", src)


def others_label_sets():
    """其它页面的角色中文名映射（只告警，不硬失败 —— 各页面用途不同）。"""
    out = {}
    if os.path.isfile(SETTINGS):
        m = re.search(r"const ROLE_LABELS\s*=\s*\{(.*?)\n\}", read(SETTINGS), re.S)
        if m:
            out['Settings.vue ROLE_LABELS'] = dict(
                re.findall(r"([a-z_]+)\s*:\s*'([^']*)'", m.group(1)))
    if os.path.isfile(FORECAST):
        m = re.search(r"const ROLE_LABELS\s*=\s*\{(.*?)\}", read(FORECAST))
        if m:
            out['Forecast.vue ROLE_LABELS'] = dict(
                re.findall(r"([a-z_]+)\s*:\s*'([^']*)'", m.group(1)))
    if os.path.isfile(MP_ROLES):
        m = re.search(r"const ROLE_TEXT\s*=\s*\{(.*?)\}", read(MP_ROLES), re.S)
        if m:
            out['小程序 utils/roles.js ROLE_TEXT'] = dict(
                re.findall(r"([a-z_]+)\s*:\s*'([^']*)'", m.group(1)))
    return out


def main():
    auth, lineno = authority_roles()
    auth_set = set(auth)
    src = read(EMPARCHIVE)

    print('权威源：server/core.py::_DEFAULT_PERMS (L%d) = %d 个角色' % (lineno, len(auth)))
    print('        %s' % ', '.join(auth))
    print('')

    print('A 员工档案 · 角色下拉（能开出哪些角色）')
    opts = fe_role_options(src)
    check('ROLE_OPTIONS 无重复值', len(opts) == len(set(opts)),
          '重复: %s' % [x for x in set(opts) if opts.count(x) > 1])
    missing = sorted(auth_set - set(opts))
    extra = sorted(set(opts) - auth_set)
    check('ROLE_OPTIONS 覆盖全部后端角色', not missing, '缺: %s' % missing if missing else '')
    check('ROLE_OPTIONS 无后端不存在的角色', not extra, '多: %s' % extra if extra else '')
    print('')

    print('B 员工档案 · 中文显示名（列表「账号」列与弹窗摘要）')
    names = fe_role_map(src)
    missing_n = sorted(auth_set - set(names))
    check('ROLE_NAMES 的键覆盖全部后端角色', not missing_n,
          '缺: %s（缺条目会静默显示裸英文）' % missing_n if missing_n else '')
    check('ROLE_OPTIONS 与 ROLE_NAMES 值集一致',
          set(opts) == set(names), '差: %s' % sorted(set(opts) ^ set(names)))
    # 显示名不能是角色名本身 —— 那就是「没映射」，只是碰巧没报错
    raw = [k for k, v in names.items() if v == k]
    check('ROLE_NAMES 无「中文名 = 英文角色名」的空映射', not raw, '可疑: %s' % raw)
    print('')

    print('C 员工档案 · 角色标签色板')
    css = fe_role_css(src)
    missing_c = sorted(auth_set - set(css))
    check('.df-role.r-* 覆盖全部后端角色', not missing_c,
          '缺: %s（缺则退回基础 teal，与 staff 撞色）' % missing_c if missing_c else '')
    check('色板无重复定义', len(css) == len(set(css)),
          '重复: %s' % [x for x in set(css) if css.count(x) > 1])
    print('')

    print('D 其它清单（只告警：各页面用途不同，不作硬失败）')
    sets = others_label_sets()
    for label, mapping in sets.items():
        keys = set(mapping.keys())
        miss = sorted(auth_set - keys)
        ext = sorted(keys - auth_set)
        if miss or ext:
            warn('%s 与权威集不同' % label,
                 ('缺 %s' % miss if miss else '') + ('  多 %s' % ext if ext else ''))
        else:
            print('  PASS  %s 覆盖全部后端角色' % label)

    # 同一角色在各页面被叫成什么 —— 名称漂移只有横向摆出来才看得见（如 supervisor
    # 在权限页叫「主管」、在预报页叫「督导」，用户会以为是两个角色）。
    table = {'员工档案': fe_role_map(src)}
    table.update(sets)
    cols = list(table.keys())
    drift = []
    for role in auth:
        seen = [(c, table[c][role]) for c in cols if role in table.get(c, {})]
        if len({v for _, v in seen}) > 1:
            drift.append((role, seen))
    if drift:
        warn('同一角色在不同页面译文不一致（%d 个）' % len(drift))
        for role, seen in drift:
            print('        %-11s %s' % (role, '  |  '.join('%s=%s' % (c, v) for c, v in seen)))
    else:
        print('  PASS  同一角色跨页面译文一致')
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
