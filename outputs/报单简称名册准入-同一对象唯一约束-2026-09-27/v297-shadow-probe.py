# -*- coding: utf-8 -*-
"""v297 影子库验收：① 名册只列真列头（listed）② 同一对象只能有一条活跃配置（四条写路径硬拒）

跑法：
  rm -rf /tmp/v297-shadow && mkdir -p /tmp/v297-shadow && cp /tmp/v297_snap.db /tmp/v297-shadow/tenant_1.db
  ERP_DB_PATH=/tmp/v297-shadow/erp.db python .tmp_v297_probe.py
"""
# ⚠️ 归档版说明：本文件里的生产专有名（员工 / 门店 / 档案）已全部替换为 `<...>` 占位符。
#    要在自己的影子库上重跑：先按你的库内容**全局替换这些占位符**（9 处，均在下方断言中），
#    再设 ERP_DB_PATH 指向影子目录。原始取值未随本文件入库。

import os, sys, sqlite3, json

SERVER = '/Users/zhangjunfeng/Documents/hergent-erp/server'
sys.path.insert(0, SERVER)

SHADOW = os.environ.get('ERP_DB_PATH', '')
if not SHADOW:
    print('缺 ERP_DB_PATH'); sys.exit(1)
TDB = os.path.join(os.path.dirname(SHADOW), 'tenant_1.db')
if not os.path.exists(TDB):
    print('缺影子副本:', TDB); sys.exit(1)

import db.connection as conn
import erp_db as E

conn.set_tenant_context(1)

FAIL = []
def ck(label, cond, detail=''):
    print(('  ✅ ' if cond else '  ❌ ') + label + (('  ' + str(detail)) if detail else ''))
    if not cond:
        FAIL.append(label)

def _rd():
    # ⚠️ 这里**不能**加 `immutable=1`：影子副本正被 erp_db 写入（库是 WAL 模式），
    #    immutable=1 会让 SQLite 假定文件永不变化、**忽略 -wal** ⇒ 读到的永远是写入前的
    #    旧快照（实测：INSERT 明明成功、行数却不变，看着像"写没生效"）。
    #    静态备份才用 immutable=1；活库只读用 mode=ro。
    return sqlite3.connect('file:%s?mode=ro' % TDB, uri=True)

def rows():
    c = _rd()
    n = c.execute('SELECT COUNT(*) FROM report_mapping').fetchone()[0]
    ids = [r[0] for r in c.execute('SELECT id FROM report_mapping ORDER BY id')]
    c.close()
    return n, ids

def one(mid):
    c = _rd()
    r = c.execute('SELECT id, counterparty_type, counterparty_id, report_alias, is_active '
                  'FROM report_mapping WHERE id=?', (mid,)).fetchone()
    c.close()
    return r

REJ, ALLOW = [], []
def rej(label, res):
    ok = bool(res.get('error'))
    ck(label, ok, res)
    if ok: REJ.append(label)
    return res
def allow(label, res):
    ok = res.get('success') is True
    ck(label, ok, res)
    if ok: ALLOW.append(label)
    return res

# ── [0] 连接自证 ────────────────────────────────────────────────────────
print('=== [0] 连接自证 ===')
_c = sqlite3.connect(TDB)
print('   database_list =', _c.execute('PRAGMA database_list').fetchall()[0][2])
_c.close()
N0, IDS0 = rows()
print('   report_mapping 行数 =', N0, 'ids =', IDS0)
ck('[0] 影子副本存在且可读', N0 == 7, 'n=%s' % N0)
ck('[0] 快照里 id=7 此刻**是活跃的**（这正是生产现状）', one(7)[4] == 1, one(7))

# ── [1] listed 语义：名册只列真列头 ─────────────────────────────────────
print('\n=== [1] 名册准入判据（listed） ===')
pool = E.report_mapping_alias_pool()
ck('[1] success', pool.get('success') is True)
st = pool.get('stats') or {}
rows_ = pool.get('aliases') or []
by_name = {r['name']: r for r in rows_}
listed = [r['name'] for r in rows_ if r.get('listed')]
notlisted = [r['name'] for r in rows_ if not r.get('listed')]
print('   stats =', st)
print('   listed(%d) =' % len(listed), listed)
print('   未列入候选(%d) =' % len(notlisted), notlisted)
ck('[1] 每条都有 listed 字段', all('listed' in r for r in rows_))
ck('[1] stats.total == listed 条数（表头数字与候选同源）',
   st.get('total') == len(listed), '%s vs %s' % (st.get('total'), len(listed)))
ck('[1] 三个「只在配置里出现过」的名字被判为不进候选（用户拍板「清」）',
   sorted(notlisted) == sorted(['<门店B档案名>', '<门店A档案名>', '<门店C档案名>']), notlisted)
