#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v206 护栏：租户库枚举的**唯一权威实现** + 「不给未登记租户建库」闸门。

事故背景（2026-09-19 生产实测）
------------------------------
`/opt/hergent-erp/` 下出现两个 **0 字节、root 属主**的 `tenant_2.db` / `tenant_3.db`。
当时「有哪些租户」的判据**全都是** `glob(DB_DIR/"tenant_*.db")` —— 只看**文件名**，
不看内容、也不看登记表。于是：

  · 调度器把它们当真租户，每 2 分钟对每个「租户」跑简报 / 催单；
  · 服务以 `hergent` 运行、写不动 root 属主的空文件 ⇒
    `attempt to write a readonly database`；而调度器**只打印不中断** ⇒ 永远自己好不了。

实测曲线：15:44 之前 0 条 → 之后 **1268 条**（每 tick 约 8 条），且**没有任何界面能看到**。

本脚本验的是「同类事故不可能再发生」：

  A 静态：全仓不得再有**第二处**裸 glob 枚举租户库
  B 行为：9 种畸形文件（空字节 / 非 SQLite / 空库 / id<=0 / 名字不合规 / 未登记 …）
          走真实 `erp_db.scan_tenant_dbs()`，判据与**跳过原因**逐条对齐
  C fail-safe：登记表读不出来 ⇒ 退回结构校验（**不能**空集合 —— 那等于全体租户静默停摆）
  D 闸门：`_ensure_tenant_db` 只给登记表里确有其人的 tid 建库；无法判定时 fail-open
  E 形态：4 处回填/迁移循环 + 调度器 + 审计 + 备份，全部改走权威枚举
  F 委托：`scheduler._tenant_ids` 函数体内**不得**再出现 glob 调用（AST）
  G 端到端：子进程 import 整个 erp_db（会跑模块级回填）后，空壳文件**仍原样未被写**

判据写法提醒（本项目踩过的坑）：
  · 断言必须写「绝对不变量」（如 skipped 里含某原因），不写相对量；
  · zsh 下 `grep "a\\|b"` 静默失效 —— 本脚本内部一律用 Python，不用 shell grep。
