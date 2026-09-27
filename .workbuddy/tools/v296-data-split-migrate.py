#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v296（2026-09-27）`data` 拆出 `cron` / `bid` —— 租户库**收敛到目标态** + 真实性等价验证。

背景
----
`/api/cron` 与 `/api/bid-radar` 原本没有独立模块，于是老板在「设置 › 权限」勾「档案管理」时
会**连带**放开定时任务。v296 给这两条前缀建独立模块 `cron` / `bid`。

🔴 一个关键事实修正（本脚本存在的第二个理由）
    `/api/bid-radar` **并不归 `data`**。`_PATH_MODULE_MAP` 的匹配是「首个 startswith 命中即停」，
    而表里更早有一条 `/api/bi` → `reports`，`/api/bid-radar`.startswith("/api/bi") 成立
    ⇒ 它**实际按 `reports` 鉴权**（代码注释与 `pages.js` 都写着"归 data"，两处都错）。
    所以本脚本对两条路径用的旧模块是**各自的真实值**：
        `/api/cron`      : data    → cron
        `/api/bid-radar` : reports → bid
    （v296 同时把 `/api/bid-radar` 提到 `/api/bi` 之前，让精确键生效。）

目标态（判据 = 「谁原本就能调」+ 「页面名单说谁该看」）
--------------------------------------------------
    cron ：boss / sales / staff / supervisor  —— 这四个角色默认就持有 `data`
    bid  ：boss / accountant                 —— 这两个角色默认就持有 `reports`
           ＋ sales                          —— `pages.js` 的 `/bid-radar` 名单含 sales，
                                               而它原本无 `reports` ⇒ **修掉一个既有假入口**

🔴 判据用**真函数**：`ast` 从真 `core.py` 切出 `_perm_granted` / `_DEFAULT_PERMS` 再 exec。
   不手抄一份（抄了必然漂移 —— 本项目几乎所有判定性缺陷都出在"同一规则两份")。

用法
----
    python3 v296-data-split-migrate.py --snap-dir <含 tenant_*.db 的目录> [--live] [--apply]
        --live   目标是活库（读用 mode=ro，**不带** immutable）；静态副本反之必须带。
        --apply  真的写盘（默认只验证 + 打印）。