ck('[1] stats.configured_only == 3', st.get('configured_only') == 3, st.get('configured_only'))
ck('[1] 真列头仍在候选（4 个：两个门店简称 + 两个自营仓员工）',
   all(n in listed for n in ('<门店A真列头>', '<门店B真列头>', '<员工B>', '<员工A>')))
ck('[1] 被隐藏的列头仍在候选（可点选恢复）', '永诺旗舰店' in listed and '沃尔玛' in listed)
ck('[1] 未进候选的名字**仍在 aliases 里**（撞名/查重还要用它）',
   '<门店A档案名>' in by_name and '<门店B档案名>' in by_name)
_sug = pool.get('suggest') or {}
ck('[1] suggest 仍含 store:2225 且 nearby 指向该门店的真列头',
   '<门店B真列头>' in (_sug.get('store:2225') or {}).get('nearby', []),
   json.dumps(_sug.get('store:2225') or {}, ensure_ascii=False))
ck('[1] 判别力：候选组与非候选组都非空（判据不是恒定值）',
   bool(listed) and bool(notlisted))

# ── [2] create 硬拒 ─────────────────────────────────────────────────────
print('\n=== [2] create：同一对象只能有一条活跃配置 ===')
rej('[2] 撞已有活跃配置(门店 2868) 被拒',
    E.report_mapping_create({'employee_id': 7, 'counterparty_type': 'store',
                             'counterparty_id': 2868, 'system_name': '<门店A档案名>',
                             'report_alias': '__探针_A__'}))
N1, _ = rows(); ck('[2] 被拒后行数未变', N1 == N0, '%s -> %s' % (N0, N1))
r_ok = allow('[2] 正例对照：新门店可建（不是无差别拒绝）',
             E.report_mapping_create({'employee_id': 7, 'counterparty_type': 'store',
                                      'counterparty_id': 9991, 'system_name': '__探针新门店__',
                                      'report_alias': '__探针_B__'}))
NEW_ID = int(r_ok.get('mapping_id') or 0)
N2, _ = rows(); ck('[2] 正例确实落库（行数 +1）', N2 == N0 + 1, '%s -> %s' % (N0, N2))
rej('[2] self_warehouse 轴同样硬拒（该自营仓已有活跃配置）',
    E.report_mapping_create({'employee_id': 4, 'counterparty_type': 'self_warehouse',
                             'system_name': '<员工B>仓', 'report_alias': '__探针_C__'}))
r_wh_ok = allow('[2] 正例对照：未被占用的本人仓可建',
                E.report_mapping_create({'employee_id': 5, 'counterparty_type': 'self_warehouse',
                                         'system_name': '郝洋仓', 'report_alias': '__探针_D__'}))
WH_NEW = int(r_wh_ok.get('mapping_id') or 0)

# ── [3] update ──────────────────────────────────────────────────────────
print('\n=== [3] update ===')
rej('[3] 把新配置改成已占用的门店 2868 → 被拒',
    E.report_mapping_update(NEW_ID, {'counterparty_id': 2868, 'system_name': '<门店A档案名>'}))
ck('[3] 被拒后该行对象未被改动', one(NEW_ID)[2] == 9991, one(NEW_ID))
allow('[3] 编辑自己那条（本人仓）→ 放行，不被自己拦',
      E.report_mapping_update(WH_NEW, {'report_alias': '__探针_D2__'}))
# 🔴 部署后果取证：id=7（对象 2868）此刻仍活跃 ⇒ 连 id=3（自己就是 2868）都改不动。
#    这是「必须先清数据，否则上线即把用户锁在编辑之外」的硬证据。
rej('[3] 🔴 id=7 未清时，连 id=3 自己都保存不了（⇒ 上线前必须先清数据）',
    E.report_mapping_update(3, {'report_alias': '<门店A真列头>'}))

# ── [4] 清理 + 门禁不可绕过 + 有活路 ────────────────────────────────────
print('\n=== [4] 清理重复占用 → 解锁；启用方向门禁；改挂是活路 ===')
allow('[4] 停用 id=7（= 清理重复占用动作）→ 放行', E.report_mapping_toggle(7, 0))
ck('[4] 停用后 is_active 确为 0', one(7)[4] == 0, one(7))
allow('[4] 🔴 清理后 id=3 恢复可保存（锁门解除）',
      E.report_mapping_update(3, {'report_alias': '<门店A真列头>'}))
rej('[4] 重新启用 id=7（对象 2868 已被 id=3 占用）→ 被拒，防「停用再启用」绕过',
    E.report_mapping_toggle(7, 1))
ck('[4] 被拒后 is_active 仍为 0（没有假成功）', one(7)[4] == 0, one(7))
allow('[4] 把 id=7 改挂到别的门店 → 放行（给出活路，不是死锁）',
      E.report_mapping_update(7, {'counterparty_id': 9992, 'system_name': '__探针另一门店__'}))
