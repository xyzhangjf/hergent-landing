"""结构体检：主库与各租户库的差异对账（**只读**）。

## 它回答的问题

「九个租户库，跟主库真的一样吗？」—— 以前没人能回答。`tenant_db_init()` 用
`iterdump()` 只复制**当时**主库的 CREATE 语句，之后主库新增的列/索引/表不会
自己长到租户库上；而 `_migrations` 又只记录"某条迁移在这台库跑过"，不记录
"这台库现在的结构应该长什么样"。于是「租户库 0 索引上线」这类事故反复发生，
且事后只能靠人肉 `PRAGMA` 一条条比。

## 三类差异的定性（这决定了什么算故障）

| 差异 | 定性 | 判据 |
|---|---|---|
| 主库有、租户库没有的**表** | 故障 | 除非在 `platform_tables.txt`（平台级表，设计如此） |
| 主库有、租户库没有的**索引**（且该表在租户库里存在） | 故障 | 索引是查询/唯一性的保证；唯一索引缺失 = 可写重复数据 |
| 同名表上主库有、租户库没有的**列** | 故障 | 说明某条 ALTER 没下发到这台库 |
| 租户库独有的表 | 正常 | 租户专属表（如 `forecast_config`），主库本来就没有 |
| 租户库独有的索引/列 | 正常 | 历史回填的产物，不影响正确性 |

**不判故障但必须打出来的**：`_migrations` 里 status='failed' 的条目、
盘上已经不存在的 patch 版本。

用法：

    python3 -m migrations.doctor              # 体检（主库 + 全部租户库）
    python3 -m migrations.doctor --json       # 机器可读
    python3 -m migrations.doctor --db /path/to/tenant_3.db   # 只体检单个库

退出码：0 = 干净；2 = 有漂移；1 = 运行错误。
"""
import argparse
import json
import os
import sys

from . import dbutil, runner


def _patch_state(path, patches):
    """该库的 patch 状态（只读；没有表就如实说没有，不建）。"""
    try:
        conn = dbutil.connect_ro(path)
        try:
            pl = runner.plan(conn, patches)
        finally:
            conn.close()
    except Exception as e:
        return {"error": str(e)}
    return {
        "ready": pl["ready"],
        "max_applied": pl["max_applied"],
        "applied": len(pl["applied"]),
        "pending": [p.version for p in pl["pending"]],
        "mismatch": [p.version for p, _ in pl["mismatch"]],
        "failed": [p.version for p, _ in pl["failed"]],
        "unknown": [r["version"] for r in pl["unknown"]],
    }


def _legacy_state(conn):
    """`_migrations` 的两条读数：失败条目、盘上不存在的 patch 版本（仅信息）。"""
    try:
        failed = conn.execute(
            "SELECT name FROM _migrations WHERE status='failed' ORDER BY name").fetchall()
        total = conn.execute("SELECT COUNT(DISTINCT name) FROM _migrations").fetchone()[0]
        names = {r[0] for r in conn.execute("SELECT name FROM _migrations WHERE status='ok'")}
        return {"failed": [r[0] for r in failed], "total": total, "ok_names": names}
    except Exception:
        return {"failed": [], "total": 0, "ok_names": set()}


