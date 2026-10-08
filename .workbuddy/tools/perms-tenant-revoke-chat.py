#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v325（2026-09-29）撤掉存量租户的 `chat`（AI）权限。

需求原话（老板）：「使用 AI 会消耗积分有成本，大部分老板不会开放 AI 给员工，
请默认只给管理员和老板配置 AI 权限，其他角色预留权限配置入口」。

为什么必须迁库而不是只改代码：`core._DEFAULT_PERMS` **只管没被租户库覆盖的角色**。
实测生产 `role_permissions`：
  · tenant_1  2 行 —— `库管` / `supervisor` **都有** chat
  · tenant_10 7 行 —— 除 `supervisor` 外**全部都有** chat
⇒ 只改默认值，这两个租户一点都不会变。

🔴 本脚本是**收权**方向（v300 的 perms-tenant-backfill 是补权）⇒ 纪律更严：
  ① **绝不碰 admin / boss** —— 「默认只给管理员和老板」里的那两个角色。
  ② **绝不删行** —— 删行 = 该角色回落到内置默认，会**丢掉客户自己加的模块**
     （实测 tenant_10 的 accountant 比默认多一个 `bid`；tenant_10 的 boss 多 8 个）。
     只就地改 `permissions` 内容。
  ③ **保持 permissions 原形态**（list 保持 list、dict 保持 dict），不顺手"归一化"。
  ④ 除 `chat` 外不许动任何模块（「破坏性收紧必须为 0」），否则该行**整行跳过**并告警。
  ⑤ **幂等**：跑第二遍「将变更 0 行」。
  ⑥ 只处理 `list` / `dict` 两种形态；其它形态（含 JSON 解析失败）一律跳过，不猜。

用法：
  # 只读盘点（不写任何东西）
  python3 perms-tenant-revoke-chat.py --glob '/opt/hergent-erp/tenant_*.db' --live
  # 真写（自动在线备份 + 生成 rollback.sql）
  python3 perms-tenant-revoke-chat.py --glob '/opt/hergent-erp/tenant_*.db' --live --apply
  # 复验（期望「将变更 0 行」）
  python3 perms-tenant-revoke-chat.py --glob '/opt/hergent-erp/tenant_*.db' --live