allow('[4] 改挂后再启用 → 放行（现在不冲突了）', E.report_mapping_toggle(7, 1))
allow('[4] 启用无人占用的 id=4（对象 2220）→ 放行', E.report_mapping_toggle(4, 1))

# ── [5] 历史 `customer` 写法必须参与判重；轴不能互相误伤 ────────────────
print('\n=== [5] 历史 `customer` 写法参与判重 ===')
c = sqlite3.connect(TDB)
c.execute("INSERT INTO report_mapping (employee_id, counterparty_type, counterparty_id, system_name, "
          "report_alias, order_template, src_wh, dst_wh, is_active) VALUES (7,'customer',7777,'__探针legacy__',"
          "'__探针_E__','自提订单',0,0,1)")
c.commit(); c.close()
rej('[5] 老行存 `customer`，新建 `store` 同 id → 仍被抓到',
    E.report_mapping_create({'employee_id': 7, 'counterparty_type': 'store',
                             'counterparty_id': 7777, 'system_name': '__探针legacy__',
                             'report_alias': '__探针_F__'}))
allow('[5] 轴隔离：门店 7 不被仓库 7 的占用误伤',
      E.report_mapping_create({'employee_id': 7, 'counterparty_type': 'store',
                               'counterparty_id': 7, 'system_name': '__探针门店七号__',
                               'report_alias': '__探针_G__'}))

# ── [6] import ──────────────────────────────────────────────────────────
print('\n=== [6] import（含同一批内自撞） ===')
imp = E.report_mapping_import([
    {'employee': '<老板>', 'counterparty_type': 'store', 'system_name': '<门店A档案名>',
     'report_alias': '__探针_H__'},
    {'employee': '<老板>', 'counterparty_type': 'store', 'system_name': '<门店D档案名>',
     'report_alias': '__探针_H2__'},
    {'employee': '<老板>', 'counterparty_type': 'store', 'system_name': '<门店D档案名>',
     'report_alias': '__探针_H3__'},
])
print('   ', json.dumps(imp, ensure_ascii=False)[:400])
ck('[6] 撞已占用对象那行 + 批内自撞行都被拦，只有中间那行进库',
   imp.get('imported') == 1 and imp.get('failed') == 2, imp)
ck('[6] 拦下的理由都点明「已有一条活跃配置」',
   all('已有一条活跃配置' in f.get('reason', '') for f in (imp.get('failures') or [])))

# ── [7] 判别力自证 ──────────────────────────────────────────────────────
print('\n=== [7] 判别力自证 ===')
print('   硬拒 %d 处：' % len(REJ))
for x in REJ: print('     ·', x)
print('   放行 %d 处：' % len(ALLOW))
for x in ALLOW: print('     ·', x)
ck('[7] 硬拒 6 处 / 放行 9 处 —— 两组都非空，且数字写死（少一处 = 有校验被删掉了）',
   len(REJ) == 6 and len(ALLOW) == 9, '%s / %s' % (len(REJ), len(ALLOW)))
ck('[7] 「只在配置里出现过」的名字在候选里确实为假值（listed 判据真的在起作用）',
   notlisted and not any(by_name[n]['listed'] for n in notlisted))

# ── [8] 空库（老租户）回归：名册不能把页面带崩 ──────────────────────────
print('\n=== [8] 空租户库回归 ===')
open(os.path.join(os.path.dirname(SHADOW), 'tenant_2.db'), 'w').close()
conn.set_tenant_context(2)
try:
    p2 = E.report_mapping_alias_pool()
    ck('[8] 空库调用不抛异常且 success', p2.get('success') is True, p2.get('stats'))
    ck('[8] 空库 stats.total == 0（没有凭空造出列头）',
       (p2.get('stats') or {}).get('total') == 0, p2.get('stats'))
    # ⚠️ 本段只覆盖**我改动的读面**（alias_pool 的 listed 计算）在「零条数据」时不炸。
    #    不测 `report_mapping_create`：真实租户库在建库时就带 `report_mapping` 表，
    #    一个连表都没有的库不是现实场景（create 报 no such table 属既有行为，不在本轮范围）。
    ck('[8] 零条数据时 listed/configured_only 仍自洽',
       (p2.get('stats') or {}).get('configured_only') == 0 and (p2.get('aliases') or []) == [],
       p2.get('stats'))
except Exception as e:
    ck('[8] 空库调用不抛异常', False, '%s: %s' % (type(e).__name__, e))
conn.set_tenant_context(1)

print('\n' + ('🎉 ALL PASS' if not FAIL else '❌ FAIL: ' + '; '.join(FAIL)))
sys.exit(1 if FAIL else 0)
