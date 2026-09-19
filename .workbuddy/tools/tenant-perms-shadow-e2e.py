#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""权限表按租户分叉 + `payroll` 窄模块 —— **影子库端到端验证**（2026-09-19 P0/P1）。

## 为什么必须在影子库上跑真实 app

静态护栏只能证明「代码形态对」。本轮真正要回答的是五个**运行时**问题：

1. 同一个 `/api/role-permissions`，换租户头是否真的返回**不同**内容？
2. 保存角色权限，是否真的落**本租户库**（而不是又回主库）？
3. 同一个角色名 `accountant`，能否在 A 租户「能算工资」、在 B 租户「不能」？
4. 🔴 **会计拿不到银行账号吗？** —— 这条只能靠**金丝雀**证明：
   往 `hr_employees` 的 `id_card / bank_name / bank_account` 写入带唯一标记的值，
   然后**逐条**调用所有 payroll 接口，断言响应文本里**从不出现**这些标记。
   没有对照组（boss 调 bank-file 必须**能**看见标记）的话，这一串"看不见"全是空断言。
5. 🔴 **工资条那条链真的能走通吗？** —— `salary_detail_get` 名字是单数、返回却是 list，
   `salary_send.py` 曾把它当 dict 用 ⇒ 员工当月**有**工资明细时 500。
   生产 `salary_details` 全库 0 行 ⇒ 走的永远是优雅分支 ⇒ 既没报错也没告警。
   T8 直接在影子库里种一行来把这条路径变成**可达**。

## 三个「看起来通过了，其实什么都没有」的陷阱（都实测踩过）

* **404 伪装**：探测点 method 写错（`preview` 是 POST）⇒ 404 的响应体天然干净 ⇒ 金丝雀断言"通过"。
* **5xx 伪装**：异常响应体同样干净。且 `TestClient` 默认把异常**抛出**，表现是脚本崩栈而非 status=500。
* **空响应伪装**：接口没给数据时"看不见金丝雀"是必然的 ⇒ 必须有 T6g 这样「先证明**真的返回了 L2 数据**，
  再看同一份响应里没有 L3」的正向对照。

## 判别力自证（两步，缺一不可）

    # ① 负对照：对**未修**副本跑，必须 FAIL（证明探针真的打在病灶上）
    HERGENT_APP_DIR=/tmp/<未修副本> python3 tenant-perms-shadow-e2e.py    # 期望 T6e3/T8a FAIL
    # ② 正对照：对**已修**副本跑，必须全绿
    HERGENT_APP_DIR=/tmp/<已修副本> python3 tenant-perms-shadow-e2e.py

## 安全设计（零生产写入）

* 全部在 `/tmp/<临时目录>/` 上做：用 `sqlite3.backup()` **只读**复制生产的
  `erp.db / tenant_*.db`，然后只对副本读写。
* 用真实 `server.app` + `TestClient` 在**独立进程**里跑（`ERP_DB_PATH` 指向副本），
  不监听端口、不动生产库、不动生产文件。
* **不调用 `/api/salary-send/send`** —— 它会真的往员工的企业微信推工资条。
  只调它的 `preview`（纯计算，无副作用）。

用法（在服务器上跑）：python3 tenant-perms-shadow-e2e.py
退出码 0 = 全绿。
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time

PROD = os.environ.get('HERGENT_PROD_DIR', '/opt/hergent-erp')
# 要跑的**代码**目录（默认与生产同目录）。上线前验证时指向一份「生产代码 + 本轮改动」的
# 暂存副本 —— 这样能在不影响生产进程的前提下，用真实 app 跑真实接口。
APP = os.environ.get('HERGENT_APP_DIR', PROD)
CANARY_ID = 'CANARY_IDCARD_9137'
CANARY_BANK = 'CANARY_BANK_9137'
CANARY_ACCT = 'CANARY_ACCT_9137'
CANARIES = (CANARY_ID, CANARY_BANK, CANARY_ACCT)

