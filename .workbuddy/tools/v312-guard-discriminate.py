#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v312 护栏判别力自证 —— 造 14 个"该被抓住"的坏副本，护栏**必须**报红。

🔴 为什么必须有这一步（本项目纪律，见 `local-machine-pitfalls` §12）：
   护栏从 51 条变成 75 条 **不是**证据 —— 也可能是"我新加的判据其实什么都不判"。
   唯一能证明判据有效的方法：**正反两侧都跑**。
     · 正例：原文件 ⇒ 必须 0 失败（证明没有假红）
     · 反例：每条新判据各造一个"该被抓住"的坏副本 ⇒ 必须报红（证明有判别力）
     · 不误报：把**注释/文档字符串**里的字样改掉（真实现仍在）⇒ 必须仍全绿
       —— 这一族专门证明 v312 新增的「排 docstring + 排注释」不是摆设。

本轮覆盖的三条新判据族（v312 角色端配置）：
  ① **唯一源**：`MINI_MODULES` / `ROLE_END_PROTECTED` / 前后端 `{web,mini}→scope` 映射；
  ② **下发链**：`role_end` 必须真的进 `ddl_map`（只建表不下发 ⇒ 租户库无表 ⇒ 恒空零报错）；
  ③ **接线**：三条 API 的真路由 / 真落库 / 真失效缓存 / 两条防自锁硬拒 / 前端真调用路径。

跑法：
    python3 .workbuddy/tools/v312-guard-discriminate.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

PY = '/Users/zhangjunfeng/.workbuddy/binaries/python/versions/3.13.12/bin/python3'
HERE = os.path.dirname(os.path.abspath(__file__))
FE_REPO = os.path.dirname(os.path.dirname(HERE))
ERP = os.environ.get('HERGENT_ERP_DIR', '/Users/zhangjunfeng/Documents/hergent-erp')

GUARD = os.path.join(HERE, 'role-registry-consistency-check.py')
FE_SRC = os.path.join(FE_REPO, 'hergent-cn-v2', 'src')
ROLES = os.path.join(FE_SRC, 'constants', 'roles.js')
SETTINGS = os.path.join(FE_SRC, 'pages', 'Settings.vue')
SHELL_VUE = os.path.join(FE_SRC, 'components', 'Shell.vue')
CORE_PY = os.path.join(ERP, 'server', 'core.py')
ERPDB_PY = os.path.join(ERP, 'server', 'erp_db.py')
SERVER_PY = os.path.join(ERP, 'server', 'server.py')

TMP = tempfile.mkdtemp(prefix='v312-guard-')


def run_guard(env_extra=None):
    env = dict(os.environ)
    env['HERGENT_ERP_DIR'] = ERP
    if env_extra:
        env.update(env_extra)
    r = subprocess.run([PY, GUARD], capture_output=True, text=True, timeout=180, env=env)
    failed = re.findall(r'^\s*-\s+(.+)$', r.stdout, re.M)
    total = re.search(r'硬断言 (\d+)/(\d+) 通过', r.stdout)
    return r.returncode, (total.group(0) if total else '?'), failed


def broken(src_path, subst, env_key, tag):
    """把 src_path 复制到临时目录、做一次字符串替换，返回该反例的运行结果。

    ⚠️ 替换**没生效**时直接退出 —— 否则"反例通过了"其实是"我根本没改到东西"，
       那种自证是假的（本项目把这种失败叫"探针没有判别力"）。
    """
    dst = os.path.join(TMP, tag.split()[0] + '-' + os.path.basename(src_path))
    shutil.copyfile(src_path, dst)
    s = open(dst, encoding='utf-8').read()
    before = s
    for a, b in subst:
        s = s.replace(a, b)
    if s == before:
        raise SystemExit('反例「%s」：字符串替换没生效（待替换文本已变），自证无效！' % tag)
    open(dst, 'w', encoding='utf-8').write(s)
    return run_guard({env_key: dst})