"""
import argparse
import ast
import glob as globmod
import json
import os
import sqlite3
import sys
import time

PROTECTED = ('admin', 'boss')   # 保护角色：有 chat 也不撤
MODULE = 'chat'                 # 本次唯一要撤的模块


def _find_core(explicit=None):
    if explicit and os.path.exists(explicit):
        return explicit
    here = os.path.dirname(os.path.abspath(__file__))
    for p in ('/opt/hergent-erp/core.py',
              os.path.join(here, '..', '..', '..', 'hergent-erp', 'server', 'core.py'),
              os.path.join(here, '..', '..', 'hergent-erp', 'server', 'core.py')):
        if os.path.exists(p):
            return os.path.normpath(p)
    raise SystemExit('找不到 core.py（用 --core 指定）')


def load_default_perms(core_py):
    """用 **AST** 取 `_DEFAULT_PERMS`（别用正则：该文件注释里也出现过角色名）。"""
    src = open(core_py, encoding='utf-8').read()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == '_DEFAULT_PERMS':
                    return ast.literal_eval(node.value)
    raise SystemExit('无法从 %s 解析 _DEFAULT_PERMS' % core_py)


def connect(path, live, write=False):
    """🔴 `immutable` 三态（本项目铁律，写反了会读到过期页 / 或整库打不开）：
      · 静态备份副本（默认）→ `mode=ro&immutable=1`；
      · **生产活库只读**（`--live`）→ `mode=ro`，**绝不能带 immutable**（会无视 WAL 读到过期页）；
      · 生产活库写入（`--live --apply`）→ `mode=rw`。
    """
    if write:
        uri = 'file:%s?mode=rw' % path
    elif live:
        uri = 'file:%s?mode=ro' % path
    else:
        uri = 'file:%s?mode=ro&immutable=1' % path
    return sqlite3.connect(uri, uri=True)


def canon(p):
    """`core._canon_perms` 的**等价实现**（dict 取 keys / list 集合 ⇒ 升序去重）。
    ⚠️ 这是等价实现、**不是调用真函数** —— 它的唯一用途是预判"改后是否恰好等于内置默认"
       这一副作用；正式结论以改完用真 `core.custom_roles(tid)` 复验为准。"""
    if p is None:
        return None
    if isinstance(p, dict):
        return sorted(p.keys())
    if isinstance(p, list):
        return sorted(set(p))
    return p


def strip_module(perms, mod):
    """→ (新 perms, 是否变更)。**保持原形态**。"""
    if isinstance(perms, dict):
        if mod not in perms:
            return perms, False
        return {k: v for k, v in perms.items() if k != mod}, True
    if isinstance(perms, list):
        if mod not in perms:
            return perms, False
        return [m for m in perms if m != mod], True
    return perms, False


def read_rows(path, live):
    try:
        con = connect(path, live)
    except sqlite3.OperationalError as e:
        return None, str(e)
    try:
        rows = con.execute('SELECT role_name, permissions FROM role_permissions').fetchall()
    except sqlite3.OperationalError as e:
        con.close()
        return None, str(e)
    con.close()
    out = {}
    for name, perms in rows:
        try:
            out[name] = json.loads(perms) if isinstance(perms, str) else perms
        except Exception as e:
            out[name] = ('BAD_JSON', str(e))
    return out, None


def plan_one(rows, defaults):
    """→ (plan, skipped, n_strict)。plan = [(role, old, new, exits_custom)]。"""
    plan, skipped = [], []
    for role in sorted(rows):
        info = rows[role]
        if isinstance(info, tuple):
            skipped.append((role, '权限 JSON 解析失败 ⇒ 跳过（不猜）'))
            continue
        if role in PROTECTED:
            skipped.append((role, '🔒 保护角色（管理员/老板）⇒ 有 chat 也不撤'))
            continue
        new, changed = strip_module(info, MODULE)
        if not changed:
            skipped.append((role, '本就没有 chat'))
            continue
        old_set = set(info.keys()) if isinstance(info, dict) else (set(info) if isinstance(info, list) else set())
        new_set = set(new.keys()) if isinstance(new, dict) else (set(new) if isinstance(new, list) else set())
        lost, gained = sorted(old_set - new_set), sorted(new_set - old_set)
        if lost != [MODULE] or gained:
            skipped.append((role, '❌ 会动到 chat 以外的模块 lost=%s gained=%s ⇒ **整行跳过**，请人工复核'
                            % (lost, gained)))
            continue
        exits = canon(new) == canon(defaults.get(role))
        plan.append((role, info, new, exits))
    return plan, skipped


def online_backup(path, backup_root, tag):
    """在线备份（sqlite backup API —— 服务正在写，`cp` 可能拿到半截页）。"""
    os.makedirs(backup_root, exist_ok=True)
    dst = os.path.join(backup_root, '%s-%s' % (os.path.basename(path), tag))
    src = sqlite3.connect(path)
    try:
        dstcon = sqlite3.connect(dst)
        try:
            src.backup(dstcon)
        finally:
            dstcon.close()
    finally:
        src.close()
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', help='单个库路径')
    ap.add_argument('--glob', dest='globpat', help='多个库（glob）')
    ap.add_argument('--live', action='store_true', help='目标是**生产活库**（不加 immutable）')
    ap.add_argument('--apply', action='store_true', help='真正写入（默认只读盘点）')
    ap.add_argument('--core', default=None, help='core.py 路径（默认自动找）')
    ap.add_argument('--backup-root', default='/opt/hergent-erp/backups')
    a = ap.parse_args()

    paths = []
    if a.db:
        paths.append(a.db)
    if a.globpat:
        paths.extend(sorted(globmod.glob(a.globpat)))
    if not paths:
        raise SystemExit('请给 --db 或 --glob')

    core_py = _find_core(a.core)
    defaults = load_default_perms(core_py)
    print('core.py = %s' % core_py)
    print('内置默认持 chat 的角色 = %s'
          % sorted([r for r, v in defaults.items() if '*' in v or MODULE in v]))
    print('保护角色 = %s ｜ 本脚本唯一动作 = 从非保护角色的权限里移除 `%s`' % (list(PROTECTED), MODULE))
    print('模式 = %s%s' % ('APPLY（真写）' if a.apply else 'DRY-RUN（只读）', ' · 活库' if a.live else ' · 静态副本'))
    print('=' * 78)

    tag = time.strftime('%Y%m%d-%H%M%S')

    if a.apply:
        # 🔴 fail-fast：备份目录不可写就**一个字节都不写**。
        #    实测踩过 —— 本地跑自测时默认 root 是 `/opt/hergent-erp/backups`，
        #    `mkdir` 抛 PermissionError，而它发生在**写第一个库的半途**：
        #    输出看着像"跑过了"，数据却一行没改。收权操作绝不允许这种半途状态。
        try:
            os.makedirs(a.backup_root, exist_ok=True)
            probe = os.path.join(a.backup_root, '.v325-write-probe')
            open(probe, 'w').close()
            os.remove(probe)
        except Exception as e:
            raise SystemExit('❌ 备份目录不可写：%s（%s）\n'
                             '   ⇒ 已中止，**未写任何数据**。用 --backup-root 指定可写目录。'
                             % (a.backup_root, e))

    total_rows = total_changed = total_strict = 0
    all_rollback = []
    all_exits = []

    for p in paths:
        rows, err = read_rows(p, a.live)
        print('\n### %s' % os.path.basename(p))
        if rows is None:
            print('   跳过：%s' % err)
            continue
        plan, skipped = plan_one(rows, defaults)
        total_rows += len(plan)
        print('   行数 %d ｜ 将变更 %d 行 ｜ 跳过 %d' % (len(rows), len(plan), len(skipped)))
        for role, why in skipped:
            print('     · 跳过 %-12s %s' % (role, why))
        for role, old, new, exits in plan:
            o = sorted(old.keys()) if isinstance(old, dict) else sorted(old)
            n = sorted(new.keys()) if isinstance(new, dict) else sorted(new)
            print('     → %-12s %d 项 → %d 项 ｜ 撤 %s ｜ 余 %s%s'
                  % (role, len(o), len(n), MODULE, ','.join(n), '  ⚠️改后=内置默认' if exits else ''))
            if exits:
                all_exits.append('%s/%s' % (os.path.basename(p), role))
            # rollback：写回原值
            all_rollback.append(
                "UPDATE role_permissions SET permissions='%s' WHERE role_name='%s';  -- %s"
                % (json.dumps(old, ensure_ascii=False).replace("'", "''"), role, os.path.basename(p)))

        if a.apply and plan:
            try:
                bk = online_backup(p, a.backup_root, tag + '.pre-v325-revoke-chat')
            except Exception as e:
                # 备份失败 ⇒ **本库跳过、不写任何数据**（宁可少撤，不可无备份就撤）
                print('   ❌ 备份失败 ⇒ 本库跳过、未写任何数据：%s' % e)
                continue
            print('   ✅ 已在线备份 → %s' % bk)
            con = connect(p, a.live, write=True)
            try:
                con.execute('BEGIN IMMEDIATE')
                for role, old, new, exits in plan:
                    con.execute('UPDATE role_permissions SET permissions=? WHERE role_name=?',
                                (json.dumps(new, ensure_ascii=False), role))
                con.commit()
            except Exception as e:
                con.rollback()
                con.close()
                print('   ❌ 写入失败并已回滚：%s' % e)
                continue
            finally:
                try:
                    con.close()
                except Exception:
                    pass
            # 回读自证
            after, _ = read_rows(p, a.live)
            bad = []
            for role, old, new, exits in plan:
                got = after.get(role)
                got_set = set(got.keys()) if isinstance(got, dict) else set(got or [])
                if MODULE in got_set or got_set != (set(new.keys()) if isinstance(new, dict) else set(new)):
                    bad.append(role)
            print('   %s 回读自证：%s' % ('✅' if not bad else '❌', '全部命中' if not bad else '不一致 %s' % bad))
            total_changed += len(plan)

        # 「破坏性收紧」读数：非 0 必须停下来
        total_strict += sum(1 for _, why in skipped if why.startswith('❌'))

    print('\n' + '=' * 78)
    print('读数：')
    print('  将变更行        = %d' % total_rows)
    print('  有意放开        = 0                （本轮无放开动作）')
    print('  有意收紧        = %d 行（全部为 chat）' % total_rows)
    print('  破坏性收紧      = %d  %s' % (total_strict, '✅' if total_strict == 0 else '❌ 必须为 0，请停下排查'))
    if all_exits:
        print('  ⚠️ 副作用（改后 = 内置默认 ⇒ 退出 custom_roles ⇒ 页面让位失效）：')
        for x in all_exits:
            print('       · %s' % x)
    if a.apply:
        print('  实际写入行      = %d' % total_changed)
        # 🔴 只有**本次确有可回滚内容**时才写 rollback 文件。
        #    实测踩过：幂等重跑（plan 为空）时若无条件写，会生成一个**空文件覆盖掉上一份**
        #    ⇒ 回滚能力静默丢失（而"跑第二遍确认幂等"恰恰是标准操作流程，必然发生）。
        if all_rollback:
            rb = os.path.join(a.backup_root, 'rollback-v325-revoke-chat-%s.sql' % tag)
            os.makedirs(a.backup_root, exist_ok=True)
            with open(rb, 'w', encoding='utf-8') as f:
                f.write('-- v325 撤 chat 的回滚脚本（%s）\n' % tag)
                f.write('-- 用法：对**对应的**租户库执行。多库时请按每行末尾注释里的库名分别执行。\n')
                f.write('\n'.join(all_rollback) + '\n')
            print('  回滚脚本        = %s' % rb)
        else:
            print('  回滚脚本        = （本次将变更 0 行 ⇒ 未生成，也**不会覆盖**上一份）')
    else:
        print('  ⚠️ 这是 DRY-RUN，什么都没写。确认无误后加 --apply。')
    sys.exit(0 if total_strict == 0 else 2)


if __name__ == '__main__':
    main()
