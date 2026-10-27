"""版本化 patch 运行器 —— 有内容指纹的迁移登记表。

## 为什么不能只靠 `_migrations`

现有 `_migrations` 只记 `(name, status)`。这留了两个**静默**窟窿：

1. **改过的迁移不会重跑，也不会报错**。名字没变 ⇒ `_migration_applied()` 返回 True
   ⇒ 直接 return。于是「改了 SQL 的那台库」与「照新 SQL 建的新库」同时声称 ok，
   结构却不同。这类差异永远不会出现在日志里。
2. **没有顺序与版本概念**，无法回答「这台库是几号版本」「哪台落后了」。

`schema_patches` 补上 `checksum`：同一版本号若内容指纹变了 ⇒ **直接失败**，
逼人写一个新版本号（`0007_xxx`），而不是悄悄改历史。这是本模块唯一的硬规则。

## 用法

    python3 -m migrations.runner --status                  # 看主库
    python3 -m migrations.runner --status --all-tenants    # 看主库 + 所有租户库
    python3 -m migrations.runner --apply                   # 应用到主库
    python3 -m migrations.runner --apply --all-tenants     # 应用到全部
    python3 -m migrations.runner --apply --dry-run         # 只列将执行什么

    python3 -m migrations.doctor                           # 体检（版本 + 结构）

退出码：0 = 干净；2 = 有问题（指纹不符 / 有失败条目 / 有未执行版本）；
1 = 运行错误（库打不开、patch 文件语法坏）。**2 与 1 分开**，是为了让 cron 能
区分"需要人看"和"工具自己崩了"。
"""
import argparse
import datetime
import hashlib
import importlib.util
import os
import sqlite3
import sys
import time

from . import dbutil

PATCH_TABLE = "schema_patches"

PATCH_DDL = """CREATE TABLE IF NOT EXISTS schema_patches (
    version      INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    checksum     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'ok',
    applied_at   TEXT NOT NULL,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    schema_hash  TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    error        TEXT NOT NULL DEFAULT ''
)"""


class PatchError(Exception):
    """patch 本身有问题（语法坏、指纹不符、执行失败）—— 需要人介入。"""


class Patch:
    __slots__ = ("version", "name", "path", "kind", "checksum", "sql")

    def __init__(self, version, name, path, kind, checksum, sql=None):
        self.version = version
        self.name = name
        self.path = path
        self.kind = kind          # 'sql' | 'py'
        self.checksum = checksum
        self.sql = sql

    def __repr__(self):
        return "<Patch %04d %s>" % (self.version, self.name)


# ---------------------------------------------------------------- 发现

def _checksum(path):
    """内容指纹：**归一化换行**后取 sha256。

    为什么归一化：同一份 patch 在 Windows 检出成 CRLF、在服务器上是 LF，
    若不归一化，每台机器都会报"指纹不符"，人就会加 `--allow-checksum-change`
    把它静音 —— 一条按了就失效的护栏，不如没有。
    """
    with open(path, "rb") as f:
        blob = f.read().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return hashlib.sha256(blob).hexdigest()


def discover(patches_dir=None):
    """→ [Patch]，按版本升序。文件名 `NNNN_名字.sql|py`。

    重复版本号直接报错（不是"取第一个"）：并存的 0007 让"这台库是第几版"
    这个问题重新变得无法回答，而整个模块存在的意义就是回答它。
    """
    d = patches_dir or dbutil.PATCHES_DIR
    if not os.path.isdir(d):
        return []
    found, seen = [], {}
    for fn in sorted(os.listdir(d)):
        if fn.startswith(".") or fn == "__init__.py":
            continue
        stem, ext = os.path.splitext(fn)
        if ext not in (".sql", ".py"):
            continue
        num, _, name = stem.partition("_")
        if not num.isdigit() or not name:
            raise PatchError("patch 文件名不合规范（应为 NNNN_名字.sql|py）: %s" % fn)
        version = int(num)
        if version in seen:
            raise PatchError("版本号 %04d 重复：%s 与 %s" % (version, seen[version], fn))
        seen[version] = fn
        path = os.path.join(d, fn)
        sql = None
        if ext == ".sql":
            with open(path, "r", encoding="utf-8") as f:
                sql = f.read()
        found.append(Patch(version, name, path, ext.lstrip("."), _checksum(path), sql))
    found.sort(key=lambda p: p.version)
    return found


