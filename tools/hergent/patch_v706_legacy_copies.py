#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v706 第②步：清理租户库里的遗留平台表副本（先拆承重，再拆表）。

=====================================================================
证据链（这版为什么只改这两处）
=====================================================================
`tenant_N.db` 里的 `users / sessions / tenants / user_tenants` 是 2026-09-13 修掉的
`backup()` 页级复制事故留下的旧快照（`db/connection.py::_ensure_tenant_db` 有完整记载）。
DROP 之前必须先证明"没有活跃代码在租户上下文里读它们"。

审计工具：`tools/hergent/v706/scan_legacy_reads.py`（75 个引用函数，按
「连接类型 × 路由上下文」两段证据分类）。结论：

| 分类 | 数量 | 处置 |
|---|---|---|
| 显式主库连接 / 端点在主库前缀 | 56 | 安全 |
| 租户连接但端点在主库前缀（`/api/users` `/api/tenants` `/api/force-logout`）| 17 | 安全：上下文为 None 时同一函数回落主库 |
| 租户连接 + 租户上下文 | **1** | `GET /api/sales-targets` 的 `LEFT JOIN users` |

那 1 处就是承重点（虽然它是遗留模块：`sales_targets` 在生产两个租户库都是 0 行、
前端 `hergent-cn-v2` / `hergent-admin` 都没有调用它）。本脚本把它改成
「租户库取目标 + 主库取名合并」，与 `external_accounts_list` / `employee_account_map`
同一条既定口径 —— 顺带修掉一个**静默错误**：真实员工（主库 id 9999xx）在租户库那份
6 行种子账号里根本不存在 ⇒ `user_name` 一直是 NULL/旧名字，且不报错。

=====================================================================
第二处改的是"复发路径"而不是数据
=====================================================================
只删数据不改建库逻辑 ⇒ 下一个新租户会立刻再长出一张空 `users`。
`tenant_db_init()` 用 `iterdump()` 复制主库 **全部** CREATE 语句，平台表也在内。
故这里与 `migrations/platform_tables.txt` 对齐：**平台表只存在于主库**。

用法：
    python3 patch_v706_legacy_copies.py --root=/opt/hergent-erp [--dry-run] [--revert]
