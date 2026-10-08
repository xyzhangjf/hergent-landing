#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v316 影子库端到端验收：客户档案后端三处改动是否**真的**生效。

四组判据（都判「用户能感知的行为」，不判「代码看起来对」）：

  A. 【核心】新建客户时填的 4 个字段能不能读回来。
     正例：改动版 contact_create 写 boss_name/boss_phone/channel/code → 读回 4 值都在。
     反例：**从 `git show HEAD:` 现场取旧版 contacts.py 加载成独立模块**，同参数再跑一次
           ⇒ 断言 4 值**全丢**。
     为什么必须有反例：若反例不成立（旧代码也能写进去），说明这个探针没有判别力 ——
     那时正例的"通过"什么也证明不了。

  B. 分页：`routers/data.py::list_contacts` 是否真的接上了 limit/offset 与 DB COUNT。
     用**源码判别串双向比对**（新版含、HEAD 版不含）—— 该函数要 Request/_auth，不便直接调，
     而"判别串取自源码原文"是本项目既定的取证方式。

  C. 计数与分页行为：contact_count == 全量列表条数；limit/offset 真生效且两页不重叠。

  D. 类型收口：normalize_ctype 吃掉中文/英文别名；两种口径都要对 ——
     端点口径（`default=None`）无法识别即回 None（→ 400，不写库）；
     导入口径（默认）无法识别回落 customer（不中断整批）。

安全：只读生产库（本机副本，SQLite backup API 拷进影子）、只写影子库。
     脚本先断言 DB_PATH 落在影子目录，否则立即中止。