# ---------------------------------------------------------------- 登记表

def has_patch_table(conn):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (PATCH_TABLE,)
    ).fetchone() is not None


def ensure_patch_table(conn):
    """建登记表。它是**自举**的（不由 patch 自己创建）——否则就成了
    「要有登记表才能记录建表」的鸡生蛋。"""
    conn.execute(PATCH_DDL)


def applied_rows(conn):
    if not has_patch_table(conn):
        return {}
    return {int(r["version"]): dict(r) for r in conn.execute(
        "SELECT * FROM schema_patches ORDER BY version")}


# ---------------------------------------------------------------- 计划

def plan(conn, patches):
    """→ 计划字典。**纯读**，不改任何东西（`--status` 与 `--dry-run` 共用）。"""
    rows = applied_rows(conn)
    versions_on_disk = {p.version for p in patches}
    pending, mismatch, failed, unknown = [], [], [], []
    for p in patches:
        row = rows.get(p.version)
        if row is None:
            pending.append(p)
        elif row["status"] != "ok":
            # 上次执行到一半失败：当作待执行重跑（版本号仍占位，不会重复记录）。
            # ⚠️ 这里**不查指纹**：失败的版本从未生效，等于还没执行过，改内容重跑是
            #    正常修 bug；指纹护栏保护的是「已经成功执行过」的版本。
            failed.append((p, row))
            pending.append(p)
        elif row["checksum"] != p.checksum:
            mismatch.append((p, row))
    for v, row in sorted(rows.items()):
        if v not in versions_on_disk:
            unknown.append(row)
    return {
        "ready": has_patch_table(conn),
        "applied": rows,
        "pending": pending,
        "mismatch": mismatch,
        "failed": failed,
        "unknown": unknown,
        "max_applied": max(rows) if rows else 0,
        "max_on_disk": max(versions_on_disk) if versions_on_disk else 0,
    }


def problems_of(pl):
    """哪些情况算「需要人看」。unknown（盘上没有的版本）单列为提醒，不算故障 ——
    它多半是有人手工删了 patch 文件，不影响已执行的结构。"""
    out = []
    if pl["mismatch"]:
        out.append("指纹不符 %d 个：%s" % (
            len(pl["mismatch"]),
            ", ".join("%04d(%s)" % (p.version, os.path.basename(p.path)) for p, _ in pl["mismatch"])))
    if pl["failed"]:
        out.append("上次执行失败 %d 个：%s" % (
            len(pl["failed"]),
            ", ".join("%04d" % p.version for p, _ in pl["failed"])))
    if pl["pending"] and not pl["failed"]:
        out.append("未执行 %d 个：%s" % (
            len(pl["pending"]), ", ".join("%04d" % p.version for p in pl["pending"])))
    return out


# ---------------------------------------------------------------- 执行

def _strip_sql_noise(s):
    """去掉注释与空白，用来判断"结尾还有没有真语句"。

    为什么不能直接 `s.strip(" ;")`：文件常以 `-- 说明` 收尾，那不是错误。
    但也不能一律忽略 —— 少了分号的最后一条语句必须报错，否则它会**静默不执行**，
    而 patch 已经登记为 ok（这正是 `_safe_migrate` 那套机制最擅长制造的假象）。
    """
    out, i, n = [], 0, len(s)
    while i < n:
        if s.startswith("--", i):
            j = s.find("\n", i)
            i = n if j < 0 else j + 1
        elif s.startswith("/*", i):
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out).strip()


def _iter_statements(sql):
    """把 .sql 文件切成单条语句。

    为什么不能 `conn.executescript()`：它会在执行前后**隐式提交**，迁移中途失败
    就会留下"做了一半"的库（而我们的承诺是"要么整版生效，要么完全没动"）。
    逐条 `execute()` 才能把整版包在一个 BEGIN…COMMIT 里。

    切分按 `;` 粗切、用 `sqlite3.complete_statement` 判定是否真的完整 ——
    这样字符串字面量里的 `;`（如 `VALUES ('a;b')`）不会被切错。

    ⚠️ 这里**绝不**替原文补分号。补了的话「少了分号的最后一条语句」会被当成完整语句
    交给 sqlite，而 sqlite 会照常执行它 —— 只是"有没有执行"这件事再也没人核对得出来。
    """
    buf, i, n = "", 0, len(sql)
    while i < n:
        j = sql.find(";", i)
        if j < 0:
            buf += sql[i:]
            break
        buf += sql[i:j + 1]
        i = j + 1
        if sqlite3.complete_statement(buf):
            stmt = buf.strip().strip(";").strip()
            if stmt:
                yield stmt
            buf = ""
    tail = _strip_sql_noise(buf)
    if tail:
        raise PatchError("SQL 结尾有未闭合的语句（多半少了分号或引号不配对）：%s" % tail[:120])