def check_db(label, path, master_snap, platform, patches, registry=None, legacy_copies=None):
    """→ 单库体检结果字典。`master_snap` 为 None 时表示这一台**就是**主库。"""
    stale_set = legacy_copies or set()
    out = {"db": label, "path": path, "ok": True, "problems": []}
    conn = dbutil.connect_ro(path)
    try:
        snap = dbutil.snapshot(conn)
        legacy = _legacy_state(conn)
    finally:
        conn.close()

    out["tables"] = len(snap["tables"])
    out["indexes"] = len(snap["indexes"])
    out["fingerprint"] = dbutil.fingerprint(snap)
    out["legacy_total"] = legacy["total"]
    if legacy["failed"]:
        out["legacy_failed"] = legacy["failed"][:10]
        out["problems"].append("`_migrations` 有 %d 条失败记录" % len(legacy["failed"]))
    out["patch"] = _patch_state(path, patches)
    if not out["patch"].get("ready"):
        out["problems"].append("该库尚无 schema_patches（未纳入版本管理）")
    if out["patch"].get("mismatch"):
        out["problems"].append("patch 指纹不符 %s" % out["patch"]["mismatch"])
    if out["patch"].get("failed"):
        out["problems"].append("patch 执行失败 %s" % out["patch"]["failed"])

    if registry is not None:
        out["registered"] = registry.get("registered")
        out["is_active"] = registry.get("is_active")
        out["readonly_registry"] = registry.get("readonly")

    if master_snap is None:
        out["ok"] = not out["problems"]
        return out

    m_tables, t_tables = master_snap["tables"], snap["tables"]
    # ⓿ 遗留平台表副本：本不该在租户库里，出现了就是历史事故残留（见清单文件注释）。
    #    不比对它们的列/索引 —— 那不是漂移，是一件待清理的安全事项。
    stale = sorted(set(t_tables) & stale_set)
    out["legacy_platform_copies"] = stale

    # ① 缺表：主库有、租户库没有、且不是平台级表
    missing_tables = sorted(set(m_tables) - set(t_tables) - platform)
    excluded = sorted((set(m_tables) - set(t_tables)) & platform)
    out["missing_tables"] = missing_tables
    out["platform_excluded"] = excluded
    if missing_tables:
        out["problems"].append("缺表 %d 个：%s" % (len(missing_tables), ", ".join(missing_tables[:10])))

    # ② 缺索引：主库有、该索引所属表在租户库里**存在**、而索引不存在
    t_idx = snap["indexes"]
    m_idx = master_snap["indexes"]
    missing_idx = []
    for name, (tbl, sql) in m_idx.items():
        if name in t_idx:
            continue
        if tbl not in t_tables:
            continue          # 表都没有 ⇒ 已计入「缺表」，不重复报
        if tbl in stale_set:
            continue          # 遗留平台表副本 ⇒ 不要求它有主库的索引
        missing_idx.append({"index": name, "table": tbl, "unique": "UNIQUE" in sql.upper()})
    missing_idx.sort(key=lambda x: (x["table"], x["index"]))
    out["missing_indexes"] = missing_idx
    if missing_idx:
        out["problems"].append("缺索引 %d 个（%d 个是唯一索引）：%s" % (
            len(missing_idx), sum(1 for x in missing_idx if x["unique"]),
            ", ".join(x["index"] for x in missing_idx[:8])))

    # ③ 缺列：同名表上主库有、租户库没有（遗留平台表副本不参与）
    missing_cols, extra_cols = [], []
    for tbl in sorted((set(m_tables) & set(t_tables)) - stale_set):
        mc = {c[0] for c in m_tables[tbl]}
        tc = {c[0] for c in t_tables[tbl]}
        for c in sorted(mc - tc):
            missing_cols.append("%s.%s" % (tbl, c))
        for c in sorted(tc - mc):
            extra_cols.append("%s.%s" % (tbl, c))
    out["missing_columns"] = missing_cols[:50]
    out["missing_columns_total"] = len(missing_cols)
    out["extra_columns_total"] = len(extra_cols)
    if missing_cols:
        out["problems"].append("缺列 %d 个：%s" % (len(missing_cols), ", ".join(missing_cols[:8])))

    out["extra_tables"] = sorted(set(t_tables) - set(m_tables))
    out["ok"] = not out["problems"]
    return out