"""
import argparse
import py_compile
import shutil
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_ROOT = Path("/opt/hergent-erp")

OLD_TARGETS = '''    with db.get_db() as conn:
        targets = [dict(r) for r in conn.execute("SELECT st.*,u.display_name as user_name FROM sales_targets st LEFT JOIN users u ON st.user_id=u.id ORDER BY st.month DESC,st.user_id").fetchall()]
        for t in targets:'''

NEW_TARGETS = '''    with db.get_db() as conn:
        # 🔴 v706：`users` 是**主库平台表**，租户库里那份只是历史 backup() 留下的旧快照
        #    （生产 tenant_1 是 6 行种子账号、tenant_10 是 0 行）。原来这条 LEFT JOIN
        #    读的就是租户库那份 ⇒ 真实员工（主库 id 9999xx）一个都匹配不上，
        #    `user_name` 恒为 NULL 或旧名字，且**不报错**。
        #    改为「租户库取目标 + 主库取名后合并」，与 external_accounts_list /
        #    employee_account_map 同一条口径（唯一实现思路：跨库不做 JOIN，取回来合并）。
        targets = [dict(r) for r in conn.execute(
            "SELECT st.* FROM sales_targets st ORDER BY st.month DESC, st.user_id").fetchall()]
        _names = {}
        try:
            _mc = _master_db()
            try:
                _names = {int(_r["id"]): (_r["display_name"] or "")
                          for _r in _mc.execute("SELECT id, display_name FROM users").fetchall()}
            finally:
                _mc.close()
        except Exception as _e:
            # 取名失败不该让整张目标表 500：名字降级为空串，其余列照常返回。
            logging.getLogger("hergent").warning(f"[sales-targets] 主库账号名读取失败: {_e}")
        for _t in targets:
            _t["user_name"] = _names.get(int(_t.get("user_id") or 0), "")
        for t in targets:'''

OLD_TENANT_INIT = '''    # Copy schema only (no data)
    for line in master_db.iterdump():
        if line.startswith("CREATE TABLE") or line.startswith("CREATE INDEX"):
            try: tenant_db.execute(line)
            except Exception as e: logging.getLogger("hergent").debug(f"skipping row: {e}")'''

NEW_TENANT_INIT = '''    # Copy schema only (no data)
    # 🔴 v706：**平台表不复制**。原先会把主库的 users/sessions/tenants/user_tenants
    #    连同 schema 一起建进租户库，于是每个新租户天生带一张空 `users`（鉴权一律走主库，
    #    这张表没有任何用途）。危险在于它**静默**：误用 get_db() 去读时得到的是
    #    「空表/旧快照」而不是"表不存在"——后者会当场报错，前者只会让界面悄悄变空。
    #    与 migrations/platform_tables.txt 同一条口径：平台表只存在于主库。
    _platform_skip = {"users", "sessions", "tenants", "user_tenants",
                      "invite_codes", "invite_uses"}
    for line in master_db.iterdump():
        if line.startswith("CREATE TABLE"):
            _m = re.match(r'CREATE TABLE\\s+"?(\\w+)"?', line)
            if _m and _m.group(1) in _platform_skip:
                continue
        elif line.startswith("CREATE INDEX"):
            _m = re.search(r'\\bON\\s+"?(\\w+)"?', line)
            if _m and _m.group(1) in _platform_skip:
                continue
        else:
            continue
        try: tenant_db.execute(line)
        except Exception as e: logging.getLogger("hergent").debug(f"skipping row: {e}")'''

PATCHES = [
    ("server.py", OLD_TARGETS, NEW_TARGETS,
     "① GET /api/sales-targets：users 改名从主库取（拆掉唯一承重点）"),
    ("erp_db.py", OLD_TENANT_INIT, NEW_TENANT_INIT,
     "② tenant_db_init：新租户建库不再复制平台表（断复发路径）"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revert", action="store_true", help="从 .bak-v706 回滚")
    a = ap.parse_args()
    root = Path(a.root)
    if not root.is_dir():
        print("目录不存在：%s" % root, file=sys.stderr)
        return 1

    if a.revert:
        n = 0
        for rel, _o, _n, _d in PATCHES:
            bak = root / (rel + ".bak-v706")
            if bak.exists():
                shutil.copy2(bak, root / rel)
                print("回滚 %s ← %s" % (rel, bak.name))
                n += 1
        print("回滚完成（%d 个文件）。记得重启服务。" % n)
        return 0

    ok = True
    for rel, old, new, desc in PATCHES:
        p = root / rel
        src = p.read_text(encoding="utf-8")
        if new in src and old not in src:
            print("⏭  %s 已打过（幂等跳过）" % desc)
            continue
        cnt = src.count(old)
        if cnt != 1:
            print("❌ %s：锚点命中 %d 次（应为 1），**不做任何改动**" % (desc, cnt), file=sys.stderr)
            ok = False
            continue
        if a.dry_run:
            print("🔍 %s：锚点唯一，可打（dry-run 未写入）" % desc)
            continue
        bak = p.with_suffix(p.suffix + ".bak-v706")
        if not bak.exists():
            shutil.copy2(p, bak)
            print("   备份 %s" % bak.name)
        p.write_text(src.replace(old, new), encoding="utf-8")
        try:
            py_compile.compile(str(p), doraise=True)
        except py_compile.PyCompileError as e:
            shutil.copy2(bak, p)
            print("❌ %s：语法检查失败，已回滚：%s" % (desc, e), file=sys.stderr)
            ok = False
            continue
        print("✅ %s" % desc)

    if not a.dry_run and ok:
        print("\n完成。重启服务后生效：")
        print("  systemctl restart hergent-erp")
    print("时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
