#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v325 撤 chat 工具的单测（合成影子库 + 真实源码，不碰生产）。

覆盖：
  A 纯函数：strip_module / canon / plan_one 的保护角色与形态判定
  B 端到端：真写一个临时库 ⇒ 断言「撤了 chat / 其它模块一个没动 / 行数不变 / 形态不变」
  C 幂等：第二次跑必须「将变更 0 行」
  D 反例：坏 JSON 行必须被跳过（不猜、不写）
  E 破坏性读数必须为 0
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, 'perms-tenant-revoke-chat.py')
CORE = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'hergent-erp', 'server', 'core.py'))

PASS = FAIL = 0


def ck(cond, label, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  ✅ %s' % label)
    else:
        FAIL += 1
        print('  ❌ %s %s' % (label, detail))


def mkdb(path, rows):
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE role_permissions (id INTEGER PRIMARY KEY, role_name TEXT, '
                'permissions TEXT, created_at TEXT)')
    for r, p in rows:
        con.execute('INSERT INTO role_permissions (role_name, permissions) VALUES (?,?)',
                    (r, p if isinstance(p, str) else json.dumps(p, ensure_ascii=False)))
    con.commit()
    con.close()


def dump(path):
    con = sqlite3.connect(path)
    out = {}
    for r, p in con.execute('SELECT role_name, permissions FROM role_permissions').fetchall():
        try:
            out[r] = json.loads(p)
        except Exception:
            out[r] = ('BAD', p)
    n = con.execute('SELECT COUNT(*) FROM role_permissions').fetchone()[0]
    con.close()
    return out, n


def run(db, *extra):
    return subprocess.run([sys.executable, TOOL, '--db', db, '--core', CORE] + list(extra),
                          capture_output=True, text=True)


def main():
    print('=== A 纯函数 ===')
    sys.path.insert(0, HERE)
    import importlib.util
    spec = importlib.util.spec_from_file_location('revoke', TOOL)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)

    ck(m.strip_module(['chat', 'data'], 'chat') == (['data'], True), "list 形态撤 chat")
    ck(m.strip_module(['data'], 'chat') == (['data'], False), "list 无 chat ⇒ 不变更")
    ck(m.strip_module({'chat': ['read'], 'data': ['read']}, 'chat') == ({'data': ['read']}, True),
       "dict 形态撤 chat 且保持 dict")
    ck(isinstance(m.strip_module({'chat': ['read'], 'data': ['read']}, 'chat')[0], dict), "dict 形态未被转成 list")
    ck(m.strip_module('chat,data', 'chat')[1] is False, "字符串形态不处理（不猜）")
    ck(m.canon(None) is None and m.canon(['b', 'a']) == ['a', 'b'], "canon 等价实现")

    defaults = m.load_default_perms(CORE)
    ck(sorted([r for r, v in defaults.items() if 'chat' in v or '*' in v]) == ['admin', 'boss'],
       "AST 读到内置默认只有 admin/boss 持 chat（= v325 后端改动已在位）")

    plan, skipped = m.plan_one({'admin': ['*'], 'boss': ['chat', 'hr'], 'sales': ['chat', 'data']}, defaults)
    roles = [x[0] for x in plan]
    ck(roles == ['sales'], "保护角色被排除（只动 sales）", str(roles))
    ck(any(r == 'admin' and '保护角色' in w for r, w in skipped), "admin 留痕跳过")
    ck(any(r == 'boss' and '保护角色' in w for r, w in skipped), "boss 留痕跳过")

    print()
    print('=== B 端到端（真写临时库）===')
    tmp = tempfile.mkdtemp(prefix='v325-test-')
    try:
        db = os.path.join(tmp, 'tenant_99.db')
        before = [
            ('admin', {'*': ['read']}),                                   # dict 形态 + 保护角色
            ('boss', {'chat': ['read'], 'hr': ['read']}),                  # 保护角色 + dict
            ('库管', ['chat', 'dashboard', 'data', 'stock']),               # 自定义角色
            ('supervisor', ['chat', 'cron', 'dashboard', 'data', 'sales']),  # 会等于内置默认？
            ('driver', ['chat', 'dashboard', 'stock']),                    # 撤后 == 内置默认（副作用）
            ('accountant', ['accounts', 'bid', 'chat', 'dashboard', 'marketing', 'reports']),  # 有客户加的 bid
            ('zombie', 'not-a-json{{'),                                    # 坏 JSON 反例
        ]
        mkdb(db, before)
        src, n0 = dump(db)

        r = run(db, '--backup-root', tmp, '--apply')
        ck(r.returncode == 0, 'APPLY 退出码 0', r.stderr[-400:])
        aft, n1 = dump(db)

        ck(n1 == n0, '🔴 行数不变（绝不删行）', '%d → %d' % (n0, n1))
        ck('zombie' in aft and aft['zombie'][0] == 'BAD', '坏 JSON 行仍在且未被改（跳过）')
        ck('chat' not in aft['admin'].get('*', []) if isinstance(aft['admin'], dict) else False,
           'admin 的 * 未被误当模块名删除')
        ck(aft['boss'] == {'chat': ['read'], 'hr': ['read']},
           '🔒 boss 的 chat 逐字保留（保护角色，形状不变）', str(aft['boss']))
        ck(isinstance(aft['boss'], dict), 'boss 行形态仍是 dict（未归一化）')
        ck(aft['库管'] == ['dashboard', 'data', 'stock'], '库管：撤 chat，余 3 项逐字保留', str(aft['库管']))
        ck(aft['supervisor'] == ['cron', 'dashboard', 'data', 'sales'], 'supervisor：撤 chat 且保留 sales/cron',
           str(aft['supervisor']))
        ck(aft['accountant'] == ['accounts', 'bid', 'dashboard', 'marketing', 'reports'],
           '🔴 客户自己加的 `bid` 未被丢掉（不删行/不回落默认）', str(aft['accountant']))
        ck(aft['driver'] == ['dashboard', 'stock'], 'driver：撤 chat', str(aft['driver']))

        # 逐行集合对比：除 chat 外不许有任何模块进出
        for role, oldv in src.items():
            newv = aft.get(role)
            if isinstance(oldv, dict) and isinstance(newv, dict):
                o, nn = set(oldv.keys()), set(newv.keys())
            elif isinstance(oldv, list) and isinstance(newv, list):
                o, nn = set(oldv), set(newv)
            else:
                continue
            ck(sorted(o - nn) in ([], ['chat']) and not (nn - o),
               '逐行无越界改动：%s' % role, 'lost=%s gained=%s' % (sorted(o - nn), sorted(nn - o)))

        ck('破坏性收紧      = 0' in r.stdout, 'E 破坏性收紧读数为 0')
        ck('⚠️ 副作用' in r.stdout and 'driver' in r.stdout, '副作用被显式报告（driver 改后=内置默认）')
        ck('rollback-v325' in r.stdout, '生成 rollback.sql')

        print()
        print('=== C 幂等（再跑一遍）===')
        r2 = run(db, '--backup-root', tmp, '--apply')
        ck('将变更 0 行' in r2.stdout, '第二遍：将变更 0 行', r2.stdout[-300:])

        print()
        print('=== D 回滚脚本可执行 ===')
        import re
        rb = re.search(r'回滚脚本\s+=\s+(\S+)', r.stdout)
        ck(bool(rb), '找到 rollback 路径')
        if rb and os.path.exists(rb.group(1)):
            sql = open(rb.group(1), encoding='utf-8').read()
            con = sqlite3.connect(db)
            for stmt in [s for s in sql.split('\n') if s.strip().startswith('UPDATE')]:
                con.execute(stmt.split('  --')[0])
            con.commit()
            con.close()
            back, _ = dump(db)
            ck(all(back[k] == (list(v) if isinstance(v, list) else v) for k, v in src.items()
                   if k not in ('zombie',)), '回滚后逐行恢复原值', str(back.get('库管')))
            # 二次清理：把 rollback 文件挪走，避免影响后续
        else:
            ck(False, 'rollback 文件存在', str(rb))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    print('===== %d 通过 / %d 失败 =====' % (PASS, FAIL))
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == '__main__':
    main()
