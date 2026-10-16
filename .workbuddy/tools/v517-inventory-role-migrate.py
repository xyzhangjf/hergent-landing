#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v517（2026-10-16）：**进销存岗位分权 —— 给会计 / 主管补 `inventory` 权限（只补不删）**

老板拍板（选项 A+A）：
  · 开门范围 = 会计 accountant + 主管 supervisor（**不给** 销售/导购/司机/库管 ——
    `inventory` 是整块权限，开了就等于把进价与成本白送出去）；
  · 权限档位 = **能看 + 能建单，不能改、不能删** ⇒ `inventory: ["read", "create"]`。

🔴 为什么必须迁租户库、改 `_DEFAULT_PERMS` 没用（v293/v325/v332/v333 同族第四次）：
   `_DEFAULT_PERMS` 只管**没有被租户库覆盖**的角色；tenant_1 / tenant_10 的
   accountant / supervisor **都是存量覆盖**（整表覆盖语义）⇒ 只改默认表对这两个租户零效果。

🔴 为什么 tenant_10 要顺带做 list → dict 转换（等价性硬要求）：
   `_perm_granted()` 对 **list 格式 = 该模块全部动作放行**（不看 action），
   只有 dict 格式才按 read/create/update/delete 细分。
   tenant_10 的 accountant / supervisor 存的是 list ⇒ 直接 append "inventory"
   会给他们**全权限（含改、删）**，直接违背老板选的档位。
   ⇒ 转换时把原有每个模块写成 `["*"]`（与"全动作放行"**逐字等价**），
      再单独给 `inventory: ["read","create"]`。

🔴 备份用 `sqlite3 .backup`（不是裸 `cp`）：生产库是 WAL 模式，不带 `-wal` 的裸 cp
   不是一个有效还原点（v508 付学费）。

用法：
    python3 v517-inventory-role-migrate.py            # dry-run，只打印不落库
    python3 v517-inventory-role-migrate.py --apply    # 真落库（先自动备份）
"""
import json
import os
import sqlite3
import sys
from datetime import datetime

APPLY = '--apply' in sys.argv
TARGET_ROLES = ('accountant', 'supervisor')
ADD_ACTIONS = ['read', 'create']
DBS = ['/opt/hergent-erp/tenant_1.db', '/opt/hergent-erp/tenant_10.db']


def backup(path):
    """WAL 安全备份（sqlite3 backup API）。"""
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    dst = f'{path}.v517-{ts}.bak'
    src = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    out = sqlite3.connect(dst)
    src.backup(out)
    out.close()
    src.close()
    return dst


def transform(perms_raw):
    """返回 (新权限 dict 或 None, 说明)。None = 无需改动。"""
    try:
        perms = json.loads(perms_raw)
    except Exception:
        return None, 'JSON 解析失败，跳过'

    if isinstance(perms, list):
        # list = 全动作放行 ⇒ 转 dict 时每模块写 ["*"] 保持等价
        new = {m: ['*'] for m in perms}
        note = 'list → dict（原模块等价写成 ["*"]）'
    elif isinstance(perms, dict):
        new = {k: (list(v) if isinstance(v, list) else v) for k, v in perms.items()}
        note = 'dict 原样保留'
    else:
        return None, f'未知格式 {type(perms).__name__}，跳过'

    cur = new.get('inventory')
    if cur == ['*'] or (isinstance(cur, list) and '*' in cur):
        return None, '已持有 inventory 全权限，不动'
    if cur:
        merged = list(cur)
        for a in ADD_ACTIONS:
            if a not in merged:
                merged.append(a)
        new['inventory'] = merged
        return new, f'已持有 {cur} ⇒ 合并为 {merged}'
    new['inventory'] = list(ADD_ACTIONS)
    return new, note + f' + inventory={ADD_ACTIONS}'


def main():
    for db in DBS:
        if not os.path.exists(db):
            print(f'[跳过] {db} 不存在')
            continue
        print(f'\n===== {db} =====')
        con = sqlite3.connect(db)
        cur = con.cursor()
        cur.execute('SELECT id, role_name, permissions FROM role_permissions ORDER BY id')
        rows = cur.fetchall()

        changes = []
        for rid, role, raw in rows:
            if role not in TARGET_ROLES:
                continue
            new, note = transform(raw)
            print(f'  [{role}] {note}')
            if new is None:
                continue
            print(f'      before: {(raw or "")[:150]}')
            print(f'      after : {json.dumps(new, ensure_ascii=False)[:150]}')
            changes.append((rid, role, json.dumps(new, ensure_ascii=False)))

        if not changes:
            print('  （无需要变更的行）')
            con.close()
            continue

        if not APPLY:
            print(f'  → dry-run：{len(changes)} 行待改，未落库')
            con.close()
            continue

        bak = backup(db)
        print(f'  ✅ 已备份 → {bak}')
        for rid, role, payload in changes:
            cur.execute('UPDATE role_permissions SET permissions = ? WHERE id = ?', (payload, rid))
            print(f'  ✅ 已更新 id={rid} role={role}')
        con.commit()
        # 回读校验
        cur.execute('SELECT role_name, permissions FROM role_permissions ORDER BY id')
        for role, raw in cur.fetchall():
            if role in TARGET_ROLES:
                has = 'inventory' in (raw or '')
                acts = json.loads(raw).get('inventory') if has else None
                print(f'  🔍 复核 {role}: inventory={acts}')
        con.close()


if __name__ == '__main__':
    print('模式：', 'APPLY（真落库）' if APPLY else 'DRY-RUN（只看不改）')
    main()
