#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""租户库 `role_permissions` 存量补漏（v300，2026-09-27）。

## 背景：为什么会漏

`/api/role-permissions` 的保存是**按整表逐角色 POST**（设置页 `savePerms`）⇒ 老板点一次
「保存」，该租户的 8 行就被**固化成当时的快照**。此后 `_DEFAULT_PERMS` 的任何新增
**对本租户失效**（因为 `role_permissions` 是**整表覆盖**，不是合并）。

## 判据（保守 —— 只补"客户当时根本无从选择"的项）

对每个租户库、每个**内置角色**行：
  ✅ 补某模块 `M`，当且仅当同时满足：
     ① `M ∈ _DEFAULT_PERMS[role]`（默认值现在有）
     ② `M ∉` 租户行（该行确实缺）
     ③ `M` 在 `BACKFILL_MODULES` 白名单里（= **后来才加进默认值**的模块）
     ④ 租户行的模块集合 **⊆ 当前默认值**（= 该行没被客户有意改造过）
  ❌ 其余一律**不补**，并打印理由。

🔴 为什么 ③④ 必须同时成立：少了 ③ 会把"客户有意收紧的模块"补回去（把客户的决策覆盖掉）；
   少了 ④ 会把"客户手工加过模块"的行也一起动 —— 那一行已经偏离默认，说明有人管过它，
   补它等于替客户做决定。⑷ 的典型反例：`tenant_10.accountant` **多了一个 `bid`** ⇒ 跳过。

## 🔴 `immutable` 的分界（本机铁律）

  · **静态副本**（`cp` / 备份出来的文件）→ 必须 `&immutable=1`；
  · **生产活库**（正在被后端读写）→ **绝不能带**（带了会无视 WAL、读到过期页）。
  ⇒ 所以本脚本用 `--live` 开关，而不是写死一种。

## 用法

    # 只读盘点（单一库 / 全部租户；不动数据）
    python3 perms-tenant-backfill.py --db /opt/hergent-erp/tenant_10.db --live
    python3 perms-tenant-backfill.py --glob '/opt/hergent-erp/tenant_*.db' --live

    # 应用（必须先自行备份；脚本会再校验一次"备份存在"）
    python3 perms-tenant-backfill.py --glob '...' --live --apply
