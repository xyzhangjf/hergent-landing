#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""权限表按租户分叉 + `payroll` 窄模块 —— 一致性护栏（2026-09-19 P0/P1）。

## 为什么需要这个脚本

这两件事各自都会**静默失败**，而且失败方向很坏：

1. **权限表回到全平台一份**（P0 回归）
   旧形态是「`/api/role-permissions` 挂在主库前缀 + 读端 `ROLE_PERMS` 是进程级全局」。
   回归之后不会有任何报错 —— 页面照常显示、保存照常"成功"，只是**全平台共用一份**
   ⇒「给客户开 = 自己一起开」。实测判据（当时）：同一令牌带 `X-Tenant-Id: 1/9/10`
   打 `GET /api/role-permissions`，三次返回**逐字相同**。

2. **`payroll` 拆分泄漏 L3 字段**（P1 回归 —— 本轮最贵的一处）
   把「算工资」从 `hr` 里拆出来，是为了让**会计能算工资、但看不到身份证与银行账号**。
   只要有一条薪酬路径漏在 `hr` 之外被顺手映射成 `payroll`，或者某个映射为 `payroll`
   的处理函数**间接读到了 `bank_account`**，这条防线就归零 —— 而界面上完全看不出来
   （会计照样打不开员工档案，却能从一个"工资"接口拿到账号）。

## 四条硬不变量

* **A 权限必须由「本请求所属租户」裁决**：主库前缀里没有 role-permissions、
  不存在进程级全局权限表、RBAC 中间件显式传租户且传之前必须校验成员关系。
* **B `payroll` 与 `hr` 的边界**：`/api/employees`、两个 bank-file 留在 `hr`；
  其余薪酬路径归 `payroll`；且**映射顺序**不能把这几个又吞回去。
* **C `payroll` 路径不得触达 L3**：从「映射为 payroll 的路由」出发，沿 `db.*` 调用
  走两层，任何一层碰到 `id_card` / `bank_account` / `bank_name` / `export_salary_bank_file` 即 FAIL。
  —— 这条是真正要守的东西，B 只是它的实现手段。
* **D 工资条读端的返回约定**（v205）：`salary_detail_get` 名字是单数、返回却是 list；
  调用方必须「先收 `rows` 再取首行」。直接绑给 `slip` 再 `.get(...)` ⇒ 员工当月**有**
  工资明细时 500。**它不是无关 bug，是 P1 能力的前置条件**（会计一算工资就会命中）。

## 用法

    python3 .workbuddy/tools/tenant-perms-scope-check.py

    # 判别力自证：任一面换成被改坏的副本，脚本必须 FAIL
    TPSC_SERVER=/tmp/broken-server.py  python3 .workbuddy/tools/tenant-perms-scope-check.py
    TPSC_CORE=/tmp/broken-core.py      python3 ...
    TPSC_HR=/tmp/broken-hr.py          python3 ...