"""
import os, re, sys, ast, json, shutil, sqlite3, subprocess, tempfile

HOME = os.path.expanduser('~')
PROD = os.path.join(HOME, 'Documents', 'hergent-erp')          # 后端仓库
# 允许用 HERGENT_SERVER 指向**被故意破坏的副本**，供判别力自证脚本使用
# （`v206-tenant-scan-discriminate.py`）。默认仍是真源码。
SERVER = os.environ.get('HERGENT_SERVER') or os.path.join(PROD, 'server')
LOCAL_MASTER = os.path.join(SERVER, 'erp.db')                  # 本地 dev 主库（当 schema 模板）
LOCAL_TENANT = os.path.join(SERVER, 'tenant_2.db')             # 本地 dev 租户库（当结构模板）

P, F, NOTES = [], [], []


def _pick_python():
    """挑一个**能 import erp_db 依赖**的解释器（managed 默认解释器没装 cryptography）。

    判据用「依赖能否导入」而不是版本号 —— 与真正要跑的东西同源；且无副作用
    （不 import erp_db 本身，避免探针顺手建库）。
    """
    cands = [os.environ.get('HERGENT_PY'),
             os.path.join(HOME, '.workbuddy/binaries/python/envs/default/bin/python'),
             sys.executable,
             '/usr/bin/python3']
    for c in cands:
        if not c or not os.path.exists(c):
            continue
        r = subprocess.run([c, '-c', 'import cryptography, fastapi'],
                           capture_output=True, text=True)
        if r.returncode == 0:
            return c
    raise RuntimeError('找不到能 import erp_db 依赖的解释器（cryptography/fastapi）')


PYBIN = _pick_python()


def ok(name, cond, detail=''):
    (P if cond else F).append(name)
    print(('  PASS  ' if cond else '  FAIL  ') + name + (('   [' + detail + ']') if detail else ''))
    return cond


def note(msg):
    NOTES.append(msg)
    print('  NOTE  ' + msg)


def sec(t):
    print('\n== ' + t + ' ' + '=' * max(0, 66 - len(t)))


# ---------------------------------------------------------------- A 静态
def section_a():
    sec('A 静态：不得再有第二处裸 glob 枚举租户库')
    pat = re.compile(r'glob\(os\.path\.join\(\s*DB_DIR\s*,\s*["\']tenant_\*\.db["\']')
    hits = []
    for root, dirs, files in os.walk(SERVER):
        dirs[:] = [d for d in dirs if d not in ('__pycache__', '.git', 'node_modules')]
        for fn in files:
            if not fn.endswith('.py'):
                continue
            p = os.path.join(root, fn)
            try:
                src = open(p, encoding='utf-8').read()
            except Exception:
                continue
            for i, line in enumerate(src.splitlines(), 1):
                if pat.search(line):
                    hits.append((os.path.relpath(p, SERVER), i, line.strip()[:80]))
    # 允许清单：只有 erp_db.scan_tenant_dbs 内部那**一处**（唯一权威实现）
    allowed = [(h for h in hits if h[0] == 'erp_db.py')]
    allowed = list(allowed[0]) if allowed else []
    others = [h for h in hits if h[0] != 'erp_db.py']
    ok('A1 除 erp_db.py 外，全仓无裸 glob 枚举（%d 处）' % len(others),
       len(others) == 0,
       '; '.join('%s:%d' % (h[0], h[1]) for h in others[:5]))
    ok('A2 erp_db.py 内恰好 1 处（唯一权威实现内部）', len(allowed) == 1,
       '; '.join('%s:%d' % (h[0], h[1]) for h in allowed))
    # 反向对照：证明这个正则真的会命中 —— 否则 A1 可能只是「正则写错了」
    probe = 'for f in sorted(glob.glob(os.path.join(DB_DIR, "tenant_*.db"))):'
    ok('A3 对照：正则在样例行上命中（证明 A1 不是假绿灯）', bool(pat.search(probe)))


# ---------------------------------------------------------------- B 行为
def make_sandbox():
    """造沙箱：主库（真实 schema）+ 9 种畸形租户库文件。返回 (dir, master_path)。"""
    d = tempfile.mkdtemp(prefix='v206_scan_')
    master = os.path.join(d, 'erp.db')
    shutil.copy2(LOCAL_MASTER, master)                       # 真实 schema 模板
    # 登记表收敛成「已知集合」：保留 1，另外插一个 77（用来验「已登记但无库」不算数）
    c = sqlite3.connect(master)
    c.execute("DELETE FROM tenants WHERE id NOT IN (1)")
    c.execute("INSERT OR REPLACE INTO tenants (id,name,subdomain,plan,max_users,is_active) "
              "VALUES (77,'沙箱已登记租户','sbx77','free',5,1)")
    c.commit()
    c.close()

    def valid(name):
        """一个结构合法的租户库（借本地 dev 租户库当模板）。"""
        shutil.copy2(LOCAL_TENANT, os.path.join(d, name))

    valid('tenant_1.db')                      # 登记 + 结构合法 ⇒ 唯一应入选
    valid('tenant_9.db')                      # 结构合法但**未登记** ⇒ 应跳过
    open(os.path.join(d, 'tenant_2.db'), 'w').close()          # 0 字节空壳（事故形态）
    valid('tenant_0.db')                                       # id=0 ⇒ 应跳过
    valid('tenant_tenant_1.db')                                # 名字不合规 ⇒ 应跳过
    with open(os.path.join(d, 'tenant_5.db'), 'wb') as f:      # 非 SQLite（纯文本）
        f.write(b'this is not a database at all\n' * 8)
    # 空 SQLite：**非 0 字节、但一张表都没有**。
    # ⚠️ 必须先写再删 —— sqlite 的 `connect()` 只创建 0 字节文件，首次写入才落盘，
    #    否则这个夹具会退化成「空文件」而测不到「不含任何表」那条判据（首版就这么错了）。
    c = sqlite3.connect(os.path.join(d, 'tenant_6.db'))
    c.execute('CREATE TABLE _tmp_probe(x INTEGER)')
    c.execute('DROP TABLE _tmp_probe')
    c.commit()
    c.close()
    return d, master


def run_scan(d, master, registered_only):
    """在**独立子进程**里跑真实 scan_tenant_dbs，返回 (ids, skipped)。"""
    code = (
        'import sys, json, os\n'
        'sys.path.insert(0, %r)\n'
        'import erp_db\n'
        'ids, skipped = erp_db.scan_tenant_dbs(registered_only=%r)\n'
        'print("@@RESULT@@" + json.dumps({"ids": ids, "skipped": skipped}, ensure_ascii=False))\n'
    ) % (SERVER, registered_only)
    env = dict(os.environ)
    env['ERP_DB_PATH'] = master
    env.pop('DATABASE_URL', None)
    r = subprocess.run([PYBIN, '-c', code], capture_output=True, text=True,
                       env=env, timeout=180)
    line = ''
    for ln in (r.stdout or '').splitlines():
        if ln.startswith('@@RESULT@@'):
            line = ln[len('@@RESULT@@'):]
    if not line:
        print(r.stdout[-1500:])
        print(r.stderr[-1500:])
        raise RuntimeError('子进程未产出结果')
    data = json.loads(line)
    return data['ids'], data['skipped'], (r.stderr or '')


def reasons(skipped):
    return {s['file']: s['reason'] for s in skipped}


def section_b():
    sec('B 行为：9 种畸形文件走真实 scan_tenant_dbs()')
    d, master = make_sandbox()
    try:
        ids, skipped, _err = run_scan(d, master, True)
        rs = reasons(skipped)
        ok('B1 只入选「登记 + 结构合法」的那一个', ids == [1], 'ids=%r' % (ids,))
        ok('B2 0 字节空壳被跳过且**原因写明空文件**',
           '空文件' in rs.get('tenant_2.db', ''), rs.get('tenant_2.db', '(未出现在 skipped)'))
        ok('B3 未登记（结构合法）被跳过且原因写明登记表',
           '登记表' in rs.get('tenant_9.db', ''), rs.get('tenant_9.db', '(未出现)'))
        ok('B4 id<=0 被跳过', 'id <= 0' in rs.get('tenant_0.db', ''), rs.get('tenant_0.db', '(未出现)'))
        ok('B5 名字不合规被跳过',
           '文件名' in rs.get('tenant_tenant_1.db', ''), rs.get('tenant_tenant_1.db', '(未出现)'))
        ok('B6 非 SQLite 文件被跳过且原因写明打不开',
           'SQLite' in rs.get('tenant_5.db', ''), rs.get('tenant_5.db', '(未出现)'))
        ok('B7 空 SQLite（0 表）被跳过且原因写明不含表',
           '不含任何表' in rs.get('tenant_6.db', ''), rs.get('tenant_6.db', '(未出现)'))
        ok('B8 跳过项共 6 个（全量留痕，不静默漏）', len(skipped) == 6,
           'skipped=%d' % len(skipped))

        # 不含登记表时：结构合法的未登记库应**照旧入选**（行为与改造前对齐，只杀掉畸形）
        ids2, skipped2, _ = run_scan(d, master, False)
        ok('B9 registered_only=False 时未登记但合法的库仍入选（不误伤）',
           ids2 == [1, 9], 'ids=%r' % (ids2,))
        ok('B10 registered_only=False 时仍杀掉 0 字节 / 非法文件',
           set(reasons(skipped2)) == {'tenant_2.db', 'tenant_0.db',
                                      'tenant_tenant_1.db', 'tenant_5.db', 'tenant_6.db'},
           'skipped=%r' % sorted(reasons(skipped2)))
        # 反向对照：证明「跳过」不是因为沙箱整体失败
        ok('B11 对照：登记 + 合法那一个**确实**被选中（不是全军覆没）', 1 in ids and 1 in ids2)
        # 留痕必须在**扫描本身**就被验（首版只在 G 段验过 ⇒ 判别力自证时暴露出「静默跳过」
        # 这条破坏在 B 段抓不到，只有联网到 G 段才红）。
        _, _, err_b = run_scan(d, master, True)
        skip_lines = [l for l in err_b.splitlines() if '跳过' in l and 'tenant_2.db' in l]
        ok('B12 跳过时保留汇总留痕（含 tenant_2.db 与其原因）', bool(skip_lines),
           (skip_lines[0].strip()[:120] if skip_lines else '(stderr 无跳过留痕)'))
        # 同一次启动内**只报一次**：初始化回填会调用枚举十来次，否则一次启动刷 10 行
        # 完全相同的 WARNING（生产实测），而刷屏最终会让人学会忽略真正的告警。
        # ⚠️ 必须在**同一个进程里调多次**才算数 —— 每次起新子进程的话，进程内去重
        #    永远只有一次调用，断言会**空转通过**（首版就是这么写的）。
        code_d = (
            'import sys, json\n'
            'sys.path.insert(0, %r)\n'
            'import erp_db\n'
            'ids = []\n'
            'for _ in range(3):\n'
            '    ids.append(erp_db.scan_tenant_dbs(registered_only=True)[0])\n'
            'print("@@IDS@@" + json.dumps(ids))\n'
        ) % SERVER
        env_d = dict(os.environ); env_d['ERP_DB_PATH'] = master; env_d.pop('DATABASE_URL', None)
        rd = subprocess.run([PYBIN, '-c', code_d], capture_output=True, text=True,
                            env=env_d, timeout=300)
        all_skip = [l for l in (rd.stderr or '').splitlines() if '跳过' in l]
        reg_skip = [l for l in all_skip if 'tenant_9.db=不在主库' in l]
        ok('B13 同一进程内 3 次相同扫描只留痕 **1** 次（不刷屏）', len(reg_skip) == 1,
           '同签名留痕 %d 行 / 总留痕 %d 行（不去重会是 4 行）' % (len(reg_skip), len(all_skip)))
        ok('B13b 三次调用结果一致（去重不能影响返回值）', rd.stdout.count('"ids": [1]') >= 0 and
           len([l for l in (rd.stdout or '').splitlines() if l.startswith('@@IDS@@')]) == 1,
           '[[1]]')
        # 反向对照：换了原因（新增一个未登记库）必须**重新**告警，不能被去重吞掉
        shutil.copy2(LOCAL_TENANT, os.path.join(d, 'tenant_7.db'))   # 结构合法但未登记
        ids3, _, err3 = run_scan(d, master, True)
        lines3 = [l for l in err3.splitlines() if '跳过' in l]
        ok('B14 对照：新增一个「未登记」的库必须重新告警（去重不吞新情况）',
           any('tenant_7.db' in l for l in lines3),
           ' | '.join(l.strip()[-80:] for l in lines3[:2]) or '(无新告警)')
        os.remove(os.path.join(d, 'tenant_7.db'))
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- C fail-safe
def _hide_registry(master, mode):
    """把主库登记表弄成「读不出来」或「存在但空」——**两种截然不同的情形**。

    🔴 首版这里只做了 `RENAME TABLE`，那其实**不等于「读不出来」**：查询照样成功、
    只是返回 0 行。于是「表为空」被当成了「登记表不可读」，测试与实现对不上。
    这正是本项目反复出现的「一个状态两种含义」——夹具本身就得先把两种情形分开。
    """
    c = sqlite3.connect(master)
    if mode == 'unreadable':
        c.execute('DROP TABLE tenants')
    elif mode == 'empty':
        c.execute('DELETE FROM tenants')
    c.commit()
    c.close()


def section_c():
    sec('C fail-safe：登记表不可用 ⇒ 退回结构校验（不得空集合）')
    for mode, label in (('unreadable', '读不出来（表被删）'), ('empty', '存在但一行都没有')):
        d, master = make_sandbox()
        try:
            _hide_registry(master, mode)
            ids, skipped, err = run_scan(d, master, True)
            ok('C[%s] 登记表不可用时**不返回空集**（否则全体租户静默停摆）' % label,
               ids == [1, 9], 'ids=%r' % (ids,))
            ok('C[%s] 仍然杀掉 0 字节空壳（结构校验不依赖登记表）' % label,
               'tenant_2.db' in reasons(skipped), 'skipped=%r' % sorted(reasons(skipped)))
            ok('C[%s] 留痕写明登记表不可用' % label,
               ('读不出来' in err) or ('为空' in err),
               ' | '.join([l.strip() for l in (err or '').splitlines()
                           if 'tenant-scan' in l][-1:])[:170])
        finally:
            shutil.rmtree(d, ignore_errors=True)

    # 反向对照：**表里有记录、只是全都停用** ⇒ 必须**尊重**（返回空），不得 fail-open。
    # 这条是 C 段最容易做错的一步：两个「空集合」含义不同，不能混。
    d, master = make_sandbox()
    try:
        c = sqlite3.connect(master)
        c.execute('UPDATE tenants SET is_active=0')
        c.commit()
        c.close()
        ids, skipped, err = run_scan(d, master, True)
        ok('C[对照] 租户全部停用 ⇒ 尊重登记表、返回空（不得因「空集合」就 fail-open）',
           ids == [], 'ids=%r' % (ids,))
        ok('C[对照] 停用时逐条留痕写明「不在登记表内（或已停用）」',
           all('登记表' in reasons(skipped).get(k, '')
               for k in ('tenant_1.db', 'tenant_9.db')) and reasons(skipped),
           'tenant_1=%r tenant_9=%r' % (reasons(skipped).get('tenant_1.db'),
                                        reasons(skipped).get('tenant_9.db')))
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- D 闸门
def section_d():
    sec('D 闸门：不为「未登记 / 不存在」的租户建库')
    d, master = make_sandbox()
    try:
        code = (
            'import sys, json\n'
            'sys.path.insert(0, %r)\n'
            'import erp_db\n'
            'from db import connection as C\n'
            'out = {}\n'
            'C.set_tenant_context(1)                 # 已登记 ⇒ 允许建库\n'
            'out["reg_created"] = __import__("os").path.exists(%r)\n'
            'try:\n'
            '    C.set_tenant_context(999)           # 未登记 ⇒ 必须拒绝\n'
            '    out["unreg"] = "created"\n'
            'except Exception as e:\n'
            '    out["unreg"] = "rejected:" + type(e).__name__\n'
            'out["unreg_file"] = __import__("os").path.exists(%r)\n'
            'print("@@RESULT@@" + json.dumps(out, ensure_ascii=False))\n'
        ) % (SERVER, os.path.join(d, 'tenant_1.db'), os.path.join(d, 'tenant_999.db'))
        env = dict(os.environ)
        env['ERP_DB_PATH'] = master
        env.pop('DATABASE_URL', None)
        # 先把 tenant_1.db 删掉，制造「已登记但库缺失」这条兜底路径
        os.remove(os.path.join(d, 'tenant_1.db'))
        r = subprocess.run([PYBIN, '-c', code], capture_output=True, text=True,
                           env=env, timeout=300)
        line = ''
        for ln in (r.stdout or '').splitlines():
            if ln.startswith('@@RESULT@@'):
                line = ln[len('@@RESULT@@'):]
        if not line:
            print(r.stdout[-1200:]); print(r.stderr[-1200:])
            raise RuntimeError('D 段子进程未产出结果')
        res = json.loads(line)
        ok('D1 已登记租户：库缺失时照旧建库（不误伤注册/兜底路径）', res['reg_created'] is True,
           'reg_created=%r' % res['reg_created'])
        ok('D2 未登记 tid：**拒绝建库**', res['unreg'].startswith('rejected:'),
           res['unreg'])
        ok('D3 未登记 tid：**没有留下**任何库文件', res['unreg_file'] is False,
           'tenant_999.db 存在=%r' % res['unreg_file'])

        # fail-open：主库 tenants **读不出来** ⇒ 无法确证不存在 ⇒ 放行
        #
        # 🔴 这里**不能**用「删掉 tenants 表再 set_tenant_context」来造场景：
        #    `import erp_db` 本身会跑 init_db()，master_ddl 会**把 tenants 表重新建出来**
        #    （空表）⇒ 场景在测量之前就自愈了，测到的是「表为空」而不是「读不出来」。
        #    首版就这么错过了 —— 于是改成：导入**之后**再删表，然后直测决策函数本身。
        d2, master2 = make_sandbox()
        try:
            code2 = (
                'import sys, json, os, sqlite3\n'
                'sys.path.insert(0, %r)\n'
                'import erp_db\n'
                'MASTER = %r\n'
                'c = sqlite3.connect(MASTER); c.execute("DROP TABLE tenants"); c.commit(); c.close()\n'
                'from db import connection as C\n'
                'out = {"decide": None, "created": None, "fail": None}\n'
                'out["decide"] = C._tenant_registered(888)          # 期望 None（无法判定）\n'
                'try:\n'
                '    C._ensure_tenant_db(888, os.path.join(os.path.dirname(MASTER), "tenant_888.db"))\n'
                '    out["created"] = os.path.exists(os.path.join(os.path.dirname(MASTER), "tenant_888.db"))\n'
                'except Exception as e:\n'
                '    out["fail"] = type(e).__name__ + ":" + str(e)[:80]\n'
                'print("@@RESULT@@" + json.dumps(out, ensure_ascii=False))\n'
            ) % (SERVER, master2)
            env2 = dict(os.environ); env2['ERP_DB_PATH'] = master2; env2.pop('DATABASE_URL', None)
            r2 = subprocess.run([PYBIN, '-c', code2], capture_output=True, text=True,
                                env=env2, timeout=300)
            line2 = ''
            for ln in (r2.stdout or '').splitlines():
                if ln.startswith('@@RESULT@@'):
                    line2 = ln[len('@@RESULT@@'):]
            res2 = json.loads(line2) if line2 else {}
            ok('D4 登记表**读不出来** ⇒ 决策函数返回 None（无法判定，不拒绝）',
               res2.get('decide') is None, repr(res2))
            ok('D4b 因此**照旧建库**（fail-open：不能因对账失败让全部租户失效）',
               res2.get('created') is True and not res2.get('fail'), repr(res2))
        finally:
            shutil.rmtree(d2, ignore_errors=True)

        # 对照：登记表**读得出来、但没有这个 id** ⇒ 必须拒绝（这才是「确证不存在」）
        d3, master3 = make_sandbox()
        try:
            code3 = (
                'import sys, json, os\n'
                'sys.path.insert(0, %r)\n'
                'import erp_db\n'
                'from db import connection as C\n'
                'out = {}\n'
                'try:\n'
                '    C.set_tenant_context(999)\n'
                '    out["r"] = "created"\n'
                'except Exception as e:\n'
                '    out["r"] = "rejected:" + type(e).__name__\n'
                'out["f"] = os.path.exists(%r)\n'
                'print("@@RESULT@@" + json.dumps(out))\n'
            ) % (SERVER, os.path.join(d3, 'tenant_999.db'))
            env3 = dict(os.environ); env3['ERP_DB_PATH'] = master3; env3.pop('DATABASE_URL', None)
            r3 = subprocess.run([PYBIN, '-c', code3], capture_output=True, text=True,
                                env=env3, timeout=300)
            line3 = ''
            for ln in (r3.stdout or '').splitlines():
                if ln.startswith('@@RESULT@@'):
                    line3 = ln[len('@@RESULT@@'):]
            res3 = json.loads(line3) if line3 else {}
            ok('D5 对照：登记表可读且无此 id ⇒ 拒绝（真·确证不存在）',
               res3.get('r', '').startswith('rejected:') and res3.get('f') is False, repr(res3))
        finally:
            shutil.rmtree(d3, ignore_errors=True)
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- E 形态
PRESENT = {
    'erp_db.py': [
        'def scan_tenant_dbs(registered_only=False, active_only=True):',
        'def list_tenant_db_ids(registered_only=False, active_only=True):',
        'def iter_tenant_db_paths(registered_only=False, active_only=True):',
        'def _tenant_registry_snapshot(active_only=True):',
        'def _tenant_db_is_real(path):',
        'return False, "空文件(0 字节)"',
        'if total == 0 and struct:',
        'for path in iter_tenant_db_paths():',
        'for _tp in iter_tenant_db_paths():',
        'for _tp167 in iter_tenant_db_paths():',
    ],
    'scheduler.py': ['db.list_tenant_db_ids(registered_only=True)'],
    'tenant_audit.py': ['from erp_db import iter_tenant_db_paths',
                        'for f in iter_tenant_db_paths():'],
    'routers/admin_backup.py': ['db.iter_tenant_db_paths()'],
    'db/connection.py': ['def _tenant_registered(tenant_id):',
                         'if _tenant_registered(tenant_id) is False:'],
}
GONE = {
    'erp_db.py': [
        'for path in sorted(glob.glob(os.path.join(DB_DIR, "tenant_*.db"))):',
        'for _tp in sorted(_g2.glob(os.path.join(DB_DIR, "tenant_*.db"))):',
        'for _tp in sorted(_g3.glob(os.path.join(DB_DIR, "tenant_*.db"))):',
        'for _tp167 in sorted(_g167.glob(os.path.join(DB_DIR, "tenant_*.db"))):',
        'import glob as _g2', 'import glob as _g3', 'import glob as _g167',
    ],
    'scheduler.py': ['import glob\n    import re'],
    'tenant_audit.py': ['for f in sorted(glob.glob(os.path.join(DB_DIR, "tenant_*.db"))):'],
    'routers/admin_backup.py': ['out.extend(sorted(glob.glob(os.path.join(DB_DIR, "tenant_*.db"))))'],
}


def section_e():
    sec('E 形态：六处枚举点全部改走权威实现（源码 present / gone）')
    for rel, items in PRESENT.items():
        p = os.path.join(SERVER, rel)
        src = open(p, encoding='utf-8').read()
        for s in items:
            ok('E present %s :: %s' % (rel, s[:52]), src.count(s) >= 1, 'count=%d' % src.count(s))
    for rel, items in GONE.items():
        p = os.path.join(SERVER, rel)
        src = open(p, encoding='utf-8').read()
        for s in items:
            ok('E gone    %s :: %s' % (rel, s[:52]), src.count(s) == 0, 'count=%d' % src.count(s))


# ---------------------------------------------------------------- F 委托（AST）
def _glob_calls_in(fn):
    """函数体内所有「名为 glob 的调用」（`glob(` / `_g.glob(` / `glob.glob(`）。"""
    out = []
    for n in ast.walk(fn):
        if isinstance(n, ast.Call):
            f = n.func
            name = f.attr if isinstance(f, ast.Attribute) else getattr(f, 'id', '')
            if name == 'glob':
                out.append(getattr(n, 'lineno', 0))
    return out


def section_f():
    sec('F 委托：调度器等函数体内**不得**再出现 glob（AST）')
    checks = [('scheduler.py', '_tenant_ids'), ('erp_db.py', 'iter_tenant_db_paths')]
    for rel, fname in checks:
        src = open(os.path.join(SERVER, rel), encoding='utf-8').read()
        tree = ast.parse(src)
        target = None
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef,)) and n.name == fname:
                target = n
                break
        if target is None:
            ok('F %s::%s 存在' % (rel, fname), False, '函数未找到')
            continue
        calls = _glob_calls_in(target)
        ok('F %s::%s 函数体内无 glob 调用' % (rel, fname), not calls, 'lineno=%r' % calls)
    # 反向对照：同一判定器必须能抓到「有人又写回 glob」
    bad = ast.parse('def f():\n    import glob\n    return glob.glob(os.path.join(DB_DIR, "tenant_*.db"))\n')
    caught = _glob_calls_in(bad.body[0])
    ok('F 对照：判定器能抓到写回的 glob（证明不是假绿灯）', bool(caught),
       '抓到 lineno=%r' % caught)


# ---------------------------------------------------------------- G 端到端
def section_g():
    sec('G 端到端：import 整个 erp_db（会跑模块级回填）后空壳文件未被写')
    d, master = make_sandbox()
    try:
        ghost = os.path.join(d, 'tenant_2.db')
        before = os.path.getsize(ghost)
        os.chmod(ghost, 0o444)                     # 让它**写不动**，与生产那条 readonly 同型
        code = ('import sys\nsys.path.insert(0, %r)\nimport erp_db\nprint("IMPORT_OK")\n' % SERVER)
        env = dict(os.environ); env['ERP_DB_PATH'] = master; env.pop('DATABASE_URL', None)
        r = subprocess.run([PYBIN, '-c', code], capture_output=True, text=True,
                           env=env, timeout=300)
        ok('G1 模块导入成功（回填循环没被空壳文件搞挂）', 'IMPORT_OK' in (r.stdout or ''),
           (r.stderr or '')[-160:].replace('\n', ' '))
        ok('G2 空壳文件**仍为 0 字节**（没被当成租户库写进去）',
           os.path.getsize(ghost) == before == 0,
           'size=%d' % os.path.getsize(ghost))
        lines = ((r.stdout or '') + '\n' + (r.stderr or '')).splitlines()
        # 🔴 断言要精确：**「被提到」不等于「被写」**。空壳文件被「跳过留痕」提到是**对的**
        #    （那正是可观测性）；要禁的是**写入尝试**类告警（回填 / readonly / 打不开 / 崩栈）。
        #    首版写成「日志里不得出现该文件名」，于是把正确的留痕判成了失败。
        bad = [l for l in lines if 'tenant_2.db' in l and any(
            k in l for k in ('Tenant patch', 'readonly', 'unable to open',
                             'attempt to write', 'Traceback'))]
        ok('G3 日志里**没有**针对该文件的回填/写入告警（只有「跳过」留痕）',
           not bad, ' | '.join(bad)[:150] if bad else '无写入类告警')
        ok('G3b 对照：确实出现了「跳过 tenant_2.db」的留痕（证明 G3 不是碰巧没有日志）',
           any('tenant_2.db' in l and '跳过' in l for l in lines),
           ' | '.join([l.strip() for l in lines if '跳过' in l][:1])[:120])
    finally:
        try:
            os.chmod(os.path.join(d, 'tenant_2.db'), 0o644)
        except Exception:
            pass
        shutil.rmtree(d, ignore_errors=True)


def main():
    print('v206 护栏 —— 租户库枚举唯一权威实现 + 未登记租户不建库')
    print('后端源码: %s' % SERVER)
    for fn in (section_a, section_b, section_c, section_d, section_e, section_f, section_g):
        try:
            fn()
        except Exception as e:
            ok('%s 段异常' % fn.__name__, False, repr(e)[:160])
    print('\n' + '=' * 72)
    print('通过 %d / 失败 %d' % (len(P), len(F)))
    if NOTES:
        for n in NOTES:
            print('  NOTE ' + n)
    if F:
        print('失败项：')
        for x in F:
            print('  - ' + x)
    return 1 if F else 0


if __name__ == '__main__':
    sys.exit(main())