"""
import argparse
import ast
import glob
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys

ERP = os.environ.get('HERGENT_ERP_DIR', '/Users/zhangjunfeng/Documents/hergent-erp')


def _find_core():
    """自动探测 `core.py`：本地是 `<repo>/server/core.py`，**生产是扁平布局**（`/opt/hergent-erp/core.py`）。
    ⚠️ 写死 `server/` 前缀在生产上会直接报"找不到" —— 本项目已在多处栽过这个前缀。"""
    for cand in (os.path.join(ERP, 'server', 'core.py'), os.path.join(ERP, 'core.py')):
        if os.path.isfile(cand):
            return cand
    raise SystemExit('找不到 core.py（试过 %s/server/core.py 与 %s/core.py）' % (ERP, ERP))


CORE_PY = _find_core()

# 🔴 只有**后来才加进 `_DEFAULT_PERMS`** 的模块才允许补（值是"允许补的角色集"，None = 全部内置角色）。
#    两个条目都有人工依据，动手前读一遍：
#      · `chat`    —— 2026-09-25「副驾代理层 P2 放量」给**其余角色**补的（注释就在 `_DEFAULT_PERMS` 上方）。
#      · `sales`   —— v293（2026-09-27）加给 `supervisor`，因为返利全家族归 `sales`，
#                     缺它的后果不是"少一个入口"而是「页面进得去、数据恒空、零报错」。
BACKFILL_MODULES = {
    'chat': None,
    'sales': {'supervisor'},
}

PASS, FAIL, SKIP = [], [], []


def load_default_perms():
    """从真 `core.py` 用 AST 切 `_DEFAULT_PERMS`（不在本脚本另抄一份）。"""
    tree = ast.parse(open(CORE_PY, encoding='utf-8').read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if getattr(t, 'id', None) == '_DEFAULT_PERMS' and isinstance(node.value, ast.Dict):
                    out = {}
                    for k, v in zip(node.value.keys, node.value.values):
                        if isinstance(v, ast.List) and all(
                                isinstance(e, ast.Constant) and isinstance(e.value, str) for e in v.elts):
                            out[k.value] = [e.value for e in v.elts]
                    return out
    raise SystemExit('无法从 %s 解析 _DEFAULT_PERMS' % CORE_PY)


def connect(path, live, write=False):
    """🔴 `immutable` 的三态分界（本项目铁律，写反了会读到过期页 / 或整库打不开）：
      · **静态备份副本**（默认）→ `mode=ro&immutable=1`；不带 immutable 时，残留的
        `-wal` / `-journal` 会让 SQLite 认为库"可能正在被改"，行为随文件状态漂移。
      · **生产活库只读**（`--live`）→ `mode=ro`，**绝不能带 `immutable`** ——
        带了会无视 WAL、读到**过期页**（看起来"改没生效"，实则是读错了地方）。
      · **生产活库写入**（`--live --apply`）→ `mode=rw`。
    """
    if write:
        uri = 'file:%s?mode=rw' % path
    elif live:
        uri = 'file:%s?mode=ro' % path
    else:
        uri = 'file:%s?mode=ro&immutable=1' % path
    return sqlite3.connect(uri, uri=True)


def read_rows(path, live):
    con = connect(path, live)
    try:
        rows = con.execute('SELECT role_name, permissions FROM role_permissions').fetchall()
    except sqlite3.OperationalError as e:
        con.close()
        return None, str(e)
    con.close()
    out = {}
    for name, perms in rows:
        try:
            out[name] = json.loads(perms)
        except Exception as e:
            out[name] = ('BAD_JSON', str(e))
    return out, None


def plan_for(defaults, rows):
    """→ (变更计划 [(role, module, 原因)], 跳过说明 [(role, 原因)])。"""
    plan, skipped = [], []
    builtin = set(defaults.keys())
    for role in sorted(builtin):
        if role == 'admin':
            skipped.append((role, "admin = ['*'] 通配 ⇒ 逻辑上不缺任何模块（但仍留痕，便于审计）"))
            continue
        have = rows.get(role)
        if have is None:
            skipped.append((role, '租户库无该行 ⇒ 走默认值，不缺项'))
            continue
        if isinstance(have, dict):
            skipped.append((role, '权限是 CRUD dict 形态 ⇒ 本脚本只处理 list，保守跳过'))
            continue
        if not isinstance(have, list):
            skipped.append((role, '权限形态不可识别 ⇒ 跳过'))
            continue
        want = defaults.get(role) or []
        missing = [m for m in want if m not in have]
        extra = [m for m in have if m not in want]
        if not missing:
            skipped.append((role, '无缺项'))
            continue
        # ④ 租户行 ⊆ 默认值（没被客户改造过）
        if extra:
            skipped.append((role, '该行**多了** %s ⇒ 已偏离默认（有人管过）⇒ 整行跳过，不替客户做决定'
                            % ','.join(sorted(extra))))
            continue
        for m in missing:
            allow = BACKFILL_MODULES.get(m, 'NOT_IN_WHITELIST')
            if allow == 'NOT_IN_WHITELIST':
                skipped.append((role, '缺 `%s` 但**不在**补漏白名单（可能是有意收紧）⇒ 不补' % m))
                continue
            if allow is not None and role not in allow:
                skipped.append((role, '缺 `%s` 但白名单限定 %s ⇒ 不补' % (m, sorted(allow))))
                continue
            plan.append((role, m, '默认值新增 `%s`（白名单内）＋该行未偏离默认' % m))
    return plan, skipped


def backup(db, backup_root):
    """一致性快照：用 VACUUM INTO（不用 cp —— 活库带 -wal/-journal，cp 出来不一致）。"""
    os.makedirs(backup_root, exist_ok=True)
    ts = subprocess.run(['date', '+%Y%m%d-%H%M%S'], capture_output=True, text=True).stdout.strip()
    dst = os.path.join(backup_root, '%s.%s.bak' % (os.path.basename(db), ts))
    if os.path.exists(dst):
        raise SystemExit('备份目标已存在：%s' % dst)
    con = sqlite3.connect('file:%s?mode=ro' % db, uri=True)
    try:
        con.execute("VACUUM INTO ?", (dst,))
    finally:
        con.close()
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    ap.add_argument('--glob')
    ap.add_argument('--live', action='store_true', help='目标是**生产活库**（不加 immutable）')
    ap.add_argument('--apply', action='store_true', help='真正写入（默认只读盘点）')
    ap.add_argument('--backup-root', default='/opt/hergent-erp/backups')
    args = ap.parse_args()

    dbs = []
    if args.db:
        dbs.append(args.db)
    if args.glob:
        dbs.extend(sorted(glob.glob(args.glob)))
    if not dbs:
        raise SystemExit('必须给 --db 或 --glob')

    defaults = load_default_perms()
    print('权威源 %s::_DEFAULT_PERMS = %d 个角色' % (os.path.relpath(CORE_PY, ERP), len(defaults)))
    print('补漏白名单：%s' % json.dumps({k: (sorted(v) if v else 'ALL_BUILTIN')
                                        for k, v in BACKFILL_MODULES.items()}, ensure_ascii=False))
    print('=' * 70)

    total_plan, total_skip = 0, 0
    for db in dbs:
        print('')
        print('【%s】%s' % (os.path.basename(db), '活库' if args.live else '只读'))
        rows, err = read_rows(db, args.live)
        if err:
            print('  跳过：%s' % err)
            continue
        plan, skipped = plan_for(defaults, rows)
        print('  现有行：%s' % ', '.join('%s=%s' % (k, v) for k, v in sorted(rows.items())))
        print('  ---- 计划变更 %d 条 ----' % len(plan))
        for role, mod, why in plan:
            print('    ➕ %-12s += %-8s  ← %s' % (role, mod, why))
        print('  ---- 跳过 %d 条（保守不补）----' % len(skipped))
        for role, why in skipped:
            print('    ·  %-12s %s' % (role, why))
        total_plan += len(plan)
        total_skip += len(skipped)

        if not plan:
            continue
        if not args.apply:
            print('  [只读模式] 未写入。加 --apply 才会改。')
            continue

        # ---- 应用 ----
        b = backup(db, args.backup_root)
        print('  ✅ 已备份（VACUUM INTO）：%s' % b)
        con = sqlite3.connect('file:%s?mode=rw' % db, uri=True)
        try:
            for role, mod, _why in plan:
                cur = con.execute('SELECT permissions FROM role_permissions WHERE role_name=?',
                                  (role,)).fetchone()
                cur_list = json.loads(cur[0])
                if mod in cur_list:
                    print('    （%s 已有 %s，跳过）' % (role, mod))
                    continue
                cur_list.append(mod)
                con.execute('UPDATE role_permissions SET permissions=? WHERE role_name=?',
                            (json.dumps(cur_list, ensure_ascii=False), role))
                print('    ✍️  %s += %s ⇒ %s' % (role, mod, json.dumps(cur_list, ensure_ascii=False)))
            con.commit()
        finally:
            con.close()
        # 写后立即只读复验
        after, err2 = read_rows(db, True)
        print('  ---- 复验（只读重读）----')
        for role, mod, _why in plan:
            ok = isinstance(after.get(role), list) and mod in after[role]
            print('    %s %s.%s = %s' % ('✅' if ok else '❌', role, mod, after.get(role)))

    print('')
    print('=' * 70)
    print('合计：计划变更 %d 条 / 保守跳过 %d 条%s' % (
        total_plan, total_skip, '' if args.apply else '（只读模式，未写入任何库）'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