退出码 0 = 全绿，1 = 有硬断言失败。
"""
import ast
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FE_REPO = os.path.dirname(os.path.dirname(HERE))          # laozhangai-product
ERP_REPO = os.environ.get('HERGENT_ERP_DIR', '/Users/zhangjunfeng/Documents/hergent-erp')
BE = os.path.join(ERP_REPO, 'server')


def _p(env_key, *parts):
    return os.environ.get(env_key, os.path.join(*parts))


SERVER_PY = _p('TPSC_SERVER', BE, 'server.py')
CORE_PY = _p('TPSC_CORE', BE, 'core.py')
ERPDB_PY = _p('TPSC_ERPDB', BE, 'erp_db.py')
CONN_PY = _p('TPSC_CONN', BE, 'db', 'connection.py')
AUTH_PY = _p('TPSC_AUTH', BE, 'routers', 'auth.py')
HR_PY = _p('TPSC_HR', BE, 'routers', 'hr.py')
PW_PY = _p('TPSC_PW', BE, 'routers', 'payroll_workflow.py')
SS_PY = _p('TPSC_SS', BE, 'routers', 'salary_send.py')

# L3 = 实名与资金层（泄露不可逆：可被用于诈骗盗刷）。**任何映射为 payroll 的路径都不许把它交出去。**
L3_TOKENS = ('id_card', 'bank_account', 'bank_name', 'export_salary_bank_file')

# 这些字面量里的列名只是 **DDL**（建表时写列名），不是数据外泄。
# 第一版不做排除时，11 条 payroll 路径**全部**被误报成泄漏 —— 源头是
# `_init_payroll_tables` 里 `hr_employees` 的 CREATE TABLE（含 id_card/bank_name/bank_account）。
# 断言一旦有假阳性就没人看了，所以这条排除是必须的。
DDL_MARKERS = ('CREATE TABLE', 'ALTER TABLE', 'CREATE INDEX', 'CREATE UNIQUE INDEX', 'PRAGMA')

# 「**出口**」级 L3：函数本身就负责把 L3 交出来。payroll 路径的可达闭包里出现即 FAIL。
L3_SOURCES = {
    'export_salary_bank_file': '把 `账号|姓名|金额` 直接拼成文本返回 —— 唯一的 L3 出口',
}
# 「**载体**」级 L3：数据层会整行带出 L3，但调用方可能只用其中一部分（如只取 id 与底薪）。
# 静态判不出「有没有回传给客户端」，故只登记 + 报警，由运行时金丝雀（影子库 e2e）定论。
# ⚠️ `employee_list` / `_get_employee` 用的是 `SELECT *` ⇒ 列名不在源码里，**静态扫不出来**，
#    只能人工登记 —— 这正是"漏一处就归零"的地方。
L3_CARRIERS = {
    'employee_list': 'SELECT * FROM hr_employees ⇒ 返回 id_card / bank_name / bank_account（列名不在源码里）',
    '_get_employee': '同上，单行版',
}

# 薪酬族路径的期望归属（唯一真相源 = 这条表；改动必须先改这里，改不动就说明改错了）
EXPECT_MODULE = {
    '/api/payroll-workflow': 'payroll',
    '/api/payroll': 'payroll',
    '/api/salary-batch-calculate': 'payroll',
    '/api/salary-save': 'payroll',
    '/api/salary-summary': 'payroll',
    '/api/salary-details': 'payroll',
    '/api/salary-slip': 'payroll',
    '/api/salary-send': 'payroll',
    '/api/social-insurance-config': 'payroll',
    '/api/salaries': 'payroll',
    # 下面三个是 L3 与人事档案，必须留在 hr
    '/api/payroll/bank-file': 'hr',
    '/api/salary-bank-file': 'hr',
    '/api/employees': 'hr',
}
PAYROLL_PATHS = [k for k, v in EXPECT_MODULE.items() if v == 'payroll']
HR_L3_PATHS = [k for k, v in EXPECT_MODULE.items() if v == 'hr']

# 本轮的**新模块** `payroll` 必须四张表齐全（映射表 / 模块清单 / 默认权限 / 中文名）
NEW_MODULE = 'payroll'

# 允许出现在映射表或默认权限里、但**不在** `_ALL_MODULES` 的模块 —— 都是本轮之前就有的遗留，
# 不在本轮范围内（新增同样的问题会被 B7/B8 拦住，所以这张表不许随手加）。
PREEXISTING_MODULE_DRIFT = {
    'goals': '遗留：`/api/goals` 映射 + boss 默认权限里有，但 `_ALL_MODULES` 没有 ⇒ 权限页配不到它',
    'ops-workbench': '遗留：boss/sales/guide 默认权限里有，但映射表与 `_ALL_MODULES` 都没有',
    'perf': '遗留：只在 boss 默认权限里，无映射、不在 `_ALL_MODULES`',
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


def parse(path):
    return ast.parse(read(path))


def find_assign(tree, name):
    """模块级 `NAME = <literal>` 的右侧节点。"""
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == name:
                    return node.value
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
            return node.value
    return None


def as_str_list(node):
    if isinstance(node, (ast.List, ast.Tuple)):
        return [e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return None


def as_str_dict(node):
    """只取 key/value 都是字符串字面量的项（映射表 / 中文名表就是这种形态）。"""
    if not isinstance(node, ast.Dict):
        return None
    out = {}
    for k, v in zip(node.keys, node.values):
        if isinstance(k, ast.Constant) and isinstance(k.value, str) \
                and isinstance(v, ast.Constant) and isinstance(v.value, str):
            out[k.value] = v.value
    return out


def as_role_perms(node):
    """`_DEFAULT_PERMS` = {角色: [模块, ...] | {模块: [动作]}}。

    🔴 不能用 `as_str_dict` —— 它的值是**字符串**，而这里的值是**列表**，
    会静默返回 `{}` ⇒ 后面所有「boss 含不含 payroll」之类的断言全部**空转通过**。
    第一版就是这么写的，实测 B3/B4/B8 三条全成了假绿灯。
    """
    if not isinstance(node, ast.Dict):
        return None
    out = {}
    for k, v in zip(node.keys, node.values):
        if not (isinstance(k, ast.Constant) and isinstance(k.value, str)):
            continue
        mods = as_str_list(v)
        if mods is None and isinstance(v, ast.Dict):
            mods = [kk.value for kk in v.keys
                    if isinstance(kk, ast.Constant) and isinstance(kk.value, str)]
        out[k.value] = mods if mods is not None else []
    return out


def l3_tokens_in(fn):
    """函数体里出现的 L3 token —— **只看非 DDL 的字面量/标识符**。

    排除 DDL 是必须的：`_init_payroll_tables` 的建表语句里就写着
    `id_card TEXT / bank_name TEXT / bank_account TEXT`，不排除会把 11 条干净路径全报成泄漏。
    """
    out = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if any(m in node.value.upper() for m in DDL_MARKERS):
                continue
            for t in L3_TOKENS:
                if t in node.value:
                    out.add(t)
        elif isinstance(node, ast.Attribute):
            if node.attr in L3_TOKENS:
                out.add(node.attr)
        elif isinstance(node, ast.Name):
            if node.id in L3_TOKENS:
                out.add(node.id)
        elif isinstance(node, ast.keyword) and node.arg in L3_TOKENS:
            out.add(node.arg)
    return out


def all_names(tree):
    return {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}


def funcs_of(tree):
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out[node.name] = node
    return out


def arg_names(fn):
    a = fn.args
    return [x.arg for x in list(a.posonlyargs) + list(a.args) + list(a.kwonlyargs)]


def called_names(fn):
    """函数体里被调用的名字（`f()` 取 f，`db.f()` 取 f）。"""
    out = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name):
                out.add(f.id)
            elif isinstance(f, ast.Attribute):
                out.add(f.attr)
    return out


METHODS = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options'}


def routes_of(src_path):
    """[(完整路径, 处理函数名, AST 节点)]。router 的前缀从 `APIRouter(prefix=...)` 取。"""
    src = read(src_path)
    tree = ast.parse(src)
    prefix = ''
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'APIRouter':
            for kw in node.keywords:
                if kw.arg == 'prefix' and isinstance(kw.value, ast.Constant):
                    prefix = kw.value.value
    out = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) \
                        and dec.func.attr in METHODS and dec.args \
                        and isinstance(dec.args[0], ast.Constant) and isinstance(dec.args[0].value, str):
                    out.append((prefix + dec.args[0].value, node.name, node))
    return out


def main():
    srv_src = read(SERVER_PY)
    srv = parse(SERVER_PY)
    core = parse(CORE_PY)
    erp = parse(ERPDB_PY)

    master = as_str_list(find_assign(srv, '_TENANT_MASTER_PREFIXES')) or []
    modmap_node = find_assign(srv, '_PATH_MODULE_MAP')
    modmap = as_str_dict(modmap_node) or {}
    modmap_order = [k.value for k in modmap_node.keys] if isinstance(modmap_node, ast.Dict) else []
    defaults = as_role_perms(find_assign(core, '_DEFAULT_PERMS')) or {}
    all_modules = as_str_list(find_assign(core, '_ALL_MODULES')) or []

    def module_of(path):
        """**复刻服务端**的解析：按映射表顺序取首个 `startswith` 命中的 key。

        🔴 不能用「路径 startswith 某个 key」这种包含判断来推断归属 ——
        `/api/payroll/bank-file` 同时 startswith `/api/payroll`，包含判断会把它算成
        payroll（而服务端因为 `/api/payroll/bank-file` 这个 key 在前面，判的是 hr）。
        第一版就因此把一条**正确**的 hr 归类报成 payroll 泄漏。
        """
        for k in modmap_order:
            if path.startswith(k):
                return modmap.get(k)
        return None

    print('=' * 72)
    print('A. 权限表按租户分叉（P0）')
    print('=' * 72)

    check('A1  `/api/role-permissions` 不在主库前缀里',
          '/api/role-permissions' not in master,
          '在主库前缀 ⇒ 读写恒落 erp.db ⇒ 全平台共用一份（本轮回归点）')
    check('A1b `/api/permissions`（模块清单，只读）仍在主库前缀里',
          '/api/permissions' in master)

    # 进程级全局权限表必须彻底消失（不能只是改名 —— 只要还有一份「与租户无关」的权限快照，
    # 迟早有人拿它当权威源）
    core_names = all_names(core)
    check('A2  core.py 里不再有 `ROLE_PERMS` 这个名字',
          'ROLE_PERMS' not in core_names,
          '进程级全局权限表 ⇒ 谁最近保存过就用谁那份（串味）')

    has_cache = find_assign(core, '_PERMS_CACHE') is not None
    check('A3  存在按租户分键的 `_PERMS_CACHE`', has_cache)
    if has_cache:
        # 缓存写入必须用租户键 —— 直接 `{}[role]` 或按角色名分键都会退化成全局
        check('A3b 缓存以 `_tenant_key(...)` 作键',
              'key = current_tenant_key() if tid is None else _tenant_key(tid)' in read(CORE_PY))

    core_fns = funcs_of(core)
    check('A4  `_check_perm` 有 `tenant_id` 形参',
          'tenant_id' in arg_names(core_fns.get('_check_perm')) if '_check_perm' in core_fns else False)
    check('A4b `reload_perms` 有 `tid` 形参（只失效本租户）',
          'tid' in arg_names(core_fns.get('reload_perms')) if 'reload_perms' in core_fns else False)
    check('A5  `perms_for` / `perms_for_effective` 存在',
          'perms_for' in core_fns and 'perms_for_effective' in core_fns)

    erp_fns = funcs_of(erp)
    check('A6  `erp_db.get_all_role_permissions` 有 `tenant_id` 形参',
          'tenant_id' in arg_names(erp_fns.get('get_all_role_permissions'))
          if 'get_all_role_permissions' in erp_fns else False)

    conn = parse(CONN_PY)
    conn_fns = funcs_of(conn)
    ts = conn_fns.get('tenant_scope')
    check('A7  `db.connection.tenant_scope` 存在', ts is not None)
    if ts:
        body = ast.dump(ts)
        check('A7b `tenant_scope` 在 finally 里恢复上下文',
              "attr='finally'" in body or 'Try' in body,
              '不恢复 ⇒ 一次读库就把整条请求链路的租户改掉了')

    # RBAC 中间件：必须显式传租户，且传之前必须校验成员关系
    m = srv_src.find('def rbac_middleware')
    rbac = srv_src[m:m + 6000] if m >= 0 else ''
    check('A8  RBAC 的 `_check_perm(...)` 调用带 `tenant_id=`',
          'tenant_id=_perm_tid' in rbac,
          '不传 ⇒ 拿内置默认放行一个已被本租户撤销的模块 = 撤销失效（越权）')
    check('A9  RBAC 解析租户前先过 `check_user_tenant`',
          'check_user_tenant' in rbac,
          '盲信请求头 ⇒ `X-Tenant-Id: 随机数` 就能让服务端建一整套租户库（DoS 放大）')
    _i_member = rbac.find('check_user_tenant')
    _i_perm = rbac.find('_check_perm(user')
    check('A9b 成员校验在 `_check_perm` 之前',
          _i_member >= 0 and _i_perm > _i_member, '顺序反了等于没校验')
    check('A10 `/api/role-permissions` 在 RBAC 里被显式豁免',
          'path.startswith("/api/role-permissions")' in rbac,
          '不豁免：租户误撤 boss 的 hr ⇒ 权限页打不开且无法自救（自我锁死）')

    n_guard = srv_src.count('_perms_tenant_or_400()')
    check('A11 四个 role-permissions 端点都过 `_perms_tenant_or_400()`',
          n_guard >= 4, '实测 %d 处' % n_guard)
    guard_fn = srv_src.find('def _perms_tenant_or_400')
    guard_body = srv_src[guard_fn:guard_fn + 900] if guard_fn >= 0 else ''
    check('A11b 该 helper 取不到租户时 400（不回落到主库）',
          'raise HTTPException(400' in guard_body,
          '回落主库 = 保存成功但不生效，比报错难查一个数量级')

    auth_src = read(AUTH_PY)
    check('A12 `routers/auth.py` 不再引用 `ROLE_PERMS`', 'ROLE_PERMS' not in auth_src)
    check('A12b 改用 `perms_for_effective`', 'perms_for_effective' in auth_src)

    # 保存后必须按租户失效缓存；零参调用会把"当前租户"交给上下文，最外层调用点会失效错租户
    n_reload = srv_src.count('reload_perms(tid)')
    n_reload0 = len([1 for ln in srv_src.splitlines()
                     if ln.strip() == 'reload_perms()' and not ln.strip().startswith('#')])
    check('A13 三处保存/删除都按租户失效缓存',
          n_reload >= 3 and n_reload0 == 0,
          'reload_perms(tid) x%d，裸 reload_perms() x%d' % (n_reload, n_reload0))

    # 🔴 A13c：豁免的是**模块判定**，不是整个访问控制。
    # 第一版两个 GET 端点写的是 `_auth(request)` ⇒ 任何登录用户（含 sales）都能读到
    # 全租户的角色→模块矩阵；而原实现是被 `hr` 拦着的 —— 等于豁免顺手放大了读权限。
    # 改用 `_admin`（判 role in admin/boss）：**按角色名**把关、不依赖 `hr`，
    # 所以「自我锁死的防护」与「读权限不放大」两头都成立。
    srv_fns = funcs_of(srv)
    read_gate = [
        name for name in ('get_role_perms', 'get_role_perms_detail')
        if name not in srv_fns or '_admin' not in called_names(srv_fns[name])
    ]
    check('A13c 🔴 两个 GET 端点用 `_admin` 而非 `_auth`（豁免模块判定 ≠ 任何登录用户可读）',
          not read_gate, '仍只有 _auth 的：%s' % read_gate)

    print('')
    print('=' * 72)
    print('B. payroll 与 hr 的边界（P1）')
    print('=' * 72)

    for path, want in EXPECT_MODULE.items():
        got = modmap.get(path)
        check('B1  %-32s -> %s' % (path, want), got == want,
              '' if got == want else '实际 = %s' % got)

    # 顺序：`/api/payroll/bank-file` 必须排在 `/api/payroll` 之前（首个 startswith 命中即停）
    try:
        i_bank = modmap_order.index('/api/payroll/bank-file')
        i_pay = modmap_order.index('/api/payroll')
        ok_order = i_bank < i_pay
    except ValueError:
        ok_order = False
    check('B2  `/api/payroll/bank-file` 排在 `/api/payroll` 之前', ok_order,
          '词典序即优先级；反了就被 `/api/payroll` 先吃掉 ⇒ 会计顺带拿到银行账号（静默）')
    # 顺序只是手段，真正要断言的是**解析结果**
    check('B2b 模拟解析：`/api/payroll/bank-file` 归 hr、`/api/payroll/run` 归 payroll',
          module_of('/api/payroll/bank-file') == 'hr'
          and module_of('/api/payroll/run') == 'payroll'
          and module_of('/api/salary-bank-file') == 'hr'
          and module_of('/api/salary-slip/3/2026-09') == 'payroll'
          and module_of('/api/employees') == 'hr'
          and module_of('/api/employees/active') == 'hr',
          'bank-file=%s payroll/run=%s salary-bank-file=%s salary-slip=%s employees=%s'
          % (module_of('/api/payroll/bank-file'), module_of('/api/payroll/run'),
             module_of('/api/salary-bank-file'), module_of('/api/salary-slip/3/2026-09'),
             module_of('/api/employees')))

    boss = defaults.get('boss') or []
    check('B3  `_DEFAULT_PERMS["boss"]` 含 payroll', 'payroll' in boss)
    acct = defaults.get('accountant') or []
    check('B4  `_DEFAULT_PERMS["accountant"]` **不含** payroll', 'payroll' not in acct,
          '「客户会计能算工资、本店会计不能」正是本轮的诉求 ⇒ 默认不给，由各租户自己开')
    check('B5  `_ALL_MODULES` 含 payroll', 'payroll' in all_modules)

    # 模块中文名：权限页的标签取自 `/api/permissions/modules`
    lbl_tree = parse(SERVER_PY)
    lbl_label = None
    for node in ast.walk(lbl_tree):
        if isinstance(node, ast.FunctionDef) and node.name == 'list_modules':
            for sub in ast.walk(node):
                d = as_str_dict(sub)
                if d and 'hr' in d:
                    lbl_label = d
    check('B6  `/api/permissions/modules` 的中文名表含 payroll',
          bool(lbl_label and lbl_label.get('payroll')),
          '标签 = %r' % (lbl_label or {}).get('payroll'))
    if lbl_label and lbl_label.get('payroll'):
        check('B6b payroll 的中文名不是英文原样',
              lbl_label['payroll'] != 'payroll' and any('\u4e00' <= c <= '\u9fff' for c in lbl_label['payroll']),
              '权限页会原样显示成英文')

    # 清单收敛：四张表必须互相认识（任一缺项 = 静默降级）
    # 🔴 最容易漏的是「新模块只加了一半」：映射表加了、`_ALL_MODULES` 没加 ⇒ 权限页里
    #    根本看不到这一行，客户永远配不到它，而接口照常 fail-closed 403（看起来像没这功能）。
    check('B7  `%s` 四张表齐全（映射表 / 模块清单 / boss 默认 / 中文名）' % NEW_MODULE,
          ('payroll' in all_modules
           and 'payroll' in (defaults.get('boss') or [])
           and any(v == 'payroll' for v in modmap.values())
           and bool((lbl_label or {}).get('payroll'))),
          '模块清单=%s boss默认=%s 映射=%s 中文名=%r'
          % ('payroll' in all_modules, 'payroll' in (defaults.get('boss') or []),
             any(v == 'payroll' for v in modmap.values()), (lbl_label or {}).get('payroll')))

    mods_in_map = set(modmap.values())
    unexpected_map = sorted(mods_in_map - set(all_modules) - set(PREEXISTING_MODULE_DRIFT))
    check('B8  映射表里的模块名都在 `_ALL_MODULES` 里（遗留项已登记）',
          not unexpected_map,
          '新增漂移：%s' % unexpected_map)

    bad_default = set()
    for r, perms in defaults.items():
        for m in perms:
            if m != '*' and m not in all_modules:
                bad_default.add(m)
    unexpected_def = sorted(bad_default - set(PREEXISTING_MODULE_DRIFT))
    check('B8b `_DEFAULT_PERMS` 里的模块名都在 `_ALL_MODULES` 里（遗留项已登记）',
          not unexpected_def,
          '新增漂移：%s（新模块忘了进清单 ⇒ 权限页里配不到）' % unexpected_def)

    # 登记表本身不许腐化（名字改了 / 已被顺手修好了却还留着）
    stale = [m for m in PREEXISTING_MODULE_DRIFT
             if m not in (mods_in_map | set(all_modules) | {x for p in defaults.values() for x in p})]
    check('B8c 遗留漂移登记表未腐化', not stale, '已不存在：%s' % stale)

    # 路由存在性：薪酬族每个 key 必须能匹配到至少一条**真实注册**的路由
    route_files = [SERVER_PY, HR_PY, PW_PY, SS_PY]
    routes = []
    for f in route_files:
        if os.path.exists(f):
            routes.extend(routes_of(f))
    if 'prefix=' in srv_src and 'include_router(' in srv_src:
        pass  # include_router 的 prefix 已实测为 0 处；下方有断言兜住
    check('B9  `include_router` 未额外加 prefix（否则本脚本解析出的路由路径会失真）',
          not any('include_router(' in ln and 'prefix=' in ln for ln in srv_src.splitlines()))
    dead = [p for p in EXPECT_MODULE if not any(r[0].startswith(p) for r in routes)]
    check('B10 薪酬族每个映射 key 都能匹配到真实路由', not dead,
          '悬空：%s（映射改了但路由名对不上 ⇒ fail-closed 静默 403）' % dead)

    print('')
    print('=' * 72)
    print('C. payroll 路径不得把 L3（实名 / 银行）交出去')
    print('=' * 72)

    # 建立「函数名 -> 函数体节点」索引：路由处理函数（各文件） + erp_db 的数据层函数
    db_fns = funcs_of(erp)

    def closure(fn, depth=3, seen=None):
        """从 fn 出发、沿被调用名在 erp_db 里可达的函数集合（不含 fn 自己）。"""
        seen = seen if seen is not None else set()
        if depth <= 0:
            return seen
        for callee in called_names(fn):
            if callee in seen:
                continue
            sub = db_fns.get(callee)
            if sub is None:
                continue
            seen.add(callee)
            closure(sub, depth - 1, seen)
        return seen

    def routes_under(prefix):
        return [(rp, fn, nd) for rp, fn, nd in routes if rp.startswith(prefix)]

    def payroll_routes():
        """真正归 payroll 的路由 —— 用 `module_of` 解析，**不是**前缀包含。"""
        return [(rp, fn, nd) for rp, fn, nd in routes if module_of(rp) == 'payroll']

    # C1：处理函数**自身**不得出现 L3 字段（含 `bank_account` 这类字面量）
    leaks_self = []
    for rp, fn, nd in payroll_routes():
        tk = l3_tokens_in(nd)
        if tk:
            leaks_self.append('%s(%s) -> %s' % (rp, fn, ','.join(sorted(tk))))
    check('C1  所有 payroll 处理函数体内不含 L3 字段', not leaks_self, '; '.join(leaks_self))

    # C2：payroll 路径的可达闭包不得包含「出口级」L3 函数
    leaks_src = []
    for rp, fn, nd in payroll_routes():
        hit = sorted(closure(nd) & set(L3_SOURCES))
        if hit:
            leaks_src.append('%s -> %s' % (rp, hit))
    check('C2  payroll 路径的可达闭包不含出口级 L3 函数', not leaks_src,
          '; '.join(leaks_src) or '（export_salary_bank_file 等）')

    # C3：对照组 —— 否则 C1/C2 可能是空断言（全都不触达也能过）
    l3_hit = []
    for rp, fn, nd in routes:
        if module_of(rp) == 'hr' and any(rp.startswith(p) for p in HR_L3_PATHS) \
                and (closure(nd) & set(L3_SOURCES)):
            l3_hit.append(rp)
    check('C3  对照组：hr 侧入口确实触达出口级 L3（证明 C2 不是空断言）',
          bool(l3_hit), '命中：%s' % l3_hit)

    # C4：登记表不许腐化，且「载体级」L3 必须真的存在
    missing_src = [n for n in L3_SOURCES if n not in db_fns]
    missing_car = [n for n in L3_CARRIERS if n not in db_fns]
    check('C4  登记的 L3 出口 / 载体函数都真实存在', not missing_src and not missing_car,
          '出口缺=%s 载体缺=%s（改名后没同步 ⇒ 断言静默失效）' % (missing_src, missing_car))

    # C5（告警级）：payroll 路径触及「载体级」L3 —— 静态判不出有没有回传，交运行时定论
    carriers = {}
    for rp, fn, nd in payroll_routes():
        hit = sorted(closure(nd) & set(L3_CARRIERS))
        if hit:
            carriers.setdefault(','.join(hit), []).append(rp)
    for k, paths in sorted(carriers.items()):
        warn('payroll 路径经数据层读到 L3 载体 `%s`（共 %d 条路径）' % (k, len(paths)),
             '静态无法判定是否回传给客户端 ⇒ 由影子库金丝雀验证（见报告 §验证）')

    # C6：payroll **绝不能**等于 hr —— 拆分的全部意义就是这一条
    check('C6  `payroll` 与 `hr` 是两个不同模块（拆分确实发生了）',
          module_of('/api/employees') == 'hr' and module_of('/api/payroll-workflow/run') == 'payroll'
          and module_of('/api/employees') != module_of('/api/payroll-workflow/run'))

    # ────────────────────────────────────────────────────────────────────────
    # D. 工资条读端：**单数函数名 + 复数返回值**的错配（v205）
    #
    # 为什么会混进这个脚本：它不是「顺手发现的无关 bug」，而是 **P1 能力的前置条件** ——
    # P1 的交付物就是「让客户的会计能算工资」，而链路是
    #   会计算工资 → `salary_details` 落行 → 点「预览 / 群发工资条」→ 500
    # 即：不改这里，`payroll` 模块一被真正用起来就断。
    #
    # 静默性来自哪里：`salary_details` 生产上全库 **0 行** ⇒ 走的永远是 `if not rows`
    # 那条优雅分支（返回「无工资数据」）⇒ 既没有 500、也没有日志告警。
    # 唯一的痕迹是 `tenant_10.db` 里两条 `sent_count=0 / 无工资数据` 的发送日志。
    # ────────────────────────────────────────────────────────────────────────
    print('')
    print('=' * 72)
    print('D. 工资条读端：单数函数名 + 复数返回值的错配')
    print('=' * 72)

    ss = parse(SS_PY)
    ss_fns = funcs_of(ss)

    def _subscripts_name(fn_node, name):
        """函数体内是否出现 `name[...]`。"""
        if fn_node is None:
            return False
        for n in ast.walk(fn_node):
            if isinstance(n, ast.Subscript) and isinstance(n.value, ast.Name) and n.value.id == name:
                return True
        return False

    def _get_calls_on(fn_node, var):
        """函数体内是否出现 `var.get(...)` —— 即该形参被当成 dict 用。"""
        if fn_node is None:
            return False
        for n in ast.walk(fn_node):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) \
                    and n.func.attr == 'get' and isinstance(n.func.value, ast.Name) \
                    and n.func.value.id == var:
                return True
        return False

    # D0 对照组：同仓的权威用法就是把返回值当 list（`detail[0]`、遍历），
    #    所以「返回 list」是既有约定，不是给 salary_send 一家找的借口。
    check('D0  对照组：`export_salary_slip` 按 list 用（`detail[0]`）',
          _subscripts_name(erp_fns.get('export_salary_slip'), 'detail'),
          '证明「返回 list」是同仓既有约定')

    # D1 别名确实委托给 list 版查询
    # 🔴 用 `called_names`（真调用）而不是扫 `ast.dump` 的文本 —— 后者会被 docstring 里
    # 同名的字串骗过去（假绿灯）。⚠️ 第一版自写的判定器只认 `ast.Attribute`，
    # 而这里是**裸名调用** `get_salary_details(...)`（`ast.Name`）⇒ D1 误报 FAIL。
    _sdg = erp_fns.get('salary_detail_get')
    check('D1  `salary_detail_get` 委托 `get_salary_details`（⇒ 返回 list）',
          _sdg is not None and 'get_salary_details' in called_names(_sdg),
          '若不是真委托，D2 的前提就不成立')

    # D2 🔴 关键：不得再把返回值直接绑到 `slip`（dict 语义）
    bad_targets = []
    for node in ast.walk(ss):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            f = node.value.func
            if isinstance(f, ast.Attribute) and f.attr == 'salary_detail_get':
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id == 'slip':
                        bad_targets.append('line %d' % node.lineno)
    check('D2 🔴 没有把 `salary_detail_get(...)` 直接绑给 `slip`（dict 语义）',
          not bad_targets,
          '命中：%s ⇒ 该员工当月有工资明细时 `slip.get(...)` 抛 AttributeError(500)' % bad_targets)

    # D3 调用点必须落在「先收 list、再取首行」的形态上
    call_targets = []
    for node in ast.walk(ss):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            f = node.value.func
            if isinstance(f, ast.Attribute) and f.attr == 'salary_detail_get':
                call_targets += [t.id for t in node.targets if isinstance(t, ast.Name)]
    check('D3  全部调用点都收进 `rows`（再取首行），且数量为 2',
          len(call_targets) == 2 and set(call_targets) == {'rows'},
          '实际绑定名=%s（期望 [rows, rows]）' % call_targets)

    # D4 让 D2 有依据：`_format_salary_message` 确确实实要求 dict
    #    （否则 D2 只是形式主义 —— 喂 list 也没事）
    check('D4  `_format_salary_message` 用 `slip.get(...)` ⇒ 形参必须是 dict',
          _get_calls_on(ss_fns.get('_format_salary_message'), 'slip'),
          '这一条成立，D2 的「不能喂 list」才有依据')

    print('')
    print('-' * 72)
    print('硬断言 %d/%d 通过，告警 %d 条' % (len(PASS), len(PASS) + len(FAIL), len(WARN)))
    if FAIL:
        print('失败项:')
        for f in FAIL:
            print('   - ' + f)
    return 1 if FAIL else 0


if __name__ == '__main__':
    sys.exit(main())
