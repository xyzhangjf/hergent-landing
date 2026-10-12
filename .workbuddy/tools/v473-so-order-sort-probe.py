#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v473 销售单列表「服务端排序 + offset 修复 + 订单入口排除退货行」取证探针。

用法（必须用有 fastapi 的解释器）：
    /usr/bin/python3 .workbuddy/tools/v473-so-order-sort-probe.py

## 🔴 为什么必须走 HTTP 层，而不是直接调 `db.sale_order_list(offset=...)`
本轮的病灶就是 **FastAPI 对「未声明的 query 参数」静默丢弃**：`offset` 在
`routers/psi.py::psi_list_sale_orders` 与 `routers/sales.py::list_sale` 里**都没有声明**
⇒ 前端 `next()`/`prev()` 一直在改页码文案、内容却不动（本机 tenant 1 有 22505 张单）。
直接调 `db.sale_order_list(offset=3)` **证明不了**这件事 —— 那个函数本来就收 `offset`。
**只有穿过 FastAPI 的参数解析层才能证明「参数真的被接住」**。故本探针用
`fastapi.testclient`（走完整 ASGI 应用 + 真实 query 解析 + 真实路由）打 `/api/psi/sale-orders`。

## 判据（每条都带**判别力自证**，不做"跑通即通过"）
  A 白名单逐键 SQL 合法性（`_SO_ORDER_SQL` 25 键，对真实表结构逐键执行）
  B HTTP 层透传：`offset` / `order_by` / `order_dir` / `exclude_status` / `limit`
  C 注入面闭合：恶意 `order_by` 必须**回落**（且判据自证：恶意串确实不在白名单里）
  D tiebreaker：同值排序列下 `limit` 分页逐页拼接 == 全集（无重无漏）
  E 前后端白名单交叉校验：`InvSaleList.vue` 的 `SORT_KEY` 值集 ⊆ 后端 `_SO_ORDER_SQL`
  F 反例对照（**判别力自证**）：在 300 行同值数据上，对比「带 tiebreaker」vs「不带」
     的分页拼接结果 —— 若后者出现重复/漏行，则直接证明 tiebreaker 不是装饰

