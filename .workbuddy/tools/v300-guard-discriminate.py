#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v300 护栏判别力自证 —— 造 4 个"被改坏的副本"，护栏**必须**报红。

🔴 为什么必须有这一步（本项目纪律，见 `local-machine-pitfalls` §12）：
   护栏从 35/37 变成 44/44 **不是**证据 —— 也可能是"我改的判据其实什么都不判"。
   唯一能证明判据有效的方法：**正反两侧都跑**。
     · 正例：原文件 ⇒ 必须 0 失败（证明没有假红）
     · 反例：每个新判据各造一个"该被抓住"的坏副本 ⇒ 必须报红（证明有判别力）

跑法：
    python3 .workbuddy/tools/v300-guard-discriminate.py
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
EMP = os.path.join(FE_REPO, 'hergent-cn-v2', 'src', 'pages', 'EmployeeArchive.vue')
ROLES = os.path.join(FE_REPO, 'hergent-cn-v2', 'src', 'constants', 'roles.js')
FS_PY = os.path.join(ERP, 'server', 'routers', 'forecast_submissions.py')
CORE_PY = os.path.join(ERP, 'server', 'core.py')

TMP = tempfile.mkdtemp(prefix='v300-guard-')


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
    """把 src_path 复制到临时目录、做一次字符串替换，返回该反例的运行结果。"""
    dst = os.path.join(TMP, os.path.basename(src_path))
    shutil.copyfile(src_path, dst)
    s = open(dst, encoding='utf-8').read()
    before = s
    for a, b in subst:
        s = s.replace(a, b)
    if s == before:
        raise SystemExit('反例 %s：字符串替换没生效（待替换文本已变），自证无效！' % tag)
    open(dst, 'w', encoding='utf-8').write(s)
    return run_guard({env_key: dst})


CASES = [
    ('① 员工档案把下拉改回**写死数组**（v300 修的缺陷本身）', EMP,
     [('const BUILTIN_ROLE_ORDER = [', 'const ROLE_OPTIONS = [ {\nconst BUILTIN_ROLE_ORDER = [')],
     'ROLE_REG_EMPARCHIVE', 'ROLE_OPTIONS 不再写死'),
    ('② ROLE_END 把 staff 从「仅小程序」改成「仅网页端」（文案与权限脱钩）', ROLES,
     [("staff: 'mini'", "staff: 'web'")],
     'ROLE_REG_CONST', '标了「小程序」的角色集'),
    ('③ 开账号接口删掉白名单调用（只校验非空 = 提权口子）', FS_PY,
     [('normalize_role', 'normalize_role_DISABLED')],
     'ROLE_REG_FS', '接入了白名单'),
    ('④ 后端 sales 丢掉 `data`（判据收窄后仍须能发现真丢权限）', CORE_PY,
     [('"sales": ["dashboard", "ops-workbench", "sales", "buying", "stock", "crm", "data", "chat", "cron", "bid"]',
       '"sales": ["dashboard", "ops-workbench", "sales", "buying", "stock", "crm", "chat", "cron", "bid"]')],
     'ROLE_REG_CORE', '标了「小程序」的角色集'),
]

# 「必须**不**报红」的反例：证明判据认的是**真调用**，不是注释里的字样。
MUST_PASS_CASES = [
    ('⑤ 只把**注释**里的 `core.normalize_role` 改成占位串（真调用仍在）⇒ 不得报红',
     FS_PY, [('判据唯一来源 = core.normalize_role', '判据唯一来源 = core.XXXXX')],
     'ROLE_REG_FS'),
]

print('=' * 66)
print('正例：原文件 ⇒ 必须 0 失败（证明没有假红）')
rc, total, failed = run_guard()
print('  退出码 %d | %s | 失败项 %s' % (rc, total, failed or '无'))
ok_pos = (rc == 0 and not failed)
print('  ⇒ %s' % ('✅ 正例通过' if ok_pos else '❌ 正例失败（有假红）'))
print('=' * 66)

all_ok = ok_pos
for title, path, subst, envk, expect_assert in CASES:
    print('')
    print('反例 %s' % title)
    rc, total, failed = run_guard() if False else broken(path, subst, envk, title)
    hit = any(expect_assert in f for f in failed)
    ok = (rc == 1 and hit)
    all_ok = all_ok and ok
    print('  退出码 %d | %s' % (rc, total))
    print('  失败项：')
    for f in failed:
        print('     - ' + f)
    print('  ⇒ %s（期望命中「%s」）' % (
        '✅ 被判红且命中期望断言' if ok
        else ('⚠️ 报红了但**未命中**期望断言' if rc == 1 else '❌ 竟然没报红'),
        expect_assert))

print('')
for title, path, subst, envk in MUST_PASS_CASES:
    print('反例 %s' % title)
    rc, total, failed = broken(path, subst, envk, title)
    ok = (rc == 0 and not failed)
    all_ok = all_ok and ok
    print('  退出码 %d | %s | 失败项 %s' % (rc, total, failed or '无'))
    print('  ⇒ %s' % ('✅ 未误报（判据认的是调用，不是注释里的字样）' if ok else '❌ 被注释骗了（假红）'))

print('')
print('=' * 66)
print('判别力自证：%s' % ('✅ 全部通过（4 反例 + 1 正例 + 1 不误报）' if all_ok else '❌ 有未通过项'))
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(0 if all_ok else 1)
