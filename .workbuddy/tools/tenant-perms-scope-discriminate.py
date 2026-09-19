#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`tenant-perms-scope-check.py` 的**判别力自证**。

## 为什么必须有这一步

护栏最容易的失败模式不是「漏报」而是「**空转**」—— 断言的取数方式错了、名字改了、
或者某个 `check()` 的条件永远为真。2026-09-19 本轮实测就撞到两次：

* `_DEFAULT_PERMS` 用「value 必须是字符串」的解析器去读 ⇒ **静默返回 `{}`** ⇒
  「boss 含不含 payroll」「默认权限里的模块都在清单里」两条硬断言**全部假绿灯**；
* C 段用「路径 startswith 某个 key」推归属 ⇒ 把 `/api/payroll/bank-file` 算成 payroll
  （服务端因为更具体的 key 在前，判的是 hr）⇒ 一条**正确**的归类被报成泄漏。

所以本脚本对每一处关键判据都造一份「被破坏的副本」，跑同一个护栏，
**必须 FAIL**。任何一条没 FAIL，就说明那条判据是纸糊的。

用法：`python3 .workbuddy/tools/tenant-perms-scope-discriminate.py`（退出码 0 = 12/12 都有牙齿）
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHECKER = os.path.join(HERE, 'tenant-perms-scope-check.py')
ERP = os.environ.get('HERGENT_ERP_DIR', '/Users/zhangjunfeng/Documents/hergent-erp')
BE = os.path.join(ERP, 'server')

# (说明, 目标文件的 env 变量, 原文件名, [(old, new)], 期望失败的断言编号)
CASES = [
    ('① 把 `/api/role-permissions` 加回主库前缀（P0 原始形态）',
     'TPSC_SERVER', 'server.py',
     [('    "/api/users", "/api/permissions",',
       '    "/api/users", "/api/role-permissions", "/api/permissions",')],
     'A1'),

    ('② 重新引入进程级全局权限表 `ROLE_PERMS`',
     'TPSC_CORE', 'core.py',
     [('_NO_TENANT = 0', '_NO_TENANT = 0\nROLE_PERMS = {}    # 回归：进程级全局')],
     'A2'),

    ('③ RBAC 不再把租户传给 `_check_perm`（撤销失效 = 越权）',
     'TPSC_SERVER', 'server.py',
     [('_check_perm(user, module, action, tenant_id=_perm_tid)',
       '_check_perm(user, module, action)')],
     'A8'),

    ('④ 取消 `/api/role-permissions` 的 RBAC 豁免（老板可能自我锁死）',
     'TPSC_SERVER', 'server.py',
     [('    if path.startswith("/api/role-permissions"):\n        return await call_next(request)\n\n', '')],
     'A10'),

    ('⑤ `/api/payroll/bank-file` 挪到 `/api/payroll` 之后（被吞掉 ⇒ 会计拿到银行账号）',
     'TPSC_SERVER', 'server.py',
     [('    "/api/payroll/bank-file": "hr",\n    "/api/payroll": "payroll",',
       '    "/api/payroll": "payroll",\n    "/api/payroll/bank-file": "hr",')],
     'B2/B2b'),

    ('⑥ 把 `/api/employees` 也划给 payroll（会计顺带看到身份证与银行卡）',
     'TPSC_SERVER', 'server.py',
     [('    "/api/employees": "hr",', '    "/api/employees": "payroll",')],
     'B1/C6'),

    ('⑦ 模块清单里漏掉 payroll（权限页里配不到这个新模块）',
     'TPSC_CORE', 'core.py',
     [('_ALL_MODULES = ["dashboard", "data", "sales", "buying", "stock", "accounts", "crm", "marketing", "hr", "payroll"',
       '_ALL_MODULES = ["dashboard", "data", "sales", "buying", "stock", "accounts", "crm", "marketing", "hr"')],
     'B5/B7'),

    ('⑧ `get_all_role_permissions` 丢掉 `tenant_id` 形参（读端退回上下文/主库）',
     'TPSC_ERPDB', 'erp_db.py',
     [('def get_all_role_permissions(tenant_id=None):', 'def get_all_role_permissions():')],
     'A6'),

    ('⑨ 登录接口改回读进程级全局',
     'TPSC_AUTH', 'routers/auth.py',
     [('from core import perms_for_effective', 'from core import ROLE_PERMS'),
      ('allowed = perms_for_effective(u).get(u["role"], [])',
       'allowed = ROLE_PERMS.get(u["role"], [])')],
     'A12/A12b'),

    ('⑩ `_perms_tenant_or_400` 不再 fail-closed（回落主库 ⇒ 保存成功但不生效）',
     'TPSC_SERVER', 'server.py',
     [('        raise HTTPException(400, "缺少租户上下文：角色权限按租户存储，请在请求头带 X-Tenant-Id")',
       '        return None')],
     'A11b'),

    ('⑪ 工资条读端把 list 当 dict 用（员工当月有工资明细时 500 —— v205 原始形态）',
     'TPSC_SS', 'routers/salary_send.py',
     [('    rows = db.salary_detail_get(employee_id, month)',
       '    slip = db.salary_detail_get(employee_id, month)')],
     'D2/D3'),

    ('⑫ 权限表读端点退回 `_auth`（把「豁免模块判定」当成「任何登录用户可读」）',
     'TPSC_SERVER', 'server.py',
     [('    from core import _admin\n'
       '    _admin(request)\n'
       '    tid = _perms_tenant_or_400()\n'
       '    from core import _DEFAULT_PERMS\n'
       '    custom = db.get_all_role_permissions(tenant_id=tid)',
       '    _auth(request)\n'
       '    tid = _perms_tenant_or_400()\n'
       '    from core import _DEFAULT_PERMS\n'
       '    custom = db.get_all_role_permissions(tenant_id=tid)')],
     'A13c'),
]


def main():
    tmp = tempfile.mkdtemp(prefix='tpsc_disc_')
    ok = 0
    try:
        for i, (desc, env_key, rel, subs, expect) in enumerate(CASES, 1):
            src = os.path.join(BE, rel)
            dst = os.path.join(tmp, 'case%02d_%s' % (i, os.path.basename(rel)))
            text = open(src, encoding='utf-8').read()
            for old, new in subs:
                if old not in text:
                    print('  SKIP  %s\n        锚点未命中（源码已变？）：%r' % (desc, old[:70]))
                    break
                text = text.replace(old, new, 1)
            else:
                with open(dst, 'w', encoding='utf-8') as f:
                    f.write(text)
                env = dict(os.environ)
                env[env_key] = dst
                r = subprocess.run([sys.executable, CHECKER], capture_output=True,
                                   text=True, env=env)
                failed = r.returncode != 0
                line = [l for l in r.stdout.splitlines() if '硬断言' in l]
                print(('  PASS  ' if failed else '  FAIL  ') + desc)
                print('        期望 %s 报警；护栏 %s' % (
                    expect, line[0].strip() if line else '(无结论行)'))
                if failed:
                    ok += 1
                else:
                    print('        ⚠️ 这份被改坏的副本**没被抓住** —— %s 那条判据是纸糊的' % expect)
                continue
            # 锚点没命中就走不到这里，视为未通过
        print('')
        print('-' * 72)
        print('判别力自证 %d/%d 通过' % (ok, len(CASES)))
        return 0 if ok == len(CASES) else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