"""
import importlib.util
import os
import shutil
import sqlite3
import subprocess
import sys

REPO = '/Users/zhangjunfeng/Documents/hergent-erp'
SERVER = os.path.join(REPO, 'server')
SHADOW = os.environ.get('V316_SHADOW') or '/tmp/v316-shadow'

# 期望通过数：先跑一遍拿真值，再回来钉死（避免"改完不重跑"导致计数漂移无人发现）。
EXPECT_PASS = 57

PASS = 0
FAIL = 0


def check(cond, name, extra=''):
    global PASS, FAIL
    ok = bool(cond)
    if ok:
        PASS += 1
    else:
        FAIL += 1
    tail = ('  -> ' + str(extra)) if extra != '' else ''
    print(('  [OK] ' if ok else '  [XX] ') + name + tail)
    return ok


def copy_db(src, dst):
    """用 SQLite backup API 拷贝。

    不用 shutil.copy2：源库有 -wal/-shm 时直接拷文件可能拿到**不一致的快照**
    （主库与 WAL 不同步），而本脚本要拿它当"生产事实"来判分。
    """
    s = sqlite3.connect('file:' + src + '?mode=ro', uri=True)
    d = sqlite3.connect(dst)
    with d:
        s.backup(d)
    d.close()
    s.close()


print('=== v316 影子库端到端验收 ===')
shutil.rmtree(SHADOW, ignore_errors=True)
os.makedirs(SHADOW, exist_ok=True)
for f in ('erp.db', 'tenant_1.db'):
    src = os.path.join(SERVER, f)
    if not os.path.exists(src):
        print('FATAL: 缺 ' + src)
        sys.exit(2)
    copy_db(src, os.path.join(SHADOW, f))
print('影子目录 = ' + SHADOW)

os.environ['ERP_DB_PATH'] = os.path.join(SHADOW, 'erp.db')
# 影子库专用密钥：**与生产无关**。写进去的行用同一把钥匙读回来 ⇒ 自洽。
# （影子库是从生产副本拷的，旧行的 PII 用生产密钥加密 ⇒ 本进程解不开，
#   `decrypt_value` 的兜底是返回 "[encrypted]" 而不是抛异常 ⇒ 不影响本脚本的判据，
#   因为所有判据只看**本脚本新写的那两行**。）
os.environ['ERP_SECRET'] = 'v316-shadow-probe-only-not-a-real-key'
os.chdir(SERVER)
sys.path.insert(0, SERVER)

from db.connection import DB_PATH, set_tenant_context  # noqa: E402

print('DB_PATH  = ' + str(DB_PATH))
if not check(str(DB_PATH).startswith(SHADOW), '安全闸：DB_PATH 落在影子目录'):
    print('FATAL: 不在影子库，立即中止')
    sys.exit(3)

# ── 列存在性（若影子库缺列，后面 A 组的结论就没有意义）
conn = sqlite3.connect(os.path.join(SHADOW, 'tenant_1.db'))
cols = [r[1] for r in conn.execute('PRAGMA table_info(contacts)')]
conn.close()
for c in ('boss_name', 'boss_phone', 'channel', 'code'):
    check(c in cols, 'contacts 表存在列 ' + c)

set_tenant_context(1)
from db.queries.contacts import (  # noqa: E402
    contact_create, contact_get, contact_list, contact_count, contact_update)

VALS = {'boss_name': 'v316老板甲', 'boss_phone': '13900000001',
        'channel': 'v316业态乙', 'code': 'V316-CODE-001'}

# ── A 正例：改动版能写进去、且读得回来
print('')
print('A. 新建写 4 字段 → 读回（正例）')
cid_new = contact_create('v316验收客户-新', 'customer', _user='v316-probe', **VALS)
row_new = contact_get(cid_new)
for k in VALS:
    check(row_new.get(k) == VALS[k], 'A正例：' + k + ' 读回等于写入值', row_new.get(k))

# ── A 反例：HEAD 版旧代码（现场从 git 取，不凭记忆）
print('')
print('A-反例. HEAD 版 contact_create（同参数）')
old_src = subprocess.check_output(
    ['git', 'show', 'HEAD:server/db/queries/contacts.py'], cwd=REPO)
old_path = os.path.join(SHADOW, 'v316_old_contacts.py')
with open(old_path, 'wb') as fh:
    fh.write(old_src)
spec = importlib.util.spec_from_file_location('v316_old_contacts', old_path)
old_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old_mod)
cid_old = old_mod.contact_create('v316验收客户-旧', 'customer', _user='v316-probe', **VALS)
row_old = contact_get(cid_old)          # 用新版读取函数读，读的是同一条库
lost = [k for k in VALS if not row_old.get(k)]
check(len(lost) == 4, 'A反例：HEAD 版 4 个字段**全被丢弃**（⇒ 探针有判别力）', lost)
check(old_src != open(os.path.join(SERVER, 'db/queries/contacts.py'), 'rb').read(),
      'A：磁盘版与 HEAD 版确实不同（否则"改动"等于没改）')

# ── C 计数与分页
print('')
print('C. 计数与分页')
# 🔴 先灌 250 条**客户**：本机 dev 库只有 11 个客户（生产 758），
#    不灌的话「旧实现只给 200 条」这条判据在本机**永远"通过"** ——
#    那不是判别力，那是巧合（判据没被真正触发）。
for _i in range(250):
    contact_create('v316分页压力-' + str(_i), 'customer', _user='v316-probe',
                   channel='v316业态-' + str(_i % 3), region='v316片区-' + str(_i % 2))

n_cust = contact_count('', 'customer')
rows_all = contact_list('', 'customer', limit=1000000)
check(n_cust == len(rows_all), 'C：contact_count == 全量列表条数（页面「共 N 条」不骗人）',
      str(n_cust) + ' vs ' + str(len(rows_all)))
check(n_cust > 200, 'C：客户数已越过 200（本机可复现那道硬顶）', n_cust)
# 这一条是 C 组的关键：**不传 limit 时默认截断在 200** —— 旧 `data.py::list_contacts`
# 正是这么调的（`db.contact_list(keyword, type)`），所以生产 758 条客户里只能看到 200 条。
trunc = contact_list('', 'customer')
check(len(trunc) == 200 and len(trunc) < n_cust,
      'C：不传 limit 时 contact_list 截断在 200（= 旧 data.py 的调用形态）',
      str(len(trunc)) + ' < ' + str(n_cust))
p1 = contact_list('', 'customer', limit=5, offset=0)
p2 = contact_list('', 'customer', limit=5, offset=5)
check(len(p1) == 5 and len(p2) == 5, 'C：limit/offset 真生效', str(len(p1)) + '/' + str(len(p2)))
check(p1[0]['id'] != p2[0]['id'], 'C：第 1 页与第 2 页不重叠', str(p1[0]['id']) + ' vs ' + str(p2[0]['id']))
kw = str(rows_all[0]['name'])[:3]
check(contact_count(kw, 'customer') <= n_cust, 'C：带 keyword 的计数不超过全量',
      str(contact_count(kw, 'customer')) + " <= " + str(n_cust))

# ── B 源码判别串双向比对
print('')
print('B. routers/data.py 分页接线（判别串双向比对）')
with open(os.path.join(SERVER, 'routers/data.py'), encoding='utf-8') as fh:
    disk_data = fh.read()
old_data = subprocess.check_output(
    ['git', 'show', 'HEAD:server/routers/data.py'], cwd=REPO).decode('utf-8')
for s in ('limit=limit, offset=offset', '_contact_count(keyword, type, channel=channel)'):
    check(s in disk_data, 'B：新版 data.py 含判别串「' + s + '」')
    check(s not in old_data, 'B：HEAD 版 data.py **不含**同一串 ⇒ 双向比对成立')

# ── D 类型收口
print('')
print('D. normalize_ctype 归一化与拒绝')
from routers.data import normalize_ctype  # noqa: E402
check(normalize_ctype('客户') == 'customer', "D：'客户' → customer", normalize_ctype('客户'))
check(normalize_ctype('供应商') == 'supplier', "D：'供应商' → supplier", normalize_ctype('供应商'))
check(normalize_ctype('客户+供应商') == 'both', "D：'客户+供应商' → both",
      normalize_ctype('客户+供应商'))
check(normalize_ctype('CUSTOMER') == 'customer', "D：'CUSTOMER'（大写）→ customer",
      normalize_ctype('CUSTOMER'))
check(normalize_ctype('') == 'customer', "D：空串 → customer（缺省不报错）", normalize_ctype(''))
check(normalize_ctype(None) == 'customer', 'D：None → customer', normalize_ctype(None))
# 🔴 两种口径**都要测**（v316 把规则下沉成唯一实现后，同一个函数有两种合法用法）：
#   ① 端点口径 `default=None` ⇒ 无法识别就返回 None，端点据此回 400（不猜一个值写库）；
#   ② 导入口径（默认）     ⇒ 无法识别回落到 customer，**不中断整批**几百行。
from db.queries.contacts import normalize_ctype as _nc_q  # noqa: E402
check(normalize_ctype('employee', default=None) is None,
      "D反例（端点口径）：'employee' 返回 None ⇒ 端点回 400，不写出伪客户", 
      normalize_ctype('employee', default=None))
check(_nc_q('department') == 'customer',
      "D反例（导入口径）：'department' 回落到 customer ⇒ 不会落出一条部门行", _nc_q('department'))

# ── E 已有值补全清单（业态 / 片区）+ 路由注册顺序
print('')
print('E. contact_options 已有值清单 + 路由注册顺序')
from db.queries.contacts import contact_options  # noqa: E402
opts = contact_options('customer')
check(set(opts.keys()) == {'region', 'channel', 'assigned_salesperson', 'settlement_method'},
      'E：返回 4 个安全（非 PII）字段的清单', sorted(opts.keys()))
ch = opts.get('channel') or []
check('v316业态-0' in ch, "E：业态清单含库里真实存在的值 'v316业态-0'", ch[:5])
check(('v316业态-0' in ch and 'v316业态-2' in ch
       and ch.index('v316业态-0') < ch.index('v316业态-2')),
      'E：清单按出现次数降序（-0 出现 84 次 > -2 的 83 次）',
      str(ch.index('v316业态-0')) + ' < ' + str(ch.index('v316业态-2'))
      if ('v316业态-0' in ch and 'v316业态-2' in ch) else ch)
from routers.data import router as _data_router  # noqa: E402
_paths = [getattr(r, 'path', '') for r in _data_router.routes]
_io = _paths.index('/api/contacts/options') if '/api/contacts/options' in _paths else -1
_ic = _paths.index('/api/contacts/{cid}') if '/api/contacts/{cid}' in _paths else -1
check(_io >= 0 and _ic >= 0 and _io < _ic,
      'E：/contacts/options 注册在 /contacts/{cid} **之前**（否则被 {cid} 吞掉 → 422）',
      str(_io) + ' < ' + str(_ic))

# ── F 按业态筛（v316 新增的过滤维度：列表与计数必须同源）
print('')
print('F. channel 过滤（列表与计数同源）')
n_ch0 = contact_count('', 'customer', channel='v316业态-0')
r_ch0 = contact_list('', 'customer', limit=1000, channel='v316业态-0')
check(n_ch0 == 84, "F：'v316业态-0' 精确 84 条（灌 250 条时 i%3==0 的个数 = 84）", n_ch0)
check(len(r_ch0) == n_ch0,
      'F：筛后行数与计数一致（否则界面会出现「筛完 3 行 / 共 758 条」这种自相矛盾）',
      str(len(r_ch0)) + ' vs ' + str(n_ch0))
check(contact_count('', 'customer') > 84,
      'F反例：不筛时总数明显大于 84（⇒ 证明这个过滤真的在起作用，不是恒等式）',
      contact_count('', 'customer'))

# ── G 客户导入模板的列识别（逐列判："下载的模板 → 传回来 → 认得出来吗"）
print('')
print('G. 客户导入模板列识别（`_guess_mapping`）')
from routers.import_router import (  # noqa: E402
    _guess_mapping, _TEMPLATE_FIELDS, COLUMN_PATTERNS, FIELD_LABELS)

HDRS = ['名称*', '类型(客户/供应商)', '业态', '片区', '老板姓名', '老板电话', '负责业务员',
        '地址', '编码', '助记码', '结算方式', '账期(天)', '备注']
EXPECT_MAP = {'名称*': 'name', '类型(客户/供应商)': 'type', '业态': 'channel', '片区': 'region',
              '老板姓名': 'boss_name', '老板电话': 'boss_phone',
              '负责业务员': 'assigned_salesperson', '地址': 'address', '编码': 'code',
              '助记码': 'mnemonic', '结算方式': 'settlement_method', '账期(天)': 'credit_days',
              '备注': 'note'}
_gm = _guess_mapping(HDRS, 'contacts')
_got = {HDRS[i]: f for i, f in _gm.items()}
for _h, _f in EXPECT_MAP.items():
    check(_got.get(_h) == _f, "G：模板列「" + _h + "」→ " + _f, _got.get(_h, '（未识别）'))

# ── H 三处定义的一致性（模板 / 识别器 / 前端下拉必须同源，否则「下载了却传不回来」）
print('')
print('H. 模板 · 识别器 · 字段标签 三方一致性')
_tf = _TEMPLATE_FIELDS['contacts']
_req = [l for l, r in _tf if r is True]
check(_req == ['名称'], 'H：客户模板只有「名称」必填（其余 12 列选填）', _req)
_hdrs2 = [l + ('*' if r is True else '') for l, r in _tf]   # 模板生成时给必填列加的 *
_gm2 = _guess_mapping(_hdrs2, 'contacts')
_unrec = [_hdrs2[i] for i in range(len(_hdrs2)) if i not in _gm2]
check(not _unrec,
      'H：**我自己下发的模板**每一列都能被识别器认出来（否则"下载了却传不回来"）', _unrec)
check(len(_tf) == 13, 'H：模板 13 列（原 6 列僵尸模板 → 13 列）', len(_tf))
_missing = [k for k in COLUMN_PATTERNS['contacts'] if k not in FIELD_LABELS['contacts']]
check(not _missing,
      'H：COLUMN_PATTERNS 的每个字段都有中文标签（否则前端「列映射确认」下拉里选不到它）',
      _missing)

# ── J 导入落库路径：模拟导入管线那样调 contact_create（这是**用户真正会走的**那条路）
print('')
print('J. 导入落库路径（模拟 import_router 的 contacts 分支）')
from db.queries.contacts import normalize_ctype as _nc  # noqa: E402
check(_nc('员工') == 'customer',
      "J：类型填「员工」→ 归一化成 customer（不再落库成列表看不见的伪客户）", _nc('员工'))
check(_nc('员工', default=None) is None, 'J：同一规则用 default=None 时能拿到 None（端点用它判 400）',
      _nc('员工', default=None))
cid_imp = contact_create('v316验收客户-导入路径', _nc('员工'),
                         _user='v316-probe',
                         boss_name='v316导入老板', boss_phone='13900000002',
                         channel='v316业态丙', region='v316片区丁')
row_imp = contact_get(cid_imp)
check(row_imp.get('type') == 'customer', 'J：落库后 type = customer（不是 employee）', row_imp.get('type'))
check(row_imp.get('boss_name') == 'v316导入老板' and row_imp.get('channel') == 'v316业态丙',
      'J：导入路径的老板姓名 / 业态也进得去（同一批白名单修复覆盖导入）',
      str(row_imp.get('boss_name')) + ' / ' + str(row_imp.get('channel')))

print('')
print('PASS=' + str(PASS) + '  FAIL=' + str(FAIL) + '  EXPECT_PASS=' + str(EXPECT_PASS))
if FAIL == 0 and PASS == EXPECT_PASS:
    print('RESULT: ALL GREEN')
    sys.exit(0)
print('RESULT: NOT GREEN')
sys.exit(1)