def _registry_map(master_path):
    """主库 `tenants` 登记表快照（只读）。读不出来就返回 None —— 不把"读不到"
    当成"没登记"（那是两种完全不同的结论）。"""
    try:
        conn = dbutil.connect_ro(master_path)
        try:
            rows = conn.execute("SELECT id, name, is_active, readonly FROM tenants").fetchall()
        finally:
            conn.close()
        return {int(r["id"]): {"name": r["name"], "is_active": int(r["is_active"] or 0),
                               "readonly": int(r["readonly"] or 0)} for r in rows}
    except Exception:
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="migrations.doctor",
                                description="Hergent ERP 结构体检（只读）")
    ap.add_argument("--db", help="只体检指定的单个库文件")
    ap.add_argument("--master-only", action="store_true", help="只体检主库")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    try:
        patches = runner.discover()
    except runner.PatchError as e:
        print("[doctor] patch 目录有问题：%s" % e, file=sys.stderr)
        return 1
    platform, warn = dbutil.load_platform_tables()
    legacy, warn2 = dbutil.load_legacy_copies()
    if not args.json:
        if warn:
            print("[doctor] ⚠️  %s" % warn)
        if warn2:
            print("[doctor] ⚠️  %s" % warn2)

    master = dbutil.master_db_path()
    if not os.path.exists(master):
        print("[doctor] 主库不存在：%s" % master, file=sys.stderr)
        return 1

    m_conn = dbutil.connect_ro(master)
    try:
        master_snap = dbutil.snapshot(m_conn)
    finally:
        m_conn.close()

    reg = _registry_map(master)
    results = [check_db("master", master, None, platform, patches)]

    if args.db:
        path = os.path.abspath(args.db)
        if not os.path.exists(path):
            print("[doctor] 库不存在：%s" % path, file=sys.stderr)
            return 1
        results.append(check_db(os.path.basename(path), path, master_snap, platform, patches,
                                legacy_copies=legacy))
    elif not args.master_only:
        for tid, path in dbutil.tenant_db_paths():
            r = None if reg is None else {
                "registered": tid in reg,
                "is_active": (reg.get(tid) or {}).get("is_active"),
                "readonly": (reg.get(tid) or {}).get("readonly"),
            }
            results.append(check_db("tenant_%d" % tid, path, master_snap, platform, patches, r,
                                    legacy_copies=legacy))

    drift = [r for r in results if not r["ok"]]
    if args.json:
        print(json.dumps({"ok": not drift, "dbs": results}, ensure_ascii=False, indent=2, default=str))
    else:
        print("=" * 72)
        print("Hergent ERP 结构体检（只读）  主库 %s" % master)
        print("=" * 72)
        for r in results:
            tag = "✅" if r["ok"] else "⚠️ "
            head = "%s %-12s 表 %3d / 索引 %3d" % (tag, r["db"], r["tables"], r["indexes"])
            if r["db"] == "master":
                head += "  （基准）"
            else:
                head += "  表比主库 %+d" % (len(r.get("extra_tables", [])) - len(r.get("missing_tables", [])))
                if r.get("registered") is False:
                    head += "  ❗未在 tenants 登记表"
                elif r.get("is_active") == 0:
                    head += "  （登记为停用）"
            print(head)
            p = r.get("patch") or {}
            if p.get("ready"):
                print("   版本：v%04d（已执行 %d 条）%s" % (
                    p["max_applied"], p["applied"],
                    "  待执行 %s" % p["pending"] if p["pending"] else ""))
            else:
                print("   版本：未纳入版本管理（无 schema_patches）")
            if r.get("missing_tables"):
                print("   ⚠️ 缺表 %d：%s" % (len(r["missing_tables"]), ", ".join(r["missing_tables"][:10])))
            if r.get("platform_excluded"):
                print("   （平台级表不在租户库属正常：%d 个）" % len(r["platform_excluded"]))
            if r.get("missing_indexes"):
                print("   ⚠️ 缺索引 %d：" % len(r["missing_indexes"]))
                for x in r["missing_indexes"][:12]:
                    print("       %s%s   on %s" % (x["index"], "（唯一）" if x["unique"] else "", x["table"]))
            if r.get("missing_columns_total"):
                print("   ⚠️ 缺列 %d：%s" % (r["missing_columns_total"],
                                            ", ".join(r["missing_columns"][:8])))
            if r.get("legacy_platform_copies"):
                print("   🔒 遗留平台表副本 %d 张：%s" % (
                    len(r["legacy_platform_copies"]), ", ".join(r["legacy_platform_copies"])))
                print("      （历史 backup() 事故残留，租户库不用它们；其中 users 含密码哈希，" 
                      "应在单独一版里确认无用后 DROP）")
            if r.get("legacy_failed"):
                print("   ⚠️ _migrations 失败记录 %d 条：%s" % (
                    len(r["legacy_failed"]), ", ".join(r["legacy_failed"][:5])))
        print("-" * 72)
        if drift:
            print("结论：%d / %d 个库有漂移。" % (len(drift), len(results)))
        else:
            print("结论：%d 个库结构一致，无漂移。" % len(results))
    return 2 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