"""
import argparse
import ast
import json
import os
import sqlite3
import sys

# (路径, **真实**旧模块, 新模块, 目标角色集)
SPLIT = (
    ("/api/cron", "data", "cron", ("boss", "sales", "staff", "supervisor")),
    ("/api/bid-radar", "reports", "bid", ("boss", "accountant", "sales")),
)
NEW_MODULES = tuple(s[2] for s in SPLIT)
DB_FILES = ("tenant_1.db", "tenant_10.db", "erp.db")


def load_real_core(server_dir):
    """从真 `core.py` 用 `ast` 切出纯函数与常量（免掉 fastapi/bcrypt 那条 import 链）。

    找不到就**抛错停下** —— 找不到说明判据源改名了，本脚本结论不再可信。
    """
    src = open(os.path.join(server_dir, "core.py"), encoding="utf-8").read()
    tree = ast.parse(src)
    want_f, want_a = {"_perm_granted"}, {"_DEFAULT_PERMS", "_ALL_MODULES"}
    ns, got = {}, set()
    for n in tree.body:
        if isinstance(n, ast.FunctionDef) and n.name in want_f:
            exec(ast.get_source_segment(src, n), ns)
            got.add(n.name)
        elif isinstance(n, ast.Assign):
            hit = {getattr(t, "id", None) for t in n.targets} & want_a
            if hit:
                exec(ast.get_source_segment(src, n), ns)
                got |= hit
    missing = (want_f | want_a) - got
    if missing:
        raise SystemExit("!! 真 core.py 里没找到 %s —— 判据源变了，停下。" % sorted(missing))
    return type("RealCore", (), {k: ns[k] for k in got})


def canon(v):
    """任意形态 → 模块名集合。"""
    if isinstance(v, dict):
        return set(str(k) for k in v.keys())
    if isinstance(v, (list, tuple, set)):
        return set(str(x) for x in v)
    return set()


def migrate_value(v, role):
    """把权限值**收敛到目标态**。返回 (新值, 新增模块list, 移除模块list)。

    既补也去：`bid` 只给 boss/accountant/sales，故 staff/supervisor 若因上一版迁移
    被补过 `bid`，这里会把它去掉（最小权限 —— 它们没有 `/bid-radar` 入口，
    持有该接口权限只意味着"能绕过页面直接取商机数据"）。
    """
    cur = canon(v)
    want = {new for _p, _o, new, roles in SPLIT if role in roles}
    add = sorted(want - cur)
    drop = sorted(m for m in NEW_MODULES if m in cur and m not in want)
    if not add and not drop:
        return v, [], []
    if isinstance(v, dict):
        new = dict(v)
        acts = list(v.get("data") or v.get("reports") or ["read"])
        for m in add:
            new[m] = list(acts)
        for m in drop:
            new.pop(m, None)
        return new, add, drop
    if isinstance(v, (list, tuple, set)):
        new = [m for m in v if m not in drop]
        for m in add:
            if m not in new:
                new.append(m)
        return new, add, drop
    return v, [], []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snap-dir", required=True)
    ap.add_argument("--server-dir", default="/Users/zhangjunfeng/Documents/hergent-erp/server")
    ap.add_argument("--live", action="store_true",
                    help="活库：读用 mode=ro（不带 immutable）。副本必须反过来带 immutable=1。")
    ap.add_argument("--apply", action="store_true", help="真的写盘（默认只验证）")
    ap.add_argument("--db", action="append", default=None)
    args = ap.parse_args()

    core = load_real_core(args.server_dir)
    defaults = core._DEFAULT_PERMS
    print("真 core：_DEFAULT_PERMS %d 角色；_ALL_MODULES 含 cron=%s bid=%s"
          % (len(defaults), "cron" in core._ALL_MODULES, "bid" in core._ALL_MODULES))
    for path, old_mod, new_mod, roles in SPLIT:
        real = {r for r, dv in defaults.items() if old_mod in canon(dv)}
        extra = set(roles) - real
        print("  %-16s %s → %-5s 目标 %s" % (path, old_mod, new_mod, list(roles)))
        print("      其中默认持 %-8s = %s ；名单内额外包含 = %s"
              % (old_mod, sorted(real), sorted(extra) or "无"))
    print("模式：%s\n" % ("APPLY（会写盘！）" if args.apply else "DRY-RUN"), end="")
    print("=" * 78)

    files = args.db or [f for f in DB_FILES if os.path.exists(os.path.join(args.snap_dir, f))]
    changed = tightened = opened = trimmed = 0
    fails = []
    for fname in files:
        path = os.path.join(args.snap_dir, fname)
        if not os.path.exists(path):
            print("!! 跳过（不存在）：%s" % fname)
            continue
        ro_uri = ("file:%s?mode=ro" if args.live else "file:%s?mode=ro&immutable=1") % os.path.abspath(path)
        ro = sqlite3.connect(ro_uri, uri=True)
        try:
            rows = ro.execute("SELECT role_name, permissions FROM role_permissions").fetchall()
        except sqlite3.OperationalError as e:
            print("!! %s 无 role_permissions 表：%s" % (fname, e)); ro.close(); continue
        ro.close()
        print("\n### %s —— %d 行" % (fname, len(rows)))

        # ---- ① 真实性等价：用**各自真实的旧模块**比「拆前能不能调」vs「拆后能不能调」----
        #   允许「不能→能」（放开，注明是有意的）；**不允许**「能→不能」（收紧 = 破坏）。
        for role, raw in rows:
            orig = json.loads(raw) if isinstance(raw, str) else raw
            new, _add, _drop = migrate_value(orig, role)
            for path_, old_mod, new_mod, _roles in SPLIT:
                o = core._perm_granted(orig, old_mod, "read")
                n = core._perm_granted(new, new_mod, "read")
                if o == n:
                    continue
                # 该角色是否**默认**持有旧模块：是 ⇒ 它"原本能调"是产品给的，收紧即破坏；
                # 否 ⇒ 它持旧模块是**客户在权限页手工勾的**，收紧正是本次要消除的连带。
                is_default = old_mod in canon(defaults.get(role))
                if o and not n:
                    if is_default:
                        fails.append("%s %s %s：**破坏性收紧** —— 默认持 %s 却被收掉了"
                                     % (fname, role, path_, old_mod))
                        tightened += 1
                    else:
                        print("   [收紧] %-12s %-16s %s=True → %s=False"
                              "（**有意**：它持 %s 是客户手工勾的，正是本次要消除的连带）"
                              % (role, path_, old_mod, new_mod, old_mod))
                        trimmed += 1
                else:
                    print("   [放开] %-12s %-16s %s=False → %s=True（有意：页面名单要求）"
                          % (role, path_, old_mod, new_mod))
                    opened += 1

        # ---- ② 收敛到目标态 + 写盘 ----
        for role, raw in rows:
            orig = json.loads(raw) if isinstance(raw, str) else raw
            new, add, drop = migrate_value(orig, role)
            if not add and not drop:
                print("   %-12s 已是目标态（%s）" % (role, sorted(canon(orig) & set(NEW_MODULES)) or "无新模块"))
                continue
            print("   %-12s %s%s" % (role,
                                     ("+%s " % "+".join(add)) if add else "",
                                     ("-%s" % "-".join(drop)) if drop else ""))
            changed += 1
            if args.apply:
                wr = sqlite3.connect(path)
                wr.execute("UPDATE role_permissions SET permissions=? WHERE role_name=?",
                           (json.dumps(new, ensure_ascii=False), role))
                wr.commit()
                wr.close()
                print("        ↳ 已写盘")

    print("\n" + "=" * 78)
    print("将变更的行 = %d ；有意放开 = %d 处 ；有意收紧 = %d 处 ；破坏性收紧 = %d 处"
          % (changed, opened, trimmed, tightened))
    if fails:
        print("❌ 断言失败 %d 条（「破坏性收紧」= 默认持旧模块的角色被收掉 ⇒ 破坏既有可达性）：" % len(fails))
        for x in fails:
            print("   - %s" % x)
        return 1
    print("✅ 断言通过：没有任何「默认就能调」的角色被收掉；")
    print("   仅有的放开（页面名单要求）与收紧（客户手工勾出来的连带）均属本轮设计意图。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