P, F = [], []          # pass / fail 记录
NOTES = []


def ok(name, cond, detail=''):
    (P if cond else F).append(name)
    print(('  PASS  ' if cond else '  FAIL  ') + name + (('   [' + detail + ']') if detail else ''))
    return cond


def note(msg):
    NOTES.append(msg)
    print('  NOTE  ' + msg)


def setup_shadow():
    """只读复制生产库到临时目录（sqlite backup API ⇒ 一致性快照，不锁生产写）。"""
    d = tempfile.mkdtemp(prefix='permfix_shadow_')
    for f in os.listdir(PROD):
        if f == 'erp.db' or (f.startswith('tenant_') and f.endswith('.db')):
            src = sqlite3.connect('file:%s?mode=ro' % os.path.join(PROD, f), uri=True)
            dst = sqlite3.connect(os.path.join(d, f))
            with dst:
                src.backup(dst)
            src.close()
            dst.close()
    return d


def salary_row(shadow, tid, eid, month):
    """从影子租户库读该员工当月的工资明细。

    🔴 断言金额**必须从库里取，不能写死**。本轮实测踩到：T6 的探测点里
    `POST /api/payroll-workflow/run`、`POST /api/salary-batch-calculate`、
    `POST /api/payroll/run` **是真的会重算并落 `salary_details` 的写操作** ——
    它们把种子行（net=7000）按社保/个税重算成了 6552。写死 `7,000.00` 会让断言
    随工资算法漂移而假失败（而且失败方向很迷惑：status 明明是 200）。
    """
    p = os.path.join(shadow, 'tenant_%d.db' % tid)
    if not os.path.exists(p):
        return None
    c = sqlite3.connect(p)
    c.row_factory = sqlite3.Row
    try:
        r = c.execute("SELECT * FROM salary_details WHERE employee_id=? AND month=? "
                      "ORDER BY id DESC LIMIT 1", (eid, month)).fetchone()
        return dict(r) if r else None
    finally:
        c.close()


def money(v):
    """与 `_format_salary_message` 的 `f'¥{gross:,.2f}'` 保持同一格式。"""
    try:
        return '{:,.2f}'.format(float(v or 0))
    except (TypeError, ValueError):
        return ''