def _run_py_patch(patch, conn):
    spec = importlib.util.spec_from_file_location("hg_patch_%04d" % patch.version, patch.path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    fn = getattr(mod, "upgrade", None)
    if not callable(fn):
        raise PatchError("%s 缺少 upgrade(conn) 函数" % os.path.basename(patch.path))
    note = fn(conn)
    return note if isinstance(note, str) else ""


def apply_patch(conn, patch, schema_hash=""):
    """在**一个事务**里执行一条 patch 并登记。失败则整版回滚并把失败写进登记表。

    失败登记用独立事务写 —— 否则回滚会把"我失败过"这条唯一线索一起抹掉，
    下次启动又从头再来，永远没人知道它一直在失败。
    """
    started = time.time()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if patch.kind == "sql":
            for stmt in _iter_statements(patch.sql):
                conn.execute(stmt)
            note = ""
        else:
            note = _run_py_patch(patch, conn)
        dur = int((time.time() - started) * 1000)
        conn.execute(
            "INSERT INTO schema_patches (version,name,checksum,status,applied_at,duration_ms,schema_hash,note,error)"
            " VALUES (?,?,?,'ok',?,?,?,?,'')"
            " ON CONFLICT(version) DO UPDATE SET name=excluded.name, checksum=excluded.checksum,"
            " status='ok', applied_at=excluded.applied_at, duration_ms=excluded.duration_ms,"
            " schema_hash=excluded.schema_hash, note=excluded.note, error=''",
            (patch.version, patch.name, patch.checksum,
             datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), dur, schema_hash, note[:500]))
        conn.execute("COMMIT")
        return dur
    except Exception as e:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        msg = str(e)[:500]
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT INTO schema_patches (version,name,checksum,status,applied_at,duration_ms,error)"
                " VALUES (?,?,?,'failed',?,0,?)"
                " ON CONFLICT(version) DO UPDATE SET status='failed', error=excluded.error,"
                " applied_at=excluded.applied_at",
                (patch.version, patch.name, patch.checksum,
                 datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg))
            conn.execute("COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
        raise PatchError("patch %04d(%s) 执行失败，已回滚：%s"
                         % (patch.version, patch.name, msg))


def apply_all(conn, patches, dry_run=False, allow_checksum_change=False):
    """→ 结果字典。任何指纹不符 ⇒ 在**执行之前**整体拒绝（不做半截）。"""
    pl = plan(conn, patches)
    if pl["mismatch"] and not allow_checksum_change:
        raise PatchError(
            "有 %d 个已执行的 patch 内容变了（指纹不符）：%s\n"
            "  历史 patch 一旦执行过就不许改 —— 请新增一个版本号表达这次变更。"
            "（确实要接受新内容，用 --allow-checksum-change，它会同时更新指纹）"
            % (len(pl["mismatch"]),
               ", ".join("%04d(%s)" % (p.version, p.name) for p, _ in pl["mismatch"])))
    if dry_run:
        return {"applied": [], "would_apply": [p.version for p in pl["pending"]], "dry_run": True}

    if not has_patch_table(conn):
        conn.execute("BEGIN IMMEDIATE")
        ensure_patch_table(conn)
        conn.execute("COMMIT")

    done = []
    for p in pl["pending"]:
        dur = apply_patch(conn, p)
        done.append({"version": p.version, "name": p.name, "ms": dur})
    return {"applied": done, "would_apply": [], "dry_run": False}


# ---------------------------------------------------------------- CLI

def _targets(args):
    """→ [(标签, 路径)]。默认只主库；`--all-tenants` 追加全部租户库。"""
    out = [("master", dbutil.master_db_path())]
    if getattr(args, "all_tenants", False):
        for tid, p in dbutil.tenant_db_paths():
            out.append(("tenant_%d" % tid, p))
    if getattr(args, "db", None):
        out = [("db", os.path.abspath(args.db))]
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(prog="migrations.runner",
                                description="Hergent ERP 版本化迁移运行器")
    ap.add_argument("--apply", action="store_true", help="执行待执行的 patch")
    ap.add_argument("--status", action="store_true", help="只看状态（默认行为）")
    ap.add_argument("--dry-run", action="store_true", help="配合 --apply：只列出将执行什么")
    ap.add_argument("--db", help="指定单个库文件（默认主库）")
    ap.add_argument("--all-tenants", action="store_true", help="主库 + 所有租户库")
    ap.add_argument("--allow-checksum-change", action="store_true",
                    help="指纹不符也继续（会更新指纹）—— 仅用于已知的误报")
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    args = ap.parse_args(argv)

    try:
        patches = discover()
    except PatchError as e:
        print("[patch] %s" % e, file=sys.stderr)
        return 1
    if not patches:
        print("[patch] %s 下没有任何 patch（版本号从 0001 起）" % dbutil.PATCHES_DIR)

    rc = 0
    report = []
    for label, path in _targets(args):
        if not os.path.exists(path):
            print("[patch] %s 库不存在：%s" % (label, path), file=sys.stderr)
            rc = 1
            continue
        try:
            if args.apply and not args.dry_run:
                conn = dbutil.connect_rw(path)
                try:
                    res = apply_all(conn, patches, allow_checksum_change=args.allow_checksum_change)
                    snap = dbutil.snapshot(conn)
                    fpr = dbutil.fingerprint(snap)
                    if res["applied"]:
                        conn.execute("BEGIN IMMEDIATE")
                        conn.execute("UPDATE schema_patches SET schema_hash=? WHERE version=?",
                                     (fpr, res["applied"][-1]["version"]))
                        conn.execute("COMMIT")
                finally:
                    conn.close()
                pl = _plan_of(path, patches)
                report.append({"db": label, "path": path, "applied": res["applied"],
                               "max_applied": pl["max_applied"], "pending": [p.version for p in pl["pending"]],
                               "fingerprint": fpr})
                if not args.json:
                    if res["applied"]:
                        print("[patch] %s：执行了 %d 个 → %s" % (
                            label, len(res["applied"]),
                            ", ".join("%04d(%dms)" % (a["version"], a["ms"]) for a in res["applied"])))
                    else:
                        print("[patch] %s：已是最新（v%04d）" % (label, pl["max_applied"]))
                    print("[patch] %s：结构指纹 %s" % (label, fpr))
            else:
                pl = _plan_of(path, patches)
                report.append({"db": label, "path": path, "ready": pl["ready"],
                               "max_applied": pl["max_applied"], "pending": [p.version for p in pl["pending"]],
                               "mismatch": [p.version for p, _ in pl["mismatch"]],
                               "failed": [p.version for p, _ in pl["failed"]],
                               "unknown": [r["version"] for r in pl["unknown"]],
                               "total_applied": len(pl["applied"])})
                if not args.json:
                    if not pl["ready"]:
                        print("[patch] %-10s 尚无 schema_patches（未纳入版本管理）→ %s" % (label, path))
                    else:
                        print("[patch] %-10s v%04d 已执行 %d 条；待执行 %s%s%s" % (
                            label, pl["max_applied"], len(pl["applied"]),
                            [p.version for p in pl["pending"]] or "无",
                            "；指纹不符 %s" % [p.version for p, _ in pl["mismatch"]] if pl["mismatch"] else "",
                            "；失败 %s" % [p.version for p, _ in pl["failed"]] if pl["failed"] else ""))
                for msg in problems_of(pl):
                    if not args.json:
                        print("[patch] ⚠️  %s：%s" % (label, msg))
                    rc = 2
        except PatchError as e:
            print("[patch] %s：%s" % (label, e), file=sys.stderr)
            rc = 2
        except Exception as e:
            print("[patch] %s：运行错误 %s" % (label, e), file=sys.stderr)
            rc = 1

    if args.json:
        import json as _json
        print(_json.dumps({"ok": rc == 0, "exit": rc, "dbs": report,
                           "patches": [{"version": p.version, "name": p.name} for p in patches]},
                          ensure_ascii=False, indent=2))
    return rc


def _plan_of(path, patches):
    conn = dbutil.connect_ro(path)
    try:
        return plan(conn, patches)
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
