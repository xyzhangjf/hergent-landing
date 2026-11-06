#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阶段 1 累积补丁生成器（生产快照 → 开发副本）

为什么要有这个脚本
------------------
`.workbuddy/stage1/dev-src/` 是「生产快照 + 累积补丁」的展开形态。补丁**必须**能
从这两样东西逐字节重建出 dev-src，否则「补丁」只是一份参考文件，落不落地全靠人眼。

手工拼 patch 已经踩过两次：路径多剥一层（`a/server/...` 与 `cd server && patch -p1` 冲突）、
heredoc 缺换行把注释拼成一行。所以改成脚本：**diff 只由工具产生，人只维护文件清单**。

用法：
    /usr/bin/python3 .workbuddy/tools/stage1-make-patch.py
    # 生成后自证（必须有这一步）：
    /usr/bin/python3 .workbuddy/tools/stage1-dev-src-rebuild.py --check

退出码：0 = 生成成功；2 = 快照/文件缺失。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAP = ROOT / '.workbuddy/stage0/prod-src-20261106'
DEV = ROOT / '.workbuddy/stage1/dev-src'
OUT = ROOT / '.workbuddy/stage1/patches/stage1-accumulated.patch'

# 改动的既有文件（顺序 = 打补丁顺序，erp_db 放前面便于人工 review 主体）
PATCHED = [
    'erp_db.py',
    'server.py',
    'sync_writer.py',
    'domain/wastage_tracker.py',
    'db/queries/inventory.py',
    'db/queries/purchases.py',
    'db/queries/sales.py',
    'db/queries/approvals.py',
]
# 新增文件（快照里没有）
CREATED = [
    'db/queries/stock_movement.py',
    'db/queries/doc_state.py',
]

HEADER = """阶段 1 累积补丁（账可信 + 状态可信）
=====================================

本文件取代 `stock-movement-convergence.patch`（那份只含第 1 项，已并入此处）。

包含两项：
  第 1 项 · 库存写入点收敛
    · db/queries/stock_movement.py  新增统一写入口（台账 / 流水 / 余额三写同一 SAVEPOINT）
    · db/queries/inventory.py       6 处内联写入收编
    · db/queries/purchases.py       收货链路收编
    · erp_db.py                     5 处收编（AI 回滚 ×2、装配、期初、演示数据）
    · sync_writer.py / domain/wastage_tracker.py  各 1 处收编

  第 3 项 · 状态跃迁白名单
    · db/queries/doc_state.py       新增：5 类单据的状态词表 + 跃迁白名单 + 派生 docstatus
                                    + 唯一写入口 set_doc_status + 中文原因
    · db/queries/sales.py           发货/签收/取消/驳回补来源守卫；修掉「拣货中发不出货」
    · db/queries/purchases.py       整单收货补守卫（原先只有 SELECT 校验，写入裸奔）
    · db/queries/approvals.py       审批引擎改从 doc_state 取规则，不再自带第二份状态机
    · server.py                     AI 动作 approve/reject 不再裸写状态；路由层不再复述状态机
    · erp_db.py                     打包发货 / RMA 驳回·处置·退款 / AI 回滚 / 撤销建议 补守卫；
                                    影子状态机报错改中文

不新增 `docstatus` 物理列：本轮用 `docstatus_of()` 派生（理由见 doc_state.py 文件头）。

用法
----
    cd server && patch -p1 --batch -f < stage1-accumulated.patch

    ⚠️ 必须先 `--batch -f` 并把 stdin 接到 /dev/null：不加会等交互输入，
       在自动化里表现为「卡住后被 SIGTERM（exit 137、零输出）」。

自证
----
    /usr/bin/python3 .workbuddy/tools/stage1-dev-src-rebuild.py --check
    # 「生产快照 + 本补丁」重建出来必须与 dev-src 逐字节一致

----------------------------------------------------------------------

"""


def diff_one(rel, created=False):
    b = DEV / rel
    if not b.is_file():
        raise SystemExit('❌ dev-src 缺文件：%s' % b)
    if created:
        cmd = ['diff', '-u', '--label', '/dev/null', '--label', 'b/' + rel, '/dev/null', str(b)]
    else:
        a = SNAP / rel
        if not a.is_file():
            raise SystemExit('❌ 生产快照缺文件：%s（先从线上回拉）' % a)
        cmd = ['diff', '-u', '--label', 'a/' + rel, '--label', 'b/' + rel, str(a), str(b)]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode not in (0, 1):
        raise SystemExit('❌ diff 失败 %s：%s' % (rel, r.stderr.strip()))
    return r.stdout


def main():
    if not SNAP.is_dir():
        print('❌ 缺少生产快照：%s' % SNAP)
        return 2
    parts = [HEADER]
    changed = 0
    for rel in PATCHED:
        d = diff_one(rel)
        if d.strip():
            parts.append(d if d.endswith('\n') else d + '\n')
            changed += 1
    for rel in CREATED:
        parts.append(diff_one(rel, created=True))
        changed += 1
    text = ''.join(parts)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding='utf-8')
    print('✅ 已生成 %s' % OUT)
    print('   涉及 %d 个文件（改动 %d + 新增 %d），%d 行'
          % (changed, len(PATCHED), len(CREATED), text.count('\n')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