def main():
    shadow = setup_shadow()
    print('影子库目录: %s' % shadow)
    print('（生产库只被只读复制，未做任何写入）')
    print('')

    # ---- 在副本里造测试身份 -------------------------------------------------
    db = sqlite3.connect(os.path.join(shadow, 'erp.db'))
    cur = db.cursor()
    now = time.strftime('%Y-%m-%d %H:%M:%S')
    exp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(time.time() + 86400))
    # 复用生产里已有的两个 boss（tenant_1 / tenant_10），再加两个 accountant 与一个 sales
    # （sales 是给 T1e 用的：证明「豁免模块判定」没有放宽成「任何登录用户可读」）
    for uid, uname, role, tid in ((9001, 'shadow_acct1', 'accountant', 1),
                                  (9002, 'shadow_acct10', 'accountant', 10),
                                  (9003, 'shadow_sales1', 'sales', 1)):
        cur.execute("INSERT INTO users (id,username,password_hash,display_name,role,is_active,created_at) "
                    "VALUES (?,?,'x',?,?,1,?)", (uid, uname, uname, role, now))
        cur.execute("INSERT INTO user_tenants (user_id,tenant_id,role,created_at) VALUES (?,?,'member',?)",
                    (uid, tid, now))
    TOK = {'boss1': 'shadowtok_boss_t1', 'boss10': 'shadowtok_boss_t10',
           'acct1': 'shadowtok_acct_t1', 'acct10': 'shadowtok_acct_t10',
           'sales1': 'shadowtok_sales_t1'}
    for tok, uid in ((TOK['boss1'], 2), (TOK['boss10'], 4),
                     (TOK['acct1'], 9001), (TOK['acct10'], 9002), (TOK['sales1'], 9003)):
        cur.execute("INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)",
                    (tok, uid, now, exp))
    db.commit()
    db.close()

    # ---- 金丝雀：往副本的租户库里写唯一可辨识的实名/银行值 -------------------
    t1 = sqlite3.connect(os.path.join(shadow, 'tenant_1.db'))
    t1.row_factory = sqlite3.Row
    emps = [dict(r) for r in t1.execute("SELECT id,name FROM hr_employees").fetchall()]
    if not emps:
        t1.execute("INSERT INTO hr_employees (name,department_id,position,hire_date) VALUES ('金丝雀员工',0,'','')")
        t1.commit()
        emps = [dict(r) for r in t1.execute("SELECT id,name FROM hr_employees").fetchall()]
    canary_eid = emps[0]['id']
    t1.execute("UPDATE hr_employees SET id_card=?, bank_name=?, bank_account=?, social_insurance_city='', "
               "social_insurance_base=0, housing_fund_base=0, salary_structure='{\"base_salary\":8000}' WHERE id=?",
               (CANARY_ID, CANARY_BANK, CANARY_ACCT, canary_eid))
    t1.commit()
    # 给这个员工造一条工资明细，好让工资条/银行文件接口有东西可返回
    try:
        t1.execute("INSERT OR REPLACE INTO salary_details (employee_id,employee_name,month,base_salary,"
                   "gross_salary,net_salary,status) VALUES (?,?,?,8000,8000,7000,'draft')",
                   (canary_eid, emps[0]['name'], time.strftime('%Y-%m')))
        t1.commit()
    except Exception as e:
        note('造 salary_details 失败（不影响主断言）：%s' % e)
    t1.close()
    note('金丝雀已写入影子 tenant_1.db：员工 id=%d，标记 %s / %s / %s'
         % (canary_eid, CANARY_ID, CANARY_BANK, CANARY_ACCT))
    print('')

    # ---- 起真实 app ---------------------------------------------------------
    env_path = os.path.join(PROD, '.env')
    if os.path.exists(env_path):
        for ln in open(env_path, encoding='utf-8'):
            ln = ln.strip()
            if ln and not ln.startswith('#') and '=' in ln:
                k, v = ln.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    os.environ['ERP_DB_PATH'] = os.path.join(shadow, 'erp.db')
    os.chdir(APP)                    # 对齐 systemd 的 WorkingDirectory
    sys.path.insert(0, APP)
    import server as srv                                    # noqa: E402
    from starlette.testclient import TestClient              # noqa: E402
    # 🔴 `raise_server_exceptions=False`：TestClient 默认把服务端异常**抛出**到测试进程，
    # 于是「某条路径 500」的表现是**脚本崩栈中断**，而不是一条可断言的 status=500。
    # 本轮实测：`preview` 的 `AttributeError` 直接把 T6 之后的断言全部带走了。
    # 关掉之后 500 会作为正常响应返回，可以被 T6e3/T8 断言。
    client = TestClient(srv.app, raise_server_exceptions=False)
    note('被测代码目录 = %s' % APP)

    def call(tok, tid, method, path, body=None):
        h = {'Authorization': 'Bearer ' + tok, 'X-Tenant-Id': str(tid)}
        # 必须走 `client.request(...)`：`TestClient.get/post` 的签名里**没有** `json=`
        # （实测 `TypeError: TestClient.get() got an unexpected keyword argument 'json'`），
        # 而部分端点（如 **POST** `/api/salary-send/preview/{id}`）要读 JSON body。
        r = client.request(method.upper(), path, headers=h, json=body)
        return r.status_code, r.text

    print('=' * 72)
    print('T1/T2  同一接口换租户头是否真的不同（P0 的决定性判据）')
    print('=' * 72)
    s1, b1 = call(TOK['boss1'], 1, 'get', '/api/role-permissions')
    s10, b10 = call(TOK['boss10'], 10, 'get', '/api/role-permissions')
    r1 = json.loads(b1).get('roles', {}) if s1 == 200 else {}
    r10 = json.loads(b10).get('roles', {}) if s10 == 200 else {}
    ok('T1  tenant_1 读权限表 200', s1 == 200, 'status=%s' % s1)
    ok('T1b tenant_1 能看到它自己的自定义角色「库管」', '库管' in r1,
       '角色集=%s' % sorted(r1))
    ok('T2  tenant_10 读权限表 200', s10 == 200, 'status=%s' % s10)
    ok('T2b 🔴 tenant_10 **看不到** tenant_1 的「库管」', '库管' not in r10,
       '角色集=%s' % sorted(r10))
    ok('T2c 两份返回确实不同（不再是"三次逐字相同"）', b1 != b10)

    # T1e：豁免的是**模块判定**，不是整个访问控制。
    # 这两个端点被 RBAC 豁免（防"撤了 boss 的 hr 就再也打不开权限页"），但读权限必须
    # 仍按**角色名**把关（`_admin` = role in admin/boss）—— 否则 sales/accountant 都能
    # 读到全租户的角色→模块矩阵，而原实现是被 `hr` 拦着的（= 豁免顺手放大了读权限）。
    for who in ('sales1', 'acct1'):
        s, _ = call(TOK[who], 1, 'get', '/api/role-permissions')
        ok('T1e 🔴 %-8s 读权限表 403（豁免 ≠ 任何登录用户可读）' % who, s == 403, 'status=%s' % s)
    s, _ = call(TOK['sales1'], 1, 'get', '/api/role-permissions/detail')
    ok('T1e2 🔴 sales 读 CRUD 明细也 403', s == 403, 'status=%s' % s)
    print('')

    print('=' * 72)
    print('T3  保存是否落本租户库（而不是又回主库）')
    print('=' * 72)
    s, _ = call(TOK['boss1'], 1, 'post', '/api/role-permissions',
                {'role_name': '影子测试角色', 'permissions': ['dashboard', 'stock']})
    ok('T3  保存自定义角色 200', s == 200, 'status=%s' % s)
    dbt = sqlite3.connect(os.path.join(shadow, 'tenant_1.db'))
    in_t1 = dbt.execute("SELECT COUNT(*) FROM role_permissions WHERE role_name='影子测试角色'").fetchone()[0]
    dbt.close()
    dbm = sqlite3.connect(os.path.join(shadow, 'erp.db'))
    in_master = dbm.execute("SELECT COUNT(*) FROM role_permissions WHERE role_name='影子测试角色'").fetchone()[0]
    dbm.close()
    ok('T3b 🔴 落进了 tenant_1.db', in_t1 == 1, 'tenant_1 命中 %d 行' % in_t1)
    ok('T3c 🔴 **没有**落进主库 erp.db', in_master == 0, '主库命中 %d 行' % in_master)
    s, b10b = call(TOK['boss10'], 10, 'get', '/api/role-permissions')
    ok('T3d tenant_10 看不到 tenant_1 新建的角色',
       '影子测试角色' not in json.loads(b10b).get('roles', {}))
    # 缓存失效 / 跨租户不串味：tenant_1 保存后，tenant_10 的读必须不受影响
    ok('T3e 保存只失效本租户缓存（tenant_10 仍报自己的角色集）',
       '库管' not in json.loads(b10b).get('roles', {}))
    print('')

    print('=' * 72)
    print('T4  同一角色名在两租户下行为不同（= 用户要的「客户会计能算工资，我不能」）')
    print('=' * 72)
    s_a1, b_a1 = call(TOK['acct1'], 1, 'get', '/api/payroll-workflow/recipe')
    s_a10, b_a10 = call(TOK['acct10'], 10, 'get', '/api/payroll-workflow/recipe')
    ok('T4a 会计（未授权）在 tenant_1 被拒', s_a1 == 403, 'status=%s' % s_a1)
    ok('T4b 会计（未授权）在 tenant_10 被拒', s_a10 == 403, 'status=%s' % s_a10)
    s, _ = call(TOK['boss1'], 1, 'post', '/api/role-permissions',
                {'role_name': 'accountant',
                 'permissions': ['dashboard', 'accounts', 'reports', 'marketing', 'payroll']})
    ok('T4c tenant_1 给 accountant 单独授予 payroll', s == 200, 'status=%s' % s)
    s_a1b, _ = call(TOK['acct1'], 1, 'get', '/api/payroll-workflow/recipe')
    s_a10b, _ = call(TOK['acct10'], 10, 'get', '/api/payroll-workflow/recipe')
    ok('T4d 🔴 tenant_1 的会计**现在能**算工资', s_a1b == 200, 'status=%s' % s_a1b)
    ok('T4e 🔴 tenant_10 的会计**仍然不能**（授权没有跨租户泄漏）', s_a10b == 403,
       'status=%s' % s_a10b)
    print('')

    print('=' * 72)
    print('T5  会计（只有 payroll）拿不到 L3 的三个入口')
    print('=' * 72)
    for path in ('/api/employees', '/api/payroll/bank-file', '/api/salary-bank-file'):
        s, _ = call(TOK['acct1'], 1, 'get', path)
        ok('T5  %-26s 403（会计无 hr）' % path, s == 403, 'status=%s' % s)
    print('')

    print('=' * 72)
    print('T6  金丝雀：对照组先证明"看得见"，再逐条证明 payroll 路径"看不见"')
    print('=' * 72)
    s, body = call(TOK['boss1'], 1, 'get', '/api/employees')
    ok('T6a 对照组 · boss 能读员工档案', s == 200, 'status=%s' % s)
    ok('T6b 对照组 · 档案里**确实**含金丝雀值（证明注入有效）',
       all(c in body for c in CANARIES),
       '命中：%s' % [c for c in CANARIES if c in body])
    s, body = call(TOK['boss1'], 1, 'get', '/api/payroll/bank-file')
    ok('T6c 对照组 · boss 能取银行代发文件', s == 200, 'status=%s' % s)
    ok('T6d 对照组 · 代发文件里**确实**含银行账号金丝雀', CANARY_ACCT in body,
       '（银行文件对 hr 开放，对 payroll 关闭 —— 这正是分层的目的）')

    # 逐条调用 payroll 路径（会计身份）。顺序即"能不能打进去"的覆盖面。
    # ⚠️ 这不是一组只读探测：`payroll-workflow/run`、`salary-batch-calculate`、
    #    `payroll/run` **会真的重算并写 `salary_details`**（本轮实测把种子行从
    #    net=7000 重算成 6552）。之所以无害，是因为 `ERP_DB_PATH` 指向影子副本；
    #    也正因如此，金额断言必须从影子库现取（见 `salary_row`）。
    PROBES = [
        ('get', '/api/payroll-workflow/recipe', None),
        ('post', '/api/payroll-workflow/run', {'month': time.strftime('%Y-%m')}),
        ('get', '/api/payroll-workflow/history?month=' + time.strftime('%Y-%m'), None),
        ('post', '/api/payroll/run', {'month': time.strftime('%Y-%m')}),
        ('post', '/api/payroll/confirm', {'month': time.strftime('%Y-%m')}),
        ('get', '/api/salary-details?month=' + time.strftime('%Y-%m'), None),
        ('get', '/api/salary-summary?month=' + time.strftime('%Y-%m'), None),
        ('post', '/api/salary-batch-calculate', {'month': time.strftime('%Y-%m')}),
        ('get', '/api/salaries?month=' + time.strftime('%Y-%m'), None),
        ('get', '/api/salary-slip/%d/%s' % (canary_eid, time.strftime('%Y-%m')), None),
        ('get', '/api/payroll/payslip/%d?month=%s' % (canary_eid, time.strftime('%Y-%m')), None),
        # preview 是 **POST**（`@router.post("/preview/{employee_id}")`）—— 写成 GET 会拿到
        # 404，而 404 的响应体里当然也没有金丝雀 ⇒ 会伪装成"通过"。故 method 必须准确。
        ('post', '/api/salary-send/preview/%d' % canary_eid,
         {'month': time.strftime('%Y-%m'), 'channel': 'wechat'}),
        ('get', '/api/social-insurance-config', None),
    ]
    leaked, notfound, errored = [], [], []
    for method, path, bod in PROBES:
        s, body = call(TOK['acct1'], 1, method, path, bod)
        hit = [c for c in CANARIES if c in body]
        if s == 404:
            notfound.append('%s %s' % (method.upper(), path))
        # 🔴 5xx 与 404 同罪：异常响应体里当然也没有金丝雀 ⇒ 同样会伪装成「没有泄漏」。
        #    本轮 `preview` 的 AttributeError 就是这么被遮住的（当时表现为脚本崩栈）。
        if s >= 500:
            errored.append('%s %s -> %s' % (method.upper(), path, s))
        if hit:
            leaked.append('%s %s -> %s' % (method.upper(), path, hit))
        print('        %-4s %-58s %s%s' % (method.upper(), path[:58], s,
                                           ('   泄漏=' + ','.join(hit)) if hit else ''))
    ok('T6e 🔴 会计在全部 payroll 路径上都读不到金丝雀（实名/银行）', not leaked,
       '; '.join(leaked))
    # 没有这一条，"看不见金丝雀"可能只是因为探测点根本没打进接口（404/422 的响应体天然干净）
    ok('T6e2 全部探测点都真的打进了接口（无 404 ⇒ 不是靠 404 蒙混）', not notfound,
       '; '.join(notfound))
    ok('T6e3 🔴 全部探测点都不返回 5xx（异常≠被拒绝，且异常体天然没有金丝雀）',
       not errored, '; '.join(errored))

    # T6g/T6h 空响应对照 —— 这一对是 C 段静态告警（`_get_employee` 等 L3 载体）
    # 的**运行时定论**：必须让 payroll 路径把**真实工资数据（L2）返回来**，
    # 再看同一份响应里有没有 L3。否则 T6e 的「看不见」可能只是「接口没给数据」。
    # ⚠️ 金额从影子库取（上面部分探测点是**写操作**，会把种子行重算）。
    _row = salary_row(shadow, 1, canary_eid, time.strftime('%Y-%m')) or {}
    _g, _n = money(_row.get('gross_salary')), money(_row.get('net_salary'))
    s, body = call(TOK['acct1'], 1, 'post', '/api/salary-send/preview/%d' % canary_eid,
                   {'month': time.strftime('%Y-%m'), 'channel': 'wechat'})
    ok('T6g 🔴 会计的 preview 真的返回了工资数据（L2）⇒ 证明 T6e 的「无金丝雀」不是空响应',
       s == 200 and _g and _g in body and _n in body,
       '期望含 应发¥%s / 实发¥%s；status=%s' % (_g, _n, s))
    ok('T6h 🔴 同一份响应里仍然没有 L3 金丝雀（分层在"真的有数据"时依然成立）',
       not any(c in body for c in CANARIES),
       '命中：%s' % [c for c in CANARIES if c in body])
    note('`/api/salary-send/send` **故意未调用** —— 它会真的往员工企业微信推工资条；'
         '其同源读路径 `preview` 已覆盖。')

    # 反证：把 payroll 也给会计 + 给 hr（模拟"图省事全给 hr"），断言会泄漏 ⇒ 证明 T6e 有内容
    s, _ = call(TOK['boss1'], 1, 'post', '/api/role-permissions',
                {'role_name': 'accountant',
                 'permissions': ['dashboard', 'accounts', 'reports', 'marketing', 'payroll', 'hr']})
    s, body = call(TOK['acct1'], 1, 'get', '/api/salary-bank-file')
    ok('T6f 反证 · 一旦把 hr 也给会计，银行账号立刻可见（说明分层是唯一屏障）',
       s == 200 and CANARY_ACCT in body, 'status=%s 含金丝雀=%s' % (s, CANARY_ACCT in body))
    # 复原
    call(TOK['boss1'], 1, 'post', '/api/role-permissions',
         {'role_name': 'accountant',
          'permissions': ['dashboard', 'accounts', 'reports', 'marketing', 'payroll']})
    print('')

    print('=' * 72)
    print('T8  工资条读端：单数函数名 + 复数返回值的错配（v205）')
    print('=' * 72)
    # 为什么这一组在**权限**脚本里：P1 的交付物是「让客户的会计能算工资」，
    # 而链路是 会计算工资 → salary_details 落行 → 点「预览/群发工资条」。0 行时
    # 新旧代码都返回 200（走 `if not rows` 的优雅分支），所以这组断言**必须**在
    # 种了一条 salary_details 之后才有判别力 —— 种子在上面的金丝雀段。
    _m = time.strftime('%Y-%m')
    s, body = call(TOK['acct1'], 1, 'post', '/api/salary-send/preview/%d' % canary_eid,
                   {'month': _m, 'channel': 'wechat'})
    ok('T8a 🔴 会计预览工资条 200（不是 500：`list` 当 `dict` 用会抛 AttributeError）',
       s == 200, 'status=%s' % s)
    try:
        pj = json.loads(body)
    except Exception:
        pj = {}
    _row8 = salary_row(shadow, 1, canary_eid, _m) or {}
    _pv = pj.get('preview') or ''
    ok('T8b 返回体 success=true 且工资条文本成型（含姓名与应发/实发金额）',
       pj.get('success') is True and '工资条' in _pv
       and money(_row8.get('gross_salary')) in _pv
       and money(_row8.get('net_salary')) in _pv
       and (_row8.get('employee_name') or '') in _pv,
       'employee_name=%r 期望金额 应发¥%s/实发¥%s'
       % (pj.get('employee_name'), money(_row8.get('gross_salary')), money(_row8.get('net_salary'))))
    s, body2 = call(TOK['boss1'], 1, 'get', '/api/salary-details?month=' + _m)
    ok('T8c 同源列表接口 /api/salary-details 也 200', s == 200, 'status=%s' % s)
    # 对照：没有工资数据的员工/月份，必须仍走优雅分支（否则 T8a 的 200 可能来自别的路径）
    s, body3 = call(TOK['acct1'], 1, 'post', '/api/salary-send/preview/%d' % canary_eid,
                    {'month': '2019-01', 'channel': 'wechat'})
    ok('T8d 对照 · 无数据的月份 → 200 + success=false + 明确的「未找到」',
       s == 200 and json.loads(body3).get('success') is False
       and '未找到' in body3, 'status=%s' % s)
    print('')

    print('=' * 72)
    print('T7  零残留 / 收尾')
    print('=' * 72)
    s, _ = call(TOK['boss1'], 1, 'delete', '/api/role-permissions/影子测试角色')
    ok('T7  删除测试角色 200', s == 200, 'status=%s' % s)
    dbt = sqlite3.connect(os.path.join(shadow, 'tenant_1.db'))
    left = dbt.execute("SELECT COUNT(*) FROM role_permissions WHERE role_name='影子测试角色'").fetchone()[0]
    dbt.close()
    ok('T7b 影子库里已无测试角色', left == 0)

    # 生产文件未被触碰
    import hashlib
    h = hashlib.md5(open(os.path.join(PROD, 'erp.db'), 'rb').read()).hexdigest()
    note('生产 erp.db md5（脚本全程只读，未变）= %s' % h)

    print('')
    print('-' * 72)
    print('影子库端到端：%d/%d 通过' % (len(P), len(P) + len(F)))
    if F:
        print('失败项:')
        for x in F:
            print('   - ' + x)
    print('影子库目录保留供排查：%s' % shadow)
    return 1 if F else 0


if __name__ == '__main__':
    sys.exit(main())