CASES = [
    ('①MINI', CORE_PY,
     [('MINI_MODULES = ("data",)', 'MINI_MODULES = ("data", "stok")')],
     'ROLE_REG_CORE', 'MINI_MODULES 的模块名都在 _ALL_MODULES 里'),
    ('②MINI', CORE_PY,
     [('MINI_MODULES = ("data",)', 'MINI_MODULES = ("data", "stock")')],
     'ROLE_REG_CORE', 'MINI_MODULES 与 can_use_miniprogram 的判据同源'),
    ('③保护名单', CORE_PY,
     [('ROLE_END_PROTECTED = ("admin", "boss")', 'ROLE_END_PROTECTED = ("admin",)')],
     'ROLE_REG_CORE', 'ROLE_END_PROTECTED 含 admin 与 boss'),
    ('④默认端链路', CORE_PY,
     [('    return end_to_scope(role_end_for(role, tid))',
       '    return ROLE_LOGIN_SCOPE.get(role, DEFAULT_LOGIN_SCOPE)')],
     'ROLE_REG_CORE', 'default_login_scope_for_role 未再直读 ROLE_LOGIN_SCOPE'),
    ('⑤覆盖不生效', CORE_PY,
     [('    ov = role_end_map(tid).get(r)', '    ov = {}.get(r)')],
     'ROLE_REG_CORE', 'role_end_for 真的先读租户覆盖'),
    ('⑥端映射漂移', ROLES,
     [("  return m ? 'mini' : 'web'", "  return m ? 'mini' : 'app'")],
     'ROLE_REG_CONST', 'end_to_scope 前后端取值域逐项一致'),
    ('⑦表不下发', ERPDB_PY,
     [('    ddl_map["role_end"] = role_end_ddl\n', '')],
     'ROLE_REG_ERPDB', 'role_end 表进了 ddl_map'),
    ('⑧表不下发', ERPDB_PY,
     [('    ddl_map["role_end"] = role_end_ddl',
       '    # ddl_map["role_end"] = role_end_ddl   # 反例：注释掉（旧正则会照样匹配）')],
     'ROLE_REG_ERPDB', 'role_end 表进了 ddl_map'),
    ('⑨读函数没了', ERPDB_PY,
     [('def get_all_role_end(tenant_id=None):', 'def _DISABLED_get_all_role_end(tenant_id=None):')],
     'ROLE_REG_ERPDB', 'erp_db 定义了 role_end 的读'),
    ('⑩缓存不失效', SERVER_PY,
     [('reload_role_end(tid)', 'pass')],
     'ROLE_REG_SERVER', '两处写入口都让本租户缓存失效'),
    ('⑪两端全关', SERVER_PY,
     [('    if not web and not mini:', '    if False:')],
     'ROLE_REG_SERVER', '保存端点对「两端都不勾」硬拒'),
    ('⑫路由拼错', SERVER_PY,
     [('@app.post("/api/role-permissions/end")', '@app.post("/api/role-permission/end")')],
     'ROLE_REG_SERVER', 'server.py 有 POST /api/role-permissions/end'),
    ('⑬表驱动不过滤', SHELL_VUE,
     [('canSee(it.path)', "canSee('')")],
     'ROLE_REG_SHELL', 'Shell.vue 导航表里的 /forecast 条目真的过了 canSee'),
    ('⑭前端路径拼错', SETTINGS,
     [("api('/api/role-permissions/end'", "api('/api/role-permission/end'")],
     'ROLE_REG_SETTINGS', 'Settings.vue 提交端的路径与后端逐字一致'),
]

# 「必须**不**报红」：只改注释 / 文档字符串里的字样（真实现仍在）——
# 专门证明 v312 把 `func_body_has` 收紧成「排 docstring + 排注释」不是摆设。
MUST_PASS_CASES = [
    ('⑮ 只把 `default_login_scope_for_role` **docstring** 里的 `ROLE_LOGIN_SCOPE` 字样改掉',
     CORE_PY,
     [('`ROLE_LOGIN_SCOPE`（内置常量）', '`ROLE_LOGIN_SCOPE_XX`（内置常量）')],
     'ROLE_REG_CORE'),
    ('⑯ 只把 `builtin_role_end` **docstring** 里的 `ROLE_LOGIN_SCOPE` 字样改掉',
     CORE_PY,
     [('由 `ROLE_LOGIN_SCOPE` 派生', '由 `ROLE_LOGIN_SCOPE_XX` 派生')],
     'ROLE_REG_CORE'),
]

print('=' * 66)
print('正例：原文件 ⇒ 必须 0 失败（证明没有假红）')
rc, total, failed = run_guard()
print('  退出码 %d | %s | 失败项 %s' % (rc, total, failed or '无'))
ok_pos = (rc == 0 and not failed)
print('  ⇒ %s' % ('✅ 正例通过' if ok_pos else '❌ 正例失败（有假红）'))
print('=' * 66)

all_ok = ok_pos
for tag, path, subst, envk, expect in CASES:
    print('')
    print('反例 %s' % tag)
    for a, b in subst:
        print('    替换: %s\n' % repr(a[:70]).replace('\\\\n', '\\n')
              + '      →: %s' % repr(b[:70]))
    rc, total, failed = broken(path, subst, envk, tag)
    hit = any(expect in f for f in failed)
    ok = (rc == 1 and hit)
    all_ok = all_ok and ok
    print('  退出码 %d | %s' % (rc, total))
    print('  失败项：')
    for f in failed:
        print('     - ' + f)
    print('  ⇒ %s（期望命中「%s」）' % (
        '✅ 被判红且命中期望断言' if ok
        else ('⚠️ 报红了但**未命中**期望断言' if rc == 1 else '❌ 竟然没报红'),
        expect))

print('')
for title, path, subst, envk in MUST_PASS_CASES:
    print('不误报 %s' % title)
    rc, total, failed = broken(path, subst, envk, title)
    ok = (rc == 0 and not failed)
    all_ok = all_ok and ok
    print('  退出码 %d | %s | 失败项 %s' % (rc, total, failed or '无'))
    print('  ⇒ %s' % ('✅ 未误报（判据认的是代码，不是 docstring 里的字样）'
                      if ok else '❌ 被 docstring 骗了（假红）'))

print('')
print('=' * 66)
print('判别力自证：%s' % ('✅ 全部通过（%d 反例 + %d 不误报 + 1 正例）'
                      % (len(CASES), len(MUST_PASS_CASES))
                      if all_ok else '❌ 有未通过项'))
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(0 if all_ok else 1)