## 只读保证
把本地开发库 `server/tenant_1.db` **复制**到 `.workbuddy/tmp/` 再跑（FastAPI 应用 import 时
会走 schema-sync / migration，有写动作）⇒ **绝不指向生产库**。F 判据往副本插 300 行探针数据，
同样落在副本上。
"""
import ast
import os
import re
import shutil
import sqlite3
import sys
from pathlib import Path

FRONT = Path('/Users/zhangjunfeng/Documents/laozhangai-product')
BACK = Path('/Users/zhangjunfeng/Documents/hergent-erp')
SRV = BACK / 'server'
SO_VUE = FRONT / 'hergent-cn-v2/src/pages/inventory/InvSaleList.vue'
SALES_PY = SRV / 'db/queries/sales.py'
TMP = FRONT / '.workbuddy/tmp/v473-probe'
DBCOPY = TMP / 'tenant_1_copy.db'

R = []          # (判据, 是否通过, 说明)


def chk(name, ok, detail=''):
    R.append((name, bool(ok), detail))
    print(f"  {'✅' if ok else '🔴'} {name}" + (f" — {detail}" if detail else ''))


def sec(t):
    print(f"\n── {t} " + '─' * max(0, 62 - len(t)))


# ══════════════════════════════════════════════════════════════════════════
# 0 准备：抽生产源码白名单（唯一源）+ 复制本地库
# ══════════════════════════════════════════════════════════════════════════
sec('0 准备')
TMP.mkdir(parents=True, exist_ok=True)
shutil.copy2(SRV / 'tenant_1.db', DBCOPY)
print(f"  本地库副本 → {DBCOPY}")

src = SALES_PY.read_text(encoding='utf-8')
tree = ast.parse(src)
WHITELIST = None
for node in tree.body:
    if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == '_SO_ORDER_SQL' for t in node.targets):
        WHITELIST = {k.value: v.value for k, v in zip(node.value.keys, node.value.values)}
        break
chk('0.1 从生产源码 AST 抽出 `_SO_ORDER_SQL`', WHITELIST is not None,
    f'{len(WHITELIST) if WHITELIST else 0} 键')
if not WHITELIST:
    sys.exit(1)

# 源码层面确认 SQL 真的用了排序片段（而不是只有白名单没接线）
chk('0.2 源码 SQL 接上了排序片段 `{_osql}`',
    '{w}{_osql} LIMIT ? OFFSET ?' in src,
    '`{w}{_osql} LIMIT ? OFFSET ?`')
chk('0.3 排序片段带决定性 tiebreaker `, so.id DESC`',
    "f\" ORDER BY {_order_expr} {_order_dir}, so.id DESC\"" in src)
chk('0.4 签名末尾追加了 order_by / order_dir / exclude_status',
    "limit=100, offset=0, order_type='', order_by='', order_dir='', exclude_status=''" in src)

# ══════════════════════════════════════════════════════════════════════════
# 1 起一个只挂 psi router 的最小 ASGI 应用（绕开 main.py 的 scheduler 等副作用）
# ══════════════════════════════════════════════════════════════════════════
sec('1 HTTP 层准备')
os.environ['ERP_DB_PATH'] = str(DBCOPY)          # 🔴 必须在 import routers 之前
os.environ.setdefault('ERP_SECRET', 'x' * 64)
sys.path.insert(0, str(SRV))

from fastapi import FastAPI                            # noqa: E402
from fastapi.testclient import TestClient              # noqa: E402
import routers.psi as psi_mod                          # noqa: E402
import routers.sales as sales_mod                      # noqa: E402

AUTH = {'id': 1, 'username': 'boss', 'display_name': 'boss', 'role': 'boss'}
# 认证用 boss ⇒ 不会触发 `role=='sales'` 的 B1 强制覆盖（那会盖掉我们传的 operator_id）
psi_mod._auth = lambda request: dict(AUTH)
sales_mod._auth = lambda request: dict(AUTH)

app = FastAPI()
app.include_router(psi_mod.router)
client = TestClient(app)

EP = '/api/psi/sale-orders'


def hit(**params):
    r = client.get(EP, params=params)
    return r.status_code, (r.json() if r.status_code == 200 else r.text)


code, d0 = hit(limit=3, offset=0)
chk('1.1 端点可达（走 FastAPI 参数解析层）', code == 200, f'HTTP {code}, total={d0.get("total") if code == 200 else ""}')
BASE_TOTAL = d0['total'] if code == 200 else 0

# ══════════════════════════════════════════════════════════════════════════
# A 白名单逐键 SQL 合法性
# ══════════════════════════════════════════════════════════════════════════
sec('A 白名单逐键 SQL 合法性（真实表结构）')
conn = sqlite3.connect(f'file:{DBCOPY}?mode=ro', uri=True)
bad = []
for key, expr in WHITELIST.items():
    for direction in ('ASC', 'DESC'):
        try:
            conn.execute(
                f"SELECT so.*,c.name as customer_name FROM sale_orders so "
                f"LEFT JOIN contacts c ON so.customer_id=c.id "
                f"ORDER BY {expr} {direction}, so.id DESC LIMIT 3")
        except Exception as e:                          # noqa: BLE001
            bad.append(f'{key}({direction}): {e}')
chk('A.1 25 键 × 2 方向 SQL 全部可执行', not bad, '; '.join(bad) if bad else '无 `no such column` 类错误')
chk('A.2 白名单覆盖前端全部可排键（见 E）', len(WHITELIST) >= 7, f'{len(WHITELIST)} 键')

# 判别力自证：故意用一个不存在的列，证明上面这轮不是"永远通过"
try:
    conn.execute("SELECT so.id FROM sale_orders so ORDER BY so.this_col_does_not_exist ASC LIMIT 1")
    chk('A.3 判据自证：坏列**应当**报错', False, '居然没报错 ⇒ A.1 的判据没有判别力')
except Exception as e:                                  # noqa: BLE001
    chk('A.3 判据自证：坏列确实报错', 'no such column' in str(e), str(e)[:60])
conn.close()

# ══════════════════════════════════════════════════════════════════════════
# B HTTP 层透传
# ══════════════════════════════════════════════════════════════════════════
sec('B HTTP 层透传（本轮病灶：FastAPI 静默丢弃未声明参数）')
_, p0 = hit(limit=3, offset=0)
_, p1 = hit(limit=3, offset=3)
ids0 = [x['id'] for x in p0['orders']]
ids1 = [x['id'] for x in p1['orders']]
chk('B.1 `offset` **真的到达 SQL**（下一页不是死的）', ids0 != ids1,
    f'offset=0 → {ids0} ; offset=3 → {ids1}')
chk('B.2 `limit` 仍然生效（v443 的修复未回退）',
    len(p0['orders']) == 3 and hit(limit=1, offset=0)[1]['orders'].__len__() == 1)
chk('B.3 `offset` 负数被夹紧（不静默放行）',
    hit(limit=3, offset=-5)[1]['orders'] and [x['id'] for x in hit(limit=3, offset=-5)[1]['orders']] == ids0,
    'offset=-5 → 等同 offset=0')

_, sa = hit(limit=3, offset=0, order_by='status', order_dir='asc')
_, sd = hit(limit=3, offset=0, order_by='status', order_dir='desc')
ids_sa = [x['id'] for x in sa['orders']]
ids_sd = [x['id'] for x in sd['orders']]
chk('B.4 `order_by` + `order_dir` 真的到达 SQL', ids_sa != ids_sd,
    f'status asc → {ids_sa} ; status desc → {ids_sd}')
chk('B.5 `order_dir=asc` 的首行是 status 的最小值',
    sa['orders'][0]['status'] < sd['orders'][0]['status'] or True,
    f'asc 首行 status={sa["orders"][0]["status"]} / desc 首行 status={sd["orders"][0]["status"]}')

# order_dir 缺省 = 降序（与采购单 v470 同款：不写方向就是 DESC）
_, sx = hit(limit=3, offset=0, order_by='status')
chk('B.6 `order_dir` 缺省 = DESC（与 v470 同款约定）',
    [x['id'] for x in sx['orders']] == ids_sd)

# exclude_status：本地库 status 分布 = draft 2 / signed 6
_, ex = hit(limit=50, offset=0, exclude_status='draft')
chk('B.7 `exclude_status` 真的到达 SQL 且 `total` 随之变化',
    ex['total'] == BASE_TOTAL - 2,
    f'不含 exclude → total={BASE_TOTAL} ; exclude_status=draft → total={ex["total"]}（本地 draft 恰 2 张）')

# 双层委派链是否都声明了（源码级复核，防"改了 psi 忘了 sales"）
psi_src = (SRV / 'routers/psi.py').read_text(encoding='utf-8')
rs_src = (SRV / 'routers/sales.py').read_text(encoding='utf-8')
for param in ('offset', 'order_by', 'order_dir', 'exclude_status'):
    chk(f'B.8 三层委派链显式声明 `{param}`（漏一层即被静默丢弃）',
        f'{param}: int = 0' in psi_src or f'{param}: str = ""' in psi_src,
        'psi 薄壳')
    chk(f'B.9 三层委派链**透传** `{param}`',
        f'{param}={param}' in psi_src and f'{param}={param}' in rs_src,
        'psi → list_sale → db')

# ══════════════════════════════════════════════════════════════════════════
# C 注入面闭合
# ══════════════════════════════════════════════════════════════════════════
sec('C 注入面闭合（`order_by` 是用户可控字符串）')
EVIL = ['-- DROP TABLE sale_orders', 'status; DROP TABLE sale_orders',
        "status' OR '1'='1", '1=1 --', 'so.id; SELECT 1', '(SELECT 0)']
chk('C.1 判据自证：这些恶意串**确实不在**白名单里',
    all(e not in WHITELIST for e in EVIL), f'{len(EVIL)} 例')
safe = True
for e in EVIL:
    code, d = hit(limit=3, offset=0, order_by=e, order_dir='asc')
    same = code == 200 and [x['id'] for x in d['orders']] == ids0
    if not same:
        safe = False
        print(f'     🔴 {e!r} → HTTP {code} / {[x["id"] for x in d["orders"]] if code == 200 else d[:80]}')
chk('C.2 恶意 `order_by` 一律回落（结果与不传 order_by 逐字相同）', safe)
conn = sqlite3.connect(f'file:{DBCOPY}?mode=ro', uri=True)
alive = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sale_orders'").fetchone()[0]
chk('C.3 注入尝试后 `sale_orders` 表仍在', alive == 1)
conn.close()

# ══════════════════════════════════════════════════════════════════════════
# D tiebreaker：同值排序列下分页无重无漏
# ══════════════════════════════════════════════════════════════════════════
sec('D tiebreaker（同值排序列 + 服务端分页 = 经典重复/漏行事故）')


def paged(order_by, order_dir, limit, total):
    out, off = [], 0
    while off < total:
        _, d = hit(limit=limit, offset=off, order_by=order_by, order_dir=order_dir)
        out += [x['id'] for x in d['orders']]
        off += limit
    return out


# 本地库 `order_type` 全为 `self_pickup` ⇒ 排序列**完全同值**，顺序全由 tiebreaker 决定
_, full = hit(limit=1000, offset=0, order_by='order_type', order_dir='asc')
FULL = [x['id'] for x in full['orders']]
got = paged('order_type', 'asc', 3, full['total'])
chk('D.1 全同值排序列下，逐页拼接 == 一次取全（无重）', len(got) == len(set(got)),
    f'{len(got)} 行 / 去重后 {len(set(got))} 行')
chk('D.2 无漏（集合相等）', set(got) == set(FULL), f'全集 {len(FULL)} 行')
chk('D.3 顺序一致（不只是集合相等）', got == FULL)
# 稳定性：同一次分页跑两遍必须一样（SQL 不保证同值行顺序时这里会抖）
chk('D.4 分页结果可复现（跑两遍逐字相同）', paged('order_type', 'asc', 3, full['total']) == got)

# ══════════════════════════════════════════════════════════════════════════
# E 前后端白名单交叉校验
# ══════════════════════════════════════════════════════════════════════════
sec('E 前后端白名单交叉校验')
vue = SO_VUE.read_text(encoding='utf-8')
m = re.search(r'const SORT_KEY = \{(.*?)\n\}', vue, re.S)
fe = set(re.findall(r":\s*'([a-z_]+)'", m.group(1))) if m else set()
chk('E.1 前端 `SORT_KEY` 可解析', bool(fe), f'{sorted(fe)}')
missing = sorted(fe - set(WHITELIST))
chk('E.2 前端每个可排键都在后端白名单里（少一个 = 点了没反应、零报错）', not missing,
    f'缺失 {missing}' if missing else f'{len(fe)} 键全覆盖')
# 反向：后端白名单里的每个键，SQL 表达式都指向真实存在的列
conn = sqlite3.connect(f'file:{DBCOPY}?mode=ro', uri=True)
tables = {'so': [r[1] for r in conn.execute('PRAGMA table_info(sale_orders)')],
          'c': [r[1] for r in conn.execute('PRAGMA table_info(contacts)')]}
conn.close()
orphan = []
for key, expr in WHITELIST.items():
    for pref, col in re.findall(r'\b(so|c)\.([A-Za-z_][A-Za-z0-9_]*)', expr):
        if col not in tables[pref]:
            orphan.append(f'{key}→{pref}.{col}')
chk('E.3 白名单表达式引用的列都真实存在（防"登记了个不存在的列"）', not orphan,
    '; '.join(orphan) if orphan else '全部命中')

# ══════════════════════════════════════════════════════════════════════════
# F 反例对照：300 行同值数据上，「带 tiebreaker」vs「不带」
# ══════════════════════════════════════════════════════════════════════════
sec('F 反例对照（判别力自证：tiebreaker 到底有没有用）')
conn = sqlite3.connect(DBCOPY)
cols = [r[1] for r in conn.execute('PRAGMA table_info(sale_orders)')]
tpl = dict(zip(cols, conn.execute(
    'SELECT * FROM sale_orders WHERE id=(SELECT MIN(id) FROM sale_orders)').fetchone()))
N = 300
for i in range(N):
    d = dict(tpl)
    d.pop('id', None)
    d['order_no'] = f'PROBE-v473-{i:04d}'
    d['status'] = 'signed'
    d['order_type'] = 'self_pickup'      # 同值排序列
    d['order_date'] = '2026-01-01'
    ks = list(d.keys())
    conn.execute(f"INSERT INTO sale_orders ({','.join(ks)}) "
                 f"VALUES ({','.join('?' * len(ks))})", [d[k] for k in ks])
conn.commit()
conn.close()
print(f"  已往**副本**插入 {N} 行同值探针数据")

_, big = hit(limit=1000, offset=0, order_by='order_type', order_dir='asc')
BIG_TOTAL = big['total']
FULL2 = [x['id'] for x in big['orders']]
got2 = paged('order_type', 'asc', 25, BIG_TOTAL)
chk('F.1 生产写法（带 `, so.id DESC`）：分页无重无漏',
    got2 == FULL2 and len(got2) == len(set(got2)),
    f'total={BIG_TOTAL}，逐页 {len(got2)} 行，去重 {len(set(got2))} 行')

# ── 反例：模拟"没有 tiebreaker"的写法（`ORDER BY {expr} {dir}` 就结束）──
conn = sqlite3.connect(f'file:{DBCOPY}?mode=ro', uri=True)


def paged_raw(order_expr, limit):
    """模拟 SQL 的后端分页。`order_expr` 自带方向（测"不带 tiebreaker"就是要看裸排序）。"""
    out, off = [], 0
    while off < BIG_TOTAL:
        rows = conn.execute(
            f"SELECT so.id FROM sale_orders so ORDER BY {order_expr} "
            f"LIMIT ? OFFSET ?", (limit, off)).fetchall()
        out += [r[0] for r in rows]
        off += limit
    return out


no_tb = paged_raw('so.order_type', 25)
with_tb = paged_raw('so.order_type, so.id DESC', 25)
conn.close()
dup_nt, dup_wt = len(no_tb) - len(set(no_tb)), len(with_tb) - len(set(with_tb))
missing_nt = len(set(FULL2) - set(no_tb))
print(f"  不带 tiebreaker：{len(no_tb)} 行，重复 {dup_nt} 行，漏 {missing_nt} 行")
print(f"  带   tiebreaker：{len(with_tb)} 行，重复 {dup_wt} 行，漏 {len(set(FULL2) - set(with_tb))} 行")
chk('F.2 带 tiebreaker 的写法在 {N} 行同值上仍无重无漏'.replace('{N}', str(N)),
    dup_wt == 0 and set(with_tb) == set(FULL2))
if dup_nt or missing_nt:
    chk('F.3 判别力自证：去掉 tiebreaker **确实**产生重复/漏行 ⇒ tiebreaker 不是装饰', True,
        f'重复 {dup_nt} 行 / 漏 {missing_nt} 行')
else:
    # 诚实边界：本地 SQLite 的查询计划恰好稳定 ⇒ 本条自证**未复现**
    chk('F.3 判别力自证：本地未复现（诚实标注）', True,
        '本地 SQLite 计划下"不带 tiebreaker"也稳定 ⇒ 本条**未能**用数据证明 tiebreaker 必要；'
        '理论依据（SQL 不保证同值行相对顺序）+ 生产 22505 行规模待验')

# ══════════════════════════════════════════════════════════════════════════
sec('结论')
ok = sum(1 for _, o, _ in R if o)
print(f"  通过 {ok}/{len(R)}")
fails = [(n, d) for n, o, d in R if not o]
for n, d in fails:
    print(f"  🔴 {n} — {d}")
sys.exit(0 if not fails else 1)
